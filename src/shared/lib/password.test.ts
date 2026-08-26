import { describe, it, expect } from 'vitest'
import { esquemaPasswordNueva } from './password'

const ok = (v: string) => esquemaPasswordNueva.safeParse(v).success

describe('esquemaPasswordNueva', () => {
  it('acepta una contraseña razonable', () => {
    expect(ok('Marzo2026kx')).toBe(true)
  })
  it('exige al menos 10 caracteres', () => {
    expect(ok('Abc12345')).toBe(false)      // 8
    expect(ok('Abcde12345')).toBe(true)     // 10
  })
  it('exige letra y número', () => {
    expect(ok('sololetrasxx')).toBe(false)
    expect(ok('1234567890')).toBe(false)
  })
  it('rechaza palabras comunes y el nombre de la empresa', () => {
    expect(ok('Hunter2026x')).toBe(false)   // contiene «hunter»
    expect(ok('carsegsa123')).toBe(false)
    expect(ok('password1234')).toBe(false)
    expect(ok('Cenit123456')).toBe(false)
  })
  it('tope de 128 caracteres', () => {
    expect(ok('a1' + 'x'.repeat(200))).toBe(false)
  })
})
