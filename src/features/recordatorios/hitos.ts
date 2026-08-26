/** Motor de hitos de los recordatorios automáticos. PURO: recibe `hoy`, nunca usa Date.now().
 * Cadencia fija del spec: 30/15/7 días antes del deadline + diario en la última semana. */

export type Hito = 'D30' | 'D15' | 'D7' | 'DIARIO' | 'ULTIMO_DIA'

const DIA_MS = 24 * 60 * 60 * 1000
const soloFecha = (f: Date) => new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate()))

/** Días calendario entre hoy y el deadline (las horas no cuentan). */
export function diasRestantes(deadline: Date, hoy: Date): number {
  return Math.round((soloFecha(deadline).getTime() - soloFecha(hoy).getTime()) / DIA_MS)
}

export function hitoDelDia(deadline: Date, hoy: Date): Hito | null {
  const dias = diasRestantes(deadline, hoy)
  if (dias < 0) return null
  if (dias <= 1) return 'ULTIMO_DIA'
  if (dias <= 6) return 'DIARIO'
  if (dias === 7) return 'D7'
  if (dias === 15) return 'D15'
  if (dias === 30) return 'D30'
  return null
}

/** Digest RRHH: lunes mientras haya pendientes, y diario en la última semana del proceso más próximo. */
export function tocaDigestRrhh(deadlineMasProximo: Date | null, hoy: Date): boolean {
  if (!deadlineMasProximo) return false
  const dias = diasRestantes(deadlineMasProximo, hoy)
  if (dias < 0) return false
  return hoy.getUTCDay() === 1 || dias <= 7
}

/** Offsets fijos (días restantes al deadline) en los que ocurre un hito, de mayor a menor. */
const OFFSETS_HITO = [30, 15, 7, 6, 5, 4, 3, 2, 1, 0] as const

function hitoDeOffset(offset: number): Hito {
  if (offset === 30) return 'D30'
  if (offset === 15) return 'D15'
  if (offset === 7) return 'D7'
  if (offset >= 2) return 'DIARIO'
  return 'ULTIMO_DIA'
}

/** Siguiente hito futuro (para la card «Recordatorios» del panel).
 * Cálculo analítico sobre los offsets fijos: sin horizonte de búsqueda acotado,
 * válido para deadlines a cualquier distancia (períodos de 90-365+ días). */
export function proximoHito(deadline: Date, hoy: Date): { hito: Hito; fecha: Date } | null {
  const dias = diasRestantes(deadline, hoy)
  if (dias <= 0) return null
  const offset = OFFSETS_HITO.find((o) => o < dias)
  if (offset === undefined) return null
  const fecha = new Date(soloFecha(deadline).getTime() - offset * DIA_MS)
  return { hito: hitoDeOffset(offset), fecha }
}
