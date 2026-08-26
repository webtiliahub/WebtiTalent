/** Regla de participación por antigüedad (pedido RR.HH. Hunter, 2026-07):
 * un colaborador participa de un ciclo de evaluación solo si a la FECHA DE INICIO
 * del ciclo tiene al menos 6 meses en la compañía. No afecta la carga de objetivos
 * (el período es independiente): al siguiente ciclo entra automáticamente.
 * Sin fecha de ingreso registrada, SE INCLUYE (no se excluye por dato faltante). */

export const ANTIGUEDAD_MINIMA_MESES = 6

/** true si el colaborador queda FUERA del ciclo por antigüedad insuficiente. */
export function excluidoPorAntiguedad(fechaIngreso: Date | null | undefined, inicioCiclo: Date): boolean {
  if (!fechaIngreso) return false // sin dato → se incluye (el pre-flight avisa)
  // Aritmética en UTC: las fechas de BD son medianoche UTC y setMonth local introduce
  // corrimientos de un día según la zona horaria del servidor.
  const limite = Date.UTC(inicioCiclo.getUTCFullYear(), inicioCiclo.getUTCMonth() - ANTIGUEDAD_MINIMA_MESES, inicioCiclo.getUTCDate())
  return fechaIngreso.getTime() > limite
}
