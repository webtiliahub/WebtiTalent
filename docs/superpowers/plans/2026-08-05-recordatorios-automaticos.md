# Recordatorios automáticos por correo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cron diario de Vercel que envía los 7 correos de recordatorio del spec (objetivos, evaluaciones, digest RRHH, nota preliminar) según hitos fijos, con registro idempotente y panel de visibilidad para RRHH.

**Architecture:** Motor de hitos puro (`hitos.ts`) + recolector de pendientes (`pendientes.ts`, consultas que reusan cobertura/asignaciones existentes) + 7 plantillas nuevas en el mailer existente + ruta cron protegida con `CRON_SECRET` registrando en `RecordatorioEnvio` (unique diario = idempotencia) + correo transaccional en la action de aprobar + card «Recordatorios» en período y ciclo.

**Tech Stack:** Next.js 16 (route handler + server actions), Prisma 7 (cliente versionado en `src/generated/prisma`, commiteado), Vercel Cron (`vercel.json`), Resend vía `src/shared/lib/mailer.ts`, Vitest (suite actual: 95).

**Spec:** `docs/superpowers/specs/2026-08-05-recordatorios-automaticos-design.md` — manda ante cualquier duda. **Contrato de contenido de los correos:** `docs/superpowers/specs/2026-08-05-recordatorios-mockups.html` (copys aprobados por Christian; transcribir fielmente).

## Global Constraints

- **Hitos:** días restantes exactos → 30=`D30`, 15=`D15`, 7=`D7`, 2..6=`DIARIO`, ≤1=`ULTIMO_DIA`, resto=null. Digest RRHH: lunes, o diario si quedan ≤7 días del proceso más próximo. Nada de `Date.now()` dentro del motor (recibe `hoy`).
- **Deadlines efectivos:** objetivos = `fechaLimiteCarga` del período, salvo extensión individual (`ExtensionPlazoObjetivos.hasta`) que manda para ESA persona; evaluaciones = `fechaFin` del ciclo, excluyendo evaluadores cuyos pendientes son todos de países ya cerrados y asignaciones `INVALIDADA`.
- **Anti-ruido:** sin cuenta = sin correo (contado como «sin cuenta»); máx. 1 correo del mismo tipo por persona por día; quien completa deja de recibir; digest solo si hay pendientes; borradores/cerrados no generan nada; el envío manual existente NO se toca ni bloquea los automáticos.
- **Copys**: los de los mockups, verbatim (incluye «sin tu aprobación, sus objetivos no quedan **activos**», «N sin completar sus objetivos · M jefes por aprobar», «N evaluadores deben M evaluaciones», lenguaje de «comentarios» en conformidad). Español neutro. Plantilla de marca y helpers existentes del mailer.
- **Cron**: `vercel.json` con schedule `0 12 * * *` → `GET /api/cron/recordatorios`; auth `Authorization: Bearer ${CRON_SECRET}` → si no coincide, 401 sin efectos. `CRON_SECRET` se configura en Vercel (runbook, no código).
- **Idempotencia**: `RecordatorioEnvio` con `@@unique([proceso, referencia, hito, fecha, destinatarioId])`; correo 7 además con consulta previa por `(proceso, referencia, destinatarioId)` entre días. Reintento del cron el mismo día = no-op. Fallos individuales no frenan el lote (`Promise.allSettled`, patrón de `enviarRecordatoriosPeriodo`).
- Schema ADITIVO (`db push` al clone; cliente regenerado COMMITEADO). `npx tsc --noEmit` limpio y `npx vitest run` verde antes de cada commit. Sin `git add -A`.
- Anclas del terreno (verificadas): `coberturaPeriodo(periodoId)` en `src/features/objetivos/acciones-periodo.ts:155`; `enviarRecordatoriosPeriodo(periodoId)` ídem `:243` (patrón de lote); `resolverObjetivo(formData)` en `src/features/objetivos/acciones.ts:122` (la usan jefe Y RRHH); criterio de preview en `ciclosConNotaPreview` (`src/features/resultados/PreviewResultado.tsx:10`): 0 asignaciones del evaluado fuera de `['ENVIADA','INVALIDADA']` + `calcularResultado(...).notaFinal !== null` + país no cerrado; extensiones en `ExtensionPlazoObjetivos { periodoId, colaboradorId, hasta }`.

---

### Task 1: Schema `RecordatorioEnvio` + motor de hitos puro

**Files:**
- Modify: `prisma/schema.prisma` (modelo nuevo al final de la sección de configuración/auditoría)
- Create: `src/features/recordatorios/hitos.ts`
- Test: `src/features/recordatorios/hitos.test.ts`

**Interfaces:**
- Produces (consumen Tasks 3-5):

```ts
export type Hito = 'D30' | 'D15' | 'D7' | 'DIARIO' | 'ULTIMO_DIA'
export function diasRestantes(deadline: Date, hoy: Date): number // días calendario (deadline - hoy), truncando horas
export function hitoDelDia(deadline: Date, hoy: Date): Hito | null
export function tocaDigestRrhh(deadlineMasProximo: Date | null, hoy: Date): boolean
export function proximoHito(deadline: Date, hoy: Date): { hito: Hito; fecha: Date } | null // para el panel
```

- [ ] **Step 1: Modelo en el schema** (copiar del spec, sección «Registro e idempotencia» — el modelo exacto ya está ahí). Run: `npx prisma db push && npx prisma generate` (clone local); commitear diff de `src/generated/prisma` con la task.

- [ ] **Step 2: Tests del motor (fallan)** — crear `hitos.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { diasRestantes, hitoDelDia, tocaDigestRrhh, proximoHito } from './hitos'

const d = (s: string) => new Date(`${s}T00:00:00`)

describe('hitoDelDia', () => {
  const deadline = d('2026-09-30')
  it.each([
    ['2026-08-31', 'D30'], ['2026-09-15', 'D15'], ['2026-09-23', 'D7'],
    ['2026-09-25', 'DIARIO'], ['2026-09-28', 'DIARIO'],
    ['2026-09-29', 'ULTIMO_DIA'], ['2026-09-30', 'ULTIMO_DIA'],
  ])('a %s → %s', (hoy, hito) => expect(hitoDelDia(deadline, d(hoy))).toBe(hito))
  it.each([['2026-08-30'], ['2026-09-01'], ['2026-09-16'], ['2026-09-22']])('a %s → null (sin hito)', (hoy) =>
    expect(hitoDelDia(deadline, d(hoy))).toBeNull())
  it('deadline vencido → null (el proceso cerrado no genera)', () => {
    expect(hitoDelDia(deadline, d('2026-10-01'))).toBeNull()
  })
  it('ventana corta de 10 días: solo tiene D7 y diarios', () => {
    const corto = d('2026-08-15')
    expect(hitoDelDia(corto, d('2026-08-08'))).toBe('D7')
    expect(hitoDelDia(corto, d('2026-08-10'))).toBe('DIARIO')
    expect(hitoDelDia(corto, d('2026-08-05'))).toBeNull() // a 10 días no toca nada
  })
  it('las horas no cuentan: se compara por fecha calendario', () => {
    expect(hitoDelDia(new Date('2026-09-30T23:59:59'), new Date('2026-09-23T09:15:00'))).toBe('D7')
  })
})

describe('tocaDigestRrhh', () => {
  it('lunes con pendientes lejos del cierre → true', () => {
    expect(tocaDigestRrhh(d('2026-12-01'), d('2026-08-10'))).toBe(true) // 2026-08-10 es lunes
  })
  it('martes lejos del cierre → false', () => {
    expect(tocaDigestRrhh(d('2026-12-01'), d('2026-08-11'))).toBe(false)
  })
  it('cualquier día con el proceso a ≤7 días → true', () => {
    expect(tocaDigestRrhh(d('2026-08-15'), d('2026-08-12'))).toBe(true) // miércoles, quedan 3
  })
  it('sin procesos (null) → false', () => {
    expect(tocaDigestRrhh(null, d('2026-08-10'))).toBe(false)
  })
})

describe('proximoHito', () => {
  it('devuelve el siguiente hito con su fecha', () => {
    expect(proximoHito(d('2026-09-30'), d('2026-08-20'))).toEqual({ hito: 'D30', fecha: d('2026-08-31') })
    expect(proximoHito(d('2026-09-30'), d('2026-09-24'))).toEqual({ hito: 'DIARIO', fecha: d('2026-09-25') })
  })
  it('deadline vencido → null', () => {
    expect(proximoHito(d('2026-09-30'), d('2026-10-02'))).toBeNull()
  })
})
```

- [ ] **Step 3: Correr y ver que falla.** Run: `npx vitest run src/features/recordatorios/hitos.test.ts` — FAIL (módulo no existe).

- [ ] **Step 4: Implementar** `hitos.ts`:

```ts
/** Motor de hitos de los recordatorios automáticos. PURO: recibe `hoy`, nunca usa Date.now().
 * Cadencia fija del spec: 30/15/7 días antes del deadline + diario en la última semana. */

export type Hito = 'D30' | 'D15' | 'D7' | 'DIARIO' | 'ULTIMO_DIA'

const DIA_MS = 24 * 60 * 60 * 1000
const soloFecha = (f: Date) => new Date(f.getFullYear(), f.getMonth(), f.getDate())

/** Días calendario entre hoy y el deadline (las horas no cuentan). */
export function diasRestantes(deadline: Date, hoy: Date): number {
  return Math.round((soloFecha(deadline).getTime() - soloFecha(hoy).getTime()) / DIA_MS)
}

export function hitoDelDia(deadline: Date, hoy: Date): Hito | null {
  const dias = diasRestantes(deadline, hoy)
  if (dias < 0) return null
  if (dias <= 1) return 'ULTIMO_DIA'
  if (dias <= 6) return 'DIARIO'
  if (dias === 7) return 'D7'
  if (dias === 15) return 'D15'
  if (dias === 30) return 'D30'
  return null
}

/** Digest RRHH: lunes mientras haya pendientes, y diario en la última semana del proceso más próximo. */
export function tocaDigestRrhh(deadlineMasProximo: Date | null, hoy: Date): boolean {
  if (!deadlineMasProximo) return false
  const dias = diasRestantes(deadlineMasProximo, hoy)
  if (dias < 0) return false
  return hoy.getDay() === 1 || dias <= 7
}

/** Siguiente hito futuro (para la card «Recordatorios» del panel). */
export function proximoHito(deadline: Date, hoy: Date): { hito: Hito; fecha: Date } | null {
  for (let i = 1; i <= 45; i++) {
    const dia = new Date(soloFecha(hoy).getTime() + i * DIA_MS)
    const hito = hitoDelDia(deadline, dia)
    if (hito) return { hito, fecha: dia }
  }
  return null
}
```

- [ ] **Step 5: Verde + suite completa.** Run: `npx vitest run && npx tsc --noEmit` — nuevos y 95 previos verdes, tipos limpios.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma src/generated/prisma src/features/recordatorios/hitos.ts src/features/recordatorios/hitos.test.ts
git commit -m "feat: motor de hitos de recordatorios + modelo RecordatorioEnvio"
```

---

### Task 2: Las 7 plantillas de correo en el mailer

**Files:**
- Modify: `src/shared/lib/mailer.ts` (agregar funciones al final; helpers existentes `plantilla/titulo/parrafo/bloqueDestacado/botonCta/notaGris/esc` se reusan)

**Interfaces:**
- Produces (consume Task 4):

```ts
export type PendienteEvaluacion = { modalidad: 'AUTO' | 'JEFE' | 'PAR' | 'ASCENDENTE'; evaluado: string }
export type FilaAprobacionJefe = { nombre: string; objetivos: number; pesoTotal: number }
export type FilaObjetivoAprobado = { titulo: string; peso: number }
export type DigestPais = { pais: string; sinCompletar: number; jefesPorAprobar: number }
export type DigestPaisEval = { pais: string; evaluadores: number; evaluaciones: number }

export async function enviarRecordatorioObjetivosAuto(email: string, nombre: string, periodo: string, deadlineTexto: string, avance: number, diasRestantes: number, ultimoDia: boolean): Promise<void>
export async function enviarRecordatorioAprobacionesJefe(email: string, nombre: string, periodo: string, deadlineTexto: string, filas: FilaAprobacionJefe[], diasRestantes: number): Promise<void>
export async function enviarObjetivosAprobados(email: string, nombre: string, periodo: string, filas: FilaObjetivoAprobado[], totalPct: number): Promise<void>
export async function enviarRecordatorioEvaluaciones(email: string, nombre: string, ciclo: string, deadlineTexto: string, pendientes: PendienteEvaluacion[], diasRestantes: number, ultimoDia: boolean): Promise<void>
export async function enviarDigestRrhh(email: string, nombre: string, fechaTexto: string, objetivos: { periodo: string; diasRestantes: number; filas: DigestPais[] } | null, evaluaciones: { ciclo: string; diasRestantes: number; filas: DigestPaisEval[]; avancePct: number } | null): Promise<void>
export async function enviarNotaPreliminarDisponible(email: string, nombre: string, ciclo: string): Promise<void>
```

(La variante «último día» —correo 6— es el flag `ultimoDia` de los correos 1 y 4: agrega la banda roja superior y cambia el asunto, como en el mockup.)

- [ ] **Step 1: Transcribir cada plantilla** desde `docs/superpowers/specs/2026-08-05-recordatorios-mockups.html` — LEERLO PRIMERO: los títulos, asuntos, textos, tablas internas (chips de modalidad con sus colores, barra de avance, listas con pesos, cards por país del digest, los 3 pasos del correo 7 y la banda «⏰ HOY es el último día») son el contrato aprobado; se transcriben con los helpers existentes + HTML inline igual al de las plantillas actuales. Cada función mantiene el patrón del archivo: `modoConsola(...)` primero (una línea informativa sin datos sensibles), HTML + texto plano equivalente.
- Los chips de modalidad usan estos pares (del mockup): AUTO `#fdf1f3/#c30f33`, JEFE `#eef4fb/#1d5ca8`, PAR `#f3eefb/#6a3fb8`, ASCENDENTE reutiliza el par del JEFE con etiqueta `ASC`.
- Asuntos exactos del mockup (con `diasRestantes` interpolado); en `ultimoDia`, asunto «ÚLTIMO DÍA: …».

- [ ] **Step 2: Verificación visual rápida.** Script efímero en `/Users/christianisrael/.claude/jobs/b3aa4572/tmp/` que importe las 6 funciones, genere el HTML de cada una con datos de ejemplo (sin enviar: extraer el HTML llamando a `plantilla(...)` desde una función auxiliar exportada de prueba NO es necesario — basta correr las funciones con `RESEND_API_KEY` sin definir y `NODE_ENV=test`, que imprime a consola; para el HTML, el script puede reconstruirlo llamando a las funciones internas si el implementador las exporta, o simplemente verificar por lectura). Mínimo exigible: correr cada función en modo consola sin errores y revisar por diff visual una de ellas contra el mockup abierto en el navegador.

- [ ] **Step 3: Tipos + suite.** Run: `npx tsc --noEmit && npx vitest run` — limpio/verde (el mailer no tiene tests unitarios; patrón del archivo).

- [ ] **Step 4: Commit**

```bash
git add src/shared/lib/mailer.ts
git commit -m "feat: las 7 plantillas de correo de recordatorios (contrato de los mockups)"
```

---

### Task 3: Recolector de pendientes (`pendientes.ts`)

**Files:**
- Create: `src/features/recordatorios/pendientes.ts`
- Test: `src/features/recordatorios/pendientes.test.ts` (solo los helpers puros)

**Interfaces:**
- Consumes: `coberturaPeriodo(periodoId)` (`src/features/objetivos/acciones-periodo.ts:155` — leer su retorno real y reusar o extraer su núcleo), asignaciones Prisma, `calcularResultado` (`src/features/resultados/servicio.ts:67`), `ExtensionPlazoObjetivos`, `paisesCongelados`/cierres (`src/features/ciclos/congelamiento.ts`), tipos de correo de Task 2.
- Produces (consume Task 4):

```ts
export type DestinatarioObjetivos = { colaboradorId: string; email: string; nombre: string; avance: number; deadline: Date }
export type DestinatarioJefe = { email: string; nombre: string; filas: FilaAprobacionJefe[] }
export type DestinatarioEvaluador = { colaboradorId: string; email: string; nombre: string; pendientes: PendienteEvaluacion[] }
export type DatosDigestRrhh = {
  usuario: { email: string; nombre: string; alcancePaisId: string | null }
  objetivos: { periodo: string; diasRestantes: number; filas: DigestPais[] } | null
  evaluaciones: { ciclo: string; diasRestantes: number; filas: DigestPaisEval[]; avancePct: number } | null
} // exactamente los shapes que consume enviarDigestRrhh (Task 2)

export async function pendientesObjetivos(periodoId: string): Promise<{ deadlinePeriodo: Date; destinatarios: DestinatarioObjetivos[]; sinCuenta: number }>
export async function aprobacionesPorJefe(periodoId: string): Promise<{ destinatarios: DestinatarioJefe[]; sinCuenta: number }>
export async function pendientesEvaluaciones(cicloId: string): Promise<{ deadline: Date; destinatarios: DestinatarioEvaluador[]; sinCuenta: number }>
export async function datosDigestRrhh(): Promise<DatosDigestRrhh[]> // una entrada por cuenta RRHH activa, ya recortada a su alcance; vacías filtradas
export async function notasPreliminaresNuevas(cicloId: string): Promise<{ colaboradorId: string; email: string; nombre: string }[]> // preview habilitado (criterio de ciclosConNotaPreview) SIN registro previo en RecordatorioEnvio
```

Reglas obligatorias dentro de estas funciones:
- `pendientesObjetivos`: colaboradores activos del alcance del período con peso total < 100; el `deadline` de cada uno es su extensión (`ExtensionPlazoObjetivos.hasta`) si existe, si no el del período. Los sin cuenta se cuentan, no se listan.
- `aprobacionesPorJefe`: objetivos `PENDIENTE` (propuestas) agrupados por jefe directo del colaborador; jefes sin cuenta → contador.
- `pendientesEvaluaciones`: asignaciones con `estado` fuera de `['ENVIADA','INVALIDADA']` de ciclos ACTIVOS, agrupadas por EVALUADOR, excluyendo las de evaluados cuyo país ya está cerrado en el ciclo (`CicloPaisCierre`); orden de la lista: AUTO primero, luego JEFE/PAR/ASCENDENTE.
- `datosDigestRrhh`: usuarios `rol='RRHH'` activos; Regional agrega por país, alcance PAIS filtra a su país; combina el estado de TODOS los períodos en carga y ciclos activos (si hay más de uno, el más próximo a cerrar encabeza y los demás suman filas); si su alcance no tiene pendientes → se excluye.
- `notasPreliminaresNuevas`: para cada evaluado del ciclo con cuenta: 0 asignaciones sin enviar (mismo criterio que `ciclosConNotaPreview`, incluida la exclusión del país cerrado) + `calcularResultado(...).notaFinal !== null` + SIN fila en `RecordatorioEnvio (proceso='NOTA_PRELIMINAR', referencia=cicloId, destinatarioId=colaboradorId)`.

- [ ] **Step 1: Tests de los helpers puros (fallan).** Extraer como funciones puras exportadas y testear: `deadlineEfectivo(deadlinePeriodo, extension?: Date)` (la extensión manda solo si es posterior); `ordenarPendientes(pendientes)` (AUTO primero); `agruparDigestPorPais(filas)` (suma correcta por país, orden alfabético). Escribir 5-6 casos concretos con datos literales.

- [ ] **Step 2: FAIL → implementar → PASS.** Las funciones con Prisma no llevan unit tests (patrón del proyecto): las cubre el E2E de la Task 5. Run: `npx vitest run && npx tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add src/features/recordatorios/pendientes.ts src/features/recordatorios/pendientes.test.ts
git commit -m "feat: recolector de pendientes de recordatorios (objetivos, jefes, evaluaciones, digest, preliminares)"
```

---

### Task 4: Ruta cron + vercel.json + transaccional de aprobación

**Files:**
- Create: `src/app/api/cron/recordatorios/route.ts`
- Create: `vercel.json`
- Modify: `src/features/objetivos/acciones.ts` (`resolverObjetivo`, rama de aprobación)

**Interfaces:**
- Consumes: todo lo de Tasks 1-3.

- [ ] **Step 1: `vercel.json`**

```json
{
  "crons": [{ "path": "/api/cron/recordatorios", "schedule": "0 12 * * *" }]
}
```

(OJO: el repo no tiene `vercel.json` ni `vercel.ts`; verificar que crearlo no pise configuración implícita — el proyecto usa defaults, así que un archivo solo-crons es seguro.)

- [ ] **Step 2: La ruta.** Estructura completa de `route.ts`:

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/shared/lib/prisma'
import { hitoDelDia, tocaDigestRrhh, diasRestantes } from '@/features/recordatorios/hitos'
import { pendientesObjetivos, aprobacionesPorJefe, pendientesEvaluaciones, datosDigestRrhh, notasPreliminaresNuevas } from '@/features/recordatorios/pendientes'
import { enviarRecordatorioObjetivosAuto, enviarRecordatorioAprobacionesJefe, enviarRecordatorioEvaluaciones, enviarDigestRrhh, enviarNotaPreliminarDisponible } from '@/shared/lib/mailer'

export const maxDuration = 300 // lotes grandes de correo contra Resend

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const hoy = new Date()
  const resumen: Record<string, unknown>[] = []
  // 1. Objetivos por período en carga (hito por DEADLINE EFECTIVO de cada persona)
  // 2. Aprobaciones por jefe (hito por deadline del período)
  // 3. Evaluaciones por ciclo activo (hito por fechaFin)
  // 4. Nota preliminar (transición, sin hito)
  // 5. Digest RRHH (tocaDigestRrhh sobre el deadline más próximo)
  // Cada bloque: verificar RecordatorioEnvio (unique del día) ANTES de enviar; enviar con
  // Promise.allSettled; registrar { enviados, fallidos, detalleJson } SIEMPRE (aunque 0 enviados
  // NO se registra: el día sin hito no deja fila). El try/catch por bloque aísla fallas.
  return NextResponse.json({ ok: true, resumen })
}
```

Puntos de implementación obligatorios (el pseudocódigo de arriba se expande):
- **Registro-antes-de-enviar**: `prisma.recordatorioEnvio.create` con el unique como candado — se intenta crear la fila del día ANTES del lote (con `enviados: 0`); si el create falla por P2002, el lote ya corrió hoy → skip. Al terminar el lote, `update` con los conteos reales. Así el reintento del cron nunca re-envía aunque el proceso muera a mitad del lote.
- Hito por persona en objetivos: los destinatarios se agrupan por su deadline efectivo; para cada grupo se evalúa `hitoDelDia(deadlineDelGrupo, hoy)` y solo los grupos con hito reciben. `hito` del registro = el del deadline del PERÍODO (los extendidos comparten fila vía `detalleJson`).
- Digest: el `hito` registrado es `'SEMANAL'` (o `'DIARIO'` en última semana), `referencia` = `'GLOBAL'` (el digest cruza procesos), `destinatarioId` null.
- Correo 7: consulta previa por destinatario (regla del spec) + registro por destinatario con `hito='UNICO'`.
- La variante último día usa el flag `ultimoDia: hito === 'ULTIMO_DIA'` de las plantillas.

- [ ] **Step 3: Transaccional en `resolverObjetivo`.** En la rama de APROBACIÓN (después del update exitoso): si la aprobación fue SIMPLE (sin ajuste de campos — cuando hubo ajuste ya sale `enviarObjetivoReemplazado`, no duplicar), enviar `enviarObjetivosAprobados` al colaborador con el objetivo aprobado y su peso + el total actual del colaborador en el período (consultar suma de APROBADO + transversales aplicables — reusar el cálculo que ya hace el preflight/cobertura o una suma directa). El envío va en try/catch que NO rompe la aprobación (correo es best-effort; patrón de los correos de cierre). Verificar si existe alguna action de aprobación MASIVA (grep `aprobarTodos|aprobarVarios`); si existe, agrupar ahí en un solo correo por colaborador.

- [ ] **Step 4: Prueba local de la ruta.** Con el dev en :3001 y `CRON_SECRET=test-local` en `.env`: `curl -s -H "Authorization: Bearer test-local" http://localhost:3001/api/cron/recordatorios` → 200 con resumen (los correos salen en modo consola del mailer al log del dev). Sin header → 401. Documentar output en el reporte.

- [ ] **Step 5: Tipos + suite + commit**

```bash
git add vercel.json src/app/api/cron/recordatorios/route.ts src/features/objetivos/acciones.ts
git commit -m "feat: cron diario de recordatorios + correo transaccional de objetivos aprobados"
```

---

### Task 5: Panel «Recordatorios» + E2E integral en el clone

**Files:**
- Create: `src/features/recordatorios/CardRecordatorios.tsx`
- Modify: `src/app/(app)/admin/periodos/[id]/page.tsx` (insertar card; el botón manual existente se muda a su lado)
- Modify: `src/app/(app)/admin/ciclos/[id]/page.tsx` (ídem para el ciclo, junto al envío manual del ciclo si existe, o la card sola informativa)

**Interfaces:**
- Consumes: `proximoHito` (T1), `RecordatorioEnvio` (lectura), el botón manual existente (`enviarRecordatoriosPeriodo`).

- [ ] **Step 1: `CardRecordatorios`** (server component, recibe `proceso` y `referencia`): consulta el último `RecordatorioEnvio` de la referencia (cualquier hito, orden `creadoEn desc`) y muestra: «Último automático: {fecha} · hito {hito} · {enviados} enviados{, N fallidos}» o «Aún sin envíos automáticos»; «Próximo hito: {hito} · {fecha}» calculado con `proximoHito(deadline, hoy)`; y el slot para el botón manual (children). Estilo `Card` con `Nota` del design system existente. Sin acciones nuevas.

- [ ] **Step 2: Insertarla** en el detalle del período (envolviendo/junto al botón manual actual) y en el detalle del ciclo (sección de administración del ciclo, visible con los guards actuales de la página).

- [ ] **Step 3: E2E integral en el clone** (documentar TODO con outputs en el reporte):
1. Preparar datos: crear en el clone un período de objetivos `CARGA_ABIERTA` con `fechaLimiteCarga` a 7 días de hoy (script efímero en `/Users/christianisrael/.claude/jobs/b3aa4572/tmp/`, ajuste de fechas directo en BD) y un ciclo ACTIVO chico (alcance flexible: un área) con `fechaFin` a 3 días.
2. Disparar `curl` a la ruta cron con el secreto local → verificar en el log del dev (modo consola) los correos 1, 2, 4 con los destinatarios correctos y en BD las filas de `RecordatorioEnvio` (hito D7 para objetivos, DIARIO para el ciclo).
3. Segunda corrida inmediata → 0 envíos nuevos (idempotencia por unique).
4. Cambiar `fechaFin` del ciclo a mañana → corrida → variante ULTIMO_DIA en el log (banda/asunto) y digest RRHH diario (≤7 días).
5. Correo 3: aprobar un objetivo pendiente por la UI (sesión de Christian o Jazmin) → correo transaccional en el log.
6. Correo 7: completar los insumos de un evaluado del ciclo chico (enviar sus evaluaciones por UI o BD) → corrida → correo de nota preliminar; corrida siguiente → no se repite.
7. Panel: el detalle del período y del ciclo muestran «Último automático» con los datos reales y el próximo hito.
8. Limpiar los datos de prueba del clone (período y ciclo de QA con sus cascades) y documentar la limpieza.

- [ ] **Step 4: Suite + commit**

```bash
git add src/features/recordatorios/CardRecordatorios.tsx "src/app/(app)/admin/periodos/[id]/page.tsx" "src/app/(app)/admin/ciclos/[id]/page.tsx"
git commit -m "feat: card Recordatorios en período y ciclo (último envío + próximo hito)"
```

---

## Notas de deploy (runbook, al final con confirmación de Christian)

1. `db push` a Neon (tabla `RecordatorioEnvio`, aditiva).
2. Crear `CRON_SECRET` en Vercel (valor aleatorio largo; NUNCA en el chat — generar con `openssl rand -hex 32` directo a la config).
3. `git push` → Vercel registra el cron de `vercel.json` automáticamente.
4. Smoke: disparar la ruta a mano con el secreto (vía curl) fuera del horario y verificar 200 + registros; el primer envío real sale 12:00 UTC del día siguiente.
