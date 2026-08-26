'use client'

import { useEffect, useState } from 'react'

type Tono = 'ok' | 'error'
type ToastItem = { id: number; mensaje: string; tono: Tono }

let emitir: ((mensaje: string, tono: Tono) => void) | null = null

/** Confirmación breve al pie de la pantalla (estilo del mockup). Requiere <ToastHost /> en el layout. */
export function toast(mensaje: string, tono: Tono = 'ok') {
  emitir?.(mensaje, tono)
}

const DURACION = 3500

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    let n = 0
    emitir = (mensaje, tono) => {
      const id = ++n
      setItems((xs) => [...xs, { id, mensaje, tono }])
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), DURACION)
    }
    return () => { emitir = null }
  }, [])

  if (items.length === 0) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-8 z-[80] flex flex-col items-center gap-2 px-4">
      {items.map((t) => <Pildora key={t.id} item={t} />)}
    </div>
  )
}

function Pildora({ item }: { item: ToastItem }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const entrada = requestAnimationFrame(() => setVisible(true))
    const salida = setTimeout(() => setVisible(false), DURACION - 350)
    return () => { cancelAnimationFrame(entrada); clearTimeout(salida) }
  }, [])

  return (
    <div
      role="status"
      className={`rounded-full px-6 py-3 font-display text-sm font-bold text-white shadow-xl transition-all duration-300 ease-out ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
      } ${item.tono === 'ok' ? 'bg-emerald-600' : 'bg-alerta'}`}
    >
      {item.tono === 'ok' ? '✓ ' : '✕ '}{item.mensaje}
    </div>
  )
}
