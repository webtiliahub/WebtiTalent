import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSesion } from '@/shared/lib/auth'

/** Guarda el país seleccionado en la barra superior (solo filtra alcance de datos, no cambia el rol).
 * Lo usa RR.HH. Regional y cualquier rol admin con alcance regional: la cookie solo restringe la
 * vista (nunca amplía), así que basta tener algún permiso admin para poder elegir país. */
export async function POST(req: Request) {
  const sesion = await getSesion()
  if (!sesion || (sesion.rol !== 'RRHH' && Object.keys(sesion.permisosAdmin).length === 0)) {
    return NextResponse.json({ ok: false }, { status: 403 })
  }
  const { paisId } = await req.json().catch(() => ({}))
  const jar = await cookies()
  if (paisId) jar.set('pais', String(paisId), { httpOnly: true, sameSite: 'lax' })
  else jar.delete('pais')
  return NextResponse.json({ ok: true })
}
