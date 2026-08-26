import { NextResponse } from 'next/server'
import { prisma } from '@/shared/lib/prisma'
import { requiereSesion } from '@/shared/lib/permisos'
import { pushDisponible } from '@/shared/lib/push'

/**
 * Suscripción de Web Push del dispositivo actual.
 *  - GET: si el canal está disponible y la clave pública (la privada NUNCA sale de aquí).
 *  - POST: guarda o actualiza la suscripción que entrega el navegador.
 *  - DELETE: la borra (el usuario apagó el interruptor).
 *
 * El endpoint es la clave natural: si otra cuenta se suscribe en el mismo dispositivo, la fila
 * cambia de dueño en vez de duplicarse — así el push no sigue llegándole a quien cerró sesión.
 */

export async function GET() {
  await requiereSesion()
  return NextResponse.json({
    disponible: pushDisponible(),
    clavePublica: process.env.VAPID_PUBLIC_KEY ?? null,
  })
}

/** Hosts de los servicios de push de los navegadores. `webpush.sendNotification` hace una
 *  petición al `endpoint`, así que restringirlo a estos evita convertir el POST en un SSRF. */
function endpointDePushValido(endpoint: string): boolean {
  let url: URL
  try { url = new URL(endpoint) } catch { return false }
  if (url.protocol !== 'https:') return false
  const h = url.hostname
  return h === 'fcm.googleapis.com'
    || h === 'updates.push.services.mozilla.com'
    || h.endsWith('.push.apple.com')
    || h.endsWith('.notify.windows.com')
    || h.endsWith('.push.services.mozilla.com')
}

export async function POST(req: Request) {
  const sesion = await requiereSesion()
  const cuerpo = await req.json().catch(() => null)
  const endpoint = cuerpo?.endpoint
  const p256dh = cuerpo?.keys?.p256dh
  const auth = cuerpo?.keys?.auth
  if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string'
      || endpoint.length > 512 || p256dh.length > 256 || auth.length > 256) {
    return NextResponse.json({ ok: false, error: 'Suscripción inválida' }, { status: 400 })
  }
  /* El `endpoint` lo usa el servidor para una petición SALIENTE (`webpush.sendNotification`), y el
     propio usuario puede dispararla con /api/push/prueba: sin validar, es un SSRF semiciego para
     sondear la red interna. Solo se aceptan los servicios de push reales, por HTTPS. */
  if (!endpointDePushValido(endpoint)) {
    return NextResponse.json({ ok: false, error: 'Endpoint de notificaciones no admitido' }, { status: 400 })
  }
  // El user-agent solo para reconocer el dispositivo en la UI; recortado, no es dato de negocio
  const agente = (req.headers.get('user-agent') ?? '').slice(0, 120) || null

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { usuarioId: sesion.id, p256dh, auth, agente },
    create: { usuarioId: sesion.id, endpoint, p256dh, auth, agente },
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const sesion = await requiereSesion()
  const cuerpo = await req.json().catch(() => null)
  const endpoint = cuerpo?.endpoint
  if (typeof endpoint !== 'string') return NextResponse.json({ ok: false, error: 'Falta el endpoint' }, { status: 400 })
  // Solo puede borrar SUS suscripciones: el endpoint es adivinable en teoría
  await prisma.pushSubscription.deleteMany({ where: { endpoint, usuarioId: sesion.id } })
  return NextResponse.json({ ok: true })
}
