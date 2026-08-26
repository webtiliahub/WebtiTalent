'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin, fueraDeAlcancePais } from '@/shared/lib/permisos'
import { calcularResultado } from '@/features/resultados/servicio'
import { paisCongelado } from '@/features/ciclos/congelamiento'
import { excluidoPorAntiguedad } from '@/domain/antiguedad'

type Resp = { ok: true } | { ok: false; error: string }

/** Retira a un colaborador (baja o caso excepcional) de un ciclo ACTIVO.
 * - conservarNota=false: cancela TODAS sus asignaciones como evaluado (aun las respondidas)
 *   y sus pendientes como evaluador; borra su resultado. No genera nota.
 * - conservarNota=true (registro de salida): cancela solo lo PENDIENTE (suyo y sobre él),
 *   conserva lo ya respondido y calcula su nota con lo que existe (el motor renormaliza).
 * Lo respondido POR él sobre otros se conserva siempre: observó el período. */
export async function retirarDelCiclo(cicloId: string, colaboradorId: string, conservarNota: boolean): Promise<Resp> {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  const [ciclo, colaborador] = await Promise.all([
    prisma.ciclo.findUnique({ where: { id: cicloId }, select: { estado: true, nombre: true } }),
    prisma.colaborador.findUnique({ where: { id: colaboradorId }, select: { paisId: true, nombres: true, apellidos: true } }),
  ])
  if (!ciclo || ciclo.estado !== 'ACTIVO') return { ok: false, error: 'El ciclo no está activo' }
  if (!colaborador) return { ok: false, error: 'Colaborador no encontrado' }
  if (fueraDeAlcancePais(sesion, colaborador.paisId)) return { ok: false, error: 'Ese colaborador está fuera de tu país' }
  if (await paisCongelado(cicloId, colaborador.paisId)) return { ok: false, error: 'El país del evaluado ya cerró este ciclo: su resultado quedó congelado' }

  const borradas = await prisma.$transaction(async (tx) => {
    const comoEvaluado = await tx.asignacion.deleteMany({
      where: conservarNota
        ? { cicloId, evaluadoId: colaboradorId, estado: { notIn: ['ENVIADA', 'INVALIDADA'] } }
        : { cicloId, evaluadoId: colaboradorId },
    })
    const comoEvaluador = await tx.asignacion.deleteMany({
      where: { cicloId, evaluadorId: colaboradorId, estado: { notIn: ['ENVIADA', 'INVALIDADA'] } },
    })
    if (!conservarNota) await tx.resultado.deleteMany({ where: { cicloId, colaboradorId } })
    return comoEvaluado.count + comoEvaluador.count
  })
  if (conservarNota) await calcularResultado(cicloId, colaboradorId)

  await prisma.auditLog.create({
    data: {
      usuarioId: sesion.id,
      accion: 'CICLO_ROTACION_RETIRO',
      entidad: cicloId,
      detalle: {
        colaborador: `${colaborador.nombres} ${colaborador.apellidos}`,
        conservarNota,
        asignacionesCanceladas: borradas,
      },
    },
  })
  revalidatePath(`/admin/ciclos/${cicloId}`)
  return { ok: true }
}

/** Reasigna una evaluación PENDIENTE a otro evaluador (rotación: el jefe cambió o salió).
 * Los borradores del evaluador anterior se descartan: el nuevo responde desde cero. */
export async function reasignarEvaluador(asignacionId: string, nuevoEvaluadorId: string): Promise<Resp> {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  const asignacion = await prisma.asignacion.findUnique({
    where: { id: asignacionId },
    include: {
      ciclo: { select: { estado: true, fechaInicio: true } },
      evaluado: { select: { id: true, paisId: true, nombres: true, apellidos: true } },
      evaluador: { select: { nombres: true, apellidos: true } },
    },
  })
  if (!asignacion) return { ok: false, error: 'Evaluación no encontrada' }
  if (asignacion.ciclo.estado !== 'ACTIVO') return { ok: false, error: 'El ciclo no está activo' }
  if (asignacion.estado === 'ENVIADA') return { ok: false, error: 'Esa evaluación ya fue respondida: se conserva como registro' }
  if (asignacion.estado === 'INVALIDADA') return { ok: false, error: 'Esa evaluación fue invalidada por RR.HH.: se conserva como registro y no puede modificarse' }
  if (fueraDeAlcancePais(sesion, asignacion.evaluado.paisId)) return { ok: false, error: 'Ese colaborador está fuera de tu país' }
  if (await paisCongelado(asignacion.cicloId, asignacion.evaluado.paisId)) return { ok: false, error: 'El país del evaluado ya cerró este ciclo: su resultado quedó congelado' }
  if (nuevoEvaluadorId === asignacion.evaluado.id) return { ok: false, error: 'El evaluador no puede ser el propio evaluado' }
  const nuevo = await prisma.colaborador.findUnique({ where: { id: nuevoEvaluadorId }, select: { activo: true, nombres: true, apellidos: true, fechaIngreso: true } })
  if (!nuevo || !nuevo.activo) return { ok: false, error: 'El nuevo evaluador no existe o está inactivo' }
  if (excluidoPorAntiguedad(nuevo.fechaIngreso, asignacion.ciclo.fechaInicio)) return { ok: false, error: 'Ese colaborador tiene menos de 6 meses de antigüedad al inicio del ciclo: aún no puede evaluar' }

  // Si el nuevo evaluador YA tiene esta misma evaluación (p. ej. el jefe actual ya fue asignado
  // al lanzar), no hay nada que trasladar: la huérfana se cancela y queda la suya.
  const existente = await prisma.asignacion.findUnique({
    where: {
      cicloId_evaluadorId_evaluadoId_tipo: {
        cicloId: asignacion.cicloId,
        evaluadorId: nuevoEvaluadorId,
        evaluadoId: asignacion.evaluado.id,
        tipo: asignacion.tipo,
      },
    },
    select: { id: true },
  })

  await prisma.$transaction([
    ...(existente
      ? [prisma.asignacion.delete({ where: { id: asignacionId } })]
      : [
          prisma.respuesta.deleteMany({ where: { asignacionId } }),
          prisma.respuestaPotencial.deleteMany({ where: { asignacionId } }),
          prisma.asignacion.update({ where: { id: asignacionId }, data: { evaluadorId: nuevoEvaluadorId, estado: 'PENDIENTE' } }),
        ]),
    prisma.auditLog.create({
      data: {
        usuarioId: sesion.id,
        accion: 'CICLO_ROTACION_REASIGNACION',
        entidad: asignacionId,
        detalle: {
          evaluado: `${asignacion.evaluado.nombres} ${asignacion.evaluado.apellidos}`,
          tipo: asignacion.tipo,
          antes: `${asignacion.evaluador.nombres} ${asignacion.evaluador.apellidos}`,
          despues: `${nuevo.nombres} ${nuevo.apellidos}`,
          ...(existente ? { nota: 'el nuevo evaluador ya tenía esta evaluación: la huérfana se canceló' } : {}),
        },
      },
    }),
  ])
  revalidatePath(`/admin/ciclos/${asignacion.cicloId}`)
  return { ok: true }
}

/** Cancela una evaluación PENDIENTE con motivo («no aplica»: rotación, sesgo, ya nadie
 * puede o debe responderla). La nota del evaluado se renormaliza sin esa modalidad. */
export async function cancelarAsignacion(asignacionId: string, motivo: string): Promise<Resp> {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  const limpio = motivo.trim()
  if (limpio.length < 10) return { ok: false, error: 'Explica el motivo (mínimo 10 caracteres): queda en el log de auditoría' }
  if (limpio.length > 2000) return { ok: false, error: 'El motivo supera los 2000 caracteres' }

  const asignacion = await prisma.asignacion.findUnique({
    where: { id: asignacionId },
    include: {
      ciclo: { select: { estado: true } },
      evaluado: { select: { paisId: true, nombres: true, apellidos: true } },
      evaluador: { select: { nombres: true, apellidos: true } },
    },
  })
  if (!asignacion) return { ok: false, error: 'Evaluación no encontrada' }
  if (asignacion.ciclo.estado !== 'ACTIVO') return { ok: false, error: 'El ciclo no está activo' }
  if (asignacion.estado === 'ENVIADA') return { ok: false, error: 'Esa evaluación ya fue respondida: se conserva como registro' }
  if (asignacion.estado === 'INVALIDADA') return { ok: false, error: 'Esa evaluación fue invalidada por RR.HH.: se conserva como registro y no puede modificarse' }
  if (fueraDeAlcancePais(sesion, asignacion.evaluado.paisId)) return { ok: false, error: 'Ese colaborador está fuera de tu país' }
  if (await paisCongelado(asignacion.cicloId, asignacion.evaluado.paisId)) return { ok: false, error: 'El país del evaluado ya cerró este ciclo: su resultado quedó congelado' }

  await prisma.$transaction([
    prisma.asignacion.delete({ where: { id: asignacionId } }),
    prisma.auditLog.create({
      data: {
        usuarioId: sesion.id,
        accion: 'CICLO_ROTACION_CANCELACION',
        entidad: asignacionId,
        detalle: {
          evaluado: `${asignacion.evaluado.nombres} ${asignacion.evaluado.apellidos}`,
          evaluador: `${asignacion.evaluador.nombres} ${asignacion.evaluador.apellidos}`,
          tipo: asignacion.tipo,
          motivo: limpio,
        },
      },
    }),
  ])
  revalidatePath(`/admin/ciclos/${asignacion.cicloId}`)
  return { ok: true }
}

/** Invalida una evaluación de PAR ya ENVIADA al resolver un incidente: si al evaluado le
 * queda un solo par activo, esa única voz introduce sesgo (y compromete el anonimato).
 * Las respuestas se CONSERVAN como registro, pero la evaluación sale de la nota, de los
 * contadores y del slot (puede nominarse un par de reemplazo). Motivo auditado. */
export async function invalidarEvaluacion(asignacionId: string, motivo: string): Promise<Resp> {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  const limpio = motivo.trim()
  if (limpio.length < 10) return { ok: false, error: 'Explica el motivo (mínimo 10 caracteres): queda en el log de auditoría' }
  if (limpio.length > 2000) return { ok: false, error: 'El motivo supera los 2000 caracteres' }

  const asignacion = await prisma.asignacion.findUnique({
    where: { id: asignacionId },
    include: {
      ciclo: { select: { estado: true } },
      evaluado: { select: { id: true, paisId: true, nombres: true, apellidos: true } },
      evaluador: { select: { nombres: true, apellidos: true } },
    },
  })
  if (!asignacion) return { ok: false, error: 'Evaluación no encontrada' }
  if (asignacion.tipo !== 'PAR') return { ok: false, error: 'Solo se invalidan evaluaciones de pares: las demás modalidades se reasignan o se cancelan' }
  if (asignacion.estado !== 'ENVIADA') return { ok: false, error: 'Solo se invalida una evaluación ya respondida: una pendiente se cancela o reasigna' }
  if (asignacion.ciclo.estado !== 'ACTIVO') return { ok: false, error: 'El ciclo no está activo' }
  if (fueraDeAlcancePais(sesion, asignacion.evaluado.paisId)) return { ok: false, error: 'Ese colaborador está fuera de tu país' }
  if (await paisCongelado(asignacion.cicloId, asignacion.evaluado.paisId)) {
    return { ok: false, error: 'El país del evaluado ya cerró este ciclo: su resultado quedó congelado' }
  }

  await prisma.$transaction([
    prisma.asignacion.update({ where: { id: asignacionId }, data: { estado: 'INVALIDADA' } }),
    prisma.auditLog.create({
      data: {
        usuarioId: sesion.id,
        accion: 'EVALUACION_INVALIDADA',
        entidad: asignacion.cicloId,
        detalle: {
          evaluado: `${asignacion.evaluado.nombres} ${asignacion.evaluado.apellidos}`,
          evaluador: `${asignacion.evaluador.nombres} ${asignacion.evaluador.apellidos}`,
          tipo: asignacion.tipo,
          motivo: limpio,
        },
      },
    }),
  ])
  // La nota del evaluado se recalcula sin esa voz (el motor solo consume ENVIADAS)
  await calcularResultado(asignacion.cicloId, asignacion.evaluado.id)
  revalidatePath(`/admin/ciclos/${asignacion.cicloId}`)
  return { ok: true }
}

/** Revierte una invalidación MIENTRAS EL CICLO SIGUE ACTIVO y el país del evaluado no
 * cerró: las respuestas se conservaron como registro, así que rehabilitarla es devolverla
 * a ENVIADA — vuelve a contar en la nota, en los contadores y en el slot. Tras el cierre
 * del país la invalidación queda definitiva (resultados congelados). */
export async function revertirInvalidacion(asignacionId: string): Promise<Resp> {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  const asignacion = await prisma.asignacion.findUnique({
    where: { id: asignacionId },
    include: {
      ciclo: { select: { estado: true } },
      evaluado: { select: { id: true, paisId: true, nombres: true, apellidos: true } },
      evaluador: { select: { nombres: true, apellidos: true } },
    },
  })
  if (!asignacion) return { ok: false, error: 'Evaluación no encontrada' }
  if (asignacion.estado !== 'INVALIDADA') return { ok: false, error: 'Esa evaluación no está invalidada' }
  if (asignacion.ciclo.estado !== 'ACTIVO') return { ok: false, error: 'El ciclo no está activo: la invalidación quedó definitiva' }
  if (fueraDeAlcancePais(sesion, asignacion.evaluado.paisId)) return { ok: false, error: 'Ese colaborador está fuera de tu país' }
  if (await paisCongelado(asignacion.cicloId, asignacion.evaluado.paisId)) {
    return { ok: false, error: 'El país del evaluado ya cerró este ciclo: la invalidación quedó definitiva' }
  }

  await prisma.$transaction([
    prisma.asignacion.update({ where: { id: asignacionId }, data: { estado: 'ENVIADA' } }),
    prisma.auditLog.create({
      data: {
        usuarioId: sesion.id,
        accion: 'EVALUACION_REHABILITADA',
        entidad: asignacion.cicloId,
        detalle: {
          evaluado: `${asignacion.evaluado.nombres} ${asignacion.evaluado.apellidos}`,
          evaluador: `${asignacion.evaluador.nombres} ${asignacion.evaluador.apellidos}`,
          tipo: asignacion.tipo,
        },
      },
    }),
  ])
  // La voz rehabilitada vuelve a entrar a la nota del evaluado
  await calcularResultado(asignacion.cicloId, asignacion.evaluado.id)
  revalidatePath(`/admin/ciclos/${asignacion.cicloId}`)
  return { ok: true }
}
