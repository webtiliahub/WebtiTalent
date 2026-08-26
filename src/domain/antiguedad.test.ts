import { describe, expect, it } from 'vitest'
import { excluidoPorAntiguedad } from './antiguedad'

const inicio = new Date('2026-09-01') // ciclo que inicia el 1 de septiembre

describe('excluidoPorAntiguedad (6 meses al inicio del ciclo)', () => {
  it('excluye a quien ingresó hace menos de 6 meses', () => {
    expect(excluidoPorAntiguedad(new Date('2026-04-15'), inicio)).toBe(true) // 4.5 meses
    expect(excluidoPorAntiguedad(new Date('2026-08-30'), inicio)).toBe(true) // días
  })
  it('incluye a quien tiene 6 meses o más', () => {
    expect(excluidoPorAntiguedad(new Date('2026-03-01'), inicio)).toBe(false) // exactos 6 meses
    expect(excluidoPorAntiguedad(new Date('2025-01-10'), inicio)).toBe(false) // antiguo
  })
  it('el límite es exclusivo: un día después de los 6 meses queda fuera', () => {
    expect(excluidoPorAntiguedad(new Date('2026-03-02'), inicio)).toBe(true)
  })
  it('sin fecha de ingreso se incluye (no se excluye por dato faltante)', () => {
    expect(excluidoPorAntiguedad(null, inicio)).toBe(false)
    expect(excluidoPorAntiguedad(undefined, inicio)).toBe(false)
  })
})
