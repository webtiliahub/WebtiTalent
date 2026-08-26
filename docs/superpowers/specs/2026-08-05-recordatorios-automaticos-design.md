# Recordatorios automáticos por correo — Diseño

**Fecha:** 2026-08-05
**Estado:** Aprobado por Christian (diseño y mockups de los 7 correos validados en conversación)

## Problema

Hoy los recordatorios son solo manuales (botón en el detalle del período) y varios momentos clave no notifican: nadie avisa automáticamente a quien no completó su carga de objetivos, al jefe con aprobaciones pendientes, al evaluador con cuestionarios sin responder, ni a RR.HH. con el estado consolidado. La plataforma necesita un scheduler y un set de correos automáticos.

## Decisiones de producto (validadas con Christian)

1. **Cadencia fija inteligente, sin configuración**: hitos a **30, 15 y 7 días** del deadline + **diario cuando quedan ≤7 días**. Los hitos fuera de la ventana no aplican (un período de 10 días solo tiene el de 7 y los diarios). Vale para objetivos (deadline = fin de carga) y evaluaciones (deadline = fin del ciclo).
2. **Pendiente de evaluación = solo cuestionarios** (auto/jefe/par/ascendente). Feedback y conformidad tienen su propio flujo al cierre y NO entran en estos recordatorios.
3. **Digest RR.HH. por alcance**: cada cuenta RRHH recibe su alcance (Regional: todo agrupado por país; RRHH-país: solo su país). Sale **semanal (lunes)** mientras haya pendientes y **diario en la última semana** del proceso más próximo a cerrar. Un solo correo combina objetivos y evaluaciones.
4. **Panel simple** en el detalle del período y del ciclo: último envío automático (fecha, hito, enviados/fallidos), próximo hito estimado y el botón de envío manual existente al lado.
5. Copys cerrados en los mockups (`docs/superpowers/specs/2026-08-05-recordatorios-mockups.html`, revisados por Christian): «sin tu aprobación, sus objetivos no quedan **activos**»; digest con «**N sin completar sus objetivos · M jefes por aprobar**» y «**N evaluadores deben M evaluaciones**»; conformidad en lenguaje de «comentarios» (nunca «queja»/«desacuerdo»).

## Los 7 correos

| # | Correo | Disparo | Destinatario | Contenido clave |
|---|---|---|---|---|
| 1 | Objetivos pendientes | Cron · hitos | Colaborador bajo 100% de peso | Días restantes, % de avance con barra, cuánto falta asignar, CTA «Completar mis objetivos» |
| 2 | Aprobaciones del equipo | Cron · hitos | Jefe con propuestas PENDIENTES de su equipo | Lista (persona · n objetivos · % del peso), «sin tu aprobación, sus objetivos no quedan activos», CTA «Revisar y aprobar» |
| 3 | Objetivos aprobados | TRANSACCIONAL (en la action de aprobar, jefe o RRHH) | Colaborador | Lista de lo aprobado en esa acción con pesos + estado del total (100% ✓ o cuánto falta). UN correo por acción de aprobación aunque apruebe varios |
| 4 | Evaluaciones pendientes | Cron · hitos | Cada evaluador con cuestionarios sin completar (incluye su AUTO) | Lista con chips de modalidad y nombre del evaluado, días restantes, CTA «Completar mis evaluaciones» |
| 5 | Digest RR.HH. | Cron · semanal + diario en última semana | Cada cuenta RRHH según alcance | Card de objetivos (por país: sin completar + jefes por aprobar) + card de evaluaciones (por país: evaluadores y evaluaciones pendientes + avance global %), CTA «Abrir monitoreo» |
| 6 | Variante «último día» | Cron · cuando queda ≤1 día | Los mismos del 1 y 4 | Mismo cuerpo con banda superior roja «⏰ HOY es el último día» y consecuencia explícita |
| 7 | Nota preliminar disponible | Cron · detección de transición | Colaborador cuya vista previa se habilitó (todos los insumos completos) y aún no fue notificado | Qué sigue en 3 pasos (revisar → retroalimentación con el jefe → conformidad o comentarios), aclaración de que la nota final llega tras la calibración, CTA «Ver mi resultado preliminar» |

Los asuntos incluyen la urgencia cuando aplica («Te quedan 7 días…», «ÚLTIMO DÍA: …»). Todos usan la `plantilla()` de marca existente en `src/shared/lib/mailer.ts` (HTML + texto plano).

## Arquitectura

### Motor de hitos — `src/features/recordatorios/hitos.ts` (puro)

- `hitoDelDia(deadline: Date, hoy: Date): Hito | null` con `Hito = 'D30' | 'D15' | 'D7' | 'DIARIO' | 'ULTIMO_DIA'` — días restantes exactos: 30→D30, 15→D15, 7→D7, 2..6→DIARIO, ≤1→ULTIMO_DIA, resto→null.
- `tocaDigestRrhh(deadlineMasProximo: Date, hoy: Date): boolean` — lunes, o diario si quedan ≤7 días del proceso más próximo.
- Sin `Date.now()` interno: recibe `hoy` como parámetro (testeable y compatible con simulación).

### Deadlines efectivos

- **Objetivos**: `fechaLimiteCarga` del período; quien tiene **extensión individual** vigente cuenta contra SU fecha extendida (los hitos se evalúan por persona con su deadline efectivo). El correo 2 (jefe) usa el deadline del período.
- **Evaluaciones**: `fechaFin` del ciclo. Se excluyen evaluadores cuyos pendientes son todos sobre países ya CERRADOS del ciclo; las asignaciones `INVALIDADA` no cuentan como pendientes.

### Cron

- `vercel.json` nuevo: cron **diario a las 12:00 UTC** (~7:00 Perú/Colombia/Ecuador, 8:00 Chile) → `GET /api/cron/recordatorios`.
- La ruta valida `Authorization: Bearer ${CRON_SECRET}` (header que Vercel envía; la variable se crea en Vercel). Sin secreto válido → 401. GET sin efectos para cualquier otro origen.
- Flujo: períodos `CARGA_ABIERTA` + ciclos `ACTIVO` → motor de hitos → armado de pendientes → envío (mailer) → registro. Los cálculos de pendientes REUSAN la lógica existente: cobertura del período (`coberturaPeriodo`/consultas equivalentes) y asignaciones PENDIENTES del ciclo.
- Correo 7: por cada ciclo activo, colaboradores cuya vista previa está habilitada (mismo criterio del preview existente: evaluaciones enviadas + logros confirmados) sin registro previo de envío → se notifica. La detección vive en el cron (no se siembran disparadores en las actions que completan insumos).

### Registro e idempotencia — modelo nuevo

```prisma
model RecordatorioEnvio {
  id         String   @id @default(cuid())
  proceso    String   // 'OBJETIVOS' | 'EVALUACIONES' | 'DIGEST_RRHH' | 'NOTA_PRELIMINAR'
  referencia String   // periodoId o cicloId
  hito       String   // 'D30' | 'D15' | 'D7' | 'DIARIO' | 'ULTIMO_DIA' | 'SEMANAL' | 'UNICO'
  fecha      DateTime // día del envío (fecha truncada para la unicidad diaria)
  destinatarioId String? // usuario/colaborador puntual (correo 7 y transaccionales registrables); null = lote
  enviados   Int
  fallidos   Int
  detalleJson Json?   // muestra de fallidos, conteos por país del digest
  creadoEn   DateTime @default(now())
  @@unique([proceso, referencia, hito, fecha, destinatarioId])
}
```

- El `@@unique` garantiza que un reintento del cron el mismo día no duplique correos.
- El correo 7 registra por destinatario con `hito='UNICO'` y la fecha del día; su no-repetición ENTRE días la garantiza una consulta previa (`findFirst({ proceso: 'NOTA_PRELIMINAR', referencia, destinatarioId })` antes de enviar) — el unique cubre el mismo día, la consulta cubre siempre.
- Fallos individuales de envío no frenan el lote (patrón `Promise.allSettled` del envío manual existente); se acumulan en `fallidos` + muestra en `detalleJson`.

### Transaccional (correo 3)

En las actions de aprobación de objetivos (jefe y RRHH, incluida la aprobación con reemplazo): tras aprobar, un correo al colaborador con TODO lo aprobado en esa acción. No pasa por el cron ni por `RecordatorioEnvio` (es evento puntual, igual que los correos de cierre existentes). El correo de «objetivo reemplazado» existente se mantiene y no se duplica: si la aprobación fue con ajuste, se envía solo el de reemplazo (ya informa la aprobación).

### Panel «Recordatorios» (UI)

Card en el detalle del período (`/admin/periodos/[id]`) y del ciclo (`/admin/ciclos/[id]`): último envío automático (fecha, hito, enviados/fallidos), próximo hito estimado (calculado con el motor), y el botón de envío manual existente reubicado a su lado. Lee `RecordatorioEnvio` por referencia. Visible para quien ya ve esas páginas (guards actuales); sin acciones nuevas de mutación.

## Reglas anti-ruido

- Sin cuenta de usuario = sin correo; se cuentan como «sin cuenta» en el digest y el panel.
- Máximo un correo del mismo tipo por persona por día (garantizado por el registro).
- Quien completa (100% de peso / 0 pendientes / ya aprobó todo) deja de recibir desde el día siguiente.
- Países cerrados/congelados del ciclo quedan fuera; períodos y ciclos en borrador o cerrados no generan nada.
- El digest RRHH solo sale si hay pendientes en el alcance de esa cuenta.
- El envío manual existente sigue disponible y NO consume ni bloquea los hitos automáticos.

## Errores y bordes

- Resend caído: el catch del lote registra el envío con `fallidos` y `detalleJson`; el cron del día siguiente reintenta lo que siga pendiente (no hay reintento intradía).
- Cron corre dos veces el mismo día (redeploy, reintento de Vercel): el unique lo hace no-op.
- Período que cierra su carga entre hitos: deja de generar recordatorios al salir de `CARGA_ABIERTA`.
- Colaborador dado de baja con pendientes: ya no recibe (inactivo); sus pendientes aparecen en el flujo de incidentes existente, no en estos correos.
- Cambio de deadline (extensión del período): los hitos se recalculan contra la nueva fecha automáticamente (el motor evalúa cada día contra el deadline vigente).

## Testing

- **Unit** (`hitos.test.ts`): ventanas largas (hitos 30/15/7 + diarios), ventana corta de 10 días (solo 7 + diarios), último día, digest lunes vs diario en última semana, deadline extendido por persona.
- **Unit del armado de pendientes** donde sea función pura; lo que toca BD se cubre en E2E.
- **E2E en clone**: disparar `GET /api/cron/recordatorios` a mano (con el secreto) sobre datos con un período abierto y un ciclo activo simulados a distintas distancias del deadline (ajustando fechas en BD) → verificar destinatarios, contenidos en modo consola del mailer, registros en `RecordatorioEnvio`, y segunda corrida = 0 envíos. Verificar el correo 3 aprobando objetivos por la UI y el 7 completando el último insumo de alguien.

## Fuera de alcance

- Recordatorios de feedback/conformidad en etapa de cierre (flujo propio; posible fase 2).
- Configuración de cadencia por RRHH (la cadencia es fija por diseño).
- Notificaciones push/PWA (tarea #13 del backlog, independiente).
- Cambio de proveedor de correo (sigue el puente Resend de Webtilia hasta que Hunter TI conecte su herramienta; los correos nuevos usan el mismo mailer).

## Referencia visual

Mockups aprobados de los 7 correos: `docs/superpowers/specs/2026-08-05-recordatorios-mockups.html` (nombres ficticios; los copys de ese archivo son el contrato de contenido). Al implementar, cada plantilla se traslada a `mailer.ts` con sus helpers existentes (`titulo`, `parrafo`, `bloqueDestacado`, `botonCta`, `notaGris`).
