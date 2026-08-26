import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { filasDesdeXlsx } from './importador-xlsx'

describe('filasDesdeXlsx', () => {
  it('devuelve filas como strings (códigos/teléfonos numéricos no se vuelven number)', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['codigo', 'documento', 'telefono'],
      ['PER-001', 40967470, 928892464],
    ]), 'Padrón')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const filas = filasDesdeXlsx(buf)
    expect(filas[0]).toEqual(['codigo', 'documento', 'telefono'])
    expect(filas[1]).toEqual(['PER-001', '40967470', '928892464'])
  })
})
