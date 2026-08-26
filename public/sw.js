// Service worker mínimo de Hunter 360: precachea el cascarón y muestra /offline cuando
// una NAVEGACIÓN falla por red. Prohibido cachear API o datos de negocio (spec 2026-08-10).
const CACHE = 'hunter360-v4' // v4: handlers de Web Push (sub-proyecto B)
const CASCARON = ['/offline', '/iconos/icon-192.png', '/iconos/icon-512.png', '/logo/hunter-iso-red.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCARON)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  // El cascarón se sirve cache-first: sin esta rama el precache jamás se lee y /offline
  // queda sin logo/iconos justo cuando no hay red
  if (e.request.method === 'GET' && url.origin === self.location.origin && CASCARON.includes(url.pathname)) {
    e.respondWith(caches.match(url.pathname).then((r) => r ?? fetch(e.request)))
    return
  }
  if (e.request.mode !== 'navigate') return
  e.respondWith(fetch(e.request).catch(() => caches.match('/offline')))
})

// ───────────────────────── Web Push ─────────────────────────
// El payload trae { titulo, cuerpo, ruta, etiqueta }. Nunca datos sensibles: la notificación
// pasa por servidores de Apple/Google y puede quedar visible en la pantalla de bloqueo.
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = {} }
  const titulo = d.titulo || 'Hunter 360'
  e.waitUntil(self.registration.showNotification(titulo, {
    body: d.cuerpo || '',
    icon: '/iconos/icon-192.png',
    badge: '/iconos/icon-192.png',
    // Misma etiqueta = el aviso nuevo REEMPLAZA al anterior en la bandeja, en vez de apilar
    tag: d.etiqueta || 'hunter360',
    renotify: Boolean(d.etiqueta),
    data: { ruta: d.ruta || '/' },
  }))
})

// Al tocar la notificación: si ya hay una ventana de la app abierta se reutiliza (y se navega
// a la ruta del aviso); si no, se abre una nueva. Sin esto iOS abre siempre la raíz.
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const ruta = (e.notification.data && e.notification.data.ruta) || '/'
  e.waitUntil((async () => {
    const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of clientes) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.navigate(ruta).catch(() => {})
        return c.focus()
      }
    }
    return self.clients.openWindow(ruta)
  })())
})

// El navegador puede rotar la suscripción por su cuenta: hay que reenviarla o el push muere
// en silencio.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    const nueva = e.newSubscription ?? await self.registration.pushManager.subscribe(e.oldSubscription?.options)
    if (!nueva) return
    await fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nueva.toJSON()),
    }).catch(() => {})
  })())
})
