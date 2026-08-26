'use client'

import { useEffect } from 'react'

/** Registra el service worker SOLO en producción (en dev estorba con HMR). */
export function RegistrarSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])
  return null
}
