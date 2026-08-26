'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/shared/lib/prisma'
import { requiereSesion, fueraDeAlcancePais } from '@/shared/lib/permisos'
import { paisCongelado } from '@/features/ciclos/congelamiento'

/**
 * Registra/actualiza la sesión de feedback y el PDI de un colaborador en un ciclo.
 * El jefe directo (o RR.HH.) registra todo; el propio colaborador puede editar los acuerdos.
 */
/* El payload llega por la red: los tipos de TypeScript no existen en ejecución, así que sin
   validar aquí no había NINGÚN tope. Un colaborador podía guardar 50 MB de «acuerdos» en una fila
   —los campos son TEXT en Postgres, sin límite— o 200.000 entradas de PDI en un JSON, con la
   factura de almacenamiento y la caída de toda página que lea ese registro. Los topes son
   holgados: un acta de feedback real ronda los cientos de caracteres. */
const esquemaFeedback = z.object({
  cicloId: z.string().min(1).max(60),
  colaboradorId: z.string().min(1).max(60),
  acuerdos: z.string().max(5000),
  pdi: z.array(z.object({
    titulo: z.string().max(300),
    fechaObjetivo: z.string().max(30).optional(),
  })).max(30),
})

export async function guardarFeedback(entrada: {
  cicloId: string
  colaboradorId: string
  acuerdos: string
  pdi: { titulo: string; fechaObjetivo?: string }[]
}) {
  const validado = esquemaFeedback.safeParse(entrada)
  if (!validado.success) {
    return { ok: false as const, error: 'El acta de feedback excede los límites permitidos: revisa el texto de los acuerdos y del plan de desarrollo' }
  }
  const payload = validado.data
  const sesion = await requiereSesion()
  const colaborador = await prisma.colaborador.findUnique({ where: { id: payload.colaboradorId } })
  if (!colaborador) return { ok: false as const, error: 'Colaborador no encontrado' }

  const esJefeDirecto = colaborador.jefeId === sesion.colaboradorId
  // RR.HH. de país solo cubre a colaboradores de su país
  const esRrhh = sesion.rol === 'RRHH' && !fueraDeAlcancePais(sesion, colaborador.paisId)
  const esElMismo = colaborador.id === sesion.colaboradorId
  if (!esJefeDirecto && !esRrhh && !esElMismo) return { ok: false as const, error: 'Sin permiso para registrar este feedback' }

  // El acta se CONGELA con el cierre (mismo criterio que la nota): ciclo cerrado o país
  // cerrado → registro inmutable. Los desafíos de desarrollo viven en la carga de objetivos
  // del siguiente período (recomendados del PDI).
  const ciclo = await prisma.ciclo.findUnique({ where: { id: payload.cicloId }, select: { estado: true } })
  if (!ciclo) return { ok: false as const, error: 'Ciclo no encontrado' }
  if (ciclo.estado !== 'ACTIVO' || (await paisCongelado(payload.cicloId, colaborador.paisId))) {
    return { ok: false as const, error: 'El ciclo ya cerró para este colaborador: la sesión de feedback y el PDI quedaron como registro y no pueden editarse' }
  }

  // El feedback conversa SOBRE los resultados: sin ninguna nota calculada aún, no hay
  // nada que retroalimentar (mismo criterio que el gate de la página de resultados)
  const resultado = await prisma.resultado.findUnique({
    where: { cicloId_colaboradorId: { cicloId: payload.cicloId, colaboradorId: payload.colaboradorId } },
    select: { notaFinal: true, notaCalibrada: true, notaCompetencias: true, cumplimientoObjetivos: true },
  })
  const hayResultados = Boolean(resultado && (resultado.notaFinal != null || resultado.notaCalibrada != null || resultado.notaCompetencias != null || resultado.cumplimientoObjetivos != null))
  if (!hayResultados) {
    return { ok: false as const, error: 'Este colaborador aún no tiene resultados de evaluación en el ciclo: el feedback se habilita cuando exista una nota que conversar' }
  }

  const pdiLimpio = payload.pdi.filter((a) => a.titulo.trim().length > 0).map((a) => ({ titulo: a.titulo.trim(), fechaObjetivo: a.fechaObjetivo ?? null }))

  await prisma.feedback.upsert({
    where: { cicloId_colaboradorId: { cicloId: payload.cicloId, colaboradorId: payload.colaboradorId } },
    create: {
      cicloId: payload.cicloId,
      colaboradorId: payload.colaboradorId,
      acuerdos: payload.acuerdos.trim() || null,
      pdi: esElMismo && !esJefeDirecto && !esRrhh ? [] : pdiLimpio,
    },
    update: esElMismo && !esJefeDirecto && !esRrhh
      ? { acuerdos: payload.acuerdos.trim() || null } // el colaborador solo edita acuerdos
      : { acuerdos: payload.acuerdos.trim() || null, pdi: pdiLimpio },
  })

  revalidatePath('/equipo/resultados')
  revalidatePath('/mi-resultado')
  return { ok: true as const }
}
