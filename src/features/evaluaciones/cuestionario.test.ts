import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock de Prisma (mismo patrón que servicio.test.ts): sin base real, cada modelo usado por
// preguntasPotencialParaAsignacion queda como vi.fn() controlado por el test. ---------------------
vi.mock('@/shared/lib/prisma', () => ({
  prisma: {
    cicloPreguntaPotencial: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    preguntaPotencial: {
      findMany: vi.fn(),
    },
    cicloPerfilEvaluado: {
      findUnique: vi.fn(),
    },
    colaborador: {
      findUnique: vi.fn(),
    },
  },
}))

import { prisma } from '@/shared/lib/prisma'
import { preguntasPotencialParaAsignacion } from './cuestionario'

const prismaMock = vi.mocked(prisma, true)

const CICLO_ID = 'TST-ciclo-1'
const EVALUADO_ID = 'TST-colab-1'

const POT_NIVEL_VIEJO = { id: 'TST-pot-viejo', texto: 'Pregunta del nivel al lanzar', descriptores: [], orden: 1 }
const POT_NIVEL_NUEVO = { id: 'TST-pot-nuevo', texto: 'Pregunta del nivel re-homologado', descriptores: [], orden: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  // El ciclo SÍ tiene snapshot de potencial y el puesto no tiene excepción propia
  prismaMock.cicloPreguntaPotencial.count.mockImplementation(((args: { where: { puestoId?: string } }) =>
    Promise.resolve(args.where.puestoId ? 0 : 4)) as never)
  // El set depende del nivel consultado: si llega el nivel VIEJO (congelado) devuelve su pregunta;
  // con el nivel NUEVO (en vivo) devolvería la otra — así el test distingue qué fuente se usó
  prismaMock.cicloPreguntaPotencial.findMany.mockImplementation(((args: { where: { nivelId?: string } }) =>
    Promise.resolve(args.where.nivelId === 'TST-nivel-viejo'
      ? [{ preguntaPotencial: POT_NIVEL_VIEJO }]
      : [{ preguntaPotencial: POT_NIVEL_NUEVO }])) as never)
  // El maestro EN VIVO dice que el puesto fue re-homologado a otro nivel a mitad de ciclo
  prismaMock.colaborador.findUnique.mockResolvedValue({
    puesto: { id: 'TST-puesto-1', nivelId: 'TST-nivel-nuevo', competencias: [], pesos: [] },
  } as never)
})

describe('preguntasPotencialParaAsignacion — perfil congelado (auditoría 0824)', () => {
  it('usa el nivel del snapshot del ciclo, no el del puesto en vivo', async () => {
    prismaMock.cicloPerfilEvaluado.findUnique.mockResolvedValue({
      puestoId: 'TST-puesto-1', nivelId: 'TST-nivel-viejo', competenciaIds: [], pesosJson: [],
    } as never)

    const preguntas = await preguntasPotencialParaAsignacion(CICLO_ID, EVALUADO_ID)

    expect(preguntas.map((p) => p.id)).toEqual(['TST-pot-viejo'])
  })

  it('sin perfil congelado (ciclo anterior al snapshot de perfiles) cae al puesto en vivo', async () => {
    prismaMock.cicloPerfilEvaluado.findUnique.mockResolvedValue(null as never)

    const preguntas = await preguntasPotencialParaAsignacion(CICLO_ID, EVALUADO_ID)

    expect(preguntas.map((p) => p.id)).toEqual(['TST-pot-nuevo'])
  })

  it('sin snapshot de potencial en el ciclo cae al set global activo (compatibilidad)', async () => {
    prismaMock.cicloPreguntaPotencial.count.mockResolvedValue(0 as never)
    prismaMock.preguntaPotencial.findMany.mockResolvedValue([POT_NIVEL_VIEJO] as never)

    const preguntas = await preguntasPotencialParaAsignacion(CICLO_ID, EVALUADO_ID)

    expect(preguntas.map((p) => p.id)).toEqual(['TST-pot-viejo'])
    expect(prismaMock.cicloPerfilEvaluado.findUnique).not.toHaveBeenCalled()
  })

  it('perfil congelado sin puesto: no hay cuestionario de potencial', async () => {
    prismaMock.cicloPerfilEvaluado.findUnique.mockResolvedValue({
      puestoId: null, nivelId: null, competenciaIds: [], pesosJson: [],
    } as never)

    const preguntas = await preguntasPotencialParaAsignacion(CICLO_ID, EVALUADO_ID)

    expect(preguntas).toEqual([])
  })
})
