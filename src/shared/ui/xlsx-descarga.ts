'use client'

import * as XLSX from 'xlsx'
import { celdaSegura } from './csv'

/** Escritura de Excel para plantillas descargables (primer uso de escritura del proyecto;
 * el resto de xlsx es solo lectura en maestro/parser.ts). Sanitiza texto contra inyección
 * de fórmulas. SheetJS Community no escribe listas desplegables — por eso las plantillas
 * llevan una hoja «Catálogos» y el validador del importador es la red real. */

export type HojaXlsx = { nombre: string; filas: (string | number)[][] }

function saneaFila(fila: (string | number)[]): (string | number)[] {
  return fila.map((v) => (typeof v === 'number' ? v : celdaSegura(String(v ?? ''))))
}

/** Puro (sin DOM): arma el workbook y lo serializa a ArrayBuffer. */
export function construirLibroXlsx(hojas: HojaXlsx[]): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const h of hojas) {
    const ws = XLSX.utils.aoa_to_sheet(h.filas.map(saneaFila))
    // Nombre de hoja: Excel limita a 31 chars y prohíbe : \ / ? * [ ]
    const nombre = h.nombre.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31)
    XLSX.utils.book_append_sheet(wb, ws, nombre)
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/** Cliente: construye el .xlsx y dispara la descarga (mismo mecanismo que descargarCsv). */
export function descargarXlsx(nombreArchivo: string, hojas: HojaXlsx[]): void {
  const buf = construirLibroXlsx(hojas)
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo.endsWith('.xlsx') ? nombreArchivo : `${nombreArchivo}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
