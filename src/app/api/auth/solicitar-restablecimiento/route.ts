import { NextResponse, after } from 'next/server'
import { createHash, randomBytes } from 'crypto'
import { prisma } from '@/shared/lib/prisma'
import { enviarRestablecimiento } from '@/shared/lib/mailer'
import { permitido, ipDe } from '@/shared/lib/rate-limit'

/**
 * «¿Olvidaste tu contraseña?» paso 1: emite un enlace de restablecimiento de un solo uso
 * (30 minutos). ANTI-ENUMERACIÓN: la respuesta es SIEMPRE { ok: true } — exista o no la
 * cuenta, esté activa o no — y el correo se envía en segundo plano para que la latencia
 * no delate qué correos están registrados.
 */
export async function POST(req: Request) {
  // Límite por IP: frena el barrido masivo de correos
  if (!(await permitido(`restablecer:ip:${ipDe(req)}`, 30, 10 * 60 * 1000))) {
    return NextResponse.json({ ok: false, error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }, { status: 429 })
  }

  const { email } = await req.json().catch(() => ({}))
  // Tope antes de usar el valor como clave de rate limit y en logs (endpoint anónimo)
  if (typeof email !== 'string' || email.length > 254) return NextResponse.json({ ok: false, error: 'Solicitud inválida' }, { status: 400 })
  const correo = email.toLowerCase().trim()

  const respuestaGenerica = NextResponse.json({ ok: true })

  const usuario = await prisma.usuario.findUnique({ where: { email: correo } })
  if (!usuario || !usuario.activo) return respuestaGenerica

  // Límite de emisión por cuenta, SILENCIOSO (responder 429 aquí delataría que la cuenta existe):
  // al superarlo simplemente no se emite otro correo
  if (!(await permitido(`restablecer:email:${correo}`, 3, 15 * 60 * 1000))) return respuestaGenerica

  // Token de un solo uso: 32 bytes aleatorios; en BD solo vive su SHA-256 (patrón Codigo2FA)
  const token = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  await prisma.$transaction([
    prisma.tokenRestablecimiento.updateMany({ where: { usuarioId: usuario.id, usado: false }, data: { usado: true } }),
    prisma.tokenRestablecimiento.create({
      data: { usuarioId: usuario.id, tokenHash, expiraEn: new Date(Date.now() + 30 * 60 * 1000) },
    }),
  ])

  // Envío tras responder (latencia constante anti-enumeración) con after() de Next: en
  // serverless un `void promise` MUERE al devolver la respuesta — after() garantiza que la
  // lambda siga viva hasta completar el envío. Un fallo queda en los logs.
  after(() =>
    enviarRestablecimiento(usuario.email, `/restablecer?token=${token}`).catch((e) =>
      console.error(`[restablecer] Falló el envío a ${usuario.email}:`, e),
    ),
  )

  return respuestaGenerica
}
