'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'

type Opcion = { id: string; nombre: string }

/** Quita tildes y baja a minúsculas para filtrar sin pelearse con la ortografía. */
function normalizar(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Dropdown de selección múltiple con checkboxes. Sin selección = textoVacio.
 * El panel se renderiza en un portal para no quedar recortado por contenedores con overflow (modales, tablas). */
export function SelectorMultiple({ etiqueta, opciones, seleccion, onCambio, textoVacio = 'Todos', etiquetaOculta = false }: {
  etiqueta: string
  opciones: Opcion[]
  seleccion: string[]
  onCambio: (ids: string[]) => void
  textoVacio?: string
  /** Oculta el rótulo VISIBLE (sigue siendo el `aria-label` y el placeholder del buscador):
   * junto a selects sin rótulo, el título de encima empuja el control hacia abajo y lo
   * desalinea, y con un textoVacio como «Todas las áreas» ya se sabe qué se está filtrando. */
  etiquetaOculta?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [rect, setRect] = useState<{ top: number; left: number; width: number; maxAlto: number } | null>(null)
  const botonRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Mismo posicionamiento que el Combobox: coordenadas ABSOLUTAS del documento (con scrollY/
  // scrollX), NO fixed. Con el teclado de iOS abierto, Safari congela los elementos fixed
  // contra un viewport desfasado y el panel se iba arriba; como contenido absoluto de la
  // página se mueve JUNTO con el campo ante cualquier paneo. El espacio se mide contra el
  // visualViewport (el teclado no cambia innerHeight pero sí el viewport visual) y si no hay
  // sitio abajo VOLTEA hacia arriba usando la altura real ya renderizada del panel.
  function medir() {
    const r = botonRef.current?.getBoundingClientRect()
    if (!r) return
    const vv = window.visualViewport
    const vTop = vv?.offsetTop ?? 0
    const vAlto = vv?.height ?? window.innerHeight
    // Ancho propio (mínimo 280px) sin heredar el del trigger, sin salirse por la derecha
    const ancho = Math.max(r.width, 280)
    const left = Math.min(r.left, Math.max(8, window.innerWidth - ancho - 8)) + window.scrollX
    const espacioAbajo = vTop + vAlto - r.bottom - 12
    const espacioArriba = r.top - vTop - 12
    const abreArriba = espacioAbajo < 220 && espacioArriba > espacioAbajo
    const maxAlto = Math.max(160, Math.min(384, abreArriba ? espacioArriba : espacioAbajo))
    const alturaPanel = panelRef.current?.offsetHeight ?? 0
    const top = abreArriba
      ? r.top + window.scrollY - alturaPanel - 6
      : r.bottom + window.scrollY + 6
    const nuevo = { top, left, width: ancho, maxAlto }
    setRect((p) => (p && p.top === nuevo.top && p.left === nuevo.left && p.width === nuevo.width && p.maxAlto === nuevo.maxAlto) ? p : nuevo)
  }

  function abrir() {
    if (abierto || !botonRef.current) return
    medir()
    setFiltro('')
    setAbierto(true)
  }

  useEffect(() => {
    if (!abierto) return
    // pointerdown y no mousedown: iOS Safari NO dispara eventos de mouse al tocar
    // elementos no interactivos, y el panel quedaba imposible de cerrar tocando fuera
    const fuera = (e: PointerEvent) => {
      const t = e.target as Node
      if (!botonRef.current?.contains(t) && !panelRef.current?.contains(t)) setAbierto(false)
    }
    // Captura el Escape ANTES que el Modal contenedor: cierra solo el panel, no el modal
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setAbierto(false) }
    }
    document.addEventListener('keydown', esc, true)
    document.addEventListener('pointerdown', fuera)
    // Reanclaje continuo por frame: al abrir el teclado iOS panea/desplaza la página en
    // pasos asíncronos; con listeners de scroll/resize el panel quedaba desfasado o se
    // cerraba. El loop lo mantiene pegado al trigger; el guard de setRect evita renders de más.
    let raf = requestAnimationFrame(function loop() {
      medir()
      raf = requestAnimationFrame(loop)
    })
    return () => {
      document.removeEventListener('pointerdown', fuera)
      document.removeEventListener('keydown', esc, true)
      cancelAnimationFrame(raf)
    }
  }, [abierto])

  const nombres = opciones.filter((o) => seleccion.includes(o.id)).map((o) => o.nombre)
  const resumen = nombres.length === 0 ? textoVacio : nombres.length <= 2 ? nombres.join(', ') : `${nombres.length} seleccionados`

  return (
    <div>
      {!etiquetaOculta && <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gris">{etiqueta}</span>}
      <div ref={botonRef} className="relative">
        {/* Disparador de SOLO LECTURA: tocarlo abre el panel SIN invocar el teclado — un input
            editable hacía que iOS enfocara, abriera el teclado y empujara toda la hoja hacia
            arriba. La búsqueda vive dentro del panel (ver abajo). */}
        <button
          type="button"
          onClick={() => (abierto ? setAbierto(false) : abrir())}
          // El nombre accesible vive aquí, no solo en el panel: sin rótulo visible
          // (`etiquetaOculta`) el control se quedaba sin nombre para un lector de pantalla
          aria-label={etiqueta}
          aria-haspopup="listbox"
          aria-expanded={abierto}
          className={`flex w-full items-center justify-between rounded-xl border border-gris-claro bg-hueso py-2.5 pl-3.5 pr-2.5 text-left text-sm outline-none transition focus:border-marca ${nombres.length === 0 ? 'text-gris' : 'font-semibold text-negro'}`}
        >
          <span className="truncate">{resumen}</span>
          <ChevronDown size={15} className={`shrink-0 text-gris transition-transform ${abierto ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {abierto && rect && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'absolute', top: rect.top, left: rect.left, width: rect.width, maxHeight: rect.maxAlto }}
          className="z-[60] flex flex-col rounded-xl border border-gris-claro bg-white p-1.5 shadow-lg"
          role="listbox"
          aria-multiselectable="true"
          aria-label={etiqueta}
        >
          {/* Buscador dentro del panel: solo para listas largas (puestos, áreas). El teclado
              que abre no descoloca nada porque el panel ya está anclado y se re-mide por frame,
              volteando hacia arriba si el teclado no deja espacio abajo. */}
          {opciones.length > 8 && (
            <input
              type="text"
              autoFocus
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder={`Buscar en ${etiqueta.toLowerCase()}…`}
              className="mb-1 shrink-0 rounded-lg border border-gris-claro bg-white px-2.5 py-2 text-base outline-none focus:border-marca md:text-sm"
            />
          )}
          <div className="min-h-0 overflow-y-auto">
            {opciones
              .filter((o) => !filtro || normalizar(o.nombre).includes(normalizar(filtro)))
              .map((o) => {
                const activa = seleccion.includes(o.id)
                return (
                  <label key={o.id} role="option" aria-selected={activa} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition hover:bg-hueso">
                    <input
                      type="checkbox"
                      checked={activa}
                      onChange={() => onCambio(activa ? seleccion.filter((x) => x !== o.id) : [...seleccion, o.id])}
                      className="h-4 w-4 shrink-0 accent-[#0067ff]"
                    />
                    {o.nombre}
                  </label>
                )
              })}
            {filtro && opciones.every((o) => !normalizar(o.nombre).includes(normalizar(filtro))) && (
              <p className="px-2.5 py-2 text-sm text-gris">Sin coincidencias para “{filtro}”</p>
            )}
          </div>
          {/* Pie fijo: cerrar sin buscar hueco libre (el panel tapaba botones del formulario) */}
          <div className="mt-1 flex shrink-0 items-center justify-between gap-2 border-t border-hueso-2 pt-1">
            {seleccion.length > 0 ? (
              <button type="button" onClick={() => onCambio([])} className="rounded-lg px-2.5 py-1.5 text-left text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">
                Limpiar selección ({seleccion.length})
              </button>
            ) : <span />}
            <button type="button" onClick={() => setAbierto(false)} className="rounded-lg bg-hueso-2 px-3 py-1.5 text-xs font-bold transition hover:bg-hueso">
              Listo ✓
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
