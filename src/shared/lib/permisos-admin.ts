/** Catálogo de secciones del MÓDULO DE ADMINISTRACIÓN y resolutor de permisos.
 * PURO (sin prisma/next): lo importan la sesión, los guards, la navegación y la matriz.
 * Regla del spec: — (sin acceso) · VER · GESTIONAR (GESTIONAR incluye VER). Los roles de
 * proceso (Jefe, Colaborador) NO pasan por aquí. */

export const SECCIONES_ADMIN = [
  'COLABORADORES', 'PUESTOS', 'EVALUACIONES', 'OBJETIVOS', 'CICLOS',
  'RESULTADOS', 'CONFIGURACION', 'USUARIOS_ROLES', 'AUDITORIA',
] as const
export type SeccionAdmin = (typeof SECCIONES_ADMIN)[number]
export type NivelAdmin = 'VER' | 'GESTIONAR'
export type PermisosAdmin = Partial<Record<SeccionAdmin, NivelAdmin>>

export const ETIQUETA_SECCION: Record<SeccionAdmin, string> = {
  COLABORADORES: 'Colaboradores',
  PUESTOS: 'Puestos y niveles',
  EVALUACIONES: 'Diseñar evaluación',
  OBJETIVOS: 'Objetivos y períodos',
  CICLOS: 'Ciclos de evaluación',
  RESULTADOS: 'Resultados y analítica',
  CONFIGURACION: 'Configuración del modelo',
  USUARIOS_ROLES: 'Usuarios y roles',
  AUDITORIA: 'Auditoría',
}

// Por naturaleza (RESULTADOS, AUDITORIA) o anti-escalada (USUARIOS_ROLES: su gestión es
// exclusiva del rol de sistema RR.HH.) estas secciones solo admiten VER en roles creados.
export const SECCIONES_SOLO_VER = ['RESULTADOS', 'AUDITORIA', 'USUARIOS_ROLES'] as const

const NIVELES: NivelAdmin[] = ['VER', 'GESTIONAR']
const esSeccion = (s: string): s is SeccionAdmin => (SECCIONES_ADMIN as readonly string[]).includes(s)

/** Permisos efectivos del usuario: RRHH (sistema) = todo GESTIONAR; colaborador = el JSON
 * de su rol admin (saneado contra el catálogo); sin rol = nada. */
export function resolverPermisosAdmin(rol: 'RRHH' | 'COLABORADOR', permisosRol: unknown): PermisosAdmin {
  if (rol === 'RRHH') return Object.fromEntries(SECCIONES_ADMIN.map((s) => [s, 'GESTIONAR'])) as PermisosAdmin
  if (!permisosRol || typeof permisosRol !== 'object') return {}
  const limpio: PermisosAdmin = {}
  for (const [k, v] of Object.entries(permisosRol as Record<string, unknown>)) {
    if (esSeccion(k) && (NIVELES as string[]).includes(String(v))) limpio[k] = v as NivelAdmin
  }
  return limpio
}

export function tieneAdmin(permisos: PermisosAdmin, seccion: SeccionAdmin, nivel: NivelAdmin): boolean {
  const actual = permisos[seccion]
  if (!actual) return false
  return nivel === 'VER' ? true : actual === 'GESTIONAR'
}

/** Valida los permisos que llegan de la UI al crear/editar un rol (anti-escalada incluida). */
export function validarPermisosRol(permisos: unknown): { ok: true; permisos: PermisosAdmin } | { ok: false; error: string } {
  if (!permisos || typeof permisos !== 'object') return { ok: false, error: 'Permisos no válidos' }
  const limpio: PermisosAdmin = {}
  for (const [k, v] of Object.entries(permisos as Record<string, unknown>)) {
    if (!esSeccion(k)) return { ok: false, error: `Sección desconocida: ${k}` }
    if (!(NIVELES as string[]).includes(String(v))) return { ok: false, error: `Nivel no válido para ${k}` }
    if (v === 'GESTIONAR' && (SECCIONES_SOLO_VER as readonly string[]).includes(k)) {
      return { ok: false, error: `La sección «${ETIQUETA_SECCION[k]}» solo admite Ver en roles creados` }
    }
    limpio[k] = v as NivelAdmin
  }
  if (Object.keys(limpio).length === 0) return { ok: false, error: 'El rol debe tener al menos una sección con acceso' }
  return { ok: true, permisos: limpio }
}
