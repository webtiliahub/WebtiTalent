'use client'

import { useEffect, useState } from 'react'

const CLAVE = 'hunter-banner-instalar'
const HORAS_DESCARTE = 24

type EventoInstalar = Event & { prompt: () => Promise<void> }

/** Banner de instalación de la PWA (solo móvil, descartable 24 horas, nunca en standalone):
 * Android/Chrome dispara el prompt nativo; iOS muestra la guía manual. */
export function BannerInstalar() {
  const [evento, setEvento] = useState<EventoInstalar | null>(null)
  const [modo, setModo] = useState<'oculto' | 'android' | 'ios'>('oculto')

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone
    if (standalone) return
    // Solo dispositivos táctiles reales: en una computadora con la ventana angosta el ancho
    // activa la vista móvil, pero ahí el banner de instalación no aporta y estorba
    if (navigator.maxTouchPoints === 0) return
    const descartado = localStorage.getItem(CLAVE)
    if (descartado && Date.now() - Number(descartado) < HORAS_DESCARTE * 3600000) return
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) { setModo('ios'); return }
    const alPrompt = (e: Event) => { e.preventDefault(); setEvento(e as EventoInstalar); setModo('android') }
    window.addEventListener('beforeinstallprompt', alPrompt)
    return () => window.removeEventListener('beforeinstallprompt', alPrompt)
  }, [])

  if (modo === 'oculto') return null

  const cerrar = () => { localStorage.setItem(CLAVE, String(Date.now())); setModo('oculto') }

  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl border border-gris-claro bg-white px-3.5 py-2.5 md:hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/iconos/icon-192.png" alt="" className="h-8 w-8 rounded-lg" />
      <p className="flex-1 text-xs font-semibold leading-snug">
        {modo === 'android'
          ? 'Instala Talent Hub en tu pantalla de inicio'
          : 'Instálala: toca Compartir y elige “Añadir a pantalla de inicio”'}
      </p>
      {modo === 'android' && (
        <button onClick={async () => { await evento?.prompt(); cerrar() }}
          className="rounded-xl bg-hunter px-3 py-1.5 text-xs font-bold text-white">Instalar</button>
      )}
      <button onClick={cerrar} aria-label="Descartar" className="px-1 text-sm font-bold text-gris">✕</button>
    </div>
  )
}
