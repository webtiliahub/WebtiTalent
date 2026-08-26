import { prisma } from '@/shared/lib/prisma'
import { media, mediana, desviacion, zScore, histograma, curvaNormal } from '@/domain/estadistica'
import type { DimensionResultado } from './servicio'
import { esperadoDeCorte } from './comparacion'
import { perfilesEsperadosDeCiclo } from '@/features/ciclos/perfil-evaluado'

/** Análisis del ciclo (submódulo de Resultados): distribución, evolución entre ciclos,
 * alertas (outliers) y pain points, calculado SOLO sobre el alcance del RR.HH.
 * Umbrales documentados; ajustables si RR.HH. pide otra sensibilidad. */
export const UMBRAL = {
  outlierZ: 1.5, // |z| respecto de su grupo (puesto; nivel si el grupo es chico)
  grupoMinimo: 3, // n mínimo para estadística de grupo
  brechaAutopercepcion: 0.8, // |auto − jefe| en escala 1–5
  sesgoJefe: 0.5, // desvío del promedio de notas que emite un jefe vs el promedio organizacional
  sesgoEquipoMinimo: 2, // evaluados mínimos para hablar de sesgo
  descuadreCompObj: 1.0, // |notaComp − notaObj(escala 5)|
  dimensionDebil: 3.5, // celda/dimensión en rojo
  deltaRelevante: 0.15, // cambio de promedio entre ciclos que amerita insight
  tramoBajoAlerta: 0.2, // % de evaluados en tramo bajo que dispara alerta
} as const

export type FiltrosDistribucion = { areaIds?: string[]; nivelId?: string; paisId?: string }

type WherePais = { paisId?: string }

const vigente = (r: { notaFinal: number | null; notaCalibrada: number | null }) => r.notaCalibrada ?? r.notaFinal

export async function analisisCiclo(cicloId: string, wherePais: WherePais, filtros: FiltrosDistribucion) {
  // eslint-disable-next-line prefer-const
  let [ciclo, resultados, dimensiones] = await Promise.all([
    prisma.ciclo.findUniqueOrThrow({ where: { id: cicloId } }),
    prisma.resultado.findMany({
      where: { cicloId, notaFinal: { not: null }, colaborador: { is: { ...wherePais } } },
      include: { colaborador: { include: { puesto: { include: { nivel: true } }, area: true, pais: true, jefe: { select: { id: true, nombres: true, apellidos: true } } } } },
    }),
    prisma.dimension.findMany({ orderBy: { orden: 'asc' } }),
  ])

  // Filtros GLOBALES (área/nivel/país): afectan todo el reporte; el total del alcance
  // se conserva solo como referencia visual de la distribución.
  const hayFiltro = Boolean(filtros.areaIds?.length || filtros.nivelId || filtros.paisId)
  const pasaFiltro = (c: { areaId: string | null; paisId: string; puesto: { nivelId: string } | null }) =>
    (!filtros.areaIds?.length || (c.areaId !== null && filtros.areaIds.includes(c.areaId))) &&
    (!filtros.nivelId || c.puesto?.nivelId === filtros.nivelId) &&
    (!filtros.paisId || c.paisId === filtros.paisId)
  const resultadosTodos = resultados
  const notasTodos = resultadosTodos.map((r) => vigente(r)!)
  resultados = resultados.filter((r) => pasaFiltro(r.colaborador))

  const notas = resultados.map((r) => vigente(r)!)
  const nombreDe = (r: (typeof resultados)[number]) => `${r.colaborador.nombres} ${r.colaborador.apellidos}`
  const nombreJefeDe = (r: (typeof resultados)[number]) =>
    r.colaborador.jefe ? `${r.colaborador.jefe.nombres} ${r.colaborador.jefe.apellidos}` : 'Sin jefe directo'

  // ── KPIs + comparación con el ciclo anterior (por fecha de inicio) ──
  const anterior = await prisma.ciclo.findFirst({
    where: { fechaInicio: { lt: ciclo.fechaInicio }, resultados: { some: { notaFinal: { not: null } } } },
    orderBy: { fechaInicio: 'desc' },
  })
  const resultadosPrevios = anterior
    ? await prisma.resultado.findMany({
        where: { cicloId: anterior.id, notaFinal: { not: null }, colaborador: { is: { ...wherePais } } },
        include: { colaborador: { select: { id: true, areaId: true, paisId: true, puesto: { select: { nivelId: true } } } } },
      })
    : []
  const previosFiltrados = resultadosPrevios.filter((r) => pasaFiltro(r.colaborador))
  const notasPrevias = previosFiltrados.map((r) => vigente(r)!)
  const potenciales = resultados.map((r) => r.potencial).filter((p): p is number => p !== null)
  const tramos = {
    bajo: notas.filter((n) => n < 3).length,
    medio: notas.filter((n) => n >= 3 && n < 4).length,
    alto: notas.filter((n) => n >= 4).length,
  }
  const kpis = {
    n: notas.length,
    promedio: media(notas),
    mediana: mediana(notas),
    sigma: desviacion(notas),
    tramos,
    potencialProm: media(potenciales),
    calibrados: resultados.filter((r) => r.notaCalibrada !== null || (r.ajustesDimJson && Object.keys(r.ajustesDimJson as object).length > 0)).length,
    anterior: anterior ? { nombre: anterior.nombre, promedio: media(notasPrevias), n: notasPrevias.length } : null,
  }

  // ── Distribución (del filtro activo) + curva del total del alcance como referencia ──
  const binsBase = histograma(notas)
  const personasPorBin: { nombre: string; nota: number }[][] = binsBase.map(() => [])
  for (const r of resultados) {
    const v = vigente(r)!
    const i = Math.min(binsBase.length - 1, Math.max(0, Math.floor((v - 1) / 0.5)))
    personasPorBin[i].push({ nombre: nombreDe(r), nota: Number(v.toFixed(2)) })
  }
  for (const lista of personasPorBin) lista.sort((a, b) => b.nota - a.nota)
  const distribucion = {
    hayFiltro,
    n: notas.length,
    nTotal: notasTodos.length,
    bins: binsBase,
    personasPorBin,
    curva: curvaNormal(notas),
    promedio: media(notas),
    sigma: desviacion(notas),
    mediana: mediana(notas),
    curvaRef: hayFiltro ? curvaNormal(notasTodos, 1, 5, 0.5, 60, notas.length) : [],
    promedioRef: hayFiltro ? media(notasTodos) : null,
  }

  // ── Evolución entre ciclos (promedios, por dimensión y por persona) ──
  const historicosTodos = await prisma.resultado.findMany({
    where: { notaFinal: { not: null }, colaborador: { is: { ...wherePais } }, ciclo: { estado: { in: ['ACTIVO', 'CERRADO'] } } },
    include: {
      ciclo: { select: { id: true, nombre: true, fechaInicio: true, fechaFin: true } },
      colaborador: { select: { areaId: true, paisId: true, puesto: { select: { nivelId: true } } } },
    },
  })
  const historicos = historicosTodos.filter((r) => pasaFiltro(r.colaborador))
  const ciclosOrden = [...new Map(historicos.map((r) => [r.ciclo.id, r.ciclo])).values()].sort((a, b) => a.fechaInicio.getTime() - b.fechaInicio.getTime())
  const serieCiclos = ciclosOrden.map((c) => {
    const del = historicos.filter((r) => r.ciclo.id === c.id)
    return {
      id: c.id,
      nombre: c.nombre,
      // Etiqueta del eje: fecha de cierre de la evaluación (los nombres largos no caben)
      cierre: c.fechaFin.toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' }),
      promedio: media(del.map((r) => vigente(r)!))!,
      n: del.length,
      actual: c.id === cicloId,
    }
  })
  const dimPorCiclo = dimensiones.map((d) => ({
    nombre: d.nombre,
    serie: ciclosOrden.map((c) => {
      const vals = historicos
        .filter((r) => r.ciclo.id === c.id)
        .map((r) => ((r.desgloseDimJson as DimensionResultado[] | null) ?? []).find((x) => x.dimensionId === d.id))
        .filter(Boolean)
        .map((x) => x!.ajuste ?? x!.nota)
      return { ciclo: c.nombre, promedio: media(vals) }
    }),
  }))
  // Por dimensión: ciclo actual vs anterior (radar comparativo + barras del cambio)
  const promedioDim = (rs: { desgloseDimJson: unknown }[], dimensionId: string) =>
    media(rs
      .map((r) => ((r.desgloseDimJson as DimensionResultado[] | null) ?? []).find((x) => x.dimensionId === dimensionId))
      .filter(Boolean)
      .map((x) => x!.ajuste ?? x!.nota))
  // Perfil esperado del corte (promedio del puntajeEsperado del puesto de cada evaluado):
  // alimenta el punteado del radar — la expectativa, no el ciclo anterior
  const perfilPorEvaluado = await perfilesEsperadosDeCiclo(cicloId, resultados.map((r) => r.colaboradorId))
  const esperadoDim = esperadoDeCorte(resultados.map((r) => r.colaboradorId), perfilPorEvaluado, dimensiones.map((d) => d.id))
  const dimVsAnterior = dimensiones.map((d, i) => {
    const actual = promedioDim(resultados, d.id)
    const anteriorDim = promedioDim(previosFiltrados, d.id)
    return {
      nombre: d.nombre,
      actual,
      anterior: anteriorDim,
      esperado: esperadoDim[i] !== null ? Number(esperadoDim[i]!.toFixed(2)) : null,
      delta: actual !== null && anteriorDim !== null ? Number((actual - anteriorDim).toFixed(2)) : null,
    }
  }).filter((d) => d.actual !== null)

  const notaPreviaDe = new Map(previosFiltrados.map((r) => [r.colaboradorId, vigente(r)!]))
  const personas = resultados
    .map((r) => ({
      nombre: nombreDe(r),
      puesto: r.colaborador.puesto?.nombre ?? 'Sin puesto',
      area: r.colaborador.area?.nombre ?? 'Sin área',
      jefe: nombreJefeDe(r),
      anterior: notaPreviaDe.get(r.colaboradorId) ?? null,
      actual: vigente(r)!,
    }))
    .map((p) => ({ ...p, delta: p.anterior !== null ? Number((p.actual - p.anterior).toFixed(2)) : null }))
    .sort((a, b) => (b.delta ?? -99) - (a.delta ?? -99))

  // ── Alertas ──
  // Outliers: z respecto de su PUESTO; si el grupo es chico, su NIVEL
  const notasPorPuesto = new Map<string, number[]>()
  const notasPorNivel = new Map<string, number[]>()
  for (const r of resultados) {
    const p = r.colaborador.puesto
    if (p) {
      notasPorPuesto.set(p.nombre, [...(notasPorPuesto.get(p.nombre) ?? []), vigente(r)!])
      notasPorNivel.set(p.nivel.nombre, [...(notasPorNivel.get(p.nivel.nombre) ?? []), vigente(r)!])
    }
  }
  const outliers = resultados.flatMap((r) => {
    const p = r.colaborador.puesto
    if (!p) return []
    const grupoPuesto = notasPorPuesto.get(p.nombre) ?? []
    const usaPuesto = grupoPuesto.length >= UMBRAL.grupoMinimo
    const grupo = usaPuesto ? grupoPuesto : notasPorNivel.get(p.nivel.nombre) ?? []
    const z = zScore(vigente(r)!, grupo)
    if (z === null || Math.abs(z) < UMBRAL.outlierZ) return []
    return [{ nombre: nombreDe(r), nota: vigente(r)!, z: Number(z.toFixed(2)), grupo: usaPuesto ? p.nombre : `nivel ${p.nivel.nombre}`, promedioGrupo: media(grupo)!, alto: z > 0 }]
  }).sort((a, b) => Math.abs(b.z) - Math.abs(a.z))

  // Brecha de autopercepción y sesgo del evaluador: promedios de respuestas AUTO/JEFE del ciclo
  const idsFiltrados = new Set(resultados.map((r) => r.colaboradorId))
  const asigsRaw = await prisma.asignacion.findMany({
    where: { cicloId, estado: 'ENVIADA', tipo: { in: ['AUTO', 'JEFE'] }, evaluado: { is: { ...wherePais } } },
    select: { id: true, tipo: true, evaluadoId: true, evaluadorId: true },
  })
  const asigs = asigsRaw.filter((a) => idsFiltrados.has(a.evaluadoId))
  const promRespuesta = await prisma.respuesta.groupBy({
    by: ['asignacionId'],
    where: { asignacionId: { in: asigs.map((a) => a.id) } },
    _avg: { valor: true },
  })
  const promDe = new Map(promRespuesta.map((g) => [g.asignacionId, g._avg.valor]))
  const autoDe = new Map<string, number>()
  const jefeDe = new Map<string, { valor: number; jefeId: string }>()
  for (const a of asigs) {
    const v = promDe.get(a.id)
    if (v === null || v === undefined) continue
    if (a.tipo === 'AUTO') autoDe.set(a.evaluadoId, v)
    else jefeDe.set(a.evaluadoId, { valor: v, jefeId: a.evaluadorId })
  }
  const brechasAuto = resultados.flatMap((r) => {
    const auto = autoDe.get(r.colaboradorId)
    const jefe = jefeDe.get(r.colaboradorId)
    if (auto === undefined || !jefe) return []
    const brecha = Number((auto - jefe.valor).toFixed(2))
    if (Math.abs(brecha) < UMBRAL.brechaAutopercepcion) return []
    return [{ nombre: nombreDe(r), auto: Number(auto.toFixed(2)), jefe: Number(jefe.valor.toFixed(2)), brecha, seSobreestima: brecha > 0 }]
  }).sort((a, b) => Math.abs(b.brecha) - Math.abs(a.brecha))

  const emitidasPorJefe = new Map<string, number[]>()
  for (const { valor, jefeId } of jefeDe.values()) emitidasPorJefe.set(jefeId, [...(emitidasPorJefe.get(jefeId) ?? []), valor])
  const promedioGlobalJefe = media([...jefeDe.values()].map((x) => x.valor))
  const nombreColab = new Map(resultados.map((r) => [r.colaboradorId, nombreDe(r)]))
  const jefesInfo = await prisma.colaborador.findMany({ where: { id: { in: [...emitidasPorJefe.keys()] } }, select: { id: true, nombres: true, apellidos: true } })
  const nombreJefe = new Map(jefesInfo.map((j) => [j.id, `${j.nombres} ${j.apellidos}`]))
  const sesgoJefes = promedioGlobalJefe === null ? [] : [...emitidasPorJefe.entries()].flatMap(([jefeId, vals]) => {
    if (vals.length < UMBRAL.sesgoEquipoMinimo) return []
    const desvio = Number((media(vals)! - promedioGlobalJefe).toFixed(2))
    if (Math.abs(desvio) < UMBRAL.sesgoJefe) return []
    return [{ jefe: nombreJefe.get(jefeId) ?? nombreColab.get(jefeId) ?? jefeId, equipo: vals.length, promedio: Number(media(vals)!.toFixed(2)), desvio, duro: desvio < 0 }]
  }).sort((a, b) => Math.abs(b.desvio) - Math.abs(a.desvio))

  const descuadres = resultados.flatMap((r) => {
    if (r.notaCompetencias === null || r.cumplimientoObjetivos === null) return []
    const notaObj = Math.min(r.cumplimientoObjetivos, 100) / 20
    const brecha = Number((r.notaCompetencias - notaObj).toFixed(2))
    if (Math.abs(brecha) < UMBRAL.descuadreCompObj) return []
    return [{ nombre: nombreDe(r), comp: Number(r.notaCompetencias.toFixed(2)), obj: Number(notaObj.toFixed(2)), brecha }]
  }).sort((a, b) => Math.abs(b.brecha) - Math.abs(a.brecha))

  // ── Pain points por dimensión (ranking + heatmap dimensión × área) ──
  const notaDimDe = (r: (typeof resultados)[number], dimensionId: string) => {
    const d = ((r.desgloseDimJson as DimensionResultado[] | null) ?? []).find((x) => x.dimensionId === dimensionId)
    return d ? d.ajuste ?? d.nota : null
  }
  const rankingDim = dimensiones.map((d) => ({
    nombre: d.nombre,
    promedio: media(resultados.map((r) => notaDimDe(r, d.id)).filter((v): v is number => v !== null)),
  })).filter((d) => d.promedio !== null).sort((a, b) => a.promedio! - b.promedio!)
  const areasHeat = [...new Set(resultados.map((r) => r.colaborador.area?.nombre ?? 'Sin área'))].sort()
  const heatmap = areasHeat.map((area) => {
    const delArea = resultados.filter((r) => (r.colaborador.area?.nombre ?? 'Sin área') === area)
    // Δ del total del área vs el ciclo anterior (agrupando a los previos por el área ACTUAL del colaborador)
    const areaIds = new Set(delArea.map((r) => r.colaborador.areaId))
    const previosDelArea = previosFiltrados.filter((r) => areaIds.has(r.colaborador.areaId))
    const total = media(delArea.map((r) => vigente(r)!))
    const totalAnterior = media(previosDelArea.map((r) => vigente(r)!))
    return {
      area,
      total,
      delta: total !== null && totalAnterior !== null ? Number((total - totalAnterior).toFixed(2)) : null,
      n: delArea.length,
      celdas: dimensiones.map((d) => {
        const vals = delArea.map((r) => notaDimDe(r, d.id)).filter((v): v is number => v !== null)
        return { dim: d.nombre, promedio: media(vals), n: vals.length }
      }),
    }
  })
  // Notas por persona y dimensión (alineadas al orden de `dimensiones`): alimentan el
  // detalle al hacer clic en una celda del heatmap (listado área → jefe directo).
  const personasDim = resultados.map((r) => ({
    nombre: nombreDe(r),
    area: r.colaborador.area?.nombre ?? 'Sin área',
    jefe: nombreJefeDe(r),
    notas: dimensiones.map((d) => {
      const v = notaDimDe(r, d.id)
      return v === null ? null : Number(v.toFixed(2))
    }),
  }))

  // ── Insights automáticos (reglas sobre los hallazgos) ──
  const insights: { texto: string; tono: 'rojo' | 'ambar' | 'ok' }[] = []
  const dimDebil = rankingDim[0]
  if (dimDebil?.promedio !== null && dimDebil !== undefined) {
    insights.push({
      texto: `«${dimDebil.nombre}» es la dimensión más débil del ciclo (promedio ${dimDebil.promedio!.toFixed(2)})${dimDebil.promedio! < UMBRAL.dimensionDebil ? ' — considerar un plan de capacitación o desarrollo focalizado' : ''}.`,
      tono: dimDebil.promedio! < UMBRAL.dimensionDebil ? 'rojo' : 'ambar',
    })
  }
  const celdasRojas = heatmap.flatMap((f) => f.celdas.filter((c) => c.promedio !== null && c.promedio < UMBRAL.dimensionDebil && c.n >= 2).map((c) => ({ area: f.area, ...c })))
    .sort((a, b) => a.promedio! - b.promedio!).slice(0, 3)
  for (const c of celdasRojas) {
    insights.push({ texto: `«${c.dim}» está bajo en ${c.area} (${c.promedio!.toFixed(2)} con ${c.n} evaluados) — foco de desarrollo para esa área.`, tono: 'rojo' })
  }
  for (const s of sesgoJefes) {
    insights.push({ texto: `${s.jefe} evalúa ${s.duro ? 'más duro' : 'más alto'} que el resto (${s.desvio > 0 ? '+' : ''}${s.desvio.toFixed(2)} sobre ${s.equipo} evaluados) — priorizar su equipo en la calibración.`, tono: 'ambar' })
  }
  const outliersBajos = outliers.filter((o) => !o.alto)
  if (outliersBajos.length > 0) {
    insights.push({ texto: `${outliersBajos.map((o) => o.nombre).join(', ')}: nota muy por debajo de su grupo — PDI prioritario y seguimiento cercano.`, tono: 'rojo' })
  }
  if (brechasAuto.length > 0) {
    insights.push({ texto: `${brechasAuto.length} persona${brechasAuto.length === 1 ? '' : 's'} con brecha alta de autopercepción (${brechasAuto.slice(0, 3).map((b) => b.nombre).join(', ')}${brechasAuto.length > 3 ? '…' : ''}) — profundizar en la sesión de feedback.`, tono: 'ambar' })
  }
  if (descuadres.length > 0) {
    insights.push({ texto: `${descuadres.length} caso${descuadres.length === 1 ? '' : 's'} con competencias y objetivos descuadrados — revisar la definición de metas de esas personas.`, tono: 'ambar' })
  }
  if (kpis.anterior?.promedio != null && kpis.promedio !== null) {
    const delta = kpis.promedio - kpis.anterior.promedio
    if (delta <= -UMBRAL.deltaRelevante) insights.push({ texto: `El promedio bajó ${Math.abs(delta).toFixed(2)} vs ${kpis.anterior.nombre} — investigar causas antes de publicar conclusiones.`, tono: 'rojo' })
    if (delta >= UMBRAL.deltaRelevante) insights.push({ texto: `El promedio subió ${delta.toFixed(2)} vs ${kpis.anterior.nombre} — buena evolución general.`, tono: 'ok' })
  }
  if (kpis.n > 0 && tramos.bajo / kpis.n > UMBRAL.tramoBajoAlerta) {
    insights.push({ texto: `${Math.round((tramos.bajo / kpis.n) * 100)}% de los evaluados está en el tramo bajo (<3.0) — el ciclo amerita un plan de acción organizacional.`, tono: 'rojo' })
  }
  if (insights.length === 0) insights.push({ texto: 'Sin hallazgos relevantes: distribución sana y sin señales de alerta en este ciclo.', tono: 'ok' })

  return { ciclo, kpis, distribucion, evolucion: { serieCiclos, dimPorCiclo, dimVsAnterior, personas }, alertas: { outliers, brechasAuto, sesgoJefes, descuadres }, painPoints: { rankingDim, heatmap, dimensiones: dimensiones.map((d) => d.nombre), personas: personasDim }, insights }
}

export type AnalisisCiclo = Awaited<ReturnType<typeof analisisCiclo>>
