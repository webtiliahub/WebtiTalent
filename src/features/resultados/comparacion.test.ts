import { describe, it, expect } from 'vitest'
import { esperadoDeCorte, binsApilados, validarGrupos, nombreGrupo } from './comparacion'

describe('nombreGrupo', () => {
  it('país + área', () => expect(nombreGrupo('Perú', 'RRHH')).toBe('Perú · RRHH'))
  it('país completo', () => expect(nombreGrupo('Perú', null)).toBe('Perú (todas las áreas)'))
})

describe('esperadoDeCorte', () => {
  const perfil = new Map<string, Record<string, number>>([
    ['p1', { d1: 4, d2: 3 }],
    ['p2', { d1: 5 }], // p2 no define d2
  ])
  it('promedia el esperado del puesto de cada evaluado', () => {
    // Dos evaluados con p1 y uno con p2: d1 = (4+4+5)/3, d2 = (3+3)/2
    expect(esperadoDeCorte(['p1', 'p1', 'p2'], perfil, ['d1', 'd2'])).toEqual([13 / 3, 3])
  })
  it('evaluado sin puesto no aporta', () => {
    expect(esperadoDeCorte(['p1', null], perfil, ['d1'])).toEqual([4])
  })
  it('dimensión sin ningún perfil → null', () => {
    expect(esperadoDeCorte(['p2'], perfil, ['d2'])).toEqual([null])
  })
  it('corte vacío → null por dimensión', () => {
    expect(esperadoDeCorte([], perfil, ['d1', 'd2'])).toEqual([null, null])
  })
})

describe('binsApilados', () => {
  it('cuenta por grupo en la grilla 1–5 de ancho 0.5', () => {
    const { bins, personasPorBin } = binsApilados(
      [{ nombre: 'Ana', nota: 4.2 }, { nombre: 'Luis', nota: 4.9 }],
      [{ nombre: 'Eva', nota: 4.4 }],
    )
    expect(bins).toHaveLength(8)
    const bin4 = bins.find((b) => b.desde === 4)! // [4.0, 4.5)
    expect(bin4).toMatchObject({ nA: 1, nB: 1 })
    expect(bins.find((b) => b.desde === 4.5)).toMatchObject({ nA: 1, nB: 0 })
    // Personas del bin con su grupo, ordenadas por nota desc
    const gente4 = personasPorBin[bins.indexOf(bin4)]
    expect(gente4.map((p) => [p.nombre, p.grupo])).toEqual([['Eva', 'B'], ['Ana', 'A']])
  })
  it('nota 5.0 cae en el último bin (borde superior)', () => {
    const { bins } = binsApilados([{ nombre: 'Top', nota: 5 }], [])
    expect(bins[bins.length - 1].nA).toBe(1)
  })
})

describe('validarGrupos', () => {
  const ctx = {
    esRegional: true,
    paisSesionId: null as string | null,
    paisesValidos: new Set(['pe', 'cl']),
    areasValidas: new Set(['rrhh', 'ventas']),
  }
  it('acepta dos grupos válidos con área opcional', () => {
    const r = validarGrupos({ aPais: 'pe', aArea: 'rrhh', bPais: 'cl' }, ctx)
    expect(r).toEqual({ grupoA: { paisId: 'pe', areaId: 'rrhh' }, grupoB: { paisId: 'cl', areaId: undefined }, identicos: false })
  })
  it('marca idénticos (mismo país y misma área, o ambos sin área)', () => {
    expect(validarGrupos({ aPais: 'pe', bPais: 'pe' }, ctx)?.identicos).toBe(true)
    expect(validarGrupos({ aPais: 'pe', aArea: 'rrhh', bPais: 'pe', bArea: 'rrhh' }, ctx)?.identicos).toBe(true)
    expect(validarGrupos({ aPais: 'pe', aArea: 'rrhh', bPais: 'pe', bArea: 'ventas' }, ctx)?.identicos).toBe(false)
  })
  it('rechaza país desconocido o área desconocida', () => {
    expect(validarGrupos({ aPais: 'xx', bPais: 'cl' }, ctx)).toBeNull()
    expect(validarGrupos({ aPais: 'pe', aArea: 'zzz', bPais: 'cl' }, ctx)).toBeNull()
  })
  it('RRHH-país: el país es el techo — solo su país en ambos lados', () => {
    const ctxPais = { ...ctx, esRegional: false, paisSesionId: 'pe' }
    expect(validarGrupos({ aPais: 'pe', aArea: 'rrhh', bPais: 'cl' }, ctxPais)).toBeNull()
    expect(validarGrupos({ aPais: 'pe', aArea: 'rrhh', bPais: 'pe', bArea: 'ventas' }, ctxPais)).not.toBeNull()
  })
  it('falta un lado → null', () => {
    expect(validarGrupos({ aPais: 'pe' }, ctx)).toBeNull()
    expect(validarGrupos({}, ctx)).toBeNull()
  })
})
