import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { construirLibroXlsx } from './xlsx-descarga'

describe('construirLibroXlsx', () => {
  it('produce un xlsx legible con las hojas y celdas dadas', () => {
    const buf = construirLibroXlsx([
      { nombre: 'Competencias', filas: [['Dimensión', 'Competencia', 'Texto'], ['Analítica', 'Análisis de datos y KPIs', '¿Usa datos para decidir?']] },
      { nombre: 'Potencial', filas: [['Orden', 'Texto'], [1, '¿Tiene proyección?']] },
    ])
    const wb = XLSX.read(buf)
    expect(wb.SheetNames).toEqual(['Competencias', 'Potencial'])
    const c = XLSX.utils.sheet_to_json(wb.Sheets['Competencias'], { header: 1 })
    expect(c[0]).toEqual(['Dimensión', 'Competencia', 'Texto'])
    expect((c[1] as string[])[1]).toBe('Análisis de datos y KPIs')
  })
  it('neutraliza celdas que empiezan con = (anti-inyección)', () => {
    const buf = construirLibroXlsx([{ nombre: 'H', filas: [['=CMD()']] }])
    const wb = XLSX.read(buf)
    const v = (XLSX.utils.sheet_to_json(wb.Sheets['H'], { header: 1 })[0] as string[])[0]
    expect(v.startsWith("'") || v.startsWith('=') === false).toBe(true)
    expect(v).toBe("'=CMD()")
  })
})
