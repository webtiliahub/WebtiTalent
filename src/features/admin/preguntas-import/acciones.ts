'use server'

import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin } from '@/shared/lib/permisos'
import { revalidatePath } from 'next/cache'
import { parseBancoPreguntas } from './parser'
import { planificarBanco, normTexto } from './plan'
import type { PlanBanco, SnapshotBanco } from './plan'

/** Acción de importación del banco de preguntas: dos pasos (simular / aplicar), igual espíritu
 * que `importarPadron`/`importarMaestro`. Solo altas — nunca edita ni borra preguntas existentes. */
export type ResultadoBanco = { ok: true; plan: PlanBanco; aplicado: boolean } | { ok: false; error: string }

export async function importarBancoPreguntas(formData: FormData, aplicar: boolean): Promise<ResultadoBanco> {
  const sesion = await requiereAdmin('EVALUACIONES', 'GESTIONAR')
  const archivo = formData.get('archivo')
  if (!(archivo instanceof File)) return { ok: false, error: 'No se recibió el archivo.' }
  if (archivo.size > 10 * 1024 * 1024) return { ok: false, error: 'El archivo supera los 10 MB.' }

  const parseado = parseBancoPreguntas(await archivo.arrayBuffer())

  const [dims, comps, preguntas, potencial] = await Promise.all([
    prisma.dimension.findMany({ select: { nombre: true } }),
    prisma.competencia.findMany({ select: { nombre: true, dimension: { select: { nombre: true } } } }),
    prisma.pregunta.findMany({ select: { id: true, texto: true, descriptores: true, competencia: { select: { nombre: true } } } }),
    prisma.preguntaPotencial.findMany({ select: { id: true, texto: true, descriptores: true } }),
  ])
  // IMPORTANTE: usar la MISMA normalización que plan.ts (normTexto exportado desde ./plan) para
  // construir el snapshot — si difiere, el dedup contra la BD falla en silencio y recrea duplicados.
  const bd: SnapshotBanco = {
    dimensiones: dims,
    competencias: comps.map((c) => ({ nombre: c.nombre, dimensionNombre: c.dimension.nombre })),
    preguntasExistentes: preguntas.map((p) => ({ id: p.id, competenciaNombre: p.competencia.nombre, textoNorm: normTexto(p.texto), descriptores: p.descriptores })),
    potencialExistentes: potencial.map((p) => ({ id: p.id, textoNorm: normTexto(p.texto), descriptores: p.descriptores })),
  }
  const plan = planificarBanco(parseado, bd)

  if (!aplicar || plan.errores.length > 0) return { ok: true, plan, aplicado: false }

  const idComp = new Map((await prisma.competencia.findMany({ select: { id: true, nombre: true } })).map((c) => [c.nombre, c.id]))
  const maxPot = (await prisma.preguntaPotencial.aggregate({ _max: { orden: true } }))._max.orden ?? 0

  await prisma.$transaction(async (tx) => {
    if (plan.competenciasNuevas.length > 0) {
      await tx.pregunta.createMany({
        data: plan.competenciasNuevas.map((p) => ({ texto: p.texto, competenciaId: idComp.get(p.competencia)!, modalidades: p.modalidades, descriptores: p.descriptores })),
      })
    }
    for (const p of plan.descriptoresActualizar) {
      await tx.pregunta.update({ where: { id: p.preguntaId }, data: { descriptores: p.descriptores } })
    }
    let orden = maxPot
    for (const p of plan.potencialNuevas) {
      orden += 1
      await tx.preguntaPotencial.create({ data: { texto: p.texto, orden, descriptores: p.descriptores } })
    }
    for (const p of plan.potencialActualizar) {
      await tx.preguntaPotencial.update({ where: { id: p.preguntaPotencialId }, data: { descriptores: p.descriptores } })
    }
    await tx.auditLog.create({
      data: {
        usuarioId: sesion.id,
        accion: 'BANCO_PREGUNTAS_IMPORTADO',
        detalle: { archivo: archivo.name, competencias: plan.competenciasNuevas.length, descriptoresActualizados: plan.descriptoresActualizar.length + plan.potencialActualizar.length, potencial: plan.potencialNuevas.length },
      },
    })
  })
  revalidatePath('/admin/preguntas')
  return { ok: true, plan, aplicado: true }
}
