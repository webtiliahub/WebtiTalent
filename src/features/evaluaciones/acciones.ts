'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { prisma } from '@/shared/lib/prisma'
import { requiereSesion } from '@/shared/lib/permisos'
import { calcularResultado, objetivosAplicables } from '@/features/resultados/servicio'
import { paisCongelado } from '@/features/ciclos/congelamiento'
import { excluidoPorAntiguedad } from '@/domain/antiguedad'
import { preguntasParaAsignacion, preguntasPotencialParaAsignacion } from '@/features/evaluaciones/cuestionario'
import { notificarParAsignado } from '@/features/evaluaciones/notificar-par'

type Payload = {
  asignacionId: string
  respuestas: { preguntaId: string; valor: number }[]
  avances?: { objetivoId: string; avance: number }[] // AUTO: % de avance reportado
  logros?: { objetivoId: string; logro: number }[] // JEFE: % de logro confirmado
  potencial?: { preguntaId: string; valor: number }[] // JEFE: 5 preguntas
  enviar: boolean
}

/** Guarda (borrador) o envía una evaluación. Valida que quien firma sea el evaluador y que el ciclo esté activo. */
export async function guardarEvaluacion(payload: Payload) {
  const sesion = await requiereSesion()
  const asignacion = await prisma.asignacion.findUnique({
    where: { id: payload.asignacionId },
    include: { ciclo: true, evaluado: { include: { puesto: { include: { competencias: true } } } } },
  })
  if (!asignacion) return { ok: false as const, error: 'Evaluación no encontrada' }
  if (asignacion.evaluadorId !== sesion.colaboradorId) return { ok: false as const, error: 'No eres el evaluador asignado' }
  if (asignacion.ciclo.estado !== 'ACTIVO') return { ok: false as const, error: 'El ciclo no está activo' }
  if (asignacion.estado === 'ENVIADA') return { ok: false as const, error: 'Esta evaluación ya fue enviada' }
  if (asignacion.estado === 'PROPUESTA') return { ok: false as const, error: 'Esta nominación de par aún no fue aprobada por RR.HH.' }
  if (asignacion.estado === 'INVALIDADA') return { ok: false as const, error: 'RR.HH. invalidó esta evaluación al resolver un incidente del ciclo: ya no puede responderse' }
  // País cerrado = resultados congelados: una pendiente que se envía tarde cambiaría una nota ya publicada
  if (await paisCongelado(asignacion.cicloId, asignacion.evaluado.paisId)) {
    return { ok: false as const, error: 'El país del evaluado ya cerró este ciclo: su resultado quedó congelado y esta evaluación ya no puede responderse' }
  }

  /* Tope de cardinalidad: la lista blanca de abajo impide escribir preguntas ajenas, pero un array
     de 20.000 elementos se recorre igual dentro de la transacción y bloquea la tabla para el resto
     de los evaluadores. Ningún cuestionario real pasa de unas decenas de ítems. */
  const MAX_ITEMS = 500
  const demasiados = [payload.respuestas, payload.potencial, payload.logros, payload.avances]
    .some((lista) => (lista?.length ?? 0) > MAX_ITEMS)
  if (demasiados) return { ok: false as const, error: 'La evaluación trae más respuestas de las que admite el cuestionario' }

  const valoresInvalidos = [
    ...payload.respuestas.map((r) => r.valor),
    ...(payload.potencial ?? []).map((r) => r.valor),
  ].some((v) => !Number.isInteger(v) || v < 1 || v > 5)
  if (valoresInvalidos) return { ok: false as const, error: 'Las respuestas deben estar entre 1 y 5' }

  /* El cuestionario aplicable se deriva SIEMPRE, no solo al enviar: es la lista blanca de lo que
     se puede escribir. Antes solo se comprobaba que no FALTARAN preguntas al enviar, nunca que no
     SOBRARAN, y el bucle de abajo aceptaba cualquier preguntaId del banco. Como esta función es
     una server action (un endpoint), bastaba un payload con las ~200 preguntas del banco para que
     las que no corresponden entraran al promedio por dimensión y decidieran la nota de otra
     persona — sin que la UI, que solo muestra las aplicables, delatara nada. */
  const aplicables = await preguntasParaAsignacion(asignacion.cicloId, asignacion.tipo, asignacion.evaluado)
  const idsAplicables = new Set(aplicables.map((cp) => cp.preguntaId))
  const potencialAplicable = asignacion.tipo === 'JEFE'
    ? await preguntasPotencialParaAsignacion(asignacion.cicloId, asignacion.evaluadoId)
    : []
  const idsPotencialAplicables = new Set(potencialAplicable.map((p) => p.id))

  // Si envía: validar completitud contra ese mismo cuestionario
  if (payload.enviar) {
    if (aplicables.length > 0) {
      const respondidas = new Set(payload.respuestas.map((r) => r.preguntaId))
      const faltantes = aplicables.filter((cp) => !respondidas.has(cp.preguntaId))
      if (faltantes.length > 0) return { ok: false as const, error: `Faltan ${faltantes.length} preguntas por responder` }
    }
    if (asignacion.tipo === 'JEFE') {
      const respondidasPot = new Set((payload.potencial ?? []).filter((r) => idsPotencialAplicables.has(r.preguntaId)).map((r) => r.preguntaId))
      if (respondidasPot.size < potencialAplicable.length) return { ok: false as const, error: 'Completa las preguntas de potencial' }
    }
  }

  // Ni el jefe ni el colaborador tocan objetivos TRANSVERSALES (su avance lo reporta RR.HH.):
  // el jefe confirma logroFinal solo de los individuales del evaluado, y el colaborador
  // autoreporta avance solo en sus individuales. Ciclo sin período: sin objetivos que reportar.
  const { individuales } = asignacion.ciclo.periodoId
    ? await objetivosAplicables(asignacion.ciclo.periodoId, asignacion.evaluadoId)
    : { individuales: [] }
  const objetivosLogroValidos = new Set(individuales.map((o) => o.id))
  const objetivosAvanceValidos = new Set(individuales.map((o) => o.id))

  await prisma.$transaction(async (tx) => {
    // Respuestas de competencias (upsert). El `continue` es el mismo patrón que ya usaban los
    // logros de objetivos doce líneas más abajo: lo que no está en el cuestionario, no se escribe.
    for (const r of payload.respuestas) {
      if (!idsAplicables.has(r.preguntaId)) continue
      await tx.respuesta.upsert({
        where: { asignacionId_preguntaId: { asignacionId: asignacion.id, preguntaId: r.preguntaId } },
        create: { asignacionId: asignacion.id, preguntaId: r.preguntaId, valor: r.valor },
        update: { valor: r.valor },
      })
    }
    // Potencial (solo jefe)
    if (asignacion.tipo === 'JEFE') {
      for (const r of payload.potencial ?? []) {
        if (!idsPotencialAplicables.has(r.preguntaId)) continue
        await tx.respuestaPotencial.upsert({
          where: { asignacionId_preguntaId: { asignacionId: asignacion.id, preguntaId: r.preguntaId } },
          create: { asignacionId: asignacion.id, preguntaId: r.preguntaId, valor: r.valor },
          update: { valor: r.valor },
        })
      }
      // Logro confirmado de objetivos
      for (const l of payload.logros ?? []) {
        if (!objetivosLogroValidos.has(l.objetivoId)) continue
        const logro = Math.max(0, Math.min(Math.round(l.logro), 100))
        await tx.objetivoLogro.upsert({
          where: { objetivoId_colaboradorId: { objetivoId: l.objetivoId, colaboradorId: asignacion.evaluadoId } },
          create: { objetivoId: l.objetivoId, colaboradorId: asignacion.evaluadoId, logroFinal: logro },
          update: { logroFinal: logro },
        })
      }
    }
    // Avance reportado en autoevaluación
    if (asignacion.tipo === 'AUTO') {
      for (const a of payload.avances ?? []) {
        if (!objetivosAvanceValidos.has(a.objetivoId)) continue
        const avance = Math.max(0, Math.min(Math.round(a.avance), 100))
        await tx.objetivoLogro.upsert({
          where: { objetivoId_colaboradorId: { objetivoId: a.objetivoId, colaboradorId: asignacion.evaluadoId } },
          create: { objetivoId: a.objetivoId, colaboradorId: asignacion.evaluadoId, avanceColaborador: avance },
          update: { avanceColaborador: avance },
        })
      }
    }
    await tx.asignacion.update({
      where: { id: asignacion.id },
      data: payload.enviar ? { estado: 'ENVIADA', enviadaEn: new Date() } : { estado: 'BORRADOR' },
    })
  })

  // Recalcular el resultado del evaluado con la nueva información
  if (payload.enviar) await calcularResultado(asignacion.cicloId, asignacion.evaluadoId)

  revalidatePath('/evaluaciones')
  revalidatePath('/equipo/evaluar')
  return { ok: true as const }
}

// ───────────── Nominación de pares (el jefe directo nomina; RR.HH. es último recurso) ─────────────

/** El jefe nomina un par evaluador para un miembro de su equipo directo (manual Hunter: 2 pares por evaluado). */
export async function nominarPar(cicloId: string, evaluadoId: string, evaluadorId: string) {
  const sesion = await requiereSesion()
  if (!sesion.colaboradorId) return { ok: false as const, error: 'Tu cuenta no está vinculada a un colaborador' }
  if (evaluadorId === evaluadoId) return { ok: false as const, error: 'Un colaborador no puede ser su propio par' }
  if (evaluadorId === sesion.colaboradorId) return { ok: false as const, error: 'El jefe no puede ser par: tu mirada ya entra como evaluación de jefe' }

  const [ciclo, evaluado, evaluador] = await Promise.all([
    prisma.ciclo.findUnique({ where: { id: cicloId } }),
    prisma.colaborador.findUnique({ where: { id: evaluadoId } }),
    prisma.colaborador.findUnique({ where: { id: evaluadorId } }),
  ])
  if (!ciclo || ciclo.estado !== 'ACTIVO') return { ok: false as const, error: 'El ciclo no está activo' }
  if (!evaluado || evaluado.jefeId !== sesion.colaboradorId) return { ok: false as const, error: 'Solo puedes nominar pares para tu equipo directo' }
  if (!evaluador || !evaluador.activo) return { ok: false as const, error: 'Par evaluador no válido' }

  // El par evaluador NO necesita participar del ciclo ni ser del país del ciclo: aporta su
  // mirada sobre un compañero, no recibe evaluación (altos mandos suelen tener a sus pares
  // reales en otro país). Solo se exige antigüedad mínima: con menos de 6 meses al inicio
  // del ciclo no observó suficiente para evaluar con justicia.
  if (excluidoPorAntiguedad(evaluador.fechaIngreso, ciclo.fechaInicio)) {
    return { ok: false as const, error: 'Ese colaborador tiene menos de 6 meses de antigüedad al inicio del ciclo: aún no puede evaluar como par' }
  }
  // Y el evaluado también debe participar (excluidos por antigüedad o retirados por rotación
  // no reciben evaluaciones: un PAR suelto les crearía una nota parcial)
  const evaluadoParticipa = await prisma.asignacion.findFirst({ where: { cicloId, evaluadoId, tipo: 'AUTO' }, select: { id: true } })
  if (!evaluadoParticipa) return { ok: false as const, error: 'Esa persona no participa de este ciclo: no puede recibir evaluaciones de par' }

  // Una evaluación de ese par ya invalidada por RR.HH. es registro terminal: re-nominarlo
  // reviviría un slot cerrado (el upsert sobre la unique lo despertaría en silencio).
  const previa = await prisma.asignacion.findUnique({
    where: { cicloId_evaluadorId_evaluadoId_tipo: { cicloId, evaluadorId, evaluadoId, tipo: 'PAR' } },
    select: { estado: true },
  })
  if (previa?.estado === 'INVALIDADA') return { ok: false as const, error: 'La evaluación de ese par fue invalidada en este ciclo y se conserva como registro: nomina a otra persona como par' }

  // Par del propio equipo → directo. De otro equipo (equipos chicos que trabajan juntos) →
  // queda como PROPUESTA: el par no ve la evaluación hasta que RR.HH. la apruebe.
  const esExterno = evaluador.jefeId !== sesion.colaboradorId
  await prisma.asignacion.upsert({
    where: { cicloId_evaluadorId_evaluadoId_tipo: { cicloId, evaluadorId, evaluadoId, tipo: 'PAR' } },
    create: { cicloId, evaluadorId, evaluadoId, tipo: 'PAR', estado: esExterno ? 'PROPUESTA' : 'PENDIENTE' },
    update: {},
  })
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: esExterno ? 'PAR_PROPUESTO' : 'PAR_ASIGNADO', entidad: cicloId, detalle: { evaluadorId, evaluadoId, por: 'jefe' } } })
  // Aviso al par (correo + push) SOLO si la asignación es nueva y quedó activa: una PROPUESTA
  // avisa recién al aprobarla RR.HH., y re-nominar al mismo par (upsert sin cambios) no re-avisa.
  if (!esExterno && !previa) {
    after(async () => {
      try {
        const r = await notificarParAsignado(cicloId, evaluadorId, evaluadoId)
        console.log(`[nominarPar] Aviso al par ${evaluadorId}: ${r.enviados} enviado(s)`)
      } catch (e) {
        console.error('[nominarPar] Falló el aviso al par (la asignación ya está hecha):', e)
      }
    })
  }
  revalidatePath('/equipo/evaluar')
  return { ok: true as const, propuesto: esExterno }
}

/** El jefe retira una nominación de par de su equipo (solo si el par aún no respondió). */
export async function quitarPar(cicloId: string, evaluadoId: string, evaluadorId: string) {
  const sesion = await requiereSesion()
  if (!sesion.colaboradorId) return { ok: false as const, error: 'Tu cuenta no está vinculada a un colaborador' }
  const [evaluado, asignacion] = await Promise.all([
    prisma.colaborador.findUnique({ where: { id: evaluadoId } }),
    prisma.asignacion.findUnique({ where: { cicloId_evaluadorId_evaluadoId_tipo: { cicloId, evaluadorId, evaluadoId, tipo: 'PAR' } } }),
  ])
  if (!evaluado || evaluado.jefeId !== sesion.colaboradorId) return { ok: false as const, error: 'Solo puedes gestionar los pares de tu equipo directo' }
  if (!asignacion) return { ok: false as const, error: 'La nominación no existe' }
  if (asignacion.estado === 'ENVIADA') return { ok: false as const, error: 'Ese par ya envió su evaluación: no se puede retirar' }
  if (asignacion.estado === 'INVALIDADA') return { ok: false as const, error: 'Esa evaluación fue invalidada por RR.HH.: se conserva como registro y no puede modificarse' }
  await prisma.asignacion.delete({ where: { id: asignacion.id } })
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'PAR_RETIRADO', entidad: cicloId, detalle: { evaluadorId, evaluadoId, por: 'jefe' } } })
  revalidatePath('/equipo/evaluar')
  return { ok: true as const }
}

/** Buscador server-side de candidatos a par (reemplaza el volcado del padrón completo al cliente).
 *  Devuelve ≤20 por término escrito: el padrón entero (~800) ya no viaja en el payload a los ~120
 *  jefes. La búsqueda barre toda la región a propósito —un par puede ser de otro país (manual
 *  Hunter)—, pero nunca materializa el padrón: solo lo que se escribe. */
export async function buscarCandidatosPar(cicloId: string, termino: string) {
  const sesion = await requiereSesion()
  if (!sesion.colaboradorId) return []
  const q = termino.trim()
  if (q.length < 2) return []
  const ciclo = await prisma.ciclo.findUnique({ where: { id: cicloId }, select: { estado: true, fechaInicio: true } })
  if (!ciclo || ciclo.estado !== 'ACTIVO') return []
  // Solo quien evalúa como JEFE en este ciclo nomina pares (nominarPar re-valida al escribir):
  // sin este guard, cualquier colaborador autenticado enumeraba el padrón regional — nombre,
  // puesto·área·país y líneas de reporte (esDeMiEquipo) — iterando términos de 2 letras.
  const esJefeDelCiclo = (await prisma.asignacion.count({
    where: { cicloId, evaluadorId: sesion.colaboradorId, tipo: 'JEFE' },
  })) > 0
  if (!esJefeDelCiclo) return []

  const filas = await prisma.colaborador.findMany({
    where: {
      activo: true,
      id: { not: sesion.colaboradorId },
      OR: [
        { nombres: { contains: q, mode: 'insensitive' } },
        { apellidos: { contains: q, mode: 'insensitive' } },
        { puesto: { is: { nombre: { contains: q, mode: 'insensitive' } } } },
      ],
    },
    select: {
      id: true, nombres: true, apellidos: true, jefeId: true, fechaIngreso: true,
      area: { select: { nombre: true } }, puesto: { select: { nombre: true } }, pais: { select: { codigo: true } },
    },
    orderBy: [{ apellidos: 'asc' }],
    take: 20,
  })
  return filas
    .filter((c) => !excluidoPorAntiguedad(c.fechaIngreso, ciclo.fechaInicio))
    .map((c) => ({
      id: c.id,
      nombre: `${c.nombres} ${c.apellidos}`,
      detalle: [c.puesto?.nombre, c.area?.nombre, c.pais.codigo].filter(Boolean).join(' · ') || undefined,
      esDeMiEquipo: c.jefeId === sesion.colaboradorId,
    }))
}
