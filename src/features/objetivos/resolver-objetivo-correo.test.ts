import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SesionUsuario } from '@/shared/lib/auth'

// --- Mocks de todas las dependencias externas de resolverObjetivo -----------------------------

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

// `validarVentanaCarga` vive en acciones-periodo.ts (módulo hermano, separado de acciones.ts):
// se mockea entero para que la ventana de carga nunca bloquee estos casos.
vi.mock('./acciones-periodo', () => ({
  validarVentanaCarga: vi.fn(),
}))

// `objetivosAplicables` decide cuánto peso está "usado" por transversales + individuales: se
// mockea para controlar exactamente el total que debe viajar en el correo de aprobación.
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

import { resolverObjetivo, asignarObjetivo } from './acciones'
import { prisma } from '@/shared/lib/prisma'
import { enviarObjetivosAprobados, enviarObjetivoReemplazado, enviarObjetivoAsignado } from '@/shared/lib/mailer'
import { validarVentanaCarga } from './acciones-periodo'
import { objetivosAplicables } from '@/features/resultados/servicio'
import { requiereJefe } from '@/shared/lib/permisos'

const prismaMock = vi.mocked(prisma, true)

// --- Fixtures compartidas -----------------------------------------------------------------------

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

/** Objetivo base PROPUESTO de un colaborador cuyo jefe directo es SESION_JEFE (así
 * `puedeGestionarObjetivosDe` — función interna no exportada de acciones.ts — resuelve
 * `colaborador.jefeId === sesion.colaboradorId` en `true` sin necesitar mocks adicionales). */
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

/** `objetivosAplicables` con un transversal de 10% y otro individual APROBADO de 15% (más el
 * propio `obj-1`, que el cálculo de `usado` excluye por id): usado = 10 + 15 = 25. */
function objetivosAplicablesMock() {
  return {
    transversales: [{ peso: 10 }],
    individuales: [
      { id: 'obj-1', estado: 'PROPUESTO', peso: 20 },
      { id: 'obj-otro', estado: 'APROBADO', peso: 15 },
    ],
  }
}

function formData(campos: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requiereJefe).mockResolvedValue(SESION_JEFE)
  vi.mocked(validarVentanaCarga).mockResolvedValue(null)
  vi.mocked(objetivosAplicables).mockResolvedValue(objetivosAplicablesMock() as never)
  prismaMock.periodoObjetivos.findUnique.mockResolvedValue({
    nombre: 'Periodo Q3', focoPaisIds: [], focoAreaIds: [], focoNivelIds: [], incluirIds: [], excluirIds: [],
  } as never)
  // Dueño del objetivo dentro del alcance del período (guard de Task 3): por defecto, activo y sin
  // restricción alguna lo cubre (alcance vacío = toda la organización).
  prismaMock.colaborador.findUnique.mockResolvedValue({
    id: 'colab-1', activo: true, paisId: 'pe', areaId: 'area-1', puesto: { nivelId: 'nivel-1' },
  } as never)
  vi.mocked(enviarObjetivosAprobados).mockResolvedValue(undefined)
  vi.mocked(enviarObjetivoReemplazado).mockResolvedValue(undefined)
  vi.mocked(enviarObjetivoAsignado).mockResolvedValue(undefined)
})

// --- Casos ---------------------------------------------------------------------------------------

describe('resolverObjetivo → correo de objetivos aprobados', () => {
  it('aprobación SIMPLE (sin ajuste de contenido): envía enviarObjetivosAprobados una vez con el total correcto y no envía reemplazo', async () => {
    const objetivo = objetivoBase()
    prismaMock.objetivo.findUnique.mockResolvedValue(objetivo as never)
    prismaMock.usuario.findFirst.mockResolvedValue({
      email: 'colaborador@hunter.test',
      colaborador: { nombres: 'Ana', apellidos: 'Pérez' },
    } as never)

    const resultado = await resolverObjetivo(formData({ objetivoId: 'obj-1', decision: 'APROBADO' }))

    expect(resultado).toEqual({ ok: true })
    expect(prismaMock.objetivo.update).toHaveBeenCalledWith({
      where: { id: 'obj-1' },
      data: { estado: 'APROBADO', peso: 20 },
    })
    expect(enviarObjetivosAprobados).toHaveBeenCalledTimes(1)
    expect(enviarObjetivosAprobados).toHaveBeenCalledWith(
      'colaborador@hunter.test',
      'Ana Pérez',
      'Periodo Q3',
      [{ titulo: 'Título original', peso: 20 }],
      45, // usado (25) + peso (20)
    )
    expect(enviarObjetivoReemplazado).not.toHaveBeenCalled()
  })

  it('aprobación CON AJUSTE (título modificado): envía enviarObjetivoReemplazado y NO duplica con enviarObjetivosAprobados', async () => {
    const objetivo = objetivoBase()
    prismaMock.objetivo.findUnique.mockResolvedValue(objetivo as never)
    prismaMock.usuario.findFirst.mockResolvedValue({
      email: 'colaborador@hunter.test',
      colaborador: { nombres: 'Ana', apellidos: 'Pérez' },
    } as never)
    prismaMock.$transaction.mockResolvedValue([{}, {}] as never)

    const resultado = await resolverObjetivo(
      formData({ objetivoId: 'obj-1', decision: 'APROBADO', titulo: 'Título definido por el jefe' }),
    )

    expect(resultado).toEqual({ ok: true })
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(enviarObjetivoReemplazado).toHaveBeenCalledTimes(1)
    expect(enviarObjetivoReemplazado).toHaveBeenCalledWith(
      'colaborador@hunter.test',
      'Ana Pérez',
      'Periodo Q3',
      'Título original',
      'Título definido por el jefe',
    )
    expect(enviarObjetivosAprobados).not.toHaveBeenCalled()
  })

  it('el correo falla (mailer rechaza): la aprobación es best-effort y sigue devolviendo ok:true', async () => {
    const objetivo = objetivoBase()
    prismaMock.objetivo.findUnique.mockResolvedValue(objetivo as never)
    prismaMock.usuario.findFirst.mockResolvedValue({
      email: 'colaborador@hunter.test',
      colaborador: { nombres: 'Ana', apellidos: 'Pérez' },
    } as never)
    vi.mocked(enviarObjetivosAprobados).mockRejectedValue(new Error('SMTP caído'))

    const resultado = await resolverObjetivo(formData({ objetivoId: 'obj-1', decision: 'APROBADO' }))

    expect(resultado).toEqual({ ok: true })
    expect(prismaMock.objetivo.update).toHaveBeenCalledWith({
      where: { id: 'obj-1' },
      data: { estado: 'APROBADO', peso: 20 },
    })
    expect(enviarObjetivosAprobados).toHaveBeenCalledTimes(1)
  })

  it('RECHAZADO: no envía ningún correo', async () => {
    const objetivo = objetivoBase()
    prismaMock.objetivo.findUnique.mockResolvedValue(objetivo as never)

    const resultado = await resolverObjetivo(formData({ objetivoId: 'obj-1', decision: 'RECHAZADO' }))

    expect(resultado).toEqual({ ok: true })
    expect(prismaMock.objetivo.update).toHaveBeenCalledWith({
      where: { id: 'obj-1' },
      data: { estado: 'RECHAZADO' },
    })
    expect(enviarObjetivosAprobados).not.toHaveBeenCalled()
    expect(enviarObjetivoReemplazado).not.toHaveBeenCalled()
    expect(prismaMock.usuario.findFirst).not.toHaveBeenCalled()
  })

  it('colaborador sin cuenta/email (usuario.findFirst → null): no llama al mailer pero la aprobación funciona igual', async () => {
    const objetivo = objetivoBase()
    prismaMock.objetivo.findUnique.mockResolvedValue(objetivo as never)
    prismaMock.usuario.findFirst.mockResolvedValue(null as never)

    const resultado = await resolverObjetivo(formData({ objetivoId: 'obj-1', decision: 'APROBADO' }))

    expect(resultado).toEqual({ ok: true })
    expect(prismaMock.objetivo.update).toHaveBeenCalledWith({
      where: { id: 'obj-1' },
      data: { estado: 'APROBADO', peso: 20 },
    })
    expect(enviarObjetivosAprobados).not.toHaveBeenCalled()
    expect(enviarObjetivoReemplazado).not.toHaveBeenCalled()
  })
})

describe('asignarObjetivo → correo de objetivo asignado', () => {
  /** El colaborador al que SESION_JEFE le asigna el objetivo (jefeId apunta a SESION_JEFE, así
   * `puedeGestionarObjetivosDe` resuelve `colaborador.jefeId === sesion.colaboradorId` en `true`).
   * `prisma.colaborador.findUnique` se llama dos veces con selects distintos (permiso y alcance
   * del período): este mismo objeto cubre ambos, con activo/paisId/areaId/puesto para el guard. */
  function colaboradorBase() {
    return { id: 'colab-1', jefeId: 'colab-jefe-1', activo: true, paisId: 'pe', areaId: 'area-1', puesto: { nivelId: 'nivel-1' } }
  }

  function formDataAsignar(extra: Record<string, string> = {}) {
    return formData({
      colaboradorId: 'colab-1',
      periodoId: 'periodo-1',
      titulo: 'Objetivo asignado por el jefe',
      descripcion: 'Descripción del objetivo asignado',
      tipo: 'INDIVIDUAL',
      peso: '30',
      ...extra,
    })
  }

  it('asignación exitosa: envía enviarObjetivoAsignado una vez con el total correcto', async () => {
    prismaMock.colaborador.findUnique.mockResolvedValue(colaboradorBase() as never)
    prismaMock.objetivo.create.mockResolvedValue({} as never)
    prismaMock.usuario.findFirst.mockResolvedValue({
      email: 'colaborador@hunter.test',
      colaborador: { nombres: 'Ana', apellidos: 'Pérez' },
    } as never)

    const resultado = await asignarObjetivo(formDataAsignar())

    expect(resultado).toEqual({ ok: true })
    expect(prismaMock.objetivo.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        colaboradorId: 'colab-1',
        titulo: 'Objetivo asignado por el jefe',
        peso: 30,
        estado: 'APROBADO',
      }),
    })
    expect(enviarObjetivoAsignado).toHaveBeenCalledTimes(1)
    expect(enviarObjetivoAsignado).toHaveBeenCalledWith(
      'colaborador@hunter.test',
      'Ana Pérez',
      'Periodo Q3',
      'Objetivo asignado por el jefe',
      30,
      75, // usado (transversales 10 + individuales 20 + 15 = 45) + peso asignado (30)
    )
  })

  it('colaborador sin cuenta (usuario.findFirst → null): no llama al mailer pero la asignación funciona igual', async () => {
    prismaMock.colaborador.findUnique.mockResolvedValue(colaboradorBase() as never)
    prismaMock.objetivo.create.mockResolvedValue({} as never)
    prismaMock.usuario.findFirst.mockResolvedValue(null as never)

    const resultado = await asignarObjetivo(formDataAsignar())

    expect(resultado).toEqual({ ok: true })
    expect(prismaMock.objetivo.create).toHaveBeenCalledTimes(1)
    expect(enviarObjetivoAsignado).not.toHaveBeenCalled()
  })

  it('el correo falla (mailer rechaza): la asignación es best-effort y sigue devolviendo ok:true', async () => {
    prismaMock.colaborador.findUnique.mockResolvedValue(colaboradorBase() as never)
    prismaMock.objetivo.create.mockResolvedValue({} as never)
    prismaMock.usuario.findFirst.mockResolvedValue({
      email: 'colaborador@hunter.test',
      colaborador: { nombres: 'Ana', apellidos: 'Pérez' },
    } as never)
    vi.mocked(enviarObjetivoAsignado).mockRejectedValue(new Error('SMTP caído'))

    const resultado = await asignarObjetivo(formDataAsignar())

    expect(resultado).toEqual({ ok: true })
    expect(enviarObjetivoAsignado).toHaveBeenCalledTimes(1)
  })
})
