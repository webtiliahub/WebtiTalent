'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'

/**
 * Interruptor de notificaciones push, para el menú del avatar.
 *
 * Reglas del terreno, que condicionan todo lo que se ve aquí:
 *  - **iOS solo permite Web Push si la PWA está instalada** en la pantalla de inicio. Desde
 *    Safari el permiso ni se puede pedir, así que en ese caso se explica en vez de ofrecer un
 *    botón que no haría nada.
 *  - El permiso se pide **desde un gesto del usuario**: nunca al montar.
 *  - Si el usuario ya dijo «no» a nivel de sistema, no hay forma de volver a preguntar desde la
 *    web: solo queda decirle dónde reactivarlo.
 */

type Estado = 'cargando' | 'sin-soporte' | 'requiere-instalar' | 'bloqueado' | 'apagado' | 'encendido' | 'no-configurado'

/** El navegador entrega la clave VAPID en base64url; `subscribe` la quiere en bytes. */
function base64UrlABytes(base64: string): Uint8Array {
  const relleno = '='.repeat((4 - (base64.length % 4)) % 4)
  const normal = (base64 + relleno).replace(/-/g, '+').replace(/_/g, '/')
  const crudo = atob(normal)
  return Uint8Array.from([...crudo].map((c) => c.charCodeAt(0)))
}

function esStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

function esIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function InterruptorNotificaciones() {
  const [estado, setEstado] = useState<Estado>('cargando')
  const [trabajando, setTrabajando] = useState(false)
  const [clavePublica, setClavePublica] = useState<string | null>(null)
  const [prueba, setPrueba] = useState<'idle' | 'enviando' | 'ok' | 'error'>('idle')

  useEffect(() => {
    let vivo = true
    ;(async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        // iOS sin instalar no expone PushManager: eso es «instálala», no «tu equipo no puede»
        if (vivo) setEstado(esIOS() && !esStandalone() ? 'requiere-instalar' : 'sin-soporte')
        return
      }
      const res = await fetch('/api/push').then((r) => r.json()).catch(() => null)
      if (!vivo) return
      if (!res?.disponible || !res?.clavePublica) { setEstado('no-configurado'); return }
      setClavePublica(res.clavePublica)
      if (Notification.permission === 'denied') { setEstado('bloqueado'); return }
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      if (vivo) setEstado(sub ? 'encendido' : 'apagado')
    })()
    return () => { vivo = false }
  }, [])

  async function encender() {
    if (!clavePublica) return
    setTrabajando(true)
    try {
      const permiso = await Notification.requestPermission()
      if (permiso !== 'granted') { setEstado(permiso === 'denied' ? 'bloqueado' : 'apagado'); return }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true, // obligatorio en Chrome: todo push muestra notificación
        applicationServerKey: base64UrlABytes(clavePublica) as BufferSource,
      })
      const r = await fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      if (!r.ok) { await sub.unsubscribe(); setEstado('apagado'); return }
      setEstado('encendido')
    } catch {
      setEstado('apagado')
    } finally {
      setTrabajando(false)
    }
  }

  async function apagar() {
    setTrabajando(true)
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        // Primero se borra en el servidor: si se pierde el endpoint, quedaría un zombi
        await fetch('/api/push', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {})
        await sub.unsubscribe().catch(() => {})
      }
      setEstado('apagado')
    } finally {
      setTrabajando(false)
    }
  }

  async function enviarPrueba() {
    setPrueba('enviando')
    const r = await fetch('/api/push/prueba', { method: 'POST' }).then((x) => x.json()).catch(() => null)
    setPrueba(r?.ok ? 'ok' : 'error')
    setTimeout(() => setPrueba('idle'), 4000)
  }

  if (estado === 'cargando' || estado === 'sin-soporte' || estado === 'no-configurado') return null

  const marco = 'mt-3 w-full rounded-xl border px-3 py-2 text-left text-[13px]'

  if (estado === 'requiere-instalar') {
    return (
      <p className={`${marco} border-gris-claro bg-hueso text-gris`}>
        <span className="flex items-center gap-1.5 font-bold text-negro"><Bell size={13} />Notificaciones</span>
        <span className="mt-0.5 block text-[11.5px]">Para recibirlas en el iPhone, agrega la app a tu pantalla de inicio: Compartir → «Añadir a inicio».</span>
      </p>
    )
  }

  if (estado === 'bloqueado') {
    return (
      <p className={`${marco} border-gris-claro bg-hueso text-gris`}>
        <span className="flex items-center gap-1.5 font-bold text-negro"><BellOff size={13} />Notificaciones bloqueadas</span>
        <span className="mt-0.5 block text-[11.5px]">Las rechazaste en este dispositivo. Se reactivan desde los ajustes del sistema, en las notificaciones de Talent Hub.</span>
      </p>
    )
  }

  const encendido = estado === 'encendido'
  const interruptor = (
    <button
      onClick={encendido ? apagar : encender}
      disabled={trabajando}
      aria-pressed={encendido}
      className={`${marco} flex items-center justify-between gap-3 font-bold transition disabled:opacity-50 ${
        encendido ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800' : 'border-gris-claro hover:bg-hueso'
      }`}
    >
      <span className="flex items-center gap-1.5">
        {encendido ? <Bell size={13} /> : <BellOff size={13} />}
        Notificaciones
      </span>
      <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-extrabold uppercase ${encendido ? 'bg-emerald-100 text-emerald-800' : 'bg-hueso-2 text-gris'}`}>
        {trabajando ? '…' : encendido ? 'activas' : 'activar'}
      </span>
    </button>
  )

  // Con las notificaciones activas, una prueba a este mismo dispositivo: comprueba la cadena
  // completa (permiso → suscripción → VAPID → Apple/Google → service worker) de un toque
  return (
    <>
      {interruptor}
      {encendido && (
        <button
          onClick={enviarPrueba}
          disabled={prueba === 'enviando'}
          className="mt-1.5 w-full rounded-xl px-3 py-1.5 text-left text-[11.5px] font-semibold text-gris transition hover:bg-hueso disabled:opacity-50"
        >
          {prueba === 'enviando' ? 'Enviando prueba…'
            : prueba === 'ok' ? 'Prueba enviada: revisa tus notificaciones'
            : prueba === 'error' ? 'No se pudo enviar la prueba'
            : 'Enviar una notificación de prueba'}
        </button>
      )}
    </>
  )
}
