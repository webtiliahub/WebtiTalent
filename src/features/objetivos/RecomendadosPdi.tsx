'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { ModalProponer, type PrellenadoObjetivo } from './FormProponer'

export type AccionPdi = { titulo: string; fechaObjetivo?: string }

const MESES: Record<string, string> = {
  ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
  jul: '07', ago: '08', sep: '09', set: '09', oct: '10', nov: '11', dic: '12',
}

/** Intenta convertir la fecha libre del PDI ("dic-2026", "diciembre 2026", "2026-12")
 * al formato del input type=month; si no se entiende, el campo queda por llenar. */
function aMes(texto?: string): string | undefined {
  if (!texto) return undefined
  const t = texto.trim().toLowerCase()
  const iso = t.match(/^(\d{4})-(\d{2})$/)
  if (iso) return t
  const m = t.match(/^([a-záéíóú]+)[-\s/]+(\d{4})$/)
  const mes = m && MESES[m[1].slice(0, 3)]
  return mes ? `${m![2]}-${mes}` : undefined
}

/** Acciones del plan de desarrollo de la última sesión de feedback, ofrecidas como
 * recomendación durante la carga de objetivos: un clic abre la propuesta pre-llenada
 * (título + tipo Desarrollo + fecha meta si se puede interpretar). */
export function RecomendadosPdi({ periodoId, disponible, origen, acciones }: {
  periodoId: string
  disponible: number
  origen: string // nombre del ciclo del que salió el PDI
  acciones: AccionPdi[]
}) {
  const [prellenado, setPrellenado] = useState<PrellenadoObjetivo | null>(null)

  return (
    <div className="rounded-2xl border border-dashed border-hunter/35 bg-hunter/[0.03] p-5">
      <p className="flex items-center gap-1.5 text-sm font-bold">
        <Sparkles size={14} className="text-hunter" /> Recomendados de tu plan de desarrollo
      </p>
      <p className="mt-0.5 text-xs text-gris">
        Tu jefe registró {acciones.length === 1 ? 'este desafío' : 'estos desafíos'} en la sesión de feedback de <b className="text-negro">{origen}</b>. Puedes proponerlos como objetivos de desarrollo de este período.
      </p>
      <ul className="mt-3 space-y-2">
        {acciones.map((a) => (
          <li key={a.titulo} className="flex flex-wrap items-center gap-3 rounded-xl bg-white px-4 py-2.5 shadow-sm">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{a.titulo}</p>
              {a.fechaObjetivo && <p className="text-[11px] text-gris">fecha sugerida · {a.fechaObjetivo}</p>}
            </div>
            <button
              onClick={() => setPrellenado({ titulo: a.titulo, tipo: 'DESARROLLO', metaFecha: aMes(a.fechaObjetivo) })}
              disabled={disponible <= 0}
              title={disponible <= 0 ? 'Ya no tienes peso disponible: tus objetivos suman 100%' : undefined}
              className="rounded-lg border border-hunter/40 px-3 py-1.5 text-xs font-bold text-hunter transition hover:bg-hunter hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Proponer como objetivo →
            </button>
          </li>
        ))}
      </ul>
      <ModalProponer
        periodoId={periodoId}
        disponible={disponible}
        abierto={prellenado !== null}
        onCerrar={() => setPrellenado(null)}
        prellenado={prellenado ?? undefined}
      />
    </div>
  )
}
