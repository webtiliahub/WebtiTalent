import { describe, it, expect } from 'vitest'
import { hojasPlantillaBanco } from './plantilla'

describe('hojasPlantillaBanco', () => {
  const cat = { dimensiones: [{ nombre: 'Analítica', competencias: [{ nombre: 'Análisis de datos y KPIs' }] }] }
  it('incluye hojas Competencias, Potencial y Catálogos', () => {
    const h = hojasPlantillaBanco(cat)
    expect(h.map((x) => x.nombre)).toEqual(['Competencias', 'Potencial', 'Catálogos'])
  })
  it('la hoja Competencias trae el encabezado con las 4 modalidades y los 5 descriptores', () => {
    const comp = hojasPlantillaBanco(cat).find((x) => x.nombre === 'Competencias')!
    expect(comp.filas[0]).toEqual(['Dimensión', 'Competencia', 'Texto', 'JEFE', 'PAR', 'ASC', 'AUTO', '1 · Insuficiente', '2 · En desarrollo', '3 · Competente', '4 · Superior', '5 · Excepcional'])
  })
  it('Catálogos lista dimensión → competencia real', () => {
    const c = hojasPlantillaBanco(cat).find((x) => x.nombre === 'Catálogos')!
    expect(c.filas).toContainEqual(['Analítica', 'Análisis de datos y KPIs'])
  })
})
