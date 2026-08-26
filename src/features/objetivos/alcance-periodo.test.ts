import { describe, expect, it, vi, beforeEach } from 'vitest'
import { estaEnAlcancePeriodo } from './alcance-periodo'

vi.mock('@/shared/lib/prisma', () => ({
  prisma: {
    colaborador: { findUnique: vi.fn() },
    periodoObjetivos: { findMany: vi.fn() },
  },
}))

import { periodoVigenteParaColaborador } from './periodo'
import { prisma } from '@/shared/lib/prisma'

const prismaMock = vi.mocked(prisma, true)

const base = { focoPaisIds: [], focoAreaIds: [], focoNivelIds: [], incluirIds: [], excluirIds: [] }
const ana = { id: 'ana', activo: true, paisId: 'cl', areaId: 'com', nivelId: 'mm' }

describe('estaEnAlcancePeriodo', () => {
  it('alcance vacío = toda la organización', () => {
    expect(estaEnAlcancePeriodo(base, ana)).toBe(true)
  })
  it('foco combinado: AND entre dimensiones', () => {
    expect(estaEnAlcancePeriodo({ ...base, focoPaisIds: ['cl'], focoAreaIds: ['com'] }, ana)).toBe(true)
    expect(estaEnAlcancePeriodo({ ...base, focoPaisIds: ['cl'], focoAreaIds: ['ops'] }, ana)).toBe(false)
  })
  it('excluir gana sobre el foco; incluir salta área/nivel pero NUNCA país', () => {
    expect(estaEnAlcancePeriodo({ ...base, excluirIds: ['ana'] }, ana)).toBe(false)
    expect(estaEnAlcancePeriodo({ ...base, focoAreaIds: ['ops'], incluirIds: ['ana'] }, ana)).toBe(true)
    expect(estaEnAlcancePeriodo({ ...base, focoPaisIds: ['pe'], incluirIds: ['ana'] }, ana)).toBe(false)
  })
  it('inactivo nunca entra, ni a mano', () => {
    expect(estaEnAlcancePeriodo({ ...base, incluirIds: ['ana'] }, { ...ana, activo: false })).toBe(false)
  })
})

// --- periodoVigenteParaColaborador -----------------------------------------------------------------

function mockPeriodos(abiertos: unknown[], cerrados: unknown[] = []) {
  prismaMock.periodoObjetivos.findMany.mockImplementation((async (args: { where: { estado: string } }) =>
    (args.where.estado === 'CARGA_ABIERTA' ? abiertos : cerrados)) as never)
}

const anaDueno = { id: 'ana', activo: true, paisId: 'cl', areaId: 'com', puesto: { nivelId: 'mm' } }

describe('periodoVigenteParaColaborador', () => {
  beforeEach(() => vi.clearAllMocks())

  it('colaborador inexistente: null sin consultar períodos', async () => {
    prismaMock.colaborador.findUnique.mockResolvedValue(null as never)
    expect(await periodoVigenteParaColaborador('nadie')).toBeNull()
    expect(prismaMock.periodoObjetivos.findMany).not.toHaveBeenCalled()
  })

  it('elige el CARGA_ABIERTA más reciente que lo incluye, saltando uno más reciente que no', async () => {
    prismaMock.colaborador.findUnique.mockResolvedValue(anaDueno as never)
    const fueraDeAlcance = { id: 'p-nuevo', nombre: 'Nuevo', ...base, focoPaisIds: ['pe'] }
    const dentroDeAlcance = { id: 'p-viejo', nombre: 'Viejo', ...base }
    mockPeriodos([fueraDeAlcance, dentroDeAlcance]) // mismo orden que createdAt desc

    const r = await periodoVigenteParaColaborador('ana')
    expect(r?.id).toBe('p-viejo')
  })

  it('sin CARGA_ABIERTA que lo incluya: cae al CERRADO más reciente que lo incluya', async () => {
    prismaMock.colaborador.findUnique.mockResolvedValue(anaDueno as never)
    mockPeriodos(
      [{ id: 'p-abierto-fuera', nombre: 'Abierto', ...base, focoPaisIds: ['pe'] }],
      [{ id: 'p-cerrado', nombre: 'Cerrado', ...base }],
    )

    const r = await periodoVigenteParaColaborador('ana')
    expect(r?.id).toBe('p-cerrado')
  })

  it('ningún período (abierto ni cerrado) lo incluye: null', async () => {
    prismaMock.colaborador.findUnique.mockResolvedValue(anaDueno as never)
    mockPeriodos(
      [{ id: 'p1', nombre: 'X', ...base, focoPaisIds: ['pe'] }],
      [{ id: 'p2', nombre: 'Y', ...base, excluirIds: ['ana'] }],
    )

    expect(await periodoVigenteParaColaborador('ana')).toBeNull()
  })
})
