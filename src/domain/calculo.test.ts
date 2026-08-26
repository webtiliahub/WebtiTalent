import { describe, it, expect } from 'vitest'
import {
  notaModalidad, notaCompetencias, cumplimientoObjetivos, notaFinal,
  potencial, box9, tramo, etiquetaNota, validarPesos,
  desgloseCompetencias, notaCompetenciasDesdeDesglose,
} from './calculo'

const PESOS_DIM = [
  { dimensionId: 'analitica', peso: 30 },
  { dimensionId: 'operativa', peso: 40 },
  { dimensionId: 'liderazgo', peso: 30 },
]
const PESOS_MOD = { JEFE: 60, PAR: 25, ASCENDENTE: 15, AUTO: 0 } as const

describe('notaModalidad', () => {
  it('pondera el promedio por dimensión con los pesos del puesto', () => {
    const r = [
      { modalidad: 'JEFE' as const, dimensionId: 'analitica', valor: 4 },
      { modalidad: 'JEFE' as const, dimensionId: 'operativa', valor: 5 },
      { modalidad: 'JEFE' as const, dimensionId: 'liderazgo', valor: 3 },
    ]
    // 4*0.3 + 5*0.4 + 3*0.3 = 1.2 + 2 + 0.9 = 4.1
    expect(notaModalidad(r, PESOS_DIM)).toBeCloseTo(4.1)
  })

  it('renormaliza cuando una dimensión no tiene respuestas', () => {
    const r = [
      { modalidad: 'PAR' as const, dimensionId: 'operativa', valor: 4 },
      { modalidad: 'PAR' as const, dimensionId: 'liderazgo', valor: 5 },
    ]
    // (4*40 + 5*30) / 70 = (160+150)/70 ≈ 4.4286
    expect(notaModalidad(r, PESOS_DIM)).toBeCloseTo(310 / 70)
  })

  it('promedia múltiples respuestas de la misma dimensión', () => {
    const r = [
      { modalidad: 'JEFE' as const, dimensionId: 'analitica', valor: 3 },
      { modalidad: 'JEFE' as const, dimensionId: 'analitica', valor: 5 },
    ]
    expect(notaModalidad(r, PESOS_DIM)).toBeCloseTo(4)
  })

  it('devuelve null sin respuestas', () => {
    expect(notaModalidad([], PESOS_DIM)).toBeNull()
  })
})

describe('notaCompetencias', () => {
  it('combina modalidades con sus pesos (auto pesa 0)', () => {
    const r = [
      { modalidad: 'JEFE' as const, dimensionId: 'operativa', valor: 4 },
      { modalidad: 'PAR' as const, dimensionId: 'operativa', valor: 5 },
      { modalidad: 'ASCENDENTE' as const, dimensionId: 'operativa', valor: 3 },
      { modalidad: 'AUTO' as const, dimensionId: 'operativa', valor: 5 }, // no debe pesar
    ]
    // (4*60 + 5*25 + 3*15) / 100 = (240+125+45)/100 = 4.1
    expect(notaCompetencias(r, PESOS_DIM, { ...PESOS_MOD })).toBeCloseTo(4.1)
  })

  it('renormaliza cuando falta una modalidad (sin pares)', () => {
    const r = [
      { modalidad: 'JEFE' as const, dimensionId: 'operativa', valor: 4 },
      { modalidad: 'ASCENDENTE' as const, dimensionId: 'operativa', valor: 3 },
    ]
    // (4*60 + 3*15) / 75 = (240+45)/75 = 3.8
    expect(notaCompetencias(r, PESOS_DIM, { ...PESOS_MOD })).toBeCloseTo(3.8)
  })
})

describe('desgloseCompetencias (base de la calibración)', () => {
  const CASOS = [
    // Cobertura completa
    [
      { modalidad: 'JEFE' as const, dimensionId: 'analitica', valor: 4 },
      { modalidad: 'JEFE' as const, dimensionId: 'operativa', valor: 5 },
      { modalidad: 'JEFE' as const, dimensionId: 'liderazgo', valor: 3 },
      { modalidad: 'PAR' as const, dimensionId: 'analitica', valor: 3 },
      { modalidad: 'PAR' as const, dimensionId: 'operativa', valor: 4 },
      { modalidad: 'PAR' as const, dimensionId: 'liderazgo', valor: 4 },
      { modalidad: 'ASCENDENTE' as const, dimensionId: 'liderazgo', valor: 5 },
    ],
    // Cobertura dispareja: pares sin analítica, sin ascendente
    [
      { modalidad: 'JEFE' as const, dimensionId: 'analitica', valor: 4 },
      { modalidad: 'JEFE' as const, dimensionId: 'operativa', valor: 2 },
      { modalidad: 'PAR' as const, dimensionId: 'operativa', valor: 5 },
      { modalidad: 'PAR' as const, dimensionId: 'liderazgo', valor: 4 },
    ],
    // Una sola modalidad
    [
      { modalidad: 'JEFE' as const, dimensionId: 'operativa', valor: 4 },
      { modalidad: 'JEFE' as const, dimensionId: 'liderazgo', valor: 3 },
    ],
  ]

  it('reproduce EXACTAMENTE la nota de competencias (Σ pesoEfectivo × nota)', () => {
    for (const r of CASOS) {
      const desglose = desgloseCompetencias(r, PESOS_DIM, { ...PESOS_MOD })
      expect(notaCompetenciasDesdeDesglose(desglose)).toBeCloseTo(notaCompetencias(r, PESOS_DIM, { ...PESOS_MOD })!, 10)
    }
  })

  it('los pesos efectivos suman 1', () => {
    for (const r of CASOS) {
      const desglose = desgloseCompetencias(r, PESOS_DIM, { ...PESOS_MOD })
      expect(desglose.reduce((a, d) => a + d.pesoEfectivo, 0)).toBeCloseTo(1, 10)
    }
  })

  it('un ajuste de dimensión mueve la nota exactamente su peso efectivo', () => {
    const r = CASOS[0]
    const desglose = desgloseCompetencias(r, PESOS_DIM, { ...PESOS_MOD })
    const liderazgo = desglose.find((d) => d.dimensionId === 'liderazgo')!
    const base = notaCompetenciasDesdeDesglose(desglose)!
    const ajustada = notaCompetenciasDesdeDesglose(desglose, { liderazgo: liderazgo.nota + 1 })!
    expect(ajustada - base).toBeCloseTo(liderazgo.pesoEfectivo, 10)
  })

  it('sin respuestas devuelve vacío y nota null', () => {
    expect(desgloseCompetencias([], PESOS_DIM, { ...PESOS_MOD })).toEqual([])
    expect(notaCompetenciasDesdeDesglose([])).toBeNull()
  })
})

describe('cumplimientoObjetivos', () => {
  it('pondera el logro por el peso del objetivo', () => {
    // Caso Carlos del demo: 40%→90, 30%→100, 30%→85 = 36+30+25.5 = 91.5%
    const logros = [
      { peso: 40, logro: 90 },
      { peso: 30, logro: 100 },
      { peso: 30, logro: 85 },
    ]
    expect(cumplimientoObjetivos(logros)).toBeCloseTo(91.5)
  })

  it('capea el logro a 100%: cumplir el objetivo es el máximo', () => {
    expect(cumplimientoObjetivos([{ peso: 100, logro: 150 }])).toBeCloseTo(100)
  })

  it('devuelve null sin objetivos', () => {
    expect(cumplimientoObjetivos([])).toBeNull()
  })
})

describe('notaFinal', () => {
  it('combina por nivel (Apoyo 70/30): caso Diego', () => {
    // comp 3.0, objetivos 80% → nota obj 4.0: 3*0.7 + 4*0.3 = 2.1+1.2 = 3.3
    expect(notaFinal(3.0, 80, { comp: 70, obj: 30 })).toBeCloseTo(3.3)
  })

  it('Mando Medio 60/40: caso Ana', () => {
    // comp 4.2, objetivos 92% → 4.6: 4.2*0.6 + 4.6*0.4 = 2.52+1.84 = 4.36
    expect(notaFinal(4.2, 92, { comp: 60, obj: 40 })).toBeCloseTo(4.36)
  })

  it('capea el % de objetivos a 100 para la nota', () => {
    expect(notaFinal(4, 120, { comp: 50, obj: 50 })).toBeCloseTo((4 + 5) / 2)
  })

  it('renormaliza si falta un componente', () => {
    expect(notaFinal(4, null, { comp: 60, obj: 40 })).toBeCloseTo(4)
    expect(notaFinal(null, 100, { comp: 60, obj: 40 })).toBeCloseTo(5)
    expect(notaFinal(null, null, { comp: 60, obj: 40 })).toBeNull()
  })
})

describe('potencial y 9-Box', () => {
  it('potencial = promedio de las 5 preguntas', () => {
    expect(potencial([4, 5, 4, 4, 4])).toBeCloseTo(4.2)
    expect(potencial([])).toBeNull()
  })

  it('tramos: <3 bajo, 3–3.99 medio, >=4 alto', () => {
    expect(tramo(2.9)).toBe('BAJO')
    expect(tramo(3)).toBe('MEDIO')
    expect(tramo(3.99)).toBe('MEDIO')
    expect(tramo(4)).toBe('ALTO')
  })

  it('clasifica los 9 cuadrantes', () => {
    expect(box9(4.4, 4.5)).toBe('Estrella')
    expect(box9(3.5, 4.2)).toBe('Crecimiento')
    expect(box9(2.7, 4.1)).toBe('Enigma')
    expect(box9(4.1, 3.2)).toBe('Alto desempeño')
    expect(box9(3.8, 3.5)).toBe('Colaborador clave')
    expect(box9(2.4, 3.4)).toBe('En riesgo')
    expect(box9(4.2, 2.5)).toBe('Sólido')
    expect(box9(3.1, 2.6)).toBe('Eficaz')
    expect(box9(2.2, 2.1)).toBe('Bajo desempeño')
    expect(box9(null, 4)).toBeNull()
  })
})

describe('etiquetaNota y validarPesos', () => {
  it('etiquetas por rango (escala oficial del Manual Hunter, cortes en x.5)', () => {
    expect(etiquetaNota(4.6)).toBe('Excepcional')
    expect(etiquetaNota(4.1)).toBe('Superior')
    expect(etiquetaNota(3.5)).toBe('Superior')
    expect(etiquetaNota(3.0)).toBe('Competente')
    expect(etiquetaNota(2.0)).toBe('En desarrollo')
    expect(etiquetaNota(1.2)).toBe('Insuficiente')
  })

  it('valida que los pesos sumen 100', () => {
    expect(validarPesos([30, 40, 30])).toEqual({ total: 100, valido: true })
    expect(validarPesos([30, 40])).toEqual({ total: 70, valido: false })
  })
})
