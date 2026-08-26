# Roles y permisos del módulo de Administración — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pestaña «Roles» en Configuración con matriz configurable (roles × 9 secciones del admin, niveles —/VER/GESTIONAR), creación de roles, seeds Auditor/Gerencial, y enforcement fail-closed en páginas y server actions.

**Architecture:** Tabla `RolAdmin` (permisos JSON) + `Usuario.rolAdminId` opcional. El enum `RRHH|COLABORADOR` se conserva (RRHH = rol de sistema con todo GESTIONAR + poderes de proceso). Resolutor puro `permisos-adm` alimenta la sesión (JWT re-derivado por request), un guard único `requiereAdmin(seccion, nivel)` reemplaza `requiereRrhh` en páginas (VER) y actions (GESTIONAR) según tablas de mapeo explícitas; lo no mapeado conserva `requiereRrhh` (fail-closed). El alcance país ya vive en el usuario (`alcanceRrhh`/`alcancePaisId`) y aplica igual a roles configurables.

**Tech Stack:** Next.js 16 App Router, NextAuth (JWT re-derivado en cada request), Prisma 7.8 (cliente generado VERSIONADO en `src/generated/prisma`), Tailwind 4, Vitest, Zod.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-03-roles-permisos-admin-design.md` — sus 7 reglas de negocio aplican a todas las tareas.
- UI en español neutro. Mensaje de rechazo exacto: «Tu rol no permite gestionar esta sección».
- Anti-escalada: `USUARIOS_ROLES` solo admite VER para roles creados; su gestión y las acciones de usuarios/roles exigen `requiereRrhh` (rol de sistema). Nadie edita su propio rol.
- Poderes de proceso NO entran al catálogo: aprobar objetivos de sin-jefe (`objetivos/acciones.ts`), exención de conformidad (REGIONAL), `cambiarMiPassword`. Conservan sus guards actuales.
- Fail-closed: página/action admin sin mapeo explícito en este plan conserva `requiereRrhh`.
- Prisma 7: tras tocar schema correr `npx prisma generate` **y** `npx prisma db push`; commitear `src/generated/prisma`. Cambio aditivo (tabla + columna nullable).
- Nunca `git add -A`. Mensajes de commit terminan con las 2 líneas de co-autoría de la sesión.
- Deploy solo con confirmación de Christian; orden: schema a Neon → seed → código.

---

### Task 1: Schema — `RolAdmin` + `Usuario.rolAdminId`

**Files:**
- Modify: `prisma/schema.prisma` (model Usuario ~línea 154; agregar model RolAdmin junto a Usuario)
- Modify: `src/generated/prisma/**` (regenerado, se commitea)

**Interfaces:**
- Produces: modelo Prisma `RolAdmin { id, nombre, descripcion, esSistema, permisos Json }` y relación `Usuario.rolAdmin` — los consumen Tasks 3, 4 y 7.

- [ ] **Step 1: Agregar el modelo y la relación**

En `prisma/schema.prisma`, después del `model Usuario` agregar:

```prisma
/** Rol configurable del MÓDULO DE ADMINISTRACIÓN (los roles de proceso —Jefe, Colaborador—
 * no son configurables). `permisos` = Record<SeccionAdmin, 'VER' | 'GESTIONAR'>; sección
 * ausente = sin acceso. La fila esSistema («RR.HH.») es de solo lectura en la matriz. */
model RolAdmin {
  id          String    @id @default(cuid())
  nombre      String    @unique
  descripcion String?
  esSistema   Boolean   @default(false)
  permisos    Json
  usuarios    Usuario[]
  createdAt   DateTime  @default(now())
}
```

y dentro de `model Usuario`, después de `alcancePaisId String?`:

```prisma
  rolAdminId    String? // rol admin configurable (solo aplica a rol COLABORADOR; RRHH = sistema)
  rolAdmin      RolAdmin?    @relation(fields: [rolAdminId], references: [id], onDelete: SetNull)
```

- [ ] **Step 2: Regenerar y pushear a la BD local**

```bash
cd /Users/christianisrael/Developer/hunter-plataforma-360
npx prisma generate && npx prisma db push
```

Expected: `Your database is now in sync with your Prisma schema` (BD `hunter360_prodclone`).

- [ ] **Step 3: Verificar**

```bash
psql "postgresql://localhost:5432/hunter360_prodclone" -c '\d "RolAdmin"' | head -8
```

Expected: tabla con columnas id/nombre/descripcion/esSistema/permisos.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma src/generated/prisma
git commit -m "feat: modelo RolAdmin + Usuario.rolAdminId (roles configurables del admin)"
```

---

### Task 2: Catálogo y resolutor puro (TDD)

**Files:**
- Create: `src/shared/lib/permisos-admin.ts` (PURO: sin imports de prisma/next — lo importan server y client)
- Test: `src/shared/lib/permisos-admin.test.ts`

**Interfaces:**
- Produces (consumen Tasks 3, 5, 6, 7, 8):

```ts
export const SECCIONES_ADMIN: readonly SeccionAdmin[]
export type SeccionAdmin = 'COLABORADORES' | 'PUESTOS' | 'EVALUACIONES' | 'OBJETIVOS' | 'CICLOS' | 'RESULTADOS' | 'CONFIGURACION' | 'USUARIOS_ROLES' | 'AUDITORIA'
export type NivelAdmin = 'VER' | 'GESTIONAR'
export type PermisosAdmin = Partial<Record<SeccionAdmin, NivelAdmin>>
export const ETIQUETA_SECCION: Record<SeccionAdmin, string>
export const SECCIONES_SOLO_VER: readonly SeccionAdmin[] // RESULTADOS, AUDITORIA, USUARIOS_ROLES
export function resolverPermisosAdmin(rol: 'RRHH' | 'COLABORADOR', permisosRol: unknown): PermisosAdmin
export function tieneAdmin(permisos: PermisosAdmin, seccion: SeccionAdmin, nivel: NivelAdmin): boolean
export function validarPermisosRol(permisos: unknown): { ok: true; permisos: PermisosAdmin } | { ok: false; error: string }
```

- [ ] **Step 1: Escribir el test que falla**

`src/shared/lib/permisos-admin.test.ts`:

```ts
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
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/shared/lib/permisos-admin.test.ts` — Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementación**

`src/shared/lib/permisos-admin.ts`:

```ts
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
```

- [ ] **Step 4: Verificar que pasa** — `npx vitest run` — Expected: PASS (suite completa, +9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/lib/permisos-admin.ts src/shared/lib/permisos-admin.test.ts
git commit -m "feat: catálogo de secciones admin y resolutor de permisos (puro, con tests)"
```

---

### Task 3: Sesión (JWT) + guard `requiereAdmin`

**Files:**
- Modify: `src/shared/lib/auth.ts` (jwt callback ~línea 68-95; session callback ~línea 98-106; type SesionUsuario ~línea 110; y el bloque `declare module` de tipos NextAuth — buscar `declare module 'next-auth'` en el repo, suele estar en `src/types/next-auth.d.ts` o en el propio auth.ts)
- Modify: `src/shared/lib/permisos.ts`

**Interfaces:**
- Consumes: `resolverPermisosAdmin`, `tieneAdmin`, tipos (Task 2); `Usuario.rolAdmin` (Task 1).
- Produces: `SesionUsuario.permisosAdmin: PermisosAdmin` y `requiereAdmin(seccion: SeccionAdmin, nivel: NivelAdmin): Promise<SesionUsuario>` — los consumen Tasks 5, 6, 7, 8.

- [ ] **Step 1: jwt callback carga el rol admin**

En `auth.ts`, el `findUnique` del jwt callback agrega `rolAdmin: true` al include:

```ts
        const u = await prisma.usuario.findUnique({
          where: { id: token.sub },
          include: {
            colaborador: { include: { equipo: { where: { activo: true }, select: { id: true } } } },
            rolAdmin: true,
          },
        })
```

y tras `token.alcancePaisId = u.alcancePaisId` agregar:

```ts
        token.permisosAdmin = resolverPermisosAdmin(u.rol, u.rolAdmin?.permisos)
```

(importar `resolverPermisosAdmin` y el tipo `PermisosAdmin` de `./permisos-admin`).

- [ ] **Step 2: session callback + tipos**

En el session callback: `session.user.permisosAdmin = token.permisosAdmin ?? {}`. En `SesionUsuario` agregar `permisosAdmin: PermisosAdmin`. En la declaración de tipos de NextAuth (JWT y Session.user) agregar `permisosAdmin?: PermisosAdmin`.

- [ ] **Step 3: guard en permisos.ts**

Agregar a `src/shared/lib/permisos.ts`:

```ts
import { tieneAdmin, type SeccionAdmin, type NivelAdmin } from './permisos-admin'

/** Acceso al módulo de administración por sección y nivel (VER | GESTIONAR). Fail-closed:
 * sin permiso redirige (mismo comportamiento que requiereRrhh hoy, también en actions).
 * GESTIONAR incluye VER. RRHH (rol de sistema) siempre pasa. */
export async function requiereAdmin(seccion: SeccionAdmin, nivel: NivelAdmin): Promise<SesionUsuario> {
  const sesion = await requiereSesion()
  if (!tieneAdmin(sesion.permisosAdmin, seccion, nivel)) redirect('/hoja-de-vida')
  return sesion
}
```

`requiereRrhh`, `alcancePaisWhere` y `fueraDeAlcancePais` NO cambian: el alcance ya vive en `alcanceRrhh`/`alcancePaisId` del usuario y aplica igual a roles configurables (Task 7 lo expone en la UI).

- [ ] **Step 4: Verificar** — `npx tsc --noEmit && npx vitest run` — Expected: sin errores, suite PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/lib/auth.ts src/shared/lib/permisos.ts
# + el archivo de tipos NextAuth si es aparte
git commit -m "feat: permisosAdmin en sesión (JWT re-derivado) + guard requiereAdmin"
```

---

### Task 4: Seed de roles (committeado)

**Files:**
- Create: `prisma/seed-roles-admin.ts` (NO es efímero: es parte del deploy del producto)

**Interfaces:**
- Consumes: `SECCIONES_ADMIN` (Task 2). Produces: filas `RolAdmin`: «RR.HH.» (esSistema, todo GESTIONAR), «Auditor» (todo VER), «Gerencial» (RESULTADOS+COLABORADORES VER).

- [ ] **Step 1: Escribir el seed idempotente**

```ts
// Seed de roles del módulo de administración. Idempotente (upsert por nombre):
// se corre en local y en cada entorno al deployar este feature.
//   npx tsx prisma/seed-roles-admin.ts
import { PrismaClient } from '../src/generated/prisma/client'
import { SECCIONES_ADMIN } from '../src/shared/lib/permisos-admin'

const prisma = new PrismaClient()

async function main() {
  const todoGestionar = Object.fromEntries(SECCIONES_ADMIN.map((s) => [s, 'GESTIONAR']))
  const todoVer = Object.fromEntries(SECCIONES_ADMIN.map((s) => [s, 'VER']))
  const roles = [
    { nombre: 'RR.HH.', descripcion: 'Rol de sistema: administración completa y poderes de proceso', esSistema: true, permisos: todoGestionar },
    { nombre: 'Auditor', descripcion: 'Observa toda la administración sin poder modificar nada', esSistema: false, permisos: todoVer },
    { nombre: 'Gerencial', descripcion: 'Revisa resultados/analítica y el directorio de colaboradores', esSistema: false, permisos: { RESULTADOS: 'VER', COLABORADORES: 'VER' } },
  ]
  for (const r of roles) {
    await prisma.rolAdmin.upsert({ where: { nombre: r.nombre }, create: r, update: { descripcion: r.descripcion, esSistema: r.esSistema, permisos: r.permisos } })
    console.log(`rol «${r.nombre}» ✓`)
  }
}

main().finally(() => prisma.$disconnect())
```

Nota: verificar la ruta real del client generado (`../src/generated/prisma/client` — mirar cómo importa `prisma/seed.ts` y usar el mismo patrón).

- [ ] **Step 2: Correr en local y verificar**

```bash
npx tsx prisma/seed-roles-admin.ts
psql "postgresql://localhost:5432/hunter360_prodclone" -c 'SELECT nombre, "esSistema" FROM "RolAdmin" ORDER BY nombre;'
```

Expected: Auditor(f), Gerencial(f), RR.HH.(t). Correrlo DOS veces: la segunda no debe fallar ni duplicar.

- [ ] **Step 3: Commit**

```bash
git add prisma/seed-roles-admin.ts
git commit -m "feat: seed idempotente de roles admin (RR.HH. sistema, Auditor, Gerencial)"
```

---

### Task 5: Guards de PÁGINAS + navegación + tabs de Configuración

**Files:**
- Modify: las 16 páginas admin (tabla abajo), `src/app/(app)/layout.tsx` (grupo Administración, ~línea 40), `src/app/(app)/admin/configuracion/page.tsx` (tabs)

**Interfaces:**
- Consumes: `requiereAdmin` (T3), `tieneAdmin`/`ETIQUETA_SECCION` (T2).

- [ ] **Step 1: Reemplazar el guard de cada página (nivel VER)**

Patrón (idéntico en todas): `await requiereRrhh()` → `await requiereAdmin('SECCION', 'VER')` (conservando `const sesion =` donde exista; importar `requiereAdmin` desde `@/shared/lib/permisos`). Mapa exacto:

| Página | Sección |
|---|---|
| `/admin/colaboradores` + `/inactivos` + `/importar` + `/[id]` | `COLABORADORES` |
| `/admin/puestos` + `/[id]` | `PUESTOS` |
| `/admin/preguntas` | `EVALUACIONES` |
| `/admin/transversales` · `/admin/periodos/[id]` | `OBJETIVOS` |
| `/admin/ciclos` + `/[id]` + `/[id]/editar` + `/nuevo` | `CICLOS` |
| `/admin/resultados` + `/analisis` | `RESULTADOS` |
| `/admin/configuracion` | ver Step 3 (multi-sección) |

- [ ] **Step 2: Navegación filtrada por permisos**

En `layout.tsx`, reemplazar el bloque `if (sesion.rol === 'RRHH') { grupos.push({ titulo: 'Administración', ... }) }` por construcción filtrada:

```ts
  const admin = [
    { href: '/admin/colaboradores', label: 'Colaboradores', icono: 'colaboradores', seccion: 'COLABORADORES' as const },
    { href: '/admin/puestos', label: 'Puestos y niveles', icono: 'puestos', seccion: 'PUESTOS' as const },
    { href: '/admin/preguntas', label: 'Diseñar evaluación', icono: 'preguntas', seccion: 'EVALUACIONES' as const },
    { href: '/admin/transversales', label: 'Objetivos transversales', icono: 'transversales', seccion: 'OBJETIVOS' as const },
    { href: '/admin/ciclos', label: 'Ciclos de evaluación', icono: 'ciclos', seccion: 'CICLOS' as const },
    { href: '/admin/resultados', label: 'Resultados (9-Box)', icono: 'resultados', seccion: 'RESULTADOS' as const },
    { href: '/admin/configuracion', label: 'Configuración', icono: 'configuracion', seccion: 'CONFIGURACION' as const },
  ].filter((i) => tieneAdmin(sesion.permisosAdmin, i.seccion, 'VER')
    || (i.href === '/admin/configuracion' && (tieneAdmin(sesion.permisosAdmin, 'USUARIOS_ROLES', 'VER') || tieneAdmin(sesion.permisosAdmin, 'AUDITORIA', 'VER'))))
  if (admin.length > 0) grupos.push({ titulo: 'Administración', items: admin })
```

(copiar los nombres de `icono` EXACTOS del bloque actual; el ítem Configuración también aparece si el rol solo tiene USUARIOS_ROLES o AUDITORIA, porque esos tabs viven ahí).

- [ ] **Step 3: Configuración multi-sección**

`admin/configuracion/page.tsx`: guard = `requiereSesion()` + al menos una de las tres secciones (si no, `redirect('/hoja-de-vida')`):

```ts
  const sesion = await requiereSesion()
  const ve = (s: SeccionAdmin) => tieneAdmin(sesion.permisosAdmin, s, 'VER')
  if (!ve('CONFIGURACION') && !ve('USUARIOS_ROLES') && !ve('AUDITORIA')) redirect('/hoja-de-vida')
```

y el arreglo de tabs se filtra: `modelo`+`ponderaciones` → `CONFIGURACION`; `usuarios` (y el tab `roles` de la Task 7) → `USUARIOS_ROLES`; `auditoria` → `AUDITORIA`. Las queries de datos de cada tab solo se ejecutan si su sección es visible (envolver los `Promise.all`/consultas por tab en condicionales para no filtrar datos a quien no ve el tab).

- [ ] **Step 4: Selector de país de la topbar** — buscar en `layout.tsx` la condición que muestra el combobox «Alcance de datos» (hoy keyed a RRHH) y cambiarla a `Object.keys(sesion.permisosAdmin).length > 0 && sesion.alcanceRrhh === 'REGIONAL'` (mismo comportamiento actual para RRHH, extendido a roles admin regionales).

- [ ] **Step 5: Verificar** — `npx tsc --noEmit && npx next build` — Expected: sin errores. Commit:

```bash
git add "src/app/(app)/layout.tsx" "src/app/(app)/admin"
git commit -m "feat: guards VER por sección en páginas admin + navegación y tabs filtrados por permisos"
```

---

### Task 6: Guards de ACTIONS (nivel GESTIONAR)

**Files:**
- Modify: `src/features/admin/acciones.ts`, `src/features/admin/acciones-baja.ts`, `src/features/admin/importador.ts`, `src/features/objetivos/acciones-periodo.ts`, `src/features/ciclos/acciones-rotacion.ts`, `src/features/admin/exportar.ts` (si el export vive ahí — ver Step 3)

**Interfaces:**
- Consumes: `requiereAdmin` (T3).

- [ ] **Step 1: Reemplazos en `src/features/admin/acciones.ts`**

Patrón: `const sesion = await requiereRrhh()` → `const sesion = await requiereAdmin('SECCION', 'GESTIONAR')`. Mapa por función (todas las exportadas del archivo):

| Sección | Funciones |
|---|---|
| `PUESTOS` | guardarPesosPuesto, editarFichaPuesto, alternarCompetenciaPuesto, crearArea, editarArea, eliminarArea, crearPuesto, editarPuesto, eliminarPuesto |
| `CONFIGURACION` | crearDimension, editarDimension, eliminarDimension, crearCompetencia, editarCompetencia, eliminarCompetencia, guardarConfiguracion, crearNivel, editarNivel, eliminarNivel |
| `EVALUACIONES` | crearPregunta, alternarPregunta, editarPregunta, eliminarPregunta, crearPreguntaPotencial, editarPreguntaPotencial, alternarPreguntaPotencial, eliminarPreguntaPotencial, guardarPotencialEvaluacion, crearEvaluacion, editarEvaluacion, alternarEvaluacion, eliminarEvaluacion, guardarPreguntasEvaluacion |
| `OBJETIVOS` | crearTransversal, editarTransversal, eliminarTransversal, cargarLogroTransversal |
| `CICLOS` | crearCiclo, editarEvaluacionesCiclo, editarCiclo, lanzarCiclo, eliminarCiclo, asignarPar, aprobarPar, rechazarPar, quitarParRrhh, calibrarDetallado, cerrarCiclo, cerrarPaisCiclo, publicarPaisCiclo, publicarResultados |
| `COLABORADORES` | crearColaborador, editarColaborador |
| `RESULTADOS` (nivel **VER**: exportar cuenta como Ver) | exportarResultadosCiclo → `requiereAdmin('RESULTADOS', 'VER')` |
| **NO CAMBIAN** (`requiereRrhh`) | eximirConformidad, quitarExencionConformidad (poder de proceso REGIONAL) |

- [ ] **Step 2: Los demás archivos**

- `acciones-baja.ts`: darDeBajaColaborador, reactivarColaborador → `requiereAdmin('COLABORADORES', 'GESTIONAR')`.
- `importador.ts`: importarPadron → `requiereAdmin('COLABORADORES', 'GESTIONAR')`.
- `acciones-periodo.ts`: crearPeriodo, abrirCargaPeriodo, extenderPlazoPeriodo, cerrarPeriodo, extenderPlazoColaborador, enviarRecordatoriosPeriodo → `requiereAdmin('OBJETIVOS', 'GESTIONAR')`; exportarObjetivosPeriodo → `requiereAdmin('OBJETIVOS', 'VER')`; validarVentanaCarga/extensionVigente/coberturaPeriodo son helpers de lectura sin guard propio — no tocar.
- `acciones-rotacion.ts` (incidentes): retirarDelCiclo, reasignarEvaluador, cancelarAsignacion, invalidarEvaluacion, revertirInvalidacion → `requiereAdmin('CICLOS', 'GESTIONAR')`.
- `acciones-usuarios.ts`: **NO cambia** (crearUsuario, editarAccesoUsuario, alternarActivoUsuario, resetearPasswordUsuario, aprovisionarCuentas siguen `requiereRrhh` — anti-escalada; cambiarMiPassword sigue con su guard de sesión).
- `objetivos/acciones.ts`: **NO cambia** (proceso: jefe + RRHH sobre sin-jefe).

- [ ] **Step 3: Verificar que no quedó ninguna action admin sin decidir**

```bash
grep -rn "requiereRrhh()" src/features src/app --include="*.ts" --include="*.tsx" | grep -v "acciones-usuarios\|permisos.ts"
```

Revisar cada resto contra el spec: debe ser un poder de proceso (exención de conformidad, objetivos sin-jefe) o gestión de usuarios. Cualquier otro → mapearlo aquí antes de seguir (regla fail-closed: si hay duda, se queda con `requiereRrhh` y se anota en el reporte).

- [ ] **Step 4: Verificar** — `npx tsc --noEmit && npx vitest run && npx next build`. Commit:

```bash
git add src/features/admin src/features/objetivos/acciones-periodo.ts src/features/ciclos/acciones-rotacion.ts
git commit -m "feat: guards GESTIONAR por sección en las server actions del admin (fail-closed)"
```

---

### Task 7: Pestaña «Roles» + selector de rol en Usuarios

**Files:**
- Create: `src/features/admin/acciones-roles.ts`
- Create: `src/features/admin/TablaRoles.tsx`
- Modify: `src/app/(app)/admin/configuracion/page.tsx` (tab nuevo `roles`, gated por USUARIOS_ROLES)
- Modify: `src/features/admin/PanelUsuarios.tsx` + `src/features/admin/acciones-usuarios.ts` (selector/persistencia de `rolAdminId`)

**Interfaces:**
- Consumes: `validarPermisosRol`, `SECCIONES_ADMIN`, `SECCIONES_SOLO_VER`, `ETIQUETA_SECCION`, tipos (T2); modelo RolAdmin (T1).
- Produces: `crearRol(formData)`, `editarRol(rolId, formData)`, `eliminarRol(rolId)` — `formData` trae `nombre`, `descripcion` y `permisos` (JSON string). `TablaRoles({ roles, puedeGestionar })` con `roles: { id, nombre, descripcion, esSistema, permisos, usuarios: number }[]`.

- [ ] **Step 1: Server actions de roles** — `src/features/admin/acciones-roles.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/shared/lib/prisma'
import { requiereRrhh } from '@/shared/lib/permisos'
import { validarPermisosRol } from '@/shared/lib/permisos-admin'

/** Gestión de roles del admin: EXCLUSIVA del rol de sistema RR.HH. (anti-escalada del spec). */

function parsear(formData: FormData) {
  const nombre = String(formData.get('nombre') ?? '').trim()
  const descripcion = String(formData.get('descripcion') ?? '').trim() || null
  let permisos: unknown
  try { permisos = JSON.parse(String(formData.get('permisos') ?? '{}')) } catch { permisos = null }
  return { nombre, descripcion, permisos }
}

export async function crearRol(formData: FormData) {
  const sesion = await requiereRrhh()
  const { nombre, descripcion, permisos } = parsear(formData)
  if (nombre.length < 3) return { ok: false as const, error: 'Escribe el nombre del rol (mínimo 3 caracteres)' }
  const valida = validarPermisosRol(permisos)
  if (!valida.ok) return { ok: false as const, error: valida.error }
  try {
    await prisma.rolAdmin.create({ data: { nombre, descripcion, permisos: valida.permisos } })
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') return { ok: false as const, error: 'Ya existe un rol con ese nombre' }
    throw e
  }
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'ROL_CREADO', detalle: { nombre, permisos: valida.permisos } } })
  revalidatePath('/admin/configuracion')
  return { ok: true as const }
}

export async function editarRol(rolId: string, formData: FormData) {
  const sesion = await requiereRrhh()
  const rol = await prisma.rolAdmin.findUnique({ where: { id: rolId }, include: { usuarios: { where: { id: sesion.id }, select: { id: true } } } })
  if (!rol) return { ok: false as const, error: 'Rol no encontrado' }
  if (rol.esSistema) return { ok: false as const, error: 'El rol de sistema no se puede editar' }
  if (rol.usuarios.length > 0) return { ok: false as const, error: 'No puedes editar tu propio rol' }
  const { nombre, descripcion, permisos } = parsear(formData)
  if (nombre.length < 3) return { ok: false as const, error: 'Escribe el nombre del rol (mínimo 3 caracteres)' }
  const valida = validarPermisosRol(permisos)
  if (!valida.ok) return { ok: false as const, error: valida.error }
  try {
    await prisma.rolAdmin.update({ where: { id: rolId }, data: { nombre, descripcion, permisos: valida.permisos } })
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') return { ok: false as const, error: 'Ya existe un rol con ese nombre' }
    throw e
  }
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'ROL_ACTUALIZADO', detalle: { nombre, antes: rol.permisos, despues: valida.permisos } } })
  revalidatePath('/admin/configuracion')
  return { ok: true as const }
}

export async function eliminarRol(rolId: string) {
  const sesion = await requiereRrhh()
  const rol = await prisma.rolAdmin.findUnique({ where: { id: rolId }, include: { _count: { select: { usuarios: true } } } })
  if (!rol) return { ok: false as const, error: 'Rol no encontrado' }
  if (rol.esSistema) return { ok: false as const, error: 'El rol de sistema no se puede eliminar' }
  if (rol._count.usuarios > 0) return { ok: false as const, error: `Ese rol tiene ${rol._count.usuarios} usuario${rol._count.usuarios === 1 ? '' : 's'} asignado${rol._count.usuarios === 1 ? '' : 's'}: reasígnalos antes de eliminarlo` }
  await prisma.rolAdmin.delete({ where: { id: rolId } })
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'ROL_ELIMINADO', detalle: { nombre: rol.nombre } } })
  revalidatePath('/admin/configuracion')
  return { ok: true as const }
}
```

- [ ] **Step 2: Matriz `TablaRoles.tsx`** (client). Estructura — seguir los patrones del repo (btnMiniCls, useTransition + router.refresh(), toast de `@/shared/ui/Toast`):
  - Tabla: filas = secciones (`SECCIONES_ADMIN` con `ETIQUETA_SECCION`), columnas = roles. Fila superior con nombre del rol + descripción + conteo de usuarios; RR.HH. con 🔒 y celdas fijas «✎ Gestionar».
  - Celdas de roles creados: `<select>` con — / 👁 Ver / ✎ Gestionar (las secciones de `SECCIONES_SOLO_VER` no ofrecen Gestionar). El estado vive local por rol; botón «Guardar cambios» por rol llama `editarRol` con `permisos` serializado.
  - «+ Crear rol»: formulario (nombre, descripción, selects por sección con valor inicial —) → `crearRol`.
  - «Eliminar» por rol creado (confirm inline) → `eliminarRol`.
  - Prop `puedeGestionar: boolean`: en false (rol con USUARIOS_ROLES: VER) TODO se renderiza deshabilitado/sin botones — matriz de solo lectura.

- [ ] **Step 3: Tab en Configuración** — en `admin/configuracion/page.tsx`, si `ve('USUARIOS_ROLES')`: cargar `prisma.rolAdmin.findMany({ include: { _count: { select: { usuarios: true } } }, orderBy: [{ esSistema: 'desc' }, { nombre: 'asc' }] })` y agregar tab `{ id: 'roles', label: 'Roles y permisos', icono: 'usuarios', contenido: <TablaRoles roles={...} puedeGestionar={sesion.rol === 'RRHH'} /> }` junto al tab de usuarios.

- [ ] **Step 4: Selector de rol admin en Usuarios** — `PanelUsuarios.tsx` + `acciones-usuarios.ts`:
  - `editarAccesoUsuario` y `crearUsuario` aceptan `rolAdminId: string | null`; validaciones server: si `rol === 'RRHH'` → `rolAdminId = null` (el sistema ya implica todo); si `rolAdminId` ≠ null → debe existir, no ser `esSistema`, y el usuario debe tener alcance definido (`alcanceRrhh` REGIONAL o PAIS+país) — mismo requisito que RRHH hoy; un usuario no puede cambiar su PROPIO `rolAdminId` (error «No puedes cambiar tu propio rol»). AuditLog `USUARIO_ROL_ADMIN` con antes/después.
  - UI: en la fila/formulario de usuario, selector «Rol de administración»: — (ninguno) / [roles creados]; visible junto al selector de rol de sistema y el alcance existentes. La página pasa `roles` (id+nombre, sin esSistema) al panel.

- [ ] **Step 5: Verificar** — `npx tsc --noEmit && npx vitest run && npx next build`. Commit:

```bash
git add src/features/admin/acciones-roles.ts src/features/admin/TablaRoles.tsx src/features/admin/PanelUsuarios.tsx src/features/admin/acciones-usuarios.ts "src/app/(app)/admin/configuracion/page.tsx"
git commit -m "feat: pestaña Roles y permisos (matriz + crear rol) y rol admin asignable en Usuarios"
```

---

### Task 8: Modo VER — ocultar UI de gestión

**Files:**
- Modify: páginas admin y sus paneles (lista abajo)

**Interfaces:**
- Consumes: `tieneAdmin(sesion.permisosAdmin, SECCION, 'GESTIONAR')` en cada página → prop `puedeGestionar` a los paneles.

Patrón único (mostrado completo una vez, replicar por panel):

```tsx
// page.tsx (server): const puedeGestionar = tieneAdmin(sesion.permisosAdmin, 'CICLOS', 'GESTIONAR')
// y pasarlo al panel: <PanelX puedeGestionar={puedeGestionar} ... />
// Panel (client): recibir puedeGestionar y condicionar la UI mutante:
{puedeGestionar && <button ...>+ Crear</button>}
// o reusar props soloLectura existentes: <TablaParesRrhh soloLectura={!puedeGestionar || ciclo.estado !== 'ACTIVO'} .../>
```

- [ ] **Step 1: Barrido por página** (ocultar en modo VER):
  - `/admin/colaboradores` (+`[id]`, `inactivos`): botones crear/editar/dar de baja/reactivar y link a `/importar`; la página `/importar` además exige GESTIONAR directamente (`requiereAdmin('COLABORADORES','GESTIONAR')` — corrige el guard de Task 5 para esa ruta).
  - `/admin/puestos` (+`[id]`): crear/editar/eliminar puesto-área, edición de competencias y pesos.
  - `/admin/preguntas`: alta/edición/eliminación de preguntas y evaluaciones (PanelEvaluaciones).
  - `/admin/transversales` y `/admin/periodos/[id]`: CRUD transversales, logro, abrir/cerrar/extender período, recordatorios; el detalle del período con VER muestra objetivos en lectura (sin aprobar/editar — `puedeResolver` del período pasa a exigir además GESTIONAR de OBJETIVOS… **no**: aprobar sin-jefe es proceso de RRHH → `puedeResolver` agrega `sesion.rol === 'RRHH'` como condición).
  - `/admin/ciclos` (+detalle): «＋ Crear ciclo», lanzamiento (PreflightLanzamiento solo con GESTIONAR), TablaParesRrhh (`soloLectura`), Calibrador (ocultar botón), TabIncidentes (toda la pestaña de acciones exige GESTIONAR: con VER se muestran los incidentes sin botones — prop `puedeGestionar`), TablaConformidad (la exención ya se auto-oculta por su regla REGIONAL; en VER ocultar también), PanelCierre y PanelAvancePais (botones cerrar/publicar).
  - `/admin/configuracion`: FormConfiguracion/PanelNiveles/FormModeloCompetencias con `puedeGestionar` (CONFIGURACION); PanelUsuarios/TablaRoles con `puedeGestionar` (USUARIOS_ROLES ≡ `sesion.rol === 'RRHH'`).
  - `/admin/resultados` (+análisis): ya es lectura; verificar que Calibrador no se renderice ahí (si aparece, ocultarlo sin GESTIONAR de CICLOS).

- [ ] **Step 2: Verificar** — `npx tsc --noEmit && npx next build`. Commit:

```bash
git add "src/app/(app)/admin" src/features/admin src/features/objetivos
git commit -m "feat: modo VER — paneles admin ocultan la UI de gestión según permisos"
```

---

### Task 9: Validación E2E en el clone

**Files:** ninguno (validación).

- [ ] **Step 1: Preparar** — dev server :3001; correr el seed (Task 4 ya lo dejó); crear el rol de prueba vía UI logueado como `ccalmet@webtilia.com` (RRHH): en Configuración → Roles crear «Asistente RRHH» = COLABORADORES: Gestionar + CICLOS: Ver. Asignar en la BD del clone un usuario de prueba (p. ej. Jazmin, password `Piloto2026!`):

```sql
UPDATE "Usuario" SET "rolAdminId" = (SELECT id FROM "RolAdmin" WHERE nombre = 'Asistente RRHH'), "alcanceRrhh" = 'REGIONAL' WHERE email = 'jzarzar@hunter.com.pe';
```

- [ ] **Step 2: Como Asistente (Jazmin)** — login y verificar: el menú Administración muestra SOLO Colaboradores y Ciclos de evaluación; puede crear un colaborador de prueba ✓; abre el detalle del ciclo activo y NO ve «＋ Crear ciclo», calibración sin botones, incidentes sin acciones; invocar una action de gestión de ciclos desde esa sesión (p. ej. intentar la URL de `/admin/ciclos/nuevo`) → redirige; `/admin/configuracion` → redirige.
- [ ] **Step 3: Como Auditor** — asignar Auditor a Marita por SQL igual que arriba; login: ve las 9 secciones, TODO sin un solo control de mutación (recorrer colaboradores, puestos, preguntas, períodos, ciclo completo, resultados, configuración, auditoría).
- [ ] **Step 4: Gerencial con alcance país** — asignar Gerencial a Daniela con `alcanceRrhh='PAIS'` + `alcancePaisId` de Chile: login → menú solo Colaboradores y Resultados; ambos acotados a Chile (ningún colaborador/resultado de Perú/Ecuador/Colombia visible).
- [ ] **Step 5: Matriz y auditoría** — como Christian (RRHH): editar permisos del Asistente (quitar CICLOS) → Jazmin deja de ver Ciclos al recargar (JWT re-deriva por request); intentar eliminar Asistente con Jazmin asignada → error con conteo; AuditLog muestra ROL_CREADO/ACTUALIZADO/USUARIO_ROL_ADMIN.
- [ ] **Step 6: Restaurar el clone** (`rolAdminId = NULL` en los usuarios de prueba, borrar colaborador de prueba, borrar rol Asistente) y reporte con capturas. QA de Charly con el rol Auditor (dispatch aparte).

---

## Self-review del plan

- **Cobertura del spec:** modelo ✓(T1) · catálogo/resolutor ✓(T2) · sesión/guards ✓(T3) · seeds ✓(T4) · páginas/nav/tabs ✓(T5) · actions con tabla completa de las 6 fuentes ✓(T6) · pestaña Roles + selector usuarios + candados anti-escalada ✓(T7) · modo VER ✓(T8) · validación E2E de los 3 roles + alcance país + no-escalada ✓(T9). Poderes de proceso excluidos explícitamente (T6 no-cambian + T8 puedeResolver).
- **Placeholders:** ninguno — el único punto delegado a verificación es la ruta de import del client en el seed (con instrucción de copiar el patrón de `prisma/seed.ts`).
- **Consistencia de tipos:** `requiereAdmin(seccion, nivel)` (T3) = usos en T5/T6; `tieneAdmin(permisos, seccion, nivel)` (T2) = usos en T3/T5/T8; `crearRol/editarRol/eliminarRol` (T7) consistentes con la UI descrita; `SECCIONES_SOLO_VER` incluye USUARIOS_ROLES (anti-escalada) y la matriz lo respeta.
