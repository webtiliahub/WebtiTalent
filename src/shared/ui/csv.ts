'use client'

/** Neutraliza inyección de fórmulas: una celda que empieza con = + - @ (o tab/CR) la
 * ejecutaría Excel/Sheets; se antepone un apóstrofo para forzar texto. */
export function celdaSegura(v: string) {
  const s = String(v ?? '')
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}

/** Descarga un CSV con BOM y ";" para que Excel es-PE lo abra en columnas directamente. */
export function descargarCsv(nombreArchivo: string, filas: string[][]) {
  const csv = '\uFEFF' + filas.map((f) => f.map((v) => `"${celdaSegura(v).replaceAll('"', '""')}"`).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  a.click()
  URL.revokeObjectURL(url)
}
