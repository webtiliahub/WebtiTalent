'use client'

import { useState } from 'react'
import { COLOR_A, COLOR_B, COLOR_ORG } from './colores'
import type { PersonaBin } from './comparacion'

/** Distribución comparativa: barras APILADAS por grupo (A abajo, B encima) con el conteo
 * de cada color dentro de su segmento, curvas normales de cada grupo y la de la
 * organización punteada (re-escalada a nA+nB, apagable con el checkbox).
 * Clic en una barra → panel con las personas del rango y el punto de color de su grupo. */
export function HistogramaComparativo({ bins, personasPorBin, curvaA, curvaB, curvaOrg, mediaA, mediaB, nombreA, nombreB, alto = 190 }: {
  bins: { desde: number; hasta: number; nA: number; nB: number }[]
  personasPorBin: PersonaBin[][]
  curvaA: { x: number; y: number }[]
  curvaB: { x: number; y: number }[]
  curvaOrg: { x: number; y: number }[]
  mediaA: number | null
  mediaB: number | null
  nombreA: string
  nombreB: string
  alto?: number
}) {
  const [activo, setActivo] = useState<number | null>(null)
  const [conOrg, setConOrg] = useState(true)
  const total = (b: { nA: number; nB: number }) => b.nA + b.nB
  // La escala solo considera lo visible: al apagar la organización, las barras respiran
  const maxN = Math.max(1, ...bins.map(total), ...curvaA.map((p) => p.y), ...curvaB.map((p) => p.y), ...(conOrg ? curvaOrg.map((p) => p.y) : []))
  const bin = activo !== null ? bins[activo] : null
  const personas = activo !== null ? personasPorBin[activo] ?? [] : []

  /* El lienzo de 560 px comprimido a 307 dejaba los conteos y las dos medias en 5 px reales.
     En la variante móvil, además, las medias salen del dibujo a una línea de datos en HTML. */
  const dibujo = (W: number, H: number, movil: boolean) => {
    const PAD = movil ? 18 : 24
    const x = (v: number) => PAD + ((v - 1) / 4) * (W - PAD * 2)
    const y = (n: number) => H - (movil ? 24 : 18) - (n / maxN) * (H - (movil ? 44 : 34))
    const anchoBin = ((W - PAD * 2) / bins.length) * (movil ? 0.9 : 0.86)
    const linea = (pts: { x: number; y: number }[], color: string, dash?: string) =>
      pts.length > 0 && (
        <polyline points={pts.map((p) => `${x(p.x)},${y(p.y)}`).join(' ')} fill="none" stroke={color} strokeWidth={movil ? 2 : 1.6} strokeDasharray={dash} className="pointer-events-none" opacity={dash ? 0.65 : 0.9} />
      )
    // Conteo dentro del segmento (si la altura da para el número)
    const conteoSegmento = (cxBar: number, yTop: number, yBot: number, n: number, color: string) => {
      if (yBot - yTop < (movil ? 15 : 13)) return null
      return (
        <text x={cxBar} y={(yTop + yBot) / 2 + 3.5} textAnchor="middle" fontSize={movil ? 10.5 : 9} fontWeight={800} fill={color} className="pointer-events-none">{n}</text>
      )
    }
    return (
      <div>
      <div className="mb-1 flex justify-end">
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-gris">
          <input type="checkbox" checked={conOrg} onChange={(e) => setConOrg(e.target.checked)} className="h-3.5 w-3.5 accent-negro" />
          <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke={COLOR_ORG} strokeWidth="1.8" strokeDasharray="5 3" /></svg>
          Curva organización
        </label>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {bins.map((b, i) => (
          <g key={b.desde} onClick={() => setActivo(activo === i ? null : i)} className={total(b) > 0 ? 'cursor-pointer' : undefined}>
            <rect x={x(b.desde)} y={12} width={anchoBin + 4} height={H - 30} fill="transparent" />
            {b.nA > 0 && (
              <rect x={x(b.desde) + 2} y={y(b.nA)} width={anchoBin} height={H - (movil ? 24 : 18) - y(b.nA)} rx={3} fill={COLOR_A} opacity={activo === i ? 0.55 : 0.35} />
            )}
            {b.nB > 0 && (
              <rect x={x(b.desde) + 2} y={y(total(b))} width={anchoBin} height={y(b.nA) - y(total(b)) - (b.nA > 0 ? 1.5 : 0)} rx={3} fill={COLOR_B} opacity={activo === i ? 0.55 : 0.35} />
            )}
            {b.nA > 0 && conteoSegmento(x(b.desde) + 2 + anchoBin / 2, y(b.nA), H - (movil ? 24 : 18), b.nA, COLOR_A)}
            {b.nB > 0 && conteoSegmento(x(b.desde) + 2 + anchoBin / 2, y(total(b)), y(b.nA) - (b.nA > 0 ? 1.5 : 0), b.nB, COLOR_B)}
            {total(b) > 0 && (
              <text x={x(b.desde) + 2 + anchoBin / 2} y={y(total(b)) - 4} textAnchor="middle" className={`fill-negro font-bold ${movil ? 'text-[11px]' : 'text-[9px]'}`}>{total(b)}</text>
            )}
          </g>
        ))}
        {conOrg && linea(curvaOrg, COLOR_ORG, '6 4')}
        {linea(curvaA, COLOR_A)}
        {linea(curvaB, COLOR_B)}
        {mediaA !== null && (
          <g className="pointer-events-none">
            <line x1={x(mediaA)} x2={x(mediaA)} y1={12} y2={H - (movil ? 24 : 18)} stroke={COLOR_A} strokeWidth={1.3} strokeDasharray="4 3" />
            {!movil && <text x={x(mediaA)} y={9} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={COLOR_A}>x̄ {mediaA.toFixed(2)}</text>}
          </g>
        )}
        {mediaB !== null && (
          <g className="pointer-events-none">
            <line x1={x(mediaB)} x2={x(mediaB)} y1={16} y2={H - (movil ? 24 : 18)} stroke={COLOR_B} strokeWidth={1.3} strokeDasharray="4 3" />
            {!movil && <text x={x(mediaB)} y={H - 22} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={COLOR_B}>x̄ {mediaB.toFixed(2)}</text>}
          </g>
        )}
        {[1, 2, 3, 4, 5].map((v) => (
          <text key={v} x={x(v)} y={H - (movil ? 6 : 5)} textAnchor="middle" className={`fill-negro/55 ${movil ? 'text-[11px]' : 'text-[9.5px]'}`}>{v.toFixed(1)}</text>
        ))}
      </svg>
      </div>
    )
  }

  return (
    <div>
      <div className="md:hidden">{dibujo(360, 200, true)}</div>
      <div className="hidden md:block">{dibujo(560, alto, false)}</div>
      {/* Móvil: las dos medias y la referencia, como texto real */}
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-hueso-2 pt-2 text-[11px] md:hidden">
        {mediaA !== null && <span className="font-bold" style={{ color: COLOR_A }}>● x̄ A {mediaA.toFixed(2)}</span>}
        {mediaB !== null && <span className="font-bold" style={{ color: COLOR_B }}>● x̄ B {mediaB.toFixed(2)}</span>}
        <span className="text-gris">┈ organización de referencia</span>
      </p>

      {bin && personas.length > 0 && (
        <div className="mt-3 rounded-xl border border-gris-claro bg-hueso/40 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gris">
              Notas {bin.desde.toFixed(2)} – {bin.hasta.toFixed(2)} · {personas.length} persona{personas.length === 1 ? '' : 's'}
            </p>
            <button onClick={() => setActivo(null)} title="Cerrar" className="grid h-6 w-6 place-items-center rounded-lg text-xs text-gris transition hover:bg-hueso hover:text-negro">✕</button>
          </div>
          <ul className="grid gap-x-6 gap-y-1 pr-1 sm:grid-cols-2 md:max-h-56 md:overflow-y-auto lg:grid-cols-3">
            {personas.map((p) => (
              <li key={`${p.grupo}-${p.nombre}`} title={p.grupo === 'A' ? nombreA : nombreB} className="flex items-center justify-between gap-2 border-b border-hueso-2 py-1 text-[12.5px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.grupo === 'A' ? COLOR_A : COLOR_B }} />
                  <span className="truncate font-semibold">{p.nombre}</span>
                </span>
                <span className="shrink-0 font-bold" style={{ color: p.grupo === 'A' ? COLOR_A : COLOR_B }}>{p.nota.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
