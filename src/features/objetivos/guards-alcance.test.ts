import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SesionUsuario } from '@/shared/lib/auth'

// --- Mocks de todas las dependencias externas de acciones.ts (mismo patrón que
// resolver-objetivo-correo.test.ts) -----------------------------------------------------------

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/shared/lib/prisma', () => ({
  prisma: {
    objetivo: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    usuario: {
      findFirst: vi.fn(),
    },
    periodoObjetivos: {
      findUnique: vi.fn(),
    },
    colaborador: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/shared/lib/mailer', () => ({
  enviarObjetivosAprobados: vi.fn(),
  enviarObjetivoReemplazado: vi.fn(),
  enviarObjetivoAsignado: vi.fn(),
}))

// `validarVentanaCarga` se mockea entero: estos casos prueban el guard de ALCANCE, que corre
// después de la ventana de carga, así que la ventana nunca debe bloquearlos.
vi.mock('./acciones-periodo', () => ({
  validarVentanaCarga: vi.fn(),
}))

vi.mock('@/features/resultados/servicio', () => ({
  objetivosAplicables: vi.fn(),
}))

vi.mock('@/shared/lib/permisos', () => ({
  requiereJefe: vi.fn(),
  requiereSesion: vi.fn(),
  alcancePaisWhere: vi.fn(() => ({})),
}))

vi.mock('@/shared/lib/permisos-admin', () => ({
  tieneAdmin: vi.fn(() => false),
}))

import { proponerObjetivo, resolverObjetivo, editarObjetivo, asignarObjetivo } from './acciones'
import { prisma } from '@/shared/lib/prisma'
import { validarVentanaCarga } from './acciones-periodo'
import { objetivosAplicables } from '@/features/resultados/servicio'
import { requiereJefe, requiereSesion } from '@/shared/lib/permisos'

const prismaMock = vi.mocked(prisma, true)

// --- Fixtures --------------------------------------------------------------------------------

const SESION_COLABORADOR: SesionUsuario = {
  id: 'usuario-colab-1',
  email: 'colaborador@hunter.test',
  name: 'Colaborador De Prueba',
  rol: 'COLABORADOR',
  colaboradorId: 'colab-1',
  esJefe: false,
  alcanceRrhh: null,
  alcancePaisId: null,
  permisosAdmin: {},
}

const SESION_JEFE: SesionUsuario = {
  id: 'usuario-jefe-1',
  email: 'jefe@hunter.test',
  name: 'Jefe De Prueba',
  rol: 'COLABORADOR',
  colaboradorId: 'colab-jefe-1',
  esJefe: true,
  alcanceRrhh: null,
  alcancePaisId: null,
  permisosAdmin: {},
}

// Período con foco de país 'pe': cualquier colaborador con paisId distinto queda fuera de alcance.
const PERIODO_FUERA_PE = {
  id: 'periodo-1',
  nombre: 'Periodo Q3',
  focoPaisIds: ['pe'],
  focoAreaIds: [] as string[],
  focoNivelIds: [] as string[],
  incluirIds: [] as string[],
  excluirIds: [] as string[],
}

// El mismo período sin restricción: cualquiera entra (control positivo, no usado por defecto aquí).
const PERIODO_SIN_FOCO = {
  ...PERIODO_FUERA_PE,
  focoPaisIds: [] as string[],
}

/** Colaborador con paisId 'cl': queda FUERA del alcance de PERIODO_FUERA_PE (foco país 'pe'). */
const DUENO_FUERA_DE_ALCANCE = { id: 'colab-1', activo: true, paisId: 'cl', areaId: 'area-1', puesto: { nivelId: 'nivel-1' } }

function formData(campos: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requiereSesion).mockResolvedValue(SESION_COLABORADOR)
  vi.mocked(requiereJefe).mockResolvedValue(SESION_JEFE)
  vi.mocked(validarVentanaCarga).mockResolvedValue(null)
  vi.mocked(objetivosAplicables).mockResolvedValue({ transversales: [], individuales: [] } as never)
})

const ERROR_FUERA_DE_ALCANCE = 'Este período no aplica a ese colaborador'

describe('guard de alcance del período — proponerObjetivo', () => {
  it('dueño fuera del alcance del período: bloquea con el error de alcance y no crea el objetivo', async () => {
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue(PERIODO_FUERA_PE as never)
    prismaMock.colaborador.findUnique.mockResolvedValue(DUENO_FUERA_DE_ALCANCE as never)

    const resultado = await proponerObjetivo(formData({
      periodoId: 'periodo-1',
      titulo: 'Objetivo válido',
      descripcion: 'Descripción válida',
      tipo: 'INDIVIDUAL',
      peso: '20',
    }))

    expect(resultado).toEqual({ ok: false, error: ERROR_FUERA_DE_ALCANCE })
    expect(prismaMock.objetivo.create).not.toHaveBeenCalled()
  })
})

describe('guard de alcance del período — editarObjetivo', () => {
  it('dueño fuera del alcance del período: bloquea con el error de alcance y no edita el objetivo', async () => {
    prismaMock.objetivo.findUnique.mockResolvedValue({
      id: 'obj-1',
      periodoId: 'periodo-1',
      colaboradorId: 'colab-1',
      tipo: 'INDIVIDUAL',
      titulo: 'Título original',
      descripcion: 'Descripción original',
      peso: 20,
      metaFecha: null,
      metrica: null,
      estado: 'PROPUESTO',
      colaborador: { id: 'colab-1', jefeId: null },
    } as never)
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue(PERIODO_FUERA_PE as never)
    prismaMock.colaborador.findUnique.mockResolvedValue(DUENO_FUERA_DE_ALCANCE as never)

    const resultado = await editarObjetivo(formData({
      objetivoId: 'obj-1',
      titulo: 'Título editado',
      descripcion: 'Descripción editada',
      tipo: 'INDIVIDUAL',
      peso: '25',
    }))

    expect(resultado).toEqual({ ok: false, error: ERROR_FUERA_DE_ALCANCE })
    expect(prismaMock.objetivo.update).not.toHaveBeenCalled()
  })
})

describe('guard de alcance del período — asignarObjetivo', () => {
  it('dueño fuera del alcance del período: bloquea con el error de alcance y no crea el objetivo', async () => {
    // Mismo mock cubre ambas consultas de colaborador.findUnique: la de permiso (jefeId) y la
    // del guard de alcance (paisId fuera del foco).
    prismaMock.colaborador.findUnique.mockResolvedValue({ ...DUENO_FUERA_DE_ALCANCE, jefeId: 'colab-jefe-1' } as never)
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue(PERIODO_FUERA_PE as never)

    const resultado = await asignarObjetivo(formData({
      colaboradorId: 'colab-1',
      periodoId: 'periodo-1',
      titulo: 'Objetivo asignado',
      descripcion: 'Descripción asignada',
      tipo: 'INDIVIDUAL',
      peso: '30',
    }))

    expect(resultado).toEqual({ ok: false, error: ERROR_FUERA_DE_ALCANCE })
    expect(prismaMock.objetivo.create).not.toHaveBeenCalled()
  })
})

describe('guard de alcance del período — resolverObjetivo', () => {
  function objetivoBase() {
    return {
      id: 'obj-1',
      periodoId: 'periodo-1',
      colaboradorId: 'colab-1',
      tipo: 'INDIVIDUAL',
      titulo: 'Título original',
      descripcion: 'Descripción original',
      peso: 20,
      metaFecha: null as string | null,
      metrica: null as string | null,
      estado: 'PROPUESTO',
      colaborador: { id: 'colab-1', jefeId: 'colab-jefe-1' },
    }
  }

  it('APROBAR con dueño fuera del alcance del período: bloquea con el error de alcance y no actualiza', async () => {
    prismaMock.objetivo.findUnique.mockResolvedValue(objetivoBase() as never)
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue(PERIODO_FUERA_PE as never)
    prismaMock.colaborador.findUnique.mockResolvedValue(DUENO_FUERA_DE_ALCANCE as never)

    const resultado = await resolverObjetivo(formData({ objetivoId: 'obj-1', decision: 'APROBADO' }))

    expect(resultado).toEqual({ ok: false, error: ERROR_FUERA_DE_ALCANCE })
    expect(prismaMock.objetivo.update).not.toHaveBeenCalled()
  })

  it('RECHAZAR con dueño fuera del alcance del período: SÍ procede (transferencias no dejan el objetivo en limbo)', async () => {
    prismaMock.objetivo.findUnique.mockResolvedValue(objetivoBase() as never)
    // El período excluye al dueño y el guard de alcance ni siquiera debe consultarlo para esta
    // rama: si se llamara, probaría que el guard NO fue eximido.
    prismaMock.periodoObjetivos.findUnique.mockResolvedValue(PERIODO_FUERA_PE as never)
    prismaMock.colaborador.findUnique.mockResolvedValue(DUENO_FUERA_DE_ALCANCE as never)

    const resultado = await resolverObjetivo(formData({ objetivoId: 'obj-1', decision: 'RECHAZADO' }))

    expect(resultado).toEqual({ ok: true })
    expect(prismaMock.objetivo.update).toHaveBeenCalledWith({
      where: { id: 'obj-1' },
      data: { estado: 'RECHAZADO' },
    })
    // Prueba de comportamiento real (no tautológica): el guard de alcance consulta el período vía
    // periodoObjetivos.findUnique; si no se llamó, es porque la rama RECHAZADO lo evitó por completo.
    expect(prismaMock.periodoObjetivos.findUnique).not.toHaveBeenCalled()
  })
})
