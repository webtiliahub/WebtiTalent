# Alcance flexible de ciclos de evaluación — Diseño

**Fecha:** 2026-08-04
**Estado:** Aprobado por Christian (diseño validado en conversación)

## Problema

Hoy el alcance de un ciclo es un solo campo (`Ciclo.paisId`, null = todos los países) elegido con chips en el paso 2 del wizard. Hunter necesita acotar ciclos con más precisión: por país, por área o áreas, por nivel jerárquico (mando medio, especialista, apoyo — el catálogo de Configuración que además decide qué formulario aplica) y por grupo de personas específico, de forma **combinable** (ej. «Chile + área Comercial + solo mando medio, sin Fulano, con Mengana de Perú»).

## Decisiones de producto (validadas con Christian)

1. **Dimensiones combinables** (no modos excluyentes): dentro de una dimensión, cualquiera de los elegidos (OR); entre dimensiones, se exigen todas (AND); dimensión vacía = todos. Misma semántica que el foco de objetivos transversales, que el equipo ya conoce.
2. **Jerarquía = niveles del catálogo** (`Nivel`), no árbol de mando bajo un jefe.
3. **Grupo de personas** = ajustes manuales sobre los filtros con un buscador multiselect y lista previa: se puede **excluir** a alguien que cumple los filtros y **sumar** a alguien que no los cumple — siempre dentro de los países del foco (ver «El país es el techo del alcance» más abajo).
4. **Lista previa editable** en el paso Alcance: los filtros arman la base, los ajustes la afinan; el alcance final es lo que queda en la lista.
5. La dimensión «puestos» queda FUERA de este alcance (no pedida; el patrón permite agregarla luego).

**Decisión de Christian 04/08: el país es el techo del alcance; los ajustes manuales no cruzan países.** Si se lanza una evaluación solo para Perú, solo pueden ser evaluados colaboradores de Perú; para evaluar colaboradores de distintos países, el foco de países tiene que cubrirlos. Los ajustes manuales (`incluirIds`) pueden saltar los filtros de área/nivel, pero **nunca** la dimensión país: un incluido de un país fuera del foco se rechaza (motivo `FUERA_DE_PAIS`), tanto en el resolutor (preview) como al persistir (`validarAlcanceCiclo`). Los `excluirIds` cross-país siguen siendo inocuos (excluir a alguien que ya está fuera del alcance no hace nada).

## Modelo de datos

Migración **aditiva** sobre `Ciclo` (sin renombres ni drops; `prisma db push` seguro):

```prisma
model Ciclo {
  // ... campos existentes sin cambios, salvo la semántica de paisId:
  paisId       String?   // DERIVADO: país único del alcance (null = multi-país/todos).
                         // Lo recalcula el server al guardar borrador. Cierre por país,
                         // congelamiento y cicloFueraDeAlcance lo consumen igual que hoy.
  focoPaisIds  String[]  @default([])
  focoAreaIds  String[]  @default([])
  focoNivelIds String[]  @default([])
  incluirIds   String[]  @default([]) // colaboradorIds sumados fuera de los filtros
  excluirIds   String[]  @default([]) // colaboradorIds quitados puntualmente
}
```

- **Invariante de `paisId`:** `focoPaisIds.length === 1 ? focoPaisIds[0] : null`. Nunca se edita directo; `crearCiclo`/`editarCiclo` lo derivan. Con la decisión del 04/08 (el país es el techo del alcance), un `incluirIds` nunca puede pertenecer a un país fuera de `focoPaisIds` — se rechaza al resolver y al persistir — así que ya no puede existir un incluido de otro país «apareciendo» en el cierre de su país: todo evaluado, manual o no, está siempre dentro de los países del foco.
- **Migración de datos:** un script one-shot puebla `focoPaisIds = [paisId]` donde `paisId != null`. Los ciclos existentes ya cumplen la invariante.

## Resolutor de alcance — `src/features/ciclos/alcance.ts` (unidad pura)

Única fuente de verdad para «¿quiénes son los evaluados?». La consumen el preview del wizard, el preflight y `lanzarCiclo` — así el preview nunca promete algo distinto de lo que el lanzamiento genera.

```ts
export type FocoCiclo = { focoPaisIds: string[]; focoAreaIds: string[]; focoNivelIds: string[] }
export type AjustesCiclo = { incluirIds: string[]; excluirIds: string[] }
export type ColaboradorAlcance = {
  id: string; activo: boolean; fechaIngreso: Date | null
  paisId: string; areaId: string | null; nivelId: string | null // nivelId vía puesto.nivelId
}

export function cumpleFoco(foco: FocoCiclo, c: ColaboradorAlcance): boolean
// OR dentro de cada dimensión, AND entre dimensiones, vacía = todos.
// areaId/nivelId null NO cumplen una dimensión con filtro activo (igual que transversales).

export function resolverAlcance(
  colaboradores: ColaboradorAlcance[],
  foco: FocoCiclo,
  ajustes: AjustesCiclo,
  fechaInicioCiclo: Date,
): {
  evaluados: ColaboradorAlcance[]
  // Para marcar la lista previa y explicar por qué alguien no entra:
  detalle: {
    incluidosManuales: string[]      // entraron por incluirIds (no cumplían filtros)
    excluidosManuales: string[]      // cumplían filtros pero están en excluirIds
    incluidosRechazados: { id: string; motivo: 'FUERA_DE_PAIS' | 'INACTIVO' | 'ANTIGUEDAD' }[]
  }
}

export function paisIdDerivado(focoPaisIds: string[]): string | null
```

**Precedencias (en orden):**
1. Base = colaboradores que cumplen el foco.
2. `excluirIds` gana sobre los filtros (se quitan de la base). Un id en `excluirIds` que no cumple el foco es inocuo.
3. `incluirIds` gana sobre los filtros de área/nivel (se suman aunque no cumplan esas dos dimensiones). Si un id está en ambas listas, **excluir gana** (y la UI impide llegar a ese estado).
4. **El país es el techo:** un `incluirIds` que no cumple la dimensión país del foco se rechaza (motivo `FUERA_DE_PAIS`) — se chequea ANTES de activo/antigüedad porque es la razón más fuerte. Con foco de países vacío, esta dimensión no descarta a nadie (todos los países valen).
5. Activo + antigüedad mínima (`excluidoPorAntiguedad` de `src/domain/antiguedad.ts`, 6 meses al inicio del ciclo) se aplican AL FINAL a todos, incluidos los manuales que ya pasaron el filtro de país: nadie inactivo o junior entra ni a mano — es regla del negocio, no del alcance. Los incluidos manuales rechazados por esto (o por país) se reportan en `detalle.incluidosRechazados`.

## Wizard — paso «Alcance»

Reemplaza los chips de país por tres bloques (en `WizardCiclo.tsx`):

1. **Filtros** — tres `SelectorMultiple` (componente existente con buscador): Países, Áreas, Niveles jerárquicos. Cada uno muestra «Todos» cuando está vacío. Las opciones llegan del server como llegan hoy países y niveles al wizard (se agregan las áreas).
2. **Ajustes manuales** — un `Combobox` de personas (buscador sobre colaboradores activos) con acción según el caso: si la persona cumple los filtros actuales → «Excluir del ciclo»; si no los cumple → «Agregar al ciclo». El país es el techo del alcance: el `Combobox` solo ofrece personas de los países del foco (`focoPaisIds`) cuando este no está vacío — de otros países ni aparecen, porque no se pueden agregar (regla nueva) ni excluir (no están en el alcance de todos modos). Cada ajuste se pinta como chip removible: `Mengana Pérez · fuera de filtros ＋` / `Fulano Díaz · excluido ✕`. Si al cambiar filtros un ajuste pierde sentido (un incluido pasa a cumplir los filtros, un excluido deja de cumplirlos, o un incluido queda fuera del país tras acotar el foco) el chip se muestra atenuado o el aviso de rechazados lo marca — se conserva por si los filtros vuelven a cambiar (no se borra automáticamente); el usuario decide quitarlo, y si no lo hace el server lo rechaza al guardar.
3. **Lista previa** — server action de dry-run `previewAlcance(foco, ajustes, fechaInicio)` (guard `requiereAdmin('CICLOS','GESTIONAR')`) que corre el resolutor y devuelve conteo total, desglose por país y la lista agrupada país → área con marcas para incluidos/excluidos manuales e incluidos rechazados (con su motivo). Se refresca al cambiar cualquier filtro/ajuste (debounce). El conteo grande es el elemento dominante del bloque: «47 evaluados · Chile 31 · Perú 16».

El paso 3 (Evaluaciones) hoy acota sus conteos por nivel al país elegido; pasa a acotarlos al **alcance resuelto** (misma dry-run), para que «X colaboradores de este nivel» siga siendo veraz.

La **Revisión final** (paso 4) muestra el alcance en palabras: «Chile y Perú · áreas Comercial, Operaciones · nivel Mando medio · 1 excluido · 1 agregado manual» + el conteo.

## Server actions

- `crearCiclo` / `editarCiclo`: reciben foco + ajustes (FormData), validan ids contra catálogos (países/áreas/niveles existentes, colaboradorIds existentes), derivan `paisId` con `paisIdDerivado`, persisten. Un id presente en incluir Y excluir se rechaza server-side. `validarAlcanceCiclo` también rechaza (server-side, no filtrado silencioso) cualquier `incluirIds` cuyo país quede fuera de `focoPaisIds` cuando el foco no está vacío — el país es el techo del alcance, esta regla se evalúa además de la existente de RRHH-país.
- `editarCiclo` (borrador) precarga filtros y ajustes en el wizard, como hoy precarga el país.
- `lanzarCiclo`: reemplaza el filtro inline (`!ciclo.paisId || c.paisId === ciclo.paisId`) por `resolverAlcance(...)`. La generación de asignaciones AUTO/JEFE/ASCENDENTE, los insumos cross-país (jefe y ascendentes sin importar país/participación) y el snapshot vía `Asignacion` **no cambian**. El AuditLog del lanzamiento agrega el resumen del alcance (foco + conteos de ajustes).
- `preflightCiclo`: su base de colaboradores del alcance (hoy `where paisId`) pasa al resolutor; sus avisos existentes (objetivos incompletos, cuestionarios vacíos por nivel, sin jefe, evaluadores externos, cuentas faltantes) se calculan sobre la lista resuelta. Aviso nuevo: incluidos manuales rechazados por inactivo/antigüedad.

## Qué NO cambia (a propósito)

- **Cierre, congelamiento y avance por país** (`CicloPaisCierre`, `paisCongelado`, `paisesCongelados`): operan sobre el país de los evaluados con asignaciones. Un ciclo «Comercial de Chile y Perú» muestra avance de ambos y se cierra país por país. El caso `ciclo.paisId != null` sigue usando «cierre del ciclo» directo.
- **`cicloFueraDeAlcance` (RRHH-país):** sigue leyendo `paisId` derivado. RRHH-Chile gestiona ciclos cuyo foco sea exactamente Chile (con o sin filtros de área/nivel); los multi-país o todos-los-países son del Regional. Para el wizard se replica el patrón que los transversales ya tienen server-side (`acciones.ts:592-598`: el foco de países se fuerza al país del RRHH-país); en la UI el filtro de países aparece fijado a su país, no editable.
- **Pares, incidentes, conformidad, calibración, resultados, PDF**: derivan de asignaciones/resultados, no del alcance.
- **Candados de rotación**: cambiar puesto/país de un participante en ciclo activo sigue bloqueado. Cambiar de **área** a un participante no afecta al ciclo lanzado (alcance ya snapshoteado en asignaciones) y NO se bloquea.

## Errores y bordes

- Alcance que resuelve a 0 evaluados: el wizard lo muestra («0 evaluados») y el preflight lo trata como bloqueante de lanzamiento con mensaje específico.
- Colaborador de `incluirIds`/`excluirIds` dado de baja antes del lanzamiento: el resolutor lo ignora (inactivo); el chip aparece atenuado.
- Un incluido que queda fuera de país al acotar el foco (p. ej. se reduce `focoPaisIds` después de agregarlo): el resolutor lo rechaza (`FUERA_DE_PAIS`) y el aviso de rechazados lo señala; el chip no se borra solo — el usuario debe quitarlo o volver a ampliar el foco, y `validarAlcanceCiclo` lo bloquea al guardar mientras siga cross-país.
- Áreas/niveles eliminados del catálogo después de guardar el borrador: ids huérfanos en el foco simplemente no matchean a nadie; el preview lo hace visible. (Las áreas con colaboradores no se pueden eliminar hoy — borde poco probable.)
- Concurrencia padrón/lanzamiento: la lista previa es informativa; la verdad se resuelve en el momento de lanzar (mismo comportamiento actual).

## Testing

- **Unit (`alcance.test.ts`)**: dimensión vacía = todos; OR dentro de dimensión; AND entre dimensiones; areaId/nivelId null vs filtro activo; excluir gana a filtros; incluir salta área/nivel dentro del país; incluir NO salta el país (`FUERA_DE_PAIS`); excluir gana a incluir; activo/antigüedad aplican a incluidos manuales (con `detalle.incluidosRechazados`); `paisIdDerivado` (0, 1, N países).
- **E2E en clone**: ciclo «Chile + área X + nivel mando medio + 1 excluido + 1 incluido (de Chile, fuera de esa área)» → preview = preflight = asignaciones generadas; intentar agregar a alguien de Perú al mismo ciclo se rechaza (Combobox no lo ofrece; si se fuerza vía API, `validarAlcanceCiclo` lo rechaza); RRHH-Chile ve y gestiona el ciclo; ciclo con 2 países en foco NO es gestionable por RRHH-país.
- **Regresión**: los ciclos existentes (paisId poblado, focos vacíos tras migrar `focoPaisIds=[paisId]`) resuelven exactamente el mismo conjunto que la lógica vieja.

## Fuera de alcance (defers)

- Dimensión «puestos» en el foco del ciclo.
- Alcance por árbol de mando bajo un jefe.
- Reutilizar el resolutor para el foco de transversales (hoy tienen su propia lógica equivalente; unificar es refactor aparte).
