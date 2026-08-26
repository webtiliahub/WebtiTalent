import { describe, it, expect } from 'vitest'
import { diasRestantes, hitoDelDia, tocaDigestRrhh, proximoHito } from './hitos'

const d = (s: string) => new Date(`${s}T00:00:00Z`)

describe('hitoDelDia', () => {
  const deadline = d('2026-09-30')
  it.each([
    ['2026-08-31', 'D30'], ['2026-09-15', 'D15'], ['2026-09-23', 'D7'],
    ['2026-09-25', 'DIARIO'], ['2026-09-28', 'DIARIO'],
    ['2026-09-29', 'ULTIMO_DIA'], ['2026-09-30', 'ULTIMO_DIA'],
  ])('a %s → %s', (hoy, hito) => expect(hitoDelDia(deadline, d(hoy))).toBe(hito))
  it.each([['2026-08-30'], ['2026-09-01'], ['2026-09-16'], ['2026-09-22']])('a %s → null (sin hito)', (hoy) =>
    expect(hitoDelDia(deadline, d(hoy))).toBeNull())
  it('deadline vencido → null (el proceso cerrado no genera)', () => {
    expect(hitoDelDia(deadline, d('2026-10-01'))).toBeNull()
  })
  it('ventana corta de 10 días: solo tiene D7 y diarios', () => {
    const corto = d('2026-08-15')
    expect(hitoDelDia(corto, d('2026-08-08'))).toBe('D7')
    expect(hitoDelDia(corto, d('2026-08-10'))).toBe('DIARIO')
    expect(hitoDelDia(corto, d('2026-08-05'))).toBeNull() // a 10 días no toca nada
  })
  it('las horas no cuentan: se compara por fecha calendario', () => {
    expect(hitoDelDia(new Date('2026-09-30T23:59:59Z'), new Date('2026-09-23T09:15:00Z'))).toBe('D7')
  })
})

describe('tocaDigestRrhh', () => {
  it('lunes con pendientes lejos del cierre → true', () => {
    expect(tocaDigestRrhh(d('2026-12-01'), d('2026-08-10'))).toBe(true) // 2026-08-10 es lunes
  })
  it('martes lejos del cierre → false', () => {
    expect(tocaDigestRrhh(d('2026-12-01'), d('2026-08-11'))).toBe(false)
  })
  it('cualquier día con el proceso a ≤7 días → true', () => {
    expect(tocaDigestRrhh(d('2026-08-15'), d('2026-08-12'))).toBe(true) // miércoles, quedan 3
  })
  it('sin procesos (null) → false', () => {
    expect(tocaDigestRrhh(null, d('2026-08-10'))).toBe(false)
  })
})

describe('proximoHito', () => {
  it('devuelve el siguiente hito con su fecha', () => {
    expect(proximoHito(d('2026-09-30'), d('2026-08-20'))).toEqual({ hito: 'D30', fecha: d('2026-08-31') })
    expect(proximoHito(d('2026-09-30'), d('2026-09-24'))).toEqual({ hito: 'DIARIO', fecha: d('2026-09-25') })
  })
  it('deadline vencido → null', () => {
    expect(proximoHito(d('2026-09-30'), d('2026-10-02'))).toBeNull()
  })
  it('ciclo largo (90 días) → D30 sin horizonte acotado', () => {
    const hoy = d('2026-08-05')
    const deadline = new Date(hoy.getTime() + 90 * 24 * 60 * 60 * 1000) // +90 días
    const fechaEsperada = new Date(deadline.getTime() - 30 * 24 * 60 * 60 * 1000)
    expect(proximoHito(deadline, hoy)).toEqual({ hito: 'D30', fecha: fechaEsperada })
  })
  it('ciclo anual (400 días) → D30 igualmente', () => {
    const hoy = d('2026-08-05')
    const deadline = new Date(hoy.getTime() + 400 * 24 * 60 * 60 * 1000) // +400 días
    const fechaEsperada = new Date(deadline.getTime() - 30 * 24 * 60 * 60 * 1000)
    expect(proximoHito(deadline, hoy)).toEqual({ hito: 'D30', fecha: fechaEsperada })
  })
})
