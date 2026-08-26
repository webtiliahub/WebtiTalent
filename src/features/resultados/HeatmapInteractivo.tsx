'use client'

import { useState } from 'react'
import type { AnalisisCiclo } from './analisis'

/** Heatmap área × dimensión con columna TOTAL al final (con su Δ vs el ciclo anterior) y fila
 * TOTAL al pie (promedio del ciclo por dimensión): el color de cada dimensión es RELATIVO
 * al total de su área (resalta de qué cojea cada área). Clic en una celda de dimensión abre
 * el detalle por persona agrupado área → jefe directo (mismo patrón del histograma);
 * la fila Total abre la dimensión completa (todas las áreas). */
export function Heatmap({ heatmap, dimensiones, personas, totalPorDimension, totalGeneral, deltaGeneral, nTotal }: {
  heatmap: AnalisisCiclo['painPoints']['heatmap']
  dimensiones: string[]
  personas: AnalisisCiclo['painPoints']['personas']
  totalPorDimension: (number | null)[]
  totalGeneral: number | null
  deltaGeneral: number | null
  nTotal: number
}) {
  // Celda seleccionada: índice de dimensión + área (null = fila Total → todas las áreas)
  const [sel, setSel] = useState<{ dim: number; area: string | null } | null>(null)
  const alternar = (dim: number, area: string | null) =>
    setSel(sel && sel.dim === dim && sel.area === area ? null : { dim, area })
  const activa = (dim: number, area: string | null) => sel !== null && sel.dim === dim && sel.area === area

  const tonoAbs = (v: number | null) =>
    v === null ? 'bg-hueso text-gris'
    : v < 3.5 ? 'bg-red-50 text-red-800'
    : v < 4.0 ? 'bg-amber-50 text-amber-800'
    : 'bg-emerald-50 text-emerald-800'
  const tonoRel = (v: number | null, total: number | null) => {
    if (v === null || total === null) return 'bg-hueso text-gris'
    const d = v - total
    return d <= -0.15 ? 'bg-red-50 text-red-800' : d >= 0.15 ? 'bg-emerald-50 text-emerald-800' : 'bg-hueso text-negro/70'
  }
  const celdaCls = (base: string, clicable: boolean, seleccionada: boolean) =>
    `w-full rounded-lg px-1 py-2 font-bold transition ${base} ${clicable ? 'cursor-pointer hover:ring-2 hover:ring-marca/40' : ''} ${seleccionada ? 'ring-2 ring-marca' : ''}`

  /* Móvil: un acordeón por área en vez de la tabla (que pide ~1140 px y deja la columna de
     área fuera de vista al arrastrar). Dentro, las dimensiones ordenadas de PEOR A MEJOR:
     el pain point de cada área queda en la primera línea, que es para lo que existe la vista. */
  const filaTotalMovil = (
    <details className="rounded-xl border border-gris-claro bg-hueso">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2 text-[12.5px] font-extrabold">
          <span className="shrink-0 text-gris transition group-open:rotate-90">›</span>
          Total organización
          <span className="text-[10.5px] font-semibold text-gris">· {nTotal}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="font-display text-[15px] font-extrabold text-marca">{totalGeneral?.toFixed(2) ?? '—'}</span>
          {deltaGeneral !== null && Math.abs(deltaGeneral) >= 0.005 && (
            <span className={`text-[11px] font-bold ${deltaGeneral > 0 ? 'text-emerald-700' : 'text-alerta'}`}>
              {deltaGeneral > 0 ? '↑' : '↓'} {Math.abs(deltaGeneral).toFixed(2)}
            </span>
          )}
        </span>
      </summary>
      <ul className="flex flex-col gap-1 px-3 pb-3">
        {totalPorDimension
          .map((v, i) => ({ v, i }))
          .sort((x, y) => (x.v ?? 9) - (y.v ?? 9))
          .map(({ v, i }) => (
            <li key={dimensiones[i]}>
              <button
                type="button"
                disabled={v === null}
                onClick={() => alternar(i, null)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11.5px] ${tonoAbs(v)} ${activa(i, null) ? 'ring-2 ring-marca' : ''}`}
              >
                <span className="min-w-0 flex-1 truncate">{dimensiones[i]}</span>
                <span className="font-display font-extrabold tabular-nums">{v?.toFixed(2) ?? '—'}</span>
              </button>
            </li>
          ))}
      </ul>
    </details>
  )

  return (
    <div>
      <div className="flex flex-col gap-2 md:hidden">
        {heatmap.map((fila) => (
          <details key={fila.area} className="group rounded-xl border border-gris-claro bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2.5 [&::-webkit-details-marker]:hidden">
              <span className="flex min-w-0 items-center gap-2 text-[12.5px] font-bold">
                <span className="shrink-0 text-gris transition group-open:rotate-90">›</span>
                <span className="truncate">{fila.area}</span>
                <span className="shrink-0 text-[10.5px] font-semibold text-gris">· {fila.n}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-display text-[15px] font-extrabold text-marca">{fila.total?.toFixed(2) ?? '—'}</span>
                {fila.delta === null ? null : Math.abs(fila.delta) < 0.005 ? (
                  <span className="text-[11px] font-bold text-gris">=</span>
                ) : (
                  <span className={`text-[11px] font-bold ${fila.delta > 0 ? 'text-emerald-700' : 'text-alerta'}`}>
                    {fila.delta > 0 ? '↑' : '↓'} {Math.abs(fila.delta).toFixed(2)}
                  </span>
                )}
              </span>
            </summary>
            <ul className="flex flex-col gap-1 px-3 pb-3">
              {fila.celdas
                .map((c, i) => ({ c, i }))
                .sort((x, y) => (x.c.promedio ?? 9) - (y.c.promedio ?? 9))
                .map(({ c, i }) => (
                  <li key={c.dim}>
                    <button
                      type="button"
                      disabled={c.n === 0}
                      onClick={() => alternar(i, fila.area)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11.5px] ${tonoRel(c.promedio, fila.total)} ${activa(i, fila.area) ? 'ring-2 ring-marca' : ''}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{c.dim}</span>
                      <span className="font-display font-extrabold tabular-nums">{c.promedio?.toFixed(2) ?? '—'}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </details>
        ))}
        {filaTotalMovil}
      </div>

      <div className="hidden overflow-x-auto md:block">
      {/* table-fixed + colgroup: las dimensiones se reparten el ancho en partes IGUALES
          (la tabla tiene un mínimo para que el título más largo no se corte) */}
      <table className="w-full table-fixed text-[12.5px]" style={{ minWidth: `${190 + 96 + 104 + dimensiones.length * 150}px` }}>
        <colgroup>
          <col style={{ width: 190 }} />
          {dimensiones.map((d) => <col key={d} />)}
          <col style={{ width: 96 }} />
          <col style={{ width: 104 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="py-2 pr-2 text-left text-[10px] font-bold uppercase tracking-wide text-gris">Área</th>
            {dimensiones.map((d) => (
              <th key={d} className="px-1 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-gris">{d.split(' / ')[0]}</th>
            ))}
            <th className="px-1 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-gris">Total</th>
            <th className="px-1 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-gris">Δ vs anterior</th>
          </tr>
        </thead>
        <tbody>
          {heatmap.map((fila) => (
            <tr key={fila.area}>
              <td className="truncate py-1 pr-2 font-bold" title={`${fila.area} · ${fila.n} evaluado${fila.n === 1 ? '' : 's'}`}>
                {fila.area} <span className="text-[10px] font-semibold text-gris">· {fila.n}</span>
              </td>
              {fila.celdas.map((c, i) => (
                <td key={c.dim} className="p-0.5 text-center">
                  <button
                    type="button"
                    disabled={c.n === 0}
                    onClick={() => alternar(i, fila.area)}
                    className={celdaCls(tonoRel(c.promedio, fila.total), c.n > 0, activa(i, fila.area))}
                    title={`${c.dim} · ${fila.area} · ${c.n} evaluado${c.n === 1 ? '' : 's'}${c.n > 0 ? ' — clic para ver el detalle por persona' : ''}`}
                  >
                    {c.promedio?.toFixed(2) ?? '—'}
                  </button>
                </td>
              ))}
              <td className="p-0.5 text-center">
                <div className={`rounded-lg px-1 py-2 font-bold ${tonoAbs(fila.total)}`} title={`Nota promedio del área (${fila.n} evaluados)`}>
                  {fila.total?.toFixed(2) ?? '—'}
                </div>
              </td>
              <td className="p-0.5 text-center" title="Cambio del total del área vs el ciclo anterior">
                {fila.delta === null ? (
                  <span className="text-gris">—</span>
                ) : Math.abs(fila.delta) < 0.005 ? (
                  <span className="text-[11px] font-bold text-gris">= igual</span>
                ) : (
                  <span className={`font-bold ${fila.delta > 0 ? 'text-emerald-700' : 'text-alerta'}`}>
                    {fila.delta > 0 ? '↑' : '↓'} {Math.abs(fila.delta).toFixed(2)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-hueso-2">
            <td className="truncate py-1.5 pr-2 font-bold uppercase tracking-wide text-[11px]" title={`Promedio del ciclo (${nTotal} evaluados)`}>
              Total <span className="text-[10px] font-semibold normal-case tracking-normal text-gris">· {nTotal}</span>
            </td>
            {totalPorDimension.map((v, i) => (
              <td key={dimensiones[i]} className="p-0.5 text-center">
                <button
                  type="button"
                  disabled={v === null}
                  onClick={() => alternar(i, null)}
                  className={celdaCls(tonoAbs(v), v !== null, activa(i, null))}
                  title={`Promedio del ciclo en ${dimensiones[i]}${v !== null ? ' — clic para ver el detalle por persona en todas las áreas' : ''}`}
                >
                  {v?.toFixed(2) ?? '—'}
                </button>
              </td>
            ))}
            <td className="p-0.5 text-center">
              <div className={`rounded-lg px-1 py-2 font-bold ${tonoAbs(totalGeneral)}`} title="Nota promedio del ciclo">
                {totalGeneral?.toFixed(2) ?? '—'}
              </div>
            </td>
            <td className="p-0.5 text-center" title="Cambio del promedio del ciclo vs el anterior">
              {deltaGeneral === null ? (
                <span className="text-gris">—</span>
              ) : Math.abs(deltaGeneral) < 0.005 ? (
                <span className="text-[11px] font-bold text-gris">= igual</span>
              ) : (
                <span className={`font-bold ${deltaGeneral > 0 ? 'text-emerald-700' : 'text-alerta'}`}>
                  {deltaGeneral > 0 ? '↑' : '↓'} {Math.abs(deltaGeneral).toFixed(2)}
                </span>
              )}
            </td>
          </tr>
        </tfoot>
      </table>
      </div>

      {/* Panel inferior (patrón del histograma): notas de la dimensión elegida por persona,
          agrupadas por área y subagrupadas por jefe directo */}
      {sel && (() => {
        const dimNombre = dimensiones[sel.dim]
        const gente = personas.filter((p) => p.notas[sel.dim] !== null && (sel.area === null || p.area === sel.area))
        if (gente.length === 0) return null
        const prom = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
        const areas = [...new Set(gente.map((p) => p.area))].sort()
        const jefesDe = (lista: typeof gente) => [...new Set(lista.map((p) => p.jefe))]
          .sort((a, b) => (a === 'Sin jefe directo' ? 1 : b === 'Sin jefe directo' ? -1 : a.localeCompare(b)))
        return (
          <div className="mt-3 rounded-xl border border-gris-claro bg-hueso/40 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gris">
                {dimNombre} · {sel.area ?? 'todas las áreas'} · {gente.length} persona{gente.length === 1 ? '' : 's'}
              </p>
              <button onClick={() => setSel(null)} title="Cerrar" className="grid h-6 w-6 place-items-center rounded-lg text-xs text-gris transition hover:bg-hueso hover:text-negro">✕</button>
            </div>
            {/* El tope con scroll propio pelea con el scroll de la página en táctil: solo desde md */}
            <div className="space-y-3 pr-1 md:max-h-96 md:overflow-y-auto">
              {areas.map((area) => {
                const delArea = gente.filter((p) => p.area === area)
                return (
                  <div key={area}>
                    <p className="flex items-center justify-between gap-2 border-b border-gris-claro pb-1 text-[12.5px] font-bold">
                      <span className="truncate">{area}</span>
                      <span className="shrink-0 text-[11px] font-semibold text-gris">
                        {delArea.length} persona{delArea.length === 1 ? '' : 's'} · prom. {prom(delArea.map((p) => p.notas[sel.dim]!)).toFixed(2)}
                      </span>
                    </p>
                    {jefesDe(delArea).map((jefe) => {
                      const equipo = delArea.filter((p) => p.jefe === jefe).sort((x, y) => y.notas[sel.dim]! - x.notas[sel.dim]!)
                      return (
                        <div key={jefe} className="mt-1.5 pl-2">
                          <p className="text-[11px] font-bold text-gris">
                            Jefe: {jefe} <span className="font-semibold">· {equipo.length} · prom. {prom(equipo.map((p) => p.notas[sel.dim]!)).toFixed(2)}</span>
                          </p>
                          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                            {equipo.map((p) => (
                              <li key={p.nombre} className="flex items-center justify-between gap-2 border-b border-hueso-2 py-1 text-[12.5px]">
                                <span className="truncate font-semibold">{p.nombre}</span>
                                <span className="shrink-0 font-bold text-marca">{p.notas[sel.dim]!.toFixed(2)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      <p className="mt-2 text-[10.5px] text-gris">
        Las dimensiones se colorean <b>respecto del total de su área</b>: rojo = por debajo, verde = por encima — muestra de qué cojea cada área.
        <b> Total</b>: nota promedio (semáforo absoluto: rojo &lt;3.5 · ámbar &lt;4.0 · verde ≥4.0) con su cambio vs el ciclo anterior; la fila <b>Total</b> es el promedio del ciclo por dimensión.
        Haz clic en una celda para ver las notas de esa dimensión por persona (área → jefe directo).
      </p>
    </div>
  )
}
