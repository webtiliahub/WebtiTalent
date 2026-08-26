import { describe, it, expect, vi, beforeEach } from 'vitest'

/* Candado de integridad de `guardarEvaluacion`: solo se escriben las respuestas que están en el
   cuestionario aplicable. Sin él, esta server action aceptaba cualquier `preguntaId` del banco y
   las preguntas ajenas entraban al promedio por dimensión, decidiendo la nota de otra persona. */

const upsertRespuesta = vi.fn()
const upsertPotencial = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/shared/lib/permisos', () => ({ requiereSesion: vi.fn(async () => ({ id: 'TST-user', colaboradorId: 'TST-evaluador' })) }))
vi.mock('@/features/ciclos/congelamiento', () => ({ paisCongelado: vi.fn(async () => false) }))
vi.mock('@/features/resultados/servicio', () => ({
  calcularResultado: vi.fn(async () => ({})),
  objetivosAplicables: vi.fn(async () => ({ transversales: [], individuales: [] })),
}))
vi.mock('@/domain/antiguedad', () => ({ excluidoPorAntiguedad: vi.fn(() => false) }))
vi.mock('@/features/evaluaciones/cuestionario', () => ({
  // El cuestionario legítimo del evaluado: UNA pregunta de competencias y UNA de potencial
  preguntasParaAsignacion: vi.fn(async () => [{ preguntaId: 'TST-preg-aplicable' }]),
  preguntasPotencialParaAsignacion: vi.fn(async () => [{ id: 'TST-pot-aplicable' }]),
}))
vi.mock('@/shared/lib/prisma', () => ({
  prisma: {
    asignacion: { findUnique: vi.fn(), count: vi.fn() },
    ciclo: { findUnique: vi.fn() },
    colaborador: { findMany: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<void>) => cb({
      respuesta: { upsert: upsertRespuesta },
      respuestaPotencial: { upsert: upsertPotencial },
      objetivoLogro: { upsert: vi.fn() },
      asignacion: { update: vi.fn() },
    })),
  },
}))

import { prisma } from '@/shared/lib/prisma'
import { guardarEvaluacion, buscarCandidatosPar } from './acciones'

const prismaMock = vi.mocked(prisma, true)

const ASIGNACION = {
  id: 'TST-asig',
  evaluadorId: 'TST-evaluador',
  evaluadoId: 'TST-evaluado',
  cicloId: 'TST-ciclo',
  tipo: 'JEFE',
  estado: 'BORRADOR',
  ciclo: { estado: 'ACTIVO', periodoId: null, fechaInicio: new Date('2026-01-01') },
  evaluado: { paisId: 'TST-pais', fechaIngreso: new Date('2020-01-01'), puesto: { id: 'TST-puesto', nivelId: 'TST-nivel', competencias: [] } },
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.asignacion.findUnique.mockResolvedValue(ASIGNACION as never)
})

const idsEscritos = (mock: typeof upsertRespuesta) =>
  mock.mock.calls.map((c) => (c[0] as { create: { preguntaId: string } }).create.preguntaId)

describe('guardarEvaluacion — solo escribe lo que está en el cuestionario', () => {
  it('descarta las respuestas de preguntas ajenas al cuestionario', async () => {
    const res = await guardarEvaluacion({
      asignacionId: 'TST-asig',
      respuestas: [
        { preguntaId: 'TST-preg-aplicable', valor: 4 },
        { preguntaId: 'TST-preg-del-banco-1', valor: 1 }, // no le corresponde
        { preguntaId: 'TST-preg-del-banco-2', valor: 1 },
      ],
      enviar: false,
    })

    expect(res.ok).toBe(true)
    expect(idsEscritos(upsertRespuesta)).toEqual(['TST-preg-aplicable'])
  })

  it('descarta las preguntas de potencial ajenas al snapshot del ciclo', async () => {
    await guardarEvaluacion({
      asignacionId: 'TST-asig',
      respuestas: [{ preguntaId: 'TST-preg-aplicable', valor: 4 }],
      potencial: [
        { preguntaId: 'TST-pot-aplicable', valor: 5 },
        { preguntaId: 'TST-pot-intrusa', valor: 5 },
      ],
      enviar: false,
    })

    expect(idsEscritos(upsertPotencial)).toEqual(['TST-pot-aplicable'])
  })

  it('sigue exigiendo el cuestionario completo al enviar', async () => {
    const res = await guardarEvaluacion({
      asignacionId: 'TST-asig',
      // Manda basura de sobra pero NO la que toca: enviar debe seguir fallando
      respuestas: [{ preguntaId: 'TST-preg-del-banco-1', valor: 5 }],
      potencial: [{ preguntaId: 'TST-pot-aplicable', valor: 5 }],
      enviar: true,
    })

    expect(res).toEqual({ ok: false, error: 'Faltan 1 preguntas por responder' })
    expect(upsertRespuesta).not.toHaveBeenCalled()
  })

  it('no acepta el potencial relleno solo con preguntas ajenas', async () => {
    const res = await guardarEvaluacion({
      asignacionId: 'TST-asig',
      respuestas: [{ preguntaId: 'TST-preg-aplicable', valor: 4 }],
      potencial: [{ preguntaId: 'TST-pot-intrusa', valor: 5 }], // cantidad correcta, ids falsos
      enviar: true,
    })

    expect(res).toEqual({ ok: false, error: 'Completa las preguntas de potencial' })
  })
})

describe('buscarCandidatosPar — solo para jefes que evalúan en el ciclo (auditoría 0824)', () => {
  /* Sin este guard, CUALQUIER colaborador autenticado (~800 cuentas) enumeraba el padrón regional
     (nombre, puesto·área·país y líneas de reporte vía esDeMiEquipo) iterando términos de 2 letras.
     El buscador existe para que el JEFE nomine pares: se exige lo mismo que nominarPar valida al
     escribir — tener evaluaciones de JEFE en este ciclo. */
  const FILA_PADRON = {
    id: 'TST-otro', nombres: 'Ana', apellidos: 'Torres', jefeId: null, fechaIngreso: new Date('2020-01-01'),
    area: { nombre: 'Ventas' }, puesto: { nombre: 'Ejecutiva' }, pais: { codigo: 'PE' },
  }

  beforeEach(() => {
    prismaMock.ciclo.findUnique.mockResolvedValue({ estado: 'ACTIVO', fechaInicio: new Date('2026-01-01') } as never)
    prismaMock.colaborador.findMany.mockResolvedValue([FILA_PADRON] as never)
  })

  it('un colaborador que no evalúa como jefe en el ciclo no obtiene nada (ni se consulta el padrón)', async () => {
    prismaMock.asignacion.count.mockResolvedValue(0 as never)

    const res = await buscarCandidatosPar('TST-ciclo', 'an')

    expect(res).toEqual([])
    expect(prismaMock.colaborador.findMany).not.toHaveBeenCalled()
  })

  it('un jefe con evaluaciones en el ciclo sí obtiene candidatos', async () => {
    prismaMock.asignacion.count.mockResolvedValue(2 as never)

    const res = await buscarCandidatosPar('TST-ciclo', 'an')

    expect(res.map((c) => c.id)).toEqual(['TST-otro'])
  })
})
