'use client'

import { useEffect, useRef, useState } from 'react'
import { signOut } from 'next-auth/react'
import { confirmar } from './Confirmacion'
import { InterruptorNotificaciones } from './InterruptorNotificaciones'

/** Menú del avatar en la topbar móvil: identidad, selector de país (solo RR.HH. Regional)
 * y cierre de sesión SIEMPRE con confirmación (decisión de producto). */
export function MenuAvatar({ nombre, rolLabel, paises, paisActual, esRrhhRegional }: {
  nombre: string
  rolLabel: string
  paises: { id: string; codigo: string; nombre: string }[]
  paisActual: string | null
  esRrhhRegional: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)
  const iniciales = nombre.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()

  useEffect(() => {
    const fuera = (e: MouseEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [])

  // Mismo endpoint que usa el selector de escritorio en Shell.tsx
  async function cambiarPais(paisId: string) {
    await fetch('/api/preferencias/pais', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paisId: paisId || null }),
    })
    window.location.reload()
  }

  async function salir() {
    if (await confirmar('¿Cerrar tu sesión?', { titulo: 'Cerrar sesión', textoAceptar: 'Cerrar sesión' })) {
      signOut({ callbackUrl: '/login' })
    }
  }

  return (
    <div ref={raiz} className="relative">
      <button onClick={() => setAbierto((v) => !v)} aria-label="Mi cuenta"
        className="grid h-9 w-9 place-items-center rounded-full bg-hunter font-display text-xs font-extrabold text-white">
        {iniciales}
      </button>
      {abierto && (
        <div className="absolute right-0 top-11 z-50 w-64 rounded-2xl border border-gris-claro bg-white p-4 shadow-xl">
          <p className="text-sm font-bold">{nombre}</p>
          <p className="text-[11px] text-gris">{rolLabel}</p>
          {esRrhhRegional && (
            <select value={paisActual ?? ''} onChange={(e) => cambiarPais(e.target.value)}
              className="mt-3 w-full rounded-xl border border-gris-claro bg-hueso px-3 py-2 text-xs font-semibold outline-none">
              <option value="">Todos los países</option>
              {paises.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          )}
          <InterruptorNotificaciones />
          <button onClick={salir}
            className="mt-3 w-full rounded-xl border border-gris-claro px-3 py-2 text-left text-[13px] font-bold text-hunter transition hover:bg-red-50">
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  )
}
