import type { NextAuthOptions } from 'next-auth'
import { getServerSession } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { createHash } from 'crypto'
import { cache } from 'react'
import { prisma } from './prisma'
import { resolverPermisosAdmin, type PermisosAdmin } from './permisos-admin'
import { Prisma } from '@/generated/prisma/client'

/**
 * Autenticación en dos pasos:
 * 1) /api/auth/solicitar-codigo valida email+contraseña (bcrypt) y envía un código de 6 dígitos.
 * 2) NextAuth (credentials) valida el código (SHA-256, 10 min, un solo uso) y abre sesión.
 */
export const authOptions: NextAuthOptions = {
  // 24 h de sesión (pedido EXPLÍCITO de Hunter, no modificar): un solo login por jornada. La
  // seguridad no depende de este plazo: rol/alcance/activo se re-derivan de la BD en cada request y
  // el cambio de contraseña invalida la sesión al instante (pwdStamp). Se evaluó un cierre por
  // inactividad para las PC de planta compartidas, pero contradice el «un login por jornada».
  session: { strategy: 'jwt', maxAge: 24 * 60 * 60 },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'Hunter 2FA',
      credentials: { email: {}, codigo: {} },
      async authorize(credentials) {
        const email = credentials?.email?.toLowerCase().trim()
        const codigo = credentials?.codigo?.trim()
        if (!email || !codigo) return null

        const usuario = await prisma.usuario.findUnique({
          where: { email },
          include: { colaborador: { include: { equipo: { where: { activo: true }, select: { id: true } } } } },
        })
        if (!usuario || !usuario.activo) return null

        // Código vigente del usuario (el más reciente sin usar y no vencido).
        const MAX_INTENTOS = 5
        const codigoHash = createHash('sha256').update(codigo).digest('hex')
        const vigente = await prisma.codigo2FA.findFirst({
          where: { usuarioId: usuario.id, usado: false, expiraEn: { gt: new Date() } },
          orderBy: { createdAt: 'desc' },
        })
        /* Rastro de accesos: el segundo factor es el que decide si la sesión se abre, así que es
           aquí donde queda el registro. Sin esto, ante un resultado impugnado («yo no calificé
           así a mi equipo») no había forma de saber cuándo ni desde dónde se abrió esa sesión. */
        const registrar = (accion: string, detalle: Prisma.InputJsonValue = {}) =>
          prisma.auditLog.create({ data: { usuarioId: usuario.id, accion, detalle } }).catch(() => {})

        if (!vigente) {
          await registrar('LOGIN_FALLIDO', { factor: '2FA', motivo: 'sin código vigente' })
          return null
        }
        // Reclama el intento ATÓMICAMENTE antes de comparar: el incremento condicionado
        // (intentos < máx) evita que una ráfaga concurrente se salte el tope (fuerza bruta).
        const reclamo = await prisma.codigo2FA.updateMany({
          where: { id: vigente.id, usado: false, intentos: { lt: MAX_INTENTOS } },
          data: { intentos: { increment: 1 } },
        })
        if (reclamo.count === 0) {
          await registrar('LOGIN_2FA_AGOTADO', { intentos: MAX_INTENTOS })
          return null
        }
        if (vigente.codigoHash !== codigoHash) {
          await registrar('LOGIN_FALLIDO', { factor: '2FA', motivo: 'código incorrecto' })
          return null
        }
        await prisma.codigo2FA.update({ where: { id: vigente.id }, data: { usado: true } })
        await registrar('LOGIN_OK', { rol: usuario.rol })

        // Cuenta sin colaborador vinculado (p. ej. tras una purga de carga inicial, antes de
        // re-vincular por correo): sesión válida igual, sin nombre/equipo derivados de él.
        return {
          id: usuario.id,
          email: usuario.email,
          name: usuario.colaborador ? `${usuario.colaborador.nombres} ${usuario.colaborador.apellidos}` : usuario.email,
          rol: usuario.rol,
          colaboradorId: usuario.colaboradorId ?? '',
          esJefe: (usuario.colaborador?.equipo.length ?? 0) > 0,
          alcanceRrhh: usuario.alcanceRrhh,
          alcancePaisId: usuario.alcancePaisId,
        }
      },
    }),
  ],
  callbacks: {
    // Rol, alcance, estado de jefe y `activo` se RE-DERIVAN de la BD en cada request (no se
    // confían al JWT). Así una baja o un cambio de rol surten efecto al instante, no en 8 h.
    async jwt({ token, user }) {
      if (user) token.colaboradorId = user.colaboradorId
      if (token.sub) {
        const u = await prisma.usuario.findUnique({
          where: { id: token.sub },
          include: {
            colaborador: { include: { equipo: { where: { activo: true }, select: { id: true } } } },
            rolAdmin: true,
          },
        })
        if (!u || !u.activo) {
          token.activo = false
          return token
        }
        // Sello de contraseña: se fija al iniciar sesión y se compara en cada request. Si la
        // contraseña se cambió/reseteó después (passwordChangedAt más nuevo), el token se invalida.
        const pwdStamp = u.passwordChangedAt?.getTime() ?? 0
        if (user) {
          token.pwdStamp = pwdStamp
        } else if (token.pwdStamp !== pwdStamp) {
          token.activo = false
          return token
        }
        token.activo = true
        token.rol = u.rol
        token.colaboradorId = u.colaboradorId ?? ''
        token.esJefe = (u.colaborador?.equipo.length ?? 0) > 0
        token.alcanceRrhh = u.alcanceRrhh
        token.alcancePaisId = u.alcancePaisId
        token.permisosAdmin = resolverPermisosAdmin(u.rol, u.rolAdmin?.permisos)
      }
      return token
    },
    async session({ session, token }) {
      session.user.id = token.sub!
      session.user.rol = token.rol
      session.user.colaboradorId = token.colaboradorId
      session.user.esJefe = token.esJefe
      session.user.alcanceRrhh = token.alcanceRrhh
      session.user.alcancePaisId = token.alcancePaisId
      session.user.activo = token.activo !== false
      session.user.permisosAdmin = token.permisosAdmin ?? {}
      return session
    },
  },
}

export type SesionUsuario = {
  id: string
  email: string
  name: string
  rol: 'RRHH' | 'COLABORADOR'
  colaboradorId: string
  esJefe: boolean
  alcanceRrhh: 'REGIONAL' | 'PAIS' | null
  alcancePaisId: string | null
  permisosAdmin: PermisosAdmin
}

/** Sesión obligatoria en server components / actions. Lanza si no hay sesión (el layout redirige).
 * Si la cuenta fue desactivada, la sesión se considera nula aunque el cookie siga presente.
 * `cache()` deduplica la lectura (y el re-fetch del jwt callback) dentro de un mismo request. */
export const getSesion = cache(async (): Promise<SesionUsuario | null> => {
  const session = await getServerSession(authOptions)
  if (!session?.user || session.user.activo === false) return null
  return session.user as unknown as SesionUsuario
})
