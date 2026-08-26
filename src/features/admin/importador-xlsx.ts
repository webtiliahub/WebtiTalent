import * as XLSX from 'xlsx'

/** Lee la primera hoja de un .xlsx como matriz de strings (todo a texto: los códigos y
 * teléfonos numéricos NO deben volverse number). Misma forma que el CSV del padrón.
 * Vive en su propio archivo (sin `'use server'`) porque `importador.ts` sí lo tiene, y
 * Next.js exige que TODO export de un archivo `'use server'` sea una Server Action
 * async — esta es una función pura y síncrona. */
export function filasDesdeXlsx(buffer: ArrayBuffer): string[][] {
  const wb = XLSX.read(buffer)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }) as unknown[][]
  return filas.map((f) => f.map((v) => String(v ?? '').trim()))
}
