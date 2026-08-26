import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/shared/lib/permisos', () => ({
  requiereAdmin: vi.fn(async () => ({ id: 'TST-admin', rol: 'RRHH', alcanceRrhh: 'REGIONAL', alcancePaisId: null })),
  cicloFueraDeAlcance: vi.fn(() => false),
}))
vi.mock('@/shared/lib/mailer', () => ({
  construirRecordatorioEvaluaciones: vi.fn((to: string) => ({ to, asunto: 'TST', texto: '', html: '' })),
  enviarBatch: vi.fn(async (correos: unknown[]) => ({ enviados: correos.length, fallidos: 0, erroresMuestra: [] })),
}))
vi.mock('@/shared/lib/push', () => ({ enviarPushACorreos: vi.fn(async () => ({ enviados: 1 })) }))
vi.mock('@/features/recordatorios/pendientes', () => ({ pendientesEvaluaciones: vi.fn() }))
vi.mock('@/shared/lib/prisma', () => ({
  prisma: {
    ciclo: { findUnique: vi.fn() },
    recordatorioEnvio: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import { prisma } from '@/shared/lib/prisma'
import { enviarBatch } from '@/shared/lib/mailer'
import { pendientesEvaluaciones } from '@/features/recordatorios/pendientes'
import { enviarRecordatorioEvaluacionesManual } from './acciones'

const prismaMock = vi.mocked(prisma, true)

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.ciclo.findUnique.mockResolvedValue({
    id: 'TST-ciclo', nombre: 'TST Ciclo 2026', estado: 'ACTIVO', paisId: null, fechaFin: new Date('2026-09-30T12:00:00'),
  } as never)
  vi.mocked(pendientesEvaluaciones).mockResolvedValue({
    deadline: new Date('2026-09-30T12:00:00'),
    destinatarios: [
      { colaboradorId: 'TST-1', email: 'uno@tst.pe', nombre: 'Uno', pendientes: [{ modalidad: 'AUTO', evaluado: 'Uno' }] },
      { colaboradorId: 'TST-2', email: 'dos@tst.pe', nombre: 'Dos', pendientes: [{ modalidad: 'PAR', evaluado: 'Tres' }] },
    ],
    sinCuenta: 0,
  } as never)
})

describe('enviarRecordatorioEvaluacionesManual — botón del recuadro de recordatorios', () => {
  it('envía a los evaluadores con pendientes y deja rastro en RecordatorioEnvio (hito MANUAL)', async () => {
    const res = await enviarRecordatorioEvaluacionesManual('TST-ciclo')

    expect(res).toMatchObject({ ok: true, enviados: 2 })
    expect(vi.mocked(enviarBatch)).toHaveBeenCalledOnce()
    const envio = prismaMock.recordatorioEnvio.create.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(envio.data).toMatchObject({ proceso: 'EVALUACIONES', referencia: 'TST-ciclo', hito: 'MANUAL', enviados: 2 })
    expect(prismaMock.auditLog.create).toHaveBeenCalledOnce()
  })

  it('sin pendientes no envía nada y lo dice', async () => {
    vi.mocked(pendientesEvaluaciones).mockResolvedValue({ deadline: new Date(), destinatarios: [], sinCuenta: 0 } as never)

    const res = await enviarRecordatorioEvaluacionesManual('TST-ciclo')

    expect(res.ok).toBe(false)
    expect(vi.mocked(enviarBatch)).not.toHaveBeenCalled()
    expect(prismaMock.recordatorioEnvio.create).not.toHaveBeenCalled()
  })

  it('ciclo no activo: rechaza', async () => {
    prismaMock.ciclo.findUnique.mockResolvedValue({ id: 'TST-ciclo', estado: 'CERRADO' } as never)

    const res = await enviarRecordatorioEvaluacionesManual('TST-ciclo')

    expect(res.ok).toBe(false)
    expect(vi.mocked(enviarBatch)).not.toHaveBeenCalled()
  })
})
