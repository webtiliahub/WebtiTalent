'use client'

import { useState } from 'react'

/** Histograma de la distribución de notas con curva normal, referencia del total empresa
 * (gris punteada al filtrar) y tooltip con NOMBRES al hacer clic en una barra. */
export function HistogramaInteractivo({ bins, personasPorBin, curva, curvaRef = [], notaMedia, sigma, mediaRef = null, alto = 190 }: {
  bins: { desde: number; hasta: number; n: number }[]
  personasPorBin: { nombre: string; nota: number }[][]
  curva: { x: number; y: number }[]
  curvaRef?: { x: number; y: number }[]
  notaMedia: number | null
  sigma: number | null
  mediaRef?: number | null
  alto?: number
}) {
  const [activo, setActivo] = useState<number | null>(null)
  const maxN = Math.max(1, ...bins.map((b) => b.n), ...curva.map((p) => p.y), ...curvaRef.map((p) => p.y))
  const bin = activo !== null ? bins[activo] : null
  const personas = activo !== null ? personasPorBin[activo] ?? [] : []

  /* Dos lienzos: el de escritorio (560 px) y uno a la medida del teléfono (360 px). Comprimir
     el de escritorio a 307 px dejaba los conteos y el «x̄ · σ» del tope en 5 px reales. En la
     variante móvil, además, la media / σ / referencia salen del dibujo a una línea de datos en
     HTML: son texto, y como texto se leen. */
  const dibujo = (W: number, H: number, movil: boolean) => {
    const PAD = movil ? 18 : 24
    const x = (v: number) => PAD + ((v - 1) / 4) * (W - PAD * 2)
    const y = (n: number) => H - (movil ? 24 : 18) - (n / maxN) * (H - (movil ? 44 : 34))
    const anchoBin = ((W - PAD * 2) / bins.length) * (movil ? 0.9 : 0.86)
    const fsConteo = movil ? 'text-[11px]' : 'text-[9px]'
    const fsEje = movil ? 'text-[11px]' : 'text-[9.5px]'
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {bins.map((b, i) => (
          <g key={b.desde} onClick={() => setActivo(activo === i ? null : i)} className={b.n > 0 ? 'cursor-pointer' : undefined}>
            {/* Zona clicable completa (también donde la barra es baja) */}
            <rect x={x(b.desde)} y={12} width={anchoBin + 4} height={H - 30} fill="transparent" />
            <rect
              x={x(b.desde) + 2} y={y(b.n)} width={anchoBin} height={H - (movil ? 24 : 18) - y(b.n)} rx={4}
              className={`transition ${activo === i ? 'fill-marca/50' : 'fill-marca/25'} ${b.n > 0 ? 'hover:fill-marca/40' : ''}`}
            />
            {b.n > 0 && <text x={x(b.desde) + 2 + anchoBin / 2} y={y(b.n) - 4} textAnchor="middle" className={`fill-negro font-bold ${fsConteo}`}>{b.n}</text>}
          </g>
        ))}
        {curvaRef.length > 0 && (
          <polyline points={curvaRef.map((p) => `${x(p.x)},${y(p.y)}`).join(' ')} fill="none" className="pointer-events-none stroke-negro/35" strokeWidth={1.6} strokeDasharray="6 4" />
        )}
        {curva.length > 0 && (
          <polyline points={curva.map((p) => `${x(p.x)},${y(p.y)}`).join(' ')} fill="none" className="pointer-events-none stroke-negro/50" strokeWidth={1.6} />
        )}
        {mediaRef !== null && (
          <g className="pointer-events-none">
            <line x1={x(mediaRef)} x2={x(mediaRef)} y1={16} y2={H - (movil ? 24 : 18)} className="stroke-negro/35" strokeWidth={1.2} strokeDasharray="5 4" />
            {!movil && <text x={x(mediaRef)} y={H - 22} textAnchor="middle" className="fill-negro/45 text-[9px] font-bold">empresa {mediaRef.toFixed(2)}</text>}
          </g>
        )}
        {notaMedia !== null && (
          <g className="pointer-events-none">
            <line x1={x(notaMedia)} x2={x(notaMedia)} y1={12} y2={H - (movil ? 24 : 18)} className="stroke-marca" strokeWidth={1.4} strokeDasharray="4 3" />
            {!movil && <text x={x(notaMedia)} y={9} textAnchor="middle" className="fill-marca text-[9.5px] font-bold">x̄ {notaMedia.toFixed(2)}{sigma ? ` · σ ${sigma.toFixed(2)}` : ''}</text>}
          </g>
        )}
        {[1, 2, 3, 4, 5].map((v) => (
          <text key={v} x={x(v)} y={H - (movil ? 6 : 5)} textAnchor="middle" className={`fill-negro/55 ${fsEje}`}>{v.toFixed(1)}</text>
        ))}
      </svg>
    )
  }

  return (
    <div>
      <div className="md:hidden">{dibujo(360, 200, true)}</div>
      <div className="hidden md:block">{dibujo(560, alto, false)}</div>
      {/* Móvil: los datos que vivían dentro del dibujo, como texto real */}
      {notaMedia !== null && (
        <p className="mt-2 flex flex-wrap gap-x-2.5 gap-y-1 border-t border-hueso-2 pt-2 text-[11px] text-gris md:hidden">
          <span className="font-bold text-marca">x̄ {notaMedia.toFixed(2)}</span>
          {sigma !== null && <span>· σ <b className="text-negro">{sigma.toFixed(2)}</b></span>}
          {mediaRef !== null && <span>· empresa <b className="text-negro">{mediaRef.toFixed(2)}</b></span>}
        </p>
      )}

      {/* Panel inferior (no tooltip): con muchos evaluados por rango, la lista necesita
          espacio y scroll propios — se abre al hacer clic en una barra */}
      {bin && personas.length > 0 && (
        <div className="mt-3 rounded-xl border border-gris-claro bg-hueso/40 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gris">
              Notas {bin.desde.toFixed(2)} – {bin.hasta.toFixed(2)} · {personas.length} persona{personas.length === 1 ? '' : 's'}
            </p>
            <button onClick={() => setActivo(null)} title="Cerrar" className="grid h-6 w-6 place-items-center rounded-lg text-xs text-gris transition hover:bg-hueso hover:text-negro">✕</button>
          </div>
          {/* El tope con scroll propio pelea con el scroll de la página en táctil: solo desde md */}
          <ul className="grid gap-x-6 gap-y-1 pr-1 sm:grid-cols-2 md:max-h-56 md:overflow-y-auto lg:grid-cols-3">
            {personas.map((p) => (
              <li key={p.nombre} className="flex items-center justify-between gap-2 border-b border-hueso-2 py-1 text-[12.5px]">
                <span className="truncate font-semibold">{p.nombre}</span>
                <span className="shrink-0 font-bold text-marca">{p.nota.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
