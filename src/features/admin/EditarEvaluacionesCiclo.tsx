'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { editarEvaluacionesCiclo } from './acciones'
import { SelectorEvaluaciones, type NivelW } from './WizardCiclo'
import { Modal } from '@/shared/ui/Modal'
import { toast } from '@/shared/ui/Toast'

/** Edición del set de evaluaciones de un ciclo EN BORRADOR: mismo selector del wizard,
 * precargado con las evaluaciones actuales. Al guardar se re-copia el snapshot de preguntas. */
export function EditarEvaluacionesCiclo({ cicloId, niveles, porNivelInicial, porPuestoInicial }: {
  cicloId: string
  niveles: NivelW[]
  porNivelInicial: Record<string, string>
  porPuestoInicial: Record<string, string>
}) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [porNivel, setPorNivel] = useState<Record<string, string>>(porNivelInicial)
  const [porPuesto, setPorPuesto] = useState<Record<string, string>>(porPuestoInicial)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  const evaluacionIds = [...Object.values(porNivel), ...Object.values(porPuesto)].filter(Boolean)

  function cerrar() {
    setAbierto(false)
    setError(null)
    setPorNivel(porNivelInicial)
    setPorPuesto(porPuestoInicial)
  }

  function guardar() {
    setError(null)
    startTransition(async () => {
      const res = await editarEvaluacionesCiclo(cicloId, evaluacionIds)
      if (!res.ok) setError(res.error)
      else { setAbierto(false); toast('Evaluaciones del ciclo actualizadas'); router.refresh() }
    })
  }

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className="rounded-xl border border-gris-claro px-4 py-2 text-xs font-bold transition hover:border-marca hover:text-marca"
      >
        ✎ Editar evaluaciones
      </button>

      <Modal titulo="Editar las evaluaciones del ciclo" abierto={abierto} onCerrar={cerrar}>
        <p className="mb-4 rounded-xl bg-hueso-2 px-4 py-2.5 text-xs leading-relaxed text-gris">
          El ciclo está en <b className="text-negro">borrador</b>: puedes cambiar qué evaluación aplica cada nivel
          (y las excepciones por puesto). Al guardar, las preguntas se vuelven a copiar al ciclo desde el catálogo
          y la verificación de lanzamiento se recalcula.
        </p>
        <div className="space-y-3">
          {/* Sin preview de alcance en este modal (no es el wizard): usa los totales del nivel. */}
          <SelectorEvaluaciones niveles={niveles} porNivel={porNivel} setPorNivel={setPorNivel} porPuesto={porPuesto} setPorPuesto={setPorPuesto} conteos={undefined} />
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-alerta-dark">{error}</p>}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={cerrar} className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">Cancelar</button>
          <button
            onClick={guardar}
            disabled={pendiente || evaluacionIds.length === 0}
            className="rounded-xl bg-marca px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark disabled:opacity-60"
          >
            {pendiente ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </Modal>
    </>
  )
}
