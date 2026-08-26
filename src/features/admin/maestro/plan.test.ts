import { describe, it, expect } from 'vitest'
import { planificarMaestro, type SnapshotBD, type PlanMaestro } from './plan'
import type { MaestroParseado } from './parser'

// ── Helpers ──

/** BD base: 2 niveles (Gerencial/Apoyo, compPct 50/50), 5 dimensiones, 2 competencias,
 *  país Perú, 1 puesto existente GERENTE GENERAL (Gerencial, pesos [20,15,15,30,20], ambas competencias). */
function bd(overrides: Partial<SnapshotBD> = {}): SnapshotBD {
  return {
    niveles: [
      { id: 'niv-ger', nombre: 'Gerencial', compPct: 50 },
      { id: 'niv-apo', nombre: 'Apoyo', compPct: 50 },
    ],
    dimensiones: [
      { id: 'd1', nombre: 'D1', orden: 1 },
      { id: 'd2', nombre: 'D2', orden: 2 },
      { id: 'd3', nombre: 'D3', orden: 3 },
      { id: 'd4', nombre: 'D4', orden: 4 },
      { id: 'd5', nombre: 'D5', orden: 5 },
    ],
    competencias: [
      { id: 'c1', nombre: 'Pensamiento crítico' },
      { id: 'c2', nombre: 'Análisis de datos' },
    ],
    paises: [{ nombre: 'Perú' }],
    puestos: [
      {
        id: 'p-gg',
        nombre: 'GERENTE GENERAL',
        nivelId: 'niv-ger',
        pesos: [
          { dimensionId: 'd1', peso: 20 },
          { dimensionId: 'd2', peso: 15 },
          { dimensionId: 'd3', peso: 15 },
          { dimensionId: 'd4', peso: 30 },
          { dimensionId: 'd5', peso: 20 },
        ],
        competenciaIds: ['c1', 'c2'],
      },
    ],
    hayCicloActivo: false,
    ...overrides,
  }
}

const NIVEL_GERENCIAL = { nivel: 'Gerencial', pesosDim: [20, 15, 15, 30, 20], compPct: 50, objPct: 50 }
const NIVEL_APOYO = { nivel: 'Apoyo', pesosDim: [15, 35, 30, 10, 10], compPct: 50, objPct: 50 }

/** Parseado base: idéntico a la BD (idempotente). */
function baseParseado(overrides: Partial<MaestroParseado> = {}): MaestroParseado {
  return {
    niveles: [NIVEL_GERENCIAL, NIVEL_APOYO],
    puestos: [{ puesto: 'GERENTE GENERAL', nivel: 'Gerencial' }],
    competencias: [{ puesto: 'GERENTE GENERAL', competencias: ['Pensamiento crítico', 'Análisis de datos'] }],
    pesosPuesto: [{ puesto: 'GERENTE GENERAL', nivel: 'Gerencial', pesosDim: [20, 15, 15, 30, 20] }],
    padron: [],
    errores: [],
    ...overrides,
  }
}

function filaPadron(overrides: Partial<MaestroParseado['padron'][number]> = {}): MaestroParseado['padron'][number] {
  return {
    linea: 4,
    codigo: 'PER-001',
    documento: '123',
    nombres: 'Ana',
    apellidos: 'Pérez',
    email: 'ana@hunter.com.pe',
    telefono: '',
    pais: 'Perú',
    area: '',
    cargo: 'GERENTE GENERAL',
    nivel: 'Gerencial',
    codigoJefe: '',
    liderazgo: '',
    fechaIngreso: '',
    ...overrides,
  }
}

// ── Caso 7: idempotencia (control de referencia para el resto) ──

describe('planificarMaestro — idempotencia', () => {
  it('parseado idéntico a la BD: todas las listas vacías, pesosDerivados = total de puestos', () => {
    const plan = planificarMaestro(baseParseado(), bd())
    expect(plan.errores).toEqual([])
    expect(plan.avisos).toEqual([])
    expect(plan.bloqueadoPorCiclo).toBe(false)
    expect(plan.niveles).toEqual([])
    expect(plan.puestosNuevos).toEqual([])
    expect(plan.puestosRehomologados).toEqual([])
    expect(plan.competenciasCambian).toEqual([])
    expect(plan.competenciasPuestosNuevos).toEqual([])
    expect(plan.pesosDerivados).toBe(1)
    expect(plan.pesosPersonalizados).toEqual([])
    expect(plan.padron).toEqual({ filas: [], nivelesIgnorados: 0 })
  })
})

// ── Caso 1: compPct / hoja 3 ──

describe('planificarMaestro — Hoja 3 (Niveles)', () => {
  it('compPct cambia: niveles reporta antes/después (solo el que cambia)', () => {
    const parseado = baseParseado({
      niveles: [{ ...NIVEL_GERENCIAL, compPct: 60, objPct: 40 }, NIVEL_APOYO],
    })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.niveles).toEqual([{ nombre: 'Gerencial', compPctAntes: 50, compPctDespues: 60 }])
    expect(plan.errores).toEqual([])
  })

  it('nivel con D1-D5 que no suman 100 → error', () => {
    const parseado = baseParseado({
      niveles: [{ ...NIVEL_GERENCIAL, pesosDim: [20, 15, 15, 30, 10] }, NIVEL_APOYO],
    })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.errores).toContain('Hoja 3: el nivel "Gerencial" - los pesos por dimensión suman 90 (deben sumar 100)')
  })

  it('% competencias + % objetivos ≠ 100 → error', () => {
    const parseado = baseParseado({
      niveles: [{ ...NIVEL_GERENCIAL, compPct: 60, objPct: 30 }, NIVEL_APOYO],
    })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.errores).toContain('Hoja 3: el nivel "Gerencial" - % competencias + % objetivos suman 90 (deben sumar 100)')
  })

  it('nivel desconocido en hoja 3 → error', () => {
    const parseado = baseParseado({
      niveles: [NIVEL_GERENCIAL, NIVEL_APOYO, { nivel: 'Nivel Fantasma', pesosDim: [20, 20, 20, 20, 20], compPct: 50, objPct: 50 }],
    })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.errores).toContain('Hoja 3: nivel desconocido "Nivel Fantasma"')
  })
})

// ── Hallazgo 1: Number('') === 0 ──

describe('planificarMaestro — hallazgo Number(\'\') === 0', () => {
  it('Hoja 6: fila con todos los pesos en 0/vacíos se trata como fila vacía (fallback al nivel), NO como error', () => {
    const parseado = baseParseado({
      pesosPuesto: [{ puesto: 'GERENTE GENERAL', nivel: 'Gerencial', pesosDim: [0, 0, 0, 0, 0] }],
    })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.errores).toEqual([])
    expect(plan.pesosDerivados).toBe(1)
    expect(plan.pesosPersonalizados).toEqual([])
  })

  it('Hoja 3: nivel con todos los pesos en 0/vacíos → error claro ("no tiene pesos"), no el genérico de suma', () => {
    const parseado = baseParseado({
      niveles: [{ ...NIVEL_GERENCIAL, pesosDim: [0, 0, 0, 0, 0] }, NIVEL_APOYO],
    })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.errores).toContain('Hoja 3: el nivel "Gerencial" no tiene pesos')
    expect(plan.errores.some((e) => e.includes('suman 0'))).toBe(false)
  })
})

// ── Caso 2: re-homologación ──

describe('planificarMaestro — Hoja 4 (Puestos): re-homologación', () => {
  it('puesto existente que cambia de nivel → puestosRehomologados; puesto nuevo → puestosNuevos', () => {
    const parseado = baseParseado({
      puestos: [
        { puesto: 'GERENTE GENERAL', nivel: 'Apoyo' },
        { puesto: 'Nuevo Puesto', nivel: 'Apoyo' },
      ],
      competencias: [
        { puesto: 'GERENTE GENERAL', competencias: ['Pensamiento crítico', 'Análisis de datos'] },
        { puesto: 'Nuevo Puesto', competencias: ['Pensamiento crítico'] },
      ],
    })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.puestosRehomologados).toEqual([{ nombre: 'GERENTE GENERAL', nivelAntes: 'Gerencial', nivelDespues: 'Apoyo' }])
    expect(plan.puestosNuevos).toEqual([{ nombre: 'Nuevo Puesto', nivel: 'Apoyo' }])
  })

  it('puesto con nivel desconocido en hoja 4 → error, y se excluye de puestosNuevos/puestosRehomologados', () => {
    const parseado = baseParseado({
      puestos: [
        { puesto: 'GERENTE GENERAL', nivel: 'Gerencial' },
        { puesto: 'Puesto Raro', nivel: 'Nivel Fantasma' },
      ],
      competencias: [
        { puesto: 'GERENTE GENERAL', competencias: ['Pensamiento crítico', 'Análisis de datos'] },
        { puesto: 'Puesto Raro', competencias: ['Pensamiento crítico'] },
      ],
    })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.errores).toContain('Hoja 4: el puesto "Puesto Raro" tiene un nivel desconocido "Nivel Fantasma"')
    expect(plan.puestosNuevos).toEqual([])
    expect(plan.puestosRehomologados).toEqual([])
  })
})

// ── Caso 3: jerarquía hoja 6 > hoja 3 ──

describe('planificarMaestro — Hoja 6 (Pesos x Puesto): jerarquía sobre hoja 3', () => {
  it('fila de hoja 6 igual a su nivel → cuenta en pesosDerivados (no en personalizados)', () => {
    const parseado = baseParseado({
      pesosPuesto: [{ puesto: 'GERENTE GENERAL', nivel: 'Gerencial', pesosDim: [20, 15, 15, 30, 20] }],
    })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.pesosDerivados).toBe(1)
    expect(plan.pesosPersonalizados).toEqual([])
  })

  it('fila de hoja 6 DISTINTA a su nivel → pesosPersonalizados (no en derivados)', () => {
    const parseado = baseParseado({
      pesosPuesto: [{ puesto: 'GERENTE GENERAL', nivel: 'Gerencial', pesosDim: [25, 15, 15, 25, 20] }],
    })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.pesosDerivados).toBe(0)
    expect(plan.pesosPersonalizados).toEqual([{ puesto: 'GERENTE GENERAL', pesos: [25, 15, 15, 25, 20], nivel: 'Gerencial' }])
  })

  it('puesto sin fila en hoja 6 → derivado del nivel de hoja 4', () => {
    const plan = planificarMaestro(baseParseado({ pesosPuesto: [] }), bd())
    expect(plan.pesosDerivados).toBe(1)
    expect(plan.pesosPersonalizados).toEqual([])
  })

  it('fila de hoja 6 con suma ≠ 100 → error', () => {
    const parseado = baseParseado({
      pesosPuesto: [{ puesto: 'GERENTE GENERAL', nivel: 'Gerencial', pesosDim: [25, 15, 15, 25, 10] }],
    })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.errores).toContain('Hoja 6: el puesto "GERENTE GENERAL" - los pesos suman 90 (deben sumar 100)')
  })

  it('puesto en hoja 6 que no está en hoja 4 → error', () => {
    const parseado = baseParseado({
      pesosPuesto: [{ puesto: 'Puesto Fantasma', nivel: 'Gerencial', pesosDim: [20, 20, 20, 20, 20] }],
    })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.errores).toContain('Hoja 6: el puesto "Puesto Fantasma" no está en la Hoja 4 (Puestos)')
  })
})

// ── Caso 4: competencias ──

describe('planificarMaestro — Hoja 5 (Competencias x Puesto)', () => {
  it('set que difiere del actual → competenciasCambian con conteos', () => {
    const parseado = baseParseado({
      competencias: [{ puesto: 'GERENTE GENERAL', competencias: ['Pensamiento crítico'] }],
    })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.competenciasCambian).toEqual([{ puesto: 'GERENTE GENERAL', antes: 2, despues: 1 }])
  })

  it('competencia desconocida en BD → error', () => {
    const parseado = baseParseado({
      competencias: [{ puesto: 'GERENTE GENERAL', competencias: ['Competencia Fantasma'] }],
    })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.errores).toContain('Hoja 5: competencia desconocida "Competencia Fantasma" (puesto "GERENTE GENERAL")')
  })

  it('puesto con CERO competencias marcadas → error', () => {
    const parseado = baseParseado({ competencias: [{ puesto: 'GERENTE GENERAL', competencias: [] }] })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.errores).toContain('Hoja 5: el puesto "GERENTE GENERAL" no tiene competencias marcadas')
  })

  it('set idéntico → no aparece en competenciasCambian', () => {
    const plan = planificarMaestro(baseParseado(), bd())
    expect(plan.competenciasCambian).toEqual([])
  })
})

// ── Hoja 4 ↔ Hoja 5: cobertura obligatoria (revisión T2, Important B) ──

describe('planificarMaestro — Hoja 4 ↔ Hoja 5: cobertura obligatoria', () => {
  it('puesto de hoja 4 sin fila en hoja 5 → error bloqueante', () => {
    const parseado = baseParseado({
      puestos: [
        { puesto: 'GERENTE GENERAL', nivel: 'Gerencial' },
        { puesto: 'Nuevo Puesto', nivel: 'Apoyo' },
      ],
      // "Nuevo Puesto" no tiene fila en Hoja 5
      competencias: [{ puesto: 'GERENTE GENERAL', competencias: ['Pensamiento crítico', 'Análisis de datos'] }],
    })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.errores).toContain('Hoja 5: el puesto "Nuevo Puesto" no tiene fila de competencias')
  })

  it('puesto nuevo (no en BD) con fila en hoja 4 y hoja 5 → sin error, competencias disponibles en competenciasPuestosNuevos', () => {
    const parseado = baseParseado({
      puestos: [
        { puesto: 'GERENTE GENERAL', nivel: 'Gerencial' },
        { puesto: 'Nuevo Puesto', nivel: 'Apoyo' },
      ],
      competencias: [
        { puesto: 'GERENTE GENERAL', competencias: ['Pensamiento crítico', 'Análisis de datos'] },
        { puesto: 'Nuevo Puesto', competencias: ['Pensamiento crítico'] },
      ],
    })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.errores).toEqual([])
    expect(plan.puestosNuevos).toEqual([{ nombre: 'Nuevo Puesto', nivel: 'Apoyo' }])
    expect(plan.competenciasPuestosNuevos).toEqual([{ puesto: 'Nuevo Puesto', competencias: ['c1'] }])
  })
})

// ── Hoja 3 ↔ Hoja 4: cobertura obligatoria (revisión T3, Important 1) ──

describe('planificarMaestro — Hoja 3 ↔ Hoja 4: cobertura obligatoria', () => {
  it('nivel usado por un puesto de la Hoja 4 sin fila (válida) en la Hoja 3 → error bloqueante', () => {
    const parseado = baseParseado({
      niveles: [NIVEL_GERENCIAL], // "Apoyo" no viene en la Hoja 3
      puestos: [
        { puesto: 'GERENTE GENERAL', nivel: 'Gerencial' },
        { puesto: 'Nuevo Puesto', nivel: 'Apoyo' },
      ],
      competencias: [
        { puesto: 'GERENTE GENERAL', competencias: ['Pensamiento crítico', 'Análisis de datos'] },
        { puesto: 'Nuevo Puesto', competencias: ['Pensamiento crítico'] },
      ],
    })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.errores).toContain('Hoja 3: el nivel "Apoyo" (usado por puestos de la Hoja 4) no tiene fila de pesos')
  })

  it('todos los niveles usados por la Hoja 4 tienen fila válida en la Hoja 3 → sin ese error', () => {
    const plan = planificarMaestro(baseParseado(), bd())
    expect(plan.errores.some((e) => e.includes('no tiene fila de pesos'))).toBe(false)
  })
})

// ── Caso 5: padrón ──

describe('planificarMaestro — Padrón', () => {
  it('nivel de la columna distinto al derivado de hoja 4 → se reemplaza por el derivado y se cuenta', () => {
    const parseado = baseParseado({ padron: [filaPadron({ nivel: 'Apoyo' })] })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.padron.filas[0].nivel).toBe('Gerencial')
    expect(plan.padron.nivelesIgnorados).toBe(1)
    expect(plan.errores).toEqual([])
  })

  it('cargo sin fila en hoja 4 → error', () => {
    const parseado = baseParseado({ padron: [filaPadron({ cargo: 'Cargo Inexistente', nivel: 'Gerencial' })] })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.errores).toContain('Padrón: fila 4 (PER-001) - el cargo "Cargo Inexistente" no está en la Hoja 4 (Puestos)')
  })

  it('país desconocido → error', () => {
    const parseado = baseParseado({ padron: [filaPadron({ pais: 'Marte' })] })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.errores).toContain('Padrón: fila 4 (PER-001) - país desconocido "Marte"')
  })
})

// ── Caso 6: duplicados normalizados ──

describe('planificarMaestro — duplicados normalizados', () => {
  it('Hoja 4 con "Técnico De Taller" y "TÉCNICO DE TALLER" → se fusionan en un solo puesto + aviso', () => {
    const parseado = baseParseado({
      puestos: [
        { puesto: 'GERENTE GENERAL', nivel: 'Gerencial' },
        { puesto: 'Técnico De Taller', nivel: 'Apoyo' },
        { puesto: 'TÉCNICO DE TALLER', nivel: 'Apoyo' },
      ],
      competencias: [
        { puesto: 'GERENTE GENERAL', competencias: ['Pensamiento crítico', 'Análisis de datos'] },
        { puesto: 'Técnico De Taller', competencias: ['Pensamiento crítico'] },
      ],
    })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.puestosNuevos).toEqual([{ nombre: 'TÉCNICO DE TALLER', nivel: 'Apoyo' }])
    expect(plan.avisos).toContain('Hoja 4: el puesto "TÉCNICO DE TALLER" aparece repetido en el archivo — se fusiona en un solo registro')
  })
})

describe('planificarMaestro — puesto que desaparece', () => {
  it('puesto existente en la BD que no viene en hoja 4 → aviso informativo, no error (nunca se borra)', () => {
    const parseado = baseParseado({ puestos: [], competencias: [], pesosPuesto: [] })
    const plan = planificarMaestro(parseado, bd())
    expect(plan.errores).toEqual([])
    expect(plan.avisos).toContain('El puesto "GERENTE GENERAL" ya no aparece en el archivo — no se elimina (el importador nunca borra puestos)')
    expect(plan.pesosDerivados).toBe(0)
  })
})

// ── Hallazgo 2 (revisión T2): el aviso genérico de conteo hoja 6 vs hoja 4 se retiró — la
// cobertura de hoja 6 ya la comunican pesosDerivados/pesosPersonalizados. Se conserva la
// verificación de que la fusión de duplicados entre hojas sigue siendo benigna y visible.

describe('planificarMaestro — duplicados repetidos en varias hojas (fusión benigna)', () => {
  it('duplicado en hojas 5/6 pero no en 4 (archivo real: "Gerente de Operaciones"): fusión visible, sin errores', () => {
    const parseado = baseParseado({
      puestos: [
        { puesto: 'GERENTE GENERAL', nivel: 'Gerencial' },
        { puesto: 'Gerente de Operaciones', nivel: 'Apoyo' },
      ],
      competencias: [
        { puesto: 'GERENTE GENERAL', competencias: ['Pensamiento crítico', 'Análisis de datos'] },
        { puesto: 'Gerente de Operaciones', competencias: ['Pensamiento crítico'] },
        { puesto: 'GERENTE DE OPERACIONES', competencias: ['Pensamiento crítico'] },
      ],
      pesosPuesto: [
        { puesto: 'GERENTE GENERAL', nivel: 'Gerencial', pesosDim: [20, 15, 15, 30, 20] },
        { puesto: 'Gerente de Operaciones', nivel: 'Apoyo', pesosDim: [15, 35, 30, 10, 10] },
        { puesto: 'GERENTE DE OPERACIONES', nivel: 'Apoyo', pesosDim: [15, 35, 30, 10, 10] },
      ],
    })
    const plan = planificarMaestro(parseado, bd())
    // Fusión visible en ambas hojas duplicadas
    expect(plan.avisos).toContain('Hoja 5: el puesto "GERENTE DE OPERACIONES" aparece repetido en el archivo — se fusiona en un solo registro')
    expect(plan.avisos).toContain('Hoja 6: el puesto "GERENTE DE OPERACIONES" aparece repetido en el archivo — se fusiona en un solo registro')
    expect(plan.errores).toEqual([])
  })
})

// ── Caso 8: candado por ciclo activo ──

describe('planificarMaestro — candado por ciclo activo', () => {
  it('ciclo ACTIVO: bloqueadoPorCiclo=true + aviso explícito (no error: el dry-run se ve)', () => {
    const plan = planificarMaestro(baseParseado(), bd({ hayCicloActivo: true }))
    expect(plan.bloqueadoPorCiclo).toBe(true)
    expect(plan.errores).toEqual([])
    expect(plan.avisos).toContain('Hay un ciclo ACTIVO: los cambios se pueden revisar pero no se aplicarán hasta que cierre')
  })
})

// ── Caso 9 (retirado 05/08): la hoja 7 ("Pesos evaluadores") ya no la considera el planificador
// — esa configuración se gestiona directamente en la plataforma (Configuración → pesos de
// modalidades). `MaestroParseado` ya no tiene campo `evaluadores`; no hay nada que probar aquí.
