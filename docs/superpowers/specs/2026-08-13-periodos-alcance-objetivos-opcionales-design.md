# Períodos de objetivos con alcance + evaluación de objetivos opcional + borrar borradores

**Fecha:** 2026-08-13 · **Estado:** aprobado por Christian (diseño validado en conversación)

## Objetivo

Dinamizar el proceso: (1) abrir la carga de objetivos solo a un país/área/nivel/grupo — para
usarla como insumo de un ciclo del mismo grupo; (2) permitir ciclos de evaluación que NO
evalúan objetivos (nota = 100% competencias); (3) poder borrar períodos en BORRADOR;
(4) crear el período en una pantalla dedicada con el formato del wizard de ciclos.

## No-objetivos

- No cambia el flujo de aprobación de objetivos ni sus estados.
- No cambia la combinación por nivel (compPct) ni los pesos de modalidades.
- No hay migración de datos: períodos existentes = alcance vacío = toda la organización.

## Decisiones validadas

1. **Alcance restrictivo total**: fuera del alcance el período «no existe» — sin correo de
   apertura, sin poder cargar objetivos, fuera de cobertura y recordatorios.
2. **Ciclo sin objetivos = ciclo sin período**: `Ciclo.periodoId` pasa a opcional; el wizard
   pregunta «¿Este ciclo evalúa objetivos?».
3. **Selector de alcance idéntico al de ciclos**: foco combinable país/área/nivel +
   incluir/excluir personas + preview, con la regla «el país del RRHH es el techo».
4. **El período NO aplica la regla de antigüedad mínima** (esa exclusión es del ciclo:
   un ingreso reciente también carga objetivos).
5. **Alcance editable solo en BORRADOR** (abierta la carga, cambiarlo invalida trabajo hecho).

## 1 · Schema (prisma/schema.prisma)

```prisma
model PeriodoObjetivos {
  // ... campos actuales ...
  focoPaisIds  String[] @default([])
  focoAreaIds  String[] @default([])
  focoNivelIds String[] @default([])
  incluirIds   String[] @default([])
  excluirIds   String[] @default([])
}

model Ciclo {
  periodoId String?           // ← nullable: ciclo sin objetivos no referencia período
  periodo   PeriodoObjetivos? @relation(...)
}
```

Migración solo aditiva (defaults `[]`) + relajar la FK. Prisma 7: db push al regenerar.

## 2 · Módulo de alcance compartido

`src/features/ciclos/alcance.ts` ya es puro (FocoCiclo, AjustesCiclo, resolverAlcance,
resumenAlcance, cumpleFoco). Cambios:

- `resolverAlcance(colaboradores, foco, ajustes, fechaInicio)` → `fechaInicio: Date | null`.
  Con `null` NO aplica la exclusión por antigüedad (uso del período); los ciclos siguen
  pasando su fecha. El motivo `ANTIGUEDAD` solo puede aparecer con fecha.
- Ningún renombre de archivo (los ciclos son el consumidor principal; el período lo importa
  cross-feature igual que ya hace preflight).
- `previewAlcance` (`src/features/ciclos/acciones-alcance.ts`) gana el parámetro
  `conAntiguedad: boolean` para que la página de nuevo período muestre el preview correcto.

**Resolutor del período** (nuevo helper en `src/features/objetivos/alcance-periodo.ts`):
`estaEnAlcancePeriodo(periodo, colaborador): boolean` y
`colaboradoresDelPeriodo(periodoId): Promise<Colaborador[]>` — única fuente de verdad que
consumen apertura, cobertura, recordatorios, vistas y guards de carga.

## 3 · Efectos del alcance del período

| Superficie | Cambio |
|---|---|
| `abrirCargaPeriodo` | notifica solo a cuentas de colaboradores del alcance |
| `validarVentanaCarga` + acciones de crear/editar objetivo (`objetivos/acciones.ts`) | rechazan a colaboradores fuera del alcance: «Este período no aplica a X» |
| Vistas `/objetivos` y `/equipo/objetivos` | el período solo aparece para quien está en su alcance; el jefe ve solo a los miembros del equipo dentro del alcance |
| `coberturaPeriodo` | denominador = colaboradores del alcance (intersección con alcance-país del RRHH que mira) |
| `enviarRecordatoriosPeriodo` + cron de recordatorios (`recordatorios/pendientes.ts`) | solo incompletos dentro del alcance |
| Transversales del período | aplican a (focalización propia ∩ alcance del período) — en `objetivosAplicables`, preflight y export |
| `exportarObjetivosPeriodo` | filas solo del alcance |
| Detalle `/admin/periodos/[id]` | muestra el resumen del alcance (`resumenAlcance`) |

## 4 · Ciclo sin objetivos

- **Wizard** (`WizardCiclo.tsx`, paso «Datos del ciclo»): radio «¿Este ciclo evalúa
  objetivos?» — Sí (elige período, como hoy) / No (sin período). Copy del No:
  «La nota final se calculará 100% con competencias».
- **Crear/editar ciclo** (`ciclos` acciones): aceptan `periodoId: null`; validación
  existente de período solo cuando hay período.
- **Preflight** (`features/ciclos/preflight.ts`):
  - `periodoId === null` → omite `objetivosIncompletos` y `periodoYaEvaluado`; agrega el
    aviso fijo «Este ciclo no evalúa objetivos: la nota final será 100% competencias».
  - Con período: nuevo aviso `fueraDelPeriodo` — participantes del ciclo fuera del alcance
    del período elegido (hoy saldrían crípticos como «0% de objetivos», que además bloquea;
    siguen bloqueando, pero el aviso explica el porqué y cómo resolverlo).
- **Cálculo** (`resultados/servicio.ts`): con `periodoId` null se omite `objetivosAplicables`
  → `cumplimiento = null` → `notaFinal` renormaliza a solo competencias (ruta existente).
- **Superficies**: detalle del ciclo, `PreviewResultado`, PDF de resultados, análisis,
  conformidad y `ResultadoColaborador` muestran «Sin objetivos en este ciclo» en lugar del
  bloque de cumplimiento. El 9-Box no cambia (eje desempeño = nota final renormalizada).
- **Recordatorios del ciclo** (cron 12:00 UTC): los envíos cuyo contenido depende de
  objetivos (p. ej. logros pendientes) se OMITEN cuando el ciclo no tiene período; el resto
  de hitos (evaluaciones pendientes, conformidad) no cambia.

## 5 · Borrar período en BORRADOR

- `eliminarPeriodo(periodoId)` en `objetivos/acciones-periodo.ts`:
  - guard: estado `BORRADOR`; si algún ciclo lo referencia → error «El ciclo “X” usa este
    período: desvincúlalo o bórralo primero».
  - la confirmación en UI indica cuántos objetivos transversales se borrarían en cascada.
  - AuditLog `PERIODO_ELIMINADO` con nombre y conteo.
- UI: ícono de basura en la fila del período (solo BORRADOR) con `confirmar()`.

## 6 · Página dedicada de creación

- Nueva ruta `src/app/(app)/admin/periodos/nuevo/page.tsx` (permiso OBJETIVOS: GESTIONAR),
  mismo formato del wizard de ciclos, pasos: **Datos del período** (nombre, tipo
  anual/semestral, límite de carga) → **Alcance** (selector idéntico al de ciclos, preview
  sin regla de antigüedad) → **Revisión** (resumen + crear).
- El botón «+ Crear período» de la pestaña actual navega a la nueva página; el form inline
  se elimina.
- El alcance es editable después SOLO en BORRADOR, desde `/admin/periodos/[id]` (mismo
  componente del wizard en modo edición, como hace el ciclo).

## 7 · Pruebas

- `alcance.test.ts`: `fechaInicio: null` no excluye por antigüedad; con fecha se mantiene
  el comportamiento actual (casos existentes intactos).
- Nuevo `alcance-periodo.test.ts`: foco vacío = todos; foco combinado; incluir/excluir;
  transversal ∩ alcance.
- `preflight`: ciclo sin período (omite bloqueantes de objetivos, agrega aviso); aviso
  `fueraDelPeriodo` con período acotado.
- Cálculo: resultado con ciclo sin período renormaliza a 100% competencias (fixture TST*
  según patrón de aislamiento de tests).
- Guards de `eliminarPeriodo` (estado, ciclo vinculado).

## Riesgos y bordes

- **Ciclo con período acotado + participantes fuera**: bloquea el lanzamiento por 0% de
  objetivos (comportamiento correcto) — el aviso nuevo lo hace diagnosticable.
- **Período CERRADO con alcance**: la corrección post-cierre de RRHH (ventana existente)
  respeta el alcance igual que la carga.
- **Ciclos existentes**: todos tienen período; nada cambia para ellos.
- **`rutasObjetivos`/revalidate**: sumar `/admin/periodos/nuevo` donde corresponda.
