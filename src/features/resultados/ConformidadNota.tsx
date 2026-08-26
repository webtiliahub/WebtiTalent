'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, MessageSquareWarning } from 'lucide-react'
import { Modal } from '@/shared/ui/Modal'
import { toast } from '@/shared/ui/Toast'
import { darConformidadNota, observarNota } from './acciones-conformidad'

/** Decisión del colaborador sobre su nota preliminar (vista previa, pre-cierre):
 * conformidad u observación con comentario. ÚNICA y auditable — no se puede cambiar. */
export function ConformidadNota({ cicloId, estado, fecha, observacion, notaAceptada }: {
  cicloId: string
  estado: 'CONFORME' | 'OBSERVADO' | null
  fecha: string | null
  observacion: string | null
  notaAceptada: number | null
}) {
  const router = useRouter()
  const [modal, setModal] = useState<'conforme' | 'observar' | null>(null)
  const [comentario, setComentario] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  if (estado === 'CONFORME') {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <CheckCircle2 size={16} className="shrink-0" />
        <span><b>Diste conformidad con tu nota{notaAceptada !== null ? ` (${notaAceptada.toFixed(2)})` : ''}</b>{fecha ? ` el ${fecha}` : ''}. Tu decisión quedó registrada.</span>
      </p>
    )
  }
  if (estado === 'OBSERVADO') {
    return (
      <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="flex items-center gap-2 font-bold"><MessageSquareWarning size={16} className="shrink-0" /> Enviaste comentarios sobre tu nota{notaAceptada !== null ? ` (${notaAceptada.toFixed(2)})` : ''}{fecha ? ` el ${fecha}` : ''}</p>
        {observacion && <p className="mt-1.5 whitespace-pre-wrap text-[13px]">“{observacion}”</p>}
        <p className="mt-1.5 text-xs text-amber-800/80">RR.HH. los revisará como insumo del proceso de calibración antes del cierre del ciclo.</p>
      </div>
    )
  }

  function cerrar() {
    setModal(null)
    setError(null)
    setComentario('')
  }

  function confirmarConformidad() {
    setError(null)
    startTransition(async () => {
      const res = await darConformidadNota(cicloId)
      if (!res.ok) setError(res.error)
      else { cerrar(); toast('Conformidad registrada'); router.refresh() }
    })
  }

  function enviarObservacion() {
    setError(null)
    startTransition(async () => {
      const res = await observarNota(cicloId, comentario)
      if (!res.ok) setError(res.error)
      else { cerrar(); toast('Comentarios enviados a RR.HH.'); router.refresh() }
    })
  }

  return (
    <div className="rounded-xl border border-gris-claro bg-white px-4 py-3">
      <p className="text-sm font-bold">¿Estás de acuerdo con tu calificación?</p>
      <p className="mt-0.5 text-xs text-gris">
        Tu respuesta queda registrada para el proceso: si dejas comentarios, llegan a RR.HH. como insumo de la calibración. La decisión es única y no puede cambiarse.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => setModal('conforme')}
          className="rounded-xl bg-emerald-600 px-4 py-2 font-display text-[13px] font-bold text-white shadow-sm transition hover:bg-emerald-700"
        >
          ✓ Dar conformidad
        </button>
        <button
          onClick={() => setModal('observar')}
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 font-display text-[13px] font-bold text-amber-900 transition hover:bg-amber-100"
        >
          Comentarios
        </button>
      </div>

      <Modal titulo="Dar conformidad con tu nota" abierto={modal === 'conforme'} onCerrar={cerrar}>
        <p className="text-sm">Vas a registrar que <b>estás de acuerdo con tu calificación preliminar</b> de este ciclo.</p>
        <p className="mt-2 rounded-lg bg-hueso-2 px-3 py-2 text-xs text-gris">
          Esta decisión es única y quedará como registro auditable del proceso; no podrás cambiarla después.
        </p>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-alerta-dark">{error}</p>}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={cerrar} className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">Cancelar</button>
          <button
            onClick={confirmarConformidad}
            disabled={pendiente}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {pendiente ? 'Registrando…' : 'Confirmar conformidad ✓'}
          </button>
        </div>
      </Modal>

      <Modal titulo="Comentarios sobre tu nota" abierto={modal === 'observar'} onCerrar={cerrar}>
        <p className="text-sm">Comparte tus <b>comentarios sobre tu calificación</b>: llegarán a RR.HH. como insumo del proceso de calibración.</p>
        <textarea
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          rows={4}
          autoFocus
          placeholder="Ej: mi logro del objetivo X quedó registrado en 70% pero la meta acordada con mi jefe se cumplió al 100% según…"
          className="mt-3 w-full rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none transition focus:border-marca"
        />
        <p className="mt-2 rounded-lg bg-hueso-2 px-3 py-2 text-xs text-gris">
          Tus comentarios son únicos y quedarán como registro auditable; no podrás cambiarlos después. El resultado final dependerá de la calibración y el cierre del ciclo.
        </p>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-alerta-dark">{error}</p>}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={cerrar} className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">Cancelar</button>
          <button
            onClick={enviarObservacion}
            disabled={pendiente || comentario.trim().length < 10}
            title={comentario.trim().length < 10 ? 'Escribe al menos 10 caracteres' : undefined}
            className="rounded-xl bg-marca px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pendiente ? 'Enviando…' : 'Enviar comentarios →'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
