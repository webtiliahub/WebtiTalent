import { describe, it, expect } from 'vitest'
import { deadlineEfectivo, ordenarPendientes } from './pendientes'
import type { PendienteEvaluacion } from '@/shared/lib/mailer'

const d = (s: string) => new Date(`${s}T23:59:59Z`)

describe('deadlineEfectivo', () => {
  it('sin extensión → el deadline del período', () => {
    expect(deadlineEfectivo(d('2026-08-31'))).toEqual(d('2026-08-31'))
  })
  it('extensión posterior al período → manda la extensión', () => {
    expect(deadlineEfectivo(d('2026-08-31'), d('2026-09-15'))).toEqual(d('2026-09-15'))
  })
  it('extensión anterior al período → el período no se acorta', () => {
    expect(deadlineEfectivo(d('2026-08-31'), d('2026-08-20'))).toEqual(d('2026-08-31'))
  })
  it('extensión igual al período → manda el período (no es "posterior")', () => {
    expect(deadlineEfectivo(d('2026-08-31'), d('2026-08-31'))).toEqual(d('2026-08-31'))
  })
})

describe('ordenarPendientes', () => {
  it('AUTO primero, luego JEFE/PAR/ASCENDENTE en ese orden', () => {
    const pendientes: PendienteEvaluacion[] = [
      { modalidad: 'ASCENDENTE', evaluado: 'Ana' },
      { modalidad: 'PAR', evaluado: 'Beto' },
      { modalidad: 'AUTO', evaluado: 'Carla' },
      { modalidad: 'JEFE', evaluado: 'Dana' },
    ]
    expect(ordenarPendientes(pendientes)).toEqual([
      { modalidad: 'AUTO', evaluado: 'Carla' },
      { modalidad: 'JEFE', evaluado: 'Dana' },
      { modalidad: 'PAR', evaluado: 'Beto' },
      { modalidad: 'ASCENDENTE', evaluado: 'Ana' },
    ])
  })
  it('mantiene el orden relativo entre pendientes de la misma modalidad (sort estable)', () => {
    const pendientes: PendienteEvaluacion[] = [
      { modalidad: 'PAR', evaluado: 'Primero' },
      { modalidad: 'PAR', evaluado: 'Segundo' },
    ]
    expect(ordenarPendientes(pendientes)).toEqual(pendientes)
  })
  it('lista vacía → lista vacía', () => {
    expect(ordenarPendientes([])).toEqual([])
  })
})
