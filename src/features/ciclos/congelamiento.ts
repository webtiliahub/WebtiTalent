import { prisma } from '@/shared/lib/prisma'

/** Un país con registro en CicloPaisCierre está CONGELADO en ese ciclo: sus resultados
 * quedaron tal como se cerraron/publicaron. NINGÚN camino debe alterarlos después —
 * ni enviar evaluaciones pendientes, ni recálculos, ni logros, ni conformidad
 * (mismo criterio que ya aplicaba la calibración). */
export async function paisCongelado(cicloId: string, paisId: string | null): Promise<boolean> {
  if (!paisId) return false
  const cierre = await prisma.cicloPaisCierre.findUnique({
    where: { cicloId_paisId: { cicloId, paisId } },
    select: { id: true },
  })
  return cierre !== null
}

/** Ids de países congelados de un ciclo (para excluirlos de recálculos masivos). */
export async function paisesCongelados(cicloId: string): Promise<Set<string>> {
  const cierres = await prisma.cicloPaisCierre.findMany({ where: { cicloId }, select: { paisId: true } })
  return new Set(cierres.map((c) => c.paisId))
}
