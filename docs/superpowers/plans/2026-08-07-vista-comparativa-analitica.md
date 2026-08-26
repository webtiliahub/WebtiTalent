# Vista comparativa en Análisis del ciclo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modo «Vista comparativa» en `/admin/resultados/analisis`: comparar dos grupos (país + área opcional) con leyenda de color global, scorecards duales, distribución apilada con curvas, evolución de 3 líneas y radar/variación por dimensión; además, corregir el radar de la vista normal para que el punteado sea el **perfil esperado** (no el ciclo anterior).

**Architecture:** Un módulo de datos nuevo `src/features/resultados/comparacion.ts` (helpers puros testeables + `comparacionCiclo` contra Prisma) alimenta una rama `comparar=1` de la página, que renderiza componentes comparativos nuevos (`HistogramaComparativo` client, `ComparacionUI` server, `SelectorComparacion` client) y extiende `RadarDimensiones` con un segundo polígono. La validación de grupos es SIEMPRE server-side contra el alcance del observador.

**Tech Stack:** Next.js 16 App Router (server components + searchParams), Prisma 7 (cliente generado COMMITEADO en `src/generated/prisma` — este feature NO toca el schema), Tailwind 4, Vitest, SVG a mano (estilo de la casa, sin librerías de charts).

## Global Constraints

- **Colores exactos de la vista comparativa** (spec §3): Grupo A = `#f0163e` (rojo Hunter), Grupo B = `#0284c7` (azul sky-600), organización = `#8a857f` **punteado**. Un solo lugar los define: `src/features/resultados/colores.ts`.
- **Copys exactos**: botón «Vista comparativa», botón «Comparar», enlace «Salir de la comparación», área vacía = «Todas las áreas», nombre de grupo = «{País} · {Área}» o «{País} (todas las áreas)», aviso grupos idénticos = «Elige dos grupos distintos para comparar.», aviso grupo vacío = «{nombre del grupo}: sin evaluados en este ciclo.», leyenda organización = «Organización».
- **Contrato de URL**: `?comparar=1&aPais=…&aArea=…&bPais=…&bArea=…` (+ `ciclo` que se preserva siempre). Parámetros inválidos o fuera de alcance ⇒ la página cae a la vista normal (sin romper). El país es el TECHO: RRHH-país solo puede usar su país en ambos grupos; solo REGIONAL cruza países. La validación vive en el servidor — la URL nunca se confía.
- **Áreas sin evaluados en el ciclo elegido NO aparecen** en los comboboxes del selector (spec §2). Ambos selectores (país y área) usan el `Combobox` existente de `src/shared/ui/Combobox.tsx`.
- **Secciones ocultas con la comparación activa** (spec §7): Puntos de acción, Pain points por área y dimensión, Outliers estadísticos, Brecha de autopercepción, Sesgo del evaluador, Competencias vs objetivos descuadrados, el expandible «Detalle por área» de Evolución, y los filtros globales de área/nivel/país (el select de ciclo sigue operativo).
- **Español neutro** en toda la UI; **sin emojis como iconos** (iconos = `lucide-react`, ya en el proyecto).
- La suite existente (133 tests, `npx vitest run`) debe seguir verde en cada commit. `npx tsc --noEmit` limpio.
- **Commits locales, SIN `git push`** (Christian pide el push explícitamente). Nunca `git add -A` — añadir archivos por nombre. Scripts de verificación efímeros NO se trackean y se borran al final.
- El dev corre en `localhost:3001` contra el clone local (`hunter360_prodclone`). Solo lecturas/escrituras locales; NADA contra producción.

## File Structure

| Archivo | Rol |
|---|---|
| `src/features/resultados/colores.ts` (crear) | Constantes `COLOR_A`, `COLOR_B`, `COLOR_ORG` (importable desde client y server) |
| `src/features/resultados/comparacion.ts` (crear) | Helpers puros (`esperadoDeCorte`, `binsApilados`, `validarGrupos`, `nombreGrupo`) + `perfilesEsperados` y `comparacionCiclo` (Prisma) |
| `src/features/resultados/comparacion.test.ts` (crear) | Unit tests de los helpers puros |
| `src/features/resultados/analisis.ts` (modificar) | `dimVsAnterior` gana `esperado` (perfil esperado del corte) vía helpers de comparacion.ts |
| `src/shared/ui/RadarDimensiones.tsx` (modificar) | `DimRadar` gana `valorB?` → segundo polígono azul opcional |
| `src/features/resultados/HistogramaComparativo.tsx` (crear) | Client: barras apiladas A/B + curvas A/B/org + clic → listado con punto de color |
| `src/features/resultados/ComparacionUI.tsx` (crear) | Server: `LeyendaComparacion`, `KpisComparativos`, `EvolucionComparada`, `BarrasDeltaComparadas` |
| `src/features/resultados/SelectorComparacion.tsx` (crear) | Client: botón + panel con 2×(país, área) y «Comparar» / «Salir de la comparación» |
| `src/app/(app)/admin/resultados/analisis/page.tsx` (modificar) | Radar normal con esperado; rama comparativa completa; selector en la fila de filtros |

---

### Task 1: Helpers puros de comparación (`comparacion.ts` parte pura + tests)

**Files:**
- Create: `src/features/resultados/colores.ts`
- Create: `src/features/resultados/comparacion.ts` (solo la parte pura en esta tarea)
- Test: `src/features/resultados/comparacion.test.ts`

**Interfaces:**
- Consumes: `media`, `histograma` de `@/domain/estadistica` (existentes).
- Produces (las tareas 2, 3 y 5 dependen de estas firmas EXACTAS):
  - `type Grupo = { paisId: string; areaId?: string }`
  - `nombreGrupo(pais: string, area: string | null): string`
  - `esperadoDeCorte(puestoIds: (string | null)[], perfilPorPuesto: Map<string, Record<string, number>>, dimensionIds: string[]): (number | null)[]`
  - `binsApilados(a: {nombre: string; nota: number}[], b: {nombre: string; nota: number}[]): { bins: {desde: number; hasta: number; nA: number; nB: number}[]; personasPorBin: PersonaBin[][] }` con `type PersonaBin = { nombre: string; nota: number; grupo: 'A' | 'B' }`
  - `validarGrupos(params, ctx): { grupoA: Grupo; grupoB: Grupo; identicos: boolean } | null`
  - `colores.ts`: `COLOR_A = '#f0163e'`, `COLOR_B = '#0284c7'`, `COLOR_ORG = '#8a857f'`

- [ ] **Step 1: Crear `src/features/resultados/colores.ts`**

```ts
/** Colores de la vista comparativa (spec 2026-08-07): un solo lugar los define.
 * Archivo sin dependencias: importable desde client y server components. */
export const COLOR_A = '#f0163e' // Grupo A — rojo Hunter
export const COLOR_B = '#0284c7' // Grupo B — azul (sky-600)
export const COLOR_ORG = '#8a857f' // Organización — gris (siempre punteado)
```

- [ ] **Step 2: Escribir los tests que fallan**

Crear `src/features/resultados/comparacion.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { esperadoDeCorte, binsApilados, validarGrupos, nombreGrupo } from './comparacion'

describe('nombreGrupo', () => {
  it('país + área', () => expect(nombreGrupo('Perú', 'RRHH')).toBe('Perú · RRHH'))
  it('país completo', () => expect(nombreGrupo('Perú', null)).toBe('Perú (todas las áreas)'))
})

describe('esperadoDeCorte', () => {
  const perfil = new Map<string, Record<string, number>>([
    ['p1', { d1: 4, d2: 3 }],
    ['p2', { d1: 5 }], // p2 no define d2
  ])
  it('promedia el esperado del puesto de cada evaluado', () => {
    // Dos evaluados con p1 y uno con p2: d1 = (4+4+5)/3, d2 = (3+3)/2
    expect(esperadoDeCorte(['p1', 'p1', 'p2'], perfil, ['d1', 'd2'])).toEqual([13 / 3, 3])
  })
  it('evaluado sin puesto no aporta', () => {
    expect(esperadoDeCorte(['p1', null], perfil, ['d1'])).toEqual([4])
  })
  it('dimensión sin ningún perfil → null', () => {
    expect(esperadoDeCorte(['p2'], perfil, ['d2'])).toEqual([null])
  })
  it('corte vacío → null por dimensión', () => {
    expect(esperadoDeCorte([], perfil, ['d1', 'd2'])).toEqual([null, null])
  })
})

describe('binsApilados', () => {
  it('cuenta por grupo en la grilla 1–5 de ancho 0.5', () => {
    const { bins, personasPorBin } = binsApilados(
      [{ nombre: 'Ana', nota: 4.2 }, { nombre: 'Luis', nota: 4.9 }],
      [{ nombre: 'Eva', nota: 4.4 }],
    )
    expect(bins).toHaveLength(8)
    const bin4 = bins.find((b) => b.desde === 4)! // [4.0, 4.5)
    expect(bin4).toMatchObject({ nA: 1, nB: 1 })
    expect(bins.find((b) => b.desde === 4.5)).toMatchObject({ nA: 1, nB: 0 })
    // Personas del bin con su grupo, ordenadas por nota desc
    const gente4 = personasPorBin[bins.indexOf(bin4)]
    expect(gente4.map((p) => [p.nombre, p.grupo])).toEqual([['Eva', 'B'], ['Ana', 'A']])
  })
  it('nota 5.0 cae en el último bin (borde superior)', () => {
    const { bins } = binsApilados([{ nombre: 'Top', nota: 5 }], [])
    expect(bins[bins.length - 1].nA).toBe(1)
  })
})

describe('validarGrupos', () => {
  const ctx = {
    esRegional: true,
    paisSesionId: null as string | null,
    paisesValidos: new Set(['pe', 'cl']),
    areasValidas: new Set(['rrhh', 'ventas']),
  }
  it('acepta dos grupos válidos con área opcional', () => {
    const r = validarGrupos({ aPais: 'pe', aArea: 'rrhh', bPais: 'cl' }, ctx)
    expect(r).toEqual({ grupoA: { paisId: 'pe', areaId: 'rrhh' }, grupoB: { paisId: 'cl', areaId: undefined }, identicos: false })
  })
  it('marca idénticos (mismo país y misma área, o ambos sin área)', () => {
    expect(validarGrupos({ aPais: 'pe', bPais: 'pe' }, ctx)?.identicos).toBe(true)
    expect(validarGrupos({ aPais: 'pe', aArea: 'rrhh', bPais: 'pe', bArea: 'rrhh' }, ctx)?.identicos).toBe(true)
    expect(validarGrupos({ aPais: 'pe', aArea: 'rrhh', bPais: 'pe', bArea: 'ventas' }, ctx)?.identicos).toBe(false)
  })
  it('rechaza país desconocido o área desconocida', () => {
    expect(validarGrupos({ aPais: 'xx', bPais: 'cl' }, ctx)).toBeNull()
    expect(validarGrupos({ aPais: 'pe', aArea: 'zzz', bPais: 'cl' }, ctx)).toBeNull()
  })
  it('RRHH-país: el país es el techo — solo su país en ambos lados', () => {
    const ctxPais = { ...ctx, esRegional: false, paisSesionId: 'pe' }
    expect(validarGrupos({ aPais: 'pe', aArea: 'rrhh', bPais: 'cl' }, ctxPais)).toBeNull()
    expect(validarGrupos({ aPais: 'pe', aArea: 'rrhh', bPais: 'pe', bArea: 'ventas' }, ctxPais)).not.toBeNull()
  })
  it('falta un lado → null', () => {
    expect(validarGrupos({ aPais: 'pe' }, ctx)).toBeNull()
    expect(validarGrupos({}, ctx)).toBeNull()
  })
})
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `npx vitest run src/features/resultados/comparacion.test.ts`
Expected: FAIL — `Cannot find module './comparacion'` (o exports inexistentes).

- [ ] **Step 4: Implementar la parte pura de `src/features/resultados/comparacion.ts`**

```ts
import { media, histograma } from '@/domain/estadistica'

/** Vista comparativa (spec 2026-08-07): dos grupos país+área frente a frente.
 * Esta mitad del módulo es PURA (testeable sin BD); comparacionCiclo (abajo,
 * Task 3) hace las consultas. */

export type Grupo = { paisId: string; areaId?: string }

export function nombreGrupo(pais: string, area: string | null): string {
  return area ? `${pais} · ${area}` : `${pais} (todas las áreas)`
}

/** Esperado del corte por dimensión: promedio del puntajeEsperado del puesto de cada
 * evaluado. Sin puesto, o puesto que no define la dimensión, no aporta a esa dimensión. */
export function esperadoDeCorte(
  puestoIds: (string | null)[],
  perfilPorPuesto: Map<string, Record<string, number>>,
  dimensionIds: string[],
): (number | null)[] {
  return dimensionIds.map((dimId) => {
    const vals: number[] = []
    for (const pid of puestoIds) {
      if (!pid) continue
      const v = perfilPorPuesto.get(pid)?.[dimId]
      if (v !== undefined) vals.push(v)
    }
    return media(vals)
  })
}

export type PersonaBin = { nombre: string; nota: number; grupo: 'A' | 'B' }

/** Bins apilados A/B sobre la grilla estándar (1–5, ancho 0.5) + personas por bin
 * con su grupo (ordenadas por nota desc, para el panel del clic). */
export function binsApilados(
  a: { nombre: string; nota: number }[],
  b: { nombre: string; nota: number }[],
): { bins: { desde: number; hasta: number; nA: number; nB: number }[]; personasPorBin: PersonaBin[][] } {
  const bins = histograma([]).map(({ desde, hasta }) => ({ desde, hasta, nA: 0, nB: 0 }))
  const personasPorBin: PersonaBin[][] = bins.map(() => [])
  const meter = (lista: { nombre: string; nota: number }[], grupo: 'A' | 'B') => {
    for (const p of lista) {
      const i = Math.min(bins.length - 1, Math.max(0, Math.floor((p.nota - 1) / 0.5)))
      if (grupo === 'A') bins[i].nA += 1
      else bins[i].nB += 1
      personasPorBin[i].push({ nombre: p.nombre, nota: Number(p.nota.toFixed(2)), grupo })
    }
  }
  meter(a, 'A')
  meter(b, 'B')
  for (const lista of personasPorBin) lista.sort((x, y) => y.nota - x.nota)
  return { bins, personasPorBin }
}

/** Valida los grupos de la URL contra el alcance del observador. null = la comparación
 * no puede activarse (parámetro inválido o fuera de alcance) y la página cae a vista
 * normal. El país es el TECHO: sin alcance REGIONAL, ambos lados deben ser su país. */
export function validarGrupos(
  params: { aPais?: string; aArea?: string; bPais?: string; bArea?: string },
  ctx: { esRegional: boolean; paisSesionId: string | null; paisesValidos: Set<string>; areasValidas: Set<string> },
): { grupoA: Grupo; grupoB: Grupo; identicos: boolean } | null {
  const lado = (pais?: string, area?: string): Grupo | null => {
    if (!pais || !ctx.paisesValidos.has(pais)) return null
    if (!ctx.esRegional && pais !== ctx.paisSesionId) return null
    if (area && !ctx.areasValidas.has(area)) return null
    return { paisId: pais, areaId: area || undefined }
  }
  const grupoA = lado(params.aPais, params.aArea)
  const grupoB = lado(params.bPais, params.bArea)
  if (!grupoA || !grupoB) return null
  const identicos = grupoA.paisId === grupoB.paisId && (grupoA.areaId ?? '') === (grupoB.areaId ?? '')
  return { grupoA, grupoB, identicos }
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run src/features/resultados/comparacion.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 6: Suite completa + commit**

Run: `npx vitest run` → 146 tests verdes (133 + 13). Luego:

```bash
git add src/features/resultados/colores.ts src/features/resultados/comparacion.ts src/features/resultados/comparacion.test.ts
git commit -m "feat(comparacion): helpers puros de la vista comparativa (esperado, bins apilados, validación de grupos)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Perfil esperado en la vista normal (radar corregido)

El punteado del radar «Comparación por dimensión» deja de ser el ciclo anterior y pasa a ser el **perfil esperado del corte** (spec §5). El gráfico de barras «Cambio vs ciclo anterior» NO cambia.

**Files:**
- Modify: `src/features/resultados/comparacion.ts` (añadir `perfilesEsperados` con Prisma)
- Modify: `src/features/resultados/analisis.ts:143-152` (dimVsAnterior gana `esperado`)
- Modify: `src/app/(app)/admin/resultados/analisis/page.tsx:212-231` (card del radar)

**Interfaces:**
- Consumes: `esperadoDeCorte` (Task 1); `prisma.pesoDimensionPuesto` (campo `puntajeEsperado Float`, escala 1–5, `@@id([puestoId, dimensionId])`).
- Produces: `perfilesEsperados(puestoIds: string[]): Promise<Map<string, Record<string, number>>>` (Task 3 la reutiliza); `dimVsAnterior[i].esperado: number | null` (la página lo consume).

- [ ] **Step 1: Añadir `perfilesEsperados` al final de `comparacion.ts`**

```ts
import { prisma } from '@/shared/lib/prisma'

/** Perfil esperado por puesto: Map puestoId → { dimensionId: puntajeEsperado }. */
export async function perfilesEsperados(puestoIds: string[]): Promise<Map<string, Record<string, number>>> {
  const filas = await prisma.pesoDimensionPuesto.findMany({
    where: { puestoId: { in: [...new Set(puestoIds)] } },
    select: { puestoId: true, dimensionId: true, puntajeEsperado: true },
  })
  const out = new Map<string, Record<string, number>>()
  for (const f of filas) {
    const r = out.get(f.puestoId) ?? {}
    r[f.dimensionId] = f.puntajeEsperado
    out.set(f.puestoId, r)
  }
  return out
}
```

(El `import { prisma }` va arriba del archivo, junto al de estadística.)

- [ ] **Step 2: `analisis.ts` — dimVsAnterior gana `esperado`**

En `src/features/resultados/analisis.ts`, añadir el import arriba:

```ts
import { perfilesEsperados, esperadoDeCorte } from './comparacion'
```

Reemplazar el bloque `const dimVsAnterior = …` (líneas ~143-152) por:

```ts
  // Perfil esperado del corte (promedio del puntajeEsperado del puesto de cada evaluado):
  // alimenta el punteado del radar — la expectativa, no el ciclo anterior
  const perfilPorPuesto = await perfilesEsperados(
    resultados.map((r) => r.colaborador.puestoId).filter((p): p is string => p !== null),
  )
  const esperadoDim = esperadoDeCorte(resultados.map((r) => r.colaborador.puestoId), perfilPorPuesto, dimensiones.map((d) => d.id))
  const dimVsAnterior = dimensiones.map((d, i) => {
    const actual = promedioDim(resultados, d.id)
    const anteriorDim = promedioDim(previosFiltrados, d.id)
    return {
      nombre: d.nombre,
      actual,
      anterior: anteriorDim,
      esperado: esperadoDim[i] !== null ? Number(esperadoDim[i]!.toFixed(2)) : null,
      delta: actual !== null && anteriorDim !== null ? Number((actual - anteriorDim).toFixed(2)) : null,
    }
  }).filter((d) => d.actual !== null)
```

- [ ] **Step 3: Card del radar en `page.tsx` — punteado = esperado**

En `src/app/(app)/admin/resultados/analisis/page.tsx` (card «Comparación por dimensión», líneas ~212-231), reemplazar:

```tsx
      {/* 3b · Por dimensión: radar (izq) + cambio vs ciclo anterior (der) */}
      <Card
        className="mt-5"
        titulo="Comparación por dimensión"
        ayuda="Radar con el promedio del ciclo en cada dimensión, superpuesto al perfil esperado (punteado): la expectativa definida al configurar los puestos, promediada sobre los evaluados del corte. Muestra cuánto falta para llegar a ella. Las barras de la derecha miden el cambio vs el ciclo anterior."
        extra="perfil esperado (punteado) vs obtenido (rojo)"
      >
        <div className="grid items-center gap-8 lg:grid-cols-[3fr_2fr]">
          <div className="mx-auto w-full max-w-2xl">
            <RadarDimensiones
              ariaLabel="Radar por dimensión: perfil esperado vs obtenido"
              mostrarValores
              dims={a.evolucion.dimVsAnterior.map((d, i) => ({
                nombre: d.nombre,
                color: colorDim(i),
                valor: d.actual,
                esperado: d.esperado ?? undefined,
              }))}
            />
          </div>
```

(El `<div>` derecho con `BarrasDelta` y el cierre de la card quedan EXACTAMENTE como están.)

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit` → limpio. `npx vitest run` → 146 verdes.
Verificación visual en `localhost:3001/admin/resultados/analisis`: el radar muestra el punteado gris del esperado (en el clone los puestos del piloto tienen `puntajeEsperado`; si todos están en el default 3, el punteado es un pentágono regular en 3 — correcto). Los valores junto a los ejes se pintan verde/rojo contra el esperado (lógica existente de `RadarDimensiones`).

- [ ] **Step 5: Commit**

```bash
git add src/features/resultados/comparacion.ts src/features/resultados/analisis.ts "src/app/(app)/admin/resultados/analisis/page.tsx"
git commit -m "feat(analitica): el punteado del radar pasa a ser el perfil esperado del corte

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `comparacionCiclo` (agregación con Prisma)

**Files:**
- Modify: `src/features/resultados/comparacion.ts` (añadir al final)
- Verificación: script efímero `prisma/smoke-comparacion.ts` (NO se commitea; se borra al final)

**Interfaces:**
- Consumes: `Grupo`, `nombreGrupo`, `binsApilados`, `esperadoDeCorte`, `perfilesEsperados` (Tasks 1-2); `media`, `mediana`, `desviacion`, `curvaNormal` de `@/domain/estadistica`; `DimensionResultado` de `./servicio`.
- Produces (Task 5 consume esto tal cual):

```ts
export type LadoComparacion = {
  nombre: string
  n: number
  promedio: number | null
  mediana: number | null
  sigma: number | null
  alto: number   // notas ≥ 4.0
  bajo: number   // notas < 3.0
  curva: { x: number; y: number }[]
  media: number | null            // para la línea x̄ del histograma
  serieEvolucion: (number | null)[] // alineada a ciclosOrden; null = sin datos ese ciclo
  dims: { nombre: string; actual: number | null; delta: number | null }[]
}
export type ComparacionCiclo = Awaited<ReturnType<typeof comparacionCiclo>>
// comparacionCiclo(cicloId: string, wherePais: { paisId?: string }, grupoA: Grupo, grupoB: Grupo)
// → { a: LadoComparacion; b: LadoComparacion; bins; personasPorBin;
//     organizacion: { n: number; curva: {x;y}[]; serieEvolucion: (number|null)[]; esperadoDim: (number|null)[] };
//     ciclosOrden: { id: string; cierre: string }[]; dimensiones: string[]; anteriorNombre: string | null }
```

- [ ] **Step 1: Implementar `comparacionCiclo` al final de `comparacion.ts`**

```ts
import { mediana, desviacion, curvaNormal } from '@/domain/estadistica'
import type { DimensionResultado } from './servicio'

// (fusionar estos imports con los ya existentes arriba del archivo)

type WherePais = { paisId?: string }
const vigente = (r: { notaFinal: number | null; notaCalibrada: number | null }) => r.notaCalibrada ?? r.notaFinal
const notaDim = (desglose: unknown, dimensionId: string) => {
  const d = ((desglose as DimensionResultado[] | null) ?? []).find((x) => x.dimensionId === dimensionId)
  return d ? d.ajuste ?? d.nota : null
}

/** Datos de la vista comparativa: dos grupos (país + área opcional) + la organización
 * (alcance completo del observador) como referencia. Los grupos llegan YA validados
 * contra el alcance (validarGrupos) — aquí solo se consulta dentro de wherePais. */
export async function comparacionCiclo(cicloId: string, wherePais: WherePais, grupoA: Grupo, grupoB: Grupo) {
  const [ciclo, resultados, dimensiones, historicosTodos, paises, areas] = await Promise.all([
    prisma.ciclo.findUniqueOrThrow({ where: { id: cicloId } }),
    prisma.resultado.findMany({
      where: { cicloId, notaFinal: { not: null }, colaborador: { is: { ...wherePais } } },
      include: { colaborador: { select: { nombres: true, apellidos: true, paisId: true, areaId: true, puestoId: true } } },
    }),
    prisma.dimension.findMany({ orderBy: { orden: 'asc' } }),
    prisma.resultado.findMany({
      where: { notaFinal: { not: null }, colaborador: { is: { ...wherePais } }, ciclo: { estado: { in: ['ACTIVO', 'CERRADO'] } } },
      include: {
        ciclo: { select: { id: true, fechaInicio: true, fechaFin: true } },
        colaborador: { select: { paisId: true, areaId: true } },
      },
    }),
    prisma.pais.findMany({ where: { id: { in: [grupoA.paisId, grupoB.paisId] } }, select: { id: true, nombre: true } }),
    prisma.area.findMany({
      where: { id: { in: [grupoA.areaId, grupoB.areaId].filter((x): x is string => Boolean(x)) } },
      select: { id: true, nombre: true },
    }),
  ])

  const pertenece = (g: Grupo) => (c: { paisId: string; areaId: string | null }) =>
    c.paisId === g.paisId && (!g.areaId || c.areaId === g.areaId)
  const enA = pertenece(grupoA)
  const enB = pertenece(grupoB)
  const nombreDe = (g: Grupo) =>
    nombreGrupo(paises.find((p) => p.id === g.paisId)?.nombre ?? '?', areas.find((x) => x.id === g.areaId)?.nombre ?? null)

  // Ciclo anterior (por fecha de inicio) para los deltas por dimensión de cada grupo
  const anterior = await prisma.ciclo.findFirst({
    where: { fechaInicio: { lt: ciclo.fechaInicio }, resultados: { some: { notaFinal: { not: null } } } },
    orderBy: { fechaInicio: 'desc' },
  })
  const previos = anterior
    ? await prisma.resultado.findMany({
        where: { cicloId: anterior.id, notaFinal: { not: null }, colaborador: { is: { ...wherePais } } },
        include: { colaborador: { select: { paisId: true, areaId: true } } },
      })
    : []

  // Evolución: mismos ciclos ordenados para las 3 series (null = el grupo no tiene datos ese ciclo)
  const ciclosOrden = [...new Map(historicosTodos.map((r) => [r.ciclo.id, r.ciclo])).values()]
    .sort((x, y) => x.fechaInicio.getTime() - y.fechaInicio.getTime())
    .map((c) => ({ id: c.id, cierre: c.fechaFin.toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' }) }))
  const serieDe = (filtro: (c: { paisId: string; areaId: string | null }) => boolean) =>
    ciclosOrden.map(({ id }) => {
      const notas = historicosTodos.filter((r) => r.ciclo.id === id && filtro(r.colaborador)).map((r) => vigente(r)!)
      return notas.length > 0 ? Number(media(notas)!.toFixed(2)) : null
    })

  const lado = (g: Grupo, filtro: (c: { paisId: string; areaId: string | null }) => boolean): LadoComparacion => {
    const propios = resultados.filter((r) => filtro(r.colaborador))
    const notas = propios.map((r) => vigente(r)!)
    const previosPropios = previos.filter((r) => filtro(r.colaborador))
    return {
      nombre: nombreDe(g),
      n: notas.length,
      promedio: media(notas),
      mediana: mediana(notas),
      sigma: desviacion(notas),
      alto: notas.filter((v) => v >= 4).length,
      bajo: notas.filter((v) => v < 3).length,
      curva: curvaNormal(notas),
      media: media(notas),
      serieEvolucion: serieDe(filtro),
      dims: dimensiones.map((d) => {
        const actual = media(propios.map((r) => notaDim(r.desgloseDimJson, d.id)).filter((v): v is number => v !== null))
        const antes = media(previosPropios.map((r) => notaDim(r.desgloseDimJson, d.id)).filter((v): v is number => v !== null))
        return {
          nombre: d.nombre,
          actual: actual !== null ? Number(actual.toFixed(2)) : null,
          delta: actual !== null && antes !== null ? Number((actual - antes).toFixed(2)) : null,
        }
      }),
    }
  }

  const a = lado(grupoA, enA)
  const b = lado(grupoB, enB)
  const personasA = resultados.filter((r) => enA(r.colaborador)).map((r) => ({ nombre: `${r.colaborador.nombres} ${r.colaborador.apellidos}`, nota: vigente(r)! }))
  const personasB = resultados.filter((r) => enB(r.colaborador)).map((r) => ({ nombre: `${r.colaborador.nombres} ${r.colaborador.apellidos}`, nota: vigente(r)! }))
  const { bins, personasPorBin } = binsApilados(personasA, personasB)

  // Organización: alcance completo del observador. La curva se re-escala a nA+nB
  // (patrón curvaRef del análisis) para comparar la FORMA sin aplastar a los grupos.
  const notasOrg = resultados.map((r) => vigente(r)!)
  const perfilPorPuesto = await perfilesEsperados(resultados.map((r) => r.colaborador.puestoId).filter((p): p is string => p !== null))
  const esperadoDim = esperadoDeCorte(resultados.map((r) => r.colaborador.puestoId), perfilPorPuesto, dimensiones.map((d) => d.id))

  return {
    a,
    b,
    bins,
    personasPorBin,
    organizacion: {
      n: notasOrg.length,
      curva: curvaNormal(notasOrg, 1, 5, 0.5, 60, a.n + b.n),
      serieEvolucion: serieDe(() => true),
      esperadoDim: esperadoDim.map((v) => (v !== null ? Number(v.toFixed(2)) : null)),
    },
    ciclosOrden,
    dimensiones: dimensiones.map((d) => d.nombre),
    anteriorNombre: anterior?.nombre ?? null,
  }
}

export type ComparacionCiclo = Awaited<ReturnType<typeof comparacionCiclo>>
```

Nota: `LadoComparacion` se declara como `type` exportado ANTES de `comparacionCiclo` (la firma del Interfaces block de arriba, copiada literal).

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit` → limpio. `npx vitest run` → 146 verdes.

- [ ] **Step 3: Smoke contra el clone local (script efímero)**

Crear `prisma/smoke-comparacion.ts` (NO commitear):

```ts
import { prisma } from '../src/shared/lib/prisma'
import { comparacionCiclo } from '../src/features/resultados/comparacion'

async function main() {
  const ciclo = await prisma.ciclo.findFirstOrThrow({ where: { resultados: { some: { notaFinal: { not: null } } } }, orderBy: { fechaInicio: 'desc' } })
  const paises = await prisma.pais.findMany({ take: 2 })
  const area = await prisma.area.findFirst()
  const r = await comparacionCiclo(ciclo.id, {}, { paisId: paises[0].id, areaId: area?.id }, { paisId: paises[1]?.id ?? paises[0].id })
  console.log(JSON.stringify({ a: { nombre: r.a.nombre, n: r.a.n, promedio: r.a.promedio }, b: { nombre: r.b.nombre, n: r.b.n }, binsTotal: r.bins.reduce((s, x) => s + x.nA + x.nB, 0), org: r.organizacion.n, esperado: r.organizacion.esperadoDim, ciclos: r.ciclosOrden.length }, null, 2))
}
main().finally(() => prisma.$disconnect())
```

Run: `npx tsx prisma/smoke-comparacion.ts`
Expected: JSON con `a.n + b.n === binsTotal`, `org` ≥ ambos, `esperado` con números (o null si no hay perfiles), sin excepciones. Luego `rm prisma/smoke-comparacion.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/features/resultados/comparacion.ts
git commit -m "feat(comparacion): comparacionCiclo — agregación de dos grupos + organización

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Componentes visuales comparativos

**Files:**
- Modify: `src/shared/ui/RadarDimensiones.tsx` (polígono B opcional)
- Create: `src/features/resultados/HistogramaComparativo.tsx`
- Create: `src/features/resultados/ComparacionUI.tsx`
- Create: `src/features/resultados/SelectorComparacion.tsx`

**Interfaces:**
- Consumes: `COLOR_A/COLOR_B/COLOR_ORG` de `./colores`; `PersonaBin` de `./comparacion`; `Combobox` de `@/shared/ui/Combobox`; `Card`, `Vacio` de `@/shared/ui/componentes` (solo en Task 5); icono `Columns2` de `lucide-react`.
- Produces (Task 5 consume estas firmas EXACTAS):
  - `DimRadar` gana `valorB?: number | null` (retrocompatible; nadie más lo pasa).
  - `HistogramaComparativo({ bins, personasPorBin, curvaA, curvaB, curvaOrg, mediaA, mediaB, nombreA, nombreB, alto? })`
  - `LeyendaComparacion({ nombreA, nA, nombreB, nB, nOrg })`
  - `KpisComparativos({ a, b })` con `a/b: { nombre: string; n: number; promedio: number | null; alto: number; bajo: number }`
  - `EvolucionComparada({ ciclos: { cierre: string }[], series: { color: string; dash?: boolean; etiquetas?: 'arriba' | 'abajo'; puntos: (number | null)[] }[], alto?, ancho? })`
  - `BarrasDeltaComparadas({ items: { nombre: string; actualA: number | null; deltaA: number | null; actualB: number | null; deltaB: number | null }[], nombreA, nombreB, anteriorNombre })`
  - `SelectorComparacion({ cicloId, esRegional, paisFijo, paises, areasPorPais, activa, inicial })` — ver Step 4.

- [ ] **Step 1: `RadarDimensiones.tsx` — segundo polígono opcional**

En `DimRadar` añadir el campo:

```ts
export type DimRadar = {
  nombre: string
  color: string
  valor: number | null // serie pintada (1–5); null = sin dato (queda al centro, sin punto)
  esperado?: number // serie gris al fondo (perfil requerido del puesto)
  valorB?: number | null // segunda serie (azul) — vista comparativa
}
```

Debajo de `const hayEsperado = …` añadir `const hayB = dims.some((d) => d.valorB !== undefined && d.valorB !== null)`, y entre el polígono esperado y el principal (después de la línea del `{hayEsperado && …}`) insertar:

```tsx
      {hayB && (
        <polygon points={poligono((i) => radioDe(dims[i].valorB))} fill="#0284c7" fillOpacity={0.14} stroke="#0284c7" strokeWidth={1.6} strokeLinejoin="round" />
      )}
```

Y después del bloque de puntos de la serie principal (`{dims.map((d, i) => { if (d.valor === null) … circle …})}`) añadir los puntos de B:

```tsx
      {hayB && dims.map((d, i) => {
        if (d.valorB === null || d.valorB === undefined) return null
        const [x, y] = punto(i, radioDe(d.valorB))
        return <circle key={`b${i}`} cx={x} cy={y} r={3} fill="#0284c7" stroke="#fff" strokeWidth={1.2} />
      })}
```

(El hex `#0284c7` va literal aquí — el SVG comparte archivo con la paleta categórica existente que también usa hex literales.)

- [ ] **Step 2: `HistogramaComparativo.tsx`** (client — barras apiladas + 3 curvas + clic)

```tsx
'use client'

import { useState } from 'react'
import { COLOR_A, COLOR_B, COLOR_ORG } from './colores'
import type { PersonaBin } from './comparacion'

/** Distribución comparativa: barras APILADAS por grupo (A abajo, B encima), curvas
 * normales de cada grupo y la de la organización punteada (re-escalada a nA+nB).
 * Clic en una barra → panel con las personas del rango y el punto de color de su grupo. */
export function HistogramaComparativo({ bins, personasPorBin, curvaA, curvaB, curvaOrg, mediaA, mediaB, nombreA, nombreB, alto = 190 }: {
  bins: { desde: number; hasta: number; nA: number; nB: number }[]
  personasPorBin: PersonaBin[][]
  curvaA: { x: number; y: number }[]
  curvaB: { x: number; y: number }[]
  curvaOrg: { x: number; y: number }[]
  mediaA: number | null
  mediaB: number | null
  nombreA: string
  nombreB: string
  alto?: number
}) {
  const [activo, setActivo] = useState<number | null>(null)
  const W = 560, H = alto, PAD = 24
  const total = (b: { nA: number; nB: number }) => b.nA + b.nB
  const maxN = Math.max(1, ...bins.map(total), ...curvaA.map((p) => p.y), ...curvaB.map((p) => p.y), ...curvaOrg.map((p) => p.y))
  const x = (v: number) => PAD + ((v - 1) / 4) * (W - PAD * 2)
  const y = (n: number) => H - 18 - (n / maxN) * (H - 34)
  const anchoBin = ((W - PAD * 2) / bins.length) * 0.86
  const bin = activo !== null ? bins[activo] : null
  const personas = activo !== null ? personasPorBin[activo] ?? [] : []
  const linea = (pts: { x: number; y: number }[], color: string, dash?: string) =>
    pts.length > 0 && (
      <polyline points={pts.map((p) => `${x(p.x)},${y(p.y)}`).join(' ')} fill="none" stroke={color} strokeWidth={1.6} strokeDasharray={dash} className="pointer-events-none" opacity={dash ? 0.65 : 0.9} />
    )

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {bins.map((b, i) => (
          <g key={b.desde} onClick={() => setActivo(activo === i ? null : i)} className={total(b) > 0 ? 'cursor-pointer' : undefined}>
            <rect x={x(b.desde)} y={12} width={anchoBin + 4} height={H - 30} fill="transparent" />
            {b.nA > 0 && (
              <rect x={x(b.desde) + 2} y={y(b.nA)} width={anchoBin} height={H - 18 - y(b.nA)} rx={3} fill={COLOR_A} opacity={activo === i ? 0.55 : 0.35} />
            )}
            {b.nB > 0 && (
              <rect x={x(b.desde) + 2} y={y(total(b))} width={anchoBin} height={y(b.nA) - y(total(b)) - (b.nA > 0 ? 1.5 : 0)} rx={3} fill={COLOR_B} opacity={activo === i ? 0.55 : 0.35} />
            )}
            {total(b) > 0 && (
              <text x={x(b.desde) + 2 + anchoBin / 2} y={y(total(b)) - 4} textAnchor="middle" className="fill-negro text-[9px] font-bold">{total(b)}</text>
            )}
          </g>
        ))}
        {linea(curvaOrg, COLOR_ORG, '6 4')}
        {linea(curvaA, COLOR_A)}
        {linea(curvaB, COLOR_B)}
        {mediaA !== null && (
          <g className="pointer-events-none">
            <line x1={x(mediaA)} x2={x(mediaA)} y1={12} y2={H - 18} stroke={COLOR_A} strokeWidth={1.3} strokeDasharray="4 3" />
            <text x={x(mediaA)} y={9} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={COLOR_A}>x̄ {mediaA.toFixed(2)}</text>
          </g>
        )}
        {mediaB !== null && (
          <g className="pointer-events-none">
            <line x1={x(mediaB)} x2={x(mediaB)} y1={16} y2={H - 18} stroke={COLOR_B} strokeWidth={1.3} strokeDasharray="4 3" />
            <text x={x(mediaB)} y={H - 22} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={COLOR_B}>x̄ {mediaB.toFixed(2)}</text>
          </g>
        )}
        {[1, 2, 3, 4, 5].map((v) => (
          <text key={v} x={x(v)} y={H - 5} textAnchor="middle" className="fill-negro/50 text-[9.5px]">{v.toFixed(1)}</text>
        ))}
      </svg>

      {bin && personas.length > 0 && (
        <div className="mt-3 rounded-xl border border-gris-claro bg-hueso/40 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-gris">
              Notas {bin.desde.toFixed(2)} – {bin.hasta.toFixed(2)} · {personas.length} persona{personas.length === 1 ? '' : 's'}
            </p>
            <button onClick={() => setActivo(null)} title="Cerrar" className="grid h-6 w-6 place-items-center rounded-lg text-xs text-gris transition hover:bg-hueso hover:text-negro">✕</button>
          </div>
          <ul className="grid max-h-56 gap-x-6 gap-y-1 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
            {personas.map((p) => (
              <li key={`${p.grupo}-${p.nombre}`} title={p.grupo === 'A' ? nombreA : nombreB} className="flex items-center justify-between gap-2 border-b border-hueso-2 py-1 text-[12.5px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.grupo === 'A' ? COLOR_A : COLOR_B }} />
                  <span className="truncate font-semibold">{p.nombre}</span>
                </span>
                <span className="shrink-0 font-bold" style={{ color: p.grupo === 'A' ? COLOR_A : COLOR_B }}>{p.nota.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: `ComparacionUI.tsx`** (server-safe: SVG y markup puros)

```tsx
import { COLOR_A, COLOR_B, COLOR_ORG } from './colores'

/** Piezas server-rendered de la vista comparativa: leyenda global, scorecards duales,
 * evolución de 3 líneas y variación por dimensión con dos barras (una por grupo). */

export function LeyendaComparacion({ nombreA, nA, nombreB, nB, nOrg }: { nombreA: string; nA: number; nombreB: string; nB: number; nOrg: number }) {
  const item = (color: string, texto: string, dash = false) => (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold">
      {dash ? (
        <svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke={color} strokeWidth="2" strokeDasharray="5 3" /></svg>
      ) : (
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      )}
      {texto}
    </span>
  )
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-gris-claro bg-white px-5 py-3">
      {item(COLOR_A, `${nombreA} · ${nA} evaluado${nA === 1 ? '' : 's'}`)}
      {item(COLOR_B, `${nombreB} · ${nB} evaluado${nB === 1 ? '' : 's'}`)}
      {item(COLOR_ORG, `Organización · ${nOrg}`, true)}
    </div>
  )
}

type LadoKpi = { nombre: string; n: number; promedio: number | null; alto: number; bajo: number }

export function KpisComparativos({ a, b }: { a: LadoKpi; b: LadoKpi }) {
  const pct = (parte: number, n: number) => (n === 0 ? '—' : `${Math.round((parte / n) * 100)}%`)
  const dual = (va: string, vb: string) => (
    <p className="flex items-baseline justify-center gap-2 font-display text-2xl font-bold">
      <span style={{ color: COLOR_A }}>{va}</span>
      <span className="text-sm font-semibold text-gris">vs</span>
      <span style={{ color: COLOR_B }}>{vb}</span>
    </p>
  )
  const tarjetas = [
    { titulo: 'Nota promedio', cuerpo: dual(a.promedio?.toFixed(2) ?? '—', b.promedio?.toFixed(2) ?? '—'), sub: 'nota final vigente' },
    { titulo: 'Evaluados', cuerpo: dual(String(a.n), String(b.n)), sub: 'con resultado en el ciclo' },
    { titulo: 'Desempeño destacado', cuerpo: dual(pct(a.alto, a.n), pct(b.alto, b.n)), sub: `nota ≥ 4.0 · ${a.alto} vs ${b.alto}` },
    { titulo: 'En zona de atención', cuerpo: dual(pct(a.bajo, a.n), pct(b.bajo, b.n)), sub: `nota < 3.0 · ${a.bajo} vs ${b.bajo}` },
  ]
  return (
    <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {tarjetas.map((t) => (
        <div key={t.titulo} className="rounded-2xl border border-gris-claro bg-white px-5 py-5 text-center">
          {t.cuerpo}
          <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-gris">{t.titulo}</p>
          <p className="mt-0.5 text-[11px] font-semibold text-gris">{t.sub}</p>
        </div>
      ))}
    </div>
  )
}

/** Evolución multi-serie: líneas de color (con puntos y valores) + punteadas (referencia).
 * Los puntos null se saltan (el grupo no tiene datos en ese ciclo). */
export function EvolucionComparada({ ciclos, series, alto = 210, ancho = 1120 }: {
  ciclos: { cierre: string }[]
  series: { color: string; dash?: boolean; etiquetas?: 'arriba' | 'abajo'; puntos: (number | null)[] }[]
  alto?: number
  ancho?: number
}) {
  const W = ancho, H = alto, PAD = Math.max(30, W * 0.05)
  const valores = series.flatMap((s) => s.puntos.filter((v): v is number => v !== null))
  if (ciclos.length === 0 || valores.length === 0) return <p className="text-xs text-gris">Sin ciclos con resultados para graficar.</p>
  const min = Math.max(1, Math.min(...valores) - 0.4)
  const max = Math.min(5, Math.max(...valores) + 0.4)
  const x = (i: number) => (ciclos.length === 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (ciclos.length - 1))
  const y = (v: number) => H - 30 - ((v - min) / Math.max(0.01, max - min)) * (H - 58)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {series.map((s, si) => {
        const pts = s.puntos.map((v, i) => (v === null ? null : { i, v })).filter((p): p is { i: number; v: number } => p !== null)
        if (pts.length === 0) return null
        return (
          <g key={si}>
            <polyline points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={s.dash ? 1.6 : 2} strokeDasharray={s.dash ? '6 4' : undefined} opacity={s.dash ? 0.65 : 1} />
            {!s.dash && pts.map((p) => (
              <g key={p.i}>
                <circle cx={x(p.i)} cy={y(p.v)} r={3.5} fill={s.color} />
                {s.etiquetas && (
                  <text x={x(p.i)} y={s.etiquetas === 'arriba' ? y(p.v) - 8 : y(p.v) + 15} textAnchor="middle" fontSize={10} fontWeight={700} fill={s.color}>{p.v.toFixed(2)}</text>
                )}
              </g>
            ))}
          </g>
        )
      })}
      {ciclos.map((c, i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-negro/55 text-[9px]">{c.cierre}</text>
      ))}
    </svg>
  )
}

/** Variación por dimensión con dos barras (una por grupo): cambio vs el ciclo anterior. */
export function BarrasDeltaComparadas({ items, nombreA, nombreB, anteriorNombre }: {
  items: { nombre: string; actualA: number | null; deltaA: number | null; actualB: number | null; deltaB: number | null }[]
  nombreA: string
  nombreB: string
  anteriorNombre: string | null
}) {
  const conDato = items.filter((i) => i.deltaA !== null || i.deltaB !== null)
  if (!anteriorNombre || conDato.length === 0) return <p className="text-xs text-gris">Sin ciclo anterior para comparar el cambio por dimensión.</p>
  const W = 560, filaH = 46, PAD_TOP = 6
  const H = PAD_TOP + conDato.length * filaH + 16
  const maxD = Math.max(0.2, ...conDato.flatMap((i) => [Math.abs(i.deltaA ?? 0), Math.abs(i.deltaB ?? 0)]))
  const cx = 265
  const ancho = (d: number) => (Math.abs(d) / maxD) * 105
  const barra = (yBase: number, delta: number | null, actual: number | null, color: string) => {
    if (delta === null) return <text x={cx + 8} y={yBase + 10} fill="#8a857f" fontSize={9.5}>sin dato</text>
    if (Math.abs(delta) < 0.005) return <text x={cx + 8} y={yBase + 10} fill="#8a857f" fontSize={9.5}>= igual{actual !== null ? ` · ${actual.toFixed(2)}` : ''}</text>
    const positivo = delta > 0
    const w = ancho(delta)
    return (
      <>
        <rect x={positivo ? cx : cx - w} y={yBase} width={Math.max(3, w)} height={11} rx={3} fill={color} opacity={0.45} />
        <text x={positivo ? cx + w + 6 : cx + 8} y={yBase + 10} fontWeight={700} fontSize={10} fill={color}>
          {positivo ? '+' : '−'}{Math.abs(delta).toFixed(2)}{actual !== null ? ` → ${actual.toFixed(2)}` : ''}
        </text>
      </>
    )
  }
  let yAcum = PAD_TOP
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <line x1={cx} y1={PAD_TOP} x2={cx} y2={H - 14} className="stroke-negro/60" strokeWidth={1.2} />
      {conDato.map((i) => {
        const yFila = yAcum
        yAcum += filaH
        return (
          <g key={i.nombre} fontSize={11.5}>
            <text x={4} y={yFila + 14} fontWeight={700} className="fill-negro">
              {i.nombre.length > 26 ? i.nombre.slice(0, 24) + '…' : i.nombre}
            </text>
            {barra(yFila + 4, i.deltaA, i.actualA, COLOR_A)}
            {barra(yFila + 20, i.deltaB, i.actualB, COLOR_B)}
          </g>
        )
      })}
      <text x={cx} y={H - 2} textAnchor="middle" fontSize={9} className="fill-negro/40">← retrocede · avanza → · {nombreA} arriba, {nombreB} abajo</text>
    </svg>
  )
}
```

- [ ] **Step 4: `SelectorComparacion.tsx`** (client — botón + panel de grupos)

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Columns2 } from 'lucide-react'
import { Combobox } from '@/shared/ui/Combobox'
import { COLOR_A, COLOR_B } from './colores'

type Opcion = { id: string; nombre: string }

/** Botón «Vista comparativa» + panel para elegir Grupo A (país + área) vs Grupo B.
 * Emite un GET con comparar=1&aPais&aArea&bPais&bArea (+ ciclo): la página valida
 * los grupos en el servidor y renderiza el modo comparación. Sin área = país completo.
 * RRHH-país: el país queda fijo al suyo (solo elige áreas). */
export function SelectorComparacion({ cicloId, esRegional, paisFijo, paises, areasPorPais, activa, inicial }: {
  cicloId: string
  esRegional: boolean
  paisFijo: Opcion | null // país del observador cuando NO es Regional
  paises: Opcion[] // países del alcance CON evaluados en el ciclo
  areasPorPais: Record<string, Opcion[]> // áreas CON evaluados en el ciclo, por país
  activa: boolean
  inicial: { aPais: string; aArea: string; bPais: string; bArea: string }
}) {
  const [abierto, setAbierto] = useState(false)
  const [aPais, setAPais] = useState(inicial.aPais || paisFijo?.id || '')
  const [bPais, setBPais] = useState(inicial.bPais || paisFijo?.id || '')

  const ladoUI = (rotulo: string, color: string, pais: string, setPais: (v: string) => void, namePais: string, nameArea: string, areaInicial: string) => (
    <div className="min-w-0 flex-1 space-y-2">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-gris">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} /> {rotulo}
      </p>
      {esRegional ? (
        <Combobox name={namePais} opciones={paises} valorInicial={pais} textoVacio="Elige un país" onChange={setPais} />
      ) : (
        <>
          <input type="hidden" name={namePais} value={paisFijo?.id ?? ''} />
          <p className="rounded-lg border border-gris-claro bg-hueso px-3 py-1.5 text-sm text-negro/70">{paisFijo?.nombre}</p>
        </>
      )}
      <Combobox name={nameArea} opciones={areasPorPais[pais] ?? []} valorInicial={areaInicial} textoVacio="Todas las áreas" />
    </div>
  )

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 font-display text-[13px] font-bold transition ${activa ? 'bg-negro text-white' : 'border border-gris-claro bg-white hover:bg-hueso'}`}
      >
        <Columns2 size={15} /> Vista comparativa
      </button>

      {abierto && (
        <form method="get" className="absolute right-0 top-full z-40 mt-2 w-[540px] max-w-[92vw] rounded-2xl border border-gris-claro bg-white p-4 shadow-xl">
          <input type="hidden" name="ciclo" value={cicloId} />
          <input type="hidden" name="comparar" value="1" />
          <div className="flex flex-wrap gap-4">
            {ladoUI('Grupo A', COLOR_A, aPais, setAPais, 'aPais', 'aArea', inicial.aArea)}
            {ladoUI('Grupo B', COLOR_B, bPais, setBPais, 'bPais', 'bArea', inicial.bArea)}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-[11px] text-gris">Sin área = el país completo. Solo aparecen áreas con evaluados en el ciclo.</p>
            <div className="flex items-center gap-2">
              {activa && (
                <Link href={`/admin/resultados/analisis?ciclo=${cicloId}`} className="rounded-xl border border-gris-claro px-3.5 py-2 text-[13px] font-bold transition hover:bg-hueso">
                  Salir de la comparación
                </Link>
              )}
              <button className="rounded-xl bg-hunter px-4 py-2 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark">Comparar</button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Verificar y commitear**

Run: `npx tsc --noEmit` → limpio. `npx vitest run` → 146 verdes.

```bash
git add src/shared/ui/RadarDimensiones.tsx src/features/resultados/HistogramaComparativo.tsx src/features/resultados/ComparacionUI.tsx src/features/resultados/SelectorComparacion.tsx
git commit -m "feat(comparacion): componentes visuales de la vista comparativa

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Integración en la página + verificación E2E

**Files:**
- Modify: `src/app/(app)/admin/resultados/analisis/page.tsx`

**Interfaces:**
- Consumes: TODO lo producido por Tasks 1-4 (firmas literales de sus bloques Interfaces); `alcancePaisWhere(sesion, paisSeleccionado): { paisId?: string }` y `requiereAdmin('RESULTADOS', 'VER')` existentes.
- Produces: la página final — sin consumidores posteriores.

- [ ] **Step 1: Imports y parseo de parámetros**

En `page.tsx`, añadir a los imports:

```tsx
import { validarGrupos, comparacionCiclo } from '@/features/resultados/comparacion'
import { SelectorComparacion } from '@/features/resultados/SelectorComparacion'
import { HistogramaComparativo } from '@/features/resultados/HistogramaComparativo'
import { LeyendaComparacion, KpisComparativos, EvolucionComparada, BarrasDeltaComparadas } from '@/features/resultados/ComparacionUI'
import { COLOR_A, COLOR_B, COLOR_ORG } from '@/features/resultados/colores'
```

Ampliar la firma de `searchParams`:

```tsx
  searchParams: Promise<{ ciclo?: string; area?: string; nivel?: string; pais?: string; comparar?: string; aPais?: string; aArea?: string; bPais?: string; bArea?: string }>
```

y el destructuring: `const { ciclo: cicloParam, area: areaParam, nivel: nivelParam, pais: paisParam, comparar, aPais, aArea, bPais, bArea } = await searchParams`.

- [ ] **Step 2: Datos del selector + validación de grupos (tras calcular `filtros`, antes de `analisisCiclo`)**

```tsx
  // Vista comparativa: países/áreas CON evaluados en el ciclo (dentro del alcance) para
  // el selector, y validación server-side de los grupos que llegan por URL.
  const cortes = await prisma.resultado.findMany({
    where: { cicloId: ciclo.id, notaFinal: { not: null }, colaborador: { is: { ...wherePais } } },
    select: { colaborador: { select: { pais: { select: { id: true, nombre: true } }, area: { select: { id: true, nombre: true } } } } },
  })
  const paisesCiclo = [...new Map(cortes.map((r) => [r.colaborador.pais.id, r.colaborador.pais])).values()].sort((x, y) => x.nombre.localeCompare(y.nombre))
  const areasPorPais: Record<string, { id: string; nombre: string }[]> = {}
  for (const r of cortes) {
    if (!r.colaborador.area) continue
    const lista = (areasPorPais[r.colaborador.pais.id] ??= [])
    if (!lista.some((x) => x.id === r.colaborador.area!.id)) lista.push(r.colaborador.area)
  }
  for (const lista of Object.values(areasPorPais)) lista.sort((x, y) => x.nombre.localeCompare(y.nombre))

  const paisFijo = !esRegional ? paisesCiclo.find((p) => p.id === wherePais.paisId) ?? null : null
  const grupos = comparar === '1'
    ? validarGrupos({ aPais, aArea, bPais, bArea }, {
        esRegional,
        paisSesionId: wherePais.paisId ?? null,
        paisesValidos: new Set(paisesCiclo.map((p) => p.id)),
        areasValidas: new Set(Object.values(areasPorPais).flat().map((x) => x.id)),
      })
    : null
  const comparacionActiva = grupos !== null && !grupos.identicos
  const comp = comparacionActiva ? await comparacionCiclo(ciclo.id, wherePais, grupos.grupoA, grupos.grupoB) : null
```

Nota: para RRHH-país sin evaluados de su país en el ciclo, `paisFijo` queda null y el selector muestra un panel sin opciones — coherente (no hay nada que comparar).

- [ ] **Step 3: Fila de filtros + selector (reemplaza el `<form>` actual de filtros)**

Envolver el form actual y el selector en una fila; en modo comparación solo queda el select de ciclo:

```tsx
      {/* Filtros + Vista comparativa: en comparación solo manda el ciclo (los grupos definen el corte) */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-2">
        <form className="flex flex-wrap items-center gap-2" method="get">
          {comparacionActiva && <input type="hidden" name="comparar" value="1" />}
          {comparacionActiva && <input type="hidden" name="aPais" value={aPais} />}
          {comparacionActiva && <input type="hidden" name="aArea" value={aArea ?? ''} />}
          {comparacionActiva && <input type="hidden" name="bPais" value={bPais} />}
          {comparacionActiva && <input type="hidden" name="bArea" value={bArea ?? ''} />}
          <select name="ciclo" defaultValue={ciclo.id} className={selectCls}>
            {ciclos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          {!comparacionActiva && (
            <>
              <select name="area" defaultValue={filtros.areaId ?? ''} className={selectCls}>
                <option value="">Todas las áreas</option>
                {areas.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              </select>
              <select name="nivel" defaultValue={filtros.nivelId ?? ''} className={selectCls}>
                <option value="">Todos los niveles</option>
                {niveles.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              </select>
              {esRegional && (
                <select name="pais" defaultValue={filtros.paisId ?? ''} className={selectCls}>
                  <option value="">Todos los países</option>
                  {paises.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                </select>
              )}
            </>
          )}
          <button className="rounded-xl bg-negro px-4 py-2 text-sm font-bold text-white transition hover:bg-negro/80">Aplicar</button>
        </form>
        <SelectorComparacion
          cicloId={ciclo.id}
          esRegional={esRegional}
          paisFijo={paisFijo}
          paises={paisesCiclo}
          areasPorPais={areasPorPais}
          activa={comparacionActiva}
          inicial={{ aPais: aPais ?? '', aArea: aArea ?? '', bPais: bPais ?? '', bArea: bArea ?? '' }}
        />
      </div>
      {grupos?.identicos && (
        <p className="mb-5 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">Elige dos grupos distintos para comparar.</p>
      )}
```

- [ ] **Step 4: Rama comparativa del cuerpo**

Después de la fila de filtros, envolver TODO el cuerpo actual (KPIs → últimas cards) en `{!comparacionActiva && (<> … </>)}` sin tocar su contenido, y añadir la rama comparativa:

```tsx
      {comparacionActiva && comp && (
        <>
          <LeyendaComparacion nombreA={comp.a.nombre} nA={comp.a.n} nombreB={comp.b.nombre} nB={comp.b.n} nOrg={comp.organizacion.n} />
          {comp.a.n === 0 && <p className="mb-4 rounded-xl px-3.5 py-2.5 text-sm" style={{ background: '#fef2f2', color: COLOR_A }}>{comp.a.nombre}: sin evaluados en este ciclo.</p>}
          {comp.b.n === 0 && <p className="mb-4 rounded-xl px-3.5 py-2.5 text-sm" style={{ background: '#f0f9ff', color: COLOR_B }}>{comp.b.nombre}: sin evaluados en este ciclo.</p>}
          <KpisComparativos a={comp.a} b={comp.b} />

          <Card
            titulo="Distribución de notas"
            ayuda="Cuántas personas de cada grupo caen en cada rango de nota (barras apiladas por color) con la curva normal de cada grupo; la punteada gris es la organización, re-escalada al tamaño de los grupos para comparar la forma. Haz clic en un rango para ver quiénes están."
            extra={`${comp.a.nombre} vs ${comp.b.nombre} · organización de referencia`}
          >
            {comp.a.n + comp.b.n === 0 ? (
              <Vacio>Ninguno de los dos grupos tiene evaluados en este ciclo.</Vacio>
            ) : (
              <HistogramaComparativo
                bins={comp.bins}
                personasPorBin={comp.personasPorBin}
                curvaA={comp.a.curva}
                curvaB={comp.b.curva}
                curvaOrg={comp.organizacion.curva}
                mediaA={comp.a.media}
                mediaB={comp.b.media}
                nombreA={comp.a.nombre}
                nombreB={comp.b.nombre}
              />
            )}
          </Card>

          <Card className="mt-5" titulo="Evolución entre ciclos" ayuda="Promedio de cada grupo en los ciclos cerrados, con la organización punteada como referencia. Un grupo sin evaluados en un ciclo salta ese punto." extra="nota promedio por ciclo">
            <EvolucionComparada
              ciclos={comp.ciclosOrden}
              series={[
                { color: COLOR_ORG, dash: true, puntos: comp.organizacion.serieEvolucion },
                { color: COLOR_A, etiquetas: 'arriba', puntos: comp.a.serieEvolucion },
                { color: COLOR_B, etiquetas: 'abajo', puntos: comp.b.serieEvolucion },
              ]}
            />
          </Card>

          <Card className="mt-5" titulo="Comparación por dimensión" ayuda="Radar con el promedio de cada grupo por dimensión; el punteado gris es el perfil esperado de la organización (la expectativa definida en los puestos). Las barras miden el cambio de cada grupo vs el ciclo anterior." extra={`${comp.a.nombre} (rojo) vs ${comp.b.nombre} (azul) · esperado organización (punteado)`}>
            <div className="grid items-center gap-8 lg:grid-cols-[3fr_2fr]">
              <div className="mx-auto w-full max-w-2xl">
                <RadarDimensiones
                  ariaLabel="Radar por dimensión: grupo A vs grupo B vs esperado de la organización"
                  dims={comp.a.dims.map((d, i) => ({
                    nombre: d.nombre,
                    color: colorDim(i),
                    valor: d.actual,
                    valorB: comp.b.dims[i]?.actual ?? null,
                    esperado: comp.organizacion.esperadoDim[i] ?? undefined,
                  }))}
                />
              </div>
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gris">Cambio vs {comp.anteriorNombre ?? 'ciclo anterior'}</p>
                <BarrasDeltaComparadas
                  items={comp.dimensiones.map((nombre, i) => ({
                    nombre,
                    actualA: comp.a.dims[i]?.actual ?? null,
                    deltaA: comp.a.dims[i]?.delta ?? null,
                    actualB: comp.b.dims[i]?.actual ?? null,
                    deltaB: comp.b.dims[i]?.delta ?? null,
                  }))}
                  nombreA={comp.a.nombre}
                  nombreB={comp.b.nombre}
                  anteriorNombre={comp.anteriorNombre}
                />
              </div>
            </div>
          </Card>
        </>
      )}
```

Con esto quedan ocultas en comparación (por la rama `!comparacionActiva`): Puntos de acción, Pain points, las 4 alertas, el histograma normal, la evolución normal con su expandible y el radar normal — exactamente la lista del spec §7.

- [ ] **Step 5: Verificación completa**

1. `npx tsc --noEmit` limpio; `npx vitest run` → 146 verdes.
2. E2E visual con Playwright en `localhost:3001` (sesión Regional del clone):
   - Vista normal intacta + radar con esperado punteado.
   - Abrir «Vista comparativa», elegir dos grupos (en el clone: Perú · Recursos Humanos vs Chile completo), «Comparar» → leyenda, KPIs duales, distribución apilada (clic en barra → panel con puntos de color), evolución 3 líneas, radar A/B/esperado, variación con dos barras; secciones diagnósticas AUSENTES; filtros de área/nivel/país ocultos.
   - Grupos idénticos → aviso «Elige dos grupos distintos para comparar.» y vista normal debajo.
   - URL manipulada con `aPais` inexistente → vista normal sin error.
   - «Salir de la comparación» → vista normal con el mismo ciclo.
3. Screenshots de cada estado para revisión de Christian.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/admin/resultados/analisis/page.tsx"
git commit -m "feat(analitica): vista comparativa de grupos (país + área) en Análisis del ciclo

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review (ejecutada)

- **Cobertura del spec**: activación/selector (T4-T5), 2 grupos país+área opcional (T1 validarGrupos, T5), combobox con áreas-con-evaluados (T5 Step 2), colores/leyenda (T1 colores.ts, T4), KPIs duales (T4), distribución apilada+curvas+clic (T3-T4), evolución 3 líneas sin expandible (T4-T5), radar esperado en AMBAS vistas (T2 normal, T5 comparativa), variación 2 barras por dimensión (T4-T5), ocultamiento de secciones y filtros (T5 Step 3-4), validación de alcance server-side (T1+T5), bordes (idénticos/vacíos/URL inválida/sin anterior/sin esperado → T5 y `hayEsperado` existente), tests unit (T1) + E2E (T5). Sin gaps.
- **Placeholders**: ninguno — todo el código está completo en los steps.
- **Consistencia de tipos**: `LadoComparacion` (T3) alimenta `KpisComparativos`/`HistogramaComparativo`/`EvolucionComparada`/`BarrasDeltaComparadas` (T4) con los nombres usados en T5; `PersonaBin` compartido T1→T4; `valorB` definido en T4 y consumido en T5; `validarGrupos` firma idéntica T1↔T5.
