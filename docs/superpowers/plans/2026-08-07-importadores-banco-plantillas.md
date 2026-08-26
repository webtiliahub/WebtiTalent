# Importador del banco de preguntas + plantillas + padrón en Excel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importador masivo del banco de preguntas (Excel 2 hojas, con dry-run), botón de descarga de plantilla `.xlsx` en los tres importadores, y padrón que además acepte `.xlsx`.

**Architecture:** Un helper de escritura de Excel (`descargarXlsx`, primer uso de escritura del proyecto) y un sugeridor de valores puro (`sugerir`) sirven a todo. El importador del banco replica el patrón del importador maestro: parser puro → planificador puro → acción `'use server'` con dry-run → componente cliente → página dedicada. El padrón gana una rama de lectura `.xlsx` reusando su motor `procesarPadron` intacto.

**Tech Stack:** Next.js 16 App Router (server components + server actions + FormData), Prisma 7 (cliente generado COMMITEADO en `src/generated/prisma`; este feature NO toca el schema), SheetJS/xlsx 0.20.3 (CDN, `import * as XLSX from 'xlsx'`), Tailwind 4, Vitest, Zod.

## Global Constraints

- **SIN dependencias nuevas**: SheetJS 0.20.3 (ya instalado) para leer y ahora escribir; NO agregar ExcelJS (verificado que SheetJS Community no escribe dropdowns; se cubre con validador + hoja Catálogos).
- **Sin cambios de schema Prisma.** `Pregunta` = `{ texto, competenciaId, modalidades: TipoEvaluacion[], activa }`; `PreguntaPotencial` = `{ texto, orden, activa }`. Enum `TipoEvaluacion = JEFE | PAR | ASCENDENTE | AUTO`.
- **Identidad de pregunta**: competencia + texto normalizado (sin tildes, minúsculas, espacios colapsados). Duplicado → aviso, se salta; el importador SOLO da de alta (no edita).
- **Normalización** unificada: reusar `normalizar` de `src/features/admin/maestro/parser.ts` (sin tildes/minúsculas). Para colapsar espacios, envolver: `normalizar(s).replace(/\s+/g, ' ').trim()`.
- **Modalidades en Excel**: 4 columnas JEFE · PAR · ASC · AUTO; celda no vacía = marcada. «ASC» mapea a `ASCENDENTE`.
- **Anti-inyección de fórmulas** en toda celda de texto generada (prefijo `'` si empieza con `= + - @ \t \r`), criterio de `celdaSegura` en `src/shared/ui/csv.ts`.
- **Patrón dry-run**: `(formData, aplicar)`; `aplicar=false` simula sin escribir; el componente hace SIMULAR → revisar → APLICAR con modal de confirmación.
- **Guards**: banco de preguntas → `requiereAdmin('EVALUACIONES', 'GESTIONAR')`; padrón → `requiereAdmin('COLABORADORES', 'GESTIONAR')` (ya existente).
- **Límite 10 MB** por archivo (igual que carga maestra).
- **Español neutro**, sin voseo; **sin emojis como iconos** (usar `lucide-react`).
- Suite `npx vitest run` verde en cada commit; `npx tsc --noEmit` limpio.
- **Commits locales, SIN `git push`** (Christian pide el push explícitamente); nunca `git add -A` (añadir por nombre). Scripts de verificación efímeros no se trackean y se borran.
- Dev en `localhost:3001` contra el clone local; solo operaciones locales.

## File Structure

| Archivo | Rol |
|---|---|
| `src/shared/lib/sugerir.ts` (crear) | `sugerir(valor, opciones)` puro — «¿quisiste decir X?» por distancia de edición |
| `src/shared/lib/sugerir.test.ts` (crear) | tests del sugeridor |
| `src/shared/ui/xlsx-descarga.ts` (crear) | `construirLibroXlsx` (puro) + `descargarXlsx` (cliente, DOM) |
| `src/shared/ui/xlsx-descarga.test.ts` (crear) | test de `construirLibroXlsx` (round-trip) |
| `src/features/admin/preguntas-import/parser.ts` (crear) | `parseBancoPreguntas(buffer)` puro |
| `src/features/admin/preguntas-import/parser.test.ts` (crear) | tests del parser |
| `src/features/admin/preguntas-import/plan.ts` (crear) | `planificarBanco(parseado, bd)` puro |
| `src/features/admin/preguntas-import/plan.test.ts` (crear) | tests del planificador |
| `src/features/admin/preguntas-import/plantilla.ts` (crear) | `hojasPlantillaBanco(catalogos)` puro — arma las hojas del `.xlsx` de plantilla |
| `src/features/admin/preguntas-import/acciones.ts` (crear) | `importarBancoPreguntas(formData, aplicar)` server action |
| `src/features/admin/preguntas-import/ImportadorBancoPreguntas.tsx` (crear) | componente cliente |
| `src/app/(app)/admin/preguntas/importar/page.tsx` (crear) | página dedicada |
| `src/features/admin/FormPregunta.tsx` (modificar) | botón «Importar preguntas» → la ruta |
| `src/features/admin/importador.ts` (modificar) | `importarPadron` ramifica `.xlsx`/`.csv` |
| `src/features/admin/ImportadorPadron.tsx` (modificar) | `accept` + botón plantilla |
| `src/app/(app)/admin/colaboradores/importar/page.tsx` (modificar) | cargar catálogos + pasar a plantilla + copy |
| `src/features/admin/maestro/CargaMaestra.tsx` (modificar) | botón plantilla |
| `src/app/(app)/admin/configuracion/page.tsx` (modificar) | pasar catálogos a CargaMaestra para la plantilla |

---

### Task 1: Sugeridor de valores (`sugerir`)

**Files:**
- Create: `src/shared/lib/sugerir.ts`
- Test: `src/shared/lib/sugerir.test.ts`

**Interfaces:**
- Produces: `sugerir(valor: string, opciones: string[]): string | null` — la opción más parecida (por distancia de Levenshtein sobre texto normalizado) si está bajo el umbral, o `null`.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/shared/lib/sugerir.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sugerir } from './sugerir'

describe('sugerir', () => {
  const dims = ['Analítica', 'Know-How / Expertise', 'Operativa / Ejecución', 'Liderazgo e Interpersonal', 'Digital e Innovación']
  it('devuelve la opción por diferencia de tilde', () => expect(sugerir('Analitica', dims)).toBe('Analítica'))
  it('devuelve la opción por un typo cercano', () => expect(sugerir('Operativa / Ejecucion', dims)).toBe('Operativa / Ejecución'))
  it('null cuando nada se parece', () => expect(sugerir('Ventas', dims)).toBeNull())
  it('match exacto se devuelve a sí mismo', () => expect(sugerir('Analítica', dims)).toBe('Analítica'))
  it('lista vacía → null', () => expect(sugerir('Analítica', [])).toBeNull())
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/shared/lib/sugerir.test.ts`
Expected: FAIL — `Cannot find module './sugerir'`.

- [ ] **Step 3: Implementar `src/shared/lib/sugerir.ts`**

```ts
/** Sugeridor «¿quisiste decir X?» para valores de sistema mal escritos en los importadores.
 * Compara sobre texto normalizado (sin tildes/minúsculas) por distancia de edición. */

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function distancia(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const fila = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    let prev = fila[0]
    fila[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = fila[j]
      fila[j] = Math.min(
        fila[j] + 1,
        fila[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      prev = tmp
    }
  }
  return fila[n]
}

export function sugerir(valor: string, opciones: string[]): string | null {
  const v = norm(valor)
  if (!v || opciones.length === 0) return null
  let mejor: string | null = null
  let mejorD = Infinity
  for (const op of opciones) {
    const d = distancia(v, norm(op))
    if (d < mejorD) { mejorD = d; mejor = op }
  }
  // Umbral: hasta ~30% de la longitud de la opción (mínimo 2) — tolera tildes y typos, no palabras distintas
  if (mejor !== null && mejorD <= Math.max(2, Math.floor(norm(mejor).length * 0.3))) return mejor
  return null
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/shared/lib/sugerir.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/lib/sugerir.ts src/shared/lib/sugerir.test.ts
git commit -m "feat(importadores): sugeridor de valores «¿quisiste decir X?»

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Helper de escritura Excel (`descargarXlsx`)

**Files:**
- Create: `src/shared/ui/xlsx-descarga.ts`
- Test: `src/shared/ui/xlsx-descarga.test.ts`

**Interfaces:**
- Consumes: `celdaSegura` de `src/shared/ui/csv.ts` (existente).
- Produces:
  - `type HojaXlsx = { nombre: string; filas: (string | number)[][] }`
  - `construirLibroXlsx(hojas: HojaXlsx[]): ArrayBuffer` — puro (sin DOM), testeable.
  - `descargarXlsx(nombreArchivo: string, hojas: HojaXlsx[]): void` — cliente; construye y dispara la descarga.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/shared/ui/xlsx-descarga.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { construirLibroXlsx } from './xlsx-descarga'

describe('construirLibroXlsx', () => {
  it('produce un xlsx legible con las hojas y celdas dadas', () => {
    const buf = construirLibroXlsx([
      { nombre: 'Competencias', filas: [['Dimensión', 'Competencia', 'Texto'], ['Analítica', 'Análisis de datos y KPIs', '¿Usa datos para decidir?']] },
      { nombre: 'Potencial', filas: [['Orden', 'Texto'], [1, '¿Tiene proyección?']] },
    ])
    const wb = XLSX.read(buf)
    expect(wb.SheetNames).toEqual(['Competencias', 'Potencial'])
    const c = XLSX.utils.sheet_to_json(wb.Sheets['Competencias'], { header: 1 })
    expect(c[0]).toEqual(['Dimensión', 'Competencia', 'Texto'])
    expect((c[1] as string[])[1]).toBe('Análisis de datos y KPIs')
  })
  it('neutraliza celdas que empiezan con = (anti-inyección)', () => {
    const buf = construirLibroXlsx([{ nombre: 'H', filas: [['=CMD()']] }])
    const wb = XLSX.read(buf)
    const v = (XLSX.utils.sheet_to_json(wb.Sheets['H'], { header: 1 })[0] as string[])[0]
    expect(v.startsWith("'") || v.startsWith('=') === false).toBe(true)
    expect(v).toBe("'=CMD()")
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/shared/ui/xlsx-descarga.test.ts`
Expected: FAIL — `Cannot find module './xlsx-descarga'`.

- [ ] **Step 3: Implementar `src/shared/ui/xlsx-descarga.ts`**

```ts
'use client'

import * as XLSX from 'xlsx'
import { celdaSegura } from './csv'

/** Escritura de Excel para plantillas descargables (primer uso de escritura del proyecto;
 * el resto de xlsx es solo lectura en maestro/parser.ts). Sanitiza texto contra inyección
 * de fórmulas. SheetJS Community no escribe listas desplegables — por eso las plantillas
 * llevan una hoja «Catálogos» y el validador del importador es la red real. */

export type HojaXlsx = { nombre: string; filas: (string | number)[][] }

function saneaFila(fila: (string | number)[]): (string | number)[] {
  return fila.map((v) => (typeof v === 'number' ? v : celdaSegura(String(v ?? ''))))
}

/** Puro (sin DOM): arma el workbook y lo serializa a ArrayBuffer. */
export function construirLibroXlsx(hojas: HojaXlsx[]): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const h of hojas) {
    const ws = XLSX.utils.aoa_to_sheet(h.filas.map(saneaFila))
    // Nombre de hoja: Excel limita a 31 chars y prohíbe : \ / ? * [ ]
    const nombre = h.nombre.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31)
    XLSX.utils.book_append_sheet(wb, ws, nombre)
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/** Cliente: construye el .xlsx y dispara la descarga (mismo mecanismo que descargarCsv). */
export function descargarXlsx(nombreArchivo: string, hojas: HojaXlsx[]): void {
  const buf = construirLibroXlsx(hojas)
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo.endsWith('.xlsx') ? nombreArchivo : `${nombreArchivo}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/shared/ui/xlsx-descarga.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/ui/xlsx-descarga.ts src/shared/ui/xlsx-descarga.test.ts
git commit -m "feat(importadores): helper descargarXlsx (escritura de Excel para plantillas)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Parser del banco de preguntas

**Files:**
- Create: `src/features/admin/preguntas-import/parser.ts`
- Test: `src/features/admin/preguntas-import/parser.test.ts`

**Interfaces:**
- Consumes: `normalizar` de `src/features/admin/maestro/parser.ts`; `TipoEvaluacion` de `@/generated/prisma` (o el enum re-exportado; usar el mismo import que `acciones.ts` usa para `Modalidad`).
- Produces:
  ```ts
  export type FilaCompetencia = { linea: number; dimension: string; competencia: string; texto: string; modalidades: TipoEvaluacion[] }
  export type FilaPotencial = { linea: number; orden: number | null; texto: string }
  export type BancoParseado = { competencias: FilaCompetencia[]; potencial: FilaPotencial[]; errores: string[] }
  export function parseBancoPreguntas(buffer: ArrayBuffer): BancoParseado
  ```

- [ ] **Step 1: Escribir el test que falla**

Crear `src/features/admin/preguntas-import/parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseBancoPreguntas } from './parser'

function libro(competencias: unknown[][], potencial: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(competencias), 'Competencias')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(potencial), 'Potencial')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

const HEAD_COMP = ['Dimensión', 'Competencia', 'Texto', 'JEFE', 'PAR', 'ASC', 'AUTO']
const HEAD_POT = ['Orden', 'Texto']

describe('parseBancoPreguntas', () => {
  it('lee competencias con modalidades marcadas por columna', () => {
    const r = parseBancoPreguntas(libro(
      [HEAD_COMP, ['Analítica', 'Análisis de datos y KPIs', '¿Usa datos?', 'X', '', 'X', 'X']],
      [HEAD_POT],
    ))
    expect(r.errores).toEqual([])
    expect(r.competencias).toHaveLength(1)
    expect(r.competencias[0]).toMatchObject({ dimension: 'Analítica', competencia: 'Análisis de datos y KPIs', texto: '¿Usa datos?', modalidades: ['JEFE', 'ASCENDENTE', 'AUTO'] })
  })
  it('lee potencial con orden numérico y texto', () => {
    const r = parseBancoPreguntas(libro([HEAD_COMP], [HEAD_POT, [1, '¿Tiene proyección?'], ['', '¿Aprende rápido?']]))
    expect(r.potencial).toEqual([
      { linea: 2, orden: 1, texto: '¿Tiene proyección?' },
      { linea: 3, orden: null, texto: '¿Aprende rápido?' },
    ])
  })
  it('ignora filas totalmente vacías', () => {
    const r = parseBancoPreguntas(libro([HEAD_COMP, ['', '', '', '', '', '', ''], ['Analítica', 'X', 'Y', 'X', '', '', '']], [HEAD_POT]))
    expect(r.competencias).toHaveLength(1)
  })
  it('error si falta una hoja', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEAD_COMP]), 'Competencias')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const r = parseBancoPreguntas(buf)
    expect(r.errores.some((e) => e.toLowerCase().includes('potencial'))).toBe(true)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/features/admin/preguntas-import/parser.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/features/admin/preguntas-import/parser.ts`**

```ts
import * as XLSX from 'xlsx'
import { normalizar } from '../maestro/parser'
import type { TipoEvaluacion } from '@/generated/prisma'

/** Parser puro del Excel del banco de preguntas: hoja «Competencias» (Dimensión · Competencia ·
 * Texto · JEFE · PAR · ASC · AUTO con X) y hoja «Potencial» (Orden · Texto). */

export type FilaCompetencia = { linea: number; dimension: string; competencia: string; texto: string; modalidades: TipoEvaluacion[] }
export type FilaPotencial = { linea: number; orden: number | null; texto: string }
export type BancoParseado = { competencias: FilaCompetencia[]; potencial: FilaPotencial[]; errores: string[] }

// ASC (columna) → ASCENDENTE (enum). Orden de columnas de modalidad tras Dimensión/Competencia/Texto.
const COLS_MODALIDAD: TipoEvaluacion[] = ['JEFE', 'PAR', 'ASCENDENTE', 'AUTO']

const txt = (v: unknown) => String(v ?? '').trim()

function hojaPorClave(wb: XLSX.WorkBook, clave: string): unknown[][] | null {
  const nombre = wb.SheetNames.find((n) => normalizar(n).includes(clave))
  if (!nombre) return null
  return XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, defval: '' }) as unknown[][]
}

export function parseBancoPreguntas(buffer: ArrayBuffer): BancoParseado {
  const errores: string[] = []
  const wb = XLSX.read(buffer)
  const competencias: FilaCompetencia[] = []
  const potencial: FilaPotencial[] = []

  const hComp = hojaPorClave(wb, 'competencia')
  if (!hComp) errores.push('Falta la hoja «Competencias».')
  else {
    for (let i = 1; i < hComp.length; i++) {
      const f = hComp[i] ?? []
      const dimension = txt(f[0]), competencia = txt(f[1]), texto = txt(f[2])
      if (!dimension && !competencia && !texto) continue // fila vacía
      const modalidades = COLS_MODALIDAD.filter((_, k) => txt(f[3 + k]) !== '')
      competencias.push({ linea: i + 1, dimension, competencia, texto, modalidades })
    }
  }

  const hPot = hojaPorClave(wb, 'potencial')
  if (!hPot) errores.push('Falta la hoja «Potencial».')
  else {
    for (let i = 1; i < hPot.length; i++) {
      const f = hPot[i] ?? []
      const ordenRaw = txt(f[0]), texto = txt(f[1])
      if (!ordenRaw && !texto) continue
      const orden = ordenRaw && !Number.isNaN(Number(ordenRaw)) ? Number(ordenRaw) : null
      potencial.push({ linea: i + 1, orden, texto })
    }
  }

  return { competencias, potencial, errores }
}
```

Nota de implementación: si `@/generated/prisma` no exporta `TipoEvaluacion` como type, importar igual que `acciones.ts` importa `Modalidad` (revisar su línea de import y replicarla). El valor de enum se usa solo como string en runtime.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/features/admin/preguntas-import/parser.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/admin/preguntas-import/parser.ts src/features/admin/preguntas-import/parser.test.ts
git commit -m "feat(banco-import): parser del Excel del banco de preguntas

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Planificador del banco de preguntas

**Files:**
- Create: `src/features/admin/preguntas-import/plan.ts`
- Test: `src/features/admin/preguntas-import/plan.test.ts`

**Interfaces:**
- Consumes: `BancoParseado`, `FilaCompetencia`, `FilaPotencial` (Task 3); `sugerir` (Task 1); `normalizar` de `maestro/parser.ts`; `TipoEvaluacion`.
- Produces:
  ```ts
  export type SnapshotBanco = {
    dimensiones: { nombre: string }[]
    competencias: { nombre: string; dimensionNombre: string }[]
    preguntasExistentes: { competenciaNombre: string; textoNorm: string }[]
    potencialExistentes: { textoNorm: string }[]
  }
  export type PlanBanco = {
    errores: string[]
    avisos: string[]
    competenciasNuevas: { competencia: string; texto: string; modalidades: TipoEvaluacion[] }[]
    potencialNuevas: { texto: string }[]
  }
  export function planificarBanco(parseado: BancoParseado, bd: SnapshotBanco): PlanBanco
  ```

- [ ] **Step 1: Escribir el test que falla**

Crear `src/features/admin/preguntas-import/plan.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { planificarBanco } from './plan'
import type { SnapshotBanco } from './plan'
import type { BancoParseado } from './parser'

const bd: SnapshotBanco = {
  dimensiones: [{ nombre: 'Analítica' }, { nombre: 'Liderazgo e Interpersonal' }],
  competencias: [
    { nombre: 'Análisis de datos y KPIs', dimensionNombre: 'Analítica' },
    { nombre: 'Comunicación efectiva', dimensionNombre: 'Liderazgo e Interpersonal' },
  ],
  preguntasExistentes: [{ competenciaNombre: 'Análisis de datos y KPIs', textoNorm: 'usa datos para decidir' }],
  potencialExistentes: [{ textoNorm: 'tiene proyeccion' }],
}
const vacio = { competencias: [], potencial: [], errores: [] as string[] }

describe('planificarBanco', () => {
  it('acepta una competencia nueva válida', () => {
    const p: BancoParseado = { ...vacio, competencias: [{ linea: 2, dimension: 'Analítica', competencia: 'Análisis de datos y KPIs', texto: 'Nueva pregunta clara', modalidades: ['JEFE', 'AUTO'] }] }
    const r = planificarBanco(p, bd)
    expect(r.errores).toEqual([])
    expect(r.competenciasNuevas).toEqual([{ competencia: 'Análisis de datos y KPIs', texto: 'Nueva pregunta clara', modalidades: ['JEFE', 'AUTO'] }])
  })
  it('duplicado exacto → aviso, no error, no se crea', () => {
    const p: BancoParseado = { ...vacio, competencias: [{ linea: 2, dimension: 'Analítica', competencia: 'Análisis de datos y KPIs', texto: '¿Usa datos para decidir?', modalidades: ['JEFE'] }] }
    const r = planificarBanco(p, bd)
    expect(r.competenciasNuevas).toHaveLength(0)
    expect(r.avisos.some((a) => a.toLowerCase().includes('ya existe'))).toBe(true)
  })
  it('competencia inexistente → error con sugerencia', () => {
    const p: BancoParseado = { ...vacio, competencias: [{ linea: 2, dimension: 'Analítica', competencia: 'Analisis de datos y KPI', texto: 'Pregunta clara', modalidades: ['JEFE'] }] }
    const r = planificarBanco(p, bd)
    expect(r.errores.some((e) => e.includes('¿quisiste decir') && e.includes('Análisis de datos y KPIs'))).toBe(true)
    expect(r.competenciasNuevas).toHaveLength(0)
  })
  it('competencia en dimensión equivocada → error', () => {
    const p: BancoParseado = { ...vacio, competencias: [{ linea: 2, dimension: 'Analítica', competencia: 'Comunicación efectiva', texto: 'Pregunta clara', modalidades: ['JEFE'] }] }
    const r = planificarBanco(p, bd)
    expect(r.errores.some((e) => e.toLowerCase().includes('dimensión'))).toBe(true)
  })
  it('sin modalidad → error', () => {
    const p: BancoParseado = { ...vacio, competencias: [{ linea: 2, dimension: 'Analítica', competencia: 'Análisis de datos y KPIs', texto: 'Pregunta clara', modalidades: [] }] }
    const r = planificarBanco(p, bd)
    expect(r.errores.some((e) => e.toLowerCase().includes('modalidad'))).toBe(true)
  })
  it('potencial nueva y duplicada', () => {
    const p: BancoParseado = { ...vacio, potencial: [
      { linea: 2, orden: null, texto: 'Aprende rápido' },
      { linea: 3, orden: 1, texto: '¿Tiene proyección?' },
    ] }
    const r = planificarBanco(p, bd)
    expect(r.potencialNuevas).toEqual([{ texto: 'Aprende rápido' }])
    expect(r.avisos.some((a) => a.toLowerCase().includes('ya existe'))).toBe(true)
  })
  it('propaga errores de estructura del parser', () => {
    const r = planificarBanco({ ...vacio, errores: ['Falta la hoja «Potencial».'] }, bd)
    expect(r.errores).toContain('Falta la hoja «Potencial».')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/features/admin/preguntas-import/plan.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/features/admin/preguntas-import/plan.ts`**

```ts
import { normalizar } from '../maestro/parser'
import { sugerir } from '@/shared/lib/sugerir'
import type { BancoParseado } from './parser'
import type { TipoEvaluacion } from '@/generated/prisma'

/** Planificador puro: cruza lo parseado contra un snapshot del banco/catálogos y decide
 * qué se crea, qué se salta (duplicado) y qué bloquea (error, con sugerencia). Solo altas. */

export type SnapshotBanco = {
  dimensiones: { nombre: string }[]
  competencias: { nombre: string; dimensionNombre: string }[]
  preguntasExistentes: { competenciaNombre: string; textoNorm: string }[]
  potencialExistentes: { textoNorm: string }[]
}
export type PlanBanco = {
  errores: string[]
  avisos: string[]
  competenciasNuevas: { competencia: string; texto: string; modalidades: TipoEvaluacion[] }[]
  potencialNuevas: { texto: string }[]
}

const normTexto = (s: string) => normalizar(s).replace(/\s+/g, ' ').trim()

export function planificarBanco(parseado: BancoParseado, bd: SnapshotBanco): PlanBanco {
  const errores = [...parseado.errores]
  const avisos: string[] = []
  const competenciasNuevas: PlanBanco['competenciasNuevas'] = []
  const potencialNuevas: PlanBanco['potencialNuevas'] = []

  const dimNombres = bd.dimensiones.map((d) => d.nombre)
  const compNombres = bd.competencias.map((c) => c.nombre)
  const dimDeComp = new Map(bd.competencias.map((c) => [normalizar(c.nombre), c.dimensionNombre]))
  const compCanon = new Map(bd.competencias.map((c) => [normalizar(c.nombre), c.nombre]))
  const dimCanon = new Map(bd.dimensiones.map((d) => [normalizar(d.nombre), d.nombre]))
  const yaPregunta = new Set(bd.preguntasExistentes.map((p) => `${normalizar(p.competenciaNombre)}||${p.textoNorm}`))
  const yaPotencial = new Set(bd.potencialExistentes.map((p) => p.textoNorm))
  // Duplicados dentro del mismo archivo también se saltan
  const vistasComp = new Set<string>()
  const vistasPot = new Set<string>()

  for (const f of parseado.competencias) {
    const ref = `Hoja Competencias, fila ${f.linea}`
    if (!f.texto) { errores.push(`${ref}: falta el texto de la pregunta.`); continue }
    if (!dimCanon.has(normalizar(f.dimension))) {
      const s = sugerir(f.dimension, dimNombres)
      errores.push(`${ref}: la dimensión "${f.dimension}" no existe${s ? ` — ¿quisiste decir "${s}"?` : ''}.`)
      continue
    }
    if (!compCanon.has(normalizar(f.competencia))) {
      const s = sugerir(f.competencia, compNombres)
      errores.push(`${ref}: la competencia "${f.competencia}" no existe${s ? ` — ¿quisiste decir "${s}"?` : ''}.`)
      continue
    }
    const dimEsperada = dimDeComp.get(normalizar(f.competencia))!
    if (normalizar(dimEsperada) !== normalizar(f.dimension)) {
      errores.push(`${ref}: la competencia "${compCanon.get(normalizar(f.competencia))}" pertenece a la dimensión "${dimEsperada}", no a "${f.dimension}".`)
      continue
    }
    if (f.modalidades.length === 0) { errores.push(`${ref}: marca al menos una modalidad (JEFE/PAR/ASC/AUTO).`); continue }
    const compReal = compCanon.get(normalizar(f.competencia))!
    const clave = `${normalizar(compReal)}||${normTexto(f.texto)}`
    if (yaPregunta.has(clave) || vistasComp.has(clave)) {
      avisos.push(`${ref}: la pregunta ya existe para "${compReal}" — se salta.`)
      continue
    }
    vistasComp.add(clave)
    competenciasNuevas.push({ competencia: compReal, texto: f.texto, modalidades: f.modalidades })
  }

  for (const f of parseado.potencial) {
    const ref = `Hoja Potencial, fila ${f.linea}`
    if (!f.texto) { errores.push(`${ref}: falta el texto de la pregunta.`); continue }
    const clave = normTexto(f.texto)
    if (yaPotencial.has(clave) || vistasPot.has(clave)) {
      avisos.push(`${ref}: la pregunta de potencial ya existe — se salta.`)
      continue
    }
    vistasPot.add(clave)
    potencialNuevas.push({ texto: f.texto })
  }

  return { errores, avisos, competenciasNuevas, potencialNuevas }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/features/admin/preguntas-import/plan.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/admin/preguntas-import/plan.ts src/features/admin/preguntas-import/plan.test.ts
git commit -m "feat(banco-import): planificador con validación y sugerencias

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Plantilla del banco + acción + componente + página + botón de entrada

**Files:**
- Create: `src/features/admin/preguntas-import/plantilla.ts`
- Create: `src/features/admin/preguntas-import/acciones.ts`
- Create: `src/features/admin/preguntas-import/ImportadorBancoPreguntas.tsx`
- Create: `src/app/(app)/admin/preguntas/importar/page.tsx`
- Modify: `src/features/admin/FormPregunta.tsx`

**Interfaces:**
- Consumes: `parseBancoPreguntas` (T3), `planificarBanco` + `SnapshotBanco` (T4), `HojaXlsx`/`descargarXlsx` (T2), `requiereAdmin` de `@/shared/lib/permisos`, `prisma`.
- Produces:
  - `hojasPlantillaBanco(catalogos: { dimensiones: { nombre: string; competencias: { nombre: string }[] }[] }): HojaXlsx[]`
  - `importarBancoPreguntas(formData: FormData, aplicar: boolean): Promise<ResultadoBanco>` con
    `type ResultadoBanco = { ok: true; plan: PlanBanco; aplicado: boolean } | { ok: false; error: string }`

- [ ] **Step 1: Escribir el test que falla (plantilla, puro)**

Crear `src/features/admin/preguntas-import/plantilla.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { hojasPlantillaBanco } from './plantilla'

describe('hojasPlantillaBanco', () => {
  const cat = { dimensiones: [{ nombre: 'Analítica', competencias: [{ nombre: 'Análisis de datos y KPIs' }] }] }
  it('incluye hojas Competencias, Potencial y Catálogos', () => {
    const h = hojasPlantillaBanco(cat)
    expect(h.map((x) => x.nombre)).toEqual(['Competencias', 'Potencial', 'Catálogos'])
  })
  it('la hoja Competencias trae el encabezado con las 4 modalidades', () => {
    const comp = hojasPlantillaBanco(cat).find((x) => x.nombre === 'Competencias')!
    expect(comp.filas[0]).toEqual(['Dimensión', 'Competencia', 'Texto', 'JEFE', 'PAR', 'ASC', 'AUTO'])
  })
  it('Catálogos lista dimensión → competencia real', () => {
    const c = hojasPlantillaBanco(cat).find((x) => x.nombre === 'Catálogos')!
    expect(c.filas).toContainEqual(['Analítica', 'Análisis de datos y KPIs'])
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/features/admin/preguntas-import/plantilla.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/features/admin/preguntas-import/plantilla.ts`**

```ts
import type { HojaXlsx } from '@/shared/ui/xlsx-descarga'

/** Arma las hojas del .xlsx de plantilla del banco de preguntas con los catálogos reales. */
export function hojasPlantillaBanco(catalogos: { dimensiones: { nombre: string; competencias: { nombre: string }[] }[] }): HojaXlsx[] {
  const primera = catalogos.dimensiones[0]
  const ejemploDim = primera?.nombre ?? 'Analítica'
  const ejemploComp = primera?.competencias[0]?.nombre ?? 'Análisis de datos y KPIs'
  const competencias: HojaXlsx = {
    nombre: 'Competencias',
    filas: [
      ['Dimensión', 'Competencia', 'Texto', 'JEFE', 'PAR', 'ASC', 'AUTO'],
      [ejemploDim, ejemploComp, 'Ejemplo: ¿toma decisiones con datos?', 'X', 'X', '', 'X'],
    ],
  }
  const potencial: HojaXlsx = {
    nombre: 'Potencial',
    filas: [
      ['Orden', 'Texto'],
      [1, 'Ejemplo: ¿tiene proyección de crecimiento?'],
    ],
  }
  const catFilas: (string | number)[][] = [['Dimensión', 'Competencia']]
  for (const d of catalogos.dimensiones) {
    if (d.competencias.length === 0) catFilas.push([d.nombre, ''])
    for (const c of d.competencias) catFilas.push([d.nombre, c.nombre])
  }
  catFilas.push([], ['Modalidades válidas', 'JEFE, PAR, ASC, AUTO (marca con X)'])
  return [competencias, potencial, { nombre: 'Catálogos', filas: catFilas }]
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/features/admin/preguntas-import/plantilla.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Implementar la acción `src/features/admin/preguntas-import/acciones.ts`**

```ts
'use server'

import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin } from '@/shared/lib/permisos'
import { revalidatePath } from 'next/cache'
import { parseBancoPreguntas } from './parser'
import { planificarBanco } from './plan'
import type { PlanBanco, SnapshotBanco } from './plan'

export type ResultadoBanco = { ok: true; plan: PlanBanco; aplicado: boolean } | { ok: false; error: string }

const normTexto = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

export async function importarBancoPreguntas(formData: FormData, aplicar: boolean): Promise<ResultadoBanco> {
  const sesion = await requiereAdmin('EVALUACIONES', 'GESTIONAR')
  const archivo = formData.get('archivo')
  if (!(archivo instanceof File)) return { ok: false, error: 'No se recibió el archivo.' }
  if (archivo.size > 10 * 1024 * 1024) return { ok: false, error: 'El archivo supera los 10 MB.' }

  const parseado = parseBancoPreguntas(await archivo.arrayBuffer())

  const [dims, comps, preguntas, potencial] = await Promise.all([
    prisma.dimension.findMany({ select: { nombre: true } }),
    prisma.competencia.findMany({ select: { nombre: true, dimension: { select: { nombre: true } } } }),
    prisma.pregunta.findMany({ select: { texto: true, competencia: { select: { nombre: true } } } }),
    prisma.preguntaPotencial.findMany({ select: { texto: true } }),
  ])
  const bd: SnapshotBanco = {
    dimensiones: dims,
    competencias: comps.map((c) => ({ nombre: c.nombre, dimensionNombre: c.dimension.nombre })),
    preguntasExistentes: preguntas.map((p) => ({ competenciaNombre: p.competencia.nombre, textoNorm: normTexto(p.texto) })),
    potencialExistentes: potencial.map((p) => ({ textoNorm: normTexto(p.texto) })),
  }
  const plan = planificarBanco(parseado, bd)

  if (!aplicar || plan.errores.length > 0) return { ok: true, plan, aplicado: false }

  // Aplicar: resolver competenciaId por nombre y crear en transacción
  const idComp = new Map((await prisma.competencia.findMany({ select: { id: true, nombre: true } })).map((c) => [c.nombre, c.id]))
  const maxPot = (await prisma.preguntaPotencial.aggregate({ _max: { orden: true } }))._max.orden ?? 0

  await prisma.$transaction(async (tx) => {
    if (plan.competenciasNuevas.length > 0) {
      await tx.pregunta.createMany({
        data: plan.competenciasNuevas.map((p) => ({ texto: p.texto, competenciaId: idComp.get(p.competencia)!, modalidades: p.modalidades })),
      })
    }
    let orden = maxPot
    for (const p of plan.potencialNuevas) {
      orden += 1
      await tx.preguntaPotencial.create({ data: { texto: p.texto, orden } })
    }
    await tx.auditLog.create({
      data: {
        accion: 'BANCO_PREGUNTAS_IMPORTADO',
        usuarioId: sesion.id,
        detalle: `Banco de preguntas: ${plan.competenciasNuevas.length} de competencia + ${plan.potencialNuevas.length} de potencial (${archivo.name})`,
      },
    })
  })
  revalidatePath('/admin/preguntas')
  return { ok: true, plan, aplicado: true }
}
```

Nota: revisar la forma exacta de `auditLog.create` en `maestro/acciones.ts` o `importador.ts` (campos `accion`/`usuarioId`/`detalle`) y replicarla EXACTA — si el modelo usa otros nombres de campo, ajustar. Es el único punto que depende de la forma del AuditLog.

- [ ] **Step 6: Implementar el componente `ImportadorBancoPreguntas.tsx`**

Client component espejo de `ImportadorPadron.tsx` (leer ese archivo y replicar su estructura: estado `archivo`, `resultado`, `cargando`, botones SIMULAR/APLICAR con modal de confirmación de la casa). Estructura:

```tsx
'use client'

import { useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { descargarXlsx } from '@/shared/ui/xlsx-descarga'
import { hojasPlantillaBanco } from './plantilla'
import { importarBancoPreguntas, type ResultadoBanco } from './acciones'

export function ImportadorBancoPreguntas({ catalogos }: { catalogos: { dimensiones: { nombre: string; competencias: { nombre: string }[] }[] } }) {
  const [archivo, setArchivo] = useState<File | null>(null)
  const [res, setRes] = useState<ResultadoBanco | null>(null)
  const [cargando, setCargando] = useState(false)
  const [confirmar, setConfirmar] = useState(false)

  async function correr(aplicar: boolean) {
    if (!archivo) return
    setCargando(true); setConfirmar(false)
    const fd = new FormData(); fd.set('archivo', archivo)
    setRes(await importarBancoPreguntas(fd, aplicar))
    setCargando(false)
  }

  const plan = res?.ok ? res.plan : null
  const bloqueado = !plan || plan.errores.length > 0
  const totalNuevas = plan ? plan.competenciasNuevas.length + plan.potencialNuevas.length : 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => descargarXlsx('plantilla-banco-preguntas.xlsx', hojasPlantillaBanco(catalogos))}
          className="inline-flex items-center gap-1.5 rounded-xl border border-gris-claro bg-white px-4 py-2 text-[13px] font-bold transition hover:bg-hueso">
          <Download size={15} /> Descargar plantilla
        </button>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-gris-claro bg-white px-4 py-2 text-[13px] font-bold transition hover:bg-hueso">
          <Upload size={15} /> {archivo ? archivo.name : 'Elegir archivo .xlsx'}
          <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setRes(null) }} />
        </label>
        <button type="button" disabled={!archivo || cargando} onClick={() => correr(false)}
          className="rounded-xl bg-negro px-4 py-2 text-[13px] font-bold text-white transition enabled:hover:bg-negro/80 disabled:opacity-40">
          {cargando ? 'Analizando…' : 'Analizar archivo'}
        </button>
      </div>

      {res && !res.ok && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-hunter-dark">{res.error}</p>}

      {plan && (
        <>
          {!bloqueado && (
            <button type="button" onClick={() => setConfirmar(true)} disabled={totalNuevas === 0}
              className="rounded-xl bg-hunter px-4 py-2 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition enabled:hover:bg-hunter-dark disabled:opacity-40">
              {res?.ok && res.aplicado ? 'Aplicado ✓' : `Aplicar carga (${totalNuevas} pregunta${totalNuevas === 1 ? '' : 's'}) →`}
            </button>
          )}
          {plan.errores.length > 0 && (
            <div className="rounded-2xl border border-red-200 bg-red-50/60 p-4">
              <p className="mb-2 font-bold text-hunter-dark">✕ {plan.errores.length} error(es) — corrígelos en el archivo y vuelve a analizar</p>
              <ul className="max-h-72 space-y-1 overflow-y-auto text-[13px] text-negro/80">{plan.errores.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
          {plan.avisos.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
              <p className="mb-2 font-bold text-amber-800">⚠ {plan.avisos.length} aviso(s) — no bloquean</p>
              <ul className="max-h-56 space-y-1 overflow-y-auto text-[13px] text-negro/80">{plan.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          )}
          {!bloqueado && (
            <p className="text-sm text-gris">Se crearán <b>{plan.competenciasNuevas.length}</b> preguntas de competencia y <b>{plan.potencialNuevas.length}</b> de potencial.</p>
          )}
        </>
      )}

      {confirmar && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-negro/40 p-4" onClick={() => setConfirmar(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-bold">Aplicar carga del banco</h3>
            <p className="mt-2 text-sm text-negro/70">Se crearán {totalNuevas} pregunta(s). Esta acción no se puede deshacer.</p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setConfirmar(false)} className="rounded-xl border border-gris-claro px-3.5 py-2 text-[13px] font-bold transition hover:bg-hueso">Cancelar</button>
              <button type="button" onClick={() => correr(true)} className="rounded-xl bg-hunter px-4 py-2 text-[13px] font-bold text-white transition hover:bg-hunter-dark">Aplicar carga</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

Antes de escribir, LEER `src/features/admin/ImportadorPadron.tsx` y `src/features/admin/maestro/CargaMaestra.tsx` para alinear clases/copys/modal EXACTOS de la casa; el bloque de arriba es la estructura, ajústala al patrón real (nombre del modal de confirmación si es un componente compartido, etc.).

- [ ] **Step 7: Crear la página `src/app/(app)/admin/preguntas/importar/page.tsx`**

```tsx
import Link from 'next/link'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin } from '@/shared/lib/permisos'
import { Card, Titulo } from '@/shared/ui/componentes'
import { ImportadorBancoPreguntas } from '@/features/admin/preguntas-import/ImportadorBancoPreguntas'

export default async function ImportarBancoPreguntasPage() {
  await requiereAdmin('EVALUACIONES', 'GESTIONAR')
  const dimensiones = await prisma.dimension.findMany({
    include: { competencias: { orderBy: { nombre: 'asc' }, select: { nombre: true } } },
    orderBy: { orden: 'asc' },
  })
  return (
    <>
      <Link href="/admin/preguntas" className="mb-3 inline-block text-sm text-gris hover:text-negro">← Volver a Diseñar evaluación</Link>
      <Titulo sub="Carga masiva del banco desde la plantilla Excel: primero simula (no escribe nada), revisa el plan y recién aplica">
        Importar preguntas
      </Titulo>
      <div className="space-y-5">
        <Card titulo="Cómo funciona" extra="solo agrega preguntas nuevas; las repetidas se saltan">
          <ul className="list-disc space-y-1 pl-5 text-sm text-negro/80">
            <li>Dos hojas: <b>Competencias</b> (Dimensión · Competencia · Texto · JEFE/PAR/ASC/AUTO con X) y <b>Potencial</b> (Orden · Texto).</li>
            <li>Descarga la plantilla: trae los catálogos reales (dimensiones y competencias) en la hoja «Catálogos».</li>
            <li>Una pregunta ya existente (misma competencia y texto) se salta con aviso; nunca se duplica.</li>
          </ul>
        </Card>
        <Card titulo="Archivo y simulación">
          <ImportadorBancoPreguntas catalogos={{ dimensiones }} />
        </Card>
      </div>
    </>
  )
}
```

- [ ] **Step 8: Botón de entrada en `FormPregunta.tsx`**

Leer `src/features/admin/FormPregunta.tsx`; en el encabezado de la sección `BancoPreguntas`, agregar arriba a la izquierda un `Link` a `/admin/preguntas/importar` visible solo con permiso de gestión. Añadir import `import Link from 'next/link'` y el icono `Upload` de `lucide-react` si no está. El componente recibe hoy un prop de permiso (revisar; la página pasa `puedeGestionar`). Botón:

```tsx
{puedeGestionar && (
  <Link href="/admin/preguntas/importar" className="inline-flex items-center gap-1.5 rounded-xl border border-gris-claro bg-white px-3.5 py-2 text-[13px] font-bold transition hover:bg-hueso">
    <Upload size={15} /> Importar preguntas
  </Link>
)}
```

Ubicarlo a la izquierda de los botones de sección existentes («Por competencia» / «Potencial») sin desalinearlos. Si `BancoPreguntas` no recibe hoy el flag de permiso, pasarlo desde `page.tsx` (que ya calcula `puedeGestionar`).

- [ ] **Step 9: Verificar (tipos + suite + smoke)**

Run: `npx tsc --noEmit` → limpio. `npx vitest run` → toda la suite verde (incluye los nuevos tests).
Smoke: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/admin/preguntas/importar` → 307 (a login) o 200, nunca 500.

- [ ] **Step 10: Commit**

```bash
git add src/features/admin/preguntas-import/plantilla.ts src/features/admin/preguntas-import/plantilla.test.ts src/features/admin/preguntas-import/acciones.ts src/features/admin/preguntas-import/ImportadorBancoPreguntas.tsx "src/app/(app)/admin/preguntas/importar/page.tsx" src/features/admin/FormPregunta.tsx
git commit -m "feat(banco-import): acción, componente, página dedicada y botón de importación del banco

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Padrón acepta Excel + botón de plantilla

**Files:**
- Modify: `src/features/admin/importador.ts` (`importarPadron`, ~línea 340)
- Modify: `src/features/admin/ImportadorPadron.tsx`
- Modify: `src/app/(app)/admin/colaboradores/importar/page.tsx`

**Interfaces:**
- Consumes: `descargarXlsx`/`HojaXlsx` (T2); `XLSX` (import ya usado en `maestro/parser.ts`); `procesarPadron` y `ENCABEZADO` existentes (sin cambios).
- Produces: `importarPadron` que acepta `.xlsx` y `.csv`; helper local `hojasPlantillaPadron(catalogos)` para el botón.

- [ ] **Step 1: Escribir el test que falla (lectura xlsx del padrón)**

El parseo xlsx del padrón debe producir las MISMAS filas que el CSV equivalente. Extraer una función pura `filasDesdeXlsx(buffer): string[][]` en `importador.ts` y testearla. Crear `src/features/admin/importador-xlsx.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { filasDesdeXlsx } from './importador'

describe('filasDesdeXlsx', () => {
  it('devuelve filas como strings (códigos/teléfonos numéricos no se vuelven number)', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['codigo', 'documento', 'telefono'],
      ['PER-001', 40967470, 928892464],
    ]), 'Padrón')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const filas = filasDesdeXlsx(buf)
    expect(filas[0]).toEqual(['codigo', 'documento', 'telefono'])
    expect(filas[1]).toEqual(['PER-001', '40967470', '928892464'])
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/features/admin/importador-xlsx.test.ts`
Expected: FAIL — `filasDesdeXlsx` no exportada.

- [ ] **Step 3: Implementar `filasDesdeXlsx` y ramificar `importarPadron`**

En `src/features/admin/importador.ts`, añadir el import arriba (`import * as XLSX from 'xlsx'`) y exportar:

```ts
/** Lee la primera hoja de un .xlsx como matriz de strings (todo a texto: los códigos y
 * teléfonos numéricos NO deben volverse number). Misma forma que el CSV del padrón. */
export function filasDesdeXlsx(buffer: ArrayBuffer): string[][] {
  const wb = XLSX.read(buffer)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }) as unknown[][]
  return filas.map((f) => f.map((v) => String(v ?? '').trim()))
}
```

En `importarPadron(formData, aplicar)` (~`:340`), donde hoy lee el archivo como texto y llama `parseCsv`, ramificar por extensión. Reemplazar el tramo de obtención de `filas`/`cabecera` por:

```ts
  const esXlsx = archivo.name.toLowerCase().endsWith('.xlsx')
  const filas = esXlsx
    ? filasDesdeXlsx(await archivo.arrayBuffer())
    : parseCsv(await archivo.text())
  if (filas.length === 0) return { ok: false as const, error: 'El archivo está vacío.' }
  const cabecera = filas[0].map((c) => c.trim())
```

(El resto —validación de cabecera contra `ENCABEZADO` en `:355`, armado de `filas` de datos y llamada a `procesarPadron` con `origen: 'CSV'`— queda igual. Verificar que la conversión de filas a objetos por `ENCABEZADO` opere sobre `filas.slice(1)` en ambos caminos.)

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/features/admin/importador-xlsx.test.ts`
Expected: PASS.

- [ ] **Step 5: Botón de plantilla + accept en `ImportadorPadron.tsx`**

Leer el componente. Cambiar `accept=".csv,text/csv"` → `accept=".csv,.xlsx,text/csv"`. Agregar un botón «Descargar plantilla» que llame `descargarXlsx('plantilla-padron.xlsx', hojasPlantillaPadron(catalogos))`. Definir el helper en el mismo archivo del componente (o en un `plantilla-padron.ts` colocalizado):

```ts
import type { HojaXlsx } from '@/shared/ui/xlsx-descarga'

const COLUMNAS = ['codigo', 'documento', 'nombres', 'apellidos', 'email', 'telefono', 'pais', 'area', 'cargo', 'nivel_jerarquico', 'codigo_jefe', 'nivel_liderazgo', 'fecha_ingreso']

export function hojasPlantillaPadron(catalogos: { paises: string[]; niveles: string[]; areas: string[] }): HojaXlsx[] {
  const datos: HojaXlsx = {
    nombre: 'Padrón',
    filas: [COLUMNAS, ['PER-001', '40967470', 'Nombre', 'Apellido', 'correo@hunter.com', '+51 999 999 999', catalogos.paises[0] ?? 'Perú', catalogos.areas[0] ?? 'Área', 'Cargo', catalogos.niveles[0] ?? 'Apoyo', '', '', '2024-01-15']],
  }
  const cat: (string | number)[][] = [['Países válidos', ...catalogos.paises], ['Niveles válidos', ...catalogos.niveles]]
  return [datos, { nombre: 'Catálogos', filas: cat }]
}
```

El componente recibe `catalogos` por props desde la página. `ImportadorPadron` cambia su firma a `ImportadorPadron({ catalogos }: { catalogos: { paises: string[]; niveles: string[]; areas: string[] } })`.

- [ ] **Step 6: Página del padrón pasa catálogos + copy**

En `src/app/(app)/admin/colaboradores/importar/page.tsx`: cargar catálogos y pasarlos; actualizar el copy «plantilla CSV» → «plantilla Excel (también acepta CSV)».

```tsx
  const [paises, niveles, areas] = await Promise.all([
    prisma.pais.findMany({ orderBy: { nombre: 'asc' }, select: { nombre: true } }),
    prisma.nivelJerarquico.findMany({ orderBy: { orden: 'asc' }, select: { nombre: true } }),
    prisma.area.findMany({ orderBy: { nombre: 'asc' }, select: { nombre: true } }),
  ])
  // ...
  <ImportadorPadron catalogos={{ paises: paises.map((p) => p.nombre), niveles: niveles.map((n) => n.nombre), areas: areas.map((a) => a.nombre) }} />
```

Añadir `import { prisma } from '@/shared/lib/prisma'` si no está.

- [ ] **Step 7: Verificar y commitear**

Run: `npx tsc --noEmit` limpio; `npx vitest run` verde; smoke `curl` a `/admin/colaboradores/importar` → 307/200.

```bash
git add src/features/admin/importador.ts src/features/admin/importador-xlsx.test.ts src/features/admin/ImportadorPadron.tsx "src/app/(app)/admin/colaboradores/importar/page.tsx"
git commit -m "feat(padron-import): aceptar .xlsx además de .csv + botón de plantilla

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Botón de plantilla en la carga maestra

**Files:**
- Modify: `src/features/admin/maestro/CargaMaestra.tsx`
- Modify: `src/app/(app)/admin/configuracion/page.tsx`
- Create: `src/features/admin/maestro/plantilla.ts`

**Interfaces:**
- Consumes: `descargarXlsx`/`HojaXlsx` (T2); las claves de hoja que `parser.ts` espera (`CLAVES_HOJA`).
- Produces: `hojasPlantillaMaestra(catalogos)` — plantilla vacía con encabezados + ejemplo + Catálogos, en el formato que `parseMaestro` lee.

- [ ] **Step 1: Test de la plantilla maestra (puro)**

Crear `src/features/admin/maestro/plantilla.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { hojasPlantillaMaestra } from './plantilla'

describe('hojasPlantillaMaestra', () => {
  const cat = { niveles: ['Apoyo'], dimensiones: ['Analítica'], competencias: ['Análisis de datos y KPIs'], paises: ['Perú'], areas: ['TI'] }
  it('incluye las hojas que el parser espera', () => {
    const nombres = hojasPlantillaMaestra(cat).map((h) => h.nombre)
    expect(nombres).toEqual(expect.arrayContaining(['Niveles', 'Puestos', 'Competencias x Puesto', 'Pesos x Puesto', 'Padrón', 'Catálogos']))
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/features/admin/maestro/plantilla.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/features/admin/maestro/plantilla.ts`**

Leer `parser.ts` (`CLAVES_HOJA` y los encabezados que cada hoja espera) para que los encabezados de la plantilla COINCIDAN con lo que el parser lee. Implementar:

```ts
import type { HojaXlsx } from '@/shared/ui/xlsx-descarga'

/** Plantilla VACÍA de la carga maestra (encabezados + fila de ejemplo) en el formato que
 * parseMaestro espera, más una hoja «Catálogos» de referencia. No exporta datos actuales. */
export function hojasPlantillaMaestra(catalogos: { niveles: string[]; dimensiones: string[]; competencias: string[]; paises: string[]; areas: string[] }): HojaXlsx[] {
  const dimHead = catalogos.dimensiones
  const niv = catalogos.niveles[0] ?? 'Apoyo'
  const niveles: HojaXlsx = { nombre: 'Niveles', filas: [['Nivel', ...dimHead, 'Competencias %', 'Objetivos %'], [niv, ...dimHead.map(() => 20), 60, 40]] }
  const puestos: HojaXlsx = { nombre: 'Puestos', filas: [['Puesto', 'Nivel', 'Área'], ['Ejemplo de puesto', niv, catalogos.areas[0] ?? 'TI']] }
  const compXPuesto: HojaXlsx = { nombre: 'Competencias x Puesto', filas: [['Puesto', 'Nivel', ...catalogos.competencias], ['Ejemplo de puesto', niv, ...catalogos.competencias.map(() => 'X')]] }
  const pesosXPuesto: HojaXlsx = { nombre: 'Pesos x Puesto', filas: [['Puesto', 'Nivel', ...dimHead, 'TOTAL'], ['Ejemplo de puesto', niv, ...dimHead.map(() => 20), 100]] }
  const padron: HojaXlsx = { nombre: 'Padrón', filas: [['codigo', 'documento', 'nombres', 'apellidos', 'email', 'telefono', 'pais', 'area', 'cargo', 'nivel_jerarquico', 'codigo_jefe', 'nivel_liderazgo', 'fecha_ingreso'], ['PER-001', '40967470', 'Nombre', 'Apellido', 'correo@hunter.com', '+51 999 999 999', catalogos.paises[0] ?? 'Perú', catalogos.areas[0] ?? 'TI', 'Ejemplo de puesto', niv, '', '', '2024-01-15']] }
  const cat: (string | number)[][] = [
    ['Niveles', ...catalogos.niveles],
    ['Dimensiones', ...catalogos.dimensiones],
    ['Competencias', ...catalogos.competencias],
    ['Países', ...catalogos.paises],
    ['Áreas', ...catalogos.areas],
  ]
  return [niveles, puestos, compXPuesto, pesosXPuesto, padron, { nombre: 'Catálogos', filas: cat }]
}
```

IMPORTANTE: ajustar los encabezados EXACTOS de cada hoja a lo que `parser.ts` realmente lee (revisar `CLAVES_HOJA` y el mapeo de columnas). El objetivo es que la plantilla descargada, si se rellena y se re-sube, pase el parser. Si el parser usa posiciones y no nombres, respetar el orden de columnas.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/features/admin/maestro/plantilla.test.ts`
Expected: PASS.

- [ ] **Step 5: Botón en `CargaMaestra.tsx` + catálogos desde Configuración**

Leer `CargaMaestra.tsx`; agregar el prop `catalogos` y un botón «Descargar plantilla» junto al input que llame `descargarXlsx('plantilla-carga-maestra.xlsx', hojasPlantillaMaestra(catalogos))`. En `src/app/(app)/admin/configuracion/page.tsx`, cargar los catálogos (niveles, dimensiones, competencias, países, áreas) y pasarlos a `<CargaMaestra puedeGestionar={…} catalogos={…} />`.

- [ ] **Step 6: Verificar y commitear**

Run: `npx tsc --noEmit` limpio; `npx vitest run` verde; smoke `curl` a `/admin/configuracion` → 307/200.

```bash
git add src/features/admin/maestro/plantilla.ts src/features/admin/maestro/plantilla.test.ts src/features/admin/maestro/CargaMaestra.tsx "src/app/(app)/admin/configuracion/page.tsx"
git commit -m "feat(maestro-import): botón de descarga de plantilla en la carga maestra

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review (ejecutada)

- **Cobertura del spec**: helper `descargarXlsx` (T2) · sugeridor (T1) · importador banco parser/plan/acción/UI/página/botón (T3-T5) · identidad competencia+texto y solo-altas (T4) · plantillas con catálogos reales en los tres (T5/T6/T7) · padrón acepta xlsx+csv (T6) · validador con sugerencias (T4) · guards EVALUACIONES/COLABORADORES GESTIONAR (T5/T6) · modalidades 4 columnas con X (T3) · sin dependencias nuevas (usa SheetJS) · anti-inyección (T2). Sin gaps.
- **Placeholders**: ninguno; todo el código está en los steps. Las 3 notas de «leer el archivo X antes de escribir» son para alinear clases/encabezados exactos de la casa, no placeholders de lógica.
- **Consistencia de tipos**: `HojaXlsx` (T2) consumido por T5/T6/T7; `BancoParseado`/`FilaCompetencia`/`FilaPotencial` (T3) → `planificarBanco` (T4) → `importarBancoPreguntas` (T5); `PlanBanco`/`SnapshotBanco` firma idéntica T4↔T5; `sugerir` (T1) usado en T4; `filasDesdeXlsx` (T6) exportada y testeada; `normalizar` reusado de `maestro/parser.ts` en T3/T4.
- **Riesgo señalado a la ejecución**: la forma exacta del `AuditLog.create` (campos) y los encabezados exactos de las hojas de la carga maestra deben confirmarse contra el código real antes de escribir (T5 Step 5, T7 Step 3) — son los dos únicos puntos que dependen de detalles no citables sin abrir esos archivos.
