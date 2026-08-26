import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock de Prisma (mismo patrón que guards-alcance.test.ts / resolver-objetivo-correo.test.ts):
// sin base de datos real, cada modelo usado por calcularResultado queda como vi.fn() controlado
// por el test. -----------------------------------------------------------------------------------
vi.mock('@/shared/lib/prisma', () => ({
  prisma: {
    ciclo: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    colaborador: {
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(), // el fallback del perfil (ciclos sin snapshot) consulta el puesto aquí
    },
    asignacion: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    resultado: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    periodoObjetivos: {
      findUniqueOrThrow: vi.fn(),
    },
    objetivo: {
      findMany: vi.fn(),
    },
    cicloPerfilEvaluado: {
      findUnique: vi.fn(),
    },
    cicloPregunta: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    cicloPreguntaPotencial: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from '@/shared/lib/prisma'
import { calcularResultado } from './servicio'

const prismaMock = vi.mocked(prisma, true)

// Fixtures con prefijo TST (convención del repo para datos de prueba fácilmente identificables).
const CICLO_ID = 'TST-ciclo-sin-periodo'
const COLABORADOR_ID = 'TST-colab-1'
const DIMENSION_ID = 'TST-dim-liderazgo'

/** Config del ciclo con combinación explícita (evita depender del catálogo de niveles: sin
 * `combinacionPorNivel` en el snapshot, `configDelCiclo` consultaría `nivelJerarquico`, modelo
 * que este test no necesita mockear). */
const CONFIG_JSON = {
  pesosModalidades: { JEFE: 50, PAR: 20, ASCENDENTE: 30, AUTO: 0 },
  pesosModalidadesSinReportes: { JEFE: 60, PAR: 40, ASCENDENTE: 0, AUTO: 0 },
  combinacionPorNivel: { 'TST-nivel-1': { comp: 60, obj: 40 } }, // 60/40 si el ciclo SÍ evaluara objetivos
}

const ASIGNACION_JEFE = {
  id: 'TST-asig-jefe-1',
  tipo: 'JEFE',
  respuestas: [
    {
      valor: 4,
      pregunta: {
        modalidades: ['JEFE'],
        competencia: { dimensionId: DIMENSION_ID, dimension: { nombre: 'Liderazgo' } },
      },
    },
  ],
  respuestasPotencial: [{ valor: 4 }],
}

/** El maestro de puestos se lee por dos caminos: el propio cálculo y el fallback del perfil
 *  cuando el ciclo no tiene snapshot. Los dos mocks tienen que contar lo mismo. */
function maestroDelPuesto(pesos: { dimensionId: string; peso: number; puntajeEsperado: number }[]) {
  const colaborador = {
    id: COLABORADOR_ID,
    puesto: { id: 'TST-puesto-1', nivelId: 'TST-nivel-1', competencias: [], pesos },
  }
  prismaMock.colaborador.findUniqueOrThrow.mockResolvedValue(colaborador as never)
  prismaMock.colaborador.findUnique.mockResolvedValue(colaborador as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.ciclo.findUnique.mockResolvedValue({ configJson: CONFIG_JSON } as never)
  // Ciclo SIN período: periodoId null — este es el ciclo que "no evalúa objetivos" (Task 6).
  prismaMock.ciclo.findUniqueOrThrow.mockResolvedValue({ periodoId: null } as never)
  maestroDelPuesto([{ dimensionId: DIMENSION_ID, peso: 100, puntajeEsperado: 3 }])
  // Por defecto, ciclo lanzado ANTES del snapshot: el perfil cae al puesto en vivo
  prismaMock.cicloPerfilEvaluado.findUnique.mockResolvedValue(null as never)
  // Sin snapshot de preguntas tampoco hay lista blanca: el cálculo no filtra (retrocompatible)
  prismaMock.cicloPregunta.count.mockResolvedValue(0 as never)
  prismaMock.cicloPregunta.findMany.mockResolvedValue([] as never)
  prismaMock.cicloPreguntaPotencial.count.mockResolvedValue(0 as never)
  prismaMock.cicloPreguntaPotencial.findMany.mockResolvedValue([] as never)
  prismaMock.asignacion.findMany.mockResolvedValue([ASIGNACION_JEFE] as never)
  prismaMock.asignacion.count.mockResolvedValue(0 as never) // sin ascendentes: pesosModalidadesSinReportes
  prismaMock.resultado.findUnique.mockResolvedValue(null as never) // sin ajustes de calibración previos
  ;(prismaMock.resultado.upsert as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (args: { create: unknown }) => Promise.resolve(args.create),
  )
})

describe('calcularResultado — ciclo sin período (Task 6)', () => {
  it('renormaliza a 100% competencias: cumplimientoObjetivos null y notaFinal === notaCompetencias', async () => {
    const resultado = await calcularResultado(CICLO_ID, COLABORADOR_ID)

    expect(resultado.cumplimientoObjetivos).toBeNull()
    expect(resultado.notaCompetencias).not.toBeNull()
    expect(resultado.notaFinal).not.toBeNull()
    // notaFinal() renormaliza: sin componente de objetivos, el 100% del peso cae en competencias
    // (aunque el snapshot del nivel diga 60/40) — por eso notaFinal === notaCompetencias exacto.
    expect(resultado.notaFinal).toBe(resultado.notaCompetencias)
  })

  it('nunca consulta el período de objetivos: el bypass evita objetivosAplicables(null, …)', async () => {
    await calcularResultado(CICLO_ID, COLABORADOR_ID)

    expect(prismaMock.periodoObjetivos.findUniqueOrThrow).not.toHaveBeenCalled()
  })
})

describe('calcularResultado — colaborador INACTIVO (baja) con período de alcance vacío (CRITICAL-1)', () => {
  // Período retro-compatible: alcance vacío = toda la organización, sin foco alguno.
  const PERIODO_ALCANCE_VACIO = {
    id: 'TST-periodo-1',
    focoPaisIds: [] as string[], focoAreaIds: [] as string[], focoNivelIds: [] as string[],
    incluirIds: [] as string[], excluirIds: [] as string[],
  }
  const OBJETIVO_INDIVIDUAL_APROBADO = {
    id: 'TST-obj-individual-1',
    tipo: 'INDIVIDUAL',
    estado: 'APROBADO',
    peso: 100,
    logros: [{ logroFinal: 80 }],
  }

  beforeEach(() => {
    // Ciclo CON período (a diferencia del describe de arriba)
    prismaMock.ciclo.findUniqueOrThrow.mockResolvedValue({ periodoId: 'TST-periodo-1' } as never)
    prismaMock.periodoObjetivos.findUniqueOrThrow.mockResolvedValue(PERIODO_ALCANCE_VACIO as never)
    // El colaborador es una BAJA (activo: false) — es lo que gatillaba la regresión: el
    // early-return de `objetivosAplicables` lo descartaba aunque el alcance esté vacío.
    prismaMock.colaborador.findUniqueOrThrow.mockResolvedValue({
      id: COLABORADOR_ID,
      activo: false,
      paisId: 'TST-pais-1',
      areaId: null,
      puesto: { nivelId: 'TST-nivel-1', pesos: [{ dimensionId: DIMENSION_ID, peso: 100 }] },
    } as never)
    prismaMock.objetivo.findMany.mockImplementation(((args: { where: { tipo?: unknown } }) =>
      Promise.resolve(args.where.tipo === 'TRANSVERSAL' ? [] : [OBJETIVO_INDIVIDUAL_APROBADO])) as never)
  })

  it('conserva su cumplimientoObjetivos: la baja sigue contando sus objetivos aprobados con logro', async () => {
    const resultado = await calcularResultado(CICLO_ID, COLABORADOR_ID)

    // peso 100, logro 80 → cumplimientoObjetivos = 80 exacto (único objetivo, peso total 100)
    expect(resultado.cumplimientoObjetivos).toBe(80)
    expect(resultado.notaFinal).not.toBeNull()
  })

  it('usa el período precargado cuando se lo pasan (N+1 del ledger T4): no vuelve a consultarlo', async () => {
    await calcularResultado(CICLO_ID, COLABORADOR_ID, PERIODO_ALCANCE_VACIO as never)

    expect(prismaMock.periodoObjetivos.findUniqueOrThrow).not.toHaveBeenCalled()
  })
})

describe('calcularResultado — perfil congelado del ciclo (CicloPerfilEvaluado)', () => {
  const DIM_ALTA = DIMENSION_ID          // respuesta 5
  const DIM_BAJA = 'TST-dim-analitica'   // respuesta 1

  /* Dos dimensiones con notas OPUESTAS en la misma modalidad: así los pesos deciden el resultado
     y se puede distinguir de dónde salieron. Ponderar 100% la alta da 5; la baja, 1; y un
     promedio simple (sin pesos aplicables) da 3. */
  const ASIGNACION_DOS_DIMENSIONES = {
    id: 'TST-asig-jefe-2',
    tipo: 'JEFE',
    respuestas: [
      { valor: 5, pregunta: { modalidades: ['JEFE'], competencia: { dimensionId: DIM_ALTA, dimension: { nombre: 'Liderazgo' } } } },
      { valor: 1, pregunta: { modalidades: ['JEFE'], competencia: { dimensionId: DIM_BAJA, dimension: { nombre: 'Analítica' } } } },
    ],
    respuestasPotencial: [{ valor: 4 }],
  }

  beforeEach(() => {
    prismaMock.asignacion.findMany.mockResolvedValue([ASIGNACION_DOS_DIMENSIONES] as never)
    // El MAESTRO pondera 100% la dimensión alta: leerlo daría 5
    maestroDelPuesto([{ dimensionId: DIM_ALTA, peso: 100, puntajeEsperado: 3 }])
  })

  it('usa los pesos del snapshot del ciclo, no los del puesto en vivo', async () => {
    // El SNAPSHOT pondera 100% la dimensión baja: si se respeta, la nota es 1 y no 5
    prismaMock.cicloPerfilEvaluado.findUnique.mockResolvedValue({
      puestoId: 'TST-puesto-1', nivelId: 'TST-nivel-1', competenciaIds: [],
      pesosJson: [{ dimensionId: DIM_BAJA, peso: 100, puntajeEsperado: 3 }],
    } as never)

    const resultado = await calcularResultado(CICLO_ID, COLABORADOR_ID)

    expect(resultado.notaCompetencias).toBe(1)
  })

  it('sin snapshot (ciclo anterior a la funcionalidad) cae al puesto en vivo', async () => {
    prismaMock.cicloPerfilEvaluado.findUnique.mockResolvedValue(null as never)

    const resultado = await calcularResultado(CICLO_ID, COLABORADOR_ID)

    expect(resultado.notaCompetencias).toBe(5)
  })

  it('descarta las entradas con forma inválida del JSON en vez de meterlas al cálculo', async () => {
    prismaMock.cicloPerfilEvaluado.findUnique.mockResolvedValue({
      puestoId: 'TST-puesto-1', nivelId: 'TST-nivel-1', competenciaIds: [],
      // peso como texto y una entrada sin dimensionId: ninguna es utilizable
      pesosJson: [{ dimensionId: DIM_BAJA, peso: '100', puntajeEsperado: 3 }, { peso: 50 }],
    } as never)

    const resultado = await calcularResultado(CICLO_ID, COLABORADOR_ID)

    // Sin pesos utilizables rige el promedio simple ya documentado en calculo.ts, no un NaN
    // ni la ponderación del maestro (que habría dado 5)
    expect(resultado.notaCompetencias).toBe(3)
  })
})

describe('calcularResultado — saneamiento contra el cuestionario del ciclo', () => {
  /* Defensa de segunda capa: una respuesta escrita sobre una pregunta que NO pertenece al
     cuestionario del ciclo no puede decidir la nota (era el vector: mandar el banco entero a la
     server action e inundar el promedio por dimensión). */
  const PREGUNTA_LEGITIMA = 'TST-preg-legitima'
  const PREGUNTA_INTRUSA = 'TST-preg-intrusa'

  const asignacionCon = (respuestas: { preguntaId: string; valor: number }[]) => ({
    id: 'TST-asig-jefe-3',
    tipo: 'JEFE',
    respuestas: respuestas.map((r) => ({
      valor: r.valor,
      preguntaId: r.preguntaId,
      pregunta: { modalidades: ['JEFE'], competencia: { dimensionId: DIMENSION_ID, dimension: { nombre: 'Liderazgo' } } },
    })),
    respuestasPotencial: [],
  })

  it('ignora la respuesta que no está en el cuestionario del ciclo', async () => {
    prismaMock.asignacion.findMany.mockResolvedValue([
      asignacionCon([{ preguntaId: PREGUNTA_LEGITIMA, valor: 5 }, { preguntaId: PREGUNTA_INTRUSA, valor: 1 }]),
    ] as never)
    prismaMock.cicloPregunta.findMany.mockResolvedValue([
      { preguntaId: PREGUNTA_LEGITIMA, modalidad: 'JEFE' },
    ] as never)

    const resultado = await calcularResultado(CICLO_ID, COLABORADOR_ID)

    // Solo cuenta el 5: si la intrusa entrara, el promedio caería a 3
    expect(resultado.notaCompetencias).toBe(5)
  })

  it('cuenta ambas si el ciclo no tiene snapshot de preguntas (retrocompatibilidad)', async () => {
    prismaMock.asignacion.findMany.mockResolvedValue([
      asignacionCon([{ preguntaId: PREGUNTA_LEGITIMA, valor: 5 }, { preguntaId: PREGUNTA_INTRUSA, valor: 1 }]),
    ] as never)
    prismaMock.cicloPregunta.findMany.mockResolvedValue([] as never)

    const resultado = await calcularResultado(CICLO_ID, COLABORADOR_ID)

    expect(resultado.notaCompetencias).toBe(3)
  })

  it('ignora el potencial que no está en el snapshot del ciclo', async () => {
    prismaMock.asignacion.findMany.mockResolvedValue([{
      ...asignacionCon([{ preguntaId: PREGUNTA_LEGITIMA, valor: 4 }]),
      respuestasPotencial: [{ preguntaId: 'TST-pot-ok', valor: 5 }, { preguntaId: 'TST-pot-intrusa', valor: 1 }],
    }] as never)
    prismaMock.cicloPregunta.findMany.mockResolvedValue([{ preguntaId: PREGUNTA_LEGITIMA, modalidad: 'JEFE' }] as never)
    prismaMock.cicloPreguntaPotencial.findMany.mockResolvedValue([{ preguntaPotencialId: 'TST-pot-ok' }] as never)

    const resultado = await calcularResultado(CICLO_ID, COLABORADOR_ID)

    expect(resultado.potencial).toBe(5)
  })
})

describe('calcularResultado — alcance del filtro del cuestionario (auditoría 0824)', () => {
  /* (a) Un perfil SIN puesto ni nivel (participaba sin puesto asignado) no puede filtrar: en
     Prisma `where { nivelId: null }` casa con las filas de EXCEPCIÓN por puesto (nivelId IS NULL),
     así que el whitelist se llenaría con el cuestionario de OTROS puestos y descartaría todas
     las respuestas legítimas. Sin con qué comparar, no se filtra. */
  it('perfil sin nivel ni puesto: no filtra (y no consulta cicloPregunta con nivelId null)', async () => {
    prismaMock.cicloPerfilEvaluado.findUnique.mockResolvedValue({
      puestoId: null, nivelId: null, competenciaIds: [], pesosJson: [],
    } as never)
    prismaMock.asignacion.findMany.mockResolvedValue([{
      id: 'TST-asig-jefe-4',
      tipo: 'JEFE',
      respuestas: [{
        valor: 5,
        preguntaId: 'TST-preg-legitima',
        pregunta: { modalidades: ['JEFE'], competencia: { dimensionId: DIMENSION_ID, dimension: { nombre: 'Liderazgo' } } },
      }],
      respuestasPotencial: [],
    }] as never)
    // Si el código consultara con nivelId null, la base devolvería las excepciones por puesto
    prismaMock.cicloPregunta.findMany.mockImplementation(((args: { where: { nivelId?: string | null } }) =>
      Promise.resolve(args.where.nivelId === null
        ? [{ preguntaId: 'TST-preg-de-otro-puesto', modalidad: 'JEFE' }]
        : [])) as never)

    const resultado = await calcularResultado(CICLO_ID, COLABORADOR_ID)

    expect(resultado.notaCompetencias).toBe(5)
  })

  /* (b) El potencial usa el MISMO alcance que el cuestionario de competencias (excepción por
     puesto > nivel del perfil congelado): sin acotar, contaría las respuestas de un set de otro
     nivel (p.ej. tras re-homologar el puesto a mitad de ciclo, sets viejo y nuevo mezclados). */
  it('potencial: solo cuentan las respuestas del set del nivel del perfil congelado', async () => {
    prismaMock.cicloPerfilEvaluado.findUnique.mockResolvedValue({
      puestoId: 'TST-puesto-1', nivelId: 'TST-nivel-1', competenciaIds: [],
      pesosJson: [{ dimensionId: DIMENSION_ID, peso: 100, puntajeEsperado: 3 }],
    } as never)
    prismaMock.asignacion.findMany.mockResolvedValue([{
      id: 'TST-asig-jefe-5',
      tipo: 'JEFE',
      respuestas: [{
        valor: 4,
        preguntaId: 'TST-preg-legitima',
        pregunta: { modalidades: ['JEFE'], competencia: { dimensionId: DIMENSION_ID, dimension: { nombre: 'Liderazgo' } } },
      }],
      // La del nivel del perfil vale 5; la del set de OTRO nivel (re-homologación) vale 1
      respuestasPotencial: [
        { preguntaId: 'TST-pot-nivel-1', valor: 5 },
        { preguntaId: 'TST-pot-nivel-2', valor: 1 },
      ],
    }] as never)
    prismaMock.cicloPregunta.findMany.mockResolvedValue([{ preguntaId: 'TST-preg-legitima', modalidad: 'JEFE' }] as never)
    // El ciclo tiene sets de potencial para DOS niveles; acotado al del perfil, solo llega el suyo
    prismaMock.cicloPreguntaPotencial.findMany.mockImplementation(((args: { where: { nivelId?: string } }) =>
      Promise.resolve(args.where.nivelId === 'TST-nivel-1'
        ? [{ preguntaPotencialId: 'TST-pot-nivel-1' }]
        : [{ preguntaPotencialId: 'TST-pot-nivel-1' }, { preguntaPotencialId: 'TST-pot-nivel-2' }])) as never)

    const resultado = await calcularResultado(CICLO_ID, COLABORADOR_ID)

    expect(resultado.potencial).toBe(5)
  })
})
