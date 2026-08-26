import { describe, it, expect, vi, beforeEach } from 'vitest'

/* Cierre de ciclo y cierre/publicación por país (auditoría 0824):
   1) cerrarCiclo reclama ACTIVO→CERRADO y luego persiste el desglose: si esa transacción falla,
      el ciclo debe LIBERARSE (volver a ACTIVO) para que el cierre sea reintentable — no quedar
      a medio cerrar sin vía de recuperación.
   2) Los correos de publicación salen DESPUÉS del commit (patrón lanzarCiclo): un fallo de la
      base no puede dejar correos enviados sobre un cierre que no existe.
   3) En cerrarPaisCiclo el CLAIM es el propio create de cicloPaisCierre (@@unique ciclo+país):
      dos pestañas simultáneas no pueden notificar dos veces al país.
   4) publicarPaisCiclo reclama con updateMany condicionado (publicado:false): la segunda
      invocación no reenvía correos ni devuelve éxito. */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn((cb: () => unknown) => { void cb() }) }))
vi.mock('@/shared/lib/permisos', () => ({
  requiereRrhh: vi.fn(),
  requiereAdmin: vi.fn(async () => ({ id: 'TST-admin', rol: 'RRHH', alcanceRrhh: 'REGIONAL', alcancePaisId: null, colaboradorId: 'TST-admin-col' })),
  fueraDeAlcancePais: vi.fn(() => false),
  alcancePaisWhere: vi.fn(() => ({})),
  cicloFueraDeAlcance: vi.fn(() => false),
  paisForzado: vi.fn(() => null),
}))
vi.mock('@/shared/lib/permisos-admin', () => ({ tieneAdmin: vi.fn(() => true) }))
vi.mock('@/domain/antiguedad', () => ({ excluidoPorAntiguedad: vi.fn(() => false) }))
vi.mock('@/features/resultados/servicio', () => ({
  calcularResultado: vi.fn(async () => ({})),
  calcularResultadosCiclo: vi.fn(async () => 5),
}))
vi.mock('@/features/ciclos/preflight', () => ({
  preflightCiclo: vi.fn(),
  feedbackPendiente: vi.fn(async () => ({ faltantes: [] })),
  conformidadPendiente: vi.fn(async () => ({ faltantes: [] })),
}))
vi.mock('@/features/ciclos/congelamiento', () => ({ paisCongelado: vi.fn(async () => false), paisesCongelados: vi.fn(async () => new Set()) }))
vi.mock('@/features/objetivos/acciones-periodo', () => ({ validarVentanaCarga: vi.fn() }))
vi.mock('@/features/objetivos/alcance-periodo', () => ({ colaboradoresDelPeriodo: vi.fn(async () => []) }))
vi.mock('@/shared/lib/mailer', () => ({
  construirAperturaCiclo: vi.fn(),
  enviarBatch: vi.fn(async () => ({ enviados: 0, fallidos: 0, erroresMuestra: [] })),
  enviarCambioTransversales: vi.fn(),
  enviarResultadosPublicados: vi.fn(async () => ({})),
}))
vi.mock('@/shared/lib/push', () => ({ enviarPushACorreos: vi.fn(async () => ({ enviados: 0 })) }))
vi.mock('@/features/recordatorios/pendientes', () => ({ pendientesEvaluaciones: vi.fn() }))
vi.mock('@/features/ciclos/alcance', () => ({ paisIdDerivado: vi.fn(() => null), resolverAlcance: vi.fn(() => ({ evaluados: [] })) }))
vi.mock('@/shared/lib/prisma', () => ({
  prisma: {
    ciclo: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    asignacion: { findMany: vi.fn() },
    cicloPaisCierre: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    resultado: { findMany: vi.fn() },
    colaborador: { findMany: vi.fn() },
    pais: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async () => []),
  },
}))

import { prisma } from '@/shared/lib/prisma'
import { enviarResultadosPublicados } from '@/shared/lib/mailer'
import { alcancePaisWhere } from '@/shared/lib/permisos'
import { excluidoPorAntiguedad } from '@/domain/antiguedad'
import { cerrarCiclo, cerrarPaisCiclo, publicarPaisCiclo, buscarCandidatosParRrhh } from './acciones'

const prismaMock = vi.mocked(prisma, true)
const mailerMock = vi.mocked(enviarResultadosPublicados)

const CICLO = {
  id: 'TST-ciclo', nombre: 'TST Ciclo 2026', estado: 'ACTIVO', publicado: false, paisId: null,
  focoPaisIds: [], focoAreaIds: [], focoNivelIds: [], incluirIds: [], excluirIds: [],
}
const DESTINO = {
  colaborador: {
    nombres: 'Ana', apellidos: 'Torres', activo: true, paisId: 'TST-pais-1',
    usuario: { email: 'ana@tst.pe', activo: true },
  },
}

const flush = () => new Promise((r) => setImmediate(r))

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.ciclo.findUnique.mockResolvedValue(CICLO as never)
  prismaMock.ciclo.updateMany.mockResolvedValue({ count: 1 } as never)
  // estadoPaisesCiclo: un país participante, sin cierres previos
  prismaMock.asignacion.findMany.mockResolvedValue([{ evaluado: { paisId: 'TST-pais-1' } }] as never)
  prismaMock.cicloPaisCierre.findMany.mockResolvedValue([] as never)
  prismaMock.cicloPaisCierre.create.mockResolvedValue({} as never)
  prismaMock.cicloPaisCierre.updateMany.mockResolvedValue({ count: 1 } as never)
  prismaMock.resultado.findMany.mockResolvedValue([DESTINO] as never)
  prismaMock.pais.findUnique.mockResolvedValue({ id: 'TST-pais-1', nombre: 'Perú' } as never)
  prismaMock.$transaction.mockResolvedValue([] as never)
})

describe('cerrarCiclo — el claim se libera si el cierre no puede persistirse', () => {
  it('si la transacción del cierre falla: devuelve error reintentable, revierte a ACTIVO y NO envía correos', async () => {
    prismaMock.$transaction.mockRejectedValue(new Error('conexión perdida') as never)

    const res = await cerrarCiclo('TST-ciclo', true)
    await flush()

    expect(res.ok).toBe(false)
    // El revert: alguna llamada a ciclo.updateMany con data.estado ACTIVO
    const reverts = prismaMock.ciclo.updateMany.mock.calls.filter(
      (c) => (c[0] as { data: { estado?: string } }).data.estado === 'ACTIVO',
    )
    expect(reverts.length).toBe(1)
    expect(mailerMock).not.toHaveBeenCalled()
  })

  it('con el cierre persistido, los correos salen DESPUÉS del commit', async () => {
    const res = await cerrarCiclo('TST-ciclo', true)
    await flush()

    expect(res.ok).toBe(true)
    expect(mailerMock).toHaveBeenCalled()
    const ordenTx = prismaMock.$transaction.mock.invocationCallOrder[0]
    const ordenCorreo = mailerMock.mock.invocationCallOrder[0]
    expect(ordenTx).toBeLessThan(ordenCorreo)
  })
})

describe('cerrarPaisCiclo — el create del cierre ES el claim (doble clic / dos pestañas)', () => {
  it('la pestaña perdedora (P2002) se retira con error y SIN notificar al país', async () => {
    prismaMock.cicloPaisCierre.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }) as never)

    const res = await cerrarPaisCiclo('TST-ciclo', 'TST-pais-1', true)
    await flush()

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('ya está cerrado')
    expect(mailerMock).not.toHaveBeenCalled()
  })

  it('la ganadora reclama el cierre ANTES de notificar', async () => {
    // Tras el cierre del único país participante, el auto-cierre consulta de nuevo el estado
    prismaMock.cicloPaisCierre.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValue([{ paisId: 'TST-pais-1', publicado: true }] as never)

    const res = await cerrarPaisCiclo('TST-ciclo', 'TST-pais-1', true)
    await flush()

    expect(res.ok).toBe(true)
    expect(mailerMock).toHaveBeenCalled()
    expect(prismaMock.cicloPaisCierre.create.mock.invocationCallOrder[0]).toBeLessThan(mailerMock.mock.invocationCallOrder[0])
  })
})

describe('publicarPaisCiclo — publicación reclamada atómicamente', () => {
  beforeEach(() => {
    prismaMock.ciclo.findUnique.mockResolvedValue({ nombre: 'TST Ciclo 2026', publicado: false } as never)
    prismaMock.cicloPaisCierre.findUnique.mockResolvedValue({ id: 'TST-cierre', publicado: false } as never)
  })

  it('la segunda invocación simultánea no reenvía correos ni devuelve éxito', async () => {
    // Ambas pestañas leyeron publicado:false; solo una gana el updateMany condicionado
    prismaMock.cicloPaisCierre.updateMany.mockResolvedValue({ count: 0 } as never)

    const res = await publicarPaisCiclo('TST-ciclo', 'TST-pais-1')
    await flush()

    expect(res.ok).toBe(false)
    expect(mailerMock).not.toHaveBeenCalled()
  })

  it('la ganadora publica y notifica después de reclamar', async () => {
    const res = await publicarPaisCiclo('TST-ciclo', 'TST-pais-1')
    await flush()

    expect(res.ok).toBe(true)
    expect(mailerMock).toHaveBeenCalled()
    expect(prismaMock.cicloPaisCierre.updateMany.mock.invocationCallOrder[0]).toBeLessThan(mailerMock.mock.invocationCallOrder[0])
  })
})

describe('notificarResultadosPublicados — solo a quien tiene nota', () => {
  /* Publicar un país (o ciclo) donde algún participante quedó SIN nota (nadie le envió
     evaluaciones) mandaba igual «tu resultado ya está disponible»: la consulta de destinos no
     filtraba por nota y esa persona abría «Mi resultado» vacío. El correo debe ir SOLO a
     resultados con notaFinal o notaCalibrada. */
  it('al publicar un país, el correo va solo a los resultados con nota', async () => {
    prismaMock.ciclo.findUnique.mockResolvedValue({ nombre: 'TST Ciclo 2026', publicado: false } as never)
    prismaMock.cicloPaisCierre.findUnique.mockResolvedValue({ id: 'TST-cierre', publicado: false } as never)
    // La base honra el where: SIN filtro de nota devolvería también al participante sin resultado
    prismaMock.resultado.findMany.mockImplementation(((args: { where: { OR?: unknown } }) =>
      Promise.resolve(args.where.OR
        ? [DESTINO]
        : [DESTINO, {
            colaborador: {
              nombres: 'Sin', apellidos: 'Nota', activo: true, paisId: 'TST-pais-1',
              usuario: { email: 'sinnota@tst.pe', activo: true },
            },
          }])) as never)

    const res = await publicarPaisCiclo('TST-ciclo', 'TST-pais-1')
    await flush()

    expect(res.ok).toBe(true)
    expect(mailerMock).toHaveBeenCalledTimes(1)
    expect(mailerMock.mock.calls[0][0]).toBe('ana@tst.pe')
  })
})

describe('buscarCandidatosParRrhh — mismo contrato que asignarPar (auditoría 0824)', () => {
  /* asignarPar acepta deliberadamente pares de CUALQUIER país (altos mandos suelen tener a sus
     pares reales en otro país) y rechaza a quien tiene <6 meses de antigüedad. El buscador debe
     ofrecer exactamente ese universo: acotarlo por país escondía al par real transfronterizo, y
     no filtrar la antigüedad producía un rechazo confuso recién al asignar. */
  const CANDIDATOS = [
    { id: 'TST-par-pe', nombres: 'Ana', apellidos: 'Torres', jefeId: null, fechaIngreso: new Date('2020-01-01'), pais: { codigo: 'PE' } },
    { id: 'TST-par-nuevo', nombres: 'Beto', apellidos: 'Vega', jefeId: null, fechaIngreso: new Date('2026-06-01'), pais: { codigo: 'EC' } },
  ]

  beforeEach(() => {
    prismaMock.ciclo.findUnique.mockResolvedValue({ estado: 'ACTIVO', fechaInicio: new Date('2026-01-01') } as never)
    prismaMock.colaborador.findMany.mockResolvedValue(CANDIDATOS as never)
    // Beto tiene 4 meses al inicio del ciclo: asignarPar lo rechazaría
    vi.mocked(excluidoPorAntiguedad).mockImplementation((fechaIngreso) =>
      fechaIngreso instanceof Date && fechaIngreso.getTime() === new Date('2026-06-01').getTime())
  })

  it('no acota por país del RR.HH.: el par real puede estar en otro país', async () => {
    await buscarCandidatosParRrhh('TST-ciclo', 'to')

    expect(vi.mocked(alcancePaisWhere)).not.toHaveBeenCalled()
  })

  it('excluye a quien asignarPar rechazaría por antigüedad', async () => {
    const res = await buscarCandidatosParRrhh('TST-ciclo', 'to')

    expect(res.map((c) => c.id)).toEqual(['TST-par-pe'])
  })
})
