/** Presentación compartida de estados del período (importable desde server y client). */
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** «2026-12» (input type=month) → «dic 2026»; cualquier otro texto se muestra tal cual. */
export function mesLegible(v: string | null | undefined): string {
  if (!v) return ''
  const m = v.match(/^(\d{4})-(\d{2})$/)
  if (!m) return v
  const mes = MESES_CORTOS[Number(m[2]) - 1]
  return mes ? `${mes} ${m[1]}` : v
}

export const CHIP_PERIODO = {
  BORRADOR: { label: 'Borrador', cls: 'bg-hueso-2 text-gris', dot: '#b9b3ac' },
  CARGA_ABIERTA: { label: 'Carga abierta', cls: 'bg-emerald-50 text-emerald-700', dot: '#10b981' },
  // Derivado: el período sigue CARGA_ABIERTA pero su fecha límite ya pasó (RR.HH. puede extender o cerrar)
  PLAZO_VENCIDO: { label: 'Plazo vencido', cls: 'bg-amber-50 text-amber-700', dot: '#d97706' },
  CERRADO: { label: 'Cerrado', cls: 'bg-hueso-2 text-negro', dot: '#8a857f' },
} as const

/** Chip efectivo: muestra "Plazo vencido" cuando la carga sigue abierta pero la fecha ya pasó. */
export function chipPeriodo(estado: keyof typeof CHIP_PERIODO, vencido: boolean) {
  return estado === 'CARGA_ABIERTA' && vencido ? CHIP_PERIODO.PLAZO_VENCIDO : CHIP_PERIODO[estado]
}
