import { describe, it, expect } from 'vitest'
import { resolverPermisosAdmin, tieneAdmin, validarPermisosRol, SECCIONES_ADMIN, SECCIONES_SOLO_VER } from './permisos-admin'

describe('resolverPermisosAdmin', () => {
  it('RRHH (rol de sistema) recibe TODAS las secciones en GESTIONAR', () => {
    const p = resolverPermisosAdmin('RRHH', null)
    for (const s of SECCIONES_ADMIN) expect(p[s]).toBe('GESTIONAR')
  })
  it('COLABORADOR sin rol admin no recibe nada', () => {
    expect(resolverPermisosAdmin('COLABORADOR', null)).toEqual({})
    expect(resolverPermisosAdmin('COLABORADOR', undefined)).toEqual({})
  })
  it('COLABORADOR con rol admin recibe el JSON del rol, descartando claves/valores inválidos', () => {
    const p = resolverPermisosAdmin('COLABORADOR', { COLABORADORES: 'GESTIONAR', CICLOS: 'VER', BASURA: 'GESTIONAR', PUESTOS: 'TODO' })
    expect(p).toEqual({ COLABORADORES: 'GESTIONAR', CICLOS: 'VER' })
  })
})

describe('tieneAdmin', () => {
  it('GESTIONAR satisface VER; VER no satisface GESTIONAR; ausente = sin acceso', () => {
    const p = { COLABORADORES: 'GESTIONAR' as const, CICLOS: 'VER' as const }
    expect(tieneAdmin(p, 'COLABORADORES', 'VER')).toBe(true)
    expect(tieneAdmin(p, 'COLABORADORES', 'GESTIONAR')).toBe(true)
    expect(tieneAdmin(p, 'CICLOS', 'VER')).toBe(true)
    expect(tieneAdmin(p, 'CICLOS', 'GESTIONAR')).toBe(false)
    expect(tieneAdmin(p, 'AUDITORIA', 'VER')).toBe(false)
  })
})

describe('validarPermisosRol (entrada de la UI, anti-escalada)', () => {
  it('acepta un set válido con al menos una sección', () => {
    const r = validarPermisosRol({ RESULTADOS: 'VER', COLABORADORES: 'GESTIONAR' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.permisos).toEqual({ RESULTADOS: 'VER', COLABORADORES: 'GESTIONAR' })
  })
  it('rechaza vacío, secciones desconocidas y niveles inválidos', () => {
    expect(validarPermisosRol({}).ok).toBe(false)
    expect(validarPermisosRol({ NADA: 'VER' }).ok).toBe(false)
    expect(validarPermisosRol({ CICLOS: 'X' }).ok).toBe(false)
  })
  it('rechaza GESTIONAR en secciones solo-VER (RESULTADOS, AUDITORIA, USUARIOS_ROLES)', () => {
    for (const s of SECCIONES_SOLO_VER) {
      expect(validarPermisosRol({ [s]: 'GESTIONAR' }).ok).toBe(false)
      expect(validarPermisosRol({ [s]: 'VER' }).ok).toBe(true)
    }
  })
})
