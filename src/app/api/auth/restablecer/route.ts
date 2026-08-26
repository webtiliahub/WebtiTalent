import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createHash } from 'crypto'
import { prisma } from '@/shared/lib/prisma'
import { permitido, ipDe } from '@/shared/lib/rate-limit'
import { esquemaPasswordNueva } from '@/shared/lib/password'

/**
 * «¿Olvidaste tu contraseña?» paso 2: consume el token (un solo uso, 30 min) y fija la nueva
 * contraseña. NO inicia sesión (decisión de diseño): el usuario vuelve al login y entra con su
 * 2FA normal — un correo comprometido no basta para entrar. Error genérico ante token inválido.
 */
export async function POST(req: Request) {
  if (!(await permitido(`restablecer-fin:ip:${ipDe(req)}`, 20, 10 * 60 * 1000))) {
    return NextResponse.json({ ok: false, error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }, { status: 429 })
  }

  const { token, password } = await req.json().catch(() => ({}))
  if (typeof token !== 'string' || typeof password !== 'string' || token.length === 0) {
    return NextResponse.json({ ok: false, error: 'Solicitud inválida' }, { status: 400 })
  }
  const politica = esquemaPasswordNueva.safeParse(password)
  if (!politica.success) {
    return NextResponse.json({ ok: false, error: politica.error.issues[0].message }, { status: 400 })
  }

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const registro = await prisma.tokenRestablecimiento.findUnique({
    where: { tokenHash },
    include: { usuario: { select: { id: true, activo: true, passwordHash: true, passwordAnteriores: true } } },
  })
  const errorGenerico = NextResponse.json(
    { ok: false, error: 'El enlace no es válido o ya expiró. Solicita uno nuevo desde el login.' },
    { status: 400 },
  )
  if (!registro || registro.usado || registro.expiraEn < new Date() || !registro.usuario.activo) return errorGenerico

  // No reutilizar las 2 últimas (la actual + el historial): mismo criterio que el cambio voluntario
  const recientes = [registro.usuario.passwordHash, ...registro.usuario.passwordAnteriores].slice(0, 2)
  for (const previa of recientes) {
    if (await bcrypt.compare(password, previa)) {
      return NextResponse.json({ ok: false, error: 'No puedes reutilizar ninguna de tus dos últimas contraseñas.' }, { status: 400 })
    }
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const anteriores = [registro.usuario.passwordHash, ...registro.usuario.passwordAnteriores].slice(0, 2)
  await prisma.$transaction([
    prisma.tokenRestablecimiento.update({ where: { id: registro.id }, data: { usado: true } }),
    // La contraseña nueva reemplaza cualquier estado pendiente: cambio forzado y códigos 2FA vivos.
    // `passwordChangedAt` es lo que invalida las sesiones abiertas (auth.ts lo compara con el
    // sello del token): sin él, quien tuviera una sesión robada la conservaba hasta 24 h justo
    // después de que la víctima cambiara su contraseña — el peor momento para no cerrarlas.
    prisma.usuario.update({ where: { id: registro.usuario.id }, data: { passwordHash, debeCambiarPassword: false, passwordChangedAt: new Date(), passwordAnteriores: anteriores } }),
    prisma.codigo2FA.updateMany({ where: { usuarioId: registro.usuario.id, usado: false }, data: { usado: true } }),
    prisma.auditLog.create({
      data: { usuarioId: registro.usuario.id, accion: 'PASSWORD_RESTABLECIDA', entidad: registro.usuario.id, detalle: { via: 'self-service' } },
    }),
  ])

  return NextResponse.json({ ok: true })
}
