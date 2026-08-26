import webpush from 'web-push'
import { prisma } from './prisma'

/**
 * Web Push (sub-proyecto B del contrato móvil). Se monta sobre el service worker que dejó la
 * PWA: `public/sw.js` escucha `push` y abre la ruta del aviso al tocarlo.
 *
 * Reglas de la casa:
 *  - El push ACOMPAÑA al correo, no lo reemplaza: si no hay claves VAPID o el usuario no tiene
 *    suscripciones, el envío es un no-op silencioso y el recordatorio sigue saliendo por mail.
 *  - Una suscripción es de un DISPOSITIVO. Cuando el servicio responde 404/410 la suscripción
 *    murió (app desinstalada, permiso revocado): se borra sola, o la tabla se llena de zombis.
 *  - Nunca se manda dato sensible en el payload: título, texto corto y la ruta. La notificación
 *    viaja por servidores de Apple/Google y puede quedar en pantalla de bloqueo.
 */

export type AvisoPush = {
  titulo: string
  cuerpo: string
  /** Ruta interna a abrir al tocar la notificación (sin dominio). */
  ruta: string
  /** Agrupa avisos del mismo tipo: uno nuevo reemplaza al anterior en la bandeja del sistema. */
  etiqueta?: string
}

const clavePublica = process.env.VAPID_PUBLIC_KEY
const clavePrivada = process.env.VAPID_PRIVATE_KEY
const asunto = process.env.VAPID_SUBJECT ?? 'mailto:Evaluacion360@hunter.com.pe'

let configurado = false
function configurar(): boolean {
  if (configurado) return true
  if (!clavePublica || !clavePrivada) return false
  webpush.setVapidDetails(asunto, clavePublica, clavePrivada)
  configurado = true
  return true
}

/** ¿Está el canal disponible? Lo usa la UI para no ofrecer un interruptor que no hará nada. */
export function pushDisponible(): boolean {
  return Boolean(clavePublica && clavePrivada)
}

export type ResultadoPush = { enviados: number; fallidos: number; caducadas: number }

/** 404/410 = el servicio de push dice que esa suscripción ya no existe (app desinstalada,
 * permiso revocado, endpoint rotado): hay que borrarla. Cualquier otro código es un fallo
 * transitorio (red, 429, 500) y la suscripción se conserva para el próximo envío. */
export function esSuscripcionCaducada(codigo: number | undefined): boolean {
  return codigo === 404 || codigo === 410
}

/**
 * Manda un aviso a TODOS los dispositivos de los usuarios indicados. Los errores no se
 * propagan: un push que falla no puede tumbar el cron de recordatorios ni una acción de negocio.
 */
export async function enviarPush(usuarioIds: string[], aviso: AvisoPush): Promise<ResultadoPush> {
  const vacio = { enviados: 0, fallidos: 0, caducadas: 0 }
  if (usuarioIds.length === 0 || !configurar()) return vacio

  const subs = await prisma.pushSubscription.findMany({
    where: { usuarioId: { in: usuarioIds } },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  })
  if (subs.length === 0) return vacio

  const payload = JSON.stringify(aviso)
  const caducadas: string[] = []
  let enviados = 0
  let fallidos = 0

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 60 * 60 * 12 }, // 12 h: un recordatorio de ayer ya no sirve
      )
      enviados++
    } catch (e) {
      const codigo = (e as { statusCode?: number }).statusCode
      if (esSuscripcionCaducada(codigo)) caducadas.push(s.id)
      else fallidos++
    }
  }))

  if (caducadas.length > 0) await prisma.pushSubscription.deleteMany({ where: { id: { in: caducadas } } })
  if (enviados > 0) {
    await prisma.pushSubscription.updateMany({
      where: { id: { in: subs.filter((s) => !caducadas.includes(s.id)).map((s) => s.id) } },
      data: { ultimoEnvioEn: new Date() },
    })
  }
  return { enviados, fallidos, caducadas: caducadas.length }
}

/** Igual que `enviarPush` pero resolviendo los usuarios a partir de sus colaboradores. */
export async function enviarPushAColaboradores(colaboradorIds: string[], aviso: AvisoPush): Promise<ResultadoPush> {
  if (colaboradorIds.length === 0) return { enviados: 0, fallidos: 0, caducadas: 0 }
  const usuarios = await prisma.usuario.findMany({
    where: { activo: true, colaboradorId: { in: colaboradorIds } },
    select: { id: true },
  })
  return enviarPush(usuarios.map((u) => u.id), aviso)
}

/** Igual, pero por correo electrónico: los recordatorios ya trabajan con listas de correos. */
export async function enviarPushACorreos(correos: string[], aviso: AvisoPush): Promise<ResultadoPush> {
  if (correos.length === 0) return { enviados: 0, fallidos: 0, caducadas: 0 }
  const usuarios = await prisma.usuario.findMany({
    where: { activo: true, email: { in: correos.map((c) => c.toLowerCase().trim()) } },
    select: { id: true },
  })
  return enviarPush(usuarios.map((u) => u.id), aviso)
}
