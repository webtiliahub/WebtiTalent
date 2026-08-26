import { describe, expect, it } from 'vitest'
import { media, mediana, desviacion, zScore, histograma, curvaNormal } from './estadistica'

describe('estadística descriptiva', () => {
  it('media y mediana', () => {
    expect(media([2, 4])).toBe(3)
    expect(mediana([1, 3, 5])).toBe(3)
    expect(mediana([1, 2, 3, 4])).toBe(2.5)
    expect(media([])).toBeNull()
    expect(mediana([])).toBeNull()
  })
  it('desviación poblacional', () => {
    expect(desviacion([2, 4])).toBe(1)
    expect(desviacion([3, 3, 3])).toBe(0)
    expect(desviacion([5])).toBeNull()
  })
  it('zScore exige grupo con estadística', () => {
    expect(zScore(5, [3, 3, 3])).toBeNull() // σ = 0
    expect(zScore(5, [1, 3])).toBeNull() // n < 3
    const z = zScore(5, [3, 3, 4, 4, 3.5])
    expect(z).not.toBeNull()
    expect(z!).toBeGreaterThan(1.5) // claramente por encima del grupo
  })
  it('histograma cubre el rango y cuenta bien los bordes', () => {
    const bins = histograma([1, 1.4, 2.5, 5, 5], 1, 5, 0.5)
    expect(bins).toHaveLength(8)
    expect(bins[0].n).toBe(2) // 1 y 1.4
    expect(bins[7].n).toBe(2) // los 5.0 caen en el último bin
    expect(bins.reduce((a, b) => a + b.n, 0)).toBe(5)
  })
  it('curva normal centrada en la media', () => {
    const pts = curvaNormal([2, 3, 4], 1, 5, 0.5, 40)
    expect(pts.length).toBe(41)
    const pico = pts.reduce((a, b) => (b.y > a.y ? b : a))
    expect(pico.x).toBeCloseTo(3, 0)
    expect(curvaNormal([3, 3, 3])).toEqual([]) // σ = 0 no dibuja curva
  })
})
