import { describe, it, expect } from 'vitest'
import { hojasPlantillaMaestra } from './plantilla'

describe('hojasPlantillaMaestra', () => {
  const cat = { niveles: ['Apoyo'], dimensiones: ['Analítica'], competencias: ['Análisis de datos y KPIs'], paises: ['Perú'], areas: ['TI'] }
  it('incluye las hojas que el parser espera', () => {
    const nombres = hojasPlantillaMaestra(cat).map((h) => h.nombre)
    expect(nombres).toEqual(expect.arrayContaining(['Niveles', 'Puestos', 'Competencias x Puesto', 'Pesos x Puesto', 'Padrón', 'Catálogos']))
  })
})
