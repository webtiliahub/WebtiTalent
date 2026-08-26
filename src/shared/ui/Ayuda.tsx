'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle } from 'lucide-react'

/** Signo de interrogación con explicación al hover (o clic/foco, para teclado y táctil).
 * El globo vive en un PORTAL: las Cards tienen overflow-hidden y lo recortarían. */
export function Ayuda({ texto }: { texto: string }) {
  const [abierto, setAbierto] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const icono = useRef<HTMLButtonElement>(null)

  const medir = () => {
    const r = icono.current?.getBoundingClientRect()
    if (!r) return
    // Bajo el icono, sin salirse por los bordes de la ventana (ancho fijo del globo: 300px)
    const left = Math.min(Math.max(8, r.left - 12), Math.max(8, window.innerWidth - 308))
    setPos({ top: r.bottom + 8, left })
  }

  useEffect(() => {
    if (!abierto) return
    medir()
    const cerrar = () => setAbierto(false)
    window.addEventListener('scroll', cerrar, true)
    window.addEventListener('resize', cerrar)
    return () => { window.removeEventListener('scroll', cerrar, true); window.removeEventListener('resize', cerrar) }
  }, [abierto])

  return (
    <>
      <button
        ref={icono}
        type="button"
        aria-label="¿Qué muestra este cuadro?"
        onMouseEnter={() => setAbierto(true)}
        onMouseLeave={() => setAbierto(false)}
        onFocus={() => setAbierto(true)}
        onBlur={() => setAbierto(false)}
        onClick={() => setAbierto((v) => !v)}
        className="inline-grid h-5 w-5 place-items-center rounded-full text-gris transition hover:text-negro focus:outline-none focus-visible:ring-1 focus-visible:ring-marca"
      >
        <HelpCircle size={14} />
      </button>
      {abierto && createPortal(
        <div
          role="tooltip"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: 300, zIndex: 60 }}
          className="rounded-xl border border-gris-claro bg-negro px-3.5 py-2.5 text-xs font-normal normal-case leading-relaxed text-white shadow-xl"
        >
          {texto}
        </div>,
        document.body,
      )}
    </>
  )
}
