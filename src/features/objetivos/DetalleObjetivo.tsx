'use client'

import { Modal } from '@/shared/ui/Modal'
import { mesLegible } from './periodo-ui'
import type { ObjetivoEditable } from './FormEditarObjetivo'

const ESTADO_CHIP: Record<string, { label: string; cls: string }> = {
  APROBADO: { label: 'Aprobado', cls: 'bg-emerald-50 text-emerald-700' },
  PROPUESTO: { label: 'Propuesto', cls: 'bg-amber-50 text-amber-700' },
  RECHAZADO: { label: 'Rechazado', cls: 'bg-red-50 text-hunter-dark' },
}

function Campo({ label, children, ancho }: { label: string; children: React.ReactNode; ancho?: boolean }) {
  return (
    <div className={ancho ? 'md:col-span-3' : undefined}>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gris">{label}</p>
      <div className="rounded-xl bg-hueso px-3.5 py-2.5 text-sm">{children}</div>
    </div>
  )
}

/** Separa la métrica "KPI: valor" para mostrarla en sus dos campos. */
function partesMetrica(metrica: string | null): { kpi: string; valor: string } {
  if (!metrica) return { kpi: '', valor: '' }
  const idx = metrica.indexOf(': ')
  if (idx === -1) return { kpi: metrica, valor: '' }
  return { kpi: metrica.slice(0, idx), valor: metrica.slice(idx + 2) }
}

/** Ficha de SOLO LECTURA de un objetivo, con el mismo layout del formulario de creación:
 * para revisar la propuesta completa (descripción incluida) antes de aprobarla o rechazarla. */
export function DetalleObjetivo({ objetivo, estado, abierto, onCerrar }: {
  objetivo: ObjetivoEditable
  estado?: string
  abierto: boolean
  onCerrar: () => void
}) {
  const metrica = partesMetrica(objetivo.metrica)
  const chip = estado ? ESTADO_CHIP[estado] : undefined
  return (
    <Modal titulo="Detalle del objetivo" abierto={abierto} onCerrar={onCerrar}>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <p className="font-display text-base font-bold leading-snug">{objetivo.titulo}</p>
          {chip && <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${chip.cls}`}>{chip.label}</span>}
        </div>

        <Campo label="Descripción" ancho>
          <span className="whitespace-pre-wrap">{objetivo.descripcion || '—'}</span>
        </Campo>

        <div className="grid gap-3 md:grid-cols-2">
          <Campo label="KPI / indicador">{metrica.kpi || '—'}</Campo>
          <Campo label="Valor objetivo">{metrica.valor || '—'}</Campo>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <Campo label="Fecha meta">{mesLegible(objetivo.metaFecha) || '—'}</Campo>
          <Campo label="Tipo">{objetivo.tipo === 'DESARROLLO' ? 'Desarrollo — profesional' : 'Individual — del negocio'}</Campo>
          <Campo label="Peso en su nota"><b className="text-hunter">{objetivo.peso}%</b></Campo>
        </div>

        <div className="flex justify-end">
          <button type="button" onClick={onCerrar} className="rounded-xl border border-gris-claro px-5 py-2.5 text-[13px] font-bold transition hover:bg-hueso">
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  )
}
