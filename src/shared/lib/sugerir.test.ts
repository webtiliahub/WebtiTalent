import { describe, it, expect } from 'vitest'
import { sugerir } from './sugerir'

describe('sugerir', () => {
  const dims = ['Analítica', 'Know-How / Expertise', 'Operativa / Ejecución', 'Liderazgo e Interpersonal', 'Digital e Innovación']
  it('devuelve la opción por diferencia de tilde', () => expect(sugerir('Analitica', dims)).toBe('Analítica'))
  it('devuelve la opción por un typo cercano', () => expect(sugerir('Operativa / Ejecucion', dims)).toBe('Operativa / Ejecución'))
  it('null cuando nada se parece', () => expect(sugerir('Ventas', dims)).toBeNull())
  it('match exacto se devuelve a sí mismo', () => expect(sugerir('Analítica', dims)).toBe('Analítica'))
  it('lista vacía → null', () => expect(sugerir('Analítica', [])).toBeNull())
})
