import { media, histograma, mediana, desviacion, curvaNormal } from '@/domain/estadistica'
import { prisma } from '@/shared/lib/prisma'
import type { DimensionResultado } from './servicio'
import { perfilesEsperadosDeCiclo } from '@/features/ciclos/perfil-evaluado'

/** Vista comparativa (spec 2026-08-07): dos grupos país+área frente a frente.
 * Esta mitad del módulo es PURA (testeable sin BD); comparacionCiclo (abajo,
 * Task 3) hace las consultas. */

export type Grupo = { paisId: string; areaId?: string }

export function nombreGrupo(pais: string, area: string | null): string {
  return area ? `${pais} · ${area}` : `${pais} (todas las áreas)`
}

/** Esperado del corte por dimensión: promedio del puntajeEsperado del puesto de cada
 * evaluado. Sin puesto, o puesto que no define la dimensión, no aporta a esa dimensión. */
export function esperadoDeCorte(
  // Una clave por evaluado del corte (hoy su colaboradorId; se repite si dos comparten perfil)
  claves: (string | null)[],
  perfilPorClave: Map<string, Record<string, number>>,
  dimensionIds: string[],
): (number | null)[] {
  return dimensionIds.map((dimId) => {
    const vals: number[] = []
    for (const clave of claves) {
      if (!clave) continue
      const v = perfilPorClave.get(clave)?.[dimId]
      if (v !== undefined) vals.push(v)
    }
    return media(vals)
  })
}

export type PersonaBin = { nombre: string; nota: number; grupo: 'A' | 'B' }

/** Bins apilados A/B sobre la grilla estándar (1–5, ancho 0.5) + personas por bin
 * con su grupo (ordenadas por nota desc, para el panel del clic). */
export function binsApilados(
  a: { nombre: string; nota: number }[],
  b: { nombre: string; nota: number }[],
): { bins: { desde: number; hasta: number; nA: number; nB: number }[]; personasPorBin: PersonaBin[][] } {
  const bins = histograma([]).map(({ desde, hasta }) => ({ desde, hasta, nA: 0, nB: 0 }))
  const personasPorBin: PersonaBin[][] = bins.map(() => [])
  const meter = (lista: { nombre: string; nota: number }[], grupo: 'A' | 'B') => {
    for (const p of lista) {
      const i = Math.min(bins.length - 1, Math.max(0, Math.floor((p.nota - 1) / 0.5)))
      if (grupo === 'A') bins[i].nA += 1
      else bins[i].nB += 1
      personasPorBin[i].push({ nombre: p.nombre, nota: Number(p.nota.toFixed(2)), grupo })
    }
  }
  meter(a, 'A')
  meter(b, 'B')
  for (const lista of personasPorBin) lista.sort((x, y) => y.nota - x.nota)
  return { bins, personasPorBin }
}

/** Valida los grupos de la URL contra el alcance del observador. null = la comparación
 * no puede activarse (parámetro inválido o fuera de alcance) y la página cae a vista
 * normal. El país es el TECHO: sin alcance REGIONAL, ambos lados deben ser su país. */
export function validarGrupos(
  params: { aPais?: string; aArea?: string; bPais?: string; bArea?: string },
  ctx: { esRegional: boolean; paisSesionId: string | null; paisesValidos: Set<string>; areasValidas: Set<string> },
): { grupoA: Grupo; grupoB: Grupo; identicos: boolean } | null {
  const lado = (pais?: string, area?: string): Grupo | null => {
    if (!pais || !ctx.paisesValidos.has(pais)) return null
    if (!ctx.esRegional && pais !== ctx.paisSesionId) return null
    if (area && !ctx.areasValidas.has(area)) return null
    return { paisId: pais, areaId: area || undefined }
  }
  const grupoA = lado(params.aPais, params.aArea)
  const grupoB = lado(params.bPais, params.bArea)
  if (!grupoA || !grupoB) return null
  const identicos = grupoA.paisId === grupoB.paisId && (grupoA.areaId ?? '') === (grupoB.areaId ?? '')
  return { grupoA, grupoB, identicos }
}

export type LadoComparacion = {
  nombre: string
  n: number
  promedio: number | null
  promedioAnterior: number | null
  mediana: number | null
  sigma: number | null
  alto: number   // notas ≥ 4.0
  bajo: number   // notas < 3.0
  curva: { x: number; y: number }[]
  media: number | null            // para la línea x̄ del histograma
  serieEvolucion: (number | null)[] // alineada a ciclosOrden; null = sin datos ese ciclo
  dims: { nombre: string; actual: number | null; delta: number | null }[]
}

type WherePais = { paisId?: string }
const vigente = (r: { notaFinal: number | null; notaCalibrada: number | null }) => r.notaCalibrada ?? r.notaFinal
const notaDim = (desglose: unknown, dimensionId: string) => {
  const d = ((desglose as DimensionResultado[] | null) ?? []).find((x) => x.dimensionId === dimensionId)
  return d ? d.ajuste ?? d.nota : null
}

/** Datos de la vista comparativa: dos grupos (país + área opcional) + la organización
 * (alcance completo del observador) como referencia. Los grupos llegan YA validados
 * contra el alcance (validarGrupos) — aquí solo se consulta dentro de wherePais. */
export async function comparacionCiclo(cicloId: string, wherePais: WherePais, grupoA: Grupo, grupoB: Grupo) {
  const [ciclo, resultados, dimensiones, historicosTodos, paises, areas] = await Promise.all([
    prisma.ciclo.findUniqueOrThrow({ where: { id: cicloId } }),
    prisma.resultado.findMany({
      where: { cicloId, notaFinal: { not: null }, colaborador: { is: { ...wherePais } } },
      include: { colaborador: { select: { nombres: true, apellidos: true, paisId: true, areaId: true, puestoId: true } } },
    }),
    prisma.dimension.findMany({ orderBy: { orden: 'asc' } }),
    prisma.resultado.findMany({
      where: { notaFinal: { not: null }, colaborador: { is: { ...wherePais } }, ciclo: { estado: { in: ['ACTIVO', 'CERRADO'] } } },
      include: {
        ciclo: { select: { id: true, fechaInicio: true, fechaFin: true } },
        colaborador: { select: { paisId: true, areaId: true } },
      },
    }),
    prisma.pais.findMany({ where: { id: { in: [grupoA.paisId, grupoB.paisId] } }, select: { id: true, nombre: true } }),
    prisma.area.findMany({
      where: { id: { in: [grupoA.areaId, grupoB.areaId].filter((x): x is string => Boolean(x)) } },
      select: { id: true, nombre: true },
    }),
  ])

  const pertenece = (g: Grupo) => (c: { paisId: string; areaId: string | null }) =>
    c.paisId === g.paisId && (!g.areaId || c.areaId === g.areaId)
  const enA = pertenece(grupoA)
  const enB = pertenece(grupoB)
  const nombreDe = (g: Grupo) =>
    nombreGrupo(paises.find((p) => p.id === g.paisId)?.nombre ?? '?', areas.find((x) => x.id === g.areaId)?.nombre ?? null)

  // Ciclo anterior (por fecha de inicio) para los deltas por dimensión de cada grupo
  const anterior = await prisma.ciclo.findFirst({
    where: { fechaInicio: { lt: ciclo.fechaInicio }, resultados: { some: { notaFinal: { not: null } } } },
    orderBy: { fechaInicio: 'desc' },
  })
  const previos = anterior
    ? await prisma.resultado.findMany({
        where: { cicloId: anterior.id, notaFinal: { not: null }, colaborador: { is: { ...wherePais } } },
        include: { colaborador: { select: { paisId: true, areaId: true } } },
      })
    : []

  // Evolución: mismos ciclos ordenados para las 3 series (null = el grupo no tiene datos ese ciclo)
  const ciclosOrden = [...new Map(historicosTodos.map((r) => [r.ciclo.id, r.ciclo])).values()]
    .sort((x, y) => x.fechaInicio.getTime() - y.fechaInicio.getTime())
    .map((c) => ({ id: c.id, cierre: c.fechaFin.toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' }) }))
  const serieDe = (filtro: (c: { paisId: string; areaId: string | null }) => boolean) =>
    ciclosOrden.map(({ id }) => {
      const notas = historicosTodos.filter((r) => r.ciclo.id === id && filtro(r.colaborador)).map((r) => vigente(r)!)
      return notas.length > 0 ? Number(media(notas)!.toFixed(2)) : null
    })

  const lado = (g: Grupo, filtro: (c: { paisId: string; areaId: string | null }) => boolean): LadoComparacion => {
    const propios = resultados.filter((r) => filtro(r.colaborador))
    const notas = propios.map((r) => vigente(r)!)
    const previosPropios = previos.filter((r) => filtro(r.colaborador))
    return {
      nombre: nombreDe(g),
      n: notas.length,
      promedio: media(notas),
      promedioAnterior: media(previosPropios.map((r) => vigente(r)!)),
      mediana: mediana(notas),
      sigma: desviacion(notas),
      alto: notas.filter((v) => v >= 4).length,
      bajo: notas.filter((v) => v < 3).length,
      curva: curvaNormal(notas),
      media: media(notas),
      serieEvolucion: serieDe(filtro),
      dims: dimensiones.map((d) => {
        const actual = media(propios.map((r) => notaDim(r.desgloseDimJson, d.id)).filter((v): v is number => v !== null))
        const antes = media(previosPropios.map((r) => notaDim(r.desgloseDimJson, d.id)).filter((v): v is number => v !== null))
        return {
          nombre: d.nombre,
          actual: actual !== null ? Number(actual.toFixed(2)) : null,
          delta: actual !== null && antes !== null ? Number((actual - antes).toFixed(2)) : null,
        }
      }),
    }
  }

  const a = lado(grupoA, enA)
  const b = lado(grupoB, enB)
  const personasA = resultados.filter((r) => enA(r.colaborador)).map((r) => ({ nombre: `${r.colaborador.nombres} ${r.colaborador.apellidos}`, nota: vigente(r)! }))
  const personasB = resultados.filter((r) => enB(r.colaborador)).map((r) => ({ nombre: `${r.colaborador.nombres} ${r.colaborador.apellidos}`, nota: vigente(r)! }))
  const { bins, personasPorBin } = binsApilados(personasA, personasB)

  // Organización: alcance completo del observador. La curva se re-escala a nA+nB
  // (patrón curvaRef del análisis) para comparar la FORMA sin aplastar a los grupos.
  const notasOrg = resultados.map((r) => vigente(r)!)
  const perfilPorEvaluado = await perfilesEsperadosDeCiclo(cicloId, resultados.map((r) => r.colaboradorId))
  const esperadoDim = esperadoDeCorte(resultados.map((r) => r.colaboradorId), perfilPorEvaluado, dimensiones.map((d) => d.id))

  return {
    a,
    b,
    bins,
    personasPorBin,
    organizacion: {
      n: notasOrg.length,
      curva: curvaNormal(notasOrg, 1, 5, 0.5, 60, a.n + b.n),
      serieEvolucion: serieDe(() => true),
      esperadoDim: esperadoDim.map((v) => (v !== null ? Number(v.toFixed(2)) : null)),
    },
    ciclosOrden,
    dimensiones: dimensiones.map((d) => d.nombre),
    anteriorNombre: anterior?.nombre ?? null,
  }
}

export type ComparacionCiclo = Awaited<ReturnType<typeof comparacionCiclo>>
