# Alcance flexible de ciclos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El alcance de un ciclo pasa de «un país o todos» a filtros combinables (países, áreas, niveles jerárquicos) + ajustes manuales (incluir/excluir personas) con lista previa en vivo, resueltos por un único resolutor puro que consumen el wizard, el preflight y el lanzamiento.

**Architecture:** Migración aditiva en `Ciclo` (3 arrays de foco + 2 de ajustes; `paisId` pasa a ser DERIVADO del foco). Un resolutor puro en `src/features/ciclos/alcance.ts` es la única fuente de verdad de «quiénes son los evaluados»; lo consumen `previewAlcance` (dry-run del wizard), `preflightCiclo` y `lanzarCiclo`. El cierre/congelamiento por país y `cicloFueraDeAlcance` NO cambian (siguen leyendo `paisId` derivado).

**Tech Stack:** Next.js 16 App Router (server actions), Prisma 7 (cliente generado VERSIONADO en `src/generated/prisma` — se commitea; `db push` explícito), PostgreSQL (clone local `hunter360_prodclone`), Vitest, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-08-04-alcance-flexible-ciclos-design.md` — leerla ante cualquier duda; sus decisiones mandan.

## Global Constraints

- **Semántica del foco:** dentro de una dimensión OR; entre dimensiones AND; dimensión vacía = todos. `areaId`/`nivelId` null NO cumplen una dimensión con filtro activo (igual que transversales).
- **Precedencias del resolutor (en orden):** base = cumple foco → `excluirIds` gana sobre filtros → `incluirIds` gana sobre filtros (si un id está en ambas, EXCLUIR gana) → activo + antigüedad (`excluidoPorAntiguedad`, `src/domain/antiguedad.ts`) se aplican AL FINAL a todos, incluidos los manuales.
- **`paisId` derivado:** `focoPaisIds.length === 1 ? focoPaisIds[0] : null`. Nunca se recibe del cliente ni se edita directo; lo calculan `crearCiclo`/`editarCiclo`. Los `incluirIds` de otro país NO lo alteran.
- **RRHH-país:** replicar el patrón de transversales (`acciones.ts` — `transversalFueraDeAlcance`/`focoPaisEfectivo`): server-side el foco de países se FUERZA a su país; `cicloFueraDeAlcance` no se toca.
- **No cambian:** cierre/congelamiento/avance por país (`CicloPaisCierre`, `congelamiento.ts`), generación AUTO/JEFE/ASCENDENTE e insumos cross-país de `lanzarCiclo`, pares, incidentes, conformidad, calibración, resultados.
- **Migración aditiva:** solo columnas nuevas con default; sin renombres ni drops. `npx prisma db push` en el clone local; el cliente regenerado en `src/generated/prisma` SE COMMITEA.
- **UI:** Español neutro, sin voseo. Sin emojis usados como iconos (texto plano o iconos lucide). Componentes existentes: `SelectorMultiple` (`src/shared/ui/SelectorMultiple.tsx`), `Combobox` (`src/shared/ui/Combobox.tsx`).
- **Alcance de 0 evaluados:** visible en el wizard, BLOQUEANTE en preflight/lanzamiento.
- Dev contra el clone local (`.env` ya apunta ahí). Tests: `npx vitest run` (42 existentes deben seguir verdes). Tipos: `npx tsc --noEmit`.

---

## Task 1: Schema + resolutor puro de alcance + tests

**Files:**
- Modify: `prisma/schema.prisma` (model `Ciclo`, ~línea 330)
- Create: `src/features/ciclos/alcance.ts`
- Create: `src/features/ciclos/alcance.test.ts`
- Create: `prisma/migrar-foco-paises.ts` (one-shot idempotente, SE COMMITEA — el deploy lo necesita)

**Interfaces:**
- Consumes: `excluidoPorAntiguedad(fechaIngreso: Date | null | undefined, inicioCiclo: Date): boolean` de `src/domain/antiguedad.ts`.
- Produces (las usan Tasks 2–5): `FocoCiclo`, `AjustesCiclo`, `ColaboradorAlcance`, `cumpleFoco(foco, c)`, `paisIdDerivado(focoPaisIds): string | null`, `resolverAlcance<T>(colaboradores, foco, ajustes, fechaInicioCiclo): AlcanceResuelto<T>`, `resumenAlcance(foco, nombres, nAjustes): string`.

- [ ] **Step 1: Campos nuevos en el schema**

En `model Ciclo`, reemplazar el comentario de `paisId` y agregar los arrays (después de `pais`):

```prisma
  paisId      String? // DERIVADO del foco: país único del alcance (null = multi-país/todos). Lo recalculan crearCiclo/editarCiclo; cierre por país, congelamiento y cicloFueraDeAlcance lo consumen igual que siempre.
  pais        Pais?       @relation(fields: [paisId], references: [id])
  // Alcance flexible: filtros combinables (vacío = todos; entre dimensiones se exigen todas)
  focoPaisIds  String[] @default([])
  focoAreaIds  String[] @default([])
  focoNivelIds String[] @default([])
  // Ajustes manuales sobre los filtros (colaboradorIds)
  incluirIds   String[] @default([]) // sumados aunque no cumplan filtros
  excluirIds   String[] @default([]) // quitados aunque los cumplan
```

- [ ] **Step 2: Aplicar al clone y regenerar cliente**

Run: `npx prisma db push && npx prisma generate`
Expected: «Your database is now in sync». El diff de `src/generated/prisma` se commitea junto con el schema.

- [ ] **Step 3: Tests del resolutor (fallan: el módulo no existe)**

Crear `src/features/ciclos/alcance.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { cumpleFoco, paisIdDerivado, resolverAlcance, type ColaboradorAlcance } from './alcance'

const HOY = new Date('2026-08-01T00:00:00')
const ANTIGUO = new Date('2025-01-15T00:00:00') // > 6 meses al 2026-08-01
const RECIENTE = new Date('2026-06-01T00:00:00') // < 6 meses

let seq = 0
function colab(p: Partial<ColaboradorAlcance> = {}): ColaboradorAlcance {
  seq += 1
  return { id: p.id ?? `c${seq}`, activo: true, fechaIngreso: ANTIGUO, paisId: 'CL', areaId: 'a1', nivelId: 'n1', ...p }
}
const VACIO = { focoPaisIds: [], focoAreaIds: [], focoNivelIds: [] }
const SIN_AJUSTES = { incluirIds: [], excluirIds: [] }

describe('cumpleFoco', () => {
  it('foco vacío = todos', () => {
    expect(cumpleFoco(VACIO, colab())).toBe(true)
  })
  it('OR dentro de una dimensión', () => {
    const foco = { ...VACIO, focoPaisIds: ['CL', 'PE'] }
    expect(cumpleFoco(foco, colab({ paisId: 'PE' }))).toBe(true)
    expect(cumpleFoco(foco, colab({ paisId: 'CO' }))).toBe(false)
  })
  it('AND entre dimensiones', () => {
    const foco = { focoPaisIds: ['CL'], focoAreaIds: ['a1'], focoNivelIds: ['n1'] }
    expect(cumpleFoco(foco, colab())).toBe(true)
    expect(cumpleFoco(foco, colab({ areaId: 'a2' }))).toBe(false)
    expect(cumpleFoco(foco, colab({ nivelId: 'n2' }))).toBe(false)
  })
  it('areaId/nivelId null no cumplen una dimensión con filtro activo', () => {
    expect(cumpleFoco({ ...VACIO, focoAreaIds: ['a1'] }, colab({ areaId: null }))).toBe(false)
    expect(cumpleFoco({ ...VACIO, focoNivelIds: ['n1'] }, colab({ nivelId: null }))).toBe(false)
    expect(cumpleFoco(VACIO, colab({ areaId: null, nivelId: null }))).toBe(true)
  })
})

describe('paisIdDerivado', () => {
  it('0, 1 y N países', () => {
    expect(paisIdDerivado([])).toBeNull()
    expect(paisIdDerivado(['CL'])).toBe('CL')
    expect(paisIdDerivado(['CL', 'PE'])).toBeNull()
  })
})

describe('resolverAlcance', () => {
  it('sin foco ni ajustes: todos los activos con antigüedad', () => {
    const lista = [colab({ id: 'x1' }), colab({ id: 'x2', activo: false }), colab({ id: 'x3', fechaIngreso: RECIENTE })]
    const r = resolverAlcance(lista, VACIO, SIN_AJUSTES, HOY)
    expect(r.evaluados.map((c) => c.id)).toEqual(['x1'])
    expect(r.detalle.excluidosAntiguedad).toEqual(['x3'])
  })
  it('excluir gana sobre los filtros', () => {
    const lista = [colab({ id: 'x1' }), colab({ id: 'x2' })]
    const r = resolverAlcance(lista, { ...VACIO, focoPaisIds: ['CL'] }, { incluirIds: [], excluirIds: ['x2'] }, HOY)
    expect(r.evaluados.map((c) => c.id)).toEqual(['x1'])
    expect(r.detalle.excluidosManuales).toEqual(['x2'])
  })
  it('incluir gana sobre los filtros', () => {
    const lista = [colab({ id: 'x1' }), colab({ id: 'pe1', paisId: 'PE' })]
    const r = resolverAlcance(lista, { ...VACIO, focoPaisIds: ['CL'] }, { incluirIds: ['pe1'], excluirIds: [] }, HOY)
    expect(r.evaluados.map((c) => c.id).sort()).toEqual(['pe1', 'x1'])
    expect(r.detalle.incluidosManuales).toEqual(['pe1'])
  })
  it('excluir gana sobre incluir', () => {
    const lista = [colab({ id: 'pe1', paisId: 'PE' })]
    const r = resolverAlcance(lista, { ...VACIO, focoPaisIds: ['CL'] }, { incluirIds: ['pe1'], excluirIds: ['pe1'] }, HOY)
    expect(r.evaluados).toEqual([])
    expect(r.detalle.incluidosManuales).toEqual([])
  })
  it('activo y antigüedad aplican a los incluidos manuales, con motivo', () => {
    const lista = [colab({ id: 'inact', paisId: 'PE', activo: false }), colab({ id: 'nuevo', paisId: 'PE', fechaIngreso: RECIENTE })]
    const r = resolverAlcance(lista, { ...VACIO, focoPaisIds: ['CL'] }, { incluirIds: ['inact', 'nuevo'], excluirIds: [] }, HOY)
    expect(r.evaluados).toEqual([])
    expect(r.detalle.incluidosRechazados).toEqual([
      { id: 'inact', motivo: 'INACTIVO' },
      { id: 'nuevo', motivo: 'ANTIGUEDAD' },
    ])
  })
  it('un excluido que no cumple el foco es inocuo (no se reporta)', () => {
    const lista = [colab({ id: 'pe1', paisId: 'PE' })]
    const r = resolverAlcance(lista, { ...VACIO, focoPaisIds: ['CL'] }, { incluirIds: [], excluirIds: ['pe1'] }, HOY)
    expect(r.detalle.excluidosManuales).toEqual([])
  })
  it('un incluido que ya cumple el foco no se marca como manual', () => {
    const lista = [colab({ id: 'x1' })]
    const r = resolverAlcance(lista, { ...VACIO, focoPaisIds: ['CL'] }, { incluirIds: ['x1'], excluirIds: [] }, HOY)
    expect(r.evaluados.map((c) => c.id)).toEqual(['x1'])
    expect(r.detalle.incluidosManuales).toEqual([])
  })
  it('sin fechaIngreso se incluye (regla existente: sinFechaIngreso es solo aviso)', () => {
    const r = resolverAlcance([colab({ id: 'x1', fechaIngreso: null })], VACIO, SIN_AJUSTES, HOY)
    expect(r.evaluados.map((c) => c.id)).toEqual(['x1'])
  })
})
```

- [ ] **Step 4: Correr y ver que falla**

Run: `npx vitest run src/features/ciclos/alcance.test.ts`
Expected: FAIL — «Cannot find module './alcance'».

- [ ] **Step 5: Implementar el resolutor**

Crear `src/features/ciclos/alcance.ts`:

```ts
import { excluidoPorAntiguedad } from '@/domain/antiguedad'

/** Alcance flexible del ciclo: filtros combinables + ajustes manuales.
 * ÚNICA fuente de verdad de «quiénes son los evaluados» — la consumen el preview
 * del wizard, el preflight y lanzarCiclo, así el preview nunca promete algo
 * distinto de lo que el lanzamiento genera. Puro: sin Prisma, sin fechas propias. */

export type FocoCiclo = { focoPaisIds: string[]; focoAreaIds: string[]; focoNivelIds: string[] }
export type AjustesCiclo = { incluirIds: string[]; excluirIds: string[] }
export type ColaboradorAlcance = {
  id: string
  activo: boolean
  fechaIngreso: Date | null
  paisId: string
  areaId: string | null
  nivelId: string | null // vía puesto.nivelId; sin puesto = null
}
export type MotivoRechazo = 'INACTIVO' | 'ANTIGUEDAD'
export type AlcanceResuelto<T> = {
  evaluados: T[]
  detalle: {
    incluidosManuales: string[] // entraron por incluirIds (no cumplían filtros)
    excluidosManuales: string[] // cumplían filtros pero están en excluirIds
    incluidosRechazados: { id: string; motivo: MotivoRechazo }[] // manuales frenados por reglas de negocio
    excluidosAntiguedad: string[] // del foco, fuera por antigüedad (sin contar manuales)
  }
}

/** OR dentro de cada dimensión, AND entre dimensiones, vacía = todos.
 * areaId/nivelId null NO cumplen una dimensión con filtro activo (igual que transversales). */
export function cumpleFoco(foco: FocoCiclo, c: Pick<ColaboradorAlcance, 'paisId' | 'areaId' | 'nivelId'>): boolean {
  const porPais = foco.focoPaisIds.length === 0 || foco.focoPaisIds.includes(c.paisId)
  const porArea = foco.focoAreaIds.length === 0 || (c.areaId !== null && foco.focoAreaIds.includes(c.areaId))
  const porNivel = foco.focoNivelIds.length === 0 || (c.nivelId !== null && foco.focoNivelIds.includes(c.nivelId))
  return porPais && porArea && porNivel
}

/** paisId del ciclo DERIVADO: foco de exactamente un país → ese; si no, null (multi-país/todos). */
export function paisIdDerivado(focoPaisIds: string[]): string | null {
  return focoPaisIds.length === 1 ? focoPaisIds[0] : null
}

export function resolverAlcance<T extends ColaboradorAlcance>(
  colaboradores: T[],
  foco: FocoCiclo,
  ajustes: AjustesCiclo,
  fechaInicioCiclo: Date,
): AlcanceResuelto<T> {
  const excluir = new Set(ajustes.excluirIds)
  // Un id en ambas listas: EXCLUIR gana (la UI impide llegar aquí; defensa igual)
  const incluir = new Set(ajustes.incluirIds.filter((id) => !excluir.has(id)))

  const evaluados: T[] = []
  const incluidosManuales: string[] = []
  const excluidosManuales: string[] = []
  const incluidosRechazados: { id: string; motivo: MotivoRechazo }[] = []
  const excluidosAntiguedad: string[] = []

  for (const c of colaboradores) {
    const porFoco = cumpleFoco(foco, c)
    if (excluir.has(c.id)) {
      if (porFoco) excluidosManuales.push(c.id)
      continue
    }
    const manual = !porFoco && incluir.has(c.id)
    if (!porFoco && !manual) continue
    // Reglas de negocio AL FINAL, también para los manuales: nadie inactivo o junior entra ni a mano
    if (!c.activo) {
      if (manual) incluidosRechazados.push({ id: c.id, motivo: 'INACTIVO' })
      continue
    }
    if (excluidoPorAntiguedad(c.fechaIngreso, fechaInicioCiclo)) {
      if (manual) incluidosRechazados.push({ id: c.id, motivo: 'ANTIGUEDAD' })
      else excluidosAntiguedad.push(c.id)
      continue
    }
    if (manual) incluidosManuales.push(c.id)
    evaluados.push(c)
  }
  return { evaluados, detalle: { incluidosManuales, excluidosManuales, incluidosRechazados, excluidosAntiguedad } }
}

/** El alcance en palabras, para la revisión del wizard, el detalle del ciclo y el AuditLog.
 * Ej.: «Chile y Perú · áreas: Comercial, Operaciones · niveles: Mando medio · 1 agregado manual · 1 excluido» */
export function resumenAlcance(
  foco: FocoCiclo,
  nombres: { paises: Map<string, string>; areas: Map<string, string>; niveles: Map<string, string> },
  nAjustes: { incluidos: number; excluidos: number },
): string {
  const n = (ids: string[], mapa: Map<string, string>) => ids.map((id) => mapa.get(id) ?? id)
  const partes: string[] = []
  partes.push(foco.focoPaisIds.length === 0 ? 'Todos los países' : n(foco.focoPaisIds, nombres.paises).join(' y '))
  if (foco.focoAreaIds.length > 0) partes.push(`área${foco.focoAreaIds.length === 1 ? '' : 's'}: ${n(foco.focoAreaIds, nombres.areas).join(', ')}`)
  if (foco.focoNivelIds.length > 0) partes.push(`nivel${foco.focoNivelIds.length === 1 ? '' : 'es'}: ${n(foco.focoNivelIds, nombres.niveles).join(', ')}`)
  if (nAjustes.incluidos > 0) partes.push(`${nAjustes.incluidos} agregado${nAjustes.incluidos === 1 ? '' : 's'} manual${nAjustes.incluidos === 1 ? '' : 'es'}`)
  if (nAjustes.excluidos > 0) partes.push(`${nAjustes.excluidos} excluido${nAjustes.excluidos === 1 ? '' : 's'}`)
  return partes.join(' · ')
}
```

- [ ] **Step 6: Correr los tests**

Run: `npx vitest run src/features/ciclos/alcance.test.ts`
Expected: PASS (todos). Luego `npx vitest run` completo: los 42 previos siguen verdes.

- [ ] **Step 7: Script de migración de datos (idempotente)**

Crear `prisma/migrar-foco-paises.ts` — copiar el estilo de import del cliente Prisma de `prisma/seed-roles-admin.ts` (mismo patrón de script standalone):

```ts
// One-shot idempotente: puebla focoPaisIds desde el paisId legado.
// Uso: DATABASE_URL=... npx tsx prisma/migrar-foco-paises.ts
// (los ciclos existentes ya cumplen la invariante paisId ≡ foco de 1 país)
const ciclos = await prisma.ciclo.findMany({
  where: { paisId: { not: null } },
  select: { id: true, nombre: true, paisId: true, focoPaisIds: true },
})
let actualizados = 0
for (const c of ciclos) {
  if (c.focoPaisIds.length > 0) continue // ya migrado
  await prisma.ciclo.update({ where: { id: c.id }, data: { focoPaisIds: [c.paisId!] } })
  actualizados += 1
  console.log(`ciclo «${c.nombre}» → focoPaisIds=[${c.paisId}]`)
}
console.log(`${actualizados} ciclo(s) migrado(s), ${ciclos.length - actualizados} ya estaban`)
```

Run (contra el clone): `npx tsx prisma/migrar-foco-paises.ts`
Expected: lista los ciclos existentes migrados; una segunda corrida reporta 0.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrar-foco-paises.ts src/generated/prisma src/features/ciclos/alcance.ts src/features/ciclos/alcance.test.ts
git commit -m "feat: alcance flexible de ciclos — schema aditivo + resolutor puro con tests"
```

---

## Task 2: Server actions — crear/editar ciclo con alcance + previewAlcance

**Files:**
- Modify: `src/features/admin/acciones.ts` (`esquemaCiclo` ~750, `crearCiclo` ~804, `editarCiclo` ~925; helpers junto a `cicloFueraDeAlcance` ~968)
- Create: `src/features/ciclos/acciones-alcance.ts` (server action de dry-run)

**Interfaces:**
- Consumes (Task 1): `resolverAlcance`, `cumpleFoco`, `paisIdDerivado`, `resumenAlcance`, tipos `FocoCiclo`/`AjustesCiclo`.
- Produces (las usan Tasks 3–4):
  - `type AlcanceInput = { focoPaisIds: string[]; focoAreaIds: string[]; focoNivelIds: string[]; incluirIds: string[]; excluirIds: string[] }` (exportado de `acciones.ts`)
  - `crearCiclo(formData: FormData, evaluacionIds: string[], alcance: AlcanceInput)` y `editarCiclo(cicloId: string, formData: FormData, evaluacionIds: string[], alcance: AlcanceInput)` — firmas nuevas (los únicos llamadores son `WizardCiclo.tsx`, que Task 4 actualiza; mientras tanto el build sigue tipando porque Task 4 va en la misma rama antes del merge — si el implementer necesita compilar, puede pasar `{ focoPaisIds: [], focoAreaIds: [], focoNivelIds: [], incluirIds: [], excluirIds: [] }` provisionalmente en el wizard y anotarlo en su reporte).
  - `previewAlcance(input: { foco: FocoCiclo; ajustes: AjustesCiclo; fechaInicio: string }): Promise<{ ok: true; preview: PreviewAlcance }>` (sin rama de error: el guard `requiereAdmin` redirige) con
    ```ts
    export type PreviewAlcance = {
      total: number
      porPais: { pais: string; total: number }[]
      porNivel: Record<string, number> // nivelId → evaluados (conteos del paso Evaluaciones)
      grupos: { pais: string; areas: { area: string; personas: { id: string; nombre: string; manual: boolean }[] }[] }[]
      excluidos: { id: string; nombre: string }[]
      rechazados: { id: string; nombre: string; motivo: 'INACTIVO' | 'ANTIGUEDAD' }[]
    }
    ```

- [ ] **Step 1: Helpers de validación y normalización en `acciones.ts`**

Debajo de `cicloFueraDeAlcance` (misma sección):

```ts
export type AlcanceInput = { focoPaisIds: string[]; focoAreaIds: string[]; focoNivelIds: string[]; incluirIds: string[]; excluirIds: string[] }

/** Normaliza y valida el alcance del wizard: ids contra catálogos, sin intersección
 * incluir/excluir, y el foco de países FORZADO al país del RR.HH.-país (mismo patrón
 * que focoPaisEfectivo de transversales). Devuelve el alcance saneado + paisId derivado. */
async function validarAlcanceCiclo(sesion: Awaited<ReturnType<typeof requiereRrhh>>, input: AlcanceInput) {
  const limpiar = (xs: string[]) => [...new Set(xs.map((x) => String(x).trim()).filter(Boolean))]
  const focoPaisIds = sesion.alcanceRrhh === 'PAIS' && sesion.alcancePaisId ? [sesion.alcancePaisId] : limpiar(input.focoPaisIds)
  const focoAreaIds = limpiar(input.focoAreaIds)
  const focoNivelIds = limpiar(input.focoNivelIds)
  const incluirIds = limpiar(input.incluirIds)
  const excluirIds = limpiar(input.excluirIds)

  const enAmbas = incluirIds.filter((id) => excluirIds.includes(id))
  if (enAmbas.length > 0) return { ok: false as const, error: 'Una persona no puede estar agregada y excluida a la vez' }

  const [paises, areas, niveles, personas] = await Promise.all([
    prisma.pais.count({ where: { id: { in: focoPaisIds } } }),
    prisma.area.count({ where: { id: { in: focoAreaIds } } }),
    prisma.nivelJerarquico.count({ where: { id: { in: focoNivelIds } } }),
    prisma.colaborador.count({ where: { id: { in: [...incluirIds, ...excluirIds] } } }),
  ])
  if (paises !== focoPaisIds.length || areas !== focoAreaIds.length || niveles !== focoNivelIds.length) {
    return { ok: false as const, error: 'El alcance referencia países, áreas o niveles que no existen' }
  }
  if (personas !== incluirIds.length + excluirIds.length) {
    return { ok: false as const, error: 'El alcance referencia colaboradores que no existen' }
  }
  return {
    ok: true as const,
    alcance: { focoPaisIds, focoAreaIds, focoNivelIds, incluirIds, excluirIds },
    paisId: paisIdDerivado(focoPaisIds),
  }
}
```

Imports nuevos en `acciones.ts`: `import { paisIdDerivado, resumenAlcance } from '@/features/ciclos/alcance'`.

- [ ] **Step 2: `crearCiclo` recibe y persiste el alcance**

- Firma: `export async function crearCiclo(formData: FormData, evaluacionIds: string[], alcance: AlcanceInput)`.
- Quitar `paisId` de `esquemaCiclo` (el país ya no viaja por FormData).
- Tras validar el período: `const va = await validarAlcanceCiclo(sesion, alcance); if (!va.ok) return va`.
- En el `prisma.ciclo.create` reemplazar `paisId: datos.data.paisId || null,` por:

```ts
      paisId: va.paisId,
      focoPaisIds: va.alcance.focoPaisIds,
      focoAreaIds: va.alcance.focoAreaIds,
      focoNivelIds: va.alcance.focoNivelIds,
      incluirIds: va.alcance.incluirIds,
      excluirIds: va.alcance.excluirIds,
```

- En el AuditLog `CICLO_CREADO`, dentro de `detalle`, agregar `alcance: { ...va.alcance }`.

- [ ] **Step 3: `editarCiclo` igual**

- Firma: `export async function editarCiclo(cicloId: string, formData: FormData, evaluacionIds: string[], alcance: AlcanceInput)`.
- Mismo `validarAlcanceCiclo`; en el objeto `datosCiclo` que recibe `reemplazarSnapshotEvaluaciones`, reemplazar `paisId: datos.data.paisId || null,` por el mismo bloque de 6 campos del Step 2.
- AuditLog `CICLO_EDITADO`: `detalle.despues.alcance = { ...va.alcance }`.

- [ ] **Step 4: Server action de dry-run `previewAlcance`**

Crear `src/features/ciclos/acciones-alcance.ts`:

```ts
'use server'

import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin } from '@/shared/lib/permisos'
import { resolverAlcance, type FocoCiclo, type AjustesCiclo, type MotivoRechazo } from './alcance'

export type PreviewAlcance = {
  total: number
  porPais: { pais: string; total: number }[]
  porNivel: Record<string, number>
  grupos: { pais: string; areas: { area: string; personas: { id: string; nombre: string; manual: boolean }[] }[] }[]
  excluidos: { id: string; nombre: string }[]
  rechazados: { id: string; nombre: string; motivo: MotivoRechazo }[]
}

/** Dry-run del alcance para la lista previa del wizard (y los conteos del paso Evaluaciones).
 * Corre el MISMO resolutor que usará lanzarCiclo: lo que muestra es lo que se genera. */
export async function previewAlcance(input: { foco: FocoCiclo; ajustes: AjustesCiclo; fechaInicio: string }) {
  await requiereAdmin('CICLOS', 'GESTIONAR')
  const fechaInicio = /^\d{4}-\d{2}-\d{2}$/.test(input.fechaInicio) ? new Date(`${input.fechaInicio}T00:00:00`) : new Date()
  // Todos (también inactivos): el resolutor reporta a los incluidos manuales rechazados con su motivo
  const colaboradores = await prisma.colaborador.findMany({
    select: {
      id: true, nombres: true, apellidos: true, activo: true, fechaIngreso: true,
      paisId: true, areaId: true,
      pais: { select: { nombre: true } }, area: { select: { nombre: true } },
      puesto: { select: { nivelId: true } },
    },
  })
  const enriquecidos = colaboradores.map((c) => ({ ...c, nivelId: c.puesto?.nivelId ?? null }))
  const foco: FocoCiclo = { focoPaisIds: input.foco.focoPaisIds ?? [], focoAreaIds: input.foco.focoAreaIds ?? [], focoNivelIds: input.foco.focoNivelIds ?? [] }
  const ajustes: AjustesCiclo = { incluirIds: input.ajustes.incluirIds ?? [], excluirIds: input.ajustes.excluirIds ?? [] }
  const { evaluados, detalle } = resolverAlcance(enriquecidos, foco, ajustes, fechaInicio)

  const nombreDe = (c: (typeof enriquecidos)[number]) => `${c.nombres} ${c.apellidos}`
  const porId = new Map(enriquecidos.map((c) => [c.id, c]))
  const manuales = new Set(detalle.incluidosManuales)

  const porPaisMap = new Map<string, number>()
  const porNivel: Record<string, number> = {}
  const gruposMap = new Map<string, Map<string, { id: string; nombre: string; manual: boolean }[]>>()
  for (const c of evaluados) {
    porPaisMap.set(c.pais.nombre, (porPaisMap.get(c.pais.nombre) ?? 0) + 1)
    if (c.nivelId) porNivel[c.nivelId] = (porNivel[c.nivelId] ?? 0) + 1
    const areaNombre = c.area?.nombre ?? '— Sin área'
    if (!gruposMap.has(c.pais.nombre)) gruposMap.set(c.pais.nombre, new Map())
    const areas = gruposMap.get(c.pais.nombre)!
    if (!areas.has(areaNombre)) areas.set(areaNombre, [])
    areas.get(areaNombre)!.push({ id: c.id, nombre: nombreDe(c), manual: manuales.has(c.id) })
  }
  const orden = (a: string, b: string) => a.localeCompare(b)
  const preview: PreviewAlcance = {
    total: evaluados.length,
    porPais: [...porPaisMap.entries()].sort(([a], [b]) => orden(a, b)).map(([pais, total]) => ({ pais, total })),
    porNivel,
    grupos: [...gruposMap.entries()].sort(([a], [b]) => orden(a, b)).map(([pais, areas]) => ({
      pais,
      areas: [...areas.entries()].sort(([a], [b]) => orden(a, b)).map(([area, personas]) => ({
        area,
        personas: personas.sort((x, y) => orden(x.nombre, y.nombre)),
      })),
    })),
    excluidos: detalle.excluidosManuales.map((id) => ({ id, nombre: porId.get(id) ? nombreDe(porId.get(id)!) : id })),
    rechazados: detalle.incluidosRechazados.map((r) => ({ ...r, nombre: porId.get(r.id) ? nombreDe(porId.get(r.id)!) : r.id })),
  }
  return { ok: true as const, preview }
}
```

- [ ] **Step 5: Tipos y suite**

Run: `npx tsc --noEmit`
Expected: ÚNICO error esperable: `WizardCiclo.tsx` llamando a `crearCiclo`/`editarCiclo` con 2/3 argumentos. Parche provisional en `WizardCiclo.tsx` (Task 4 lo reescribe): en `crear()`, construir `const alcance = { focoPaisIds: paisId ? [paisId] : [], focoAreaIds: [], focoNivelIds: [], incluirIds: [], excluirIds: [] }` y pasarlo como tercer argumento, y quitar `fd.set('paisId', paisId)`. Con eso `npx tsc --noEmit` queda limpio y el wizard actual sigue funcionando igual (mismo comportamiento por país).
Run: `npx vitest run` — verde.

- [ ] **Step 6: Commit**

```bash
git add src/features/admin/acciones.ts src/features/ciclos/acciones-alcance.ts src/features/admin/WizardCiclo.tsx
git commit -m "feat: crear/editar ciclo con alcance flexible + previewAlcance (dry-run del resolutor)"
```

---

## Task 3: lanzarCiclo y preflight sobre el resolutor

**Files:**
- Modify: `src/features/admin/acciones.ts` (`lanzarCiclo` ~975)
- Modify: `src/features/ciclos/preflight.ts` (`preflightCiclo` ~103, tipo `Preflight` ~77)
- Modify: `src/features/admin/PanelCiclo.tsx` (render del preflight: nuevo aviso y nuevo bloqueante)

**Interfaces:**
- Consumes (Task 1): `resolverAlcance`, tipos.
- Produces: `Preflight.avisos.incluidosRechazados: { nombre: string; motivo: 'INACTIVO' | 'ANTIGUEDAD' }[]` y `Preflight.bloqueantes.sinEvaluados: boolean`.

- [ ] **Step 1: `lanzarCiclo` usa el resolutor**

En la consulta de `todos`, agregar los campos del alcance:

```ts
  const todos = await prisma.colaborador.findMany({
    where: { activo: true },
    select: { id: true, jefeId: true, fechaIngreso: true, paisId: true, areaId: true, puesto: { select: { nivelId: true } } },
  })
```

Reemplazar las dos líneas del filtro actual —

```ts
  const puedeEvaluar = (c: { fechaIngreso: Date | null }) => !excluidoPorAntiguedad(c.fechaIngreso, ciclo.fechaInicio)
  const porId = new Map(todos.map((c) => [c.id, c]))
  const colaboradores = todos.filter((c) => (!ciclo.paisId || c.paisId === ciclo.paisId) && puedeEvaluar(c))
```

— por:

```ts
  const puedeEvaluar = (c: { fechaIngreso: Date | null }) => !excluidoPorAntiguedad(c.fechaIngreso, ciclo.fechaInicio)
  const porId = new Map(todos.map((c) => [c.id, c]))
  const { evaluados: colaboradores } = resolverAlcance(
    todos.map((c) => ({ ...c, activo: true, nivelId: c.puesto?.nivelId ?? null })),
    { focoPaisIds: ciclo.focoPaisIds, focoAreaIds: ciclo.focoAreaIds, focoNivelIds: ciclo.focoNivelIds },
    { incluirIds: ciclo.incluirIds, excluirIds: ciclo.excluirIds },
    ciclo.fechaInicio,
  )
  if (colaboradores.length === 0) return { ok: false as const, error: 'El alcance no incluye a ningún evaluado: ajusta los filtros del ciclo antes de lanzar' }
```

(`puedeEvaluar` sigue usándose para jefes/ascendentes — no tocar el resto de la función.) Import: `import { resolverAlcance } from '@/features/ciclos/alcance'`. En el AuditLog `CICLO_LANZADO`, dentro de `detalle`, agregar `alcance: { focoPaisIds: ciclo.focoPaisIds, focoAreaIds: ciclo.focoAreaIds, focoNivelIds: ciclo.focoNivelIds, incluidos: ciclo.incluirIds.length, excluidos: ciclo.excluirIds.length }`.

- [ ] **Step 2: `preflightCiclo` usa el resolutor (misma verdad que lanzará)**

En `preflight.ts`:
1. La primera consulta pierde el `where paisId` y gana campos:

```ts
    prisma.colaborador.findMany({
      where: { activo: true },
      include: {
        puesto: { include: { competencias: { select: { competenciaId: true, competencia: { select: { nombre: true } } } }, nivel: true } },
        usuario: { select: { id: true } },
      },
    }),
```

2. Reemplazar el cálculo de `excluidos`/`participantes` (líneas con `excluidoPorAntiguedad`) por:

```ts
  const foco = { focoPaisIds: ciclo.focoPaisIds, focoAreaIds: ciclo.focoAreaIds, focoNivelIds: ciclo.focoNivelIds }
  const ajustes = { incluirIds: ciclo.incluirIds, excluirIds: ciclo.excluirIds }
  const resuelto = resolverAlcance(
    colaboradores.map((c) => ({ ...c, nivelId: c.puesto?.nivelId ?? null })),
    foco, ajustes, ciclo.fechaInicio,
  )
  const participantes = resuelto.evaluados
  const porIdColab = new Map(colaboradores.map((c) => [c.id, c]))
  const excluidos = resuelto.detalle.excluidosAntiguedad.map((id) => porIdColab.get(id)!)
```

3. Incluidos manuales rechazados por INACTIVO: la consulta base es `activo: true`, así que se buscan aparte los inactivos referenciados:

```ts
  const inactivosIncluidos = ciclo.incluirIds.length === 0 ? [] : await prisma.colaborador.findMany({
    where: { id: { in: ciclo.incluirIds }, activo: false },
    select: { nombres: true, apellidos: true },
  })
  const incluidosRechazados = [
    ...inactivosIncluidos.map((c) => ({ nombre: `${c.nombres} ${c.apellidos}`, motivo: 'INACTIVO' as const })),
    ...resuelto.detalle.incluidosRechazados
      .filter((r) => r.motivo === 'ANTIGUEDAD')
      .map((r) => ({ nombre: porIdColab.has(r.id) ? nombreDe(porIdColab.get(r.id)!) : r.id, motivo: 'ANTIGUEDAD' as const })),
  ]
```

4. Tipo `Preflight`: `avisos` gana `incluidosRechazados: { nombre: string; motivo: 'INACTIVO' | 'ANTIGUEDAD' }[]`; `bloqueantes` gana `sinEvaluados: boolean`. En el `return`: `sinEvaluados: participantes.length === 0` dentro de `bloqueantes`, `incluidosRechazados` dentro de `avisos`, y `listo` pasa a `... && !bloqueantes.sinEvaluados`.
Import: `import { resolverAlcance } from './alcance'`.

- [ ] **Step 3: Render en `PanelCiclo.tsx`**

Donde se listan los bloqueantes del preflight, agregar (mismo estilo de los existentes): si `preflight.bloqueantes.sinEvaluados` → «El alcance no incluye a ningún evaluado: edita el ciclo y ajusta filtros o ajustes manuales.» Donde se listan los avisos: si `preflight.avisos.incluidosRechazados.length > 0` → «Agregados manualmente que NO entrarán: {nombre} (inactivo) · {nombre} (menos de 6 meses de antigüedad al inicio)». Buscar el patrón de render de `excluidosAntiguedad` en ese archivo y replicarlo.

- [ ] **Step 4: Verificar en el clone**

Run: `npx tsc --noEmit && npx vitest run`
Expected: limpio y verde.
Verificación de REGRESIÓN contra el clone (los ciclos viejos resuelven lo mismo): con el dev levantado, abrir el detalle de un ciclo BORRADOR existente (o crear uno de prueba por país) y comparar el conteo del preflight antes/después del cambio — debe ser idéntico. Documentar el conteo en el reporte.

- [ ] **Step 5: Commit**

```bash
git add src/features/admin/acciones.ts src/features/ciclos/preflight.ts src/features/admin/PanelCiclo.tsx
git commit -m "feat: lanzamiento y preflight del ciclo resueltos por el resolutor de alcance"
```

---

## Task 4: Wizard — paso Alcance con filtros, ajustes y lista previa

**Files:**
- Modify: `src/features/admin/WizardCiclo.tsx` (paso 2 completo, `CicloEdicion`, `crear()`, paso 3 conteos, paso 4 revisión)
- Modify: `src/app/(app)/admin/ciclos/nuevo/page.tsx` (pasar áreas, niveles-catálogo, colaboradores y paisFijo)
- Modify: `src/app/(app)/admin/ciclos/[id]/editar/page.tsx` (ídem + precarga del alcance)

**Interfaces:**
- Consumes: `previewAlcance` + `PreviewAlcance` (Task 2), `crearCiclo`/`editarCiclo` con `AlcanceInput` (Task 2), `SelectorMultiple` (`{ etiqueta, opciones: {id,nombre}[], seleccion: string[], onCambio }`), `Combobox` (`{ name, opciones: {id,nombre,detalle?}[], textoVacio, onChange }`).
- Produces: `WizardCiclo` con props nuevas `areas: { id: string; nombre: string }[]`, `nivelesCatalogo: { id: string; nombre: string }[]`, `colaboradores: { id: string; nombre: string; detalle: string }[]` (activos, `detalle` = `país · área`), `paisFijo?: { id: string; nombre: string }`; `CicloEdicion` gana `focoPaisIds/focoAreaIds/focoNivelIds/incluirIds/excluirIds: string[]`.

- [ ] **Step 1: Estado y envío del alcance**

En `WizardCiclo`, reemplazar `const [paisId, setPaisId] = useState(...)` por:

```ts
  const [focoPaisIds, setFocoPaisIds] = useState<string[]>(edicion?.focoPaisIds ?? (paisFijo ? [paisFijo.id] : []))
  const [focoAreaIds, setFocoAreaIds] = useState<string[]>(edicion?.focoAreaIds ?? [])
  const [focoNivelIds, setFocoNivelIds] = useState<string[]>(edicion?.focoNivelIds ?? [])
  const [incluirIds, setIncluirIds] = useState<string[]>(edicion?.incluirIds ?? [])
  const [excluirIds, setExcluirIds] = useState<string[]>(edicion?.excluirIds ?? [])
  const [preview, setPreview] = useState<PreviewAlcance | null>(null)
```

En `crear()`: quitar `fd.set('paisId', paisId)` y pasar `const alcance = { focoPaisIds, focoAreaIds, focoNivelIds, incluirIds, excluirIds }` como tercer argumento de `crearCiclo`/`editarCiclo` (reemplaza el parche provisional del Task 2).

- [ ] **Step 2: Preview en vivo (debounce)**

```ts
  useEffect(() => {
    const t = setTimeout(async () => {
      const res = await previewAlcance({
        foco: { focoPaisIds, focoAreaIds, focoNivelIds },
        ajustes: { incluirIds, excluirIds },
        fechaInicio,
      })
      if (res.ok) setPreview(res.preview)
    }, 400)
    return () => clearTimeout(t)
  }, [focoPaisIds, focoAreaIds, focoNivelIds, incluirIds, excluirIds, fechaInicio])
```

(import `useEffect`; `previewAlcance` de `@/features/ciclos/acciones-alcance`.)

- [ ] **Step 3: Paso 2 — los tres bloques**

Reemplazar el bloque `{paso === 2 && (...)}` completo por:

```tsx
        {paso === 2 && (
          <div className="space-y-4">
            <p className="text-sm">Alcance del ciclo: los filtros definen a los <b>evaluados</b> (quienes reciben calificación). El sistema generará autoevaluación, evaluación de jefe y ascendente para cada uno; los pares se asignan después. Jefe y reportes evalúan aunque estén fuera del alcance.</p>
            <div className="grid gap-3 md:grid-cols-3">
              {paisFijo ? (
                <div>
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gris">Países</span>
                  <p className="rounded-xl border border-gris-claro bg-hueso-2 px-3.5 py-2.5 text-sm text-gris">{paisFijo.nombre} (tu alcance)</p>
                </div>
              ) : (
                <SelectorMultiple etiqueta="Países" opciones={paises} seleccion={focoPaisIds} onCambio={setFocoPaisIds} />
              )}
              <SelectorMultiple etiqueta="Áreas" opciones={areas} seleccion={focoAreaIds} onCambio={setFocoAreaIds} />
              <SelectorMultiple etiqueta="Niveles jerárquicos" opciones={nivelesCatalogo} seleccion={focoNivelIds} onCambio={setFocoNivelIds} />
            </div>

            {/* Ajustes manuales: el buscador decide la acción según si la persona ya está en el alcance */}
            <div className="rounded-xl border border-gris-claro bg-hueso/50 p-3.5">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gris">Ajustes manuales</p>
              <Combobox
                name="ajuste"
                opciones={colaboradores.filter((c) => !incluirIds.includes(c.id) && !excluirIds.includes(c.id))}
                textoVacio="Buscar persona para agregar o excluir…"
                onChange={(id) => {
                  if (!id) return
                  const enAlcance = preview?.grupos.some((g) => g.areas.some((a) => a.personas.some((p) => p.id === id)))
                  if (enAlcance) setExcluirIds((xs) => [...xs, id])
                  else setIncluirIds((xs) => [...xs, id])
                }}
              />
              {(incluirIds.length > 0 || excluirIds.length > 0) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {incluirIds.map((id) => (
                    <button key={id} type="button" onClick={() => setIncluirIds((xs) => xs.filter((x) => x !== id))}
                      className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
                      title="Quitar ajuste">
                      {colaboradores.find((c) => c.id === id)?.nombre ?? id} · agregado ✕
                    </button>
                  ))}
                  {excluirIds.map((id) => (
                    <button key={id} type="button" onClick={() => setExcluirIds((xs) => xs.filter((x) => x !== id))}
                      className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-bold text-hunter-dark hover:bg-red-100"
                      title="Quitar ajuste">
                      {colaboradores.find((c) => c.id === id)?.nombre ?? id} · excluido ✕
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Lista previa */}
            <div className="rounded-xl border border-gris-claro p-3.5">
              {preview === null ? (
                <p className="text-sm text-gris">Calculando alcance…</p>
              ) : (
                <>
                  <p className="text-sm">
                    <span className="font-display text-2xl font-bold">{preview.total}</span> evaluado{preview.total === 1 ? '' : 's'}
                    {preview.porPais.length > 1 && <span className="text-gris"> · {preview.porPais.map((p) => `${p.pais} ${p.total}`).join(' · ')}</span>}
                  </p>
                  {preview.total === 0 && <p className="mt-1 text-xs text-hunter-dark">Con estos filtros nadie queda en el ciclo: no se podrá lanzar.</p>}
                  {preview.rechazados.length > 0 && (
                    <p className="mt-1 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                      No entrarán aunque los agregaste: {preview.rechazados.map((r) => `${r.nombre} (${r.motivo === 'INACTIVO' ? 'inactivo' : 'menos de 6 meses de antigüedad'})`).join(' · ')}
                    </p>
                  )}
                  <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
                    {preview.grupos.map((g) => (
                      <div key={g.pais}>
                        <p className="text-xs font-bold uppercase tracking-wide text-gris">{g.pais}</p>
                        {g.areas.map((a) => (
                          <p key={a.area} className="ml-3 text-[13px]">
                            <span className="font-semibold">{a.area}:</span>{' '}
                            {a.personas.map((p) => p.manual ? <b key={p.id} title="Agregado manualmente"> {p.nombre}*</b> : <span key={p.id}> {p.nombre} ·</span>)}
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                  {incluirIds.length > 0 && <p className="mt-1 text-[11px] text-gris">* agregado manualmente (fuera de los filtros)</p>}
                </>
              )}
            </div>
          </div>
        )}
```

(El markup exacto puede pulirse al estilo del archivo; lo NO negociable: 3 selectores, buscador con acción según pertenencia, chips removibles, conteo dominante, desglose por país, lista país → área con marca de manuales, aviso de 0 evaluados y de rechazados.)

Borde del spec — **chips redundantes atenuados**: si al cambiar los filtros un ajuste pierde sentido, el chip se conserva (el resolutor lo trata como inocuo) pero se muestra atenuado (`opacity-60`) con nota: un `incluirIds` cuya persona aparece en el preview con `manual === false` → «ya lo cubren los filtros»; un `excluirIds` cuyo id NO está en `preview.excluidos` → «ya no está en el alcance».

- [ ] **Step 4: Paso 3 y paso 4**

- `SelectorEvaluaciones`: reemplazar la prop `paisId?: string` por `conteos?: Record<string, number>` (nivelId → evaluados del alcance). `conteoDe = (n) => conteos ? (conteos[n.id] ?? 0) : n.colaboradores`; el sufijo «en el alcance» se muestra cuando `conteos` viene definido. El wizard pasa `conteos={preview?.porNivel}`. Revisar el otro llamador de `SelectorEvaluaciones` (`src/features/admin/EditarEvaluacionesCiclo.tsx`): allí no hay preview — pasar `undefined` (usa totales, comportamiento actual sin país ya era ese fallback).
- Paso 4 (revisión): reemplazar `<li><b>Alcance:</b> {paisId ? ... : 'Todos los países'}</li>` por el resumen en palabras + conteo:

```tsx
              <li><b>Alcance:</b> {[
                focoPaisIds.length === 0 ? 'Todos los países' : paises.filter((p) => focoPaisIds.includes(p.id)).map((p) => p.nombre).join(' y '),
                focoAreaIds.length > 0 ? `áreas: ${areas.filter((a) => focoAreaIds.includes(a.id)).map((a) => a.nombre).join(', ')}` : null,
                focoNivelIds.length > 0 ? `niveles: ${nivelesCatalogo.filter((n) => focoNivelIds.includes(n.id)).map((n) => n.nombre).join(', ')}` : null,
                incluirIds.length > 0 ? `${incluirIds.length} agregado${incluirIds.length === 1 ? '' : 's'} manual${incluirIds.length === 1 ? '' : 'es'}` : null,
                excluirIds.length > 0 ? `${excluirIds.length} excluido${excluirIds.length === 1 ? '' : 's'}` : null,
              ].filter(Boolean).join(' · ')} — {preview?.total ?? '…'} evaluados</li>
```

- `CicloEdicion` gana los 5 arrays (`focoPaisIds: string[]` etc.).

- [ ] **Step 5: Las dos páginas alimentan el wizard**

En `src/app/(app)/admin/ciclos/nuevo/page.tsx` y `.../[id]/editar/page.tsx`, ampliar el `Promise.all` y las props:

```ts
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR') // en nuevo/page.tsx hoy no captura la sesión: capturarla
  const [nivelesW, paises, periodos, areas, nivelesCatalogo, colaboradores] = await Promise.all([
    nivelesParaSelectorEvaluaciones(),
    prisma.pais.findMany({ orderBy: { codigo: 'asc' } }),
    prisma.periodoObjetivos.findMany({ where: { estado: { in: ['CERRADO', 'CARGA_ABIERTA'] } }, orderBy: { createdAt: 'desc' } }),
    prisma.area.findMany({ orderBy: { nombre: 'asc' } }),
    prisma.nivelJerarquico.findMany({ orderBy: { orden: 'asc' } }),
    prisma.colaborador.findMany({
      where: { activo: true },
      select: { id: true, nombres: true, apellidos: true, pais: { select: { nombre: true } }, area: { select: { nombre: true } } },
      orderBy: [{ apellidos: 'asc' }],
    }),
  ])
  const paisFijo = sesion.alcanceRrhh === 'PAIS' && sesion.alcancePaisId
    ? { id: sesion.alcancePaisId, nombre: paises.find((p) => p.id === sesion.alcancePaisId)?.nombre ?? '' }
    : undefined
```

Props: `areas={areas.map((a) => ({ id: a.id, nombre: a.nombre }))}`, `nivelesCatalogo={nivelesCatalogo.map((n) => ({ id: n.id, nombre: n.nombre }))}`, `colaboradores={colaboradores.map((c) => ({ id: c.id, nombre: `${c.nombres} ${c.apellidos}`, detalle: `${c.pais.nombre} · ${c.area?.nombre ?? 'Sin área'}` }))}`, `paisFijo={paisFijo}`. En editar/page.tsx, `edicion` gana `focoPaisIds: ciclo.focoPaisIds, focoAreaIds: ciclo.focoAreaIds, focoNivelIds: ciclo.focoNivelIds, incluirIds: ciclo.incluirIds, excluirIds: ciclo.excluirIds` y se elimina `paisId` de `CicloEdicion`.

- [ ] **Step 6: Verificación manual en el clone**

Run: `npx tsc --noEmit && npx vitest run` — limpio/verde. Con el dev en :3001, crear un ciclo de prueba: filtros Chile + un área, ver la lista previa cambiar en vivo, excluir a una persona, agregar a alguien de Perú, verificar paso 3 (conteos «en el alcance») y paso 4 (resumen). Guardar como borrador, reabrir con «Editar ciclo» y confirmar la precarga completa. Eliminar el borrador de prueba al final.

- [ ] **Step 7: Commit**

```bash
git add src/features/admin/WizardCiclo.tsx "src/app/(app)/admin/ciclos/nuevo/page.tsx" "src/app/(app)/admin/ciclos/[id]/editar/page.tsx" src/features/admin/EditarEvaluacionesCiclo.tsx
git commit -m "feat: paso Alcance del wizard — filtros combinables, ajustes manuales y lista previa en vivo"
```

---

## Task 5: Detalle del ciclo muestra el alcance + verificación integral

**Files:**
- Modify: `src/app/(app)/admin/ciclos/[id]/page.tsx` (línea ~717: el `sub` del título)
- Test: verificación integral en el clone (sin archivos nuevos)

**Interfaces:**
- Consumes: `resumenAlcance` (Task 1).

- [ ] **Step 1: Resumen del alcance en el detalle**

En `page.tsx` línea ~717, reemplazar `${ciclo.pais ? ciclo.pais.nombre : 'Todos los países'}` por el resumen. Los catálogos: la página ya consulta el ciclo; agregar al `Promise.all` existente (o consultas nuevas junto a las demás) `prisma.pais.findMany({ select: { id: true, nombre: true } })`, `prisma.area.findMany({ select: { id: true, nombre: true } })`, `prisma.nivelJerarquico.findMany({ select: { id: true, nombre: true } })` y construir:

```ts
  const alcanceTexto = resumenAlcance(
    { focoPaisIds: ciclo.focoPaisIds, focoAreaIds: ciclo.focoAreaIds, focoNivelIds: ciclo.focoNivelIds },
    {
      paises: new Map(paisesCat.map((x) => [x.id, x.nombre])),
      areas: new Map(areasCat.map((x) => [x.id, x.nombre])),
      niveles: new Map(nivelesCat.map((x) => [x.id, x.nombre])),
    },
    { incluidos: ciclo.incluirIds.length, excluidos: ciclo.excluirIds.length },
  )
```

y usar `${alcanceTexto}` en el `sub`. (Para ciclos legados sin foco migrado en el clone, correr antes `npx tsx prisma/migrar-foco-paises.ts`; un ciclo con foco vacío y `paisId` null muestra «Todos los países», correcto.)

- [ ] **Step 2: Verificación integral E2E en el clone (el caso del spec)**

Con el dev en :3001 y datos del clone:
1. Crear ciclo «QA Alcance» con foco = Chile + un área con gente + nivel con gente, excluir 1 persona que cumple, incluir 1 persona de Perú. Anotar el total del preview.
2. Preflight en el detalle: mismo total; lanzar.
3. Verificar con una consulta (`npx tsx` efímero en `$CLAUDE_JOB_DIR/tmp/`, NO commitear): `asignacion.groupBy({ by: ['tipo'], where: { cicloId } })` y `asignacion.findMany({ where: { cicloId, tipo: 'AUTO' } })` → el set de evaluados (AUTO) coincide EXACTO con el preview (incluida la persona de Perú, sin la excluida).
4. «Avance por país» del ciclo lista Chile y Perú.
5. Regresión: un ciclo viejo por país (migrado) sigue mostrando su preflight con el mismo conteo de antes del feature.
6. Borrar el ciclo de prueba QA (si quedó lanzado, restaurar el clone desde prod como se hizo en sesiones anteriores, o dejarlo documentado en el reporte).

- [ ] **Step 3: Suite completa + commit**

Run: `npx tsc --noEmit && npx vitest run && npx next lint --quiet 2>/dev/null || true`
Expected: tipos limpios, tests verdes.

```bash
git add "src/app/(app)/admin/ciclos/[id]/page.tsx"
git commit -m "feat: el detalle del ciclo muestra el alcance flexible en palabras"
```

---

## Notas de deploy (para el final, con confirmación de Christian)

Orden: (1) `npx prisma db push` a Neon (columnas aditivas con default — el código viejo las ignora), (2) `npx tsx prisma/migrar-foco-paises.ts` contra Neon (puebla `focoPaisIds` de los ciclos existentes), (3) `git push` → Vercel. Menos frágil que el deploy de roles (el código nuevo tolera focos vacíos: significa «todos»), pero si el código llega antes que la migración de datos, un ciclo por país legado resolvería como regional — respetar el orden.
