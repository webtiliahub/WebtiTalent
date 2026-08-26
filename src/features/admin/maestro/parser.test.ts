import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseMaestro, normalizar } from './parser'

function libro(hojas: Record<string, (string | number)[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const [nombre, filas] of Object.entries(hojas)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), nombre)
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

// La hoja 7 ("Pesos evaluadores") se conserva en este fixture a propósito: el parser debe
// IGNORARLA por completo (esa configuración se gestiona en la plataforma, no vía Excel — decisión
// de Christian 05/08), pero su sola presencia no debe romper nada.
const HOJAS_MINIMAS = {
  '3. Niveles': [
    ['Niveles: pesos por dimensión'], ['leyenda'],
    ['Nivel', 'D1 %', 'D2 %', 'D3 %', 'D4 %', 'D5 %', 'TOTAL', '% Competencias (POR LLENAR)', '% Objetivos (POR LLENAR)', 'Check'],
    ['Gerencial', 20, 15, 15, 30, 20, 100, 60, 40, '✓'],
    ['Apoyo', 15, 35, 30, 10, 10, 100, 50, 50, '✓'],
  ],
  '4. Puestos': [
    ['Puestos del padrón'], ['leyenda'],
    ['Puesto', 'Nivel jerárquico', 'Área (mayoritaria)', 'Países', 'Titulares', 'Revisión'],
    ['GERENTE GENERAL', 'Gerencial', 'DIRECCIÓN', 'Perú', 1, ''],
    ['Agente De Seguridad', 'Apoyo', 'SEGURIDAD', 'Perú', 10, ''],
  ],
  '5. Competencias x Puesto': [
    ['Competencias por puesto'], ['leyenda'],
    ['', '', 'D1 · Analítica', ''],
    ['Puesto', 'Nivel', 'Pensamiento crítico', 'Análisis de datos'],
    ['GERENTE GENERAL', 'Gerencial', 'X', 'X'],
    ['Agente De Seguridad', 'Apoyo', 'X', ''],
  ],
  '6. Pesos x Puesto': [
    ['Pesos por dimensión POR PUESTO'], ['leyenda'],
    ['Puesto', 'Nivel', 'D1', 'D2', 'D3', 'D4', 'D5', 'TOTAL'],
    ['GERENTE GENERAL', 'Gerencial', 20, 15, 15, 30, 20, 100],
  ],
  '7. Pesos evaluadores': [
    ['Pesos por tipo de evaluación'], ['leyenda'],
    ['Evaluador', 'Año 1 (2026)', 'Año 2 (2027)', 'Año 3 (2028+)', 'Dimensiones que evalúa'],
    ['Jefe directo', 50, 45, 40, 'D1–D5 + Potencial'],
  ],
  '8. Padrón': [
    ['Padrón de colaboradores'], ['leyenda'],
    ['codigo', 'documento', 'nombres', 'apellidos', 'email', 'telefono', 'pais', 'area', 'cargo', 'nivel_jerarquico', 'codigo_jefe', 'nivel_liderazgo', 'fecha_ingreso', '⚠ Observación (no se carga)'],
    ['PER-001', '123', 'Ana', 'Pérez', 'ana@marca.com.pe', '', 'Perú', 'DIRECCIÓN', 'GERENTE GENERAL', 'Gerencial', '', 'N2', '2020-01-15'],
  ],
}

describe('normalizar', () => {
  it('quita tildes, baja a minúsculas y colapsa espacios', () => {
    expect(normalizar('  Técnico   De Taller ')).toBe('tecnico de taller')
  })
})

// Variante real: encabezado de TRES filas en "5. Competencias x Puesto"
// (dimensiones, NOMBRES de competencia, códigos "Puesto | Nivel | 1.1 | 1.2 | ... | Total").
const HOJAS_CON_ENCABEZADO_TRIPLE = {
  ...HOJAS_MINIMAS,
  '5. Competencias x Puesto': [
    ['Competencias por puesto'], ['leyenda'],
    ['', '', 'D1 · Analítica', '', '', ''],
    ['', '', 'Pensamiento crítico y estructurado', 'Análisis de datos y toma de decisiones', 'Comunicación efectiva', ''],
    ['Puesto', 'Nivel', '1.1', '1.2', '1.3', 'Total'],
    ['GERENTE GENERAL', 'Gerencial', 'X', 'X', '', ''],
    ['Agente De Seguridad', 'Apoyo', 'X', '', 'X', ''],
  ],
}

describe('parseMaestro', () => {
  it('parsea las 6 secciones localizando encabezados tras filas de título', () => {
    const r = parseMaestro(libro(HOJAS_MINIMAS))
    expect(r.errores).toEqual([])
    expect(r.niveles).toEqual([
      { nivel: 'Gerencial', pesosDim: [20, 15, 15, 30, 20], compPct: 60, objPct: 40 },
      { nivel: 'Apoyo', pesosDim: [15, 35, 30, 10, 10], compPct: 50, objPct: 50 },
    ])
    expect(r.puestos).toEqual([
      { puesto: 'GERENTE GENERAL', nivel: 'Gerencial' },
      { puesto: 'Agente De Seguridad', nivel: 'Apoyo' },
    ])
    expect(r.competencias).toEqual([
      { puesto: 'GERENTE GENERAL', competencias: ['Pensamiento crítico', 'Análisis de datos'] },
      { puesto: 'Agente De Seguridad', competencias: ['Pensamiento crítico'] },
    ])
    expect(r.pesosPuesto).toEqual([{ puesto: 'GERENTE GENERAL', nivel: 'Gerencial', pesosDim: [20, 15, 15, 30, 20] }])
    expect(r.padron).toHaveLength(1)
    expect(r.padron[0]).toMatchObject({ linea: 4, codigo: 'PER-001', cargo: 'GERENTE GENERAL', nivel: 'Gerencial', email: 'ana@marca.com.pe' })
  })
  it('identifica hojas por nombre normalizado aunque cambie el prefijo', () => {
    const hojas = Object.fromEntries(Object.entries(HOJAS_MINIMAS).map(([k, v]) => [k.replace(/^\d+\. /, 'Hoja - '), v]))
    expect(parseMaestro(libro(hojas)).errores).toEqual([])
  })
  it('hoja requerida ausente = error que la nombra', () => {
    const { '8. Padrón': _omitida, ...sin } = HOJAS_MINIMAS
    const r = parseMaestro(libro(sin))
    expect(r.errores.some((e) => e.toLowerCase().includes('padr'))).toBe(true)
  })
  it('hoja 7 "Pesos evaluadores" presente: se ignora sin error y sin sección propia en el resultado', () => {
    const r = parseMaestro(libro(HOJAS_MINIMAS))
    expect(r.errores).toEqual([])
    expect(r).not.toHaveProperty('evaluadores')
  })
  it('hoja 7 "Pesos evaluadores" ausente: no es error (se ignora, esté o no en el archivo)', () => {
    const { '7. Pesos evaluadores': _omitida, ...sin } = HOJAS_MINIMAS
    const r = parseMaestro(libro(sin))
    expect(r.errores).toEqual([])
  })
  it('encabezado no encontrado = error que nombra la hoja', () => {
    const rotas = { ...HOJAS_MINIMAS, '4. Puestos': [['solo título'], ['sin encabezado real']] }
    const r = parseMaestro(libro(rotas))
    expect(r.errores.some((e) => e.includes('Puestos'))).toBe(true)
  })
  it('hoja "Competencias x Puesto" con encabezado de TRES filas: toma los NOMBRES, no los códigos', () => {
    const r = parseMaestro(libro(HOJAS_CON_ENCABEZADO_TRIPLE))
    expect(r.errores).toEqual([])
    expect(r.competencias).toEqual([
      {
        puesto: 'GERENTE GENERAL',
        competencias: ['Pensamiento crítico y estructurado', 'Análisis de datos y toma de decisiones'],
      },
      {
        puesto: 'Agente De Seguridad',
        competencias: ['Pensamiento crítico y estructurado', 'Comunicación efectiva'],
      },
    ])
  })
})
