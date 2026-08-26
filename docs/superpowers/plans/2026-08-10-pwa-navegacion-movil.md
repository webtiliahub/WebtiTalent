# PWA + navegación móvil (sub-proyecto A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hunter 360 instalable como PWA y navegable en el celular con una isla flotante híbrida adaptada al rol (regla de aplanado), hubs de cards, menú de avatar con logout confirmado, página offline y banner de instalación — sin tocar la experiencia de escritorio.

**Architecture:** La lógica de navegación se extrae del layout a un módulo puro (`armarGrupos` + `resolverNavMovil`, testeable) que alimenta tanto el sidebar de escritorio como la isla móvil y los hubs. El Shell gana una rama móvil (`md:hidden`/`hidden md:flex`). La PWA es artesanal: `manifest.ts` de App Router, iconos derivados del 1024² existente, `sw.js` mínimo escrito a mano y página `/offline`.

**Tech Stack:** Next.js 16 App Router (server components, convención `manifest.ts`), next-auth (signOut), Tailwind 4 (breakpoint `md`), Vitest. **Sin dependencias nuevas.**

## Global Constraints

- **Escritorio NO cambia** (spec §4): el sidebar/hover y la topbar actuales quedan idénticos en `md+`. Toda la UI nueva vive bajo `md` (única excepción: el logout de escritorio gana el popup de confirmación, decisión de Christian).
- **Regla de aplanado** (spec §1): 1 sola sección → la isla lleva los 4 accesos directos de Lo mío; 2+ secciones → la isla lleva las secciones y cada una abre su hub de cards.
- **Isla híbrida** (spec §2): iconos solos; el activo se expande en pastilla `bg-hunter/10` con texto `text-hunter` y su nombre. Flotante: `inset-x-4`, full-round, sombra, `backdrop-blur`, `bottom: max(12px, env(safe-area-inset-bottom))`. El main reserva `pb-28` en móvil.
- **Logout SIEMPRE con confirmación**: `confirmar('¿Cerrar tu sesión?', { titulo: 'Cerrar sesión', textoAceptar: 'Cerrar sesión' })` de `@/shared/ui/Confirmacion` (firma real verificada: `confirmar(mensaje, opts?): Promise<boolean>`).
- **SW mínimo** (spec §5): solo precache de cascarón + fallback de NAVEGACIONES a `/offline`. Prohibido cachear API/datos de negocio. Cache versionado + `skipWaiting`/`clients.claim`.
- **Copys exactos**: aviso importadores = «Esta función se usa desde una computadora.»; página offline = «Sin conexión» + «Revisa tu red e inténtalo de nuevo.»; banner Android = «Instala Hunter 360 en tu pantalla de inicio» con botón «Instalar»; banner iOS = «Instálala: toca Compartir y elige “Añadir a pantalla de inicio”». Banner descartable con persistencia 30 días en localStorage, nunca en standalone.
- **Next 16 con breaking changes** (AGENTS.md): antes de tocar `manifest.ts`/`viewport`/metadata, verificar la convención en `node_modules/next/dist/docs/`.
- Español neutro; sin emojis como iconos (SVG vía `Icono`/`lucide` según el patrón del archivo).
- Suite `npx vitest run` verde en cada commit (hoy 169); `npx tsc --noEmit` limpio.
- **Commits locales, SIN `git push`**; nunca `git add -A`. Dev en `localhost:3001` (clone local).

## File Structure

| Archivo | Rol |
|---|---|
| `src/shared/lib/navegacion.ts` (crear) | `armarGrupos(sesion)` (extraído de layout) + `resolverNavMovil(grupos)` + tipos `ItemNav/GrupoNav/NavMovil` |
| `src/shared/lib/navegacion.test.ts` (crear) | tests de armado por rol y regla de aplanado |
| `src/shared/ui/iconos.tsx` (modificar) | nuevo slug `admin` (grid 2×2) |
| `src/app/(app)/layout.tsx` (modificar) | consume `armarGrupos` + pasa `navMovil` al Shell |
| `src/shared/ui/Shell.tsx` (modificar) | rama móvil: sidebar `hidden md:flex`, topbar móvil, paddings, isla, logout confirmado |
| `src/shared/ui/MenuAvatar.tsx` (crear) | menú del avatar móvil (país + cerrar sesión confirmado) |
| `src/shared/ui/IslaNav.tsx` (crear) | isla flotante híbrida |
| `src/shared/ui/HubCards.tsx` (crear) | grid de cards de los hubs |
| `src/app/(app)/movil/lo-mio/page.tsx`, `movil/equipo/page.tsx`, `movil/admin/page.tsx` (crear) | páginas hub |
| `src/app/manifest.ts` (crear) | manifest PWA |
| `public/iconos/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` (crear) | iconos derivados de `src/app/icon.png` |
| `public/sw.js` (crear) | service worker mínimo |
| `src/app/offline/page.tsx` (crear) | página de cortesía sin conexión |
| `src/shared/ui/RegistrarSW.tsx` (crear) | registro del SW (solo producción) |
| `src/app/layout.tsx` (modificar) | metadata PWA + viewport + `<RegistrarSW />` |
| `src/shared/ui/BannerInstalar.tsx` (crear) | banner de instalación (Android prompt / guía iOS) |
| `src/shared/ui/AvisoSoloEscritorio.tsx` (crear) | franja «solo escritorio» |
| Páginas de importadores (modificar ×3) | montar el aviso |

---

### Task 1: Módulo de navegación puro (`navegacion.ts`) + slug `admin`

**Files:**
- Create: `src/shared/lib/navegacion.ts`
- Test: `src/shared/lib/navegacion.test.ts`
- Modify: `src/shared/ui/iconos.tsx` (añadir slug `admin`)
- Modify: `src/app/(app)/layout.tsx:19-51` (consumir `armarGrupos`)
- Modify: `src/shared/ui/Shell.tsx:9-10` (re-exportar tipos desde navegacion)

**Interfaces:**
- Consumes: `SesionUsuario` de `@/shared/lib/auth` (campos usados: `esJefe`, `permisosAdmin`); `tieneAdmin` de `@/shared/lib/permisos-admin`.
- Produces (Tasks 2-4 dependen de estas firmas EXACTAS):
  ```ts
  export type ItemNav = { href: string; label: string; icono: string; corto?: string; cat?: string }
  export type GrupoNav = { titulo: string; items: ItemNav[] }
  export type SeccionMovil = { id: 'lo-mio' | 'equipo' | 'admin'; label: string; icono: string; href: string; items: ItemNav[] }
  export type NavMovil = { tipo: 'directa'; items: ItemNav[] } | { tipo: 'secciones'; secciones: SeccionMovil[] }
  export function armarGrupos(sesion: Pick<SesionUsuario, 'esJefe' | 'permisosAdmin'>): GrupoNav[]
  export function resolverNavMovil(grupos: GrupoNav[]): NavMovil
  ```

- [ ] **Step 1: Escribir el test que falla**

Crear `src/shared/lib/navegacion.test.ts` (revisar el tipo real de `permisosAdmin` en `permisos-admin.ts` para armar los fixtures — es el mapa sección→nivel que consume `tieneAdmin`):

```ts
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
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/shared/lib/navegacion.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/shared/lib/navegacion.ts`**

Mover el armado de grupos desde `layout.tsx:19-51` VERBATIM (misma lógica y filtro de admin, incluida la excepción de configuración con USUARIOS_ROLES/AUDITORIA), añadiendo `corto` y `cat`:

```ts
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
```

Nota: si el fixture `{ RESULTADOS: 'VER' }` no calza con el tipo real de `permisosAdmin`, ajustar el FIXTURE del test a la forma real (leer `permisos-admin.ts`), nunca la función.

- [ ] **Step 4: Slug `admin` en `src/shared/ui/iconos.tsx`**

Leer el archivo y añadir, siguiendo su patrón exacto de slugs existentes, el slug `admin` con un grid 2×2:

```tsx
// path del SVG (mismo formato stroke del archivo):
<rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" />
```

- [ ] **Step 5: layout.tsx consume `armarGrupos` (sin cambio visual)**

En `src/app/(app)/layout.tsx`: borrar el bloque de las líneas 19-51 y reemplazarlo por:

```ts
import { armarGrupos } from '@/shared/lib/navegacion'
// ...
const grupos = armarGrupos(sesion)
```

Ajustar el import de tipos: `Shell` sigue recibiendo `grupos`. En `Shell.tsx:9-10` reemplazar las declaraciones locales por re-export:

```ts
export type { ItemNav, GrupoNav } from '../lib/navegacion'
```

(y añadir `import type { GrupoNav } from '../lib/navegacion'` para el uso interno del componente).

- [ ] **Step 6: Correr tests y suite completa**

Run: `npx vitest run src/shared/lib/navegacion.test.ts` → PASS (7 tests).
Run: `npx vitest run` → 176 verdes (169 + 7). `npx tsc --noEmit` limpio.
Smoke: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/hoja-de-vida` → 307/200 (nunca 500).

- [ ] **Step 7: Commit**

```bash
git add src/shared/lib/navegacion.ts src/shared/lib/navegacion.test.ts src/shared/ui/iconos.tsx "src/app/(app)/layout.tsx" src/shared/ui/Shell.tsx
git commit -m "refactor(nav): módulo de navegación puro (armarGrupos + resolverNavMovil) compartido por escritorio y móvil

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Shell responsive + MenuAvatar (topbar móvil, logout confirmado)

**Files:**
- Create: `src/shared/ui/MenuAvatar.tsx`
- Modify: `src/shared/ui/Shell.tsx`

**Interfaces:**
- Consumes: `confirmar` de `./Confirmacion` (`confirmar(mensaje, opts?): Promise<boolean>`); `signOut` de `next-auth/react`.
- Produces: `MenuAvatar({ nombre, rolLabel, paises, paisActual, esRrhhRegional })`; Shell con sidebar `hidden md:flex`, topbar de escritorio `hidden md:flex`, topbar móvil `md:hidden` y main con paddings responsivos. (La isla llega en Task 3.)

- [ ] **Step 1: Crear `src/shared/ui/MenuAvatar.tsx`**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { signOut } from 'next-auth/react'
import { confirmar } from './Confirmacion'

/** Menú del avatar en la topbar móvil: identidad, selector de país (solo RR.HH. Regional)
 * y cierre de sesión SIEMPRE con confirmación (decisión de producto). */
export function MenuAvatar({ nombre, rolLabel, paises, paisActual, esRrhhRegional }: {
  nombre: string
  rolLabel: string
  paises: { id: string; codigo: string; nombre: string }[]
  paisActual: string | null
  esRrhhRegional: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)
  const iniciales = nombre.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()

  useEffect(() => {
    const fuera = (e: MouseEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [])

  // Mismo endpoint que usa el selector de escritorio en Shell.tsx
  async function cambiarPais(paisId: string) {
    await fetch('/api/preferencias/pais', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paisId: paisId || null }),
    })
    window.location.reload()
  }

  async function salir() {
    if (await confirmar('¿Cerrar tu sesión?', { titulo: 'Cerrar sesión', textoAceptar: 'Cerrar sesión' })) {
      signOut({ callbackUrl: '/login' })
    }
  }

  return (
    <div ref={raiz} className="relative">
      <button onClick={() => setAbierto((v) => !v)} aria-label="Mi cuenta"
        className="grid h-9 w-9 place-items-center rounded-full bg-hunter font-display text-xs font-extrabold text-white">
        {iniciales}
      </button>
      {abierto && (
        <div className="absolute right-0 top-11 z-50 w-64 rounded-2xl border border-gris-claro bg-white p-4 shadow-xl">
          <p className="text-sm font-bold">{nombre}</p>
          <p className="text-[11px] text-gris">{rolLabel}</p>
          {esRrhhRegional && (
            <select value={paisActual ?? ''} onChange={(e) => cambiarPais(e.target.value)}
              className="mt-3 w-full rounded-xl border border-gris-claro bg-hueso px-3 py-2 text-xs font-semibold outline-none">
              <option value="">Todos los países</option>
              {paises.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          )}
          <button onClick={salir}
            className="mt-3 w-full rounded-xl border border-gris-claro px-3 py-2 text-left text-[13px] font-bold text-hunter transition hover:bg-red-50">
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Rama móvil en `Shell.tsx`**

Cambios quirúrgicos (el resto del archivo NO se toca):
1. `aside` (línea 57): `fixed` → `hidden md:flex fixed` (clase completa: `hidden md:flex fixed inset-y-0 left-0 z-40 flex-col bg-negro ...` — quitar el `flex` suelto y dejar `md:flex` + `flex-col`).
2. Main wrapper (línea 106): `ml-16` → `md:ml-16`.
3. Header de escritorio (línea 107): `flex` → `hidden md:flex`.
4. ANTES del header de escritorio, insertar la topbar móvil:

```tsx
        {/* Topbar móvil: marca + avatar (menú con país y cerrar sesión confirmado) */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-gris-claro bg-hueso px-4 md:hidden" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <span className="flex items-center gap-2 font-display text-sm font-bold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo/hunter-iso-red.png" alt="Hunter" className="h-6 w-6 object-contain" />
            Hunter · 360
          </span>
          <MenuAvatar nombre={nombre} rolLabel={rolLabel} paises={paises} paisActual={paisActual} esRrhhRegional={esRrhhRegional} />
        </header>
```

5. `main` (línea 134): `px-6 py-6` → `px-4 pb-28 pt-4 md:px-6 md:py-6` (reserva para la isla).
6. Logout de escritorio (línea 96-102): envolver con confirmación —

```tsx
        <button
          onClick={async () => {
            if (await confirmar('¿Cerrar tu sesión?', { titulo: 'Cerrar sesión', textoAceptar: 'Cerrar sesión' })) signOut({ callbackUrl: '/login' })
          }}
```

(añadir `import { confirmar } from './Confirmacion'` y `import { MenuAvatar } from './MenuAvatar'`).

- [ ] **Step 3: Verificar**

`npx tsc --noEmit` limpio; `npx vitest run` → 176 verdes.
Smoke visual (el controlador la valida en E2E; aquí basta): `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/hoja-de-vida` → 307/200.

- [ ] **Step 4: Commit**

```bash
git add src/shared/ui/Shell.tsx src/shared/ui/MenuAvatar.tsx
git commit -m "feat(movil): shell responsive — topbar móvil con menú de avatar y logout confirmado

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Isla flotante híbrida (`IslaNav`)

**Files:**
- Create: `src/shared/ui/IslaNav.tsx`
- Modify: `src/shared/ui/Shell.tsx` (montarla)
- Modify: `src/app/(app)/layout.tsx` (pasar `navMovil`)

**Interfaces:**
- Consumes: `NavMovil`/`ItemNav` (T1), `Icono` de `./iconos`, `resolverNavMovil` (T1).
- Produces: `IslaNav({ nav }: { nav: NavMovil })`; Shell gana prop `navMovil: NavMovil`.

- [ ] **Step 1: Crear `src/shared/ui/IslaNav.tsx`**

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icono } from './iconos'
import type { NavMovil } from '../lib/navegacion'

/** Isla flotante híbrida (solo móvil): iconos solos; el destino ACTIVO se expande en una
 * pastilla roja con su nombre. En modo `directa` (colaborador simple) lleva los 4 accesos
 * de Lo mío; en modo `secciones` lleva las secciones (cada una abre su hub de cards). */
export function IslaNav({ nav }: { nav: NavMovil }) {
  const pathname = usePathname()

  // Destinos a pintar: [href al que navega, etiqueta de la pastilla, icono, hrefs que lo activan]
  const destinos = nav.tipo === 'directa'
    ? nav.items.map((i) => ({ href: i.href, etiqueta: i.corto ?? i.label, icono: i.icono, activadores: [i.href] }))
    : nav.secciones.map((s) => ({ href: s.href, etiqueta: s.label, icono: s.icono, activadores: [s.href, ...s.items.map((i) => i.href)] }))

  // Activo = el destino con el prefijo activador MÁS LARGO que matchea (regla del Shell)
  const mejor = destinos
    .flatMap((d) => d.activadores.map((a) => ({ d, a })))
    .filter(({ a }) => pathname === a || pathname.startsWith(a + '/'))
    .sort((x, y) => y.a.length - x.a.length)[0]?.d

  return (
    <nav aria-label="Navegación principal" className="fixed inset-x-4 z-40 md:hidden" style={{ bottom: 'max(12px, env(safe-area-inset-bottom))' }}>
      <div className="mx-auto flex max-w-md items-center justify-between rounded-full border border-gris-claro bg-white/95 px-2.5 py-2 shadow-[0_10px_30px_rgba(23,19,15,0.16)] backdrop-blur">
        {destinos.map((d) => {
          const activo = d === mejor
          return (
            <Link key={d.href} href={d.href} aria-current={activo ? 'page' : undefined}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 transition ${activo ? 'bg-hunter/10 text-hunter' : 'text-gris'}`}>
              <span className="grid w-5 place-items-center"><Icono slug={d.icono} /></span>
              {activo && <span className="whitespace-nowrap text-[11.5px] font-extrabold">{d.etiqueta}</span>}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
```

- [ ] **Step 2: Integrar en Shell y layout**

- `Shell.tsx`: nueva prop `navMovil: NavMovil` (import type desde `../lib/navegacion`); renderizar `<IslaNav nav={navMovil} />` justo antes de cerrar el div del main wrapper (después de `</main>`).
- `layout.tsx`: `import { armarGrupos, resolverNavMovil } from '@/shared/lib/navegacion'` y pasar `navMovil={resolverNavMovil(grupos)}` al `<Shell>`.

- [ ] **Step 3: Verificar**

`npx tsc --noEmit` limpio; `npx vitest run` → 176 verdes; smoke 307/200.

- [ ] **Step 4: Commit**

```bash
git add src/shared/ui/IslaNav.tsx src/shared/ui/Shell.tsx "src/app/(app)/layout.tsx"
git commit -m "feat(movil): isla flotante híbrida adaptada al rol (regla de aplanado)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Hubs de cards (`HubCards` + 3 páginas)

**Files:**
- Create: `src/shared/ui/HubCards.tsx`
- Create: `src/app/(app)/movil/lo-mio/page.tsx`, `src/app/(app)/movil/equipo/page.tsx`, `src/app/(app)/movil/admin/page.tsx`

**Interfaces:**
- Consumes: `armarGrupos` (T1), `requiereSesion` de `@/shared/lib/permisos`, `Titulo` de `@/shared/ui/componentes`, `Icono`.
- Produces: `HubCards({ items }: { items: ItemNav[] })`.

- [ ] **Step 1: Crear `src/shared/ui/HubCards.tsx`** (server-safe, sin estado)

```tsx
import Link from 'next/link'
import { Icono } from './iconos'
import type { ItemNav } from '../lib/navegacion'

/** Grid de cards de los hubs móviles: icono en chip de color + categoría + acción.
 * Paleta rotativa determinista (mismo criterio visual del mock aprobado). */
const TONOS = ['bg-red-50 text-hunter', 'bg-sky-50 text-sky-700', 'bg-emerald-50 text-emerald-700', 'bg-amber-50 text-amber-700', 'bg-purple-50 text-purple-700', 'bg-teal-50 text-teal-700']

export function HubCards({ items }: { items: ItemNav[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item, i) => (
        <Link key={item.href} href={item.href}
          className="flex min-h-[104px] flex-col justify-between gap-2.5 rounded-2xl border border-gris-claro bg-white p-3.5 transition active:scale-[0.98]">
          <span className={`grid h-9 w-9 place-items-center rounded-xl ${TONOS[i % TONOS.length]}`}>
            <Icono slug={item.icono} />
          </span>
          <span>
            {item.cat && <span className="block text-[9px] font-bold uppercase tracking-[0.08em] text-gris">{item.cat}</span>}
            <span className="block font-display text-[13.5px] font-bold leading-tight">{item.label}</span>
          </span>
        </Link>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Las 3 páginas hub** (patrón idéntico; guard por existencia del grupo)

`src/app/(app)/movil/lo-mio/page.tsx`:

```tsx
import { requiereSesion } from '@/shared/lib/permisos'
import { armarGrupos } from '@/shared/lib/navegacion'
import { HubCards } from '@/shared/ui/HubCards'
import { Titulo } from '@/shared/ui/componentes'

export default async function HubLoMioPage() {
  const sesion = await requiereSesion()
  const grupo = armarGrupos(sesion).find((g) => g.titulo === 'Lo mío')!
  return (
    <>
      <Titulo sub="Tu desempeño, objetivos y evaluaciones">Lo mío</Titulo>
      <HubCards items={grupo.items} />
    </>
  )
}
```

`src/app/(app)/movil/equipo/page.tsx` — igual con `'Mi equipo'` y guard:

```tsx
import { redirect } from 'next/navigation'
// ...
  const grupo = armarGrupos(sesion).find((g) => g.titulo === 'Mi equipo')
  if (!grupo) redirect('/hoja-de-vida')
  return (
    <>
      <Titulo sub="Gestiona los objetivos y evaluaciones de tu gente">Mi equipo</Titulo>
      <HubCards items={grupo.items} />
    </>
  )
```

`src/app/(app)/movil/admin/page.tsx` — igual con `'Administración'`, guard `redirect('/hoja-de-vida')` si no existe, `<Titulo sub="Secciones habilitadas según tu rol">Administración</Titulo>`.

- [ ] **Step 3: Verificar**

`npx tsc --noEmit` limpio; suite 176 verde; smoke a `/movil/lo-mio`, `/movil/equipo`, `/movil/admin` → 307/200, nunca 500.

- [ ] **Step 4: Commit**

```bash
git add src/shared/ui/HubCards.tsx "src/app/(app)/movil/lo-mio/page.tsx" "src/app/(app)/movil/equipo/page.tsx" "src/app/(app)/movil/admin/page.tsx"
git commit -m "feat(movil): hubs de cards por sección (Lo mío, Mi equipo, Administración)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: PWA — manifest, iconos, service worker, offline, registro

**Files:**
- Create: `src/app/manifest.ts`, `public/sw.js`, `src/app/offline/page.tsx`, `src/shared/ui/RegistrarSW.tsx`
- Create: `public/iconos/icon-192.png`, `public/iconos/icon-512.png`, `public/iconos/apple-touch-icon.png`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `src/app/icon.png` (1024×1024, existente) como fuente de los iconos.
- Produces: PWA instalable; `/offline` navegable; SW registrado solo en producción.

**ANTES de escribir**: verificar en `node_modules/next/dist/docs/` las convenciones de Next 16 para `manifest.ts`, `Viewport` y metadata `appleWebApp` (AGENTS.md manda; si difieren de lo escrito aquí, seguir la doc local y anotarlo en el reporte).

- [ ] **Step 1: Generar los iconos** (sips viene con macOS; los PNG se commitean)

```bash
mkdir -p public/iconos
sips -z 192 192 src/app/icon.png --out public/iconos/icon-192.png
sips -z 512 512 src/app/icon.png --out public/iconos/icon-512.png
sips -z 180 180 src/app/icon.png --out public/iconos/apple-touch-icon.png
```

- [ ] **Step 2: `src/app/manifest.ts`**

```ts
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Hunter 360 — Evaluación de Desempeño',
    short_name: 'Hunter 360',
    description: 'Plataforma de gestión de desempeño y talento — Hunter',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f4f1',
    theme_color: '#f6f4f1',
    icons: [
      { src: '/iconos/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/iconos/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/iconos/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
```

- [ ] **Step 3: `public/sw.js`** (mínimo, versionado; NO toca API ni datos)

```js
// Service worker mínimo de Hunter 360: precachea el cascarón y muestra /offline cuando
// una NAVEGACIÓN falla por red. Prohibido cachear API o datos de negocio (spec 2026-08-10).
const CACHE = 'hunter360-v1'
const CASCARON = ['/offline', '/iconos/icon-192.png', '/iconos/icon-512.png', '/logo/hunter-iso-red.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCARON)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return
  e.respondWith(fetch(e.request).catch(() => caches.match('/offline')))
})
```

- [ ] **Step 4: `src/app/offline/page.tsx`** (estática)

```tsx
export const dynamic = 'force-static'

export default function OfflinePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-hueso px-6 text-center">
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo/hunter-iso-red.png" alt="Hunter" className="mx-auto h-12 object-contain" />
        <h1 className="mt-4 font-display text-xl font-extrabold">Sin conexión</h1>
        <p className="mt-1 text-sm text-gris">Revisa tu red e inténtalo de nuevo.</p>
        <a href="/" className="mt-5 inline-block rounded-xl bg-hunter px-5 py-2.5 font-display text-sm font-bold text-white">Reintentar</a>
      </div>
    </main>
  )
}
```

- [ ] **Step 5: `src/shared/ui/RegistrarSW.tsx` + layout raíz**

```tsx
'use client'

import { useEffect } from 'react'

/** Registra el service worker SOLO en producción (en dev estorba con HMR). */
export function RegistrarSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])
  return null
}
```

En `src/app/layout.tsx`: añadir al objeto `metadata` → `manifest: '/manifest.webmanifest'`, `appleWebApp: { capable: true, title: 'Hunter 360', statusBarStyle: 'default' }`, `icons: { apple: '/iconos/apple-touch-icon.png' }`; exportar `viewport`:

```ts
import type { Metadata, Viewport } from 'next'

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#f6f4f1' }
```

y montar `<RegistrarSW />` dentro del `<body>` (junto a `{children}`).

- [ ] **Step 6: Verificar**

`npx tsc --noEmit` limpio; suite 176 verde.
`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/manifest.webmanifest` → 200; `curl -s http://localhost:3001/sw.js | head -3` devuelve el JS; `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/offline` → 200.

- [ ] **Step 7: Commit**

```bash
git add src/app/manifest.ts public/sw.js "src/app/offline/page.tsx" src/shared/ui/RegistrarSW.tsx src/app/layout.tsx public/iconos/icon-192.png public/iconos/icon-512.png public/iconos/apple-touch-icon.png
git commit -m "feat(pwa): manifest, iconos, service worker mínimo, página offline y registro en producción

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Banner de instalación + aviso solo-escritorio en importadores

**Files:**
- Create: `src/shared/ui/BannerInstalar.tsx`, `src/shared/ui/AvisoSoloEscritorio.tsx`
- Modify: `src/shared/ui/Shell.tsx` (montar banner bajo la topbar móvil)
- Modify: `src/app/(app)/admin/colaboradores/importar/page.tsx`, `src/app/(app)/admin/preguntas/importar/page.tsx`, `src/features/admin/maestro/CargaMaestra.tsx` (montar aviso)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `BannerInstalar()` y `AvisoSoloEscritorio()` sin props.

- [ ] **Step 1: `src/shared/ui/BannerInstalar.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'

const CLAVE = 'hunter-banner-instalar'
const DIAS_DESCARTE = 30

type EventoInstalar = Event & { prompt: () => Promise<void> }

/** Banner de instalación de la PWA (solo móvil, descartable 30 días, nunca en standalone):
 * Android/Chrome dispara el prompt nativo; iOS muestra la guía manual. */
export function BannerInstalar() {
  const [evento, setEvento] = useState<EventoInstalar | null>(null)
  const [modo, setModo] = useState<'oculto' | 'android' | 'ios'>('oculto')

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone
    if (standalone) return
    const descartado = localStorage.getItem(CLAVE)
    if (descartado && Date.now() - Number(descartado) < DIAS_DESCARTE * 86400000) return
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) { setModo('ios'); return }
    const alPrompt = (e: Event) => { e.preventDefault(); setEvento(e as EventoInstalar); setModo('android') }
    window.addEventListener('beforeinstallprompt', alPrompt)
    return () => window.removeEventListener('beforeinstallprompt', alPrompt)
  }, [])

  if (modo === 'oculto') return null

  const cerrar = () => { localStorage.setItem(CLAVE, String(Date.now())); setModo('oculto') }

  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl border border-gris-claro bg-white px-3.5 py-2.5 md:hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/iconos/icon-192.png" alt="" className="h-8 w-8 rounded-lg" />
      <p className="flex-1 text-xs font-semibold leading-snug">
        {modo === 'android'
          ? 'Instala Hunter 360 en tu pantalla de inicio'
          : 'Instálala: toca Compartir y elige “Añadir a pantalla de inicio”'}
      </p>
      {modo === 'android' && (
        <button onClick={async () => { await evento?.prompt(); cerrar() }}
          className="rounded-xl bg-hunter px-3 py-1.5 text-xs font-bold text-white">Instalar</button>
      )}
      <button onClick={cerrar} aria-label="Descartar" className="px-1 text-sm font-bold text-gris">✕</button>
    </div>
  )
}
```

Montar en `Shell.tsx` inmediatamente después de la topbar móvil: `<BannerInstalar />` (con su import).

- [ ] **Step 2: `src/shared/ui/AvisoSoloEscritorio.tsx`** + montajes

```tsx
/** Franja de cortesía para funciones exclusivas de escritorio (importadores):
 * visible solo en móvil, no bloquea. Decisión de Christian (spec 2026-08-10 §8). */
export function AvisoSoloEscritorio() {
  return (
    <p className="mb-4 rounded-xl bg-sky-50 px-3.5 py-2.5 text-xs font-semibold text-sky-800 md:hidden">
      Esta función se usa desde una computadora.
    </p>
  )
}
```

Montarlo como PRIMER elemento del contenido en: la página de importar padrón (`admin/colaboradores/importar/page.tsx`, dentro del fragmento tras el `<Titulo>`), la de importar preguntas (`admin/preguntas/importar/page.tsx`, ídem) y arriba del contenido de `CargaMaestra.tsx` (leer cada archivo y colocarlo sin desarmar la estructura).

- [ ] **Step 3: Verificar y commitear**

`npx tsc --noEmit` limpio; suite 176 verde; smoke de las 3 rutas de importadores → 307/200.

```bash
git add src/shared/ui/BannerInstalar.tsx src/shared/ui/AvisoSoloEscritorio.tsx src/shared/ui/Shell.tsx "src/app/(app)/admin/colaboradores/importar/page.tsx" "src/app/(app)/admin/preguntas/importar/page.tsx" src/features/admin/maestro/CargaMaestra.tsx
git commit -m "feat(pwa): banner de instalación (Android/iOS) + aviso solo-escritorio en importadores

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Verificación final (la ejecuta el controlador tras las 6 tareas)

- E2E Playwright con viewport 390×844 en el clone, con los 3 roles: colaborador simple (isla de 4 accesos, aplanado), jefe (isla de 2 secciones + hub de equipo), RRHH regional (3 secciones + hub admin filtrado por permisos); pastilla del activo; navegación interna mantiene sección activa; menú avatar (país + logout con confirmación); banner (mock `beforeinstallprompt` + variante iOS por UA); aviso solo-escritorio en los 3 importadores; escritorio SIN cambios (viewport 1280).
- PWA: `manifest.webmanifest` válido, `sw.js` servido, `/offline` 200; Lighthouse installable (o validación equivalente por criterios: manifest + SW + iconos); prueba real de instalación en el celular de Christian tras el deploy.
- Suite completa verde + `tsc` limpio.

## Self-Review (ejecutada)

- **Cobertura del spec**: regla de aplanado y estructura por rol (T1), isla híbrida con safe-area y reserva de padding (T2-T3), hubs de cards con categoría (T4), topbar móvil + menú avatar + país + logout confirmado en móvil Y escritorio (T2), escritorio intacto salvo logout (T2, anotado como excepción en Global Constraints), manifest+iconos 192/512+maskable+apple (T5), SW mínimo sin datos de negocio + versionado + skipWaiting/claim (T5), `/offline` (T5), registro solo producción (T5), metadata/viewport con viewportFit cover (T5), banner Android/iOS descartable 30 días y nunca standalone (T6), aviso solo-escritorio en las 3 superficies (T6), unit tests de navegación (T1), E2E como verificación final del controlador. Sin gaps.
- **Placeholders**: ninguno — todo el código está en los steps; las 2 notas de «leer el archivo antes» son de colocación/formato (iconos.tsx, montajes del aviso), no de lógica.
- **Consistencia de tipos**: `ItemNav`(+corto,+cat)/`GrupoNav`/`NavMovil`/`SeccionMovil` definidos en T1 y consumidos con esos nombres en T3 (IslaNav) y T4 (HubCards); `armarGrupos` usado por layout (T1) y hubs (T4); `resolverNavMovil` por layout (T3); `confirmar` con la firma real verificada; slug `admin` creado en T1 y referenciado por SECCION_META.
- **Riesgo señalado a la ejecución**: convenciones de Next 16 para manifest/viewport (T5 lo obliga a verificar contra la doc local); tipo real de `permisosAdmin` para los fixtures del test (T1 Step 3 nota).
