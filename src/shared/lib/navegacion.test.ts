import { describe, it, expect } from 'vitest'
import { armarGrupos, resolverNavMovil } from './navegacion'

const colaborador = { esJefe: false, permisosAdmin: {} } as Parameters<typeof armarGrupos>[0]
const jefe = { esJefe: true, permisosAdmin: {} } as Parameters<typeof armarGrupos>[0]
// permisosAdmin con RESULTADOS en VER: ajustar la FORMA al tipo real (ver permisos-admin.ts)
const analista = { esJefe: false, permisosAdmin: { RESULTADOS: 'VER' } } as Parameters<typeof armarGrupos>[0]

describe('armarGrupos', () => {
  it('colaborador simple: solo Lo mío con 4 ítems', () => {
    const g = armarGrupos(colaborador)
    expect(g.map((x) => x.titulo)).toEqual(['Lo mío'])
    expect(g[0].items.map((i) => i.href)).toEqual(['/hoja-de-vida', '/mi-resultado', '/objetivos', '/evaluaciones'])
  })
  it('jefe: Lo mío + Mi equipo', () => {
    expect(armarGrupos(jefe).map((x) => x.titulo)).toEqual(['Lo mío', 'Mi equipo'])
  })
  it('rol admin sin jefatura: Lo mío + Administración con solo sus secciones', () => {
    const g = armarGrupos(analista)
    expect(g.map((x) => x.titulo)).toEqual(['Lo mío', 'Administración'])
    expect(g[1].items.map((i) => i.href)).toEqual(['/admin/resultados'])
  })
  it('los ítems de Lo mío llevan etiqueta corta para la isla', () => {
    const items = armarGrupos(colaborador)[0].items
    expect(items.map((i) => i.corto)).toEqual(['Mi hoja', 'Resultado', 'Objetivos', 'Evaluaciones'])
  })
})

describe('resolverNavMovil', () => {
  it('1 sección → modo directa con los 4 accesos (regla de aplanado)', () => {
    const nav = resolverNavMovil(armarGrupos(colaborador))
    expect(nav.tipo).toBe('directa')
    if (nav.tipo === 'directa') expect(nav.items).toHaveLength(4)
  })
  it('2 secciones (jefe) → modo secciones con hubs', () => {
    const nav = resolverNavMovil(armarGrupos(jefe))
    expect(nav.tipo).toBe('secciones')
    if (nav.tipo === 'secciones') {
      expect(nav.secciones.map((s) => s.id)).toEqual(['lo-mio', 'equipo'])
      expect(nav.secciones.map((s) => s.href)).toEqual(['/movil/lo-mio', '/movil/equipo'])
    }
  })
  it('jefe + admin → 3 secciones', () => {
    const jefeAdmin = { esJefe: true, permisosAdmin: { RESULTADOS: 'VER' } } as Parameters<typeof armarGrupos>[0]
    const nav = resolverNavMovil(armarGrupos(jefeAdmin))
    if (nav.tipo === 'secciones') expect(nav.secciones.map((s) => s.id)).toEqual(['lo-mio', 'equipo', 'admin'])
  })
})
