import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/shared/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    rateLimit: { deleteMany: vi.fn() },
  },
}))

import { prisma } from '@/shared/lib/prisma'
import { contarIntento, permitido } from './rate-limit'

const prismaMock = vi.mocked(prisma, true)
const conHits = (n: number) => prismaMock.$queryRaw.mockResolvedValue([{ hits: n }] as never)

beforeEach(() => vi.clearAllMocks())

describe('contarIntento — distingue «recién cruzado» de «sigue pasado» (auditoría 0824)', () => {
  /* LOGIN_CUENTA_MUCHOS_FALLOS promete «una sola vez por ventana», pero permitido() solo devuelve
     un booleano plano: un spray de 5.000 intentos escribía ~4.990 eventos de detección. El caller
     necesita saber si ESTE intento es exactamente el que cruza el umbral. */
  it('dentro del cupo: permitido, sin cruce', async () => {
    conHits(10)
    expect(await contarIntento('TST:clave', 10, 60_000)).toEqual({ permitido: true, recienCruzado: false })
  })

  it('el intento que CRUZA el umbral: no permitido y recienCruzado', async () => {
    conHits(11)
    expect(await contarIntento('TST:clave', 10, 60_000)).toEqual({ permitido: false, recienCruzado: true })
  })

  it('los intentos posteriores de la misma ráfaga ya no marcan cruce', async () => {
    conHits(12)
    expect(await contarIntento('TST:clave', 10, 60_000)).toEqual({ permitido: false, recienCruzado: false })
  })

  it('fail-open ante error de base: permitido y sin cruce (sin evento fantasma)', async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error('down') as never)
    expect(await contarIntento('TST:clave', 10, 60_000)).toEqual({ permitido: true, recienCruzado: false })
  })
})

describe('permitido — conserva su contrato booleano', () => {
  it('true dentro del cupo, false al excederlo', async () => {
    conHits(10)
    expect(await permitido('TST:clave', 10, 60_000)).toBe(true)
    conHits(11)
    expect(await permitido('TST:clave', 10, 60_000)).toBe(false)
  })
})
