'use client'

import { useEffect } from 'react'

/** Modal centrado con overlay; cierra con ✕, clic fuera o Escape.
 * `hoja`: en móvil ocupa la pantalla completa (formularios largos — el modal flotante
 * deja bordes apretados y el teclado lo descuadra); en escritorio no cambia. */
export function Modal({ titulo, abierto, onCerrar, children, hoja = false, amplio = false }: {
  titulo: React.ReactNode
  abierto: boolean
  onCerrar: () => void
  children: React.ReactNode
  hoja?: boolean
  /** Diálogo ancho en escritorio (max-w-4xl) para formularios densos — p.ej. los 5 descriptores BARS. En móvil no cambia nada. */
  amplio?: boolean
}) {
  useEffect(() => {
    if (!abierto) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [abierto, onCerrar])

  if (!abierto) return null
  return (
    // Móvil (modo normal): HOJA desde abajo con asa — mismo lenguaje que los pop-ups de
    // colaborador; escritorio: diálogo centrado de siempre. `hoja` sigue siendo pantalla
    // completa en móvil para formularios largos.
    // `grid-cols-1`: sin columna explícita, el track del grid se dimensiona al MAX-CONTENT del
    // panel y el `w-full` del hijo pasa a ser 100% de ese track — un modal cuyo contenido es
    // intrínsecamente angosto (p.ej. textareas) colapsaba a ~340px en vez de llegar a su max-w.
    <div className={`fixed inset-0 z-50 bg-negro/40 ${hoja ? 'grid grid-cols-1 place-items-center p-0 md:p-4' : 'flex items-end justify-center md:grid md:grid-cols-1 md:place-items-center md:p-4'}`} onClick={onCerrar} role="dialog" aria-modal="true">
      <div
        className={`w-full ${amplio ? 'max-w-2xl md:max-w-4xl' : 'max-w-2xl'} overflow-y-auto bg-white shadow-2xl ${hoja
          ? 'h-dvh max-h-dvh rounded-none p-5 pt-4 md:h-auto md:max-h-[90vh] md:rounded-2xl md:p-6'
          : 'max-h-[90dvh] rounded-t-2xl p-5 pb-6 pt-3 md:max-h-[90vh] md:rounded-2xl md:p-6'}`}
        style={hoja ? { paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {!hoja && <div className="mx-auto mb-2.5 h-1 w-9 rounded-full bg-gris-claro md:hidden" />}
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 className="font-display text-base font-bold">{titulo}</h3>
          <button onClick={onCerrar} title="Cerrar" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-gris transition hover:bg-hueso hover:text-negro">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
