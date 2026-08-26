import { prisma } from '@/shared/lib/prisma'

/**
 * Lectura del perfil de evaluación de un participante: el puesto, el nivel, las competencias y
 * los pesos por dimensión con los que se le evalúa en ESE ciclo.
 *
 * La fuente es el snapshot que `lanzarCiclo` congela (`CicloPerfilEvaluado`). Los ciclos lanzados
 * antes de que existiera no tienen fila, así que se cae al maestro de puestos EN VIVO — que es
 * como funcionaba todo hasta ahora, y lo que esos ciclos han usado siempre. Mismo criterio que
 * `preguntasPotencialParaAsignacion` con su propio snapshot.
 */

export type PesoDimension = { dimensionId: string; peso: number; puntajeEsperado: number }

export type PerfilEvaluado = {
  puestoId: string | null
  nivelId: string | null
  competenciaIds: string[]
  pesos: PesoDimension[]
  /** false = no había snapshot y se leyó el maestro (ciclo anterior a esta funcionalidad). */
  congelado: boolean
}

/** El JSON viene de la base: se valida campo a campo antes de que llegue a un cálculo de notas. */
function pesosDe(json: unknown): PesoDimension[] {
  if (!Array.isArray(json)) return []
  const vistas = new Set<string>()
  return json.flatMap((p) => {
    const o = p as Partial<PesoDimension>
    // Defensa en profundidad: el snapshot ya está escrito, así que aquí se descartan también los
    // valores fuera de rango y las dimensiones repetidas, no solo los de tipo incorrecto
    if (typeof o?.dimensionId !== 'string' || vistas.has(o.dimensionId)) return []
    if (typeof o?.peso !== 'number' || !Number.isFinite(o.peso) || o.peso < 0 || o.peso > 100) return []
    if (typeof o?.puntajeEsperado !== 'number' || !Number.isFinite(o.puntajeEsperado)) return []
    vistas.add(o.dimensionId)
    return [{ dimensionId: o.dimensionId, peso: o.peso, puntajeEsperado: o.puntajeEsperado }]
  })
}

type PuestoEnVivo = {
  id: string
  nivelId: string
  competencias: { competenciaId: string }[]
  pesos: { dimensionId: string; peso: number; puntajeEsperado: number }[]
} | null

const SELECT_PUESTO_EN_VIVO = {
  id: true, nivelId: true,
  competencias: { select: { competenciaId: true } },
  pesos: { select: { dimensionId: true, peso: true, puntajeEsperado: true } },
} as const

function delMaestro(puesto: PuestoEnVivo): PerfilEvaluado {
  return {
    puestoId: puesto?.id ?? null,
    nivelId: puesto?.nivelId ?? null,
    competenciaIds: puesto?.competencias.map((c) => c.competenciaId) ?? [],
    pesos: puesto?.pesos.map((p) => ({ dimensionId: p.dimensionId, peso: p.peso, puntajeEsperado: p.puntajeEsperado })) ?? [],
    congelado: false,
  }
}

/** Perfil de UN participante.
 *
 * Cuando no hay snapshot, el puesto en vivo se consulta AQUÍ y completo, aunque quien llama ya
 * tenga uno cargado: aceptar un puesto por parámetro invitaba a pasarlo a medias («yo solo
 * necesito las competencias») y ese perfil incompleto acababa en un cálculo de notas, donde unos
 * pesos vacíos no fallan — se convierten en un promedio simple. Una consulta más en los ciclos
 * viejos vale más que ese riesgo. */
export async function perfilDeEvaluado(cicloId: string, colaboradorId: string): Promise<PerfilEvaluado> {
  const fila = await prisma.cicloPerfilEvaluado.findUnique({
    where: { cicloId_colaboradorId: { cicloId, colaboradorId } },
    select: { puestoId: true, nivelId: true, competenciaIds: true, pesosJson: true },
  })
  if (fila) {
    return {
      puestoId: fila.puestoId,
      nivelId: fila.nivelId,
      competenciaIds: fila.competenciaIds,
      pesos: pesosDe(fila.pesosJson),
      congelado: true,
    }
  }
  const col = await prisma.colaborador.findUnique({
    where: { id: colaboradorId },
    select: { puesto: { select: SELECT_PUESTO_EN_VIVO } },
  })
  return delMaestro(col?.puesto ?? null)
}

/** Perfiles de VARIOS participantes: una consulta para los snapshots y otra para los que falten
 *  (ciclos viejos). Para las vistas que recorren a todo el ciclo — análisis, comparativa, cierre. */
export async function perfilesDeEvaluados(cicloId: string, colaboradorIds: string[]): Promise<Map<string, PerfilEvaluado>> {
  const mapa = new Map<string, PerfilEvaluado>()
  if (colaboradorIds.length === 0) return mapa
  const filas = await prisma.cicloPerfilEvaluado.findMany({
    where: { cicloId, colaboradorId: { in: colaboradorIds } },
    select: { colaboradorId: true, puestoId: true, nivelId: true, competenciaIds: true, pesosJson: true },
  })
  for (const f of filas) {
    mapa.set(f.colaboradorId, {
      puestoId: f.puestoId, nivelId: f.nivelId, competenciaIds: f.competenciaIds,
      pesos: pesosDe(f.pesosJson), congelado: true,
    })
  }
  const sinSnapshot = colaboradorIds.filter((id) => !mapa.has(id))
  if (sinSnapshot.length > 0) {
    const cols = await prisma.colaborador.findMany({
      where: { id: { in: sinSnapshot } },
      select: { id: true, puesto: { select: SELECT_PUESTO_EN_VIVO } },
    })
    for (const c of cols) mapa.set(c.id, delMaestro(c.puesto))
  }
  return mapa
}

/** Perfil esperado (puntaje esperado por dimensión) de cada participante de un ciclo, para el
 *  punteado del radar y del informe: Map colaboradorId → { dimensionId: puntajeEsperado }.
 *  Sale del snapshot, así que el informe de un ciclo cerrado sigue mostrando la expectativa que
 *  regía entonces, aunque el puesto se haya reperfilado después. */
export async function perfilesEsperadosDeCiclo(cicloId: string, colaboradorIds: string[]): Promise<Map<string, Record<string, number>>> {
  const perfiles = await perfilesDeEvaluados(cicloId, colaboradorIds)
  const out = new Map<string, Record<string, number>>()
  for (const [colaboradorId, perfil] of perfiles) {
    const porDim: Record<string, number> = {}
    for (const peso of perfil.pesos) porDim[peso.dimensionId] = peso.puntajeEsperado
    out.set(colaboradorId, porDim)
  }
  return out
}
