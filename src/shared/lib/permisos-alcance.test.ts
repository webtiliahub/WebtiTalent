import { describe, it, expect } from 'vitest'
import { alcancePaisWhere, cicloFueraDeAlcance, periodoFueraDeAlcance, paisForzado, errorDeAlcance } from './permisos'
import type { SesionUsuario } from './auth'

/* Criterios de alcance de país. Se prueban aquí porque los consumen tanto las server actions como
   las páginas, y una discrepancia entre lectura y escritura es justo lo que abre una fuga. */

const sesion = (parcial: Partial<SesionUsuario>): SesionUsuario => ({
  id: 'u1', colaboradorId: 'c1', rol: 'RRHH', alcanceRrhh: 'REGIONAL', alcancePaisId: null,
  permisosAdmin: {}, activo: true, ...parcial,
} as SesionUsuario)

describe('alcancePaisWhere', () => {
  it('Regional sin selección: sin restricción', () => {
    expect(alcancePaisWhere(sesion({}))).toEqual({})
  })

  it('Regional con país elegido en la barra: restringe a ese país', () => {
    expect(alcancePaisWhere(sesion({}), 'PE')).toEqual({ paisId: 'PE' })
  })

  it('RR.HH. de país: manda su país e ignora la selección de la barra (solo restringe, nunca amplía)', () => {
    expect(alcancePaisWhere(sesion({ alcanceRrhh: 'PAIS', alcancePaisId: 'CL' }), 'PE')).toEqual({ paisId: 'CL' })
  })

  it('RR.HH. de país SIN país asignado: no ve nada (fail-closed)', () => {
    // Antes devolvía {} — sin restricción alguna—, así que el mismo estado que bloquea todas las
    // escrituras (`fueraDeAlcancePais` devuelve true) abría todas las lecturas
    const where = alcancePaisWhere(sesion({ alcanceRrhh: 'PAIS', alcancePaisId: null }))
    expect(where).not.toEqual({})
    expect(where.paisId).toBeTruthy()
  })
})

describe('cicloFueraDeAlcance', () => {
  const deCL = sesion({ alcanceRrhh: 'PAIS', alcancePaisId: 'CL' })

  it('Regional opera cualquier ciclo, incluidos los regionales', () => {
    expect(cicloFueraDeAlcance(sesion({}), { paisId: null })).toBe(false)
    expect(cicloFueraDeAlcance(sesion({}), { paisId: 'PE' })).toBe(false)
  })

  it('RR.HH. de país: su país sí, otro país no, y un ciclo REGIONAL tampoco', () => {
    expect(cicloFueraDeAlcance(deCL, { paisId: 'CL' })).toBe(false)
    expect(cicloFueraDeAlcance(deCL, { paisId: 'PE' })).toBe(true)
    expect(cicloFueraDeAlcance(deCL, { paisId: null })).toBe(true)
  })

  it('sin país asignado: fuera de todo', () => {
    expect(cicloFueraDeAlcance(sesion({ alcanceRrhh: 'PAIS', alcancePaisId: null }), { paisId: 'CL' })).toBe(true)
  })
})

describe('periodoFueraDeAlcance', () => {
  const deCL = sesion({ alcanceRrhh: 'PAIS', alcancePaisId: 'CL' })

  it('solo los períodos acotados EXACTAMENTE a su país', () => {
    expect(periodoFueraDeAlcance(deCL, { focoPaisIds: ['CL'] })).toBe(false)
    expect(periodoFueraDeAlcance(deCL, { focoPaisIds: ['PE'] })).toBe(true)
    expect(periodoFueraDeAlcance(deCL, { focoPaisIds: [] })).toBe(true)          // regional
    expect(periodoFueraDeAlcance(deCL, { focoPaisIds: ['CL', 'PE'] })).toBe(true) // multi-país
  })

  it('Regional opera todos', () => {
    expect(periodoFueraDeAlcance(sesion({}), { focoPaisIds: [] })).toBe(false)
  })
})

describe('paisForzado — reemplaza el patrón fail-open de las validaciones de alcance', () => {
  it('Regional no fuerza país (usa el valor del cliente)', () => {
    expect(paisForzado(sesion({}))).toBeNull()
  })
  it('RR.HH. de país fuerza su país', () => {
    expect(paisForzado(sesion({ alcanceRrhh: 'PAIS', alcancePaisId: 'CL' }))).toBe('CL')
  })
  it('RR.HH. de país SIN país fuerza un centinela imposible, no cae al valor del cliente', () => {
    const f = paisForzado(sesion({ alcanceRrhh: 'PAIS', alcancePaisId: null }))
    expect(f).toBeTruthy()
    expect(f).not.toBeNull()
    // el centinela no puede coincidir con un cuid real de País
    expect(f).toBe('__sin_alcance__')
  })
})

describe('errorDeAlcance — administrar cuentas ajenas', () => {
  const rrhhCL = sesion({ alcanceRrhh: 'PAIS', alcancePaisId: 'CL' })
  it('Regional administra cualquier cuenta', () => {
    expect(errorDeAlcance(sesion({}), { alcanceRrhh: 'REGIONAL', colaborador: { paisId: 'PE' } })).toBeNull()
  })
  it('un no-Regional NO puede administrar a un Regional', () => {
    expect(errorDeAlcance(rrhhCL, { alcanceRrhh: 'REGIONAL', colaborador: { paisId: 'CL' } })).toBeTruthy()
  })
  it('RR.HH. de país: su país sí, otro país no', () => {
    expect(errorDeAlcance(rrhhCL, { alcanceRrhh: null, colaborador: { paisId: 'CL' } })).toBeNull()
    expect(errorDeAlcance(rrhhCL, { alcanceRrhh: null, colaborador: { paisId: 'PE' } })).toBeTruthy()
  })
  it('cuenta sin colaborador: fuera de alcance salvo para Regional', () => {
    expect(errorDeAlcance(rrhhCL, { alcanceRrhh: null, colaborador: null })).toBeTruthy()
    expect(errorDeAlcance(sesion({}), { alcanceRrhh: null, colaborador: null })).toBeNull()
  })
})
