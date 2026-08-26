import { prisma } from '@/shared/lib/prisma'
import { perfilDeEvaluado } from '@/features/ciclos/perfil-evaluado'

export type ModalidadAsignacion = 'JEFE' | 'PAR' | 'ASCENDENTE' | 'AUTO'

type PuestoConCompetencias = { id: string; nivelId: string; competencias: { competenciaId: string }[] } | null

/** Cuestionario del evaluado en un ciclo.
 * Precedencia de alcance: si el ciclo incluyó una evaluación específica para SU PUESTO (excepción),
 * esa reemplaza por completo a la del nivel; si no, aplican las preguntas de su NIVEL.
 * Filtros: la modalidad de la asignación siempre; las competencias del puesto solo en JEFE/PAR/AUTO
 * (la ASCENDENTE es percepción del liderazgo del jefe y se responde tal como se configuró).
 *
 * Puesto, nivel y competencias salen del PERFIL CONGELADO al lanzar, no del maestro en vivo: si se
 * leyeran hoy, desmarcar una competencia a mitad de ciclo le quitaría preguntas a quien todavía no
 * ha respondido, y su nota se compararía con la de quien contestó el cuestionario completo. El
 * puesto que trae quien llama sirve de respaldo para los ciclos anteriores al snapshot. */
export async function preguntasParaAsignacion(
  cicloId: string,
  modalidad: ModalidadAsignacion,
  evaluado: { id: string; puesto: PuestoConCompetencias },
) {
  const perfil = await perfilDeEvaluado(cicloId, evaluado.id)
  if (!perfil.puestoId) return []
  const tieneExcepcion = (await prisma.cicloPregunta.count({ where: { cicloId, puestoId: perfil.puestoId } })) > 0
  if (!tieneExcepcion && !perfil.nivelId) return []
  const alcance = tieneExcepcion ? { puestoId: perfil.puestoId } : { nivelId: perfil.nivelId }
  const compIds = perfil.competenciaIds
  if (modalidad !== 'ASCENDENTE' && compIds.length === 0) return []
  return prisma.cicloPregunta.findMany({
    where: {
      cicloId, modalidad, ...alcance,
      pregunta: {
        is: {
          // Defensa contra snapshots sucios: la pregunta DEBE declarar la modalidad (el seed
          // original copió ítems «Mi jefe…» de ascendente a las 4 modalidades y contaminaba notas)
          modalidades: { has: modalidad },
          ...(modalidad === 'ASCENDENTE' ? {} : { competenciaId: { in: compIds } }),
        },
      },
    },
    include: { pregunta: { include: { competencia: { include: { dimension: true } } } } },
  })
}

/** Preguntas de potencial que responde el jefe sobre un evaluado: del snapshot del ciclo,
 * con la misma precedencia puesto > nivel. Ciclos lanzados antes de esta feature no tienen
 * snapshot: caen al set global activo (compatibilidad).
 *
 * El puesto y el nivel salen del PERFIL CONGELADO al lanzar (`perfilDeEvaluado`), igual que el
 * cuestionario de competencias: si se leyera el maestro en vivo, re-homologar un puesto a otro
 * nivel a mitad de ciclo cambiaría (o vaciaría) las preguntas de potencial de quien aún no
 * respondió, y el cálculo mezclaría sets de dos niveles. */
export async function preguntasPotencialParaAsignacion(cicloId: string, evaluadoId: string) {
  const haySnapshot = (await prisma.cicloPreguntaPotencial.count({ where: { cicloId } })) > 0
  if (!haySnapshot) {
    return prisma.preguntaPotencial.findMany({ where: { activa: true }, orderBy: { orden: 'asc' } })
  }
  const perfil = await perfilDeEvaluado(cicloId, evaluadoId)
  if (!perfil.puestoId) return []
  const tieneExcepcion = (await prisma.cicloPreguntaPotencial.count({ where: { cicloId, puestoId: perfil.puestoId } })) > 0
  if (!tieneExcepcion && !perfil.nivelId) return []
  const alcance = tieneExcepcion ? { puestoId: perfil.puestoId } : { nivelId: perfil.nivelId }
  const filas = await prisma.cicloPreguntaPotencial.findMany({
    where: { cicloId, ...alcance },
    include: { preguntaPotencial: true },
  })
  return filas.map((f) => f.preguntaPotencial).sort((a, b) => a.orden - b.orden)
}
