import { describe, it, expect } from 'vitest'
import { planificarBanco } from './plan'
import type { SnapshotBanco } from './plan'
import type { BancoParseado, FilaCompetencia } from './parser'

const SIN_DESC = ['', '', '', '', '']
const DESC = ['Nivel muy bajo', 'Nivel bajo', 'Nivel medio', 'Nivel alto', 'Nivel superior']

const bd: SnapshotBanco = {
  dimensiones: [{ nombre: 'Analítica' }, { nombre: 'Liderazgo e Interpersonal' }],
  competencias: [
    { nombre: 'Análisis de datos y KPIs', dimensionNombre: 'Analítica' },
    { nombre: 'Comunicación efectiva', dimensionNombre: 'Liderazgo e Interpersonal' },
  ],
  preguntasExistentes: [{ id: 'preg-1', competenciaNombre: 'Análisis de datos y KPIs', textoNorm: 'usa datos para decidir', descriptores: [] }],
  potencialExistentes: [{ id: 'pot-1', textoNorm: 'tiene proyeccion', descriptores: [] }],
}
const vacio = { competencias: [], potencial: [], errores: [] as string[] }
const fila = (f: Omit<FilaCompetencia, 'descriptores'> & { descriptores?: string[] }): FilaCompetencia =>
  ({ descriptores: SIN_DESC, ...f })

describe('planificarBanco', () => {
  it('acepta una competencia nueva válida', () => {
    const p: BancoParseado = { ...vacio, competencias: [fila({ linea: 2, dimension: 'Analítica', competencia: 'Análisis de datos y KPIs', texto: 'Nueva pregunta clara', modalidades: ['JEFE', 'AUTO'] })] }
    const r = planificarBanco(p, bd)
    expect(r.errores).toEqual([])
    expect(r.competenciasNuevas).toEqual([{ competencia: 'Análisis de datos y KPIs', texto: 'Nueva pregunta clara', modalidades: ['JEFE', 'AUTO'], descriptores: [] }])
  })
  it('duplicado exacto → aviso, no error, no se crea', () => {
    const p: BancoParseado = { ...vacio, competencias: [fila({ linea: 2, dimension: 'Analítica', competencia: 'Análisis de datos y KPIs', texto: '¿Usa datos para decidir?', modalidades: ['JEFE'] })] }
    const r = planificarBanco(p, bd)
    expect(r.competenciasNuevas).toHaveLength(0)
    expect(r.avisos.some((a) => a.toLowerCase().includes('ya existe'))).toBe(true)
  })
  it('competencia inexistente → error con sugerencia', () => {
    const p: BancoParseado = { ...vacio, competencias: [fila({ linea: 2, dimension: 'Analítica', competencia: 'Analisis de datos y KPI', texto: 'Pregunta clara', modalidades: ['JEFE'] })] }
    const r = planificarBanco(p, bd)
    expect(r.errores.some((e) => e.includes('¿quisiste decir') && e.includes('Análisis de datos y KPIs'))).toBe(true)
    expect(r.competenciasNuevas).toHaveLength(0)
  })
  it('competencia en dimensión equivocada → error', () => {
    const p: BancoParseado = { ...vacio, competencias: [fila({ linea: 2, dimension: 'Analítica', competencia: 'Comunicación efectiva', texto: 'Pregunta clara', modalidades: ['JEFE'] })] }
    const r = planificarBanco(p, bd)
    expect(r.errores.some((e) => e.toLowerCase().includes('dimensión'))).toBe(true)
  })
  it('sin modalidad → error', () => {
    const p: BancoParseado = { ...vacio, competencias: [fila({ linea: 2, dimension: 'Analítica', competencia: 'Análisis de datos y KPIs', texto: 'Pregunta clara', modalidades: [] })] }
    const r = planificarBanco(p, bd)
    expect(r.errores.some((e) => e.toLowerCase().includes('modalidad'))).toBe(true)
  })
  it('potencial nueva y duplicada', () => {
    const p: BancoParseado = { ...vacio, potencial: [
      { linea: 2, orden: null, texto: 'Aprende rápido', descriptores: SIN_DESC },
      { linea: 3, orden: 1, texto: '¿Tiene proyección?', descriptores: SIN_DESC },
    ] }
    const r = planificarBanco(p, bd)
    expect(r.potencialNuevas).toEqual([{ texto: 'Aprende rápido', descriptores: [] }])
    expect(r.avisos.some((a) => a.toLowerCase().includes('ya existe'))).toBe(true)
  })
  it('potencial existente + archivo con 5 descriptores → actualizar', () => {
    const p: BancoParseado = { ...vacio, potencial: [{ linea: 2, orden: 1, texto: '¿Tiene proyección?', descriptores: DESC }] }
    const r = planificarBanco(p, bd)
    expect(r.potencialNuevas).toHaveLength(0)
    expect(r.potencialActualizar).toEqual([{ preguntaPotencialId: 'pot-1', texto: '¿Tiene proyección?', descriptores: DESC }])
  })
  it('potencial con descriptores incompletos → error', () => {
    const p: BancoParseado = { ...vacio, potencial: [{ linea: 4, orden: 2, texto: 'Nueva de potencial', descriptores: ['Uno', 'Dos', '', '', ''] }] }
    const r = planificarBanco(p, bd)
    expect(r.errores.some((e) => e.includes('5 niveles') && e.includes('fila 4'))).toBe(true)
    expect(r.potencialNuevas).toHaveLength(0)
  })
  it('propaga errores de estructura del parser', () => {
    const r = planificarBanco({ ...vacio, errores: ['Falta la hoja «Potencial».'] }, bd)
    expect(r.errores).toContain('Falta la hoja «Potencial».')
  })

  // ───────────── Descriptores BARS ─────────────
  it('pregunta nueva con 5 descriptores → se crea con ellos', () => {
    const p: BancoParseado = { ...vacio, competencias: [fila({ linea: 2, dimension: 'Analítica', competencia: 'Análisis de datos y KPIs', texto: 'Nueva con escala', modalidades: ['JEFE'], descriptores: DESC })] }
    const r = planificarBanco(p, bd)
    expect(r.errores).toEqual([])
    expect(r.competenciasNuevas[0].descriptores).toEqual(DESC)
  })
  it('descriptores incompletos (1 a 4 llenos) → error, no se crea', () => {
    const p: BancoParseado = { ...vacio, competencias: [fila({ linea: 3, dimension: 'Analítica', competencia: 'Análisis de datos y KPIs', texto: 'Escala a medias', modalidades: ['JEFE'], descriptores: ['Solo uno', '', '', '', ''] })] }
    const r = planificarBanco(p, bd)
    expect(r.errores.some((e) => e.includes('5 niveles') && e.includes('fila 3'))).toBe(true)
    expect(r.competenciasNuevas).toHaveLength(0)
  })
  it('existente sin descriptores + archivo con 5 → actualizar descriptores (aviso, no alta)', () => {
    const p: BancoParseado = { ...vacio, competencias: [fila({ linea: 2, dimension: 'Analítica', competencia: 'Análisis de datos y KPIs', texto: '¿Usa datos para decidir?', modalidades: ['JEFE'], descriptores: DESC })] }
    const r = planificarBanco(p, bd)
    expect(r.competenciasNuevas).toHaveLength(0)
    expect(r.descriptoresActualizar).toEqual([{ preguntaId: 'preg-1', competencia: 'Análisis de datos y KPIs', texto: '¿Usa datos para decidir?', descriptores: DESC }])
    expect(r.avisos.some((a) => a.includes('se actualizarán sus descriptores'))).toBe(true)
  })
  it('existente con los MISMOS descriptores → se salta sin actualizar', () => {
    const bd2: SnapshotBanco = { ...bd, preguntasExistentes: [{ id: 'preg-1', competenciaNombre: 'Análisis de datos y KPIs', textoNorm: 'usa datos para decidir', descriptores: DESC }] }
    const p: BancoParseado = { ...vacio, competencias: [fila({ linea: 2, dimension: 'Analítica', competencia: 'Análisis de datos y KPIs', texto: '¿Usa datos para decidir?', modalidades: ['JEFE'], descriptores: DESC })] }
    const r = planificarBanco(p, bd2)
    expect(r.descriptoresActualizar).toHaveLength(0)
    expect(r.avisos.some((a) => a.includes('se salta'))).toBe(true)
  })
  it('existente + archivo SIN descriptores → se salta y NO borra los guardados', () => {
    const bd2: SnapshotBanco = { ...bd, preguntasExistentes: [{ id: 'preg-1', competenciaNombre: 'Análisis de datos y KPIs', textoNorm: 'usa datos para decidir', descriptores: DESC }] }
    const p: BancoParseado = { ...vacio, competencias: [fila({ linea: 2, dimension: 'Analítica', competencia: 'Análisis de datos y KPIs', texto: '¿Usa datos para decidir?', modalidades: ['JEFE'] })] }
    const r = planificarBanco(p, bd2)
    expect(r.descriptoresActualizar).toHaveLength(0)
    expect(r.competenciasNuevas).toHaveLength(0)
  })
})
