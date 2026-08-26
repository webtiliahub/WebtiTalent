'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { prisma } from '@/shared/lib/prisma'
import { requiereSesion, requiereAdmin, alcancePaisWhere, fueraDeAlcancePais, periodoFueraDeAlcance, paisForzado } from '@/shared/lib/permisos'
import { tieneAdmin } from '@/shared/lib/permisos-admin'
import { enviarAperturaObjetivos, enviarRecordatorioObjetivos } from '@/shared/lib/mailer'
import { enviarPushACorreos } from '@/shared/lib/push'
import { colaboradoresDelPeriodo } from '@/features/objetivos/alcance-periodo'

const rutasObjetivos = ['/admin/transversales', '/objetivos', '/equipo/objetivos', '/admin/ciclos/nuevo', '/admin/periodos/nuevo']
function revalidar() {
  rutasObjetivos.forEach((r) => revalidatePath(r))
}

/** Ventana de carga: null si se puede cargar; mensaje de error si no.
 * Deadline blando: al vencer bloquea a la organización, pero RRHH puede seguir, extender el plazo
 * global o dar una extensión individual al colaborador (licencias, ingresos nuevos). */
export async function validarVentanaCarga(periodoId: string, esRrhh: boolean, colaboradorId?: string): Promise<string | null> {
  await requiereSesion() // 'use server' → endpoint POSTeable directo: exige sesión aunque los callers ya la tengan
  const periodo = await prisma.periodoObjetivos.findUnique({ where: { id: periodoId } })
  if (!periodo) return 'Período no encontrado'
  if (periodo.estado === 'BORRADOR') return 'RR.HH. aún no abre la carga de objetivos de este período'
  if (periodo.estado === 'CERRADO') {
    if (!esRrhh) return 'El período está cerrado: sus objetivos ya no se modifican'
    // RR.HH. puede corregir un período cerrado SOLO mientras ningún ciclo lanzado lo evalúe:
    // una vez evaluado, los objetivos son la base de notas ya emitidas y no se tocan.
    const ciclosLanzados = await prisma.ciclo.count({ where: { periodoId, estado: { not: 'BORRADOR' } } })
    if (ciclosLanzados > 0) return 'Un ciclo de evaluación lanzado ya evalúa este período: sus objetivos no se modifican'
    return null
  }
  if (esRrhh || periodo.fechaLimiteCarga >= new Date()) return null
  if (colaboradorId) {
    const extension = await prisma.extensionPlazoObjetivos.findUnique({
      where: { periodoId_colaboradorId: { periodoId, colaboradorId } },
    })
    if (extension && extension.hasta >= new Date()) return null
  }
  return 'El plazo de carga venció. RR.HH. puede extenderlo si corresponde'
}

/** Extensión vigente de un colaborador en un período (o null). */
export async function extensionVigente(periodoId: string, colaboradorId: string) {
  await requiereSesion() // 'use server' → endpoint POSTeable directo: exige sesión aunque los callers ya la tengan
  const e = await prisma.extensionPlazoObjetivos.findUnique({
    where: { periodoId_colaboradorId: { periodoId, colaboradorId } },
  })
  return e && e.hasta >= new Date() ? e : null
}

// ───────────── Gestión del período (RR.HH.) ─────────────

const esquemaPeriodo = z.object({
  nombre: z.string().trim().min(2, 'Escribe un nombre (p.ej. 2026 o 2026-S1)').max(100),
  tipo: z.enum(['ANUAL', 'SEMESTRAL']),
  fechaLimiteCarga: z.string().min(1, 'Define la fecha límite de carga'),
})

const esquemaAlcance = z.object({
  focoPaisIds: z.array(z.string()).max(50), focoAreaIds: z.array(z.string()).max(50),
  focoNivelIds: z.array(z.string()).max(50), incluirIds: z.array(z.string()).max(500),
  excluirIds: z.array(z.string()).max(500),
})
type AlcancePeriodoInput = z.infer<typeof esquemaAlcance>

/** Regla país-techo (espejo de validarAlcanceCiclo): RRHH-país fuerza su país en el foco
 * y sus ajustes manuales solo pueden referenciar colaboradores de su país. */
async function validarAlcancePeriodo(sesion: Awaited<ReturnType<typeof requiereAdmin>>, alcance: AlcancePeriodoInput) {
  const datos = esquemaAlcance.safeParse(alcance)
  if (!datos.success) return { ok: false as const, error: 'Alcance inválido' }
  const forzadoPeriodo = paisForzado(sesion)
  const focoPaisIds = forzadoPeriodo ? [forzadoPeriodo] : datos.data.focoPaisIds
  const referenciados = [...new Set([...datos.data.incluirIds, ...datos.data.excluirIds])]
  if (referenciados.length > 0 && forzadoPeriodo) {
    const fuera = await prisma.colaborador.count({ where: { id: { in: referenciados }, paisId: { not: forzadoPeriodo } } })
    if (fuera > 0) return { ok: false as const, error: 'Los ajustes manuales solo pueden incluir colaboradores de tu país' }
  }
  return { ok: true as const, alcance: { ...datos.data, focoPaisIds } }
}

export async function crearPeriodo(formData: FormData, alcance: AlcancePeriodoInput) {
  const sesion = await requiereAdmin('OBJETIVOS', 'GESTIONAR')
  const datos = esquemaPeriodo.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  const fecha = new Date(`${datos.data.fechaLimiteCarga}T23:59:59`)
  if (isNaN(fecha.getTime())) return { ok: false as const, error: 'Fecha límite inválida' }
  const va = await validarAlcancePeriodo(sesion, alcance)
  if (!va.ok) return va
  try {
    const periodo = await prisma.periodoObjetivos.create({
      data: { nombre: datos.data.nombre, tipo: datos.data.tipo, fechaLimiteCarga: fecha, ...va.alcance },
    })
    await prisma.auditLog.create({
      data: { usuarioId: sesion.id, accion: 'PERIODO_CREADO', entidad: periodo.id, detalle: { nombre: periodo.nombre, tipo: periodo.tipo, alcance: { ...va.alcance } } },
    })
  } catch (e) {
    if (typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'P2002') {
      return { ok: false as const, error: 'Ya existe un período con ese nombre' }
    }
    throw e
  }
  revalidar()
  return { ok: true as const }
}


/** Edita el alcance de un período: solo mientras está en BORRADOR — con la carga abierta ya
 * hay objetivos cargados sobre el alcance vigente, y cambiarlo dejaría trabajo huérfano o
 * fuera del alcance nuevo. */
export async function editarAlcancePeriodo(periodoId: string, alcance: AlcancePeriodoInput) {
  const sesion = await requiereAdmin('OBJETIVOS', 'GESTIONAR')
  const periodo = await prisma.periodoObjetivos.findUnique({ where: { id: periodoId } })
  if (!periodo) return { ok: false as const, error: 'Período no encontrado' }
  if (periodoFueraDeAlcance(sesion, periodo)) return { ok: false as const, error: 'Ese período está fuera de tu país' }
  if (periodo.estado !== 'BORRADOR') {
    return { ok: false as const, error: 'El alcance solo se edita en borrador: con la carga abierta ya hay trabajo hecho sobre él' }
  }
  const va = await validarAlcancePeriodo(sesion, alcance)
  if (!va.ok) return va
  await prisma.periodoObjetivos.update({ where: { id: periodoId }, data: va.alcance })
  await prisma.auditLog.create({
    data: { usuarioId: sesion.id, accion: 'PERIODO_ALCANCE_EDITADO', entidad: periodoId, detalle: { nombre: periodo.nombre, alcance: va.alcance } },
  })
  revalidar()
  return { ok: true as const }
}

/** Borra un período en BORRADOR (cascade: sus transversales). Bloquea si un ciclo lo referencia. */
export async function eliminarPeriodo(periodoId: string) {
  const sesion = await requiereAdmin('OBJETIVOS', 'GESTIONAR')
  const periodo = await prisma.periodoObjetivos.findUnique({
    where: { id: periodoId },
    include: { _count: { select: { objetivos: true, ciclos: true } }, ciclos: { select: { nombre: true }, take: 1 } },
  })
  if (!periodo) return { ok: false as const, error: 'Período no encontrado' }
  if (periodoFueraDeAlcance(sesion, periodo)) return { ok: false as const, error: 'Ese período está fuera de tu país' }
  if (periodo.estado !== 'BORRADOR') return { ok: false as const, error: 'Solo se elimina un período en borrador' }
  if (periodo._count.ciclos > 0) {
    return { ok: false as const, error: `El ciclo «${periodo.ciclos[0].nombre}» usa este período: desvincúlalo o bórralo primero` }
  }
  await prisma.periodoObjetivos.delete({ where: { id: periodoId } })
  await prisma.auditLog.create({
    data: { usuarioId: sesion.id, accion: 'PERIODO_ELIMINADO', entidad: periodoId, detalle: { nombre: periodo.nombre, objetivosBorrados: periodo._count.objetivos } },
  })
  revalidar()
  return { ok: true as const }
}

/** Abre la ventana de carga y notifica por correo a toda la organización con cuenta activa. */
export async function abrirCargaPeriodo(periodoId: string) {
  const sesion = await requiereAdmin('OBJETIVOS', 'GESTIONAR')
  const periodo = await prisma.periodoObjetivos.findUnique({ where: { id: periodoId } })
  if (!periodo) return { ok: false as const, error: 'Período no encontrado' }
  if (periodoFueraDeAlcance(sesion, periodo)) return { ok: false as const, error: 'Ese período está fuera de tu país' }
  if (periodo.estado !== 'BORRADOR') return { ok: false as const, error: 'La carga ya fue abierta' }

  await prisma.periodoObjetivos.update({ where: { id: periodoId }, data: { estado: 'CARGA_ABIERTA' } })

  const idsAlcance = (await colaboradoresDelPeriodo(periodo)).map((c) => c.id)
  const usuarios = await prisma.usuario.findMany({
    where: { activo: true, colaboradorId: { in: idsAlcance } },
    include: { colaborador: { select: { nombres: true, apellidos: true, activo: true } } },
  })
  // Cuenta sin colaborador vinculado (huérfana): no hay a quién notificar la apertura de objetivos.
  const destinatarios = usuarios.filter((u) => u.colaborador?.activo)
  const deadline = periodo.fechaLimiteCarga.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })
  const envios = await Promise.allSettled(
    destinatarios.map((u) => enviarAperturaObjetivos(u.email, `${u.colaborador!.nombres} ${u.colaborador!.apellidos}`, periodo.nombre, deadline)),
  )
  const fallidos = envios.filter((e) => e.status === 'rejected').length
  // Push junto al correo de apertura: la carga de objetivos tiene plazo, y llegar al instante
  // es la diferencia entre cargarlos y enterarse el último día
  await enviarPushACorreos(destinatarios.map((u) => u.email), {
    titulo: 'Ya puedes cargar tus objetivos',
    cuerpo: `${periodo.nombre} · hasta el ${deadline}`,
    ruta: '/objetivos',
    etiqueta: 'objetivos',
  }).catch(() => null)

  await prisma.auditLog.create({
    data: {
      usuarioId: sesion.id,
      accion: 'PERIODO_CARGA_ABIERTA',
      entidad: periodoId,
      detalle: { nombre: periodo.nombre, notificados: destinatarios.length - fallidos, fallidos },
    },
  })
  revalidar()
  return { ok: true as const, notificados: destinatarios.length - fallidos, fallidos }
}

/** Deadline blando: RR.HH. extiende la fecha límite (y reabre si estaba cerrado). */
export async function extenderPlazoPeriodo(periodoId: string, formData: FormData) {
  const sesion = await requiereAdmin('OBJETIVOS', 'GESTIONAR')
  const fecha = new Date(`${String(formData.get('fechaLimiteCarga') ?? '')}T23:59:59`)
  if (isNaN(fecha.getTime())) return { ok: false as const, error: 'Fecha inválida' }
  const periodo = await prisma.periodoObjetivos.findUnique({ where: { id: periodoId } })
  if (!periodo) return { ok: false as const, error: 'Período no encontrado' }
  if (periodoFueraDeAlcance(sesion, periodo)) return { ok: false as const, error: 'Ese período está fuera de tu país' }
  if (periodo.estado === 'BORRADOR') return { ok: false as const, error: 'Primero abre la carga del período' }

  await prisma.periodoObjetivos.update({
    where: { id: periodoId },
    data: { fechaLimiteCarga: fecha, estado: 'CARGA_ABIERTA' },
  })
  await prisma.auditLog.create({
    data: { usuarioId: sesion.id, accion: 'PERIODO_PLAZO_EXTENDIDO', entidad: periodoId, detalle: { nombre: periodo.nombre, nuevaFecha: fecha.toISOString().slice(0, 10) } },
  })
  revalidar()
  return { ok: true as const }
}

export async function cerrarPeriodo(periodoId: string) {
  const sesion = await requiereAdmin('OBJETIVOS', 'GESTIONAR')
  const periodo = await prisma.periodoObjetivos.findUnique({ where: { id: periodoId } })
  if (!periodo) return { ok: false as const, error: 'Período no encontrado' }
  if (periodoFueraDeAlcance(sesion, periodo)) return { ok: false as const, error: 'Ese período está fuera de tu país' }
  if (periodo.estado !== 'CARGA_ABIERTA') return { ok: false as const, error: 'Solo se cierra un período con carga abierta' }
  await prisma.periodoObjetivos.update({ where: { id: periodoId }, data: { estado: 'CERRADO' } })
  await prisma.auditLog.create({
    data: { usuarioId: sesion.id, accion: 'PERIODO_CERRADO', entidad: periodoId, detalle: { nombre: periodo.nombre } },
  })
  revalidar()
  return { ok: true as const }
}

/** Cobertura de carga: avance de cada colaborador activo hacia el 100% de peso, con su equipo (jefe). */
/** País elegido en el selector del topbar (solo restringe la vista del Regional, nunca amplía). */
async function paisSeleccionado(): Promise<string | null> {
  return (await cookies()).get('pais')?.value ?? null
}

export async function coberturaPeriodo(periodoId: string) {
  // Helper de lectura consumido por /admin/periodos/[id] (OBJETIVOS: VER) y /admin/ciclos
  // (CICLOS: VER). Las server actions son endpoints invocables directamente, así que el
  // guard exige tener al menos UNA de esas vistas — un colaborador sin rol admin rebota.
  const sesion = await requiereSesion()
  if (!tieneAdmin(sesion.permisosAdmin, 'OBJETIVOS', 'VER') && !tieneAdmin(sesion.permisosAdmin, 'CICLOS', 'VER')) {
    redirect('/hoja-de-vida')
  }
  const periodo = await prisma.periodoObjetivos.findUniqueOrThrow({ where: { id: periodoId } })
  const idsAlcance = (await colaboradoresDelPeriodo(periodo)).map((c) => c.id)
  const [colaboradores, objetivos, extensiones] = await Promise.all([
    prisma.colaborador.findMany({
      // Población del alcance del período, intersectada con el alcance de PAÍS de quien mira:
      // RR.HH. de país solo ve la cobertura de su país; el Regional respeta el selector del topbar
      where: { id: { in: idsAlcance }, ...alcancePaisWhere(sesion, await paisSeleccionado()) },
      select: {
        id: true, nombres: true, apellidos: true, paisId: true, areaId: true, puestoId: true,
        puesto: { select: { nivelId: true } },
        area: { select: { nombre: true } }, jefe: { select: { id: true, nombres: true, apellidos: true } },
      },
    }),
    prisma.objetivo.findMany({ where: { periodoId, estado: 'APROBADO' } }),
    prisma.extensionPlazoObjetivos.findMany({ where: { periodoId, hasta: { gte: new Date() } } }),
  ])
  const extensionDe = new Map(extensiones.map((e) => [e.colaboradorId, e.hasta]))
  const transversales = objetivos.filter((o) => o.tipo === 'TRANSVERSAL')
  // Los transversales cuentan SOLO para quien alcanzan (área/nivel/país/puesto): sumarlos
  // planos a todos inflaba el avance y contradecía al export y al candado de pesos
  const pesoTransversalDe = (c: (typeof colaboradores)[number]) =>
    transversales
      .filter((t) => {
        const porArea = t.focoAreaIds.length === 0 || (c.areaId !== null && t.focoAreaIds.includes(c.areaId))
        const porNivel = t.focoNivelIds.length === 0 || (c.puesto !== null && t.focoNivelIds.includes(c.puesto.nivelId))
        const porPais = t.focoPaisIds.length === 0 || t.focoPaisIds.includes(c.paisId)
        const porPuesto = t.focoPuestoIds.length === 0 || (c.puestoId !== null && t.focoPuestoIds.includes(c.puestoId))
        return porArea && porNivel && porPais && porPuesto
      })
      .reduce((a, t) => a + t.peso, 0)
  const porColaborador = colaboradores.map((c) => {
    const propios = objetivos.filter((o) => o.colaboradorId === c.id).reduce((a, o) => a + o.peso, 0)
    const ext = extensionDe.get(c.id)
    return {
      id: c.id,
      nombre: `${c.nombres} ${c.apellidos}`,
      total: Math.min(propios + pesoTransversalDe(c), 100),
      jefe: c.jefe ? `${c.jefe.nombres} ${c.jefe.apellidos}` : null,
      area: c.area?.nombre ?? null,
      extensionHasta: ext ? ext.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' }) : null,
    }
  })
  return {
    ok: true as const,
    completos: porColaborador.filter((c) => c.total >= 100).length,
    total: colaboradores.length,
    porColaborador,
    incompletos: porColaborador.filter((c) => c.total < 100),
  }
}

/** Extensión individual del plazo para un colaborador (no reabre el período para el resto). */
export async function extenderPlazoColaborador(periodoId: string, formData: FormData) {
  const sesion = await requiereAdmin('OBJETIVOS', 'GESTIONAR')
  const colaboradorId = String(formData.get('colaboradorId') ?? '')
  const hasta = new Date(`${String(formData.get('hasta') ?? '')}T23:59:59`)
  if (!colaboradorId || isNaN(hasta.getTime())) return { ok: false as const, error: 'Datos inválidos' }
  const [periodo, colaborador] = await Promise.all([
    prisma.periodoObjetivos.findUnique({ where: { id: periodoId } }),
    prisma.colaborador.findUnique({ where: { id: colaboradorId } }),
  ])
  if (!periodo || !colaborador) return { ok: false as const, error: 'Período o colaborador no encontrado' }
  if (fueraDeAlcancePais(sesion, colaborador.paisId)) return { ok: false as const, error: 'Ese colaborador está fuera de tu país' }
  if (periodo.estado !== 'CARGA_ABIERTA') return { ok: false as const, error: 'Las extensiones individuales aplican con la carga abierta' }

  await prisma.extensionPlazoObjetivos.upsert({
    where: { periodoId_colaboradorId: { periodoId, colaboradorId } },
    create: { periodoId, colaboradorId, hasta },
    update: { hasta },
  })
  await prisma.auditLog.create({
    data: {
      usuarioId: sesion.id,
      accion: 'PERIODO_EXTENSION_INDIVIDUAL',
      entidad: periodoId,
      detalle: { periodo: periodo.nombre, colaborador: `${colaborador.nombres} ${colaborador.apellidos}`, hasta: hasta.toISOString().slice(0, 10) },
    },
  })
  revalidar()
  return { ok: true as const }
}

/** Recordatorio por correo a quienes no completan el 100% del peso (con cuenta activa).
 * No filtra alcance aquí: hereda el del período vía `coberturaPeriodo` (su `incompletos` ya
 * viene acotado a `colaboradoresDelPeriodo` ∩ alcance de país de quien dispara el envío). */
export async function enviarRecordatoriosPeriodo(periodoId: string) {
  const sesion = await requiereAdmin('OBJETIVOS', 'GESTIONAR')
  const periodo = await prisma.periodoObjetivos.findUnique({ where: { id: periodoId } })
  if (!periodo) return { ok: false as const, error: 'Período no encontrado' }
  if (periodo.estado !== 'CARGA_ABIERTA') return { ok: false as const, error: 'La carga no está abierta' }

  const cobertura = await coberturaPeriodo(periodoId)
  const cuentas = await prisma.usuario.findMany({
    where: { activo: true, colaboradorId: { in: cobertura.incompletos.map((c) => c.id) } },
    select: { email: true, colaboradorId: true },
  })
  const emailDe = new Map(cuentas.map((u) => [u.colaboradorId, u.email]))
  const deadline = periodo.fechaLimiteCarga.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })

  const destinatarios = cobertura.incompletos.filter((c) => emailDe.has(c.id))
  const envios = await Promise.allSettled(
    destinatarios.map((c) => enviarRecordatorioObjetivos(emailDe.get(c.id)!, c.nombre, periodo.nombre, deadline, c.total)),
  )
  const enviados = envios.filter((e) => e.status === 'fulfilled').length
  const fallidos = envios.length - enviados
  const sinCuenta = cobertura.incompletos.length - emailDe.size
  // Deja rastro de a quién NO le llegó y por qué (visible en los logs de Vercel)
  envios.forEach((e, i) => {
    if (e.status === 'rejected') console.error(`[recordatorios] Falló el envío a ${emailDe.get(destinatarios[i].id)}: ${e.reason}`)
  })

  await prisma.auditLog.create({
    data: { usuarioId: sesion.id, accion: 'PERIODO_RECORDATORIOS', entidad: periodoId, detalle: { nombre: periodo.nombre, enviados, fallidos, sinCuenta } },
  })
  return { ok: true as const, enviados, fallidos, sinCuenta }
}

/** Exporta los objetivos del período a filas de CSV/Excel, SOLO dentro del alcance del
 * período (colaboradoresDelPeriodo) ∩ el alcance del RR.HH. que exporta (de país: su país;
 * Regional: toda la organización). Una fila por objetivo y colaborador: individuales/
 * desarrollo con su dueño; transversales expandidos por cada colaborador del alcance al
 * que aplican (focalización área/nivel/país), con su logro. */
export async function exportarObjetivosPeriodo(periodoId: string) {
  const sesion = await requiereAdmin('OBJETIVOS', 'VER')
  const periodo = await prisma.periodoObjetivos.findUnique({ where: { id: periodoId } })
  if (!periodo) return { ok: false as const, error: 'Período no encontrado' }

  const idsAlcance = (await colaboradoresDelPeriodo(periodo)).map((c) => c.id)
  const [colaboradores, objetivos, logros] = await Promise.all([
    prisma.colaborador.findMany({
      where: { id: { in: idsAlcance }, ...alcancePaisWhere(sesion, await paisSeleccionado()) },
      include: {
        pais: true,
        area: true,
        puesto: { select: { nombre: true, nivelId: true } },
        jefe: { select: { nombres: true, apellidos: true } },
      },
      orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
    }),
    prisma.objetivo.findMany({ where: { periodoId }, orderBy: { createdAt: 'asc' } }),
    prisma.objetivoLogro.findMany({ where: { objetivo: { periodoId } } }),
  ])
  const porId = new Map(colaboradores.map((c) => [c.id, c]))
  const logroDe = new Map(logros.map((l) => [`${l.objetivoId}:${l.colaboradorId}`, l]))

  const ESTADO: Record<string, string> = { PROPUESTO: 'Propuesto', APROBADO: 'Aprobado', RECHAZADO: 'Rechazado' }
  const TIPO: Record<string, string> = { INDIVIDUAL: 'Individual', DESARROLLO: 'Desarrollo', TRANSVERSAL: 'Transversal' }
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))

  const fila = (o: (typeof objetivos)[number], c: (typeof colaboradores)[number]) => {
    const l = logroDe.get(`${o.id}:${c.id}`)
    return [
      `${c.nombres} ${c.apellidos}`, c.codigo ?? '', c.documento, c.pais.nombre,
      c.area?.nombre ?? '', c.puesto?.nombre ?? '',
      c.jefe ? `${c.jefe.nombres} ${c.jefe.apellidos}` : '',
      TIPO[o.tipo] ?? o.tipo, o.titulo, String(o.peso), o.metrica ?? '', o.metaFecha ?? '',
      ESTADO[o.estado] ?? o.estado, pct(l?.avanceColaborador), pct(l?.logroFinal),
    ]
  }

  const filas: string[][] = [[
    'colaborador', 'codigo', 'documento', 'pais', 'area', 'puesto', 'jefe_directo',
    'tipo', 'objetivo', 'peso_pct', 'metrica', 'meta_fecha', 'estado', 'avance_colaborador_pct', 'logro_final_pct',
  ]]
  for (const o of objetivos) {
    if (o.tipo === 'TRANSVERSAL') {
      // Se expande por cada colaborador del alcance al que aplica su focalización
      for (const c of colaboradores) {
        const porArea = o.focoAreaIds.length === 0 || (c.areaId !== null && o.focoAreaIds.includes(c.areaId))
        const porNivel = o.focoNivelIds.length === 0 || (c.puesto !== null && o.focoNivelIds.includes(c.puesto.nivelId))
        const porPais = o.focoPaisIds.length === 0 || o.focoPaisIds.includes(c.paisId)
        const porPuesto = o.focoPuestoIds.length === 0 || (c.puestoId !== null && o.focoPuestoIds.includes(c.puestoId))
        if (porArea && porNivel && porPais && porPuesto) filas.push(fila(o, c))
      }
    } else {
      const c = o.colaboradorId ? porId.get(o.colaboradorId) : undefined
      if (c) filas.push(fila(o, c)) // fuera del alcance del RR.HH. → no se exporta
    }
  }

  await prisma.auditLog.create({
    data: { usuarioId: sesion.id, accion: 'PERIODO_OBJETIVOS_EXPORTADO', entidad: periodoId, detalle: { periodo: periodo.nombre, filas: filas.length - 1 } },
  })
  return { ok: true as const, filas, periodo: periodo.nombre }
}
