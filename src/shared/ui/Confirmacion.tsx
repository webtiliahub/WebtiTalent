'use client'

import { useEffect, useState } from 'react'

type Solicitud = {
  mensaje: string
  titulo?: string
  textoAceptar?: string
  resolver: (ok: boolean) => void
}

let solicitar: ((s: Solicitud) => void) | null = null

/** Reemplazo del confirm() nativo: abre un popup con el estilo de la plataforma y
 * resuelve true/false. Requiere <ConfirmacionHost /> montado en el layout. */
export function confirmar(mensaje: string, opts?: { titulo?: string; textoAceptar?: string }): Promise<boolean> {
  return new Promise((resolver) => {
    if (!solicitar) {
      resolver(window.confirm(mensaje))
      return
    }
    solicitar({ mensaje, ...opts, resolver })
  })
}

/** Host único del popup de confirmación (va en el layout de la app).
 * Va por encima de los modales (z-60) porque una confirmación puede abrirse desde dentro de uno. */
export function ConfirmacionHost() {
  const [solicitud, setSolicitud] = useState<Solicitud | null>(null)

  useEffect(() => {
    solicitar = (s) => setSolicitud(s)
    return () => { solicitar = null }
  }, [])

  useEffect(() => {
    if (!solicitud) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') responder(false) }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solicitud])

  function responder(ok: boolean) {
    solicitud?.resolver(ok)
    setSolicitud(null)
  }

  if (!solicitud) return null
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-negro/40 p-4" onClick={() => responder(false)} role="alertdialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-base font-bold">{solicitud.titulo ?? 'Confirmar acción'}</h3>
        <p className="mt-2.5 text-sm leading-relaxed text-negro/80">{solicitud.mensaje}</p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => responder(false)}
            className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro"
          >
            Cancelar
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => responder(true)}
            className="rounded-xl bg-marca px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark"
          >
            {solicitud.textoAceptar ?? 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
