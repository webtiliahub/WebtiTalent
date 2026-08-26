import { NextResponse } from 'next/server'
import { requiereSesion } from '@/shared/lib/permisos'
import { enviarPush } from '@/shared/lib/push'

/** Envía un push de prueba al propio usuario: es la única forma razonable de comprobar la
 * cadena completa (permiso → suscripción → VAPID → servicio de Apple/Google → service worker)
 * desde el dispositivo de quien la activa. */
export async function POST() {
  const sesion = await requiereSesion()
  const r = await enviarPush([sesion.id], {
    titulo: 'Notificaciones activas',
    cuerpo: 'Así se verán los avisos de Talent Hub en este dispositivo.',
    ruta: '/hoja-de-vida',
    etiqueta: 'prueba',
  })
  return NextResponse.json({ ok: r.enviados > 0, ...r })
}
