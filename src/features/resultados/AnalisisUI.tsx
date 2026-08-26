import Link from 'next/link'
import type { AnalisisCiclo } from './analisis'

/** UI del Análisis del ciclo: SVG propios server-rendered (sin librerías), estilo de la casa. */

export function SwitcherResultados({ activo, query = '' }: { activo: '9box' | 'analisis'; query?: string }) {
  // Móvil: dos pastillas de media pantalla (como los tabs del ciclo); escritorio: ancho natural
  const pill = (on: boolean) =>
    `rounded-full px-4 py-2 text-center text-[13px] font-bold transition md:py-1.5 ${on ? 'bg-hunter text-white shadow-md shadow-hunter/30' : 'border border-gris-claro bg-white hover:bg-hueso'}`
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 md:flex md:items-center">
      <Link href={`/admin/resultados${query}`} className={pill(activo === '9box')}>🎯 9-Box</Link>
      <Link href={`/admin/resultados/analisis${query}`} className={pill(activo === 'analisis')}>
        📊 <span className="md:hidden">Análisis</span><span className="hidden md:inline">Análisis del ciclo</span>
      </Link>
    </div>
  )
}

export function DeltaChip({ actual, anterior, dec = 2, invertir = false }: { actual: number | null; anterior: number | null | undefined; dec?: number; invertir?: boolean }) {
  if (actual === null || anterior === null || anterior === undefined) return null
  const d = actual - anterior
  if (Math.abs(d) < 0.005) return <span className="text-[11px] font-bold text-gris">= igual</span>
  const positivo = invertir ? d < 0 : d > 0
  return (
    <span className={`text-[11px] font-bold ${positivo ? 'text-emerald-700' : 'text-hunter'}`}>
      {d > 0 ? '↑' : '↓'} {Math.abs(d).toFixed(dec)} vs anterior
    </span>
  )
}

/** Línea de evolución del promedio por ciclo (eje X: fecha de cierre de cada evaluación).
 * `movil`: lienzo a la medida del teléfono y tipografía mayor — con el lienzo de escritorio
 * (1120 px) comprimido a 307, las etiquetas de 8.5 px acababan midiendo 2.3 px reales. */
export function EvolucionChart({ serie, alto = 170, ancho = 560, movil = false, anchoFijo = false }: {
  serie: { nombre: string; cierre: string; promedio: number; n: number; actual: boolean }[]
  alto?: number
  ancho?: number
  movil?: boolean
  anchoFijo?: boolean // el SVG mide `ancho` px: con muchos ciclos el contenedor scrollea en vez de comprimir
}) {
  const W = ancho, H = alto, PAD = Math.max(movil ? 22 : 30, W * (movil ? 0.06 : 0.09))
  if (serie.length === 0) return null
  const min = Math.max(1, Math.min(...serie.map((s) => s.promedio)) - 0.4)
  const max = Math.min(5, Math.max(...serie.map((s) => s.promedio)) + 0.4)
  const x = (i: number) => (serie.length === 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (serie.length - 1))
  const y = (v: number) => H - 30 - ((v - min) / Math.max(0.01, max - min)) * (H - 58)
  const fs = movil
    ? { nota: 'text-[12px]', fecha: 'text-[10.5px]', n: 'text-[9.5px]' }
    : { nota: 'text-[10px]', fecha: 'text-[9px]', n: 'text-[8.5px]' }
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={anchoFijo ? undefined : 'w-full'}
      style={anchoFijo ? { width: W, maxWidth: 'none' } : undefined}
    >
      <polyline points={serie.map((s, i) => `${x(i)},${y(s.promedio)}`).join(' ')} fill="none" className="stroke-hunter" strokeWidth={movil ? 2.5 : 2} />
      {serie.map((s, i) => (
        <g key={s.nombre}>
          <circle cx={x(i)} cy={y(s.promedio)} r={s.actual ? (movil ? 6 : 5) : (movil ? 4 : 3.5)} className={s.actual ? 'fill-hunter' : 'fill-hunter/60'} />
          <text x={x(i)} y={y(s.promedio) - (movil ? 11 : 9)} textAnchor="middle" className={`fill-negro font-bold ${fs.nota}`}>{s.promedio.toFixed(2)}</text>
          <title>{s.nombre}</title>
          <text x={x(i)} y={H - 14} textAnchor="middle" className={`fill-negro/60 ${fs.fecha} ${s.actual ? 'font-bold' : ''}`}>{s.cierre}</text>
          <text x={x(i)} y={H - 3} textAnchor="middle" className={`fill-negro/45 ${fs.n}`}>{movil ? s.n : `${s.n} eval.`}</text>
        </g>
      ))}
    </svg>
  )
}

/** Barras divergentes del CAMBIO por dimensión (vs ciclo anterior): verde avanza, rojo retrocede.
 * La fila `esTotal` (variación del promedio general) va al final, separada y en negrita. */
export function BarrasDelta({ items }: { items: { nombre: string; actual: number | null; delta: number | null; esTotal?: boolean }[] }) {
  const conDelta = items.filter((i) => i.delta !== null)
  if (conDelta.length === 0) return <p className="text-xs text-gris">Sin ciclo anterior para comparar el cambio por dimensión.</p>
  const W = 560, filaH = 30, PAD_TOP = 6, SEP = 8
  const haySep = conDelta.some((i) => i.esTotal)
  const H = PAD_TOP + conDelta.length * filaH + (haySep ? SEP : 0) + 16
  const maxD = Math.max(0.2, ...conDelta.map((i) => Math.abs(i.delta!)))
  const cx = 265
  const ancho = (d: number) => (Math.abs(d) / maxD) * 105
  // Posición de cada fila precalculada: reasignar un acumulador durante el render es un
  // patrón que React marca como riesgo de inconsistencia entre renders
  const filas = conDelta.reduce<{ item: typeof conDelta[number]; y: number }[]>((acc, item) => {
    const previa = acc[acc.length - 1]
    const base = previa ? previa.y + filaH : PAD_TOP
    return [...acc, { item, y: item.esTotal ? base + SEP : base }]
  }, [])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <line x1={cx} y1={PAD_TOP} x2={cx} y2={H - 14} className="stroke-negro/60" strokeWidth={1.2} />
      {filas.map(({ item: i, y }) => {
        const positivo = i.delta! > 0
        const w = ancho(i.delta!)
        return (
          <g key={i.nombre} fontSize={11.5}>
            {i.esTotal && <line x1={4} y1={y - SEP / 2} x2={W - 60} y2={y - SEP / 2} className="stroke-gris-claro" strokeWidth={1} />}
            <text x={4} y={y + 15} fontWeight={i.esTotal ? 800 : 700} fontSize={i.esTotal ? 12.5 : 11.5} className="fill-negro">
              {i.nombre.length > 26 ? i.nombre.slice(0, 24) + '…' : i.nombre}
            </text>
            {Math.abs(i.delta!) < 0.005 ? (
              <text x={cx + 8} y={y + 15} className="fill-negro/50" fontSize={10.5}>= igual</text>
            ) : (
              <>
                <rect x={positivo ? cx : cx - w} y={y + 3} width={Math.max(3, w)} height={15} rx={4} className={positivo ? 'fill-emerald-200' : 'fill-red-200'} />
                {/* El valor siempre a la derecha del eje: nunca choca con el nombre de la dimensión */}
                <text
                  x={positivo ? cx + w + 6 : cx + 8}
                  y={y + 15}
                  textAnchor="start"
                  fontWeight={i.esTotal ? 800 : 700}
                  fontSize={i.esTotal ? 11.5 : 10.5}
                  className={positivo ? 'fill-emerald-700' : 'fill-hunter'}
                >
                  {positivo ? '+' : '−'}{Math.abs(i.delta!).toFixed(2)} → {i.actual!.toFixed(2)}
                </text>
              </>
            )}
          </g>
        )
      })}
      <text x={cx} y={H - 2} textAnchor="middle" fontSize={9} className="fill-negro/40">← retrocede · avanza →</text>
    </svg>
  )
}

/** Cambio por dimensión en filas HTML (variante móvil de BarrasDelta): mismo contenido, sin
 * lienzo — el SVG de 560 px comprimido a 307 dejaba las cifras en 6 px reales y recortaba el
 * nombre a 24 caracteres. */
export function BarrasDeltaLista({ items }: { items: { nombre: string; actual: number | null; delta: number | null; esTotal?: boolean }[] }) {
  const conDelta = items.filter((i) => i.delta !== null)
  if (conDelta.length === 0) return <p className="text-xs text-gris">Sin ciclo anterior para comparar el cambio por dimensión.</p>
  const maxD = Math.max(0.2, ...conDelta.map((i) => Math.abs(i.delta!)))
  return (
    <ul className="flex flex-col">
      {conDelta.map((i) => {
        const d = i.delta!
        const positivo = d > 0
        const nulo = Math.abs(d) < 0.005
        const pctBarra = Math.round((Math.abs(d) / maxD) * 100)
        return (
          <li key={i.nombre} className={`grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 border-b border-hueso-2 py-2 last:border-b-0 ${i.esTotal ? 'mt-1 border-b-0 border-t border-gris-claro pt-2.5' : ''}`}>
            <span className={`min-w-0 truncate ${i.esTotal ? 'text-[12.5px] font-extrabold' : 'text-[12px] font-bold'}`}>{i.nombre}</span>
            <span className={`whitespace-nowrap text-right text-[11.5px] font-bold tabular-nums ${nulo ? 'text-gris' : positivo ? 'text-emerald-700' : 'text-hunter'}`}>
              {nulo ? '= igual' : `${positivo ? '+' : '−'}${Math.abs(d).toFixed(2)} → ${i.actual!.toFixed(2)}`}
            </span>
            {/* Barra divergente: mitad izquierda retrocede, derecha avanza */}
            <span className="col-span-2 flex h-3 items-center">
              <span className="flex flex-1 justify-end">
                {!positivo && !nulo && <span className="h-2 rounded-full bg-red-200" style={{ width: `${pctBarra}%` }} />}
              </span>
              <span className="h-3 w-px shrink-0 bg-negro/50" />
              <span className="flex flex-1">
                {positivo && !nulo && <span className="h-2 rounded-full bg-emerald-200" style={{ width: `${pctBarra}%` }} />}
              </span>
            </span>
          </li>
        )
      })}
      <li className="pt-1.5 text-center text-[10px] text-gris">← retrocede · avanza →</li>
    </ul>
  )
}

const TONO_INSIGHT = { rojo: 'border-red-200 bg-red-50/70 text-red-900', ambar: 'border-amber-200 bg-amber-50/70 text-amber-900', ok: 'border-emerald-200 bg-emerald-50/70 text-emerald-900' }

export function Insights({ insights }: { insights: AnalisisCiclo['insights'] }) {
  return (
    <ul className="space-y-2">
      {insights.map((i, idx) => (
        <li key={idx} className={`rounded-xl border px-3.5 py-2.5 text-[13px] font-semibold ${TONO_INSIGHT[i.tono]}`}>
          {i.tono === 'rojo' ? '⛳' : i.tono === 'ambar' ? '⚖️' : '✅'} {i.texto}
        </li>
      ))}
    </ul>
  )
}
