import { COLOR_A, COLOR_B, COLOR_ORG } from './colores'

/** Piezas server-rendered de la vista comparativa: leyenda global, scorecards duales,
 * evolución de 3 líneas y variación por dimensión con dos barras (una por grupo). */

export function LeyendaComparacion({ nombreA, nA, nombreB, nB, nOrg }: { nombreA: string; nA: number; nombreB: string; nB: number; nOrg: number }) {
  const item = (color: string, texto: string, dash = false) => (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold">
      {dash ? (
        <svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke={color} strokeWidth="2" strokeDasharray="5 3" /></svg>
      ) : (
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      )}
      {texto}
    </span>
  )
  // Móvil: dos chips con el nombre recortado (el corte completo ocupaba tres líneas) y la
  // organización como línea de referencia al pie; escritorio: la fila de siempre
  const chip = (color: string, nombre: string, n: number) => (
    <span className="flex items-center gap-2 text-[12px]" title={nombre}>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1 truncate font-bold">{nombre}</span>
      <span className="shrink-0 text-[11px] text-gris">{n} eval.</span>
    </span>
  )
  return (
    <>
      <div className="mb-4 flex flex-col gap-1.5 rounded-2xl border border-gris-claro bg-white px-3 py-2.5 md:hidden">
        {chip(COLOR_A, nombreA, nA)}
        {chip(COLOR_B, nombreB, nB)}
        <p className="border-t border-hueso-2 pt-1.5 text-[10.5px] text-gris">┈ Organización · {nOrg} evaluados (referencia)</p>
      </div>
      <div className="mb-4 hidden flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-gris-claro bg-white px-5 py-3 md:flex">
        {item(COLOR_A, `${nombreA} · ${nA} evaluado${nA === 1 ? '' : 's'}`)}
        {item(COLOR_B, `${nombreB} · ${nB} evaluado${nB === 1 ? '' : 's'}`)}
        {item(COLOR_ORG, `Organización · ${nOrg}`, true)}
      </div>
    </>
  )
}

type LadoKpi = { nombre: string; n: number; promedio: number | null; alto: number; bajo: number }

export function KpisComparativos({ a, b }: { a: LadoKpi; b: LadoKpi }) {
  const pct = (parte: number, n: number) => (n === 0 ? '—' : `${Math.round((parte / n) * 100)}%`)
  const dual = (va: string, vb: string) => (
    <>
      {/* Móvil: A sobre B con su punto de color */}
      <span className="flex flex-col gap-0.5 md:hidden">
        {[[va, COLOR_A], [vb, COLOR_B]].map(([v, c]) => (
          <span key={c} className="flex items-center justify-center gap-1.5 font-display text-[19px] font-extrabold leading-none" style={{ color: c }}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c }} />
            {v}
          </span>
        ))}
      </span>
      <p className="hidden items-baseline justify-center gap-2 font-display text-2xl font-bold md:flex">
        <span style={{ color: COLOR_A }}>{va}</span>
        <span className="text-sm font-semibold text-gris">vs</span>
        <span style={{ color: COLOR_B }}>{vb}</span>
      </p>
    </>
  )
  const tarjetas = [
    { titulo: 'Nota promedio', cuerpo: dual(a.promedio?.toFixed(2) ?? '—', b.promedio?.toFixed(2) ?? '—'), sub: 'nota final vigente' },
    { titulo: 'Evaluados', cuerpo: dual(String(a.n), String(b.n)), sub: 'con resultado en el ciclo' },
    { titulo: 'Desempeño destacado', cuerpo: dual(pct(a.alto, a.n), pct(b.alto, b.n)), sub: `nota ≥ 4.0 · ${a.alto} vs ${b.alto}` },
    { titulo: 'En zona de atención', cuerpo: dual(pct(a.bajo, a.n), pct(b.bajo, b.n)), sub: `nota < 3.0 · ${a.bajo} vs ${b.bajo}` },
  ]
  return (
    <div className="mb-5 grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
      {tarjetas.map((t) => (
        <div key={t.titulo} className="rounded-2xl border border-gris-claro bg-white px-3 py-3.5 text-center sm:px-5 sm:py-5">
          {t.cuerpo}
          <p className="mt-1.5 text-[10px] font-bold uppercase leading-tight tracking-wide text-gris sm:text-[11px]">{t.titulo}</p>
          <p className="mt-0.5 text-[10px] font-semibold text-gris sm:text-[11px]">{t.sub}</p>
        </div>
      ))}
    </div>
  )
}

/** Evolución multi-serie: líneas de color (con puntos y valores) + punteadas (referencia).
 * Los puntos null se saltan (el grupo no tiene datos en ese ciclo). */
export function EvolucionComparada({ ciclos, series, alto = 210, ancho = 1120, movil = false, anchoFijo = false, sinEtiquetas = false }: {
  ciclos: { cierre: string }[]
  series: { color: string; dash?: boolean; etiquetas?: 'arriba' | 'abajo'; puntos: (number | null)[] }[]
  alto?: number
  ancho?: number
  movil?: boolean
  anchoFijo?: boolean // el SVG mide `ancho` px: con muchos ciclos el contenedor scrollea
  // Con dos series encima, las cifras sobre los puntos se cruzan por pares y no caben a
  // ningún tamaño: en móvil el gráfico deja la TENDENCIA y los números van a una tabla
  sinEtiquetas?: boolean
}) {
  const W = ancho, H = alto, PAD = Math.max(30, W * 0.05)
  const valores = series.flatMap((s) => s.puntos.filter((v): v is number => v !== null))
  if (ciclos.length === 0 || valores.length === 0) return <p className="text-xs text-gris">Sin ciclos con resultados para graficar.</p>
  const min = Math.max(1, Math.min(...valores) - 0.4)
  const max = Math.min(5, Math.max(...valores) + 0.4)
  const x = (i: number) => (ciclos.length === 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (ciclos.length - 1))
  const y = (v: number) => H - 30 - ((v - min) / Math.max(0.01, max - min)) * (H - 58)
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={anchoFijo ? undefined : 'w-full'}
      style={anchoFijo ? { width: W, maxWidth: 'none' } : undefined}
    >
      {series.map((s, si) => {
        const pts = s.puntos.map((v, i) => (v === null ? null : { i, v })).filter((p): p is { i: number; v: number } => p !== null)
        if (pts.length === 0) return null
        return (
          <g key={si}>
            <polyline points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={s.dash ? 1.6 : 2} strokeDasharray={s.dash ? '6 4' : undefined} opacity={s.dash ? 0.65 : 1} />
            {!s.dash && pts.map((p) => (
              <g key={p.i}>
                <circle cx={x(p.i)} cy={y(p.v)} r={movil ? 4.5 : 3.5} fill={s.color} />
                {s.etiquetas && !sinEtiquetas && (
                  <text x={x(p.i)} y={s.etiquetas === 'arriba' ? y(p.v) - 8 : y(p.v) + 15} textAnchor="middle" fontSize={10} fontWeight={700} fill={s.color}>{p.v.toFixed(2)}</text>
                )}
              </g>
            ))}
          </g>
        )
      })}
      {ciclos.map((c, i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className={`fill-negro/60 ${movil ? 'text-[10.5px]' : 'text-[9px]'}`}>{c.cierre}</text>
      ))}
    </svg>
  )
}

/** Cifras de la evolución comparada en tabla (variante móvil): ciclo · A · B · organización.
 * Permite además comparar en vertical, algo que el gráfico no da. */
export function TablaEvolucionComparada({ ciclos, a, b, org, colorA = COLOR_A, colorB = COLOR_B }: {
  ciclos: { cierre: string }[]
  a: (number | null)[]
  b: (number | null)[]
  org: (number | null)[]
  colorA?: string
  colorB?: string
}) {
  const val = (v: number | null) => (v === null ? '—' : v.toFixed(2))
  return (
    <table className="mt-2 w-full border-collapse text-[11.5px] tabular-nums">
      <thead>
        <tr className="border-b border-gris-claro text-[9.5px] font-bold uppercase tracking-wide text-gris">
          <th className="py-1 pr-2 text-left">Ciclo</th>
          <th className="py-1 pl-2 text-right" style={{ color: colorA }}>A</th>
          <th className="py-1 pl-2 text-right" style={{ color: colorB }}>B</th>
          <th className="py-1 pl-2 text-right">Org.</th>
        </tr>
      </thead>
      <tbody>
        {ciclos.map((c, i) => (
          <tr key={i} className="border-b border-hueso-2 last:border-b-0">
            <td className={`py-1.5 pr-2 ${i === ciclos.length - 1 ? 'font-bold text-negro' : 'text-gris'}`}>{c.cierre}</td>
            <td className="py-1.5 pl-2 text-right font-bold" style={{ color: colorA }}>{val(a[i] ?? null)}</td>
            <td className="py-1.5 pl-2 text-right font-bold" style={{ color: colorB }}>{val(b[i] ?? null)}</td>
            <td className="py-1.5 pl-2 text-right font-semibold text-gris">{val(org[i] ?? null)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Variación por dimensión con dos barras (una por grupo): cambio vs el ciclo anterior.
 * El item `esTotal` (variación del promedio general) va al final, separado y en negrita. */
export function BarrasDeltaComparadas({ items, nombreA, nombreB, anteriorNombre }: {
  items: { nombre: string; actualA: number | null; deltaA: number | null; actualB: number | null; deltaB: number | null; esTotal?: boolean }[]
  nombreA: string
  nombreB: string
  anteriorNombre: string | null
}) {
  const conDato = items.filter((i) => i.deltaA !== null || i.deltaB !== null)
  if (!anteriorNombre || conDato.length === 0) return <p className="text-xs text-gris">Sin ciclo anterior para comparar el cambio por dimensión.</p>
  const W = 560, filaH = 46, PAD_TOP = 6, SEP = 8
  const haySep = conDato.some((i) => i.esTotal)
  const H = PAD_TOP + conDato.length * filaH + (haySep ? SEP : 0) + 16
  const maxD = Math.max(0.2, ...conDato.flatMap((i) => [Math.abs(i.deltaA ?? 0), Math.abs(i.deltaB ?? 0)]))
  const cx = 265
  const ancho = (d: number) => (Math.abs(d) / maxD) * 105
  const barra = (yBase: number, delta: number | null, actual: number | null, color: string, esTotal?: boolean) => {
    if (delta === null) return <text x={cx + 8} y={yBase + 10} fill={COLOR_ORG} fontSize={9.5}>sin dato</text>
    if (Math.abs(delta) < 0.005) return <text x={cx + 8} y={yBase + 10} fill={COLOR_ORG} fontSize={9.5}>= igual{actual !== null ? ` · ${actual.toFixed(2)}` : ''}</text>
    const positivo = delta > 0
    const w = ancho(delta)
    return (
      <>
        <rect x={positivo ? cx : cx - w} y={yBase} width={Math.max(3, w)} height={11} rx={3} fill={color} opacity={0.45} />
        <text x={positivo ? cx + w + 6 : cx + 8} y={yBase + 10} fontWeight={esTotal ? 800 : 700} fontSize={10} fill={color}>
          {positivo ? '+' : '−'}{Math.abs(delta).toFixed(2)}{actual !== null ? ` → ${actual.toFixed(2)}` : ''}
        </text>
      </>
    )
  }
  // Posiciones precalculadas: reasignar un acumulador durante el render es un patrón que
  // React marca como riesgo de inconsistencia entre renders
  const filas = conDato.reduce<{ item: typeof conDato[number]; y: number }[]>((acc, item) => {
    const previa = acc[acc.length - 1]
    const base = previa ? previa.y + filaH : PAD_TOP
    return [...acc, { item, y: item.esTotal ? base + SEP : base }]
  }, [])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <line x1={cx} y1={PAD_TOP} x2={cx} y2={H - 14} className="stroke-negro/60" strokeWidth={1.2} />
      {filas.map(({ item: i, y: yFila }) => {
        return (
          <g key={i.nombre} fontSize={11.5}>
            {i.esTotal && <line x1={4} y1={yFila - SEP / 2} x2={W - 60} y2={yFila - SEP / 2} className="stroke-gris-claro" strokeWidth={1} />}
            <text x={4} y={yFila + 14} fontWeight={i.esTotal ? 800 : 700} className="fill-negro">
              {i.nombre.length > 26 ? i.nombre.slice(0, 24) + '…' : i.nombre}
            </text>
            {barra(yFila + 4, i.deltaA, i.actualA, COLOR_A, i.esTotal)}
            {barra(yFila + 20, i.deltaB, i.actualB, COLOR_B, i.esTotal)}
          </g>
        )
      })}
      <text x={cx} y={H - 2} textAnchor="middle" fontSize={9} className="fill-negro/40">← retrocede · avanza → · {nombreA} arriba, {nombreB} abajo</text>
    </svg>
  )
}


/** Cambio por dimensión de los dos grupos, en filas HTML (variante móvil de
 * BarrasDeltaComparadas): el SVG de 560 px con DOS barras por fila quedaba con las cifras en
 * 6 px reales. Solo se listan las dimensiones con movimiento en algún grupo. */
export function BarrasDeltaComparadasLista({ items, nombreA, nombreB, anteriorNombre }: {
  items: { nombre: string; actualA: number | null; deltaA: number | null; actualB: number | null; deltaB: number | null; esTotal?: boolean }[]
  nombreA: string
  nombreB: string
  anteriorNombre: string | null
}) {
  const conDato = items.filter((i) => i.deltaA !== null || i.deltaB !== null)
  if (!anteriorNombre || conDato.length === 0) return <p className="text-xs text-gris">Sin ciclo anterior para comparar el cambio por dimensión.</p>
  const maxD = Math.max(0.2, ...conDato.flatMap((i) => [Math.abs(i.deltaA ?? 0), Math.abs(i.deltaB ?? 0)]))

  const lado = (delta: number | null, actual: number | null, color: string) => {
    const nulo = delta !== null && Math.abs(delta) < 0.005
    const positivo = (delta ?? 0) > 0
    const pct = delta === null ? 0 : Math.round((Math.abs(delta) / maxD) * 100)
    return (
      <span className="mt-1 grid grid-cols-[14px_1fr_auto] items-center gap-2 text-[11px]">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        <span className="flex h-3 items-center">
          <span className="flex flex-1 justify-end">
            {delta !== null && !nulo && !positivo && <span className="h-2 rounded-full bg-red-200" style={{ width: `${pct}%` }} />}
          </span>
          <span className="h-3 w-px shrink-0 bg-negro/50" />
          <span className="flex flex-1">
            {delta !== null && !nulo && positivo && <span className="h-2 rounded-full bg-emerald-200" style={{ width: `${pct}%` }} />}
          </span>
        </span>
        <span className="whitespace-nowrap text-right font-bold tabular-nums" style={{ color: delta === null || nulo ? COLOR_ORG : color }}>
          {delta === null ? 'sin dato' : nulo ? `= igual${actual !== null ? ` · ${actual.toFixed(2)}` : ''}` : `${positivo ? '+' : '−'}${Math.abs(delta).toFixed(2)}${actual !== null ? ` → ${actual.toFixed(2)}` : ''}`}
        </span>
      </span>
    )
  }

  return (
    <ul className="flex flex-col">
      {conDato.map((i) => (
        <li key={i.nombre} className={`border-b border-hueso-2 py-2 last:border-b-0 ${i.esTotal ? 'mt-1 border-b-0 border-t border-gris-claro pt-2.5' : ''}`}>
          <span className={`block truncate ${i.esTotal ? 'text-[12.5px] font-extrabold' : 'text-[12px] font-bold'}`}>{i.nombre}</span>
          {lado(i.deltaA, i.actualA, COLOR_A)}
          {lado(i.deltaB, i.actualB, COLOR_B)}
        </li>
      ))}
      <li className="pt-1.5 text-center text-[10px] text-gris">← retrocede · avanza → · {nombreA} arriba, {nombreB} abajo</li>
    </ul>
  )
}
