# Pestaña «Incidentes» del ciclo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pestaña «Incidentes» en el detalle del ciclo que aparece solo cuando un evaluador dado de baja deja evaluaciones sin enviar sobre participantes, y permite a RR.HH. reasignar, marcar «no aplica» con motivo, o invalidar la evaluación del otro par por sesgo.

**Architecture:** Detección calculada al leer (sin tablas nuevas, mismo patrón que el detector de rotación actual). Resolver = mutar datos (las acciones ya existen; se agrega `invalidarEvaluacion` y motivo en `cancelarAsignacion`). Estado nuevo `INVALIDADA` en `EstadoAsignacion`: fuera de la nota por construcción (el motor solo consume ENVIADAS), excluido de contadores/preview/slots. El panel `RotacionCiclo` (hoy invisible dentro de Monitoreo) se reemplaza por la pestaña.

**Tech Stack:** Next.js 16 App Router (server actions), Prisma 7.8 (PostgreSQL, cliente generado VERSIONADO en `src/generated/prisma`), Tailwind 4, Vitest.

## Global Constraints

- UI siempre en español neutro (sin voseo).
- Motivos obligatorios: `motivo.trim().length >= 10` (mismo criterio que la exención de conformidad).
- Solo ciclo ACTIVO y país del evaluado NO congelado (`paisCongelado` de `src/features/ciclos/congelamiento.ts`); alcance RR.HH.-país sobre el evaluado (`fueraDeAlcancePais`).
- Regla de negocio: el cambio de jefe con el anterior ACTIVO **no** es incidente (el jefe anterior responde por este último ciclo) — el detector de «huérfanas» por divergencia se ELIMINA.
- Prisma 7: tras tocar el schema correr `npx prisma generate` **y** `npx prisma db push` (el push automático no es confiable); commitear `src/generated/prisma` o el build de Vercel falla.
- Nunca `git add -A`; agregar archivos explícitos (los scripts efímeros no se commitean).
- Deploy a prod SOLO con confirmación de Christian; el push del enum a Neon va ANTES del push de código.

---

### Task 1: Estado `INVALIDADA` en el schema

**Files:**
- Modify: `prisma/schema.prisma:396-401` (enum `EstadoAsignacion`)
- Modify: `src/generated/prisma/**` (regenerado, se commitea)

**Interfaces:**
- Produces: valor de enum `'INVALIDADA'` usable en Prisma y TypeScript (`EstadoAsignacion`).

- [ ] **Step 1: Agregar el valor al enum**

En `prisma/schema.prisma`, reemplazar:

```prisma
enum EstadoAsignacion {
  PROPUESTA // par externo al equipo propuesto por el jefe; no evalúa hasta que RR.HH. apruebe
  PENDIENTE
  BORRADOR
  ENVIADA
}
```

por:

```prisma
enum EstadoAsignacion {
  PROPUESTA // par externo al equipo propuesto por el jefe; no evalúa hasta que RR.HH. apruebe
  PENDIENTE
  BORRADOR
  ENVIADA
  INVALIDADA // RR.HH. la invalidó al resolver un incidente (sesgo de par): las respuestas se conservan como registro pero NO cuentan en la nota, contadores ni slots
}
```

- [ ] **Step 2: Regenerar cliente y pushear a la BD local**

```bash
cd /Users/christianisrael/Developer/hunter-plataforma-360
npx prisma generate
npx prisma db push
```

Expected: `Your database is now in sync with your Prisma schema` (BD `hunter360_prodclone` según `.env`).

- [ ] **Step 3: Verificar el enum en la BD local**

```bash
psql "postgresql://localhost:5432/hunter360_prodclone" -c "SELECT unnest(enum_range(NULL::\"EstadoAsignacion\"));"
```

Expected: 5 filas, la última `INVALIDADA`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma src/generated/prisma
git commit -m "feat: estado INVALIDADA en EstadoAsignacion (incidentes de ciclo)"
```

---

### Task 2: Excluir `INVALIDADA` de motor, contadores, preview y slots

El motor ya está a salvo (`servicio.ts:77`, `informe-pdf/datos.ts:55`, `ResultadoColaborador.tsx:82`, `analisis.ts:191` filtran `estado: 'ENVIADA'`). Hay que excluirla de todo lo que cuenta «pendientes» o «slots».

**Files:**
- Modify: `src/features/resultados/PreviewResultado.tsx:28`
- Modify: `src/app/(app)/admin/ciclos/[id]/page.tsx:87,96,226`
- Modify: `src/app/(app)/equipo/evaluar/page.tsx:26,40`
- Modify: `src/app/(app)/evaluaciones/page.tsx:16-22`
- Modify: `src/app/(app)/evaluaciones/[id]/page.tsx` (guard tras línea 26)
- Modify: `src/features/evaluaciones/acciones.ts` (guard en `guardarEvaluacion`, tras línea 31)

**Interfaces:**
- Consumes: enum `INVALIDADA` (Task 1).
- Produces: invariante «INVALIDADA no es pendiente, no es enviada, no ocupa slot, no se puede responder» para las Tasks 3-5.

- [ ] **Step 1: Preview del colaborador — no bloquea el pre-read**

`src/features/resultados/PreviewResultado.tsx:28`:

```ts
// antes
      where: { cicloId: ciclo.id, evaluadoId: colaboradorId, estado: { not: 'ENVIADA' } },
// después — una INVALIDADA no es un insumo faltante
      where: { cicloId: ciclo.id, evaluadoId: colaboradorId, estado: { notIn: ['ENVIADA', 'INVALIDADA'] } },
```

- [ ] **Step 2: Detalle del ciclo — contadores y slots de pares**

`src/app/(app)/admin/ciclos/[id]/page.tsx`:

Línea 96 (query `asignaciones`, alimenta avance/modalidades/pendientes):

```ts
    where: { cicloId: id, estado: { notIn: ['PROPUESTA', 'INVALIDADA'] }, evaluado: { is: wherePais } },
```

Línea 87 (slots de pares — la invalidada no ocupa slot):

```ts
  const pares = paresTodos.filter((p) => p.estado !== 'PROPUESTA' && p.estado !== 'INVALIDADA')
```

Y donde se arma `paresPorEvaluado` (línea ~330, cobertura de nominación) cambiar la fuente de `paresTodos` a una lista sin invalidadas:

```ts
  const paresVigentes = paresTodos.filter((p) => p.estado !== 'INVALIDADA')
  const paresPorEvaluado = paresVigentes.reduce((m, p) => m.set(p.evaluadoId, (m.get(p.evaluadoId) ?? 0) + 1), new Map<string, number>())
```

y `paresPorEvaluadoId` (línea ~430, tabla de RR.HH.) igual: iterar `paresVigentes` en lugar de `paresTodos`.

Línea 226 (avance por país, `asigsGlobal`):

```ts
            where: { cicloId: id, estado: { notIn: ['PROPUESTA', 'INVALIDADA'] } },
```

- [ ] **Step 3: Vistas del jefe y del evaluador**

`src/app/(app)/equipo/evaluar/page.tsx` línea 26 (avance del equipo):

```ts
    where: { ciclo: { estado: 'ACTIVO' }, evaluadorId: { in: equipoIds }, estado: { notIn: ['PROPUESTA', 'INVALIDADA'] } },
```

y línea 40 (`paresEquipo`, slots del nominador):

```ts
          where: { cicloId: cicloActivo.id, tipo: 'PAR', evaluadoId: { in: equipoIds }, estado: { not: 'INVALIDADA' } },
```

`src/app/(app)/evaluaciones/page.tsx` líneas 16-22 (una PAR invalidada no le aparece a su evaluadora):

```ts
      estado: { notIn: ['PROPUESTA', 'INVALIDADA'] }, // propuestas sin aprobar e invalidadas por RR.HH.
```

- [ ] **Step 4: Nadie puede abrir ni responder una INVALIDADA**

`src/app/(app)/evaluaciones/[id]/page.tsx`, después de la línea `if (asignacion.estado === 'PROPUESTA') redirect('/evaluaciones')`:

```ts
  if (asignacion.estado === 'INVALIDADA') redirect('/evaluaciones') // invalidada por RR.HH. al resolver un incidente
```

`src/features/evaluaciones/acciones.ts`, en `guardarEvaluacion` después del guard de PROPUESTA (línea ~31):

```ts
  if (asignacion.estado === 'INVALIDADA') return { ok: false as const, error: 'RR.HH. invalidó esta evaluación al resolver un incidente del ciclo: ya no puede responderse' }
```

- [ ] **Step 5: Verificar compilación y tests**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: sin errores, 31 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/resultados/PreviewResultado.tsx "src/app/(app)/admin/ciclos/[id]/page.tsx" "src/app/(app)/equipo/evaluar/page.tsx" "src/app/(app)/evaluaciones/page.tsx" "src/app/(app)/evaluaciones/[id]/page.tsx" src/features/evaluaciones/acciones.ts
git commit -m "feat: INVALIDADA fuera de contadores, preview, slots y respuesta"
```

---

### Task 3: Acciones — `invalidarEvaluacion` nueva y motivo en `cancelarAsignacion`

**Files:**
- Modify: `src/features/ciclos/acciones-rotacion.ts`
- Modify: `src/features/admin/RotacionCiclo.tsx:121` (único llamador actual de `cancelarAsignacion`; se reemplaza entero en Task 5, aquí solo se mantiene verde el build)

**Interfaces:**
- Consumes: `paisCongelado(cicloId, paisId)`, `calcularResultado(cicloId, colaboradorId)`, enum `INVALIDADA`.
- Produces: `cancelarAsignacion(asignacionId: string, motivo: string): Promise<{ ok: true } | { ok: false; error: string }>` y `invalidarEvaluacion(asignacionId: string, motivo: string): Promise<{ ok: true } | { ok: false; error: string }>` — las consume `TabIncidentes` (Task 5).

- [ ] **Step 1: Motivo obligatorio en `cancelarAsignacion`**

En `src/features/ciclos/acciones-rotacion.ts`, cambiar la firma y agregar validación + motivo al AuditLog:

```ts
/** Cancela una evaluación PENDIENTE con motivo («no aplica»: rotación, sesgo, ya nadie
 * puede o debe responderla). La nota del evaluado se renormaliza sin esa modalidad. */
export async function cancelarAsignacion(asignacionId: string, motivo: string): Promise<Resp> {
  const sesion = await requiereRrhh()
  const limpio = motivo.trim()
  if (limpio.length < 10) return { ok: false, error: 'Explica el motivo (mínimo 10 caracteres): queda en el log de auditoría' }
```

y en el `detalle` del `auditLog.create` existente agregar `motivo: limpio`:

```ts
        detalle: {
          evaluado: `${asignacion.evaluado.nombres} ${asignacion.evaluado.apellidos}`,
          evaluador: `${asignacion.evaluador.nombres} ${asignacion.evaluador.apellidos}`,
          tipo: asignacion.tipo,
          motivo: limpio,
        },
```

- [ ] **Step 2: Nueva acción `invalidarEvaluacion`**

Agregar al final de `src/features/ciclos/acciones-rotacion.ts` (importar `paisCongelado` de `@/features/ciclos/congelamiento`):

```ts
/** Invalida una evaluación de PAR ya ENVIADA al resolver un incidente: si al evaluado le
 * queda un solo par activo, esa única voz introduce sesgo (y compromete el anonimato).
 * Las respuestas se CONSERVAN como registro, pero la evaluación sale de la nota, de los
 * contadores y del slot (puede nominarse un par de reemplazo). Motivo auditado. */
export async function invalidarEvaluacion(asignacionId: string, motivo: string): Promise<Resp> {
  const sesion = await requiereRrhh()
  const limpio = motivo.trim()
  if (limpio.length < 10) return { ok: false, error: 'Explica el motivo (mínimo 10 caracteres): queda en el log de auditoría' }

  const asignacion = await prisma.asignacion.findUnique({
    where: { id: asignacionId },
    include: {
      ciclo: { select: { estado: true } },
      evaluado: { select: { id: true, paisId: true, nombres: true, apellidos: true } },
      evaluador: { select: { nombres: true, apellidos: true } },
    },
  })
  if (!asignacion) return { ok: false, error: 'Evaluación no encontrada' }
  if (asignacion.tipo !== 'PAR') return { ok: false, error: 'Solo se invalidan evaluaciones de pares: las demás modalidades se reasignan o se cancelan' }
  if (asignacion.estado !== 'ENVIADA') return { ok: false, error: 'Solo se invalida una evaluación ya respondida: una pendiente se cancela o reasigna' }
  if (asignacion.ciclo.estado !== 'ACTIVO') return { ok: false, error: 'El ciclo no está activo' }
  if (fueraDeAlcancePais(sesion, asignacion.evaluado.paisId)) return { ok: false, error: 'Ese colaborador está fuera de tu país' }
  if (await paisCongelado(asignacion.cicloId, asignacion.evaluado.paisId)) {
    return { ok: false, error: 'El país del evaluado ya cerró este ciclo: su resultado quedó congelado' }
  }

  await prisma.$transaction([
    prisma.asignacion.update({ where: { id: asignacionId }, data: { estado: 'INVALIDADA' } }),
    prisma.auditLog.create({
      data: {
        usuarioId: sesion.id,
        accion: 'EVALUACION_INVALIDADA',
        entidad: asignacion.cicloId,
        detalle: {
          evaluado: `${asignacion.evaluado.nombres} ${asignacion.evaluado.apellidos}`,
          evaluador: `${asignacion.evaluador.nombres} ${asignacion.evaluador.apellidos}`,
          tipo: asignacion.tipo,
          motivo: limpio,
        },
      },
    }),
  ])
  // La nota del evaluado se recalcula sin esa voz (el motor solo consume ENVIADAS)
  await calcularResultado(asignacion.cicloId, asignacion.evaluado.id)
  revalidatePath(`/admin/ciclos/${asignacion.cicloId}`)
  return { ok: true }
}
```

- [ ] **Step 3: Mantener verde el llamador actual**

`src/features/admin/RotacionCiclo.tsx:121`:

```ts
                    ejecutar(() => cancelarAsignacion(h.asignacionId, 'Cancelada desde el panel de rotación'), 'Evaluación cancelada')
```

- [ ] **Step 4: Verificar compilación**

```bash
npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/features/ciclos/acciones-rotacion.ts src/features/admin/RotacionCiclo.tsx
git commit -m "feat: invalidarEvaluacion (par por sesgo) + motivo obligatorio en cancelarAsignacion"
```

---

### Task 4: Detector de incidentes (función pura con TDD + query)

**Files:**
- Create: `src/features/ciclos/incidentes.ts`
- Test: `src/features/ciclos/incidentes.test.ts`

**Interfaces:**
- Produces (consume Task 5):

```ts
export type InsumoPerdido = {
  asignacionId: string
  tipo: 'JEFE' | 'ASCENDENTE' | 'PAR' | 'AUTO'
  estado: string // PENDIENTE | BORRADOR | PROPUESTA
  evaluador: string
  // PAR con incidente: la evaluación ya ENVIADA del otro par, candidata a invalidarse por sesgo
  hermanaEnviada: { asignacionId: string; evaluador: string } | null
}
export type IncidenteEvaluado = { colaboradorId: string; nombre: string; puesto: string; pais: string; insumos: InsumoPerdido[] }
export function agruparIncidentes(asigs: AsigIncidente[]): IncidenteEvaluado[]
export async function incidentesCiclo(cicloId: string, wherePais: { paisId?: string }): Promise<IncidenteEvaluado[]>
```

- [ ] **Step 1: Escribir el test que falla**

`src/features/ciclos/incidentes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { agruparIncidentes, type AsigIncidente } from './incidentes'

const base = (extra: Partial<AsigIncidente>): AsigIncidente => ({
  id: 'a1', tipo: 'JEFE', estado: 'PENDIENTE',
  evaluado: { id: 'c1', nombres: 'Marita', apellidos: 'Cedeño', puesto: 'Analista', pais: 'Chile' },
  evaluador: { id: 'e1', nombres: 'Renzo', apellidos: 'Aguirre', activo: false },
  ...extra,
})

describe('agruparIncidentes', () => {
  it('agrupa por evaluado impactado los insumos de evaluadores dados de baja', () => {
    const out = agruparIncidentes([
      base({ id: 'a1', tipo: 'JEFE' }),
      base({ id: 'a2', tipo: 'PAR', evaluador: { id: 'e2', nombres: 'Laura', apellidos: 'Restrepo', activo: false } }),
      base({ id: 'a3', evaluado: { id: 'c2', nombres: 'Jazmin', apellidos: 'Zarzar', puesto: 'Analista', pais: 'Chile' } }),
    ])
    expect(out).toHaveLength(2)
    const marita = out.find((x) => x.colaboradorId === 'c1')!
    expect(marita.insumos.map((i) => i.tipo)).toEqual(['JEFE', 'PAR'])
  })

  it('ignora asignaciones de evaluadores activos y las ya enviadas', () => {
    const out = agruparIncidentes([
      base({ id: 'a1', evaluador: { id: 'e1', nombres: 'R', apellidos: 'A', activo: true } }),
      base({ id: 'a2', estado: 'ENVIADA' }),
      base({ id: 'a3', estado: 'INVALIDADA' }),
    ])
    expect(out).toHaveLength(0)
  })

  it('a un incidente de PAR le adjunta la evaluación ENVIADA del otro par (candidata a invalidar)', () => {
    const out = agruparIncidentes([
      base({ id: 'a1', tipo: 'PAR' }),
      base({ id: 'a2', tipo: 'PAR', estado: 'ENVIADA', evaluador: { id: 'e9', nombres: 'Sofía', apellidos: 'Duarte', activo: true } }),
    ])
    expect(out[0].insumos[0].hermanaEnviada).toEqual({ asignacionId: 'a2', evaluador: 'Sofía Duarte' })
  })

  it('el incidente de JEFE no lleva hermana', () => {
    const out = agruparIncidentes([base({ id: 'a1', tipo: 'JEFE' })])
    expect(out[0].insumos[0].hermanaEnviada).toBeNull()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
npx vitest run src/features/ciclos/incidentes.test.ts
```

Expected: FAIL — `Cannot find module './incidentes'` (o export inexistente).

- [ ] **Step 3: Implementación mínima**

`src/features/ciclos/incidentes.ts`:

```ts
import { prisma } from '@/shared/lib/prisma'

/** Incidentes del ciclo: un evaluador DADO DE BAJA dejó evaluaciones sin enviar sobre
 * participantes. Detección calculada al leer (el ciclo es una foto; nada se persiste):
 * resolverlos = reasignar / cancelar / invalidar, y desaparecen porque los datos cambian.
 * Regla 31/07: el cambio de jefe con el anterior ACTIVO no es incidente — responde él. */

const SIN_ENVIAR = new Set(['PENDIENTE', 'BORRADOR', 'PROPUESTA'])

export type AsigIncidente = {
  id: string
  tipo: 'AUTO' | 'JEFE' | 'ASCENDENTE' | 'PAR'
  estado: string
  evaluado: { id: string; nombres: string; apellidos: string; puesto: string; pais: string }
  evaluador: { id: string; nombres: string; apellidos: string; activo: boolean }
}

export type InsumoPerdido = {
  asignacionId: string
  tipo: AsigIncidente['tipo']
  estado: string
  evaluador: string
  hermanaEnviada: { asignacionId: string; evaluador: string } | null
}

export type IncidenteEvaluado = {
  colaboradorId: string
  nombre: string
  puesto: string
  pais: string
  insumos: InsumoPerdido[]
}

export function agruparIncidentes(asigs: AsigIncidente[]): IncidenteEvaluado[] {
  const porEvaluado = new Map<string, IncidenteEvaluado>()
  for (const a of asigs) {
    if (a.evaluador.activo || !SIN_ENVIAR.has(a.estado)) continue
    if (!porEvaluado.has(a.evaluado.id)) {
      porEvaluado.set(a.evaluado.id, {
        colaboradorId: a.evaluado.id,
        nombre: `${a.evaluado.nombres} ${a.evaluado.apellidos}`,
        puesto: a.evaluado.puesto,
        pais: a.evaluado.pais,
        insumos: [],
      })
    }
    // PAR con incidente: si el otro par YA respondió, esa evaluación es candidata a
    // invalidarse (una sola voz de par = sesgo y anonimato comprometido)
    const hermana = a.tipo === 'PAR'
      ? asigs.find((h) => h.id !== a.id && h.tipo === 'PAR' && h.evaluado.id === a.evaluado.id && h.estado === 'ENVIADA') ?? null
      : null
    porEvaluado.get(a.evaluado.id)!.insumos.push({
      asignacionId: a.id,
      tipo: a.tipo,
      estado: a.estado,
      evaluador: `${a.evaluador.nombres} ${a.evaluador.apellidos}`,
      hermanaEnviada: hermana ? { asignacionId: hermana.id, evaluador: `${hermana.evaluador.nombres} ${hermana.evaluador.apellidos}` } : null,
    })
  }
  return [...porEvaluado.values()].sort((a, b) => a.nombre.localeCompare(b.nombre))
}

/** Asignaciones del ciclo (acotadas al alcance) con lo necesario para detectar incidentes. */
export async function incidentesCiclo(cicloId: string, wherePais: { paisId?: string }): Promise<IncidenteEvaluado[]> {
  const asigs = await prisma.asignacion.findMany({
    where: { cicloId, evaluado: { is: { activo: true, ...wherePais } } },
    select: {
      id: true, tipo: true, estado: true,
      evaluado: { select: { id: true, nombres: true, apellidos: true, puesto: { select: { nombre: true } }, pais: { select: { nombre: true } } } },
      evaluador: { select: { id: true, nombres: true, apellidos: true, activo: true } },
    },
  })
  return agruparIncidentes(asigs.map((a) => ({
    id: a.id,
    tipo: a.tipo as AsigIncidente['tipo'],
    estado: a.estado,
    evaluado: { id: a.evaluado.id, nombres: a.evaluado.nombres, apellidos: a.evaluado.apellidos, puesto: a.evaluado.puesto?.nombre ?? 'Sin puesto', pais: a.evaluado.pais.nombre },
    evaluador: a.evaluador,
  })))
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

```bash
npx vitest run
```

Expected: PASS (31 previos + 4 nuevos).

- [ ] **Step 5: Commit**

```bash
git add src/features/ciclos/incidentes.ts src/features/ciclos/incidentes.test.ts
git commit -m "feat: detector de incidentes del ciclo (evaluadores dados de baja con pendientes)"
```

---

### Task 5: Pestaña «Incidentes» (UI) + limpieza del Monitoreo

**Files:**
- Create: `src/features/admin/TabIncidentes.tsx`
- Modify: `src/app/(app)/admin/ciclos/[id]/page.tsx` (quitar huérfanas y `RotacionCiclo` del Monitoreo; calcular incidentes; agregar pestaña condicional)
- Delete: `src/features/admin/RotacionCiclo.tsx`

**Interfaces:**
- Consumes: `incidentesCiclo` / `IncidenteEvaluado` (Task 4); `retirarDelCiclo`, `reasignarEvaluador`, `cancelarAsignacion(id, motivo)`, `invalidarEvaluacion(id, motivo)` (Task 3); tipo `BajaCiclo` (se muda de `RotacionCiclo.tsx` a `TabIncidentes.tsx` sin cambios).
- Produces: `TabIncidentes({ cicloId, bajas, incidentes, pool })` — client component.

- [ ] **Step 1: Crear `TabIncidentes.tsx`**

Contenido completo (mueve `BajaCiclo` y la UI de retiro desde `RotacionCiclo.tsx`, reescribe la resolución de insumos):

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserX, Replace, Ban, ShieldAlert } from 'lucide-react'
import { toast } from '@/shared/ui/toast'
import { retirarDelCiclo, reasignarEvaluador, cancelarAsignacion, invalidarEvaluacion } from '@/features/ciclos/acciones-rotacion'
import { btnMiniCls } from './edicion-inline'
import type { IncidenteEvaluado, InsumoPerdido } from '@/features/ciclos/incidentes'

export type BajaCiclo = {
  colaboradorId: string
  nombre: string
  puesto: string
  enviadasSobreEl: number
  pendientesSobreEl: number
  pendientesSuyas: number
  tieneResultado: boolean
  logrosFaltantes: number
}

const ETIQUETA: Record<string, string> = { AUTO: 'Autoevaluación', JEFE: 'Jefe directo', PAR: 'Par', ASCENDENTE: 'Ascendente' }

/** Resolución de UN insumo perdido: reasignar / no aplica (motivo) / además invalidar la
 * evaluación ya enviada del otro par (sesgo). Cada acción refresca y el incidente desaparece. */
function ResolverInsumo({ insumo, pool, ejecutar, pendiente }: {
  insumo: InsumoPerdido
  pool: { id: string; nombre: string }[]
  ejecutar: (fn: () => Promise<{ ok: boolean; error?: string }>, exito: string) => void
  pendiente: boolean
}) {
  const [modo, setModo] = useState<'menu' | 'reasignar' | 'noaplica' | 'invalidar'>('menu')
  const [nuevoId, setNuevoId] = useState('')
  const [motivo, setMotivo] = useState('')

  if (modo === 'menu') {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setModo('reasignar')} className={`${btnMiniCls} border border-gris-claro`}><Replace size={12} className="mr-1 inline -translate-y-px" />Reasignar</button>
        <button onClick={() => setModo('noaplica')} className={`${btnMiniCls} border border-gris-claro`}><Ban size={12} className="mr-1 inline -translate-y-px" />No aplica…</button>
        {insumo.hermanaEnviada && (
          <button onClick={() => setModo('invalidar')} className={`${btnMiniCls} border border-amber-300 text-amber-800`} title="Con este par de baja queda una sola voz de par: puedes invalidar también la del otro par por sesgo">
            <ShieldAlert size={12} className="mr-1 inline -translate-y-px" />Invalidar la de {insumo.hermanaEnviada.evaluador}…
          </button>
        )}
      </div>
    )
  }
  if (modo === 'reasignar') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <select value={nuevoId} onChange={(e) => setNuevoId(e.target.value)} disabled={pendiente}
          className="min-w-56 rounded-xl border border-gris-claro bg-white px-3 py-1.5 text-xs outline-none focus:border-hunter">
          <option value="">Nuevo evaluador…</option>
          {pool.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <button disabled={pendiente || !nuevoId}
          onClick={() => ejecutar(() => reasignarEvaluador(insumo.asignacionId, nuevoId), 'Evaluación reasignada ✓')}
          className="rounded-lg bg-hunter px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-hunter-dark disabled:opacity-50">
          Reasignar ✓
        </button>
        <button onClick={() => setModo('menu')} className={btnMiniCls}>Cancelar</button>
      </div>
    )
  }
  // noaplica e invalidar comparten el formulario de motivo
  const esInvalidar = modo === 'invalidar'
  return (
    <div className="w-full max-w-md space-y-2">
      {esInvalidar && insumo.hermanaEnviada && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          Se cancela la pendiente de <b>{insumo.evaluador}</b> y se INVALIDA la evaluación ya respondida de <b>{insumo.hermanaEnviada.evaluador}</b> (queda como registro, fuera de la nota). Después puedes nominar pares de reemplazo.
        </p>
      )}
      <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} disabled={pendiente}
        placeholder={esInvalidar ? 'Motivo de la invalidación (auditado): sesgo por par único…' : 'Motivo (auditado): evaluador dado de baja, modalidad no aplica…'}
        className="w-full rounded-lg border border-gris-claro bg-white px-3 py-2 text-xs outline-none focus:border-hunter" />
      <div className="flex items-center gap-2">
        <button disabled={pendiente || motivo.trim().length < 10}
          onClick={() => {
            if (esInvalidar && insumo.hermanaEnviada) {
              const hermanaId = insumo.hermanaEnviada.asignacionId
              ejecutar(async () => {
                const r1 = await cancelarAsignacion(insumo.asignacionId, motivo)
                if (!r1.ok) return r1
                return invalidarEvaluacion(hermanaId, motivo)
              }, 'Par pendiente cancelado e invalidada la del otro par ✓')
            } else {
              ejecutar(() => cancelarAsignacion(insumo.asignacionId, motivo), 'Evaluación cancelada: no aplica ✓')
            }
          }}
          className="rounded-lg bg-hunter px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-hunter-dark disabled:opacity-50">
          {pendiente ? 'Aplicando…' : esInvalidar ? 'Cancelar pendiente + invalidar ✓' : 'Confirmar: no aplica ✓'}
        </button>
        <button onClick={() => setModo('menu')} className={btnMiniCls}>Volver</button>
      </div>
    </div>
  )
}

/** Pestaña «Incidentes»: cambios del padrón que impactan el ciclo. Sección 1: evaluados
 * dados de baja (retiro con/sin nota). Sección 2: insumos perdidos por evaluado (el
 * evaluador se dio de baja con la evaluación sin enviar) — RR.HH. resuelve cada uno. */
export function TabIncidentes({ cicloId, bajas, incidentes, pool }: {
  cicloId: string
  bajas: BajaCiclo[]
  incidentes: IncidenteEvaluado[]
  pool: { id: string; nombre: string }[]
}) {
  const router = useRouter()
  const [retiro, setRetiro] = useState<BajaCiclo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  function ejecutar(fn: () => Promise<{ ok: boolean; error?: string }>, exito: string) {
    setError(null)
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) { setError(res.error ?? 'No se pudo completar'); return }
      setRetiro(null)
      toast(exito)
      router.refresh()
    })
  }

  return (
    <div className="space-y-5 rounded-2xl border border-gris-claro bg-white p-5">
      <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
        El padrón cambió desde el lanzamiento y el ciclo quedó impactado. Resuelve cada incidente: al <b>reasignar</b>, <b>marcar que no aplica</b> (con motivo auditado) o <b>retirar</b>, el incidente desaparece. El cambio de jefe con el anterior activo no es un incidente: él responde la evaluación de este ciclo.
      </p>
      {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-hunter-dark">{error}</p>}

      {bajas.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gris"><UserX size={12} className="mr-1 inline -translate-y-px" />Evaluados dados de baja · {bajas.length}</p>
          <ul className="space-y-2">
            {bajas.map((b) => (
              <li key={b.colaboradorId} className="rounded-xl border border-gris-claro px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold">{b.nombre}</p>
                    <p className="text-xs text-gris">{b.puesto} · {b.enviadasSobreEl} recibidas · {b.pendientesSobreEl} pendientes sobre él · {b.pendientesSuyas} pendientes suyas{b.tieneResultado ? ' · ya tiene nota conservada' : ''}</p>
                  </div>
                  {retiro?.colaboradorId !== b.colaboradorId && (
                    <button onClick={() => setRetiro(b)} className={`${btnMiniCls} border border-gris-claro`}>Retirar del ciclo…</button>
                  )}
                </div>
                {retiro?.colaboradorId === b.colaboradorId && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hueso-2 pt-3">
                    <button disabled={pendiente} onClick={() => ejecutar(() => retirarDelCiclo(cicloId, b.colaboradorId, false), 'Retirado del ciclo sin nota')}
                      className="rounded-lg border border-gris-claro px-3 py-1.5 text-[11px] font-bold transition hover:bg-hueso disabled:opacity-50">
                      Retirar SIN nota (borra su resultado)
                    </button>
                    <button disabled={pendiente || b.enviadasSobreEl === 0} title={b.enviadasSobreEl === 0 ? 'Sin evaluaciones recibidas no hay insumos para una nota' : undefined}
                      onClick={() => ejecutar(() => retirarDelCiclo(cicloId, b.colaboradorId, true), 'Retirado con nota de salida')}
                      className="rounded-lg bg-hunter px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-hunter-dark disabled:opacity-50">
                      Retirar CON nota de salida{b.logrosFaltantes > 0 ? ` (⚠ ${b.logrosFaltantes} logros sin cargar)` : ''}
                    </button>
                    <button onClick={() => setRetiro(null)} className={btnMiniCls}>Cancelar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {incidentes.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gris">Insumos impactados por evaluado · {incidentes.length}</p>
          <ul className="space-y-2">
            {incidentes.map((inc) => (
              <li key={inc.colaboradorId} className="rounded-xl border border-gris-claro px-4 py-3">
                <p className="text-sm font-bold">{inc.nombre} <span className="text-xs font-semibold text-gris">· {inc.puesto} · {inc.pais} · perdió {inc.insumos.length} insumo{inc.insumos.length === 1 ? '' : 's'}</span></p>
                <ul className="mt-2 space-y-2.5">
                  {inc.insumos.map((i) => (
                    <li key={i.asignacionId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-hueso px-3.5 py-2.5">
                      <span className="text-[13px]">
                        <b>{ETIQUETA[i.tipo]}</b> · {i.evaluador} <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-gris">dado de baja · {i.estado.toLowerCase()}</span>
                      </span>
                      <ResolverInsumo insumo={i} pool={pool.filter((c) => c.id !== inc.colaboradorId)} ejecutar={ejecutar} pendiente={pendiente} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Recablear `page.tsx` del ciclo**

En `src/app/(app)/admin/ciclos/[id]/page.tsx`:

1. Imports — quitar `RotacionCiclo` y sus tipos; agregar:

```ts
import { TabIncidentes, type BajaCiclo } from '@/features/admin/TabIncidentes'
import { incidentesCiclo } from '@/features/ciclos/incidentes'
```

2. En el bloque de rotación (líneas ~90-186): **eliminar** todo el cálculo de `rotacionHuerfanas` (la regla del 31/07 lo retira) conservando el de `rotacionBajas` tal cual, y agregar al final del `if (ciclo.estado === 'ACTIVO')`:

```ts
  const incidentes = ciclo.estado === 'ACTIVO' ? await incidentesCiclo(id, wherePais) : []
```

(nota: `asigsRotacion` puede simplificarse porque ya no se calculan huérfanas — conservar solo lo que alimenta `bajasMap`).

3. Quitar `<RotacionCiclo …/>` del `tabMonitoreo`.

4. En el arreglo de tabs, después de `'monitoreo'`, agregar la pestaña condicional:

```ts
            ...(ciclo.estado === 'ACTIVO' && (incidentes.length > 0 || rotacionBajas.length > 0)
              ? [{
                  id: 'incidentes',
                  label: `⚠ Incidentes (${incidentes.length + rotacionBajas.length})`,
                  icono: 'monitoreo',
                  contenido: (
                    <TabIncidentes
                      cicloId={ciclo.id}
                      bajas={rotacionBajas}
                      incidentes={incidentes}
                      pool={poolPares.map((c) => ({ id: c.id, nombre: `${c.nombres} ${c.apellidos} (${c.pais.codigo})` }))}
                    />
                  ),
                }]
              : []),
```

(el pool de reasignación es el REGIONAL con antigüedad — `poolPares` ya existe en la página; el tipo `BajaCiclo` ahora se importa de `TabIncidentes`).

- [ ] **Step 3: Eliminar `RotacionCiclo.tsx`**

```bash
git rm src/features/admin/RotacionCiclo.tsx
```

y quitar cualquier import residual (`grep -rn "RotacionCiclo" src` debe devolver vacío).

- [ ] **Step 4: Compilación, tests y build**

```bash
npx tsc --noEmit && npx vitest run && npx next build
```

Expected: sin errores, 35 tests PASS, `✓ Compiled successfully`.

- [ ] **Step 5: Commit**

```bash
git add src/features/admin/TabIncidentes.tsx "src/app/(app)/admin/ciclos/[id]/page.tsx"
git commit -m "feat: pestaña Incidentes del ciclo — bajas de evaluadores con resolución de RR.HH."
```

---

### Task 6: Validación E2E en el clone

**Files:** ninguno (validación sobre `hunter360_prodclone`, dev :3001).

- [ ] **Step 1: Provocar incidentes en el clone**

En el ciclo ACTIVO «Ciclo Antigüedad (Test)»: dar de baja a un evaluador con PAR pendiente cuya pareja ya respondió, y a un jefe con JEFE pendiente. Identificar candidatos:

```sql
SELECT a.id, a.tipo, a.estado, er.nombres AS evaluador, ev.nombres AS evaluado
FROM "Asignacion" a
JOIN "Ciclo" ci ON ci.id = a."cicloId" AND ci.estado = 'ACTIVO'
JOIN "Colaborador" er ON er.id = a."evaluadorId"
JOIN "Colaborador" ev ON ev.id = a."evaluadoId"
WHERE a.estado IN ('PENDIENTE','BORRADOR') ORDER BY a.tipo;
```

Elegir un PAR pendiente (evaluador X, evaluado Y con otra PAR ENVIADA) y un JEFE pendiente (evaluador Z), y:

```sql
UPDATE "Colaborador" SET activo = false WHERE id IN ('<X>', '<Z>');
```

- [ ] **Step 2: Verificar la pestaña**

Login en :3001 como `ccalmet@webtilia.com` (clave del clon `Piloto2026!`, 2FA en `dev-server.log`). En el detalle del ciclo debe aparecer `⚠ Incidentes (N)` con los evaluados impactados agrupados y, en el insumo PAR, el botón «Invalidar la de <par que respondió>…».

- [ ] **Step 3: Ejercitar las 3 resoluciones**

1. Reasignar el JEFE pendiente a otro activo → desaparece de la lista, `CICLO_ROTACION_REASIGNACION` en AuditLog.
2. «No aplica» sobre un pendiente con motivo corto (<10) → error visible; con motivo válido → desaparece, motivo en AuditLog.
3. Invalidar: cancelar el PAR pendiente + invalidar la hermana ENVIADA → verificar:

```sql
SELECT estado FROM "Asignacion" WHERE id = '<hermana>';                      -- INVALIDADA
SELECT accion, detalle FROM "AuditLog" ORDER BY "createdAt" DESC LIMIT 3;    -- EVALUACION_INVALIDADA con motivo
SELECT "notaFinal", "notaCompetencias" FROM "Resultado" WHERE "colaboradorId" = '<evaluado>' AND "cicloId" = '<ciclo>'; -- recalculada sin la voz del par
```

y que el avance del ciclo y «Mi resultado» del evaluado no cuentan la INVALIDADA como pendiente.

- [ ] **Step 4: Restaurar el clone**

```sql
UPDATE "Colaborador" SET activo = true WHERE id IN ('<X>', '<Z>');
```

(las resoluciones aplicadas quedan: son datos de prueba coherentes).

- [ ] **Step 5: Reporte a Christian con capturas y esperar confirmación de deploy**

El deploy requiere: `prisma db push` del enum a Neon ANTES del push de código (agregar un valor de enum es no destructivo), luego `git push origin main`.

---

## Self-review del plan

- **Cobertura del spec:** detección calculada ✓ (T4) · pestaña condicional ✓ (T5) · reasignar/no aplica/invalidar/retiro ✓ (T3+T5) · efectos de INVALIDADA en motor/contadores/preview/slots ✓ (T2) · candados ✓ (T3, guards) · eliminación de huérfanas ✓ (T5) · validación E2E ✓ (T6).
- **Placeholders:** ninguno — todo el código está inline.
- **Consistencia de tipos:** `cancelarAsignacion(id, motivo)` e `invalidarEvaluacion(id, motivo)` definidos en T3 = firmas usadas en T5; `IncidenteEvaluado`/`InsumoPerdido` definidos en T4 = props de T5; `BajaCiclo` se muda a `TabIncidentes.tsx` y `page.tsx` lo importa de ahí.
