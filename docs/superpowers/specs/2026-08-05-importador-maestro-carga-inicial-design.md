# Importador maestro + carga inicial de producción — Diseño

**Fecha:** 2026-08-05
**Estado:** Aprobado por Christian (diseño validado en conversación)

## Problema

Hunter devolvió el Excel único de carga (`Copia de Hunter_Carga_Maestra_v2.xlsx`) con sus definiciones finales, y la plataforma debe quedar lista para pruebas: hoy solo existe el importador CSV de padrón; la estructura (homologación de puestos, competencias por puesto, pesos por dimensión, combinación competencias/objetivos) se cargó por seeds y quedó desalineada con lo que Hunter definió. Además producción arrastra datos de piloto y dummies que deben purgarse antes de la carga real.

### Estado del archivo devuelto (verificado por diff y validación, 05/08)

- Hoja 3 (Niveles): Hunter llenó el reparto — Gerencial/Mando Medio/Especialista **60% competencias / 40% objetivos**; Apoyo **50/50**. Pesos D1–D5 por nivel suman 100 en los cuatro niveles.
- Hoja 4 (Puestos): **33 de 332 puestos re-homologados** de nivel (mayoría Apoyo→Especialista; algunos a Gerencial).
- Hoja 5 (Competencias × Puesto): prellenado confirmado — los 333 puestos tienen las 25 competencias (decisión Jazmin/Maco: todos los niveles con todas las competencias; la diferenciación va por pesos).
- Hoja 6 (Pesos × Puesto): **100% prellenado sin personalizaciones** (las 332 filas coinciden exactamente con los pesos del nivel de su columna B). Las 33 filas de puestos re-homologados quedaron con los pesos del nivel VIEJO — artefacto del prellenado, no decisión.
- Hoja 8 (Padrón, 806 filas): sin cambios de Hunter; **47 colaboradores** con `nivel_jerarquico` desactualizado respecto al nivel nuevo de su cargo.
- Alineación: hojas 4, 5 y 6 tienen exactamente los mismos **327 puestos únicos normalizados** (0 diferencias); hay 5 nombres duplicados que difieren solo en mayúsculas/tildes. Todo cargo del padrón tiene fila en la hoja 4 (matcheando normalizado; 1 difiere solo en mayúsculas).
- Hojas 1, 2, 7 y Léeme: sin cambios.

## Decisiones de producto (validadas con Christian)

1. **Jerarquía de fuentes de pesos:** la hoja 6 (por puesto) es la ESPECÍFICA y manda; la hoja 3 (por nivel) es el fallback general cuando un puesto no especifica pesos. Cuando una fila de hoja 6 difiere de su nivel, se aplica igual pero se reporta como «personalización explícita» — visible, nunca arrastre silencioso.
2. **Importador maestro único en UI** (no un importador por hoja, no script): RRHH sube el `.xlsx` completo, ve el dry-run integral y aplica. Capacidad permanente de la plataforma.
3. **Purga de producción TOTAL salvo cuentas y config**: se borran colaboradores (dummies y piloto), ciclos, asignaciones, resultados, feedbacks, objetivos y períodos. Se conservan: usuarios/cuentas del equipo, roles admin, banco de preguntas y evaluaciones diseñadas, catálogos (dimensiones, competencias, niveles, países, áreas) y config.
4. **La purga la ejecuta Christian/Claude como operación puntual con backup previo de Neon** — la plataforma NO gana un botón de reemplazo total.
5. Tras la carga: **pruebas con grupos reducidos** usando el alcance flexible de ciclos (área chica o grupo de personas), sin comprometer a los 806.

## Reglas de mapeo (Excel → modelo)

| Hoja | Destino | Regla |
|---|---|---|
| 3. Niveles | `NivelJerarquico.compPct` | % de competencias por nivel (objetivos = 100 − compPct). Los D1–D5% de la hoja NO se cargan directo: son el fallback de la hoja 6. Validación: D1–D5 suman 100 y comp+obj suman 100, por nivel. |
| 4. Puestos | `Puesto.nivelId` (+ alta de puestos nuevos) | Homologación puesto → nivel. El nombre canónico visible es el de esta hoja. Nivel desconocido = error bloqueante. |
| 5. Competencias × Puesto | `PuestoCompetencia` | REEMPLAZO del set por puesto (no acumula). Competencia que no existe en BD = error bloqueante (el Excel no da de alta competencias; hojas 1 y 2 son referencia). Puesto sin ninguna competencia marcada = error bloqueante (nacería sin cuestionario). |
| 6. Pesos × Puesto | `PesoDimensionPuesto` | Fila presente y completa → esos pesos (suma ≠ 100 = bloqueante). Puesto sin fila o fila vacía → pesos del nivel (hoja 3). Fila ≠ pesos de su nivel → se aplica y se reporta como personalización. `puntajeEsperado` NO viene en el Excel: se conserva el valor existente; en puestos nuevos, default 3. |
| 8. Padrón | `Colaborador` vía el motor del importador CSV existente (`importador.ts`) | Mismas columnas y validaciones (jefes por `codigo`, países/áreas, dry-run). Diferencia: **`nivel_jerarquico` del archivo SE IGNORA y se deriva del cargo vía hoja 4** — imposible el desalineo colaborador/puesto. Si la columna difiere de lo derivado → aviso informativo con conteo. Cargo del padrón sin fila en hoja 4 = error bloqueante. |

**Normalización transversal:** todo match de nombres (puestos, áreas, países, niveles, competencias) se hace sin tildes, sin mayúsculas y con espacios colapsados (mismo criterio `normalizar` del código existente). Filas duplicadas tras normalizar se fusionan y se reportan como aviso (el archivo real tiene 5).

## Parseo del workbook

- Nueva dependencia: `xlsx` (SheetJS) — el importador actual solo lee CSV.
- Las hojas se identifican por nombre normalizado que CONTENGA la clave («niveles», «puestos», «competencias x puesto», «pesos x puesto», «padrón»/«padron») — tolera renombres menores. Hoja requerida ausente = error bloqueante que nombra la hoja. La hoja 7 («Pesos evaluadores») no se identifica ni se lee — ver «Fuera de alcance».
- El encabezado de cada hoja se localiza buscando la fila que contiene sus columnas conocidas (las hojas traen 2-3 filas de título/leyenda antes). Todo lo anterior al encabezado se ignora.
- La hoja 5 tiene encabezado de dos filas (dimensiones arriba, competencias abajo): la fila de competencias es el encabezado real; el mapeo columna→competencia se hace por nombre normalizado de competencia contra la BD.
- Límite de archivo: 10 MB (el real pesa ~180 KB).

## Flujo UI — Configuración → pestaña «Carga maestra»

Guard: página `requiereAdmin('CONFIGURACION','VER')` para ver, acciones `requiereAdmin('CONFIGURACION','GESTIONAR')`. Mismo patrón de dos fases del importador de padrón:

1. **Subir archivo → dry-run automático** (`importarMaestro(formData, aplicar=false)`): reporte por sección —
   - Niveles: compPct antes → después por nivel.
   - Puestos: nuevos / re-homologados (con detalle nivel viejo → nuevo) / sin cambios.
   - Competencias × puesto: puestos cuyo set cambia (conteo agregado, detalle de los primeros 20).
   - Pesos × puesto: derivados del nivel vs personalizaciones explícitas (lista completa de personalizaciones).
   - Padrón: nuevos / actualizados / sin cambios / cuentas que se re-vincularán / cuentas sin match.
   - **Errores bloqueantes** (impiden aplicar) y **avisos conscientes** (se aplica igual), en el estilo del `ResumenImportacion` existente.
2. **Aplicar** (`importarMaestro(formData, aplicar=true)`): re-valida server-side (nunca confía en el dry-run del cliente) y ejecuta la transacción ordenada:
   1. `NivelJerarquico.compPct`
   2. Puestos (upsert por nombre normalizado: alta + re-homologación)
   3. `PuestoCompetencia` (reemplazo por puesto)
   4. `PesoDimensionPuesto` (upsert conservando `puntajeEsperado`)
   5. Padrón (motor existente, nivel derivado)
   6. **Re-vinculación de cuentas por email**: usuario existente cuyo email coincide (case-insensitive) con un colaborador del padrón nuevo → `usuario.colaboradorId` se apunta a la fila nueva; contraseña, rol, rolAdmin y alcance INTACTOS. Cuentas sin match quedan en el reporte (no se desactivan solas).
   - AuditLog `IMPORTACION_MAESTRA` con el resumen completo por sección.

### Candados

- **Ciclo ACTIVO en cualquier país ⇒ la aplicación completa se bloquea** (mismo criterio del candado de puestos existente: re-homologar o cambiar pesos alteraría cuestionarios y notas en curso). El dry-run sí se permite (para preparar), con el bloqueo anunciado.
- Idempotencia: re-subir el mismo archivo aplicado = dry-run con 0 cambios en todas las secciones.
- El archivo se procesa en memoria; no se persiste en disco/blob.

## Operación de carga inicial (runbook — NO es parte del producto)

1. Validar el importador contra el clone con el archivo real (carga completa 806 + estructura; segunda pasada = 0 cambios).
2. **Backup completo de Neon** (`pg_dump`) guardado local — con GO explícito de Christian.
3. **Purga** (script one-shot operado por Claude, transaccional): borra `Colaborador` (cascade arrastra asignaciones/resultados/feedbacks/objetivos individuales), `Ciclo`, `PeriodoObjetivos`, `Objetivo`, incidencias/cierres. Conserva `Usuario` (queda `colaboradorId` null transitorio), `RolAdmin`, evaluaciones + banco de preguntas, catálogos y `Config`. Verificación previa en el clone de que el login tolera cuenta sin colaborador.
4. Christian carga el Excel por la UI en prod (dry-run → aplicar) → re-vinculación automática de las cuentas del equipo.
5. Smoke test: conteos (806 colaboradores, 327 puestos), login de una cuenta re-vinculada, pesos de 2 puestos re-homologados espejo de su nivel nuevo.
6. Pruebas con grupos reducidos vía alcance flexible.

## Errores y bordes

- Colaborador del padrón con email duplicado dentro del archivo = bloqueante (regla del motor existente).
- Puesto que desaparece del Excel pero existe en BD con titulares: NO se elimina (el importador no borra puestos); aviso informativo. Puestos huérfanos se gestionan desde la UI de Puestos.
- Colaborador en BD que no viene en el padrón nuevo: el motor existente NO da bajas masivas — aviso con conteo (post-purga es irrelevante: la BD nace vacía; en recargas futuras evita bajas accidentales).
- Área o país del padrón que no existe: países = bloqueante (catálogo cerrado); áreas = alta automática con aviso (comportamiento del motor actual).
- Hoja 6 con puesto que no está en hoja 4 = bloqueante (todo puesto debe estar homologado).

## Testing

- **Unit del parser/validador** (fixtures sintéticos en memoria, sin BD): localización de encabezados, normalización/duplicados, jerarquía hoja 6 > hoja 3, sumas ≠ 100, competencia desconocida, derivación de nivel del padrón, mapeo de columnas de la hoja 5.
- **E2E en clone**: carga completa del archivo real ×2 (segunda = 0 cambios); purga + recarga + re-link verificado (login de una cuenta del equipo funciona y ve su hoja de vida nueva); pesos de un puesto re-homologado = su nivel nuevo.

## Fuera de alcance

- **Hoja 7 («Pesos evaluadores»), completa.** Decisión de Christian 05/08: la configuración de evaluadores se gestiona directamente en la plataforma; la hoja 7 del Excel se ignora. El importador la IGNORA por completo (esté presente o ausente en el libro, nunca es error) y nunca toca `Config.pesosModalidades` — esa configuración vive en Configuración → pesos de modalidades, que además maneja el set «sin reportes directos» que el Excel no contempla.
- `puntajeEsperado` por dimensión (perfil ideal del radar) vía Excel — se mantiene la edición en la UI de Puestos.
- Botón de purga/reemplazo total en la plataforma.
- Alta de dimensiones o competencias vía Excel (catálogo cerrado en BD).
