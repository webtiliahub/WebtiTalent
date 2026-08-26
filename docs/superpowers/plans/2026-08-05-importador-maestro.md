# Importador maestro del Excel de carga — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pestaña «Carga maestra» en Configuración que importa el Excel único de Hunter (estructura + padrón) con dry-run integral y aplicación transaccional, más el script de purga y el runbook de carga inicial de producción.

**Architecture:** Tres capas: (1) parser puro del workbook (`xlsx`/SheetJS, sin BD) que localiza hojas y encabezados y devuelve secciones tipadas; (2) planificador puro que cruza las secciones con un snapshot plano de la BD y produce el plan de cambios + errores/avisos (jerarquía hoja 6 > hoja 3, derivación de nivel del padrón); (3) server action `importarMaestro(formData, aplicar)` que orquesta snapshot → parser → plan → dry-run o aplicación ordenada, reutilizando el motor de padrón existente extraído de `importarPadron`.

**Tech Stack:** Next.js 16 (server actions), Prisma 7 (cliente versionado en `src/generated/prisma`), `xlsx` (SheetJS, dependencia NUEVA), Vitest (suite actual: 56 tests), Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-08-05-importador-maestro-carga-inicial-design.md` — sus decisiones mandan; leerla ante cualquier duda.

## Global Constraints

- **Jerarquía de pesos:** hoja 6 (por puesto) es la ESPECÍFICA y manda; hoja 3 (por nivel) es el fallback cuando el puesto no está en la hoja 6. Fila de hoja 6 ≠ pesos de su nivel → se aplica y se reporta como «personalización explícita». Suma ≠ 100 = error bloqueante.
- **Nivel del padrón SE IGNORA y se deriva del cargo vía hoja 4.** Si difiere de lo derivado → aviso con conteo. Cargo del padrón sin fila en hoja 4 = bloqueante.
- **Normalización transversal** de nombres: sin tildes, minúsculas, espacios colapsados (reutilizar el criterio del `normalizar` de `src/shared/ui/SelectorMultiple.tsx`; el planificador tiene su copia local pura). Duplicados tras normalizar se fusionan y reportan (el archivo real trae 5).
- **Candado:** algún ciclo `ACTIVO` ⇒ la APLICACIÓN se bloquea (el dry-run se permite, anunciando el bloqueo).
- **Idempotencia:** re-subir el archivo aplicado ⇒ dry-run con 0 cambios en todas las secciones.
- Hojas 1, 2 y Léeme se ignoran. Competencia de la hoja 5 inexistente en BD = bloqueante (no hay altas de competencias). `puntajeEsperado` se conserva (default 3 en puestos nuevos). Hoja 7: solo la columna del año vigente 2026 (Jefe/Par/Ascendente/Auto → `Config.pesosModalidades`); 2027/2028 solo referencia en el reporte.
- **Re-vinculación de cuentas por email** (case-insensitive) al aplicar el padrón: `usuario.colaboradorId` → fila nueva; contraseña/rol/rolAdmin/alcance INTACTOS; cuentas sin match solo se reportan.
- Guards: página `requiereAdmin('CONFIGURACION','VER')`; action `requiereAdmin('CONFIGURACION','GESTIONAR')` + solo RRHH Regional (el archivo cruza países, mismo criterio de `importarPadron`).
- Archivo ≤ 10 MB, procesado en memoria (nunca a disco/blob). El importador NUNCA borra puestos ni da bajas de colaboradores (solo avisos).
- UI en español neutro, sin emojis como iconos. Tests: `npx vitest run` (56 existentes verdes) y `npx tsc --noEmit` limpios antes de cada commit. Sin `git add -A`.
- Dev contra el clone local. El archivo real para E2E: `/Users/christianisrael/Downloads/Copia de Hunter_Carga_Maestra_v2.xlsx` (copiarlo a un fixture local NO commiteado; contiene PII).

---

### Task 1: Parser puro del workbook (`maestro-parser.ts`)

**Files:**
- Create: `src/features/admin/maestro/parser.ts`
- Test: `src/features/admin/maestro/parser.test.ts`
- Modify: `package.json` (dependencia `xlsx`)

**Interfaces:**
- Consumes: `xlsx` (`XLSX.read(buffer)`, `XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })`).
- Produces (las consumen Tasks 2-3):

```ts
export type SeccionNiveles = { nivel: string; pesosDim: number[]; compPct: number; objPct: number }[]
export type SeccionPuestos = { puesto: string; nivel: string }[]
export type SeccionCompetencias = { puesto: string; competencias: string[] }[] // nombres de competencia marcados
export type SeccionPesosPuesto = { puesto: string; nivel: string; pesosDim: number[] }[]
export type SeccionEvaluadores = { evaluador: string; anio1: number; anio2: number; anio3: number }[]
export type FilaPadronMaestro = {
  linea: number; codigo: string; documento: string; nombres: string; apellidos: string
  email: string; telefono: string; pais: string; area: string; cargo: string
  nivel: string; codigoJefe: string; liderazgo: string; fechaIngreso: string
}
export type MaestroParseado = {
  niveles: SeccionNiveles; puestos: SeccionPuestos; competencias: SeccionCompetencias
  pesosPuesto: SeccionPesosPuesto; evaluadores: SeccionEvaluadores; padron: FilaPadronMaestro[]
  errores: string[] // hoja requerida ausente, encabezado no encontrado
}
export function parseMaestro(buffer: ArrayBuffer): MaestroParseado
export function normalizar(s: string): string // sin tildes, minúsculas, espacios colapsados
```

- [ ] **Step 1: Instalar la dependencia**

Run: `npm i xlsx` — commitea `package.json` y `package-lock.json` junto con la task.

- [ ] **Step 2: Tests del parser (fallan)**

Los fixtures se construyen EN MEMORIA con la propia librería (`XLSX.utils.book_new()` + `aoa_to_sheet`), reproduciendo la estructura real: 2-3 filas de título antes del encabezado. Crear `src/features/admin/maestro/parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseMaestro, normalizar } from './parser'

function libro(hojas: Record<string, (string | number)[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const [nombre, filas] of Object.entries(hojas)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), nombre)
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

const HOJAS_MINIMAS = {
  '3. Niveles': [
    ['Niveles: pesos por dimensión'], ['leyenda'],
    ['Nivel', 'D1 %', 'D2 %', 'D3 %', 'D4 %', 'D5 %', 'TOTAL', '% Competencias (POR LLENAR)', '% Objetivos (POR LLENAR)', 'Check'],
    ['Gerencial', 20, 15, 15, 30, 20, 100, 60, 40, '✓'],
    ['Apoyo', 15, 35, 30, 10, 10, 100, 50, 50, '✓'],
  ],
  '4. Puestos': [
    ['Puestos del padrón'], ['leyenda'],
    ['Puesto', 'Nivel jerárquico', 'Área (mayoritaria)', 'Países', 'Titulares', 'Revisión'],
    ['GERENTE GENERAL', 'Gerencial', 'DIRECCIÓN', 'Perú', 1, ''],
    ['Agente De Seguridad', 'Apoyo', 'SEGURIDAD', 'Perú', 10, ''],
  ],
  '5. Competencias x Puesto': [
    ['Competencias por puesto'], ['leyenda'],
    ['', '', 'D1 · Analítica', ''],
    ['Puesto', 'Nivel', 'Pensamiento crítico', 'Análisis de datos'],
    ['GERENTE GENERAL', 'Gerencial', 'X', 'X'],
    ['Agente De Seguridad', 'Apoyo', 'X', ''],
  ],
  '6. Pesos x Puesto': [
    ['Pesos por dimensión POR PUESTO'], ['leyenda'],
    ['Puesto', 'Nivel', 'D1', 'D2', 'D3', 'D4', 'D5', 'TOTAL'],
    ['GERENTE GENERAL', 'Gerencial', 20, 15, 15, 30, 20, 100],
  ],
  '7. Pesos evaluadores': [
    ['Pesos por tipo de evaluación'], ['leyenda'],
    ['Evaluador', 'Año 1 (2026)', 'Año 2 (2027)', 'Año 3 (2028+)', 'Dimensiones que evalúa'],
    ['Jefe directo', 50, 45, 40, 'D1–D5 + Potencial'],
  ],
  '8. Padrón': [
    ['Padrón de colaboradores'], ['leyenda'],
    ['codigo', 'documento', 'nombres', 'apellidos', 'email', 'telefono', 'pais', 'area', 'cargo', 'nivel_jerarquico', 'codigo_jefe', 'nivel_liderazgo', 'fecha_ingreso', '⚠ Observación (no se carga)'],
    ['PER-001', '123', 'Ana', 'Pérez', 'ana@hunter.com.pe', '', 'Perú', 'DIRECCIÓN', 'GERENTE GENERAL', 'Gerencial', '', 'N2', '2020-01-15'],
  ],
}

describe('normalizar', () => {
  it('quita tildes, baja a minúsculas y colapsa espacios', () => {
    expect(normalizar('  Técnico   De Taller ')).toBe('tecnico de taller')
  })
})

describe('parseMaestro', () => {
  it('parsea las 6 secciones localizando encabezados tras filas de título', () => {
    const r = parseMaestro(libro(HOJAS_MINIMAS))
    expect(r.errores).toEqual([])
    expect(r.niveles).toEqual([
      { nivel: 'Gerencial', pesosDim: [20, 15, 15, 30, 20], compPct: 60, objPct: 40 },
      { nivel: 'Apoyo', pesosDim: [15, 35, 30, 10, 10], compPct: 50, objPct: 50 },
    ])
    expect(r.puestos).toEqual([
      { puesto: 'GERENTE GENERAL', nivel: 'Gerencial' },
      { puesto: 'Agente De Seguridad', nivel: 'Apoyo' },
    ])
    expect(r.competencias).toEqual([
      { puesto: 'GERENTE GENERAL', competencias: ['Pensamiento crítico', 'Análisis de datos'] },
      { puesto: 'Agente De Seguridad', competencias: ['Pensamiento crítico'] },
    ])
    expect(r.pesosPuesto).toEqual([{ puesto: 'GERENTE GENERAL', nivel: 'Gerencial', pesosDim: [20, 15, 15, 30, 20] }])
    expect(r.evaluadores).toEqual([{ evaluador: 'Jefe directo', anio1: 50, anio2: 45, anio3: 40 }])
    expect(r.padron).toHaveLength(1)
    expect(r.padron[0]).toMatchObject({ linea: 4, codigo: 'PER-001', cargo: 'GERENTE GENERAL', nivel: 'Gerencial', email: 'ana@hunter.com.pe' })
  })
  it('identifica hojas por nombre normalizado aunque cambie el prefijo', () => {
    const hojas = Object.fromEntries(Object.entries(HOJAS_MINIMAS).map(([k, v]) => [k.replace(/^\d+\. /, 'Hoja - '), v]))
    expect(parseMaestro(libro(hojas)).errores).toEqual([])
  })
  it('hoja requerida ausente = error que la nombra', () => {
    const { '8. Padrón': _omitida, ...sin } = HOJAS_MINIMAS
    const r = parseMaestro(libro(sin))
    expect(r.errores.some((e) => e.toLowerCase().includes('padr'))).toBe(true)
  })
  it('encabezado no encontrado = error que nombra la hoja', () => {
    const rotas = { ...HOJAS_MINIMAS, '4. Puestos': [['solo título'], ['sin encabezado real']] }
    const r = parseMaestro(libro(rotas))
    expect(r.errores.some((e) => e.includes('Puestos'))).toBe(true)
  })
})
```

- [ ] **Step 3: Correr y ver que falla**

Run: `npx vitest run src/features/admin/maestro/parser.test.ts`
Expected: FAIL — «Cannot find module './parser'».

- [ ] **Step 4: Implementar el parser**

Crear `src/features/admin/maestro/parser.ts`. Puntos obligatorios de la implementación (el resto es mecánica de recorrido):

```ts
import * as XLSX from 'xlsx'

/** Sin tildes, minúsculas, espacios colapsados — criterio único de matching del importador. */
export function normalizar(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ')
}

// Identificación de hojas: la CLAVE debe estar contenida en el nombre normalizado
const CLAVES_HOJA = {
  niveles: 'niveles', puestos: 'puestos', competencias: 'competencias x puesto',
  pesosPuesto: 'pesos x puesto', evaluadores: 'pesos evaluadores', padron: 'padron',
} as const
// OJO: 'puestos' también matchea 'competencias x puesto' y 'pesos x puesto' —
// resolver por especificidad: asignar primero las claves más largas y excluir hojas ya tomadas.

// Localización de encabezado: primera fila que contiene TODAS las columnas ancla de la sección
const ANCLAS = {
  niveles: ['nivel', 'd1 %'], puestos: ['puesto', 'nivel jerarquico'],
  pesosPuesto: ['puesto', 'nivel', 'd1'], evaluadores: ['evaluador'],
  padron: ['codigo', 'documento', 'nombres'],
} // (hoja 5: encabezado doble — ver abajo)
```

- Hoja 5 (encabezado doble): la fila de encabezado real es la que tiene «puesto» en la primera celda Y nombres de competencia desde la columna 3; la fila anterior (dimensiones) se ignora. Una celda no vacía en la columna de una competencia = marcada.
- Filas de datos: desde el encabezado+1 hasta la primera fila completamente vacía o el fin; filas sin la clave principal (nivel/puesto/código) se saltan.
- `padron[].linea` = número de fila REAL en la hoja (para mensajes «Fila N»).
- Todos los números via `Number(...)`; `NaN` se conserva (el planificador lo convierte en error con contexto).
- El parser NO valida negocio (sumas, existencia): solo estructura. Sus `errores` son únicamente hoja/encabezado ausente.

- [ ] **Step 5: Correr tests + suite completa**

Run: `npx vitest run` — los nuevos pasan y los 56 previos siguen verdes. `npx tsc --noEmit` limpio.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/features/admin/maestro/parser.ts src/features/admin/maestro/parser.test.ts
git commit -m "feat: parser puro del Excel maestro (xlsx, localización de hojas y encabezados)"
```

---

### Task 2: Planificador puro (`maestro-plan.ts`) — validación cruzada y plan de cambios

**Files:**
- Create: `src/features/admin/maestro/plan.ts`
- Test: `src/features/admin/maestro/plan.test.ts`

**Interfaces:**
- Consumes (Task 1): `MaestroParseado`, `normalizar`, tipos de sección.
- Produces (la consume Task 3):

```ts
// Snapshot plano de la BD que el planificador recibe (lo arma la action; el planificador NO toca Prisma)
export type SnapshotBD = {
  niveles: { id: string; nombre: string; compPct: number }[]
  dimensiones: { id: string; nombre: string; orden: number }[] // orden ↔ posición D1..D5
  competencias: { id: string; nombre: string }[]
  paises: { nombre: string }[]
  puestos: { id: string; nombre: string; nivelId: string; pesos: { dimensionId: string; peso: number }[]; competenciaIds: string[] }[]
  pesosModalidades: Record<string, number> // Config actual
  hayCicloActivo: boolean
}
export type PlanMaestro = {
  errores: string[]   // bloqueantes: no se puede aplicar
  avisos: string[]    // conscientes: se aplica igual
  bloqueadoPorCiclo: boolean // ciclo ACTIVO: dry-run visible, aplicación bloqueada
  niveles: { nombre: string; compPctAntes: number; compPctDespues: number }[] // solo los que cambian
  puestosNuevos: { nombre: string; nivel: string }[]
  puestosRehomologados: { nombre: string; nivelAntes: string; nivelDespues: string }[]
  competenciasCambian: { puesto: string; antes: number; despues: number }[] // sets que difieren
  pesosDerivados: number   // puestos cuyos pesos = su nivel (hoja 6 igual o ausente)
  pesosPersonalizados: { puesto: string; pesos: number[]; nivel: string }[] // hoja 6 ≠ nivel: se aplica y se lista
  pesosModalidades: { antes: Record<string, number>; despues: Record<string, number> } | null // null = sin cambio
  padron: { filas: FilaPadronMaestro[]; nivelesIgnorados: number } // filas con nivel YA derivado de hoja 4
  referenciaEvaluadores: { anio2: Record<string, number>; anio3: Record<string, number> } // solo informativo
}
export function planificarMaestro(parseado: MaestroParseado, bd: SnapshotBD): PlanMaestro
```

- [ ] **Step 1: Tests del planificador (fallan)**

Crear `src/features/admin/maestro/plan.test.ts` con un `bd()` helper y el parseado mínimo. Casos OBLIGATORIOS (escribir todos):

```ts
// helper base: 2 niveles (Gerencial compPct 50, Apoyo compPct 50), 5 dimensiones D1-D5,
// 2 competencias («Pensamiento crítico», «Análisis de datos»), 1 país Perú,
// 1 puesto existente «GERENTE GENERAL» (Gerencial, pesos [20,15,15,30,20], ambas competencias)
```

1. **compPct**: hoja 3 con Gerencial 60/40 → `niveles` reporta `{ compPctAntes: 50, compPctDespues: 60 }`; nivel con D1–D5 que no suman 100 → error; comp+obj ≠ 100 → error; nivel desconocido en hoja 3 → error.
2. **Re-homologación**: puesto existente que cambia de nivel en hoja 4 → `puestosRehomologados` con antes/después; puesto de hoja 4 que no existe en BD → `puestosNuevos`.
3. **Jerarquía hoja 6 > hoja 3**: puesto con fila en hoja 6 igual a su nivel → cuenta en `pesosDerivados`; puesto con fila DISTINTA → entra en `pesosPersonalizados` (y NO en derivados); puesto sin fila en hoja 6 → derivado del nivel de hoja 4; fila de hoja 6 con suma ≠ 100 → error; puesto en hoja 6 que no está en hoja 4 → error.
4. **Competencias**: puesto cuyo set de hoja 5 difiere del actual → `competenciasCambian` con conteos; competencia desconocida en BD → error; puesto con CERO competencias marcadas → error; set idéntico → no aparece.
5. **Padrón**: fila cuyo cargo está en hoja 4 con nivel distinto al de la columna del padrón → `padron.filas[i].nivel` = el DERIVADO y `nivelesIgnorados` lo cuenta; cargo sin fila en hoja 4 → error; país desconocido → error.
6. **Duplicados normalizados**: hoja 4 con «Técnico De Taller» y «TÉCNICO DE TALLER» → se fusionan (1 puesto) + aviso.
6b. **Puesto que desaparece**: puesto existente en `bd.puestos` que NO viene en hoja 4 → aviso informativo con el nombre (el importador nunca borra puestos); no es error.
7. **Idempotencia**: parseado que coincide exactamente con la BD → todas las listas vacías, `pesosDerivados` = total de puestos, errores y avisos vacíos (salvo informativos), `pesosModalidades: null`.
8. **Candado**: `bd.hayCicloActivo = true` → `bloqueadoPorCiclo: true` y aviso explícito (no error: el dry-run se ve).
9. **Evaluadores**: hoja 7 → mapeo `{ JEFE: 50, PAR: ..., ASCENDENTE: ..., AUTO: ... }` desde los nombres de fila («Jefe directo»→JEFE, «Pares»/«Par»→PAR, «Ascendente»/«Reportes»→ASCENDENTE, «Autoevaluación»/«Auto»→AUTO — matching normalizado por prefijo); suma año 1 ≠ 100 → error; igual a la config actual → `pesosModalidades: null`; años 2/3 → `referenciaEvaluadores`.

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/features/admin/maestro/plan.test.ts` — FAIL (módulo no existe).

- [ ] **Step 3: Implementar `planificarMaestro`**

Función pura. Estructura interna sugerida: (a) indexar BD por nombre normalizado; (b) fusionar duplicados de cada sección del parseado (aviso por fusión); (c) validar sección por sección acumulando `errores`/`avisos` con el formato «Hoja N: detalle» (imitar el tono de mensajes de `importador.ts`); (d) construir las listas de cambios comparando contra el snapshot; (e) derivar el nivel de cada fila del padrón desde hoja 4 (reemplaza `f.nivel`; contar los que diferían). El orden de dimensiones D1..D5 ↔ `dimensiones` ordenadas por `orden`.

- [ ] **Step 4: Correr tests + suite + tsc**

Run: `npx vitest run && npx tsc --noEmit` — todo verde/limpio.

- [ ] **Step 5: Commit**

```bash
git add src/features/admin/maestro/plan.ts src/features/admin/maestro/plan.test.ts
git commit -m "feat: planificador puro del importador maestro (validación cruzada + plan de cambios)"
```

---

### Task 3: Motor de padrón reutilizable + server action `importarMaestro`

**Files:**
- Modify: `src/features/admin/importador.ts` (extraer el núcleo de `importarPadron` a una función interna reutilizable)
- Create: `src/features/admin/maestro/acciones.ts` (server action)

**Interfaces:**
- Consumes: `parseMaestro` (T1), `planificarMaestro`/`SnapshotBD`/`PlanMaestro` (T2), el motor de padrón extraído.
- Produces (la consume Task 4):

```ts
// src/features/admin/maestro/acciones.ts
'use server'
export type ResultadoMaestro =
  | { ok: true; plan: PlanMaestro; aplicado: boolean }
  | { ok: false; error: string }
export async function importarMaestro(formData: FormData, aplicar: boolean): Promise<ResultadoMaestro>
```

- [ ] **Step 1: Extraer el motor de padrón**

En `importador.ts`, extraer de `importarPadron` una función interna exportada:

```ts
export async function procesarPadron(
  filas: FilaPadron[],
  opciones: { sesionId: string; aplicar: boolean; origen: 'CSV' | 'MAESTRO' },
): Promise<{ resumen: ResumenImportacion }>
```

— contiene TODO lo que hoy va desde «Catálogos existentes» hasta el final (validación, plan, aplicación por fases, AuditLog con `accion: opciones.origen === 'CSV' ? 'PADRON_IMPORTADO' : 'IMPORTACION_MAESTRA_PADRON'`). `importarPadron` queda como wrapper: guards + parseo CSV + mapeo a `FilaPadron[]` + `procesarPadron`. Exportar también el tipo `FilaPadron`. CERO cambios de comportamiento para el camino CSV (los avisos, candados de rotación y fases quedan idénticos).

- [ ] **Step 2: Verificar la extracción**

Run: `npx tsc --noEmit && npx vitest run` — limpio/verde (no hay tests directos del importador; la suite protege el resto). Verificación manual rápida en el dev: la página `/admin/colaboradores/importar` sigue cargando.

- [ ] **Step 3: La server action**

Crear `src/features/admin/maestro/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin } from '@/shared/lib/permisos'
import { parseMaestro } from './parser'
import { planificarMaestro, type PlanMaestro, type SnapshotBD } from './plan'
import { procesarPadron, type FilaPadron } from '../importador'

export type ResultadoMaestro =
  | { ok: true; plan: PlanMaestro; aplicado: boolean }
  | { ok: false; error: string }

export async function importarMaestro(formData: FormData, aplicar: boolean): Promise<ResultadoMaestro> {
  const sesion = await requiereAdmin('CONFIGURACION', 'GESTIONAR')
  if (sesion.alcanceRrhh !== 'REGIONAL') return { ok: false, error: 'Solo RR.HH. Regional puede ejecutar la carga maestra (cruza países)' }

  const archivo = formData.get('archivo')
  if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'Adjunta el Excel maestro (.xlsx)' }
  if (archivo.size > 10 * 1024 * 1024) return { ok: false, error: 'El archivo supera los 10 MB' }

  const parseado = parseMaestro(await archivo.arrayBuffer())
  const bd = await snapshotBD()
  const plan = planificarMaestro(parseado, bd)

  if (!aplicar) return { ok: true, plan, aplicado: false }
  if (plan.errores.length > 0) return { ok: true, plan, aplicado: false }
  if (plan.bloqueadoPorCiclo) return { ok: false, error: 'Hay un ciclo de evaluación ACTIVO: la carga maestra se aplica solo sin ciclos en curso' }

  await aplicarEstructura(plan, bd, sesion.id)
  const { resumen } = await procesarPadron(plan.padron.filas as FilaPadron[], { sesionId: sesion.id, aplicar: true, origen: 'MAESTRO' })
  const cuentas = await revincularCuentas()
  plan.avisos.push(...resumen.avisos, ...cuentas.avisos)

  await prisma.auditLog.create({
    data: {
      usuarioId: sesion.id, accion: 'IMPORTACION_MAESTRA',
      detalle: {
        archivo: archivo.name,
        niveles: plan.niveles.length, puestosNuevos: plan.puestosNuevos.length,
        rehomologados: plan.puestosRehomologados.length, competenciasCambian: plan.competenciasCambian.length,
        pesosPersonalizados: plan.pesosPersonalizados.length, padron: resumen.filas,
        cuentasRevinculadas: cuentas.revinculadas, cuentasSinMatch: cuentas.sinMatch,
      },
    },
  })
  revalidatePath('/admin/configuracion')
  revalidatePath('/admin/colaboradores')
  revalidatePath('/admin/puestos')
  return { ok: true, plan, aplicado: true }
}
```

`snapshotBD()`: consultas planas a `nivelJerarquico`, `dimension` (orderBy orden), `competencia`, `pais`, `puesto` (include pesos + competencias ids), `config['pesosModalidades']`, `ciclo.count({ where: { estado: 'ACTIVO' } }) > 0`.

`aplicarEstructura(plan, bd, usuarioId)` — transacción `prisma.$transaction` ORDENADA:
1. `nivelJerarquico.update` compPct por cada entrada de `plan.niveles`.
2. Puestos nuevos: `puesto.create` con nivel + pesos (personalizados si están en `pesosPersonalizados`, si no los del nivel) + competencias de hoja 5. Re-homologados: `puesto.update({ nivelId })`.
3. Competencias: por cada puesto en `competenciasCambian`, `puestoCompetencia.deleteMany({ puestoId })` + `createMany` del set nuevo.
4. Pesos: por cada puesto, upsert de `pesoDimensionPuesto` (los 5) CONSERVANDO `puntajeEsperado` (update solo `peso`; create con `puntajeEsperado` default 3).
5. `config.upsert('pesosModalidades')` si `plan.pesosModalidades` no es null.

`revincularCuentas()`: `usuario.findMany` (email + colaboradorId) × `colaborador.findMany` (email) → para cada usuario cuyo email (lower) coincide con un colaborador distinto al vinculado (o sin vincular): `usuario.update({ colaboradorId })`. Devuelve `{ revinculadas, sinMatch, avisos }` — sin match = aviso con el email, NUNCA desactivación.

Aviso adicional del spec (calcularlo en la action, antes del return del dry-run Y del aplicado): colaboradores ACTIVOS en BD cuyo `codigo` no viene en el padrón del archivo → `plan.avisos.push('N colaborador(es) activos en la plataforma no vienen en el archivo: no se dan de baja (las bajas son individuales desde Colaboradores)')` con los primeros 10 códigos. Post-purga es 0; protege recargas futuras.

- [ ] **Step 4: Verificación de tipos y suite**

Run: `npx tsc --noEmit && npx vitest run` — limpio/verde. La action se prueba E2E en Task 5 (no hay harness de tests con BD para actions, patrón del proyecto).

- [ ] **Step 5: Commit**

```bash
git add src/features/admin/importador.ts src/features/admin/maestro/acciones.ts
git commit -m "feat: server action importarMaestro — dry-run integral y aplicación transaccional ordenada"
```

---

### Task 4: UI — pestaña «Carga maestra» en Configuración

**Files:**
- Create: `src/features/admin/maestro/CargaMaestra.tsx`
- Modify: `src/app/(app)/admin/configuracion/page.tsx` (tab nuevo, gated por `ve('CONFIGURACION')`)

**Interfaces:**
- Consumes: `importarMaestro` + `ResultadoMaestro`/`PlanMaestro` (T3). Referencia de patrón: `src/features/admin/ImportadorPadron.tsx` (upload + dry-run + aplicar) y el sistema de tabs de `configuracion/page.tsx` (helper `ve()`, tab `roles` como ejemplo reciente).

- [ ] **Step 1: Componente `CargaMaestra`**

Client component con el flujo de dos fases (imitar la estructura de `ImportadorPadron.tsx`):
- Input de archivo `.xlsx` + botón «Analizar archivo» → `importarMaestro(fd, false)` → render del plan.
- Render del plan por secciones (Cards apiladas): Niveles (tabla antes→después de compPct), Puestos (conteos + listas expandibles de nuevos y re-homologados con nivel antes→después), Competencias (conteo + primeros 20), Pesos (conteo de derivados + tabla de personalizaciones completa), Config evaluadores (antes→después + años 2027/2028 como referencia gris), Padrón (nuevos/actualizados/niveles ignorados + los avisos del motor).
- Bloques de **errores** (rojo, impiden aplicar) y **avisos** (ámbar) con el estilo del importador de padrón.
- Si `plan.bloqueadoPorCiclo`: banner rojo «Hay un ciclo activo: puedes revisar el análisis pero no aplicar» y botón deshabilitado.
- Botón «Aplicar carga» (habilitado solo sin errores ni bloqueo) → `confirmar(...)` de `@/shared/ui/Confirmacion` con el conteo total → `importarMaestro(fd, true)` → toast + render del plan aplicado con badge «Aplicado ✓».
- `puedeGestionar=false` (rol VER): todo visible pero sin input ni botones, banner estándar de solo lectura.

- [ ] **Step 2: Tab en Configuración**

En `configuracion/page.tsx`: agregar `{ id: 'maestra', etiqueta: 'Carga maestra' }` al arreglo de tabs visible con `ve('CONFIGURACION')`, y el render `tab === 'maestra' && <CargaMaestra puedeGestionar={sesion.rol === 'RRHH' && sesion.alcanceRrhh === 'REGIONAL'} />`. Seguir el patrón exacto del tab `roles`.

- [ ] **Step 3: Validación visual en el clone**

Dev en :3001, sesión de Christian (Regional): subir el archivo real (desde Downloads) → dry-run muestra las secciones con los números conocidos (33 re-homologados, 47 niveles ignorados, 5 duplicados fusionados, 0 personalizaciones de pesos). NO aplicar todavía (eso es Task 5). Verificar además el estado sin archivo, un archivo no-xlsx (error limpio) y el tab en modo VER (banner solo lectura).

- [ ] **Step 4: Tipos + suite + commit**

Run: `npx tsc --noEmit && npx vitest run` — limpio/verde.

```bash
git add src/features/admin/maestro/CargaMaestra.tsx "src/app/(app)/admin/configuracion/page.tsx"
git commit -m "feat: pestaña Carga maestra en Configuración — dry-run por secciones y aplicación"
```

---

### Task 5: Script de purga + E2E integral en el clone (ensayo completo de la carga inicial)

**Files:**
- Create: `prisma/purga-carga-inicial.ts` (COMMITTEADO: el runbook de prod lo necesita; con doble seguro)
- Test: E2E manual documentado (sin archivos nuevos de test)

**Interfaces:**
- Consumes: todo lo anterior + el archivo real de Hunter.

- [ ] **Step 1: Script de purga con doble seguro**

Crear `prisma/purga-carga-inicial.ts` (import del cliente Prisma como en `prisma/seed-roles-admin.ts`):

```ts
// Purga para la carga inicial: borra DATOS DE PERSONAS Y PROCESO, conserva estructura y cuentas.
// Doble seguro: exige CONFIRMAR_PURGA=SI y muestra la BD objetivo antes de tocar nada.
// Uso: DATABASE_URL=... CONFIRMAR_PURGA=SI npx tsx prisma/purga-carga-inicial.ts
if (process.env.CONFIRMAR_PURGA !== 'SI') {
  console.log('Seguro activado: define CONFIRMAR_PURGA=SI para ejecutar. BD objetivo:', process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] ?? '(desconocida)')
  process.exit(1)
}
// Orden respetando FKs (lo que no cascadea desde Colaborador/Ciclo/Periodo se borra explícito):
// 1. ciclo.deleteMany() — cascade: asignaciones, snapshot de preguntas, cierres por país, resultados, feedbacks
// 2. periodoObjetivos.deleteMany() — cascade/explícito: objetivos (verificar en schema si Objetivo cascadea del período; si no, objetivo.deleteMany() antes)
// 3. usuario.updateMany({ data: { colaboradorId: null } }) — desvincular ANTES de borrar colaboradores
// 4. colaborador.deleteMany()
// CONSERVA: Usuario, RolAdmin, Evaluacion + banco de preguntas, Dimension, Competencia,
// NivelJerarquico, Pais, Area, Puesto (+pesos/competencias), Config, AuditLog.
// Imprime conteos antes/después de cada tabla tocada.
```

El implementador debe VERIFICAR en `prisma/schema.prisma` las relaciones reales (`onDelete`) y ajustar el orden si algo no cascadea — imprimir conteos de verificación es parte del contrato. `Usuario.colaboradorId` puede requerir ser nullable: verificar en el schema; si no lo es, ese cambio de schema (aditivo: `String?`) entra en esta task con `db push` al clone + cliente regenerado commiteado.

- [ ] **Step 2: E2E integral en el clone (el ensayo del runbook, en este orden)**

1. Copiar el archivo real a `$CLAUDE_JOB_DIR/tmp/` (`/Users/christianisrael/.claude/jobs/b3aa4572/tmp/`) — NO al repo (PII).
2. Conteos previos del clone (script efímero en tmp): colaboradores, usuarios, ciclos, puestos.
3. **Purga contra el clone**: `CONFIRMAR_PURGA=SI npx tsx prisma/purga-carga-inicial.ts` → verificar conteos: colaboradores 0, ciclos 0, usuarios INTACTOS (con `colaboradorId` null), puestos/preguntas/config intactos.
4. **Login post-purga**: entrar como `ccalmet@webtilia.com` (2FA del log del dev) → la sesión debe funcionar (verificar que el jwt callback y el Shell toleran cuenta sin colaborador; si algo revienta, ese fix entra en esta task con su propio mini-diff reportado).
5. **Carga por la UI**: Configuración → Carga maestra → archivo real → dry-run (verificar los números conocidos: 806 filas, 33 re-homologados, 47 niveles ignorados, 5 duplicados, 0 personalizaciones) → Aplicar.
6. Verificaciones post-carga (script efímero): 806 colaboradores; 327+ puestos; pesos de 2 puestos re-homologados = los de su nivel NUEVO (p. ej. «Analista De Inteligencia Comercial» = [30,25,20,10,15] Especialista); `nivelJerarquico.compPct` = 60/60/60/50; cuentas del equipo re-vinculadas (usuario de Jazmin apunta a su colaborador nuevo); login de Jazmin funciona y ve su hoja de vida.
7. **Idempotencia**: re-subir el mismo archivo → dry-run con 0 cambios en todas las secciones.
8. Documentar TODOS los resultados en el reporte con números exactos.

- [ ] **Step 3: Suite + commit**

Run: `npx tsc --noEmit && npx vitest run` — limpio/verde.

```bash
git add prisma/purga-carga-inicial.ts
git commit -m "feat: script de purga para la carga inicial (doble seguro, conserva cuentas y estructura)"
```

(Si el paso 4 del E2E exigió fixes de tolerancia a cuenta-sin-colaborador, se commitean aparte con mensaje `fix: el login y el Shell toleran cuentas sin colaborador vinculado`.)

---

## Runbook de producción (manual — NO se ejecuta en este plan; requiere GO explícito de Christian)

1. Deploy del código (sin orden crítico: nada de esto corre solo).
2. Backup: `pg_dump` completo de Neon a archivo local.
3. Purga: `DATABASE_URL=<prod> CONFIRMAR_PURGA=SI npx tsx prisma/purga-carga-inicial.ts`.
4. Christian: Configuración → Carga maestra → archivo real → dry-run → Aplicar.
5. Smoke: conteos (806/327), login re-vinculado, pesos de un re-homologado.
6. Pruebas con grupos reducidos vía alcance flexible.
