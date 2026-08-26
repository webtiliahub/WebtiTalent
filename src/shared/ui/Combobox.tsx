'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Opcion = { id: string; nombre: string; detalle?: string }

/** Quita tildes y baja a minúsculas para buscar sin pelearse con la ortografía. */
function normalizar(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Select con buscador para listas grandes (jefes, áreas, puestos…).
 * Emite el id seleccionado en un input hidden `name`, así funciona igual que un
 * <select> dentro de un <form action={…}>. Teclado: ↑/↓ + Enter, Esc cierra. */
export function Combobox({ name, opciones, valorInicial = '', textoVacio = 'Sin selección', onChange, tamano = 'compacto', buscar }: {
  name: string
  /** Modo local: lista completa que se filtra en el navegador. Omítela con `buscar` (modo async). */
  opciones?: Opcion[]
  valorInicial?: string
  textoVacio?: string
  onChange?: (id: string) => void
  /** `compacto` (por defecto) para tablas de edición inline; `campo` para filtros de página,
   *  donde tiene que medir lo mismo que un <select> o un <input> a su lado. */
  tamano?: 'compacto' | 'campo'
  /** Modo ASÍNCRONO: en vez de recibir el padrón entero (que viajaría al cliente), pide al
   *  servidor ≤N resultados por término. Para listas grandes con datos sensibles (padrón de pares). */
  buscar?: (termino: string) => Promise<Opcion[]>
}) {
  const [valor, setValor] = useState(valorInicial)
  const [texto, setTexto] = useState('')
  const [remotas, setRemotas] = useState<Opcion[]>([])
  const [cargando, setCargando] = useState(false)
  const [abierto, setAbierto] = useState(false)
  const [activo, setActivo] = useState(0)
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxAlto: number }>({ top: 0, left: 0, width: 0, maxAlto: 256 })
  const raiz = useRef<HTMLDivElement>(null)
  const lista = useRef<HTMLUListElement>(null)

  // La lista vive en un PORTAL (body): los contenedores con overflow no la recortan.
  // Se posiciona con coordenadas ABSOLUTAS del documento, no fixed: mientras el teclado
  // de iOS está abierto, Safari congela los elementos fixed contra un viewport que ya no
  // coincide con lo visible y la lista quedaba huérfana arriba. Como contenido absoluto
  // de la página, la lista se mueve JUNTO con el input ante cualquier paneo o scroll.
  // Si no hay espacio abajo, VOLTEA hacia arriba. El espacio se mide contra el
  // visualViewport (el teclado de iOS no cambia window.innerHeight pero sí reduce y
  // desplaza el viewport visual) y la altura de la lista se adapta al espacio real.
  const medir = () => {
    const r = raiz.current?.getBoundingClientRect()
    if (!r) return
    const vv = window.visualViewport
    const vTop = vv?.offsetTop ?? 0
    const vAlto = vv?.height ?? window.innerHeight
    const espacioAbajo = vTop + vAlto - r.bottom - 12
    const espacioArriba = r.top - vTop - 12
    const abreArriba = espacioAbajo < 200 && espacioArriba > espacioAbajo
    const maxAlto = Math.max(150, Math.min(256, abreArriba ? espacioArriba : espacioAbajo))
    // Al voltear hacia arriba se usa la altura REAL ya renderizada de la lista; el primer
    // frame aún no existe (0) y se corrige en el siguiente ciclo del rAF
    const alturaLista = lista.current?.offsetHeight ?? 0
    const nuevo = abreArriba
      ? { top: r.top + window.scrollY - alturaLista - 4, left: r.left + window.scrollX, width: r.width, maxAlto }
      : { top: r.bottom + window.scrollY + 4, left: r.left + window.scrollX, width: r.width, maxAlto }
    // Solo re-renderiza si algo cambió — medir() corre cada frame mientras está abierta
    setPos((p) => (p.top === nuevo.top && p.left === nuevo.left && p.width === nuevo.width && p.maxAlto === nuevo.maxAlto) ? p : nuevo)
  }
  useEffect(() => {
    if (!abierto) return
    // Reanclaje continuo (rAF): al abrir el teclado, iOS panea/desplaza la página en varios
    // pasos asíncronos y los eventos scroll/resize llegan tarde o no llegan — con eventos la
    // lista quedaba huérfana arriba hasta que el usuario desplazaba a mano. Un loop por frame
    // la mantiene pegada al input pase lo que pase; el guard de setPos evita renders de sobra.
    let raf = requestAnimationFrame(function loop() {
      medir()
      raf = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(raf)
  }, [abierto])

  // Si la opción seleccionada desaparece de la lista (p.ej. cambió el filtro de área),
  // el valor efectivo se deriva como vacío — sin efectos ni renders en cascada
  const seleccionada = (buscar ? remotas : (opciones ?? [])).find((o) => o.id === valor)
  const valorEfectivo = seleccionada ? valor : ''

  useEffect(() => {
    // pointerdown y no mousedown: iOS Safari NO dispara eventos de mouse al tocar
    // elementos no interactivos, y la lista quedaba imposible de cerrar tocando fuera
    const fuera = (e: PointerEvent) => {
      const t = e.target as Node
      if (raiz.current && !raiz.current.contains(t) && lista.current && !lista.current.contains(t)) setAbierto(false)
    }
    document.addEventListener('pointerdown', fuera)
    return () => document.removeEventListener('pointerdown', fuera)
  }, [])

  // Modo async: pide al servidor con debounce; el resultado ya viene acotado (≤N)
  useEffect(() => {
    if (!buscar) return
    const q = texto.trim()
    if (q.length < 2) { setRemotas([]); setCargando(false); return }
    setCargando(true)
    let vivo = true
    const id = setTimeout(async () => {
      try {
        const r = await buscar(q)
        if (vivo) setRemotas(r)
      } finally {
        if (vivo) setCargando(false)
      }
    }, 250)
    return () => { vivo = false; clearTimeout(id) }
  }, [texto, buscar])

  const filtradas = useMemo(() => {
    if (buscar) return remotas.slice(0, 60) // ya filtrado en servidor
    const base = opciones ?? []
    const t = normalizar(texto.trim())
    const lista = t ? base.filter((o) => normalizar(o.nombre).includes(t) || (o.detalle && normalizar(o.detalle).includes(t))) : base
    return lista.slice(0, 60)
  }, [texto, opciones, buscar, remotas])

  const elegir = (id: string) => {
    setValor(id)
    setTexto('')
    setAbierto(false)
    onChange?.(id)
  }

  return (
    <div ref={raiz} className="relative">
      <input type="hidden" name={name} value={valorEfectivo} />
      <input
        value={abierto ? texto : (seleccionada?.nombre ?? '')}
        placeholder={abierto ? 'Escribe para buscar…' : textoVacio}
        onFocus={() => { setTexto(''); setActivo(0); setAbierto(true) }}
        // También al tocar el campo YA enfocado: tras elegir una opción la lista se cierra pero
        // el foco se queda dentro, y sin esto el segundo toque en el mismo campo no reabría nada
        onPointerDown={() => { if (!abierto) { setTexto(''); setActivo(0); setAbierto(true) } }}
        onChange={(e) => { setTexto(e.target.value); setActivo(0); setAbierto(true) }}
        onKeyDown={(e) => {
          if (!abierto) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((a) => Math.min(a + 1, filtradas.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); if (filtradas[activo]) elegir(filtradas[activo].id) }
          else if (e.key === 'Escape') setAbierto(false)
        }}
        // 16px en móvil: con fuente <16px iOS hace ZOOM automático al enfocar el input, y ese
        // paneo era lo que descolocaba la lista hacia arriba al abrir el teclado
        // Las dos variantes se escriben COMPLETAS y se elige una: mezclar `rounded-lg` con
        // `rounded-xl` en el mismo atributo no decide nada — gana la que va después en la hoja
        className={`w-full border border-gris-claro bg-white pr-8 text-base outline-none focus:border-marca md:text-sm ${
          tamano === 'campo' ? 'rounded-xl px-3 py-2.5 sm:py-2' : 'rounded-lg px-3 py-1.5'
        } ${seleccionada && !abierto ? '' : 'placeholder:text-gris'}`}
      />
      {seleccionada && !abierto ? (
        <button
          type="button"
          onClick={() => elegir('')}
          title="Quitar selección"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-sm font-bold text-gris hover:text-marca"
        >✕</button>
      ) : (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gris">⌄</span>
      )}

      {abierto && createPortal(
        <ul ref={lista} role="listbox" aria-label={name} style={{ position: 'absolute', top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxAlto }} className="z-50 overflow-y-auto rounded-xl border border-gris-claro bg-white py-1 shadow-xl">
          <li>
            <button type="button" onClick={() => elegir('')} className="w-full px-3 py-1.5 text-left text-sm text-gris hover:bg-hueso">
              {textoVacio}
            </button>
          </li>
          {filtradas.map((o, i) => (
            <li key={o.id} role="option" aria-selected={o.id === valorEfectivo}>
              <button
                type="button"
                onClick={() => elegir(o.id)}
                onMouseEnter={() => setActivo(i)}
                className={`w-full px-3 py-1.5 text-left text-sm transition ${i === activo ? 'bg-hueso' : ''} ${o.id === valorEfectivo ? 'font-bold text-marca' : ''}`}
              >
                {o.nombre}
                {o.detalle && <span className="ml-1.5 text-xs text-gris">{o.detalle}</span>}
              </button>
            </li>
          ))}
          {cargando && <li className="px-3 py-2 text-sm text-gris">Buscando…</li>}
          {!cargando && filtradas.length === 0 && (
            <li className="px-3 py-2 text-sm text-gris">
              {buscar && texto.trim().length < 2 ? 'Escribe al menos 2 letras…' : `Sin coincidencias para “${texto}”`}
            </li>
          )}
          {filtradas.length === 60 && <li className="px-3 py-1.5 text-[11px] text-gris">Mostrando 60 — sigue escribiendo para afinar</li>}
        </ul>,
        document.body,
      )}
    </div>
  )
}
