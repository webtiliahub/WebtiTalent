'use client'

import { useState, useTransition } from 'react'
import { Trash2, Undo2 } from 'lucide-react'
import { eliminarObjetivo, desaprobarObjetivo } from './acciones'
import { confirmar } from '@/shared/ui/Confirmacion'
import { toast } from '@/shared/ui/Toast'

/** Papelera para que el dueño elimine un objetivo aún no aprobado y pueda volver a crearlo. */
export function BotonEliminarObjetivo({ objetivoId, titulo }: { objetivoId: string; titulo: string }) {
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  return (
    <span className="flex flex-col items-end gap-1 self-center">
      <button
        type="button"
        disabled={pendiente}
        title="Eliminar este objetivo (podrás volver a crearlo mientras la carga siga abierta)"
        onClick={async () => {
          if (!(await confirmar(`¿Eliminar "${titulo}"? Podrás volver a crearlo mientras la carga siga abierta.`, { titulo: 'Eliminar objetivo', textoAceptar: 'Eliminar' }))) return
          setError(null)
          startTransition(async () => {
            const res = await eliminarObjetivo(objetivoId)
            if (!res.ok) setError(res.error)
            else toast('Objetivo eliminado: puedes volver a crearlo')
          })
        }}
        className="rounded-lg border border-gris-claro p-2 text-gris transition hover:border-marca hover:text-marca disabled:opacity-50"
      >
        <Trash2 size={14} />
      </button>
      {error && <span className="max-w-52 text-right text-[11px] text-marca-dark">{error}</span>}
    </span>
  )
}

/** El jefe devuelve un objetivo aprobado a propuesto para que el colaborador pueda modificarlo. */
export function BotonDesaprobar({ objetivoId, titulo }: { objetivoId: string; titulo: string }) {
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pendiente}
        title="Devolver a propuesto para que pueda modificarse"
        onClick={async () => {
          if (!(await confirmar(`¿Devolver "${titulo}" a propuesto? Dejará de contar como aprobado hasta que lo vuelvas a aprobar.`, { titulo: 'Devolver a propuesto', textoAceptar: 'Devolver' }))) return
          setError(null)
          startTransition(async () => {
            const res = await desaprobarObjetivo(objetivoId)
            if (!res.ok) setError(res.error)
            else toast('Objetivo devuelto a propuesto')
          })
        }}
        className="flex items-center gap-1.5 rounded-lg border border-gris-claro px-2.5 py-1.5 text-[11px] font-bold text-gris transition hover:border-marca hover:text-marca disabled:opacity-50"
      >
        <Undo2 size={12} /> Devolver a propuesto
      </button>
      {error && <span className="max-w-52 text-right text-[11px] text-marca-dark">{error}</span>}
    </span>
  )
}
