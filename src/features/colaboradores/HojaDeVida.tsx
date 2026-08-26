import Link from 'next/link'
import { prisma } from '@/shared/lib/prisma'
import { etiquetaNota } from '@/domain/calculo'
import { Avatar, Card, Chip, NivelChip, Nota, Vacio } from '@/shared/ui/componentes'
import { RadarDimensiones, LeyendaRadar, colorDim } from '@/shared/ui/RadarDimensiones'
import { badgeNota, cardNota } from '@/shared/ui/desempeno'
import type { DimensionResultado } from '@/features/resultados/servicio'

/**
 * Ficha del colaborador. `verComoGestor` habilita datos confidenciales (9-Box) —
 * solo para RR.HH. o el jefe directo; el propio colaborador NUNCA ve su 9-Box.
 */
export async function HojaDeVida({ colaboradorId, verComoGestor = false, origenGestor = 'equipo' }: { colaboradorId: string; verComoGestor?: boolean; origenGestor?: 'equipo' | 'admin' }) {
  const c = await prisma.colaborador.findUniqueOrThrow({
    where: { id: colaboradorId },
    include: {
      pais: true, area: true,
      puesto: { include: { nivel: true, competencias: { include: { competencia: { include: { dimension: true } } } }, pesos: { include: { dimension: true } } } },
      jefe: true,
      equipo: { where: { activo: true } },
      resultados: { include: { ciclo: { include: { cierresPais: { where: { publicado: true } } } } }, orderBy: { ciclo: { fechaInicio: 'desc' } } },
    },
  })

  const nombre = `${c.nombres} ${c.apellidos}`
  // Publicado para el colaborador: publicación global del ciclo O la de su país (cierre por país)
  const resultadosPublicados = c.resultados.filter((r) =>
    verComoGestor || r.ciclo.publicado || r.ciclo.cierresPais.some((cp) => cp.paisId === c.paisId))
  const notaUltima = resultadosPublicados[0] ? (resultadosPublicados[0].notaCalibrada ?? resultadosPublicados[0].notaFinal) : null

  // Radar: perfil esperado del puesto (gris al fondo) vs obtenido en el último ciclo (pintado)
  const ultimoConDesglose = resultadosPublicados.find((r) => Array.isArray(r.desgloseDimJson) && (r.desgloseDimJson as unknown[]).length > 0)
  const desglose = (ultimoConDesglose?.desgloseDimJson as DimensionResultado[] | undefined) ?? []
  const obtenidoDe = new Map(desglose.map((d) => [d.dimensionId, d.ajuste ?? d.nota]))
  const dimsRadar = (c.puesto?.pesos ?? [])
    .slice()
    .sort((a, b) => b.peso - a.peso)
    .map((p, i) => ({
      nombre: p.dimension.nombre,
      color: colorDim(i),
      valor: obtenidoDe.get(p.dimensionId) ?? null,
      esperado: p.puntajeEsperado,
    }))

  return (
    <div className="space-y-5">
      {/* Identidad — con la tarjeta viva del nivel de su última evaluación publicada */}
      <Card className={notaUltima !== null ? cardNota(notaUltima) : ''}>
        <div className="flex flex-wrap items-center gap-5">
          <Avatar nombre={nombre} size="lg" />
          <div className="min-w-52">
            <h2 className="font-display text-xl font-extrabold">{nombre}</h2>
            <p className="flex flex-wrap items-center gap-2 text-sm text-gris">
              {c.puesto?.nombre ?? 'Sin puesto asignado'}
              {notaUltima !== null && (
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${badgeNota(notaUltima)}`} title={`${resultadosPublicados[0].ciclo.nombre} · nota ${notaUltima.toFixed(2)}`}>
                  {etiquetaNota(notaUltima)}
                </span>
              )}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {c.puesto && <NivelChip nivel={c.puesto.nivel.nombre} />}
              {c.nivelLiderazgo && (
                <Chip tono="azul">Liderazgo {c.nivelLiderazgo === 'ESTRATEGICO' ? 'estratégico' : c.nivelLiderazgo === 'TACTICO' ? 'táctico' : 'operativo'}</Chip>
              )}
              <Chip>{c.area?.nombre ?? 'Sin área'}</Chip>
              <Chip>{c.pais.nombre}</Chip>
            </div>
          </div>
          {/* Móvil: filas etiqueta-izquierda / valor-derecha (los nombres largos no se cortan);
              escritorio: la grilla de siempre */}
          <dl className="w-full grid grid-cols-1 text-sm md:ml-auto md:w-auto md:grid-cols-3 md:gap-x-10 md:gap-y-2">
            {([
              ['Jefe directo', c.jefe ? `${c.jefe.nombres} ${c.jefe.apellidos}` : '—'],
              ...(c.codigo ? [['Código', c.codigo] as const] : []),
              ['Documento', c.documento],
              ['Ingreso', c.fechaIngreso ? c.fechaIngreso.toLocaleDateString('es-PE', { year: 'numeric', month: 'short' }) : '—'],
              ...(c.telefono ? [['Teléfono', c.telefono] as const] : []),
              ...(c.equipo.length > 0 ? [['Equipo a cargo', `${c.equipo.length} colaboradores`] as const] : []),
            ] as const).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 border-b border-gris-claro/50 py-1.5 last:border-0 md:block md:border-0 md:py-0">
                <dt className="shrink-0 text-[11px] font-bold uppercase text-gris">{k}</dt>
                <dd className="text-right md:text-left">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>

      {/* Radar + pesos + competencias. En MÓVIL el orden prioriza lo visual (radar → pesos →
          competencias, diseño A validado el 20/08); en escritorio se conserva la grilla de
          siempre (competencias izquierda, radar derecha, pesos a lo ancho) vía `order`. */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          className="order-1 lg:order-2"
          titulo="Perfil por dimensión"
          extra={ultimoConDesglose ? `obtenido en ${ultimoConDesglose.ciclo.nombre}` : 'perfil esperado del puesto'}
        >
          {dimsRadar.length >= 3 ? (
            <>
              <RadarDimensiones
                dims={dimsRadar}
                ariaLabel="Perfil por dimensión: esperado del puesto vs obtenido en la evaluación"
              />
              {ultimoConDesglose
                ? <LeyendaRadar etiquetaObtenido={`Obtenido · ${ultimoConDesglose.ciclo.nombre}`} />
                : <p className="text-center text-[11px] text-gris">Perfil esperado del puesto · aún sin resultados publicados</p>}
            </>
          ) : <Vacio>El puesto necesita al menos 3 dimensiones con peso para el radar.</Vacio>}
        </Card>

        {c.puesto && c.puesto.pesos.length > 0 && (
          <Card className="order-2 lg:order-3 lg:col-span-2" titulo="Pesos por dimensión" extra="definidos en el descriptor del puesto">
            <div className="flex h-5 w-full overflow-hidden rounded-full">
              {c.puesto.pesos.slice().sort((a, b) => b.peso - a.peso).map((p, i) => (
                <div
                  key={p.dimensionId}
                  title={`${p.dimension.nombre} · ${p.peso}%`}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  style={{ width: `${p.peso}%`, backgroundColor: colorDim(i) }}
                />
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
              {c.puesto.pesos.slice().sort((a, b) => b.peso - a.peso).map((p, i) => (
                <li key={p.dimensionId} className="inline-flex items-center gap-1.5 text-xs">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorDim(i) }} />
                  <span className="font-semibold">{p.dimension.nombre}</span>
                  <span className="text-gris">{p.peso}%</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card className="order-3 lg:order-1" titulo="Competencias del puesto" extra={c.puesto?.nombre}>
          {c.puesto ? (() => {
            // Acordeón por dimensión (móvil Y escritorio: el muro de 20+ filas fatiga en ambos).
            // El orden y el color de cada dimensión son LOS MISMOS de pesos/radar (peso desc),
            // para que las tres secciones se lean como un solo sistema.
            const ordenColor = new Map(
              (c.puesto.pesos ?? []).slice().sort((a, b) => b.peso - a.peso).map((p, i) => [p.dimensionId, i]),
            )
            const grupos = new Map<string, { nombre: string; items: string[] }>()
            for (const { competencia } of c.puesto.competencias) {
              const g = grupos.get(competencia.dimensionId) ?? { nombre: competencia.dimension.nombre, items: [] }
              g.items.push(competencia.nombre)
              grupos.set(competencia.dimensionId, g)
            }
            const ordenados = [...grupos.entries()].sort(
              ([a], [b]) => (ordenColor.get(a) ?? 99) - (ordenColor.get(b) ?? 99),
            )
            return (
              <div className="space-y-2">
                {ordenados.map(([dimensionId, g]) => {
                  const idx = ordenColor.get(dimensionId)
                  return (
                    <details key={dimensionId} className="group rounded-xl border border-gris-claro/70 bg-hueso/60">
                      <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-4 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
                        <span className="flex items-center gap-2.5 font-semibold">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: idx !== undefined ? colorDim(idx) : '#a39d96' }} />
                          {g.nombre}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 text-xs text-gris">
                          {g.items.length}
                          <span className="transition-transform group-open:rotate-90">›</span>
                        </span>
                      </summary>
                      <ul className="space-y-1 px-4 pb-3">
                        {g.items.map((nombreComp) => (
                          <li key={nombreComp} className="border-t border-gris-claro/50 pt-2 text-sm text-negro/80 first:border-t-0 first:pt-0">
                            {nombreComp}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )
                })}
              </div>
            )
          })() : <Vacio>Este colaborador aún no tiene puesto asignado.</Vacio>}
        </Card>
      </div>

      {/* Historial de evaluaciones */}
      <Card titulo="Historial de evaluaciones">
        {resultadosPublicados.length === 0 ? (
          <Vacio>Sin resultados publicados todavía.</Vacio>
        ) : (
          <ul className="space-y-2">
            {resultadosPublicados.map((r) => {
              const nota = r.notaCalibrada ?? r.notaFinal
              const contenido = (
                <>
                  <div>
                    <p className="text-sm font-semibold">{r.ciclo.nombre}</p>
                    <p className="text-xs text-gris">
                      {c.puesto ? c.puesto.nivel.nombre : ''}
                      {verComoGestor && r.box ? ` · 9-Box: ${r.box}` : ''}
                    </p>
                  </div>
                  <div className="ml-auto text-right">
                    <Nota valor={nota} />
                    {nota !== null && <p className="text-[11px] text-gris">{etiquetaNota(nota)}</p>}
                  </div>
                </>
              )
              // Enlaza al detalle del resultado de ese ciclo (histórico navegable): la hoja propia
              // a «Mi resultado»; el jefe/RR.HH. a la consulta del colaborador (solo publicados —
              // lo no publicado se revisa en la calibración del ciclo)
              const publicado = r.ciclo.publicado || r.ciclo.cierresPais.some((cp) => cp.paisId === c.paisId)
              const href = verComoGestor
                ? (publicado ? `/equipo/${c.id}/resultado?ciclo=${r.cicloId}${origenGestor === 'admin' ? '&desde=admin' : ''}` : null)
                : `/mi-resultado?ciclo=${r.cicloId}`
              return (
                <li key={r.id}>
                  {href === null ? (
                    <div className="flex items-center gap-4 rounded-xl border border-gris-claro px-4 py-3">
                      {contenido}
                      <span className="shrink-0 rounded-full bg-hueso-2 px-2 py-0.5 text-[10px] font-bold text-gris">sin publicar</span>
                    </div>
                  ) : (
                    <Link href={href} className="group flex items-center gap-4 rounded-xl border border-gris-claro px-4 py-3 transition hover:border-marca/40 hover:bg-hueso">
                      {contenido}
                      <span className="text-gris transition group-hover:translate-x-0.5 group-hover:text-negro">→</span>
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
