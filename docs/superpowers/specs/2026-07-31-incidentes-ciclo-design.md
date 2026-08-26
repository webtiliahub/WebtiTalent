# Pestaña «Incidentes» del ciclo — retiros de evaluadores durante la evaluación

**Fecha:** 2026-07-31 · **Aprobado por:** Christian (brainstorming 31/07)

## Problema

Cuando un colaborador se retira de la empresa con un ciclo activo, sus evaluaciones
pendientes como **evaluador** dejan a los evaluados sin insumos (jefe, ascendente o par).
Hoy las acciones para resolverlo existen (`reasignarEvaluador`, `cancelarAsignacion`,
`retirarDelCiclo`) pero viven en un panel invisible del Monitoreo (`RotacionCiclo`, con
`return null` si no detecta nada) y el detector marca casos que ya no queremos marcar.

## Reglas de negocio (decisiones de Christian, 31/07)

1. El país del ciclo acota a los **evaluados**; los insumos vienen de cualquier país
   (ya desplegado en `ae7703f`). Los incidentes son sobre los **insumos**.
2. **Único disparador de incidente: baja de un evaluador con evaluaciones sin enviar**
   (PENDIENTE, BORRADOR o PROPUESTA) sobre evaluados del ciclo.
3. **Cambio de jefe con el anterior activo NO es incidente**: el jefe anterior sigue en
   la compañía, conoce al colaborador y responde su evaluación por este último ciclo.
   El detector de divergencias («huérfanas» con evaluador activo) se elimina.
4. Evaluaciones **ya respondidas** por alguien que luego se retira se conservan (observó
   el período). Excepción: al resolver un incidente de par, RR.HH. puede **invalidar
   también la evaluación ya respondida del otro par** si quedar un solo par introduce
   sesgo (o compromete el anonimato).
5. La **baja del evaluado** no genera incidente de insumos (es quien se va): mantiene el
   flujo actual de retiro con/sin nota, que se muda a esta pestaña.

## Diseño

### Detección (calculada, sin tablas nuevas)

En el detalle de un ciclo **ACTIVO** se calcula al leer (mismo patrón que el detector
actual — el ciclo es una foto y aquí se ve lo que divergió):

- **Incidentes de insumos**: asignaciones `estado ∈ {PENDIENTE, BORRADOR, PROPUESTA}`
  con `evaluador.activo = false`, sobre evaluados del alcance (`wherePais`). Agrupadas
  **por evaluado impactado**, cada fila con modalidad, nombre del evaluador saliente y
  estado de la asignación.
- **Evaluados dados de baja**: los `BajaCiclo` actuales (conteo de enviadas/pendientes
  sobre él, nota conservable, logros faltantes), tal cual hoy.

No hay tabla `Incidente`: resolver = cambiar los datos → el incidente desaparece.
La trazabilidad la da el AuditLog.

### Pestaña

`⚠ Incidentes (N)` en el detalle del ciclo, **solo visible cuando N > 0**
(N = evaluados impactados + evaluados dados de baja sin resolver). Estilo de alerta.
No existe en ciclos BORRADOR ni CERRADOS.

### Resoluciones

| Acción | Implementación | Notas |
|---|---|---|
| Reasignar evaluador | `reasignarEvaluador` (existe) | Pool del selector pasa a **activos regionales con antigüedad mínima** (hoy `candidatos` se acota al alcance país) |
| No aplica | `cancelarAsignacion` + **motivo obligatorio** (nuevo parámetro, ≥10 caracteres) | Motivo al AuditLog; la nota renormaliza sin esa voz |
| Invalidar la del otro par | **Nueva** `invalidarEvaluacion(asignacionId, motivo)` | Solo ofrecida al resolver un incidente de PAR cuando la hermana está ENVIADA. Estado nuevo `INVALIDADA` en `EstadoAsignacion`; respuestas se conservan como registro; recalcula el resultado; `EVALUACION_INVALIDADA` en AuditLog |
| Retirar al evaluado (con/sin nota) | `retirarDelCiclo` (existe) | Se muda del Monitoreo sin cambios |

### Motor y contadores (estado `INVALIDADA`)

- `calcularResultado` y los desgloses (web y PDF) solo consideran respuestas de
  asignaciones ENVIADAS → INVALIDADA queda fuera de la nota por construcción
  (verificar el filtro exacto en implementación y agregarlo donde falte).
- **Avance del ciclo** y contadores por modalidad: INVALIDADA se excluye del
  denominador (no es pendiente ni enviada).
- **Vista previa del colaborador** (`ciclosConNotaPreview`): el conteo `sinEnviar`
  excluye INVALIDADA (no bloquea el pre-read).
- **Pendientes por evaluador** (Monitoreo): excluye INVALIDADA.
- Slots de pares (`equipo/evaluar` y pestaña Pares de RR.HH.): una PAR **INVALIDADA
  no ocupa slot** — el jefe o RR.HH. pueden nominar un reemplazo; la invalidada se
  conserva solo como registro (excluirla en `paresPorEvaluadoId` y en la cobertura
  de nominación).

### Candados

- Solo ciclo ACTIVO y país del evaluado **no congelado** (`paisCongelado`).
- Alcance RR.HH.-país sobre el **evaluado** impactado (igual que el resto).
- Invalidar y «no aplica» exigen motivo ≥10 caracteres (mismo criterio que la
  exención de conformidad).

### Limpieza

- `RotacionCiclo` se convierte en la pestaña Incidentes (o se reemplaza por un
  componente `TabIncidentes`); el detector de huérfanas-por-divergencia y su UI se
  eliminan; el bloque de rotación desaparece del tab Monitoreo.
- `page.tsx` del ciclo deja de calcular `rotacionHuerfanas` por divergencia con
  evaluador activo; conserva el cálculo de bajas y suma el de insumos impactados.

## Validación

1. `tsc` + build + suite vitest.
2. E2E en el clone (`hunter360_prodclone`, dev :3001): dar de baja a un par y a un
   jefe con pendientes → la pestaña aparece con el contador → resolver: una
   reasignación, un «no aplica» con motivo y una invalidación de la evaluación
   hermana → verificar recálculo/renormalización de la nota del evaluado, exclusión
   en avance y pre-read, y las tres entradas de AuditLog.
3. Confirmar que el retiro del evaluado sigue funcionando desde la nueva pestaña.

## Fuera de alcance

- Historial navegable de incidentes resueltos (el AuditLog lo cubre; si Hunter pide
  más, se persiste encima de este diseño).
- Notificaciones por correo a RR.HH.
- Incidentes por reingreso o colaborador nuevo a mitad de ciclo.
