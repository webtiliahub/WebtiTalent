import { prisma } from '@/shared/lib/prisma'
import { resolverAlcance, type FocoCiclo, type AjustesCiclo } from '@/features/ciclos/alcance'

/** Alcance del período de objetivos: mismo resolutor que los ciclos pero SIN regla de
 * antigüedad (fechaInicio null). ÚNICA fuente de verdad de «a quién aplica el período» —
 * la consumen apertura, guards de carga, cobertura, recordatorios, vistas y export. */

export type PeriodoConAlcance = {
  focoPaisIds: string[]
  focoAreaIds: string[]
  focoNivelIds: string[]
  incluirIds: string[]
  excluirIds: string[]
}

export function focoDe(p: PeriodoConAlcance): FocoCiclo {
  return { focoPaisIds: p.focoPaisIds, focoAreaIds: p.focoAreaIds, focoNivelIds: p.focoNivelIds }
}
export function ajustesDe(p: PeriodoConAlcance): AjustesCiclo {
  return { incluirIds: p.incluirIds, excluirIds: p.excluirIds }
}

/** ¿Este colaborador está en el alcance del período? (puro, para guards puntuales) */
export function estaEnAlcancePeriodo(
  periodo: PeriodoConAlcance,
  c: { id: string; activo: boolean; paisId: string; areaId: string | null; nivelId: string | null },
): boolean {
  const r = resolverAlcance([{ ...c, fechaIngreso: null }], focoDe(periodo), ajustesDe(periodo), null)
  return r.evaluados.length === 1
}

export type ColaboradorPeriodo = {
  id: string; nombres: string; apellidos: string
  paisId: string; areaId: string | null; puestoId: string | null; nivelId: string | null
  jefeId: string | null
}

/** Colaboradores ACTIVOS dentro del alcance del período (para cobertura, apertura, recordatorios). */
export async function colaboradoresDelPeriodo(periodo: PeriodoConAlcance): Promise<ColaboradorPeriodo[]> {
  const activos = await prisma.colaborador.findMany({
    where: { activo: true },
    select: {
      id: true, nombres: true, apellidos: true, activo: true, fechaIngreso: true,
      paisId: true, areaId: true, puestoId: true, jefeId: true,
      puesto: { select: { nivelId: true } },
    },
  })
  const enriquecidos = activos.map((c) => ({ ...c, nivelId: c.puesto?.nivelId ?? null }))
  return resolverAlcance(enriquecidos, focoDe(periodo), ajustesDe(periodo), null).evaluados
}
