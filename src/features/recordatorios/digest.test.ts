import { describe, it, expect, vi, beforeEach } from 'vitest'

/* El digest de RR.HH. combinaba TODOS los ciclos activos en un solo bloque rotulado con el
   nombre del que cierra más pronto: con «PRUEBA GH ECUADOR» y «TEST CHRISTIAN» activos a la
   vez, el correo decía «EVALUACIONES · TEST CHRISTIAN» pero las filas sumaban ambos ciclos
   (Ecuador 9 pendientes que no existen en ese ciclo). Ahora: un bloque por ciclo/período. */

vi.mock('@/shared/lib/prisma', () => ({
  prisma: {
    periodoObjetivos: { findMany: vi.fn() },
    ciclo: { findMany: vi.fn() },
    usuario: { findMany: vi.fn() },
    asignacion: { findMany: vi.fn() },
    pais: { findMany: vi.fn() },
  },
}))
vi.mock('@/features/ciclos/congelamiento', () => ({ paisesCongelados: vi.fn(async () => new Set()) }))
vi.mock('@/features/objetivos/alcance-periodo', () => ({ colaboradoresDelPeriodo: vi.fn(async () => []) }))
vi.mock('@/features/resultados/servicio', () => ({ calcularResultado: vi.fn() }))

import { prisma } from '@/shared/lib/prisma'
import { datosDigestRrhh } from './pendientes'

const prismaMock = vi.mocked(prisma, true)

const CICLO_GH = { id: 'TST-c1', nombre: 'PRUEBA GH ECUADOR', fechaFin: new Date('2027-03-01T12:00:00') }
const CICLO_TEST = { id: 'TST-c2', nombre: 'TEST CHRISTIAN', fechaFin: new Date('2027-04-01T12:00:00') }

const asigEcuador = (estado: string, evaluadorId: string) => ({
  estado, evaluadorId, evaluado: { paisId: 'TST-ec', pais: { nombre: 'Ecuador' } },
})
const asigPeru = (estado: string, evaluadorId: string) => ({
  estado, evaluadorId, evaluado: { paisId: 'TST-pe', pais: { nombre: 'Perú' } },
})

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.periodoObjetivos.findMany.mockResolvedValue([] as never)
  prismaMock.ciclo.findMany.mockResolvedValue([CICLO_GH, CICLO_TEST] as never)
  prismaMock.pais.findMany.mockResolvedValue([{ id: 'TST-ec', nombre: 'Ecuador' }, { id: 'TST-pe', nombre: 'Perú' }] as never)
  prismaMock.usuario.findMany.mockResolvedValue([{
    email: 'rrhh@tst.pe', alcanceRrhh: 'REGIONAL', alcancePaisId: null,
    colaborador: { nombres: 'Erre', apellidos: 'Hache' },
  }] as never)
  // GH: 1 enviada + 1 pendiente (Ecuador). TEST: 1 pendiente (Perú, otro evaluador)
  prismaMock.asignacion.findMany.mockImplementation(((args: { where: { cicloId: string } }) =>
    Promise.resolve(args.where.cicloId === 'TST-c1'
      ? [asigEcuador('ENVIADA', 'TST-ev1'), asigEcuador('PENDIENTE', 'TST-ev2')]
      : [asigPeru('PENDIENTE', 'TST-ev3')])) as never)
})

describe('datosDigestRrhh — un bloque por ciclo activo (sin mezclar)', () => {
  it('con dos ciclos activos, cada bloque lleva SU nombre, SUS filas y SU avance', async () => {
    const [d] = await datosDigestRrhh()

    expect(d.evaluaciones).toHaveLength(2)
    const gh = d.evaluaciones.find((b) => b.ciclo === 'PRUEBA GH ECUADOR')!
    const test = d.evaluaciones.find((b) => b.ciclo === 'TEST CHRISTIAN')!
    expect(gh.filas).toEqual([{ pais: 'Ecuador', evaluadores: 1, evaluaciones: 1 }])
    expect(gh.avancePct).toBe(50) // 1 de 2 enviadas EN ESE ciclo, no global mezclado
    expect(test.filas).toEqual([{ pais: 'Perú', evaluadores: 1, evaluaciones: 1 }])
    expect(test.avancePct).toBe(0)
  })

  it('RR.HH. de país: solo ve sus filas y los bloques ajenos desaparecen', async () => {
    prismaMock.usuario.findMany.mockResolvedValue([{
      email: 'rrhh.pe@tst.pe', alcanceRrhh: 'PAIS', alcancePaisId: 'TST-pe',
      colaborador: { nombres: 'Erre', apellidos: 'Pe' },
    }] as never)

    const [d] = await datosDigestRrhh()

    expect(d.evaluaciones).toHaveLength(1)
    expect(d.evaluaciones[0].ciclo).toBe('TEST CHRISTIAN')
  })
})
