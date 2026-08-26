import type { SesionUsuario } from './auth'
import { tieneAdmin } from './permisos-admin'

/** Navegación de la app en un solo lugar: el sidebar de escritorio, la isla móvil y los
 * hubs de cards se arman desde aquí. Puro (dado el objeto de sesión) y testeable. */

export type ItemNav = { href: string; label: string; icono: string; corto?: string; cat?: string }
export type GrupoNav = { titulo: string; items: ItemNav[] }
export type SeccionMovil = { id: 'lo-mio' | 'equipo' | 'admin'; label: string; icono: string; href: string; items: ItemNav[] }
export type NavMovil = { tipo: 'directa'; items: ItemNav[] } | { tipo: 'secciones'; secciones: SeccionMovil[] }

export function armarGrupos(sesion: Pick<SesionUsuario, 'esJefe' | 'permisosAdmin'>): GrupoNav[] {
  const grupos: GrupoNav[] = [
    {
      titulo: 'Lo mío',
      items: [
        { href: '/hoja-de-vida', label: 'Mi hoja de vida', icono: 'hoja-de-vida', corto: 'Mi hoja', cat: 'Perfil' },
        { href: '/mi-resultado', label: 'Mi resultado', icono: 'resultado', corto: 'Resultado', cat: 'Desempeño' },
        { href: '/objetivos', label: 'Mis objetivos', icono: 'objetivos', corto: 'Objetivos', cat: 'Objetivos' },
        { href: '/evaluaciones', label: 'Mis evaluaciones', icono: 'evaluaciones', corto: 'Evaluaciones', cat: 'Evaluaciones' },
      ],
    },
  ]
  if (sesion.esJefe) {
    grupos.push({
      titulo: 'Mi equipo',
      items: [
        { href: '/equipo', label: 'Mi equipo', icono: 'equipo', cat: 'Equipo' },
        { href: '/equipo/objetivos', label: 'Objetivos del equipo', icono: 'equipo-objetivos', cat: 'Objetivos' },
        { href: '/equipo/evaluar', label: 'Evaluar a mi equipo', icono: 'equipo-evaluar', cat: 'Evaluación' },
        { href: '/equipo/resultados', label: 'Resultados del equipo', icono: 'equipo-resultados', cat: 'Resultados' },
      ],
    })
  }
  const admin = [
    { href: '/admin/colaboradores', label: 'Colaboradores', icono: 'colaboradores', cat: 'Personas', seccion: 'COLABORADORES' as const },
    { href: '/admin/puestos', label: 'Puestos y niveles', icono: 'puestos', cat: 'Estructura', seccion: 'PUESTOS' as const },
    { href: '/admin/preguntas', label: 'Diseñar evaluación', icono: 'preguntas', cat: 'Diseño', seccion: 'EVALUACIONES' as const },
    { href: '/admin/transversales', label: 'Objetivos transversales', icono: 'transversales', cat: 'Objetivos', seccion: 'OBJETIVOS' as const },
    { href: '/admin/ciclos', label: 'Ciclos de evaluación', icono: 'ciclos', cat: 'Procesos', seccion: 'CICLOS' as const },
    { href: '/admin/resultados', label: 'Resultados y analítica', icono: 'resultados-9box', cat: 'Análisis', seccion: 'RESULTADOS' as const },
    { href: '/admin/configuracion', label: 'Configuración', icono: 'configuracion', cat: 'Sistema', seccion: 'CONFIGURACION' as const },
  ]
    .filter((i) => tieneAdmin(sesion.permisosAdmin, i.seccion, 'VER')
      || (i.href === '/admin/configuracion' && (tieneAdmin(sesion.permisosAdmin, 'USUARIOS_ROLES', 'VER') || tieneAdmin(sesion.permisosAdmin, 'AUDITORIA', 'VER'))))
    .map(({ seccion: _seccion, ...item }) => item)
  if (admin.length > 0) grupos.push({ titulo: 'Administración', items: admin })
  return grupos
}

const SECCION_META: Record<string, Omit<SeccionMovil, 'items'>> = {
  'Lo mío': { id: 'lo-mio', label: 'Lo mío', icono: 'hoja-de-vida', href: '/movil/lo-mio' },
  'Mi equipo': { id: 'equipo', label: 'Mi equipo', icono: 'equipo', href: '/movil/equipo' },
  'Administración': { id: 'admin', label: 'Admin', icono: 'admin', href: '/movil/admin' },
}

/** Regla de aplanado: con UNA sola sección la isla lleva sus accesos directos;
 * con 2+ lleva las secciones (cada una abre su hub de cards). */
export function resolverNavMovil(grupos: GrupoNav[]): NavMovil {
  if (grupos.length === 1) return { tipo: 'directa', items: grupos[0].items }
  return { tipo: 'secciones', secciones: grupos.map((g) => ({ ...SECCION_META[g.titulo], items: g.items })) }
}
