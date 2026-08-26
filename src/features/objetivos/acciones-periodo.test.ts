import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SesionUsuario } from '@/shared/lib/auth'

// --- Mocks de todas las dependencias externas de crearPeriodo/editarAlcancePeriodo/eliminarPeriodo ---

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: vi.fn() })),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

vi.mock('@/shared/lib/prisma', () => ({
  prisma: {
    periodoObjetivos: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
    },
    colaborador: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}))

vi.mock('@/shared/lib/mailer', () => ({
  enviarAperturaObjetivos: vi.fn(),
  enviarRecordatorioObjetivos: vi.fn(),
}))

// Mock PARCIAL: los guards se sustituyen, pero `periodoFueraDeAlcance` se deja el real — es el
// criterio que estos tests están comprobando, y falsearlo los volvería decorativos
vi.mock('@/shared/lib/permisos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permisos')>()),
  requiereSesion: vi.fn(),
  requiereAdmin: vi.fn(),
  alcancePaisWhere: vi.fn(() => ({})),
  fueraDeAlcancePais: vi.fn(() => false),
}))

vi.mock('@/shared/lib/permisos-admin', () => ({
  tieneAdmin: vi.fn(() => false),
}))

import { crearPeriodo, editarAlcancePeriodo, eliminarPeriodo, abrirCargaPeriodo, cerrarPeriodo, extenderPlazoPeriodo } from './acciones-periodo'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin } from '@/shared/lib/permisos'

const prismaMock = vi.mocked(prisma, true)

// --- Fixtures ------------------------------------------------------------------------------------

const SESION_REGIONAL: SesionUsuario = {
  id: 'rrhh-regional-1',
  email: 'rrhh@hunter.test',
  name: 'RRHH Regional',
  rol: 'RRHH',
  colaboradorId: 'colab-rrhh-1',
  esJefe: false,
  alcanceRrhh: 'REGIONAL',
  alcancePaisId: null,
  permisosAdmin: {},
}

const SESION_PAIS_CL: SesionUsuario = {
  ...SESION_REGIONAL,
  id: 'rrhh-cl-1',
  alcanceRrhh: 'PAIS',
  alcancePaisId: 'CL',
}

const ALCANCE_VACIO = { focoPaisIds: [] as string[], focoAreaIds: [] as string[], focoNivelIds: [] as string[], incluirIds: [] as string[], excluirIds: [] as string[] }

function formData(campos: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requiereAdmin).mockResolvedValue(SESION_REGIONAL)
  prismaMock.colaborador.count.mockResolvedValue(0 as never)
})

// --- crearPeriodo ---------------------------------------------------------------------------------

describe('crearPeriodo', () => {
  it('crea el período persistiendo el alcance y el AuditLog con el alcance', async () => {
    prismaMock.periodoObjetivos.create.mockResolvedValue({ id: 'periodo-1', nombre: '2027', tipo: 'ANUAL' } as never)

    const resultado = await crearPeriodo(
      formData({ nombre: '2027', tipo: 'ANUAL', fechaLimiteCarga: '2027-01-31' }),
      { ...ALCANCE_VACIO, focoPaisIds: ['CL', 'PE'] },
    )

    expect(resultado).toEqual({ ok: true })
    expect(prismaMock.periodoObjetivos.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        nombre: '2027', tipo: 'ANUAL',
        focoPaisIds: ['CL', 'PE'], focoAreaIds: [], focoNivelIds: [], incluirIds: [], excluirIds: [],
      }),
    })
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accion: 'PERIODO_CREADO',
        detalle: expect.objectContaining({ alcance: expect.objectContaining({ focoPaisIds: ['CL', 'PE'] }) }),
      }),
    })
  })

  it('RRHH-país: fuerza su país en el foco sin importar lo que llegue del cliente', async () => {
    vi.mocked(requiereAdmin).mockResolvedValue(SESION_PAIS_CL)
    prismaMock.periodoObjetivos.create.mockResolvedValue({ id: 'periodo-1', nombre: '2027', tipo: 'ANUAL' } as never)

    await crearPeriodo(
      formData({ nombre: '2027', tipo: 'ANUAL', fechaLimiteCarga: '2027-01-31' }),
      { ...ALCANCE_VACIO, focoPaisIds: ['PE'] }, // el cliente intenta mandar otro país
    )

    expect(prismaMock.periodoObjetivos.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ focoPaisIds: ['CL'] }),
    })
  })

  it('RRHH-país: rechaza ajustes manuales que referencian colaboradores de otro país', async () => {
    vi.mocked(requiereAdmin).mockResolvedValue(SESION_PAIS_CL)
    prismaMock.colaborador.count.mockResolvedValue(1 as never) // hay 1 fuera de CL

    const resultado = await crearPeriodo(
      formData({ nombre: '2027', tipo: 'ANUAL', fechaLimiteCarga: '2027-01-31' }),
      { ...ALCANCE_VACIO, incluirIds: ['colab-fuera-de-cl'] },
    )

    expect(resultado).toEqual({ ok: false, error: 'Los ajustes manuales solo pueden incluir colaboradores de tu país' })
    expect(prismaMock.periodoObjetivos.create).not.toHaveBeenCalled()
  })

  it('nombre duplicado: traduce el error P2002 de Prisma', async () => {
    prismaMock.periodoObjetivos.create.mockRejectedValue({ code: 'P2002' } as never)

    const resultado = await crearPeriodo(
      formData({ nombre: '2027', tipo: 'ANUAL', fechaLimiteCarga: '2027-01-31' }),
      ALCANCE_VACIO,
    )

    expect(resultado).toEqual({ ok: false, error: 'Ya existe un período con ese nombre' })
  })

  it('fecha límite inválida: no llega a validar alcance ni a crear', async () => {
    const resultado = await crearPeriodo(
      formData({ nombre: '2027', tipo: 'ANUAL', fechaLimiteCarga: 'no-es-una-fecha' }),
      ALCANCE_VACIO,
    )

    expect(resultado).toEqual({ ok: false, error: 'Fecha límite inválida' })
    expect(prismaMock.periodoObjetivos.create).not.toHaveBeenCalled()
  })
})

// --- editarAlcancePeriodo -------------------------------------------------------------------------

describe('editarAlcancePeriodo', () => {
  it('en BORRADOR: guarda el nuevo alcance', async () => {
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue({ id: 'periodo-1', nombre: '2027', estado: 'BORRADOR', focoPaisIds: [] } as never)

    const resultado = await editarAlcancePeriodo('periodo-1', { ...ALCANCE_VACIO, focoAreaIds: ['area-1'] })

    expect(resultado).toEqual({ ok: true })
    expect(prismaMock.periodoObjetivos.update).toHaveBeenCalledWith({
      where: { id: 'periodo-1' },
      data: expect.objectContaining({ focoAreaIds: ['area-1'] }),
    })
  })

  it('fuera de BORRADOR: bloquea sin tocar la base', async () => {
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue({ id: 'periodo-1', nombre: '2027', estado: 'CARGA_ABIERTA', focoPaisIds: [] } as never)

    const resultado = await editarAlcancePeriodo('periodo-1', ALCANCE_VACIO)

    expect(resultado).toEqual({ ok: false, error: 'El alcance solo se edita en borrador: con la carga abierta ya hay trabajo hecho sobre él' })
    expect(prismaMock.periodoObjetivos.update).not.toHaveBeenCalled()
  })

  it('período no encontrado', async () => {
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue(null as never)

    const resultado = await editarAlcancePeriodo('periodo-inexistente', ALCANCE_VACIO)

    expect(resultado).toEqual({ ok: false, error: 'Período no encontrado' })
  })

  // --- Candado de país (IMPORTANT-2) ---

  it('RRHH-país: bloquea editar un período REGIONAL (foco vacío) — secuestro de alcance', async () => {
    vi.mocked(requiereAdmin).mockResolvedValue(SESION_PAIS_CL)
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue({ id: 'periodo-1', nombre: '2027', estado: 'BORRADOR', focoPaisIds: [] } as never)

    const resultado = await editarAlcancePeriodo('periodo-1', ALCANCE_VACIO)

    expect(resultado).toEqual({ ok: false, error: 'Ese período está fuera de tu país' })
    expect(prismaMock.periodoObjetivos.update).not.toHaveBeenCalled()
  })

  it('RRHH-país: bloquea editar un período de OTRO país', async () => {
    vi.mocked(requiereAdmin).mockResolvedValue(SESION_PAIS_CL)
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue({ id: 'periodo-1', nombre: '2027', estado: 'BORRADOR', focoPaisIds: ['PE'] } as never)

    const resultado = await editarAlcancePeriodo('periodo-1', ALCANCE_VACIO)

    expect(resultado).toEqual({ ok: false, error: 'Ese período está fuera de tu país' })
    expect(prismaMock.periodoObjetivos.update).not.toHaveBeenCalled()
  })

  it('RRHH-país: SÍ puede editar un período acotado exactamente a su propio país', async () => {
    vi.mocked(requiereAdmin).mockResolvedValue(SESION_PAIS_CL)
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue({ id: 'periodo-1', nombre: '2027', estado: 'BORRADOR', focoPaisIds: ['CL'] } as never)

    const resultado = await editarAlcancePeriodo('periodo-1', ALCANCE_VACIO)

    expect(resultado).toEqual({ ok: true })
    expect(prismaMock.periodoObjetivos.update).toHaveBeenCalled()
  })

  it('Regional: sin restricción, edita cualquier período (foco vacío incluido)', async () => {
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue({ id: 'periodo-1', nombre: '2027', estado: 'BORRADOR', focoPaisIds: [] } as never)

    const resultado = await editarAlcancePeriodo('periodo-1', ALCANCE_VACIO)

    expect(resultado).toEqual({ ok: true })
  })
})

// --- eliminarPeriodo -------------------------------------------------------------------------------

describe('eliminarPeriodo', () => {
  it('en BORRADOR sin ciclos: elimina', async () => {
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue({
      id: 'periodo-1', nombre: '2027', estado: 'BORRADOR',
      _count: { objetivos: 3, ciclos: 0 }, ciclos: [],
    } as never)

    const resultado = await eliminarPeriodo('periodo-1')

    expect(resultado).toEqual({ ok: true })
    expect(prismaMock.periodoObjetivos.delete).toHaveBeenCalledWith({ where: { id: 'periodo-1' } })
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ accion: 'PERIODO_ELIMINADO', detalle: expect.objectContaining({ objetivosBorrados: 3 }) }),
    })
  })

  it('con un ciclo que lo referencia: bloquea y nombra el ciclo', async () => {
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue({
      id: 'periodo-1', nombre: '2027', estado: 'BORRADOR',
      _count: { objetivos: 0, ciclos: 1 }, ciclos: [{ nombre: 'Evaluación anual 2027' }],
    } as never)

    const resultado = await eliminarPeriodo('periodo-1')

    expect(resultado).toEqual({ ok: false, error: 'El ciclo «Evaluación anual 2027» usa este período: desvincúlalo o bórralo primero' })
    expect(prismaMock.periodoObjetivos.delete).not.toHaveBeenCalled()
  })

  it('fuera de BORRADOR: bloquea', async () => {
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue({
      id: 'periodo-1', nombre: '2027', estado: 'CERRADO',
      _count: { objetivos: 0, ciclos: 0 }, ciclos: [],
    } as never)

    const resultado = await eliminarPeriodo('periodo-1')

    expect(resultado).toEqual({ ok: false, error: 'Solo se elimina un período en borrador' })
    expect(prismaMock.periodoObjetivos.delete).not.toHaveBeenCalled()
  })

  // --- Candado de país (IMPORTANT-2) ---

  it('RRHH-país: bloquea borrar el borrador de un período REGIONAL (foco vacío)', async () => {
    vi.mocked(requiereAdmin).mockResolvedValue(SESION_PAIS_CL)
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue({
      id: 'periodo-1', nombre: '2027', estado: 'BORRADOR', focoPaisIds: [],
      _count: { objetivos: 3, ciclos: 0 }, ciclos: [],
    } as never)

    const resultado = await eliminarPeriodo('periodo-1')

    expect(resultado).toEqual({ ok: false, error: 'Ese período está fuera de tu país' })
    expect(prismaMock.periodoObjetivos.delete).not.toHaveBeenCalled()
  })

  it('RRHH-país: bloquea borrar un período de OTRO país', async () => {
    vi.mocked(requiereAdmin).mockResolvedValue(SESION_PAIS_CL)
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue({
      id: 'periodo-1', nombre: '2027', estado: 'BORRADOR', focoPaisIds: ['PE'],
      _count: { objetivos: 0, ciclos: 0 }, ciclos: [],
    } as never)

    const resultado = await eliminarPeriodo('periodo-1')

    expect(resultado).toEqual({ ok: false, error: 'Ese período está fuera de tu país' })
    expect(prismaMock.periodoObjetivos.delete).not.toHaveBeenCalled()
  })

  it('RRHH-país: SÍ puede borrar un período acotado exactamente a su propio país', async () => {
    vi.mocked(requiereAdmin).mockResolvedValue(SESION_PAIS_CL)
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue({
      id: 'periodo-1', nombre: '2027', estado: 'BORRADOR', focoPaisIds: ['CL'],
      _count: { objetivos: 0, ciclos: 0 }, ciclos: [],
    } as never)

    const resultado = await eliminarPeriodo('periodo-1')

    expect(resultado).toEqual({ ok: true })
    expect(prismaMock.periodoObjetivos.delete).toHaveBeenCalled()
  })
})

/* El candado de país faltaba en las tres acciones que CAMBIAN EL ESTADO del período, mientras sus
   dos hermanas (editar alcance y eliminar) sí lo tenían. Abrir la carga además dispara correo y
   push a todo el alcance del período, y extender el plazo REABRE un período cerrado: un RR.HH. de
   país podía reabrir el de otro país y notificar a su plantilla. */
describe('acciones de estado del período — candado de país', () => {
  const PERIODO_AJENO = { id: 'periodo-pe', nombre: '2027', focoPaisIds: ['PE'], fechaLimiteCarga: new Date('2027-01-31') }

  beforeEach(() => {
    vi.mocked(requiereAdmin).mockResolvedValue(SESION_PAIS_CL)
  })

  it('abrirCargaPeriodo: bloquea el período de otro país (y no notifica a nadie)', async () => {
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue({ ...PERIODO_AJENO, estado: 'BORRADOR' } as never)

    const resultado = await abrirCargaPeriodo('periodo-pe')

    expect(resultado).toEqual({ ok: false, error: 'Ese período está fuera de tu país' })
    expect(prismaMock.periodoObjetivos.update).not.toHaveBeenCalled()
  })

  it('cerrarPeriodo: bloquea el período de otro país', async () => {
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue({ ...PERIODO_AJENO, estado: 'CARGA_ABIERTA' } as never)

    const resultado = await cerrarPeriodo('periodo-pe')

    expect(resultado).toEqual({ ok: false, error: 'Ese período está fuera de tu país' })
    expect(prismaMock.periodoObjetivos.update).not.toHaveBeenCalled()
  })

  it('extenderPlazoPeriodo: no puede reabrir el período CERRADO de otro país', async () => {
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue({ ...PERIODO_AJENO, estado: 'CERRADO' } as never)
    const fd = new FormData()
    fd.set('fechaLimiteCarga', '2027-03-31')

    const resultado = await extenderPlazoPeriodo('periodo-pe', fd)

    expect(resultado).toEqual({ ok: false, error: 'Ese período está fuera de tu país' })
    expect(prismaMock.periodoObjetivos.update).not.toHaveBeenCalled()
  })

  it('el período de su PROPIO país sí se cierra', async () => {
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue({ id: 'periodo-cl', nombre: '2027', focoPaisIds: ['CL'], estado: 'CARGA_ABIERTA' } as never)

    const resultado = await cerrarPeriodo('periodo-cl')

    expect(resultado).toEqual({ ok: true })
    expect(prismaMock.periodoObjetivos.update).toHaveBeenCalled()
  })
})
