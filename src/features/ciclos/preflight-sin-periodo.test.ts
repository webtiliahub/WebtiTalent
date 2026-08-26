import { describe, it, expect } from 'vitest'
import { participantesFueraDelPeriodo, objetivosIncompletosDe } from './preflight'

/** Rama pura de preflightCiclo (Task 5): el aviso `fueraDelPeriodo` que explica por qué
 * ciertos participantes quedan en 0% de objetivos cuando el ciclo tiene período elegido.
 * No depende de Prisma, así que se testea directo sin mocks. */

const base = { focoPaisIds: [], focoAreaIds: [], focoNivelIds: [], incluirIds: [], excluirIds: [] }
const ana = { id: 'ana', nombres: 'Ana', apellidos: 'Ruiz', activo: true, paisId: 'cl', areaId: 'com', puestoId: null, nivelId: 'mm' }
const beto = { id: 'beto', nombres: 'Beto', apellidos: 'Salas', activo: true, paisId: 'pe', areaId: 'ops', puestoId: null, nivelId: 'mm' }

describe('participantesFueraDelPeriodo', () => {
  it('sin período (ciclo sin objetivos): siempre vacío, sin evaluar nada', () => {
    expect(participantesFueraDelPeriodo(null, [ana, beto])).toEqual([])
  })

  it('período sin foco: nadie queda fuera', () => {
    expect(participantesFueraDelPeriodo(base, [ana, beto])).toEqual([])
  })

  it('período acotado por país: los de otro país quedan fuera (nombre completo)', () => {
    const periodo = { ...base, focoPaisIds: ['cl'] }
    expect(participantesFueraDelPeriodo(periodo, [ana, beto])).toEqual(['Beto Salas'])
  })

  it('incluir manual saca a alguien de la lista de "fuera" (salvo que el país siga excluyéndolo)', () => {
    const periodo = { ...base, focoPaisIds: ['cl'], incluirIds: ['beto'] }
    // incluir NUNCA salta el país: Beto (pe) sigue fuera del alcance del período
    expect(participantesFueraDelPeriodo(periodo, [ana, beto])).toEqual(['Beto Salas'])
  })

  it('sin participantes: vacío', () => {
    expect(participantesFueraDelPeriodo({ ...base, focoPaisIds: ['cl'] }, [])).toEqual([])
  })
})

describe('objetivosIncompletosDe (IMPORTANT-1)', () => {
  // Transversal con foco vacío: "aplica a todos" según su propia focalización — es justo el
  // caso realista de la final review (p.ej. "Cultura" 100%) que antes marcaba 100% en preflight
  // sin intersecar con el alcance del período.
  const TRANSVERSAL_100_FOCO_VACIO = {
    colaboradorId: null, tipo: 'TRANSVERSAL', peso: 100,
    focoAreaIds: [] as string[], focoNivelIds: [] as string[], focoPaisIds: [] as string[], focoPuestoIds: [] as string[],
  }

  it('participante FUERA del alcance del período: 0% aunque el transversal de foco vacío le diera 100%', () => {
    const periodo = { ...base, focoPaisIds: ['cl'] } // beto (pe) queda fuera
    const resultado = objetivosIncompletosDe(periodo, [ana, beto], [TRANSVERSAL_100_FOCO_VACIO])

    // Ana SÍ está en el alcance (cl) y el transversal la cubre al 100%: no aparece incompleta.
    // Beto queda en 0% (bloqueante) en vez de heredar el 100% del transversal.
    expect(resultado).toEqual([{ nombre: 'Beto Salas', pct: 0 }])
  })

  it('participante DENTRO del alcance: suma transversales aplicables + propios normalmente', () => {
    const periodo = { ...base } // sin foco: todos dentro
    const resultado = objetivosIncompletosDe(periodo, [ana, beto], [TRANSVERSAL_100_FOCO_VACIO])

    expect(resultado).toEqual([])
  })

  it('sin período (ciclo sin objetivos): no filtra por alcance, solo suma lo aprobado', () => {
    const resultado = objetivosIncompletosDe(null, [ana, beto], [TRANSVERSAL_100_FOCO_VACIO])

    expect(resultado).toEqual([])
  })
})
