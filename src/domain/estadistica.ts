/** Estadística descriptiva PURA para el Análisis de resultados (sin dependencias).
 * Todas las funciones toleran listas vacías devolviendo null (el UI decide qué mostrar). */

export function media(valores: number[]): number | null {
  if (valores.length === 0) return null
  return valores.reduce((a, b) => a + b, 0) / valores.length
}

export function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null
  const s = [...valores].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

/** Desviación estándar poblacional (los resultados de un ciclo SON la población evaluada). */
export function desviacion(valores: number[]): number | null {
  const m = media(valores)
  if (m === null || valores.length < 2) return null
  return Math.sqrt(valores.reduce((a, v) => a + (v - m) ** 2, 0) / valores.length)
}

/** z-score de un valor respecto de su grupo; null si el grupo no da estadística (n<3 o σ=0). */
export function zScore(valor: number, grupo: number[]): number | null {
  if (grupo.length < 3) return null
  const m = media(grupo)!
  const s = desviacion(grupo)
  if (!s || s === 0) return null
  return (valor - m) / s
}

/** Histograma con bins fijos [min, max] de ancho binSize. Devuelve conteo por bin. */
export function histograma(valores: number[], min = 1, max = 5, binSize = 0.5): { desde: number; hasta: number; n: number }[] {
  const bins: { desde: number; hasta: number; n: number }[] = []
  for (let x = min; x < max - 1e-9; x += binSize) {
    bins.push({ desde: Number(x.toFixed(2)), hasta: Number((x + binSize).toFixed(2)), n: 0 })
  }
  for (const v of valores) {
    const i = Math.min(bins.length - 1, Math.max(0, Math.floor((v - min) / binSize)))
    bins[i].n += 1
  }
  return bins
}

/** Puntos (x, densidad escalada) de la campana normal para superponer al histograma.
 * Escalada para que el área coincida con el histograma (n · binSize). */
export function curvaNormal(valores: number[], min = 1, max = 5, binSize = 0.5, puntos = 60, escalaN?: number): { x: number; y: number }[] {
  const m = media(valores)
  const s = desviacion(valores)
  if (m === null || !s || s === 0) return []
  const escala = (escalaN ?? valores.length) * binSize
  const out: { x: number; y: number }[] = []
  for (let i = 0; i <= puntos; i++) {
    const x = min + ((max - min) * i) / puntos
    const y = (escala / (s * Math.sqrt(2 * Math.PI))) * Math.exp(-((x - m) ** 2) / (2 * s ** 2))
    out.push({ x, y })
  }
  return out
}
