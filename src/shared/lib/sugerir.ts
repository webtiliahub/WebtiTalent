/** Sugeridor «¿quisiste decir X?» para valores de sistema mal escritos en los importadores.
 * Compara sobre texto normalizado (sin tildes/minúsculas) por distancia de edición. */

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function distancia(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const fila = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    let prev = fila[0]
    fila[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = fila[j]
      fila[j] = Math.min(
        fila[j] + 1,
        fila[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      prev = tmp
    }
  }
  return fila[n]
}

export function sugerir(valor: string, opciones: string[]): string | null {
  const v = norm(valor)
  if (!v || opciones.length === 0) return null
  let mejor: string | null = null
  let mejorD = Infinity
  for (const op of opciones) {
    const d = distancia(v, norm(op))
    if (d < mejorD) { mejorD = d; mejor = op }
  }
  // Umbral: hasta ~30% de la longitud de la opción (mínimo 2) — tolera tildes y typos, no palabras distintas
  if (mejor !== null && mejorD <= Math.max(2, Math.floor(norm(mejor).length * 0.3))) return mejor
  return null
}
