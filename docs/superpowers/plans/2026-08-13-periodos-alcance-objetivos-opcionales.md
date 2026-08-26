# Períodos con alcance + objetivos opcionales + borrar borradores — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Períodos de objetivos con alcance flexible restrictivo (país/área/nivel + incluir/excluir), ciclos que pueden NO evaluar objetivos (`periodoId` opcional, nota 100% competencias), borrado de períodos en BORRADOR y página dedicada `/admin/periodos/nuevo`.

**Architecture:** Se reutiliza el resolutor puro de alcance de ciclos (`src/features/ciclos/alcance.ts`) generalizando `fechaInicio` a `Date | null` (null = sin regla de antigüedad, el caso del período). Un helper nuevo `src/features/objetivos/alcance-periodo.ts` es la única fuente de verdad de «quién está en el alcance del período» y lo consumen apertura, guards de carga, cobertura, recordatorios, vistas y export. El ciclo sin objetivos aprovecha la renormalización que YA existe en `notaFinal` (cumplimiento null + 0 objetivos → 100% competencias).

**Tech Stack:** Next.js 16 App Router (server actions), Prisma 7.8 (cliente COMMITEADO en `src/generated/prisma`), Vitest, Tailwind 4.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-13-periodos-alcance-objetivos-opcionales-design.md`.
- SIEMPRE verificar convenciones Next 16 en `node_modules/next/dist/docs/` antes de tocar rutas/manifest.
- Prisma 7: tras editar `prisma/schema.prisma`, `npx prisma generate` hace db push automático contra el clone local (`.env`). El cliente generado (`src/generated/prisma`) SE COMMITEA.
- Español neutro en todo el copy de UI. Sin emojis como iconos (usar `Icono`/lucide).
- Tests de integración con Prisma: sociedades/fixtures con prefijo `TST` y limpieza al final (patrón del repo).
- El país del RRHH-país es el TECHO de cualquier alcance (patrón `validarAlcanceCiclo`/`previewAlcance`).
- Alcance vacío (5 arrays `[]`) = toda la organización (retro-compat de períodos existentes).
- Suite completa: `npx vitest run` (hoy ~176 tests, todos verdes antes y después de cada task).
- NO tocar los scripts efímeros untracked de `prisma/` ni commitearlos.

---

### Task 1: Schema + resolutor sin antigüedad + helper de alcance del período

**Files:**
- Modify: `prisma/schema.prisma` (modelos `PeriodoObjetivos` y `Ciclo`)
- Modify: `src/features/ciclos/alcance.ts:49-96` (firma `fechaInicioCiclo`)
- Modify: `src/features/ciclos/alcance.test.ts` (casos nuevos)
- Create: `src/features/objetivos/alcance-periodo.ts`
- Test: `src/features/objetivos/alcance-periodo.test.ts`

**Interfaces:**
- Consumes: `resolverAlcance`, `cumpleFoco`, `FocoCiclo`, `AjustesCiclo` de `@/features/ciclos/alcance`.
- Produces (para Tasks 2-4, 7-8):
  - `resolverAlcance(colaboradores, foco, ajustes, fechaInicio: Date | null)` — con `null` NO excluye por antigüedad (motivo `ANTIGUEDAD` imposible).
  - `type PeriodoConAlcance = Pick<PeriodoObjetivos, 'focoPaisIds' | 'focoAreaIds' | 'focoNivelIds' | 'incluirIds' | 'excluirIds'>`
  - `estaEnAlcancePeriodo(periodo: PeriodoConAlcance, c: { id, activo, paisId, areaId, nivelId }): boolean`
  - `colaboradoresDelPeriodo(periodo: PeriodoConAlcance & { id: string }): Promise<ColaboradorPeriodo[]>` donde `ColaboradorPeriodo = { id, nombres, apellidos, paisId, areaId, puestoId, nivelId, jefeId }`

- [ ] **Step 1: Schema — alcance en PeriodoObjetivos y periodoId opcional en Ciclo**

En `prisma/schema.prisma`, agregar a `model PeriodoObjetivos` (después de `fechaLimiteCarga`):

```prisma
  // Alcance flexible (vacío = toda la organización). Mismo modelo que Ciclo; el período
  // NO aplica regla de antigüedad (un ingreso reciente también carga objetivos).
  focoPaisIds  String[] @default([])
  focoAreaIds  String[] @default([])
  focoNivelIds String[] @default([])
  incluirIds   String[] @default([])
  excluirIds   String[] @default([])
```

En `model Ciclo`, cambiar:

```prisma
  periodoId String
  periodo   PeriodoObjetivos @relation(fields: [periodoId], references: [id])
```

por:

```prisma
  // null = el ciclo NO evalúa objetivos: nota final 100% competencias (renormaliza notaFinal)
  periodoId String?
  periodo   PeriodoObjetivos? @relation(fields: [periodoId], references: [id])
```

- [ ] **Step 2: Regenerar cliente (db push automático al clone local)**

Run: `npx prisma generate`
Expected: `Generated Prisma Client` sin errores. `git status` muestra `src/generated/prisma` modificado (SE COMMITEA).

- [ ] **Step 3: Test que falla — resolverAlcance con fecha null no excluye por antigüedad**

En `src/features/ciclos/alcance.test.ts` agregar (usar los builders/fixtures ya presentes en el archivo; si define un helper `colab(...)`, reutilizarlo):

```ts
describe('resolverAlcance con fechaInicio null (uso del período de objetivos)', () => {
  const foco = { focoPaisIds: [], focoAreaIds: [], focoNivelIds: [] }
  const ajustes = { incluirIds: [], excluirIds: [] }
  const reciente = {
    id: 'c-nuevo', activo: true, paisId: 'p1', areaId: null, nivelId: null,
    fechaIngreso: new Date(), // ingresó HOY: un ciclo lo excluiría por antigüedad
  }

  it('null: el ingreso reciente ENTRA (sin regla de antigüedad)', () => {
    const r = resolverAlcance([reciente], foco, ajustes, null)
    expect(r.evaluados.map((c) => c.id)).toEqual(['c-nuevo'])
    expect(r.detalle.excluidosAntiguedad).toEqual([])
  })

  it('con fecha: se mantiene la exclusión por antigüedad', () => {
    const r = resolverAlcance([reciente], foco, ajustes, new Date())
    expect(r.evaluados).toEqual([])
    expect(r.detalle.excluidosAntiguedad).toEqual(['c-nuevo'])
  })
})
```

- [ ] **Step 4: Correr y ver el fallo de tipos/comportamiento**

Run: `npx vitest run src/features/ciclos/alcance.test.ts`
Expected: FAIL (TS no acepta `null` en el 4.º parámetro).

- [ ] **Step 5: Generalizar la firma**

En `src/features/ciclos/alcance.ts`:

```ts
export function resolverAlcance<T extends ColaboradorAlcance>(
  colaboradores: T[],
  foco: FocoCiclo,
  ajustes: AjustesCiclo,
  // Fecha de inicio del ciclo para la regla de antigüedad; null = SIN regla (alcance de
  // un período de objetivos: un ingreso reciente también carga objetivos)
  fechaInicio: Date | null,
): AlcanceResuelto<T> {
```

y el bloque de antigüedad queda:

```ts
    if (fechaInicio !== null && excluidoPorAntiguedad(c.fechaIngreso, fechaInicio)) {
```

(el resto del cuerpo no cambia; los callers existentes pasan `Date` y compilan igual).

- [ ] **Step 6: Verificar en verde**

Run: `npx vitest run src/features/ciclos/alcance.test.ts`
Expected: PASS (casos previos intactos + 2 nuevos).

- [ ] **Step 7: Test que falla — helper del período**

Create `src/features/objetivos/alcance-periodo.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { estaEnAlcancePeriodo } from './alcance-periodo'

const base = { focoPaisIds: [], focoAreaIds: [], focoNivelIds: [], incluirIds: [], excluirIds: [] }
const ana = { id: 'ana', activo: true, paisId: 'cl', areaId: 'com', nivelId: 'mm' }

describe('estaEnAlcancePeriodo', () => {
  it('alcance vacío = toda la organización', () => {
    expect(estaEnAlcancePeriodo(base, ana)).toBe(true)
  })
  it('foco combinado: AND entre dimensiones', () => {
    expect(estaEnAlcancePeriodo({ ...base, focoPaisIds: ['cl'], focoAreaIds: ['com'] }, ana)).toBe(true)
    expect(estaEnAlcancePeriodo({ ...base, focoPaisIds: ['cl'], focoAreaIds: ['ops'] }, ana)).toBe(false)
  })
  it('excluir gana sobre el foco; incluir salta área/nivel pero NUNCA país', () => {
    expect(estaEnAlcancePeriodo({ ...base, excluirIds: ['ana'] }, ana)).toBe(false)
    expect(estaEnAlcancePeriodo({ ...base, focoAreaIds: ['ops'], incluirIds: ['ana'] }, ana)).toBe(true)
    expect(estaEnAlcancePeriodo({ ...base, focoPaisIds: ['pe'], incluirIds: ['ana'] }, ana)).toBe(false)
  })
  it('inactivo nunca entra, ni a mano', () => {
    expect(estaEnAlcancePeriodo({ ...base, incluirIds: ['ana'] }, { ...ana, activo: false })).toBe(false)
  })
})
```

- [ ] **Step 8: Implementar `src/features/objetivos/alcance-periodo.ts`**

```ts
import { prisma } from '@/shared/lib/prisma'
import { resolverAlcance, type FocoCiclo, type AjustesCiclo } from '@/features/ciclos/alcance'

/** Alcance del período de objetivos: mismo resolutor que los ciclos pero SIN regla de
 * antigüedad (fechaInicio null). ÚNICA fuente de verdad de «a quién aplica el período» —
 * la consumen apertura, guards de carga, cobertura, recordatorios, vistas y export. */

export type PeriodoConAlcance = {
  focoPaisIds: string[]
  focoAreaIds: string[]
  focoNivelIds: string[]
  incluirIds: string[]
  excluirIds: string[]
}

export function focoDe(p: PeriodoConAlcance): FocoCiclo {
  return { focoPaisIds: p.focoPaisIds, focoAreaIds: p.focoAreaIds, focoNivelIds: p.focoNivelIds }
}
export function ajustesDe(p: PeriodoConAlcance): AjustesCiclo {
  return { incluirIds: p.incluirIds, excluirIds: p.excluirIds }
}

/** ¿Este colaborador está en el alcance del período? (puro, para guards puntuales) */
export function estaEnAlcancePeriodo(
  periodo: PeriodoConAlcance,
  c: { id: string; activo: boolean; paisId: string; areaId: string | null; nivelId: string | null },
): boolean {
  const r = resolverAlcance([{ ...c, fechaIngreso: null }], focoDe(periodo), ajustesDe(periodo), null)
  return r.evaluados.length === 1
}

export type ColaboradorPeriodo = {
  id: string; nombres: string; apellidos: string
  paisId: string; areaId: string | null; puestoId: string | null; nivelId: string | null
  jefeId: string | null
}

/** Colaboradores ACTIVOS dentro del alcance del período (para cobertura, apertura, recordatorios). */
export async function colaboradoresDelPeriodo(periodo: PeriodoConAlcance): Promise<ColaboradorPeriodo[]> {
  const activos = await prisma.colaborador.findMany({
    where: { activo: true },
    select: {
      id: true, nombres: true, apellidos: true, activo: true, fechaIngreso: true,
      paisId: true, areaId: true, puestoId: true, jefeId: true,
      puesto: { select: { nivelId: true } },
    },
  })
  const enriquecidos = activos.map((c) => ({ ...c, nivelId: c.puesto?.nivelId ?? null }))
  return resolverAlcance(enriquecidos, focoDe(periodo), ajustesDe(periodo), null).evaluados
}
```

- [ ] **Step 9: Verificar en verde + suite completa**

Run: `npx vitest run src/features/objetivos/alcance-periodo.test.ts && npx vitest run`
Expected: PASS todo; `npx tsc --noEmit` exit 0.

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma src/generated/prisma src/features/ciclos/alcance.ts src/features/ciclos/alcance.test.ts src/features/objetivos/alcance-periodo.ts src/features/objetivos/alcance-periodo.test.ts
git commit -m "feat(objetivos): alcance en PeriodoObjetivos + periodoId opcional en Ciclo + resolutor sin regla de antigüedad"
```

---

### Task 2: Acciones del período — crear con alcance, editar alcance en BORRADOR, eliminar borrador

**Files:**
- Modify: `src/features/objetivos/acciones-periodo.ts` (`crearPeriodo`; nuevas `editarAlcancePeriodo`, `eliminarPeriodo`)
- Modify: `src/features/ciclos/acciones-alcance.ts:32-41` (`previewAlcance` con `conAntiguedad`)
- Test: `src/features/objetivos/acciones-periodo.test.ts` (nuevo, guards puros — extraer helpers si hace falta)

**Interfaces:**
- Consumes: `estaEnAlcancePeriodo` no; usa validación de alcance espejo de `validarAlcanceCiclo` (leerla en `src/features/admin/acciones.ts` y replicar su regla país-techo para el período).
- Produces:
  - `crearPeriodo(formData, alcance: { focoPaisIds: string[]; focoAreaIds: string[]; focoNivelIds: string[]; incluirIds: string[]; excluirIds: string[] })` — firma nueva (la página del Task 8 la consume).
  - `editarAlcancePeriodo(periodoId: string, alcance: <mismo tipo>)` → `{ ok } | { ok: false, error }`; solo estado `BORRADOR`.
  - `eliminarPeriodo(periodoId: string)` → `{ ok } | { ok: false, error }`.
  - `previewAlcance(input & { conAntiguedad?: boolean })` — default `true` (ciclos no cambian); el wizard del período pasa `false`.

- [ ] **Step 1: `previewAlcance` acepta `conAntiguedad`**

En `src/features/ciclos/acciones-alcance.ts`: agregar al esquema zod `conAntiguedad: z.boolean().optional()`, a la firma `input: { ...; conAntiguedad?: boolean }`, y usarlo:

```ts
  const fechaInicio = datos.conAntiguedad === false
    ? null
    : /^\d{4}-\d{2}-\d{2}$/.test(datos.fechaInicio) ? new Date(`${datos.fechaInicio}T00:00:00`) : new Date()
```

(el permiso sigue siendo `CICLOS: GESTIONAR`; para el período cámbialo a: exigir `CICLOS` **o** `OBJETIVOS` GESTIONAR — usar `tieneAdmin` de `@/shared/lib/permisos-admin` con fallback como hace `coberturaPeriodo`.)

- [ ] **Step 2: `crearPeriodo` con alcance**

En `src/features/objetivos/acciones-periodo.ts`, nueva validación compartida (colocarla junto a `esquemaPeriodo`):

```ts
const esquemaAlcance = z.object({
  focoPaisIds: z.array(z.string()).max(50), focoAreaIds: z.array(z.string()).max(50),
  focoNivelIds: z.array(z.string()).max(50), incluirIds: z.array(z.string()).max(500),
  excluirIds: z.array(z.string()).max(500),
})
type AlcancePeriodoInput = z.infer<typeof esquemaAlcance>

/** Regla país-techo (espejo de validarAlcanceCiclo): RRHH-país fuerza su país en el foco
 * y sus ajustes manuales solo pueden referenciar colaboradores de su país. */
async function validarAlcancePeriodo(sesion: SesionAdmin, alcance: AlcancePeriodoInput) {
  const datos = esquemaAlcance.safeParse(alcance)
  if (!datos.success) return { ok: false as const, error: 'Alcance inválido' }
  const focoPaisIds = sesion.alcanceRrhh === 'PAIS' && sesion.alcancePaisId ? [sesion.alcancePaisId] : datos.data.focoPaisIds
  const referenciados = [...new Set([...datos.data.incluirIds, ...datos.data.excluirIds])]
  if (referenciados.length > 0 && sesion.alcanceRrhh === 'PAIS' && sesion.alcancePaisId) {
    const fuera = await prisma.colaborador.count({ where: { id: { in: referenciados }, paisId: { not: sesion.alcancePaisId } } })
    if (fuera > 0) return { ok: false as const, error: 'Los ajustes manuales solo pueden incluir colaboradores de tu país' }
  }
  return { ok: true as const, alcance: { ...datos.data, focoPaisIds } }
}
```

(Tipar `SesionAdmin` con el tipo de retorno real de `requiereAdmin` — verificarlo en `@/shared/lib/permisos`.)

`crearPeriodo(formData, alcance)`: tras el parse actual, llamar `validarAlcancePeriodo` y persistir los 5 arrays en el `create`. El AuditLog `PERIODO_CREADO` suma `alcance: { ...va.alcance }`.

- [ ] **Step 3: `editarAlcancePeriodo` (solo BORRADOR)**

```ts
export async function editarAlcancePeriodo(periodoId: string, alcance: AlcancePeriodoInput) {
  const sesion = await requiereAdmin('OBJETIVOS', 'GESTIONAR')
  const periodo = await prisma.periodoObjetivos.findUnique({ where: { id: periodoId } })
  if (!periodo) return { ok: false as const, error: 'Período no encontrado' }
  if (periodo.estado !== 'BORRADOR') {
    return { ok: false as const, error: 'El alcance solo se edita en borrador: con la carga abierta ya hay trabajo hecho sobre él' }
  }
  const va = await validarAlcancePeriodo(sesion, alcance)
  if (!va.ok) return va
  await prisma.periodoObjetivos.update({ where: { id: periodoId }, data: va.alcance })
  await prisma.auditLog.create({
    data: { usuarioId: sesion.id, accion: 'PERIODO_ALCANCE_EDITADO', entidad: periodoId, detalle: { nombre: periodo.nombre, alcance: va.alcance } },
  })
  revalidar()
  return { ok: true as const }
}
```

- [ ] **Step 4: `eliminarPeriodo`**

```ts
/** Borra un período en BORRADOR (cascade: sus transversales). Bloquea si un ciclo lo referencia. */
export async function eliminarPeriodo(periodoId: string) {
  const sesion = await requiereAdmin('OBJETIVOS', 'GESTIONAR')
  const periodo = await prisma.periodoObjetivos.findUnique({
    where: { id: periodoId },
    include: { _count: { select: { objetivos: true, ciclos: true } }, ciclos: { select: { nombre: true }, take: 1 } },
  })
  if (!periodo) return { ok: false as const, error: 'Período no encontrado' }
  if (periodo.estado !== 'BORRADOR') return { ok: false as const, error: 'Solo se elimina un período en borrador' }
  if (periodo._count.ciclos > 0) {
    return { ok: false as const, error: `El ciclo «${periodo.ciclos[0].nombre}» usa este período: desvincúlalo o bórralo primero` }
  }
  await prisma.periodoObjetivos.delete({ where: { id: periodoId } })
  await prisma.auditLog.create({
    data: { usuarioId: sesion.id, accion: 'PERIODO_ELIMINADO', entidad: periodoId, detalle: { nombre: periodo.nombre, objetivosBorrados: periodo._count.objetivos } },
  })
  revalidar()
  return { ok: true as const }
}
```

- [ ] **Step 5: Suite + tsc**

Run: `npx vitest run && npx tsc --noEmit`
Expected: verde. (Los guards se prueban vía Task 7 E2E del controlador y los tests de UI no aplican; si `validarAlcancePeriodo` se puede aislar puro, agregar test unitario del país-techo.)

- [ ] **Step 6: Commit**

```bash
git add src/features/objetivos/acciones-periodo.ts src/features/ciclos/acciones-alcance.ts
git commit -m "feat(objetivos): crear período con alcance país-techo + editar alcance en borrador + eliminar borrador"
```

---

### Task 3: Alcance restrictivo — guards de carga y período vigente por colaborador

**Files:**
- Modify: `src/features/objetivos/periodo.tsx` (período vigente POR COLABORADOR)
- Modify: `src/features/objetivos/acciones.ts` (guards al crear/editar objetivos: dueño dentro del alcance)
- Modify: `src/app/(app)/objetivos/page.tsx` y `src/app/(app)/equipo/objetivos/page.tsx` (vistas)
- Test: ampliar `src/features/objetivos/alcance-periodo.test.ts`

**Interfaces:**
- Consumes: `estaEnAlcancePeriodo`, `focoDe`, `ajustesDe` (Task 1).
- Produces: `periodoVigenteParaColaborador(colaboradorId: string)` en `periodo.tsx` — reemplaza al `periodoVigente()` global en las vistas de colaborador/jefe. Firma: `Promise<PeriodoObjetivos | null>` (el CARGA_ABIERTA más reciente cuyo alcance lo incluye; si no hay, el CERRADO más reciente que lo incluya — conservar la lógica de fallback actual de `periodo.tsx` leyéndola antes).

- [ ] **Step 1: Leer `src/features/objetivos/periodo.tsx` completo** (49 líneas) y `src/app/(app)/objetivos/page.tsx` para entender el fallback actual (CARGA_ABIERTA más reciente ?? último por createdAt).

- [ ] **Step 2: Implementar `periodoVigenteParaColaborador`**

En `periodo.tsx`: cargar los períodos candidatos (mismo orden actual), cargar el colaborador (`activo, paisId, areaId, puesto.nivelId`) y devolver el primero cuyo `estaEnAlcancePeriodo` sea true. Mantener `periodoVigente()` SOLO si algún caller admin lo necesita global (verificar con `grep -rn "periodoVigente" src/`); los callers de colaborador/jefe migran todos.

- [ ] **Step 3: Guards en `acciones.ts`**

En cada acción que crea/edita un objetivo INDIVIDUAL/DESARROLLO (localizarlas con `grep -n "validarVentanaCarga" src/features/objetivos/acciones.ts`): tras la ventana, verificar que el DUEÑO del objetivo esté en el alcance del período:

```ts
  const dueno = await prisma.colaborador.findUnique({
    where: { id: colaboradorId },
    select: { id: true, activo: true, paisId: true, areaId: true, puesto: { select: { nivelId: true } } },
  })
  if (!dueno || !estaEnAlcancePeriodo(periodo, { ...dueno, nivelId: dueno.puesto?.nivelId ?? null })) {
    return { ok: false as const, error: 'Este período no aplica a ese colaborador' }
  }
```

(Cargar `periodo` una sola vez por acción; si la acción ya lo tiene, reutilizarlo.)

- [ ] **Step 4: Vistas**

- `/objetivos`: usa `periodoVigenteParaColaborador(sesion.colaboradorId)`; si null → estado vacío existente («no hay período de carga activo para ti»; conservar el copy actual si ya existe uno).
- `/equipo/objetivos`: el jefe ve SOLO los miembros del equipo dentro del alcance del período mostrado (filtrar la lista de miembros con `estaEnAlcancePeriodo`); si el período no lo incluye a él pero sí a miembros, la vista igual funciona (el período se elige por los miembros: usar el vigente del PRIMER miembro incluido o iterar candidatos — leer la página antes y elegir la adaptación mínima).

- [ ] **Step 5: Suite + tsc + prueba manual en :3001** (crear en el clone un período BORRADOR con foco Chile vía Prisma Studio o script efímero, abrir carga, verificar con un usuario de otro país que NO ve el período).

Run: `npx vitest run && npx tsc --noEmit`
Expected: verde.

- [ ] **Step 6: Commit**

```bash
git add src/features/objetivos/periodo.tsx src/features/objetivos/acciones.ts "src/app/(app)/objetivos/page.tsx" "src/app/(app)/equipo/objetivos/page.tsx" src/features/objetivos/alcance-periodo.test.ts
git commit -m "feat(objetivos): alcance restrictivo del período en guards de carga y vistas (vigente por colaborador)"
```

---

### Task 4: Alcance en apertura, cobertura, recordatorios, transversales y export

**Files:**
- Modify: `src/features/objetivos/acciones-periodo.ts` (`abrirCargaPeriodo`, `coberturaPeriodo`, `enviarRecordatoriosPeriodo`, `exportarObjetivosPeriodo`)
- Modify: `src/features/recordatorios/pendientes.ts:111-186` (`pendientesObjetivos`, `aprobacionesPorJefe`)
- Modify: `src/features/resultados/servicio.ts:42-66` (`objetivosAplicables` ∩ alcance)
- Modify: `src/features/admin/acciones.ts` (`validarPesoTransversales` — el candado de pesos usa el alcance)
- Modify: `src/app/(app)/admin/periodos/[id]/page.tsx` (mostrar `resumenAlcance`)

**Interfaces:**
- Consumes: `colaboradoresDelPeriodo`, `estaEnAlcancePeriodo` (Task 1); `resumenAlcance` de `@/features/ciclos/alcance`.
- Produces: `objetivosAplicables(periodoId, colaboradorId)` devuelve `{ transversales: [], individuales: [...] }` con transversales = focalización propia ∩ alcance del período, y **si el colaborador está fuera del alcance devuelve ambos vacíos** (Tasks 5-6 dependen de esto para el preflight y el cálculo).

- [ ] **Step 1:** `abrirCargaPeriodo`: reemplazar el `findMany` de usuarios por: `colaboradoresDelPeriodo(periodo)` → set de ids → filtrar los usuarios activos cuyos `colaboradorId` estén en el set. El AuditLog no cambia de forma.

- [ ] **Step 2:** `coberturaPeriodo`: el `findMany` de colaboradores pasa a `colaboradoresDelPeriodo(periodo)` filtrado además por `alcancePaisWhere` del RRHH que mira (intersección: mapear el where actual a un filtro en memoria sobre `paisId`). Cargar el período al inicio (`findUniqueOrThrow`).

- [ ] **Step 3:** `enviarRecordatoriosPeriodo` ya se apoya en `coberturaPeriodo` → hereda el alcance sin cambios. Verificarlo leyendo el flujo y dejar un comentario solo si hay que tocar algo.

- [ ] **Step 4:** Cron (`pendientesObjetivos`, `aprobacionesPorJefe` en `pendientes.ts`): mismas sustituciones — la población base es `colaboradoresDelPeriodo(periodo)`; leer ambas funciones y aplicar el filtro al armar destinatarios.

- [ ] **Step 5:** `objetivosAplicables` (`servicio.ts`): cargar el período (`findUniqueOrThrow(periodoId)`); si `!estaEnAlcancePeriodo(periodo, colaborador…)` → `return { transversales: [], individuales: [] }`; los transversales filtran ADEMÁS por su focalización propia (código existente intacto).

- [ ] **Step 6:** `validarPesoTransversales` (`admin/acciones.ts:557`): al calcular a quién alcanza un transversal, intersectar con el alcance del período (los colaboradores fuera no suman al candado de 100%). Leer la función completa antes; la población candidata pasa a `colaboradoresDelPeriodo`.

- [ ] **Step 7:** `exportarObjetivosPeriodo`: la población base de colaboradores pasa a `colaboradoresDelPeriodo(periodo)` (intersectada con `alcancePaisWhere` del RRHH que exporta, como hoy) — así ni individuales ni transversales expandidos incluyen filas fuera del alcance.

- [ ] **Step 8:** Detalle `/admin/periodos/[id]`: bajo el encabezado, línea con `resumenAlcance(focoDe(periodo), nombres, { incluidos: periodo.incluirIds.length, excluidos: periodo.excluirIds.length })` — los mapas de nombres se cargan como hace la revisión del wizard de ciclos (buscar `resumenAlcance` en `WizardCiclo.tsx` y copiar el armado).

- [ ] **Step 9:** Suite + tsc.

Run: `npx vitest run && npx tsc --noEmit`
Expected: verde.

- [ ] **Step 10: Commit**

```bash
git add src/features/objetivos/acciones-periodo.ts src/features/recordatorios/pendientes.ts src/features/resultados/servicio.ts src/features/admin/acciones.ts "src/app/(app)/admin/periodos/[id]/page.tsx"
git commit -m "feat(objetivos): alcance del período en apertura, cobertura, recordatorios, transversales y export"
```

---

### Task 5: Ciclo sin objetivos — acciones, wizard y preflight

**Files:**
- Modify: `src/features/admin/acciones.ts:806-860` (`crearCiclo` y `editarCiclo` aceptan sin período)
- Modify: `src/features/admin/WizardCiclo.tsx` (radio «¿Evalúa objetivos?» en paso Datos)
- Modify: `src/features/ciclos/preflight.ts:108-311`
- Test: preflight (si existe test; si no, crear `src/features/ciclos/preflight-sin-periodo.test.ts` de las ramas puras extraíbles)

**Interfaces:**
- Consumes: `objetivosAplicables` vacío-fuera-de-alcance (Task 4).
- Produces:
  - `crearCiclo(formData, evaluacionIds, alcance)` — `formData.periodoId` vacío/'SIN_OBJETIVOS' → `periodoId: null`.
  - `Preflight.avisos.sinObjetivos: boolean` y `Preflight.avisos.fueraDelPeriodo: string[]` (nombres) — la página del detalle del ciclo los renderiza (mismo archivo donde se pintan los avisos actuales; localizar con `grep -rn "nivelesSinEvaluacion" src/app src/features/admin`).

- [ ] **Step 1:** `esquemaCiclo`: `periodoId: z.string().optional()`. En `crearCiclo`: si `!datos.data.periodoId` → saltar la validación de período y crear con `periodoId: null`; si viene, validación actual intacta. Aplicar lo mismo en la acción de EDITAR ciclo en borrador (localizar con `grep -n "editarCiclo\|cicloBorradorEditable" src/features/admin/acciones.ts` — permitir cambiar de «con período» a «sin» y viceversa mientras BORRADOR).

- [ ] **Step 2:** Wizard paso «Datos del ciclo»: radio (default Sí):

```tsx
<fieldset className="space-y-1.5">
  <legend className="text-xs font-bold uppercase tracking-wide text-gris">¿Este ciclo evalúa objetivos?</legend>
  <label className="flex items-center gap-2 text-sm">
    <input type="radio" name="evaluaObjetivos" checked={conObjetivos} onChange={() => setConObjetivos(true)} className="accent-[#f0163e]" />
    Sí — se elige un período de objetivos
  </label>
  <label className="flex items-center gap-2 text-sm">
    <input type="radio" name="evaluaObjetivos" checked={!conObjetivos} onChange={() => setConObjetivos(false)} className="accent-[#f0163e]" />
    No — la nota final se calculará 100% con competencias
  </label>
</fieldset>
```

Con `conObjetivos=false` el select de período se oculta y no viaja `periodoId`. El paso Revisión muestra «Sin objetivos (nota 100% competencias)» donde hoy muestra el período.

- [ ] **Step 3:** Preflight: al inicio, si `ciclo.periodoId === null`:
  - `objetivosIncompletos = []`, `periodoYaEvaluado = null` (no consultar), aviso `sinObjetivos: true`.
  - El resto (cuestionarios, evaluadores, impacto) corre igual.
  Con período: calcular `fueraDelPeriodo` = participantes con `estaEnAlcancePeriodo === false` (nombres), como aviso. Nota: esos participantes igualmente aparecen en `objetivosIncompletos` (0%) — se mantiene el bloqueo; el aviso lo explica.

- [ ] **Step 4:** Render de avisos en el detalle del ciclo: bloque para `sinObjetivos` («Este ciclo no evalúa objetivos: la nota final será 100% competencias») y para `fueraDelPeriodo` («N participantes están fuera del alcance del período elegido: ajusta el alcance del período o exclúyelos del ciclo» + lista).

- [ ] **Step 5:** Suite + tsc + prueba manual: crear ciclo sin objetivos en :3001, ver preflight sin bloqueantes de objetivos.

- [ ] **Step 6: Commit**

```bash
git add src/features/admin/acciones.ts src/features/admin/WizardCiclo.tsx src/features/ciclos/preflight.ts
git commit -m "feat(ciclos): ciclo sin objetivos — periodoId opcional en wizard/acciones + preflight con avisos sinObjetivos y fueraDelPeriodo"
```

---

### Task 6: Cálculo renormalizado + superficies «Sin objetivos» + recordatorios del ciclo

**Files:**
- Modify: `src/features/resultados/servicio.ts:66-160` (`calcularResultado` con `periodoId` null)
- Modify: superficies (localizar con `grep -rln "cumplimientoObjetivos" src/features src/app` y revisar CADA una): `PreviewResultado.tsx`, `ResultadoColaborador.tsx`, `informe-pdf/`, `AnalisisUI.tsx`/`analisis.ts`, detalle del ciclo.
- Modify: cron de recordatorios (`src/app/api/cron/...` — localizar con `grep -rn "pendientesObjetivos\|logro" src/app/api`) — omitir envíos dependientes de objetivos si el ciclo no tiene período.
- Test: `src/features/resultados/` test de cálculo (fixture TST*) — ciclo sin período renormaliza.

**Interfaces:**
- Consumes: `notaFinal` (renormalización existente en `@/domain/calculo` — leerla para citarla en el test), `objetivosAplicables`.
- Produces: `calcularResultado` funciona con `cicloConPeriodo.periodoId === null` → `cumplimientoObjetivos: null`, `notaFinal` renormalizada; `Resultado` persiste igual.

- [ ] **Step 1: Test que falla (fixture TST):** ciclo sin período, un evaluado con respuestas → `notaFinal !== null` y `cumplimientoObjetivos === null` y `notaFinal === notaCompetencias` (renormalización total). Seguir el patrón de aislamiento de los tests Prisma existentes (`grep -rln "TST" src --include=*.test.ts` para copiar el setup).

- [ ] **Step 2:** `calcularResultado`: cambiar el bloque de objetivos a:

```ts
  const sinObjetivos = cicloConPeriodo.periodoId === null
  const { transversales, individuales } = sinObjetivos
    ? { transversales: [], individuales: [] }
    : await objetivosAplicables(cicloConPeriodo.periodoId!, colaboradorId)
```

(el resto ya maneja 0 aprobados → `faltanLogros=false` → `cumplimiento` null → renormaliza).

- [ ] **Step 3:** Superficies: en cada una, cuando el ciclo no tiene período (pasar el dato desde el server component que ya carga el ciclo), reemplazar el bloque de cumplimiento por el texto «Sin objetivos en este ciclo» (mismo tono `text-gris`); en el PDF, omitir la sección de objetivos (react-pdf: cuidado con la paginación del footer — regla del repo). El desglose «combinación 60/40» que se muestre en resultados debe decir «100% competencias» cuando aplique.

- [ ] **Step 4:** Cron: los envíos de logros/objetivos pendientes se saltan ciclos con `periodoId === null` (filtro en la selección de ciclos del handler).

- [ ] **Step 5:** Suite + tsc + validación visual con MCP browser del detalle de resultados de un ciclo sin objetivos (clone :3001).

- [ ] **Step 6: Commit**

```bash
git add src/features/resultados src/app "src/features/admin" src/features/recordatorios
git commit -m "feat(resultados): nota 100% competencias en ciclos sin objetivos + superficies y cron coherentes"
```

(ATENCIÓN: `git add` por archivo real tocado — el comando de arriba es indicativo; NUNCA `git add -A`.)

---

### Task 7: UI de borrado del borrador

**Files:**
- Modify: `src/features/objetivos/PanelPeriodos.tsx` (ícono basura en la fila BORRADOR + `confirmar()` con conteo)

**Interfaces:**
- Consumes: `eliminarPeriodo` (Task 2), `confirmar` de `@/shared/ui/Confirmacion`, `Icono`/lucide `Trash2`.

- [ ] **Step 1:** En la fila del período (buscar el render del estado `Borrador` en `PanelPeriodos.tsx`), agregar botón visible solo si `p.estado === 'BORRADOR'`:

```tsx
<button
  onClick={async () => {
    const ok = await confirmar(
      p.totalObjetivos > 0
        ? `Se eliminará el período «${p.nombre}» y sus ${p.totalObjetivos} objetivos transversales en borrador.`
        : `Se eliminará el período «${p.nombre}».`,
      { titulo: 'Eliminar período', textoAceptar: 'Eliminar' },
    )
    if (ok) ejecutar(() => eliminarPeriodo(p.id))
  }}
  title="Eliminar borrador"
  className="rounded-lg p-1.5 text-gris transition hover:bg-red-50 hover:text-hunter"
>
  <Trash2 size={15} />
</button>
```

(usar el conteo de objetivos que la fila ya recibe; si no lo recibe, sumarlo al select del server component que arma la lista.)

- [ ] **Step 2:** Probar en :3001 (borrar un borrador con y sin transversales; intentar borrar uno referenciado por ciclo → error legible).

- [ ] **Step 3: Commit**

```bash
git add src/features/objetivos/PanelPeriodos.tsx
git commit -m "feat(objetivos): eliminar período en borrador desde la lista (confirmación con conteo)"
```

---

### Task 8: Página dedicada `/admin/periodos/nuevo` (wizard) + edición de alcance en detalle

**Files:**
- Create: `src/app/(app)/admin/periodos/nuevo/page.tsx`
- Create: `src/features/objetivos/WizardPeriodo.tsx`
- Modify: `src/features/objetivos/PanelPeriodos.tsx` (quitar form inline; «+ Crear período» → `<Link href="/admin/periodos/nuevo">`)
- Modify: `src/app/(app)/admin/periodos/[id]/page.tsx` (editar alcance si BORRADOR)

**Interfaces:**
- Consumes: `crearPeriodo(formData, alcance)` y `editarAlcancePeriodo` (Task 2); `previewAlcance` con `conAntiguedad: false` (Task 2); el componente/patrón del paso Alcance de `WizardCiclo.tsx` (leerlo entero antes: pasos, estado del foco, chips de incluir/excluir, preview).
- Produces: página con pasos `['Datos del período', 'Alcance', 'Revisión']`.

- [ ] **Step 1:** Leer `WizardCiclo.tsx` completo y `src/app/(app)/admin/ciclos/nuevo/page.tsx` (server component: qué catálogos precarga — países/áreas/niveles según alcance del RRHH — replicar).

- [ ] **Step 2:** `WizardPeriodo.tsx`: 3 pasos con la MISMA estructura visual del wizard de ciclos (breadcrumb de pasos, botones Atrás/Continuar, card blanca):
  - **Datos**: nombre (placeholder «2026, 2026-S1…»), tipo ANUAL/SEMESTRAL, límite de carga (date). Mismos campos del form inline actual.
  - **Alcance**: reutilizar el markup del paso Alcance del wizard de ciclos adaptando: llama `previewAlcance({ foco, ajustes, fechaInicio: hoy, conAntiguedad: false })`; copy del encabezado: «¿A quién aplica este período? Los colaboradores fuera del alcance no verán la carga de objetivos.» El preview NO muestra «excluidos por antigüedad» (no aplica).
  - **Revisión**: nombre/tipo/límite + `resumenAlcance` + total del preview → botón «Crear período» → `crearPeriodo(fd, alcance)` → redirect a `/admin/ciclos` pestaña períodos (ruta actual de la lista).

- [ ] **Step 3:** `page.tsx` de la ruta: `requiereAdmin('OBJETIVOS', 'GESTIONAR')` (patrón de guard de página — copiar de `/admin/ciclos/nuevo/page.tsx`), precarga catálogos, `<Titulo>` «Nuevo período de objetivos».

- [ ] **Step 4:** `PanelPeriodos.tsx`: eliminar el estado `creando` y el form inline; el botón pasa a `<Link>`. Sumar `/admin/periodos/nuevo` a `rutasObjetivos` en `acciones-periodo.ts` si la revalidación lo requiere.

- [ ] **Step 5:** Detalle `[id]`: si `estado === 'BORRADOR'`, botón «✎ Editar alcance» que abre el mismo paso Alcance (el componente del wizard en modo edición, patrón del ciclo — ver cómo el detalle del ciclo edita alcance con `EditarAlcanceCiclo`/equivalente; localizar con `grep -rn "editarAlcance" src/features`).

- [ ] **Step 6:** Validación visual MCP browser en :3001: crear un período con foco (país+área), ver preview, crearlo, verificar fila y detalle con resumen; editar alcance en borrador; abrir carga y confirmar que el correo sale solo al alcance (log del mailer en consola dev).

- [ ] **Step 7:** Suite completa + tsc.

Run: `npx vitest run && npx tsc --noEmit`
Expected: verde (≥176 tests + los nuevos de Tasks 1/6).

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/admin/periodos/nuevo" src/features/objetivos/WizardPeriodo.tsx src/features/objetivos/PanelPeriodos.tsx "src/app/(app)/admin/periodos/[id]/page.tsx" src/features/objetivos/acciones-periodo.ts
git commit -m "feat(objetivos): página dedicada /admin/periodos/nuevo con wizard de alcance + edición en borrador"
```

---

## Verificación final (controlador)

1. `npx vitest run` completa en verde + `npx tsc --noEmit` + `npx eslint` sobre los archivos tocados.
2. E2E manual en :3001 (roles RRHH regional y de país): crear período acotado → abrir carga → colaborador fuera no lo ve → ciclo CON ese período y mismo alcance lanza limpio → ciclo SIN objetivos lanza sin bloqueantes de objetivos y su resultado muestra «Sin objetivos en este ciclo» → borrar un borrador.
3. Deploy SOLO con confirmación explícita de Christian.
