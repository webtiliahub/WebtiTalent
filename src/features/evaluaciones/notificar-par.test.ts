import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/shared/lib/prisma', () => ({
  prisma: {
    ciclo: { findUnique: vi.fn() },
    colaborador: { findUnique: vi.fn() },
  },
}))
vi.mock('@/shared/lib/mailer', () => ({
  construirParAsignado: vi.fn((to: string) => ({ to, asunto: 'TST', texto: '', html: '' })),
  enviarBatch: vi.fn(async (correos: unknown[]) => ({ enviados: correos.length, fallidos: 0, erroresMuestra: [] })),
}))
vi.mock('@/shared/lib/push', () => ({ enviarPushACorreos: vi.fn(async () => ({ enviados: 1 })) }))

import { prisma } from '@/shared/lib/prisma'
import { construirParAsignado, enviarBatch } from '@/shared/lib/mailer'
import { enviarPushACorreos } from '@/shared/lib/push'
import { notificarParAsignado } from './notificar-par'

const prismaMock = vi.mocked(prisma, true)

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.ciclo.findUnique.mockResolvedValue({ nombre: 'TST Ciclo 2026', fechaFin: new Date('2026-09-30T12:00:00') } as never)
  prismaMock.colaborador.findUnique.mockImplementation(((args: { where: { id: string } }) =>
    Promise.resolve(args.where.id === 'TST-par'
      ? { nombres: 'Ana', apellidos: 'Torres', usuario: { email: 'ana@tst.pe', activo: true } }
      : { nombres: 'Carlos', apellidos: 'Ruiz' })) as never)
})

describe('notificarParAsignado — aviso al nuevo par evaluador (correo + push)', () => {
  it('arma el correo con el evaluado y la fecha límite del ciclo, y lo envía al par', async () => {
    const r = await notificarParAsignado('TST-ciclo', 'TST-par', 'TST-evaluado')

    expect(r.enviados).toBe(1)
    expect(vi.mocked(construirParAsignado)).toHaveBeenCalledWith(
      'ana@tst.pe', 'Ana Torres', 'Carlos Ruiz', 'TST Ciclo 2026', '30 de setiembre de 2026',
    )
    expect(vi.mocked(enviarBatch)).toHaveBeenCalled()
    const push = vi.mocked(enviarPushACorreos).mock.calls[0]
    expect(push[0]).toEqual(['ana@tst.pe'])
    expect((push[1] as { cuerpo: string }).cuerpo).toContain('Carlos Ruiz')
  })

  it('sin cuenta activa no hay a quién avisar: no envía nada', async () => {
    prismaMock.colaborador.findUnique.mockImplementation(((args: { where: { id: string } }) =>
      Promise.resolve(args.where.id === 'TST-par'
        ? { nombres: 'Ana', apellidos: 'Torres', usuario: { email: 'ana@tst.pe', activo: false } }
        : { nombres: 'Carlos', apellidos: 'Ruiz' })) as never)

    const r = await notificarParAsignado('TST-ciclo', 'TST-par', 'TST-evaluado')

    expect(r.enviados).toBe(0)
    expect(vi.mocked(enviarBatch)).not.toHaveBeenCalled()
    expect(vi.mocked(enviarPushACorreos)).not.toHaveBeenCalled()
  })
})
