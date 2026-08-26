import 'next-auth'
import 'next-auth/jwt'
import type { PermisosAdmin } from '@/shared/lib/permisos-admin'

type Rol = 'RRHH' | 'COLABORADOR'
type Alcance = 'REGIONAL' | 'PAIS' | null

declare module 'next-auth' {
  interface User {
    rol: Rol
    colaboradorId: string
    esJefe: boolean
    alcanceRrhh: Alcance
    alcancePaisId: string | null
  }
  interface Session {
    user: {
      id: string
      email: string
      name: string
      rol: Rol
      colaboradorId: string
      esJefe: boolean
      alcanceRrhh: Alcance
      alcancePaisId: string | null
      activo: boolean
      permisosAdmin?: PermisosAdmin
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    rol: Rol
    colaboradorId: string
    esJefe: boolean
    alcanceRrhh: Alcance
    alcancePaisId: string | null
    activo: boolean
    pwdStamp: number
    permisosAdmin?: PermisosAdmin
  }
}
