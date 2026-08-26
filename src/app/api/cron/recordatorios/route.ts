/** Cron diario (12:00 UTC, ver `vercel.json`) que dispara los recordatorios automáticos:
 * objetivos pendientes, aprobaciones de jefe, evaluaciones pendientes, nota preliminar y el
 * digest de RR.HH. Protegido con `CRON_SECRET` (lo envía Vercel; sin él, 401 sin efectos). */
import { NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/shared/lib/prisma'
import { hitoDelDia, tocaDigestRrhh, diasRestantes, type Hito } from '@/features/recordatorios/hitos'
import {
  pendientesObjetivos, aprobacionesPorJefe, pendientesEvaluaciones, datosDigestRrhh, notasPreliminaresNuevas,
  type DestinatarioObjetivos,
} from '@/features/recordatorios/pendientes'
import {
  construirRecordatorioObjetivosAuto, construirRecordatorioAprobacionesJefe, construirRecordatorioEvaluaciones,
  construirDigestRrhh, enviarNotaPreliminarDisponible, enviarBatch, type CorreoConstruido,
} from '@/shared/lib/mailer'
import { enviarPushACorreos } from '@/shared/lib/push'
import { createHash, timingSafeEqual } from 'node:crypto'
import { purgarRateLimitVencidos } from '@/shared/lib/rate-limit'
import { purgarAuditLog } from '@/features/admin/retencion-auditoria'

export const maxDuration = 300 // lotes grandes de correo contra Resend

/** Sentinela de "envío de lote" para el candado idempotente de `RecordatorioEnvio`.
 * El unique de Postgres NO trata dos filas con `destinatarioId = NULL` como duplicadas (NULL
 * nunca es igual a NULL dentro de un índice único) — así que un lote (sin destinatario
 * puntual) usa cadena vacía en vez de null: eso sí colisiona en el `@@unique` y bloquea
 * reintentos del mismo día. El campo es `String?` en el schema; una cadena vacía no requiere
 * migración. Los correos puntuales (nota preliminar, correo 7) sí usan el `colaboradorId` real. */
const LOTE = ''

function fechaUTC(hoy: Date): Date {
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()))
}

function esP2002(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'P2002'
}

function formatoFecha(f: Date): string {
  return f.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Registro-candado: intenta crear la fila del día ANTES de enviar el lote (con `enviados: 0`
 * provisional). Si el `@@unique` ya tiene esa fila (P2002), el lote ya corrió hoy → null
 * (skip, sin reenviar). Si se crea, devuelve su id para cerrarla con los conteos reales. */
async function candado(proceso: string, referencia: string, hito: string, fecha: Date, destinatarioId: string): Promise<string | null> {
  try {
    const fila = await prisma.recordatorioEnvio.create({
      data: { proceso, referencia, hito, fecha, destinatarioId, enviados: 0, fallidos: 0 },
    })
    return fila.id
  } catch (e) {
    if (esP2002(e)) return null
    throw e
  }
}

async function cerrar(id: string, enviados: number, fallidos: number, detalleJson?: Prisma.InputJsonValue) {
  await prisma.recordatorioEnvio.update({ where: { id }, data: { enviados, fallidos, detalleJson: detalleJson ?? undefined } })
}

/** Construye un correo por item con `construir` y despacha el lote entero con UNA llamada a
 * `enviarBatch` (que internamente parte en chunks de 100 contra la batch API de Resend — ver
 * `mailer.ts`). Un chunk que falla completo no frena los demás; sus fallidos quedan reflejados
 * en el conteo devuelto, sin lanzar. */
async function enviarLote<T>(items: T[], construir: (item: T) => CorreoConstruido) {
  const correos = items.map(construir)
  return enviarBatch(correos)
}

/** El push ACOMPAÑA al correo: mismos destinatarios, y un fallo aquí no puede tumbar el cron ni
 * impedir que el correo cuente como enviado. Reusa el candado del bloque (ya se ejecutó una vez
 * al día), así que no hace falta uno propio. */
async function pushDelLote(correos: string[], titulo: string, cuerpo: string, ruta: string, etiqueta: string) {
  try {
    return await enviarPushACorreos(correos, { titulo, cuerpo, ruta, etiqueta })
  } catch (e) {
    console.error('[cron/recordatorios] push falló:', e)
    return { enviados: 0, fallidos: 0, caducadas: 0 }
  }
}

/** Compara el bearer en tiempo constante. Con `!==` el corte se produce en el primer byte
 *  distinto, y eso filtra —en teoría— el secreto a base de medir tiempos. Se hashean los dos lados
 *  para que la comparación no revele además la LONGITUD y para no depender de que coincida. */
function bearerValido(recibido: string | null, secreto: string): boolean {
  const h = (v: string) => createHash('sha256').update(v).digest()
  return timingSafeEqual(h(recibido ?? ''), h(`Bearer ${secreto}`))
}

export async function GET(request: Request) {
  // Sin CRON_SECRET configurada la ruta queda cerrada — nunca fail-open
  const secreto = process.env.CRON_SECRET
  if (!secreto || !bearerValido(request.headers.get('authorization'), secreto)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const hoy = new Date()
  const fecha = fechaUTC(hoy)
  const resumen: Record<string, unknown>[] = []

  const [periodosCarga, ciclosActivos] = await Promise.all([
    prisma.periodoObjetivos.findMany({ where: { estado: 'CARGA_ABIERTA' }, orderBy: { fechaLimiteCarga: 'asc' } }),
    prisma.ciclo.findMany({ where: { estado: 'ACTIVO' }, orderBy: { fechaFin: 'asc' } }),
  ])

  // 1. Objetivos por período en carga — hito por deadline EFECTIVO de cada destinatario.
  //    Una extensión individual puede desalinear la cadencia de esa persona de la del
  //    período (su deadline es posterior, así que su propio D7/DIARIO/ULTIMO_DIA cae en OTRO
  //    día calendario). Por eso se agrupa por deadline efectivo y se evalúa el hito por
  //    grupo: en el caso normal (sin extensiones) todo el mundo comparte el deadline del
  //    período, así que hay un solo grupo y su hito ES "el hito del período" — el registro
  //    de esa fila queda igual que si no hubiera extensiones. Si un grupo extendido dispara
  //    un hito DISTINTO al del período ese mismo día, se registra una fila adicional con ESE
  //    hito (el `@@unique` lo permite: mismo período+fecha, hito diferente) — necesario para
  //    no perder la cadencia de quienes tienen más tiempo.
  try {
    for (const periodo of periodosCarga) {
      const { destinatarios } = await pendientesObjetivos(periodo.id)
      if (destinatarios.length === 0) continue

      const porDeadline = new Map<number, DestinatarioObjetivos[]>()
      for (const d of destinatarios) {
        const clave = d.deadline.getTime()
        porDeadline.set(clave, [...(porDeadline.get(clave) ?? []), d])
      }
      const porHito = new Map<Hito, DestinatarioObjetivos[]>()
      for (const [clave, grupo] of porDeadline) {
        const hito = hitoDelDia(new Date(clave), hoy)
        if (!hito) continue
        porHito.set(hito, [...(porHito.get(hito) ?? []), ...grupo])
      }

      for (const [hito, grupo] of porHito) {
        const id = await candado('OBJETIVOS', periodo.id, hito, fecha, LOTE)
        if (!id) { resumen.push({ proceso: 'OBJETIVOS', periodo: periodo.nombre, hito, skip: 'ya enviado hoy' }); continue }
        const { enviados, fallidos, erroresMuestra } = await enviarLote(
          grupo,
          (d) => construirRecordatorioObjetivosAuto(d.email, d.nombre, periodo.nombre, formatoFecha(d.deadline), d.avance, diasRestantes(d.deadline, hoy), hito === 'ULTIMO_DIA'),
        )
        const push = await pushDelLote(
          grupo.map((d) => d.email),
          hito === 'ULTIMO_DIA' ? 'Hoy cierra la carga de objetivos' : 'Tienes objetivos por cargar',
          `${periodo.nombre} · vence el ${formatoFecha(grupo[0].deadline)}`,
          '/objetivos',
          'objetivos',
        )
        await cerrar(id, enviados, fallidos, { destinatarios: grupo.length, erroresMuestra, push })
        resumen.push({ proceso: 'OBJETIVOS', periodo: periodo.nombre, hito, enviados, fallidos, push })
      }
    }
  } catch (e) {
    console.error('[cron/recordatorios] Bloque OBJETIVOS falló:', e)
    resumen.push({ proceso: 'OBJETIVOS', error: String(e) })
  }

  // 2. Aprobaciones pendientes por jefe — hito ÚNICO por el deadline del PERÍODO: la
  //    ventana de aprobación del jefe no se extiende (la extensión es del colaborador que
  //    carga, no del jefe que aprueba), así que no hay grupos que desalinear aquí.
  try {
    for (const periodo of periodosCarga) {
      const hito = hitoDelDia(periodo.fechaLimiteCarga, hoy)
      if (!hito) continue
      const { destinatarios } = await aprobacionesPorJefe(periodo.id)
      if (destinatarios.length === 0) continue

      const id = await candado('APROBACIONES_JEFE', periodo.id, hito, fecha, LOTE)
      if (!id) { resumen.push({ proceso: 'APROBACIONES_JEFE', periodo: periodo.nombre, hito, skip: 'ya enviado hoy' }); continue }
      const dias = diasRestantes(periodo.fechaLimiteCarga, hoy)
      const deadlineTexto = formatoFecha(periodo.fechaLimiteCarga)
      const { enviados, fallidos, erroresMuestra } = await enviarLote(
        destinatarios,
        (j) => construirRecordatorioAprobacionesJefe(j.email, j.nombre, periodo.nombre, deadlineTexto, j.filas, dias),
      )
      const push = await pushDelLote(
        destinatarios.map((d) => d.email),
        'Objetivos de tu equipo por aprobar',
        `${periodo.nombre} · revisa y aprueba antes del cierre`,
        '/equipo/objetivos',
        'aprobaciones',
      )
      await cerrar(id, enviados, fallidos, { destinatarios: destinatarios.length, erroresMuestra, push })
      resumen.push({ proceso: 'APROBACIONES_JEFE', periodo: periodo.nombre, hito, enviados, fallidos })
    }
  } catch (e) {
    console.error('[cron/recordatorios] Bloque APROBACIONES_JEFE falló:', e)
    resumen.push({ proceso: 'APROBACIONES_JEFE', error: String(e) })
  }

  // 3. Evaluaciones pendientes por ciclo activo — hito por `fechaFin` del ciclo.
  try {
    for (const ciclo of ciclosActivos) {
      const hito = hitoDelDia(ciclo.fechaFin, hoy)
      if (!hito) continue
      const { destinatarios } = await pendientesEvaluaciones(ciclo.id)
      if (destinatarios.length === 0) continue

      const id = await candado('EVALUACIONES', ciclo.id, hito, fecha, LOTE)
      if (!id) { resumen.push({ proceso: 'EVALUACIONES', ciclo: ciclo.nombre, hito, skip: 'ya enviado hoy' }); continue }
      const dias = diasRestantes(ciclo.fechaFin, hoy)
      const deadlineTexto = formatoFecha(ciclo.fechaFin)
      const { enviados, fallidos, erroresMuestra } = await enviarLote(
        destinatarios,
        (ev) => construirRecordatorioEvaluaciones(ev.email, ev.nombre, ciclo.nombre, deadlineTexto, ev.pendientes, dias, hito === 'ULTIMO_DIA'),
      )
      const push = await pushDelLote(
        destinatarios.map((d) => d.email),
        hito === 'ULTIMO_DIA' ? 'Hoy cierra el ciclo de evaluación' : 'Tienes evaluaciones pendientes',
        `${ciclo.nombre} · responde antes del cierre`,
        '/evaluaciones',
        'evaluaciones',
      )
      await cerrar(id, enviados, fallidos, { destinatarios: destinatarios.length, erroresMuestra, push })
      resumen.push({ proceso: 'EVALUACIONES', ciclo: ciclo.nombre, hito, enviados, fallidos })
    }
  } catch (e) {
    console.error('[cron/recordatorios] Bloque EVALUACIONES falló:', e)
    resumen.push({ proceso: 'EVALUACIONES', error: String(e) })
  }

  // 4. Nota preliminar disponible — transición (sin cadencia de hitos): se dispara la
  //    primera vez que se detecta. `notasPreliminaresNuevas` ya filtra por registro previo
  //    ENTRE días; el candado por destinatario aquí cubre además el reintento DENTRO del
  //    mismo día (proceso muerto a mitad del bucle).
  try {
    for (const ciclo of ciclosActivos) {
      // Ciclo sin período (periodoId null): el correo dice "se completaron tus evaluaciones y
      // logros" — copy que no aplica sin objetivos. Se salta el aviso (la vista previa web
      // sigue disponible igual, calcularResultado ya la resuelve sin período).
      if (ciclo.periodoId === null) continue
      const nuevos = await notasPreliminaresNuevas(ciclo.id)
      let enviados = 0
      let fallidos = 0
      for (const persona of nuevos) {
        const id = await candado('NOTA_PRELIMINAR', ciclo.id, 'UNICO', fecha, persona.colaboradorId)
        if (!id) continue // ya registrada hoy (reintento del cron)
        try {
          await enviarNotaPreliminarDisponible(persona.email, persona.nombre, ciclo.nombre)
          const push = await pushDelLote(
            [persona.email],
            'Tu resultado preliminar está listo',
            `${ciclo.nombre} · revísalo y da tu conformidad`,
            '/mi-resultado',
            'nota-preliminar',
          )
          await cerrar(id, 1, 0, { push })
          enviados++
        } catch (e) {
          console.error(`[cron/recordatorios] Falló nota preliminar a ${persona.email}:`, e)
          await cerrar(id, 0, 1, { error: String(e) })
          fallidos++
        }
      }
      if (nuevos.length > 0) resumen.push({ proceso: 'NOTA_PRELIMINAR', ciclo: ciclo.nombre, enviados, fallidos })
    }
  } catch (e) {
    console.error('[cron/recordatorios] Bloque NOTA_PRELIMINAR falló:', e)
    resumen.push({ proceso: 'NOTA_PRELIMINAR', error: String(e) })
  }

  // 5. Digest RR.HH. — semanal (lunes) o diario en la última semana del proceso más próximo
  //    a cerrar; cruza objetivos y evaluaciones de TODOS los procesos activos en un correo.
  try {
    const deadlines = [periodosCarga[0]?.fechaLimiteCarga, ciclosActivos[0]?.fechaFin].filter((d): d is Date => d !== undefined)
    const masProximo = deadlines.length > 0 ? new Date(Math.min(...deadlines.map((d) => d.getTime()))) : null
    if (tocaDigestRrhh(masProximo, hoy)) {
      const enUltimaSemana = masProximo !== null && diasRestantes(masProximo, hoy) <= 7
      const hito = enUltimaSemana ? 'DIARIO' : 'SEMANAL'
      const destinatarios = await datosDigestRrhh()
      if (destinatarios.length > 0) {
        const id = await candado('DIGEST_RRHH', 'GLOBAL', hito, fecha, LOTE)
        if (!id) {
          resumen.push({ proceso: 'DIGEST_RRHH', hito, skip: 'ya enviado hoy' })
        } else {
          const { enviados, fallidos, erroresMuestra } = await enviarLote(
            destinatarios,
            (d) => construirDigestRrhh(d.usuario.email, d.usuario.nombre, formatoFecha(hoy), d.objetivos, d.evaluaciones),
          )
          const push = await pushDelLote(
            destinatarios.map((d) => d.usuario.email),
            'Resumen de RR.HH.',
            // Sin cifras a propósito: el digest es DISTINTO para cada destinatario (cada uno ve
            // su alcance de países) y el push va en lote con un solo texto
            hito === 'DIARIO' ? 'Última semana del proceso: revisa el avance' : 'Avance de objetivos y evaluaciones de la semana',
            '/admin/ciclos',
            'digest-rrhh',
          )
          await cerrar(id, enviados, fallidos, { destinatarios: destinatarios.length, erroresMuestra, push })
          resumen.push({ proceso: 'DIGEST_RRHH', hito, enviados, fallidos, push })
        }
      }
    }
  } catch (e) {
    console.error('[cron/recordatorios] Bloque DIGEST_RRHH falló:', e)
    resumen.push({ proceso: 'DIGEST_RRHH', error: String(e) })
  }

  /* Mantenimiento: los contadores del rate limit solo crecían y su clave incluye la IP, así que un
     barrido de IPs dejaba una fila permanente por cada una. Se purgan los ya vencidos. */
  const contadoresPurgados = await purgarRateLimitVencidos().catch(() => 0)
  resumen.push({ tarea: 'purga-rate-limit', filas: contadoresPurgados })

  /* Retención del log: lo que toca evaluaciones no caduca; el resto vive un año y las entradas de
     acceso, 90 días. Ver `retencion-auditoria.ts` para la política y su justificación. */
  const logPurgado = await purgarAuditLog().catch((e) => {
    // Distinguir «no había nada» de «la purga falló»: un fallo silencioso dejaría el log creciendo
    console.error('[retencion-auditoria] la purga falló', e)
    return { ruido: -1, general: -1 }
  })
  resumen.push({ tarea: 'retencion-auditoria', ...logPurgado })

  return NextResponse.json({ ok: true, resumen })
}
