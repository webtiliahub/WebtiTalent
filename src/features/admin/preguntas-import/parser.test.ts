import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseBancoPreguntas } from './parser'

function libro(competencias: unknown[][], potencial: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(competencias), 'Competencias')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(potencial), 'Potencial')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

const HEAD_COMP = ['Dimensión', 'Competencia', 'Texto', 'JEFE', 'PAR', 'ASC', 'AUTO']
const HEAD_POT = ['Orden', 'Texto']

describe('parseBancoPreguntas', () => {
  it('lee competencias con modalidades marcadas por columna', () => {
    const r = parseBancoPreguntas(libro(
      [HEAD_COMP, ['Analítica', 'Análisis de datos y KPIs', '¿Usa datos?', 'X', '', 'X', 'X']],
      [HEAD_POT],
    ))
    expect(r.errores).toEqual([])
    expect(r.competencias).toHaveLength(1)
    expect(r.competencias[0]).toMatchObject({ dimension: 'Analítica', competencia: 'Análisis de datos y KPIs', texto: '¿Usa datos?', modalidades: ['JEFE', 'ASCENDENTE', 'AUTO'] })
  })
  it('lee potencial con orden numérico y texto', () => {
    const r = parseBancoPreguntas(libro([HEAD_COMP], [HEAD_POT, [1, '¿Tiene proyección?'], ['', '¿Aprende rápido?']]))
    expect(r.potencial).toEqual([
      { linea: 2, orden: 1, texto: '¿Tiene proyección?', descriptores: ['', '', '', '', ''] },
      { linea: 3, orden: null, texto: '¿Aprende rápido?', descriptores: ['', '', '', '', ''] },
    ])
  })
  it('ignora filas totalmente vacías', () => {
    const r = parseBancoPreguntas(libro([HEAD_COMP, ['', '', '', '', '', '', ''], ['Analítica', 'X', 'Y', 'X', '', '', '']], [HEAD_POT]))
    expect(r.competencias).toHaveLength(1)
  })
  it('error si falta una hoja', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEAD_COMP]), 'Competencias')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const r = parseBancoPreguntas(buf)
    expect(r.errores.some((e) => e.toLowerCase().includes('potencial'))).toBe(true)
  })
})
