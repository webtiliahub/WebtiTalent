import { cookies } from 'next/headers'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin, alcancePaisWhere } from '@/shared/lib/permisos'
import { Card, Nota, Titulo, Vacio } from '@/shared/ui/componentes'
import { analisisCiclo } from '@/features/resultados/analisis'
import { SwitcherResultados, EvolucionChart, Insights, BarrasDelta, BarrasDeltaLista } from '@/features/resultados/AnalisisUI'
import { Heatmap } from '@/features/resultados/HeatmapInteractivo'
import { RadarDimensiones, colorDim } from '@/shared/ui/RadarDimensiones'
import { HistogramaInteractivo } from '@/features/resultados/HistogramaInteractivo'
import { validarGrupos, comparacionCiclo } from '@/features/resultados/comparacion'
import { SelectorComparacion } from '@/features/resultados/SelectorComparacion'
import { FiltrosResultados } from '@/features/resultados/FiltrosResultados'
import { HistogramaComparativo } from '@/features/resultados/HistogramaComparativo'
import { LeyendaComparacion, KpisComparativos, EvolucionComparada, TablaEvolucionComparada, BarrasDeltaComparadas, BarrasDeltaComparadasLista } from '@/features/resultados/ComparacionUI'
import { COLOR_A, COLOR_B, COLOR_ORG } from '@/features/resultados/colores'

export default async function AnalisisResultadosPage({ searchParams }: {
  searchParams: Promise<{ ciclo?: string; area?: string; nivel?: string; pais?: string; comparar?: string; aPais?: string; aArea?: string; bPais?: string; bArea?: string }>
}) {
  const sesion = await requiereAdmin('RESULTADOS', 'VER')
  const { ciclo: cicloParam, area: areaParam, nivel: nivelParam, pais: paisParam, comparar, aPais, aArea, bPais, bArea } = await searchParams
  const jar = await cookies()
  const esRegional = sesion.alcanceRrhh === 'REGIONAL'

  const ciclos = await prisma.ciclo.findMany({
    where: { estado: { in: ['ACTIVO', 'CERRADO'] }, resultados: { some: { notaFinal: { not: null } } } },
    orderBy: { fechaInicio: 'desc' },
  })
  const ciclo = ciclos.find((c) => c.id === cicloParam) ?? ciclos[0]
  if (!ciclo) {
    return (
      <>
        <Titulo sub="Distribución, evolución y alertas del ciclo · acceso exclusivo RR.HH. y Dirección">Resultados</Titulo>
        <SwitcherResultados activo="analisis" />
        <Vacio>Aún no hay ciclos con resultados para analizar.</Vacio>
      </>
    )
  }
  const wherePais = alcancePaisWhere(sesion, jar.get('pais')?.value ?? null)
  const [areas, niveles, paises] = await Promise.all([
    prisma.area.findMany({ orderBy: { nombre: 'asc' } }),
    prisma.nivelJerarquico.findMany({ orderBy: { orden: 'asc' } }),
    esRegional ? prisma.pais.findMany({ orderBy: { nombre: 'asc' } }) : Promise.resolve([]),
  ])
  // El área llega como lista separada por comas (selección múltiple)
  const areasParam = (areaParam ?? '').split(',').filter((id) => areas.some((a) => a.id === id))
  const filtros = {
    areaIds: areasParam,
    nivelId: niveles.some((n) => n.id === nivelParam) ? nivelParam : undefined,
    paisId: esRegional && paises.some((p) => p.id === paisParam) ? paisParam : undefined,
  }
  // Vista comparativa: países/áreas CON evaluados en el ciclo (dentro del alcance) para
  // el selector, y validación server-side de los grupos que llegan por URL.
  const cortes = await prisma.resultado.findMany({
    where: { cicloId: ciclo.id, notaFinal: { not: null }, colaborador: { is: { ...wherePais } } },
    select: { colaborador: { select: { pais: { select: { id: true, nombre: true } }, area: { select: { id: true, nombre: true } } } } },
  })
  const paisesCiclo = [...new Map(cortes.map((r) => [r.colaborador.pais.id, r.colaborador.pais])).values()].sort((x, y) => x.nombre.localeCompare(y.nombre))
  const areasPorPais: Record<string, { id: string; nombre: string }[]> = {}
  for (const r of cortes) {
    if (!r.colaborador.area) continue
    const lista = (areasPorPais[r.colaborador.pais.id] ??= [])
    if (!lista.some((x) => x.id === r.colaborador.area!.id)) lista.push(r.colaborador.area)
  }
  for (const lista of Object.values(areasPorPais)) lista.sort((x, y) => x.nombre.localeCompare(y.nombre))

  const paisFijo = !esRegional
    ? (paisesCiclo.find((p) => p.id === wherePais.paisId) ??
        (wherePais.paisId ? await prisma.pais.findUnique({ where: { id: wherePais.paisId }, select: { id: true, nombre: true } }) : null))
    : null
  // Validación de grupos: contra el CATÁLOGO dentro del alcance (no contra "con evaluados
  // en el ciclo") — un grupo legítimo sin evaluados en el ciclo debe cargar la comparación
  // con el aviso "sin evaluados en este ciclo", no caer en silencio a la vista normal.
  const grupos = comparar === '1'
    ? validarGrupos({ aPais, aArea, bPais, bArea }, {
        esRegional,
        paisSesionId: wherePais.paisId ?? null,
        paisesValidos: new Set(wherePais.paisId ? [wherePais.paisId] : paises.map((p) => p.id)),
        areasValidas: new Set(areas.map((x) => x.id)),
      })
    : null
  const comparacionActiva = grupos !== null && !grupos.identicos
  // Ambos análisis son independientes: en paralelo (la comparación no espera al normal)
  const [comp, a] = await Promise.all([
    comparacionActiva ? comparacionCiclo(ciclo.id, wherePais, grupos.grupoA, grupos.grupoB) : Promise.resolve(null),
    analisisCiclo(ciclo.id, wherePais, filtros),
  ])

  const pct = (n: number) => (a.kpis.n === 0 ? 0 : Math.round((n / a.kpis.n) * 100))
  const etiquetaFiltro = [
    filtros.areaIds.length > 0 && (filtros.areaIds.length <= 2
      ? filtros.areaIds.map((id) => areas.find((x) => x.id === id)?.nombre).filter(Boolean).join(' + ')
      : `${filtros.areaIds.length} áreas`),
    filtros.nivelId && niveles.find((x) => x.id === filtros.nivelId)?.nombre,
    filtros.paisId && paises.find((x) => x.id === filtros.paisId)?.nombre,
  ].filter(Boolean).join(' · ')

  return (
    <>
      <Titulo sub={`${ciclo.nombre} · ${a.kpis.n} evaluados en tu alcance · acceso exclusivo RR.HH. y Dirección`}>
        Resultados
      </Titulo>
      <SwitcherResultados activo="analisis" query={`?ciclo=${ciclo.id}`} />

      {/* Filtros + Vista comparativa: en comparación solo manda el ciclo (los grupos definen el corte) */}
      <div className="mb-5 flex flex-col items-stretch justify-between gap-2 md:flex-row md:flex-wrap md:items-start">
        <FiltrosResultados
          campoArea="area"
          ciclos={ciclos.map((c) => ({ id: c.id, nombre: c.nombre }))}
          areas={areas.map((x) => ({ id: x.id, nombre: x.nombre }))}
          cicloSel={ciclo.id}
          areasSel={filtros.areaIds}
          niveles={niveles.map((x) => ({ id: x.id, nombre: x.nombre }))}
          nivelSel={filtros.nivelId ?? ''}
          paises={esRegional ? paises.map((x) => ({ id: x.id, nombre: x.nombre })) : undefined}
          paisSel={filtros.paisId ?? ''}
          soloCiclo={comparacionActiva}
          camposFijos={comparacionActiva
            ? { comparar: '1', aPais: aPais ?? '', aArea: aArea ?? '', bPais: bPais ?? '', bArea: bArea ?? '' }
            : undefined}
        />
        <SelectorComparacion
          cicloId={ciclo.id}
          esRegional={esRegional}
          paisFijo={paisFijo}
          paises={paisesCiclo}
          areasPorPais={areasPorPais}
          activa={comparacionActiva}
          inicial={{ aPais: aPais ?? '', aArea: aArea ?? '', bPais: bPais ?? '', bArea: bArea ?? '' }}
        />
      </div>
      {grupos?.identicos && (
        <p className="mb-5 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">Elige dos grupos distintos para comparar.</p>
      )}

      {comparacionActiva && comp && (
        <>
          <LeyendaComparacion nombreA={comp.a.nombre} nA={comp.a.n} nombreB={comp.b.nombre} nB={comp.b.n} nOrg={comp.organizacion.n} />
          {comp.a.n === 0 && <p className="mb-4 rounded-xl px-3.5 py-2.5 text-sm" style={{ background: '#fef2f2', color: COLOR_A }}>{comp.a.nombre}: sin evaluados en este ciclo.</p>}
          {comp.b.n === 0 && <p className="mb-4 rounded-xl px-3.5 py-2.5 text-sm" style={{ background: '#f0f9ff', color: COLOR_B }}>{comp.b.nombre}: sin evaluados en este ciclo.</p>}
          <KpisComparativos a={comp.a} b={comp.b} />

          <Card
            titulo="Distribución de notas"
            ayuda="Cuántas personas de cada grupo caen en cada rango de nota (barras apiladas por color) con la curva normal de cada grupo; la punteada gris es la organización, re-escalada al tamaño de los grupos para comparar la forma. Haz clic en un rango para ver quiénes están."
            extra={`${comp.a.nombre} vs ${comp.b.nombre} · organización de referencia`}
          >
            {comp.a.n + comp.b.n === 0 ? (
              <Vacio>Ninguno de los dos grupos tiene evaluados en este ciclo.</Vacio>
            ) : (
              <HistogramaComparativo
                bins={comp.bins}
                personasPorBin={comp.personasPorBin}
                curvaA={comp.a.curva}
                curvaB={comp.b.curva}
                curvaOrg={comp.organizacion.curva}
                mediaA={comp.a.media}
                mediaB={comp.b.media}
                nombreA={comp.a.nombre}
                nombreB={comp.b.nombre}
              />
            )}
          </Card>

          <Card className="mt-5" titulo="Evolución entre ciclos" ayuda="Promedio de cada grupo en los ciclos cerrados, con la organización punteada como referencia. Un grupo sin evaluados en un ciclo salta ese punto." extra="nota promedio por ciclo">
            {/* Móvil: el gráfico deja la tendencia y las cifras van a la tabla — con dos
                series, las etiquetas sobre los puntos se cruzan por pares */}
            <div className="md:hidden">
              <div className="overflow-x-auto">
                <EvolucionComparada
                  ciclos={comp.ciclosOrden}
                  movil
                  sinEtiquetas
                  alto={170}
                  ancho={Math.max(340, comp.ciclosOrden.length * 78)}
                  anchoFijo={comp.ciclosOrden.length * 78 > 340}
                  series={[
                    { color: COLOR_ORG, dash: true, puntos: comp.organizacion.serieEvolucion },
                    { color: COLOR_A, puntos: comp.a.serieEvolucion },
                    { color: COLOR_B, puntos: comp.b.serieEvolucion },
                  ]}
                />
              </div>
              <TablaEvolucionComparada
                ciclos={comp.ciclosOrden}
                a={comp.a.serieEvolucion}
                b={comp.b.serieEvolucion}
                org={comp.organizacion.serieEvolucion}
              />
            </div>
            <div className="hidden md:block">
              <EvolucionComparada
                ciclos={comp.ciclosOrden}
                series={[
                  { color: COLOR_ORG, dash: true, puntos: comp.organizacion.serieEvolucion },
                  { color: COLOR_A, etiquetas: 'arriba', puntos: comp.a.serieEvolucion },
                  { color: COLOR_B, etiquetas: 'abajo', puntos: comp.b.serieEvolucion },
                ]}
              />
            </div>
          </Card>

          <Card className="mt-5" titulo="Comparación por dimensión" ayuda="Radar con el promedio de cada grupo por dimensión; el punteado gris es el perfil esperado de la organización (la expectativa definida en los puestos). Las barras miden el cambio de cada grupo vs el ciclo anterior." extra={`${comp.a.nombre} (rojo) vs ${comp.b.nombre} (azul) · esperado organización (punteado)`}>
            <div className="grid items-center gap-8 lg:grid-cols-[3fr_2fr]">
              <div className="mx-auto w-full max-w-2xl">
                {/* Móvil: el radar se queda con la forma y las dos cifras bajan a la lista */}
                <div className="md:hidden">
                  <RadarDimensiones
                    ariaLabel="Radar por dimensión: grupo A vs grupo B vs esperado de la organización"
                    sinEtiquetas
                    dims={comp.a.dims
                      .map((d, i) => ({ d, i }))
                      .filter(({ d, i }) => d.actual !== null || comp.b.dims[i]?.actual !== null)
                      .map(({ d, i }) => ({
                        nombre: d.nombre,
                        color: colorDim(i),
                        valor: d.actual,
                        valorB: comp.b.dims[i]?.actual ?? null,
                        esperado: comp.organizacion.esperadoDim[i] ?? undefined,
                      }))}
                  />
                  <p className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10.5px] text-gris">
                    <span style={{ color: COLOR_A }}>▬ {comp.a.nombre}</span>
                    <span style={{ color: COLOR_B }}>▬ {comp.b.nombre}</span>
                    <span>┈ esperado</span>
                  </p>
                  <ul className="mt-2.5 flex flex-col gap-1.5">
                    {comp.a.dims.map((d, i) => (
                      <li key={d.nombre} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2.5 border-b border-hueso-2 pb-1.5 text-[11.5px] last:border-b-0">
                        <span className="min-w-0 truncate font-semibold">{d.nombre}</span>
                        <span className="font-display font-extrabold tabular-nums" style={{ color: COLOR_A }}>{d.actual?.toFixed(2) ?? '—'}</span>
                        <span className="font-display font-extrabold tabular-nums" style={{ color: COLOR_B }}>{comp.b.dims[i]?.actual?.toFixed(2) ?? '—'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="hidden md:block">
                  <RadarDimensiones
                    ariaLabel="Radar por dimensión: grupo A vs grupo B vs esperado de la organización"
                    dims={comp.a.dims
                      .map((d, i) => ({ d, i }))
                      .filter(({ d, i }) => d.actual !== null || comp.b.dims[i]?.actual !== null)
                      .map(({ d, i }) => ({
                        nombre: d.nombre,
                        color: colorDim(i),
                        valor: d.actual,
                        valorB: comp.b.dims[i]?.actual ?? null,
                        esperado: comp.organizacion.esperadoDim[i] ?? undefined,
                      }))}
                  />
                </div>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gris">Cambio vs {comp.anteriorNombre ?? 'ciclo anterior'}</p>
                {/* Móvil: filas HTML (el SVG con DOS barras por fila dejaba las cifras en 6 px) */}
                <div className="md:hidden">
                  <BarrasDeltaComparadasLista
                    items={[
                    ...comp.dimensiones.map((nombre, i) => ({
                      nombre,
                      actualA: comp.a.dims[i]?.actual ?? null,
                      deltaA: comp.a.dims[i]?.delta ?? null,
                      actualB: comp.b.dims[i]?.actual ?? null,
                      deltaB: comp.b.dims[i]?.delta ?? null,
                    })),
                    ...(comp.a.promedio !== null || comp.b.promedio !== null
                      ? [{
                          nombre: 'Total',
                          actualA: comp.a.promedio !== null ? Number(comp.a.promedio.toFixed(2)) : null,
                          deltaA: comp.a.promedio !== null && comp.a.promedioAnterior !== null ? Number((comp.a.promedio - comp.a.promedioAnterior).toFixed(2)) : null,
                          actualB: comp.b.promedio !== null ? Number(comp.b.promedio.toFixed(2)) : null,
                          deltaB: comp.b.promedio !== null && comp.b.promedioAnterior !== null ? Number((comp.b.promedio - comp.b.promedioAnterior).toFixed(2)) : null,
                          esTotal: true,
                        }]
                      : []),
                  ]}
                    nombreA={comp.a.nombre}
                    nombreB={comp.b.nombre}
                    anteriorNombre={comp.anteriorNombre}
                  />
                </div>
                <div className="hidden md:block">
                  <BarrasDeltaComparadas
                    items={[
                    ...comp.dimensiones.map((nombre, i) => ({
                      nombre,
                      actualA: comp.a.dims[i]?.actual ?? null,
                      deltaA: comp.a.dims[i]?.delta ?? null,
                      actualB: comp.b.dims[i]?.actual ?? null,
                      deltaB: comp.b.dims[i]?.delta ?? null,
                    })),
                    ...(comp.a.promedio !== null || comp.b.promedio !== null
                      ? [{
                          nombre: 'Total',
                          actualA: comp.a.promedio !== null ? Number(comp.a.promedio.toFixed(2)) : null,
                          deltaA: comp.a.promedio !== null && comp.a.promedioAnterior !== null ? Number((comp.a.promedio - comp.a.promedioAnterior).toFixed(2)) : null,
                          actualB: comp.b.promedio !== null ? Number(comp.b.promedio.toFixed(2)) : null,
                          deltaB: comp.b.promedio !== null && comp.b.promedioAnterior !== null ? Number((comp.b.promedio - comp.b.promedioAnterior).toFixed(2)) : null,
                          esTotal: true,
                        }]
                      : []),
                  ]}
                    nombreA={comp.a.nombre}
                    nombreB={comp.b.nombre}
                    anteriorNombre={comp.anteriorNombre}
                  />
                </div>
              </div>
            </div>
          </Card>
        </>
      )}

      {!comparacionActiva && (
      <>
      {/* 1 · KPIs: número primero (centrado), título debajo */}
      {/* Móvil: 2×2 con subtítulo abreviado (una por fila eran ~470 px de scroll antes del
          primer gráfico); escritorio: la fila de cuatro de siempre */}
      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
        {[
          {
            valor: a.kpis.promedio?.toFixed(2) ?? '—',
            titulo: 'Nota promedio',
            subCorto: a.kpis.anterior?.promedio != null && a.kpis.promedio !== null
              ? `${a.kpis.promedio - a.kpis.anterior.promedio >= 0 ? '↑' : '↓'} ${Math.abs(a.kpis.promedio - a.kpis.anterior.promedio).toFixed(2)}`
              : 'nota vigente',
            sub: a.kpis.anterior?.promedio != null && a.kpis.promedio !== null
              ? `${a.kpis.promedio - a.kpis.anterior.promedio >= 0 ? '↑' : '↓'} ${Math.abs(a.kpis.promedio - a.kpis.anterior.promedio).toFixed(2)} vs ciclo anterior`
              : 'nota final vigente',
            tono: a.kpis.anterior?.promedio != null && a.kpis.promedio !== null && a.kpis.promedio < a.kpis.anterior.promedio ? 'text-alerta' : 'text-emerald-700',
          },
          {
            valor: String(a.kpis.n), titulo: 'Evaluados',
            subCorto: a.distribucion.hayFiltro ? `de ${a.distribucion.nTotal}` : 'con resultado',
            sub: a.distribucion.hayFiltro ? `de ${a.distribucion.nTotal} en tu alcance` : 'con resultado en el ciclo',
            tono: 'text-gris',
          },
          {
            valor: `${pct(a.kpis.tramos.alto)}%`, titulo: 'Desempeño destacado',
            subCorto: `${a.kpis.tramos.alto} con ≥ 4.0`,
            sub: `${a.kpis.tramos.alto} persona${a.kpis.tramos.alto === 1 ? '' : 's'} con nota ≥ 4.0`,
            tono: 'text-emerald-700',
          },
          {
            valor: `${pct(a.kpis.tramos.bajo)}%`, titulo: 'En zona de atención',
            subCorto: `${a.kpis.tramos.bajo} con < 3.0`,
            sub: `${a.kpis.tramos.bajo} persona${a.kpis.tramos.bajo === 1 ? '' : 's'} con nota < 3.0`,
            tono: a.kpis.tramos.bajo > 0 ? 'text-alerta' : 'text-gris',
          },
        ].map((k) => (
          <div key={k.titulo} className="rounded-2xl border border-gris-claro bg-white px-3 py-3.5 text-center sm:px-5 sm:py-5">
            <p className="font-display text-2xl font-bold sm:text-3xl">{k.valor}</p>
            <p className="mt-1 text-[10px] font-bold uppercase leading-tight tracking-wide text-gris sm:text-[11px]">{k.titulo}</p>
            <p className={`mt-0.5 text-[10.5px] font-semibold sm:text-[11px] ${k.tono}`}>
              <span className="sm:hidden">{k.subCorto}</span>
              <span className="hidden sm:inline">{k.sub}</span>
            </p>
          </div>
        ))}
      </div>

      {/* 2 · Distribución: una sola gráfica; con filtro, la curva del total queda de referencia */}
      <Card
        titulo="Distribución de notas"
        ayuda="Cuántas personas caen en cada rango de nota final del ciclo, con la curva normal de referencia. Haz clic en un rango para ver quiénes están ahí; con un filtro activo, la línea punteada gris mantiene el total de la empresa como comparación."
        extra={a.distribucion.hayFiltro
          ? `${etiquetaFiltro} · ${a.distribucion.n} evaluado${a.distribucion.n === 1 ? '' : 's'} — línea gris punteada: total empresa (${a.kpis.n})`
          : `histograma + curva normal · ${a.kpis.n} evaluados`}
      >
        {a.distribucion.n === 0 ? (
          <Vacio>Nadie coincide con el filtro elegido en este ciclo.</Vacio>
        ) : (
          <HistogramaInteractivo
            bins={a.distribucion.bins}
            personasPorBin={a.distribucion.personasPorBin}
            curva={a.distribucion.curva}
            curvaRef={a.distribucion.curvaRef}
            notaMedia={a.distribucion.promedio}
            sigma={a.distribucion.sigma}
            mediaRef={a.distribucion.promedioRef}
            alto={190}
          />
        )}
        {a.distribucion.n > 0 && (
          <p className="mt-2 border-t border-hueso-2 pt-2 text-[11px] text-gris">
            Mediana {a.distribucion.mediana?.toFixed(2) ?? '—'} (la mitad está por encima) · desviación estándar σ {a.distribucion.sigma?.toFixed(2) ?? '—'} (qué tan dispersas son las notas). Haz clic en una barra para ver quiénes están.
          </p>
        )}
      </Card>

      {/* 3 · Evolución: tendencia multiciclo (card propio) */}
      <Card
        className="mt-5"
        titulo="Evolución entre ciclos"
        ayuda="Promedio general de cada ciclo cerrado, en orden cronológico: muestra si la organización mejora o retrocede entre evaluaciones. El detalle por área permite ver qué áreas empujan cada cambio."
        extra={a.distribucion.hayFiltro ? `${etiquetaFiltro} · nota promedio por ciclo` : 'nota promedio por ciclo · todos los ciclos'}
      >
        <div>
          <div>
            {/* Móvil: lienzo de ~360 px y tipografía legible; con más de 4 ciclos el
                contenedor scrollea en vez de comprimir el dibujo */}
            <div className="overflow-x-auto md:hidden">
              <EvolucionChart
                serie={a.evolucion.serieCiclos}
                alto={200}
                ancho={Math.max(340, a.evolucion.serieCiclos.length * 86)}
                movil
                anchoFijo={a.evolucion.serieCiclos.length * 86 > 340}
              />
            </div>
            <div className="hidden md:block">
              <EvolucionChart serie={a.evolucion.serieCiclos} alto={210} ancho={1120} />
            </div>
            <details className="group mt-3 rounded-xl border border-gris-claro">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2.5 text-[12.5px] font-bold transition hover:bg-hueso [&::-webkit-details-marker]:hidden">
                <span className="transition group-open:rotate-90">›</span>
                Detalle por área · vs {a.kpis.anterior?.nombre ?? 'ciclo anterior'} ({a.evolucion.personas.filter((p) => p.delta !== null).length} personas)
              </summary>
              <div className="space-y-2 px-4 pb-3">
                {(() => {
                  const conDelta = a.evolucion.personas.filter((p) => p.delta !== null)
                  if (conDelta.length === 0) return <Vacio>Sin ciclo anterior comparable: los deltas aparecerán desde el segundo ciclo.</Vacio>
                  const filaArea = new Map(a.painPoints.heatmap.map((f) => [f.area, f]))
                  const areas = [...new Set(conDelta.map((p) => p.area))].sort()
                  return areas.map((area) => {
                    const gente = conDelta.filter((p) => p.area === area).sort((x, y) => y.delta! - x.delta!)
                    const f = filaArea.get(area)
                    return (
                      <details key={area} className="group/area rounded-xl bg-hueso">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-[13px] transition hover:bg-hueso-2 [&::-webkit-details-marker]:hidden">
                          {/* El conteo fluía inline tras el nombre: con nombres largos caía a
                              la línea siguiente desalineado. En móvil baja de línea; en
                              escritorio sigue junto al nombre. */}
                          <span className="flex min-w-0 items-start gap-1.5">
                            <span className="mt-0.5 shrink-0 text-gris transition-transform group-open/area:rotate-90">▸</span>
                            <span className="min-w-0">
                              <span className="line-clamp-2 font-bold">
                                {area}
                                <span className="hidden text-xs font-semibold text-gris md:inline"> · {gente.length} persona{gente.length === 1 ? '' : 's'}</span>
                              </span>
                              <span className="block text-xs font-semibold text-gris md:hidden">{gente.length} persona{gente.length === 1 ? '' : 's'}</span>
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <Nota valor={f?.total ?? null} />
                            {f?.delta != null && (
                              <b className={`text-[12px] ${f.delta > 0 ? 'text-emerald-700' : f.delta < 0 ? 'text-alerta' : 'text-gris'}`}>
                                {f.delta > 0 ? '↑' : f.delta < 0 ? '↓' : '='} {Math.abs(f.delta).toFixed(2)}
                              </b>
                            )}
                          </span>
                        </summary>
                        {/* Subagrupado por jefe directo (mismo criterio del detalle del ciclo) */}
                        {/* El tope con scroll propio se pelea con el scroll de la página en
                            táctil: solo desde md */}
                        <div className="space-y-2 px-3.5 pb-3 pr-2 md:max-h-56 md:overflow-y-auto">
                          {[...new Set(gente.map((p) => p.jefe))]
                            .sort((j1, j2) => (j1 === 'Sin jefe directo' ? 1 : j2 === 'Sin jefe directo' ? -1 : j1.localeCompare(j2)))
                            .map((jefe) => {
                              const equipo = gente.filter((p) => p.jefe === jefe)
                              return (
                                <div key={jefe}>
                                  <p className="text-[11px] font-bold text-gris">Jefe: {jefe} <span className="font-semibold">· {equipo.length} persona{equipo.length === 1 ? '' : 's'}</span></p>
                                  <ul className="grid gap-x-6 gap-y-1 pl-2 sm:grid-cols-2 lg:grid-cols-3">
                                    {equipo.map((p) => (
                                      <li key={p.nombre} title={`${p.nombre} · ${p.puesto}`} className="flex items-center justify-between gap-2 border-b border-hueso-2 py-1 text-[12.5px]">
                                        <span className="truncate font-semibold">{p.nombre}</span>
                                        <span className="flex shrink-0 items-center gap-1.5">
                                          <span className="text-[11px] text-gris">{p.anterior!.toFixed(2)} →</span>
                                          <b className="text-marca">{p.actual.toFixed(2)}</b>
                                          <b className={`text-[11px] ${p.delta! > 0 ? 'text-emerald-700' : p.delta! < 0 ? 'text-alerta' : 'text-gris'}`}>
                                            {p.delta! > 0 ? '↑' : p.delta! < 0 ? '↓' : '='} {Math.abs(p.delta!).toFixed(2)}
                                          </b>
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )
                            })}
                        </div>
                      </details>
                    )
                  })
                })()}
              </div>
            </details>
          </div>
        </div>
      </Card>

      {/* 3b · Por dimensión: radar (izq) + cambio vs ciclo anterior (der) */}
      <Card
        className="mt-5"
        titulo="Comparación por dimensión"
        ayuda="Radar con el promedio del ciclo en cada dimensión, superpuesto al perfil esperado (punteado): la expectativa definida al configurar los puestos, promediada sobre los evaluados del corte. Muestra cuánto falta para llegar a ella. Las barras de la derecha miden el cambio vs el ciclo anterior."
        extra="perfil esperado (punteado) vs obtenido (rojo)"
      >
        <div className="grid items-center gap-8 lg:grid-cols-[3fr_2fr]">
          <div className="mx-auto w-full max-w-2xl">
            {/* Móvil: el radar se queda con la forma y los nombres bajan a una lista, donde
                caben completos y el esperado se puede leer como número */}
            <div className="md:hidden">
              <RadarDimensiones
                ariaLabel="Radar por dimensión: perfil esperado vs obtenido"
                sinEtiquetas
                dims={a.evolucion.dimVsAnterior.map((d, i) => ({
                  nombre: d.nombre,
                  color: colorDim(i),
                  valor: d.actual,
                  esperado: d.esperado ?? undefined,
                }))}
              />
              <p className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[10.5px] text-gris">
                <span>▬ obtenido</span>
                <span>┈ perfil esperado del puesto</span>
              </p>
              <ul className="mt-2.5 flex flex-col gap-1.5">
                {a.evolucion.dimVsAnterior.map((d, i) => (
                  <li key={d.nombre} className="flex items-center gap-2 text-[11.5px]">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorDim(i) }} />
                    <span className="min-w-0 flex-1 truncate">{d.nombre}</span>
                    <span className={`font-display font-extrabold tabular-nums ${
                      d.actual === null ? 'text-gris'
                        : d.esperado == null ? 'text-negro'
                        : d.actual >= d.esperado - 0.005 ? 'text-emerald-700'
                        : 'text-marca'
                    }`}>{d.actual?.toFixed(2) ?? '—'}</span>
                    {d.esperado != null && <span className="shrink-0 text-[10.5px] tabular-nums text-gris">esp. {d.esperado.toFixed(2)}</span>}
                  </li>
                ))}
              </ul>
            </div>
            <div className="hidden md:block">
              <RadarDimensiones
                ariaLabel="Radar por dimensión: perfil esperado vs obtenido"
                mostrarValores
                dims={a.evolucion.dimVsAnterior.map((d, i) => ({
                  nombre: d.nombre,
                  color: colorDim(i),
                  valor: d.actual,
                  esperado: d.esperado ?? undefined,
                }))}
              />
            </div>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gris">Cambio vs {a.kpis.anterior?.nombre ?? 'ciclo anterior'}</p>
            {/* Móvil: filas HTML (el SVG dejaba las cifras en 6 px y cortaba el nombre) */}
            <div className="md:hidden">
              <BarrasDeltaLista
                items={[
                  ...a.evolucion.dimVsAnterior,
                  ...(a.kpis.promedio !== null && a.kpis.anterior?.promedio != null
                    ? [{
                        nombre: 'Total',
                        actual: a.kpis.promedio,
                        delta: Number((a.kpis.promedio - a.kpis.anterior.promedio).toFixed(2)),
                        esTotal: true,
                      }]
                    : []),
                ]}
              />
            </div>
            <div className="hidden md:block">
              <BarrasDelta
                items={[
                  ...a.evolucion.dimVsAnterior,
                  ...(a.kpis.promedio !== null && a.kpis.anterior?.promedio != null
                    ? [{
                        nombre: 'Total',
                        actual: a.kpis.promedio,
                        delta: Number((a.kpis.promedio - a.kpis.anterior.promedio).toFixed(2)),
                        esTotal: true,
                      }]
                    : []),
                ]}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* 4 · Puntos de acción */}
      <Card className="mt-5" titulo="Puntos de acción" ayuda="Conclusiones generadas automáticamente a partir de los hallazgos del ciclo (alertas, tramos bajos, cambios relevantes vs el ciclo anterior), redactadas como acciones para RR.HH." extra="insights generados de los hallazgos del ciclo">
        <Insights insights={a.insights} />
      </Card>

      {/* 5 · Pain points: heatmap por área con columna Total (+Δ) y fila Total por dimensión */}
      <Card className="mt-5" titulo="Pain points por área y dimensión" ayuda="Promedio de cada área en cada dimensión. El color compara cada celda contra el total de su propia área: rojo = la dimensión más débil de esa área. Sirve para focalizar planes de desarrollo donde más duele." extra="colores según el total de cada área · Total con su cambio vs el ciclo anterior">
        <Heatmap
          heatmap={a.painPoints.heatmap}
          dimensiones={a.painPoints.dimensiones}
          personas={a.painPoints.personas}
          totalPorDimension={a.painPoints.dimensiones.map((d) => a.painPoints.rankingDim.find((r) => r.nombre === d)?.promedio ?? null)}
          totalGeneral={a.kpis.promedio}
          deltaGeneral={a.kpis.promedio !== null && a.kpis.anterior?.promedio != null
            ? Number((a.kpis.promedio - a.kpis.anterior.promedio).toFixed(2))
            : null}
          nTotal={a.kpis.n}
        />
      </Card>

      {/* 5 · Alertas 2×2 */}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <Card titulo="Outliers estadísticos" ayuda="Personas cuya nota se aleja mucho del promedio de su puesto o nivel (±1.5 desviaciones estándar). Verde = muy por encima (candidato a reconocimiento); rojo = muy por debajo (PDI prioritario y seguimiento cercano)." extra={`fuera de ±1.5σ de su grupo · ${a.alertas.outliers.length} caso${a.alertas.outliers.length === 1 ? '' : 's'}`}>
          {a.alertas.outliers.length === 0 ? <Vacio>Nadie se aleja significativamente de su grupo.</Vacio> : (
            <ul className="space-y-1.5">
              {a.alertas.outliers.map((o) => (
                <li key={o.nombre} className={`rounded-xl border px-3.5 py-2 text-[13px] ${o.alto ? 'border-emerald-200 bg-emerald-50/60' : 'border-red-200 bg-red-50/60'}`}>
                  <b>{o.nombre}</b>
                  <span className="mt-0.5 block text-xs text-gris md:mt-0 md:ml-1 md:inline md:text-[13px] md:text-negro">
                    <span className="md:hidden">{o.alto ? 'muy por encima' : 'muy por debajo'} · </span>
                    <b className="text-negro">{o.nota.toFixed(2)}</b> vs {o.promedioGrupo.toFixed(2)} de {o.grupo} <span className="text-xs text-gris">(z {o.z > 0 ? '+' : ''}{o.z})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card titulo="Brecha de autopercepción" ayuda="Personas cuya autoevaluación difiere en 0.8 o más de la nota que les puso su jefe: se sobreestiman o se subestiman. Útil para preparar la conversación de retroalimentación con contexto." extra={`|auto − jefe| ≥ 0.8 · ${a.alertas.brechasAuto.length} caso${a.alertas.brechasAuto.length === 1 ? '' : 's'}`}>
          {a.alertas.brechasAuto.length === 0 ? <Vacio>Autoevaluaciones alineadas con la mirada del jefe.</Vacio> : (
            <ul className="space-y-1.5">
              {a.alertas.brechasAuto.map((b) => (
                <li key={b.nombre} className="rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-2 text-[13px]">
                  <b>{b.nombre}</b>
                  <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-bold text-amber-900 md:hidden">{b.seSobreestima ? 'se sobreestima' : 'se subestima'}</span>
                  <span className="mt-0.5 block text-xs text-gris md:mt-0 md:ml-1 md:inline md:text-[13px] md:text-negro">
                    <span className="hidden md:inline">{b.seSobreestima ? 'se sobreestima' : 'se subestima'}: </span>
                    auto {b.auto.toFixed(2)} vs jefe {b.jefe.toFixed(2)} <span className="text-xs text-gris">(Δ {b.brecha > 0 ? '+' : ''}{b.brecha})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card titulo="Sesgo del evaluador" ayuda="Jefes cuyo equipo completo puntúa 0.5 o más por encima o por debajo del promedio general: evaluadores sistemáticamente blandos o duros. Es un insumo directo para la sesión de calibración." extra={`equipos que puntean ≥ 0.5 sobre/bajo el promedio · ${a.alertas.sesgoJefes.length} jefe${a.alertas.sesgoJefes.length === 1 ? '' : 's'}`}>
          {a.alertas.sesgoJefes.length === 0 ? <Vacio>Sin jefes sistemáticamente duros o blandos en este ciclo.</Vacio> : (
            <ul className="space-y-1.5">
              {a.alertas.sesgoJefes.map((s) => (
                <li key={s.jefe} className="rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-2 text-[13px]">
                  <b>{s.jefe}</b>
                  <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-bold text-amber-900 md:hidden">{s.duro ? 'más duro' : 'más alto'}</span>
                  <span className="mt-0.5 block text-xs text-gris md:mt-0 md:ml-1 md:inline md:text-[13px] md:text-negro">
                    <span className="hidden md:inline">evalúa {s.duro ? 'más duro' : 'más alto'} que el resto: </span>
                    {s.equipo} evaluado{s.equipo === 1 ? '' : 's'} · promedio {s.promedio.toFixed(2)} ({s.desvio > 0 ? '+' : ''}{s.desvio})
                  </span>
                  <span className="mt-0.5 block text-[11px] font-semibold text-amber-800 md:hidden">Revisar en calibración</span>
                  <span className="hidden md:inline"> — revisar en calibración</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card titulo="Competencias vs objetivos descuadrados" ayuda="Personas cuya nota de competencias (cómo trabaja, según el 360) y su cumplimiento de objetivos (qué logró) difieren en 1 punto o más en la escala 1–5. Suele indicar metas mal calibradas: demasiado fáciles o poco realistas." extra={`brecha ≥ 1.0 en escala 1–5 · ${a.alertas.descuadres.length} caso${a.alertas.descuadres.length === 1 ? '' : 's'}`}>
          {a.alertas.descuadres.length === 0 ? <Vacio>Competencias y objetivos cuentan la misma historia.</Vacio> : (
            <ul className="space-y-1.5">
              {a.alertas.descuadres.map((d) => (
                <li key={d.nombre} className="rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-2 text-[13px]">
                  <b>{d.nombre}</b>
                  <span className="mt-0.5 block text-xs text-gris md:mt-0 md:ml-1 md:inline md:text-[13px] md:text-negro">
                    competencias {d.comp.toFixed(2)} vs objetivos {d.obj.toFixed(2)} <span className="text-xs text-gris">(Δ {d.brecha > 0 ? '+' : ''}{d.brecha})</span>
                  </span>
                  <span className="mt-0.5 block text-[11px] font-semibold text-amber-800 md:hidden">Revisar definición de metas</span>
                  <span className="hidden md:inline"> — revisar definición de metas</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      </>
      )}
    </>
  )
}
