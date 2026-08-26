/** Radar por dimensión (SVG puro, sin estado — usable en server y client components).
 * Serie principal pintada en rojo Hunter; opcionalmente una serie "esperada" en gris al
 * fondo (el perfil requerido del puesto) para comparar contra lo obtenido. */

/** Paleta categórica por dimensión (validada CVD/contraste sobre blanco), asignada por orden. */
export const COLORES_DIMENSION = ['#f0163e', '#2563eb', '#b45309', '#059669', '#7c3aed']
export const colorDim = (idx: number) => COLORES_DIMENSION[idx % COLORES_DIMENSION.length]

function envolver(nombre: string): string[] {
  if (nombre.length <= 15) return [nombre]
  const palabras = nombre.split(' ')
  const lineas: string[] = ['']
  for (const p of palabras) {
    if ((lineas[lineas.length - 1] + ' ' + p).trim().length > 15) lineas.push(p)
    else lineas[lineas.length - 1] = (lineas[lineas.length - 1] + ' ' + p).trim()
  }
  return lineas.slice(0, 2)
}

export type DimRadar = {
  nombre: string
  color: string
  valor: number | null // serie pintada (1–5); null = sin dato (queda al centro, sin punto)
  esperado?: number // serie gris al fondo (perfil requerido del puesto)
  valorB?: number | null // segunda serie (azul) — vista comparativa
}

export function RadarDimensiones({ dims, ariaLabel = 'Perfil por dimensión', mostrarValores = false, sinEtiquetas = false }: {
  dims: DimRadar[]
  ariaLabel?: string
  mostrarValores?: boolean
  // `sinEtiquetas`: el radar se queda con la FORMA y crece (ya no reserva margen para texto);
  // los nombres y valores viven en una lista aparte. Pensado para el teléfono, donde las
  // etiquetas de 8 px con su valor a 6.5 px no se leían.
  sinEtiquetas?: boolean
}) {
  const n = dims.length
  if (n < 3) return <p className="text-xs text-gris">Se necesitan al menos 3 dimensiones para el radar.</p>
  const cx = 150, cy = 128, R = 82
  const punto = (i: number, r: number): [number, number] => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / n
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)]
  }
  const poligono = (r: (i: number) => number) => dims.map((_, i) => punto(i, r(i)).join(',')).join(' ')
  const radioDe = (v: number | null | undefined) => (R * Math.max(v ?? 0, 0)) / 5
  const hayEsperado = dims.some((d) => d.esperado !== undefined)
  const hayB = dims.some((d) => d.valorB !== undefined && d.valorB !== null)
  const hayValor = dims.some((d) => d.valor !== null)

  // Con valores junto a los nombres las etiquetas laterales crecen: margen horizontal extra
  const MX = mostrarValores ? 26 : 0
  // Sin etiquetas el lienzo se recorta al propio radar: la figura ocupa todo el ancho
  const caja = sinEtiquetas ? `${cx - R - 12} ${cy - R - 12} ${(R + 12) * 2} ${(R + 12) * 2}` : `${-MX} 0 ${300 + MX * 2} 256`
  return (
    <svg viewBox={caja} className={`mx-auto w-full ${sinEtiquetas ? 'max-w-[300px]' : mostrarValores ? 'max-w-[560px]' : 'max-w-[480px]'}`} role="img" aria-label={ariaLabel}>
      {[1, 2, 3, 4, 5].map((v) => (
        <polygon key={v} points={poligono(() => (R * v) / 5)} fill="none" stroke="#e5e1dc" strokeWidth={v === 5 ? 1.2 : 0.7} />
      ))}
      {dims.map((_, i) => {
        const [x, y] = punto(i, R)
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e5e1dc" strokeWidth={0.7} />
      })}
      {[1, 2, 3, 4, 5].map((v) => (
        <text key={v} x={cx + 3} y={cy - (R * v) / 5 + 3} fontSize={6.5} fill="#b9b3ac">{v}</text>
      ))}
      {hayEsperado && (
        <polygon points={poligono((i) => radioDe(dims[i].esperado))} fill="#8a857f" fillOpacity={0.16} stroke="#8a857f" strokeWidth={1.4} strokeDasharray="3 2" strokeLinejoin="round" />
      )}
      {hayB && (
        <polygon points={poligono((i) => radioDe(dims[i].valorB))} fill="#0284c7" fillOpacity={0.14} stroke="#0284c7" strokeWidth={1.6} strokeLinejoin="round" />
      )}
      {hayValor && (
        <polygon points={poligono((i) => radioDe(dims[i].valor))} fill="#f0163e" fillOpacity={0.16} stroke="#f0163e" strokeWidth={1.6} strokeLinejoin="round" />
      )}
      {dims.map((d, i) => {
        if (d.valor === null) return null
        const [x, y] = punto(i, radioDe(d.valor))
        return <circle key={i} cx={x} cy={y} r={3} fill={d.color} stroke="#fff" strokeWidth={1.2} />
      })}
      {hayB && dims.map((d, i) => {
        if (d.valorB === null || d.valorB === undefined) return null
        const [x, y] = punto(i, radioDe(d.valorB))
        return <circle key={`b${i}`} cx={x} cy={y} r={3} fill="#0284c7" stroke="#fff" strokeWidth={1.2} />
      })}
      {!sinEtiquetas && dims.map((d, i) => {
        const [x, y] = punto(i, R + 14)
        const cos = Math.cos(-Math.PI / 2 + (2 * Math.PI * i) / n)
        const anchor = Math.abs(cos) < 0.35 ? 'middle' : cos > 0 ? 'start' : 'end'
        const lineas = envolver(d.nombre)
        // Valor junto al nombre: verde si mantiene o mejora vs la serie esperada (perfil esperado), rojo si baja
        const colorValor =
          d.valor === null ? null
          : d.esperado === undefined ? '#5b564f'
          : d.valor >= d.esperado - 0.005 ? '#059669'
          : '#f0163e'
        return (
          <text key={i} x={x} y={y - (lineas.length - 1) * 4} textAnchor={anchor} fontSize={8} fontWeight={600} fill="#5b564f">
            {lineas.map((l, j) => (
              <tspan key={j} x={x} dy={j === 0 ? 0 : 9}>
                {l}
                {mostrarValores && j === lineas.length - 1 && colorValor && (
                  <tspan fill={colorValor} fontWeight={800}>{' '}{d.valor!.toFixed(2)}</tspan>
                )}
              </tspan>
            ))}
          </text>
        )
      })}
    </svg>
  )
}

/** Leyenda estándar del radar comparativo (esperado gris punteado vs obtenido rojo). */
export function LeyendaRadar({ etiquetaObtenido }: { etiquetaObtenido: string }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-5 text-[11px] text-gris">
      <span className="inline-flex items-center gap-1.5">
        <svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="#8a857f" strokeWidth="1.6" strokeDasharray="3 2" /></svg>
        Perfil esperado del puesto
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="22" height="8"><rect x="0" y="1" width="22" height="6" fill="#f0163e" fillOpacity="0.25" stroke="#f0163e" strokeWidth="1.2" /></svg>
        {etiquetaObtenido}
      </span>
    </div>
  )
}
