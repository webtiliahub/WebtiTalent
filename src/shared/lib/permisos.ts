import { redirect } from 'next/navigation'
import { getSesion, type SesionUsuario } from './auth'
import { tieneAdmin, type SeccionAdmin, type NivelAdmin } from './permisos-admin'

/** Sesión obligatoria: redirige a /login si no hay. */
export async function requiereSesion(): Promise<SesionUsuario> {
  const sesion = await getSesion()
  if (!sesion) redirect('/login')
  return sesion
}

/** Solo RR.HH. (fail-closed). */
export async function requiereRrhh(): Promise<SesionUsuario> {
  const sesion = await requiereSesion()
  if (sesion.rol !== 'RRHH') redirect('/hoja-de-vida')
  return sesion
}

/** Solo jefes (tienen equipo a cargo) o RR.HH. */
export async function requiereJefe(): Promise<SesionUsuario> {
  const sesion = await requiereSesion()
  if (!sesion.esJefe && sesion.rol !== 'RRHH') redirect('/hoja-de-vida')
  return sesion
}

/** Acceso al módulo de administración por sección y nivel (VER | GESTIONAR). Fail-closed:
 * sin permiso redirige (mismo comportamiento que requiereRrhh hoy, también en actions).
 * GESTIONAR incluye VER. RRHH (rol de sistema) siempre pasa. */
export async function requiereAdmin(seccion: SeccionAdmin, nivel: NivelAdmin): Promise<SesionUsuario> {
  const sesion = await requiereSesion()
  if (!tieneAdmin(sesion.permisosAdmin, seccion, nivel)) redirect('/hoja-de-vida')
  return sesion
}

/**
 * Filtro de alcance de datos para RR.HH.: Regional ve todo; RR.HH. de país solo su país.
 * `paisSeleccionado` viene del selector de la topbar (solo restringe, nunca amplía).
 */
export function alcancePaisWhere(sesion: SesionUsuario, paisSeleccionado?: string | null): { paisId?: string } {
  if (sesion.alcanceRrhh === 'PAIS') {
    // Fail-CLOSED, igual que `fueraDeAlcancePais`: un RR.HH. de país sin país asignado no ve nada.
    // Antes esa combinación devolvía `{}` — es decir, SIN restricción de país—, así que el mismo
    // estado que bloquea todas las escrituras abría todas las lecturas. La UI no permite crearlo,
    // pero los dos campos son nullable en la base: un dato heredado bastaba.
    return { paisId: sesion.alcancePaisId ?? '__sin_alcance__' }
  }
  if (paisSeleccionado) return { paisId: paisSeleccionado }
  return {}
}

/** País al que un RR.HH. de país queda FORZADO (para el foco de ciclos/períodos y los filtros de
 * ajustes manuales); null si es Regional (sin forzar). Fail-closed: un RR.HH. de país sin país
 * asignado se fuerza a un centinela imposible, no al valor que mande el cliente — mismo criterio
 * que `alcancePaisWhere`. Reemplaza el patrón `alcanceRrhh === 'PAIS' && alcancePaisId ? … : …`,
 * que con país nulo caía al valor del cliente (fail-open). */
/** Error si la cuenta OBJETIVO queda fuera del alcance del caller; null si puede administrarla.
 * Una cuenta sin colaborador vinculado no tiene país que verificar: un RR.HH. de país no puede
 * confirmar que esté en su alcance, así que se trata como fuera de alcance (solo Regional puede). */
export function errorDeAlcance(sesion: SesionUsuario, target: { alcanceRrhh: string | null; colaborador: { paisId: string } | null }): string | null {
  if (sesion.alcanceRrhh === 'REGIONAL') return null
  if (target.alcanceRrhh === 'REGIONAL') return 'No puedes administrar una cuenta de RR.HH. Regional'
  if (!target.colaborador || target.colaborador.paisId !== sesion.alcancePaisId) return 'Usuario fuera de tu alcance'
  return null
}

export function paisForzado(sesion: SesionUsuario): string | null {
  if (sesion.alcanceRrhh !== 'PAIS') return null
  return sesion.alcancePaisId ?? '__sin_alcance__'
}

/** true si el CICLO queda fuera del alcance del RR.HH. de país: solo opera ciclos de su propio
 * país, ni los regionales (paisId null) ni los de otro país. Regional opera todos.
 * Vive aquí, y no en las server actions, para que las páginas puedan decidir con el MISMO criterio
 * qué mostrar: el checklist de lanzamiento se calcula sobre toda la región (es lo que hará el
 * lanzamiento de verdad), así que enseñárselo a quien no puede lanzar solo filtra datos ajenos. */
export function cicloFueraDeAlcance(sesion: SesionUsuario, ciclo: { paisId: string | null }): boolean {
  if (sesion.alcanceRrhh !== 'PAIS') return false
  if (!sesion.alcancePaisId) return true
  return ciclo.paisId !== sesion.alcancePaisId
}

/** true si el PERÍODO de objetivos queda fuera del alcance del RR.HH. de país: solo opera los
 * acotados EXACTAMENTE a su país. El período no tiene `paisId` derivado como el ciclo, así que se
 * deriva de `focoPaisIds`. Compartido para que las páginas no ofrezcan botones que el servidor
 * rechazará. */
export function periodoFueraDeAlcance(sesion: SesionUsuario, periodo: { focoPaisIds: string[] }): boolean {
  if (sesion.alcanceRrhh !== 'PAIS') return false
  if (!sesion.alcancePaisId) return true
  return periodo.focoPaisIds.length !== 1 || periodo.focoPaisIds[0] !== sesion.alcancePaisId
}

/** true si el colaborador queda FUERA del alcance del RR.HH. de país (Regional siempre in-scope).
 * Fail-closed: un RR.HH. de país sin país asignado se considera fuera de alcance de todos. */
export function fueraDeAlcancePais(sesion: SesionUsuario, paisIdColaborador: string | null): boolean {
  if (sesion.alcanceRrhh !== 'PAIS') return false
  if (!sesion.alcancePaisId) return true
  return paisIdColaborador !== sesion.alcancePaisId
}
