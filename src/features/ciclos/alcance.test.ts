import { describe, it, expect } from 'vitest'
import { cumpleFoco, paisIdDerivado, resolverAlcance, type ColaboradorAlcance } from './alcance'

const HOY = new Date('2026-08-01T00:00:00')
const ANTIGUO = new Date('2025-01-15T00:00:00') // > 6 meses al 2026-08-01
const RECIENTE = new Date('2026-06-01T00:00:00') // < 6 meses

let seq = 0
function colab(p: Partial<ColaboradorAlcance> = {}): ColaboradorAlcance {
  seq += 1
  return { id: p.id ?? `c${seq}`, activo: true, fechaIngreso: ANTIGUO, paisId: 'CL', areaId: 'a1', nivelId: 'n1', ...p }
}
const VACIO = { focoPaisIds: [], focoAreaIds: [], focoNivelIds: [] }
const SIN_AJUSTES = { incluirIds: [], excluirIds: [] }

describe('cumpleFoco', () => {
  it('foco vacío = todos', () => {
    expect(cumpleFoco(VACIO, colab())).toBe(true)
  })
  it('OR dentro de una dimensión', () => {
    const foco = { ...VACIO, focoPaisIds: ['CL', 'PE'] }
    expect(cumpleFoco(foco, colab({ paisId: 'PE' }))).toBe(true)
    expect(cumpleFoco(foco, colab({ paisId: 'CO' }))).toBe(false)
  })
  it('AND entre dimensiones', () => {
    const foco = { focoPaisIds: ['CL'], focoAreaIds: ['a1'], focoNivelIds: ['n1'] }
    expect(cumpleFoco(foco, colab())).toBe(true)
    expect(cumpleFoco(foco, colab({ areaId: 'a2' }))).toBe(false)
    expect(cumpleFoco(foco, colab({ nivelId: 'n2' }))).toBe(false)
  })
  it('areaId/nivelId null no cumplen una dimensión con filtro activo', () => {
    expect(cumpleFoco({ ...VACIO, focoAreaIds: ['a1'] }, colab({ areaId: null }))).toBe(false)
    expect(cumpleFoco({ ...VACIO, focoNivelIds: ['n1'] }, colab({ nivelId: null }))).toBe(false)
    expect(cumpleFoco(VACIO, colab({ areaId: null, nivelId: null }))).toBe(true)
  })
})

describe('paisIdDerivado', () => {
  it('0, 1 y N países', () => {
    expect(paisIdDerivado([])).toBeNull()
    expect(paisIdDerivado(['CL'])).toBe('CL')
    expect(paisIdDerivado(['CL', 'PE'])).toBeNull()
  })
})

describe('resolverAlcance', () => {
  it('sin foco ni ajustes: todos los activos con antigüedad', () => {
    const lista = [colab({ id: 'x1' }), colab({ id: 'x2', activo: false }), colab({ id: 'x3', fechaIngreso: RECIENTE })]
    const r = resolverAlcance(lista, VACIO, SIN_AJUSTES, HOY)
    expect(r.evaluados.map((c) => c.id)).toEqual(['x1'])
    expect(r.detalle.excluidosAntiguedad).toEqual(['x3'])
  })
  it('excluir gana sobre los filtros', () => {
    const lista = [colab({ id: 'x1' }), colab({ id: 'x2' })]
    const r = resolverAlcance(lista, { ...VACIO, focoPaisIds: ['CL'] }, { incluirIds: [], excluirIds: ['x2'] }, HOY)
    expect(r.evaluados.map((c) => c.id)).toEqual(['x1'])
    expect(r.detalle.excluidosManuales).toEqual(['x2'])
  })
  it('incluir salta área/nivel dentro del país', () => {
    const lista = [colab({ id: 'x1' }), colab({ id: 'x2', areaId: 'a2' })]
    const r = resolverAlcance(lista, { ...VACIO, focoPaisIds: ['CL'], focoAreaIds: ['a1'] }, { incluirIds: ['x2'], excluirIds: [] }, HOY)
    expect(r.evaluados.map((c) => c.id).sort()).toEqual(['x1', 'x2'])
    expect(r.detalle.incluidosManuales).toEqual(['x2'])
  })
  it('incluir NO salta el país (el país es el techo del alcance)', () => {
    const lista = [colab({ id: 'x1' }), colab({ id: 'pe1', paisId: 'PE' })]
    const r = resolverAlcance(lista, { ...VACIO, focoPaisIds: ['CL'] }, { incluirIds: ['pe1'], excluirIds: [] }, HOY)
    expect(r.evaluados.map((c) => c.id)).toEqual(['x1'])
    expect(r.detalle.incluidosManuales).toEqual([])
    expect(r.detalle.incluidosRechazados).toEqual([{ id: 'pe1', motivo: 'FUERA_DE_PAIS' }])
  })
  it('excluir gana sobre incluir', () => {
    const lista = [colab({ id: 'x1' })]
    const r = resolverAlcance(lista, { ...VACIO, focoPaisIds: ['CL'] }, { incluirIds: ['x1'], excluirIds: ['x1'] }, HOY)
    expect(r.evaluados).toEqual([])
    expect(r.detalle.incluidosManuales).toEqual([])
  })
  it('activo y antigüedad aplican a los incluidos manuales, con motivo', () => {
    const lista = [colab({ id: 'inact', activo: false, areaId: 'a2' }), colab({ id: 'nuevo', fechaIngreso: RECIENTE, areaId: 'a2' })]
    const r = resolverAlcance(lista, { ...VACIO, focoPaisIds: ['CL'], focoAreaIds: ['a1'] }, { incluirIds: ['inact', 'nuevo'], excluirIds: [] }, HOY)
    expect(r.evaluados).toEqual([])
    expect(r.detalle.incluidosRechazados).toEqual([
      { id: 'inact', motivo: 'INACTIVO' },
      { id: 'nuevo', motivo: 'ANTIGUEDAD' },
    ])
  })
  it('un excluido que no cumple el foco es inocuo (no se reporta)', () => {
    const lista = [colab({ id: 'pe1', paisId: 'PE' })]
    const r = resolverAlcance(lista, { ...VACIO, focoPaisIds: ['CL'] }, { incluirIds: [], excluirIds: ['pe1'] }, HOY)
    expect(r.detalle.excluidosManuales).toEqual([])
  })
  it('un incluido que ya cumple el foco no se marca como manual', () => {
    const lista = [colab({ id: 'x1' })]
    const r = resolverAlcance(lista, { ...VACIO, focoPaisIds: ['CL'] }, { incluirIds: ['x1'], excluirIds: [] }, HOY)
    expect(r.evaluados.map((c) => c.id)).toEqual(['x1'])
    expect(r.detalle.incluidosManuales).toEqual([])
  })
  it('sin fechaIngreso se incluye (regla existente: sinFechaIngreso es solo aviso)', () => {
    const r = resolverAlcance([colab({ id: 'x1', fechaIngreso: null })], VACIO, SIN_AJUSTES, HOY)
    expect(r.evaluados.map((c) => c.id)).toEqual(['x1'])
  })
})

describe('resolverAlcance con fechaInicio null (uso del período de objetivos)', () => {
  const foco = { focoPaisIds: [], focoAreaIds: [], focoNivelIds: [] }
  const ajustes = { incluirIds: [], excluirIds: [] }
  const reciente = colab({ id: 'c-nuevo', fechaIngreso: new Date() }) // ingresó HOY: un ciclo lo excluiría por antigüedad

  it('null: el ingreso reciente ENTRA (sin regla de antigüedad)', () => {
    const r = resolverAlcance([reciente], foco, ajustes, null)
    expect(r.evaluados.map((c) => c.id)).toEqual(['c-nuevo'])
    expect(r.detalle.excluidosAntiguedad).toEqual([])
  })

  it('con fecha: se mantiene la exclusión por antigüedad', () => {
    const r = resolverAlcance([reciente], foco, ajustes, new Date())
    expect(r.evaluados).toEqual([])
    expect(r.detalle.excluidosAntiguedad).toEqual(['c-nuevo'])
  })
})

describe('modo lista (sin filtros + incluidos manuales = SOLO esas personas)', () => {
  const gente = [
    colab({ id: 'ana', paisId: 'PE' }),
    colab({ id: 'beto', paisId: 'CL' }),
    colab({ id: 'carla', paisId: 'CO' }),
  ]

  it('sin foco + incluirIds → el alcance es exactamente la lista, sin importar el país', () => {
    const r = resolverAlcance(gente, VACIO, { incluirIds: ['ana', 'carla'], excluirIds: [] }, HOY)
    expect(r.evaluados.map((c) => c.id).sort()).toEqual(['ana', 'carla'])
    expect(r.detalle.incluidosManuales.sort()).toEqual(['ana', 'carla'])
  })

  it('las reglas de negocio aplican igual: inactivos y recientes quedan rechazados', () => {
    const conProblemas = [
      colab({ id: 'ana', paisId: 'PE' }),
      colab({ id: 'ines', activo: false }),
      colab({ id: 'nico', fechaIngreso: RECIENTE }),
    ]
    const r = resolverAlcance(conProblemas, VACIO, { incluirIds: ['ana', 'ines', 'nico'], excluirIds: [] }, HOY)
    expect(r.evaluados.map((c) => c.id)).toEqual(['ana'])
    expect(r.detalle.incluidosRechazados.map((x) => `${x.id}:${x.motivo}`).sort()).toEqual(['ines:INACTIVO', 'nico:ANTIGUEDAD'])
  })

  it('sin foco + solo excluirIds → sigue siendo todos menos los excluidos (retiro del universo)', () => {
    const r = resolverAlcance(gente, VACIO, { incluirIds: [], excluirIds: ['beto'] }, HOY)
    expect(r.evaluados.map((c) => c.id).sort()).toEqual(['ana', 'carla'])
    expect(r.detalle.excluidosManuales).toEqual(['beto'])
  })

  it('con CUALQUIER filtro de foco, incluir vuelve a significar «agregar al alcance»', () => {
    const r = resolverAlcance(gente, { ...VACIO, focoPaisIds: ['PE', 'CL'] }, { incluirIds: ['ana'], excluirIds: [] }, HOY)
    expect(r.evaluados.map((c) => c.id).sort()).toEqual(['ana', 'beto'])
  })
})
