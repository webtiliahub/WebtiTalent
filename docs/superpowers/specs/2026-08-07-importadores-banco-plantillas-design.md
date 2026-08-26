# Importador del banco de preguntas + plantillas descargables + padrón en Excel — Diseño

**Fecha:** 2026-08-07
**Estado:** Aprobado por Christian (decisiones cerradas en conversación)

## Problema

Hunter necesita cargar el banco de preguntas de forma masiva y hoy solo se pueden crear una por una en la UI. Además, los importadores actuales (padrón, carga maestra) no ofrecen una plantilla descargable, así que los usuarios arman el archivo a ciegas — la causa raíz de los 63 errores del archivo v3 que corregimos ayer. Por último, el padrón importa CSV mientras carga maestra usa Excel; se quiere unificar todo en `.xlsx`.

## Decisiones de producto (validadas con Christian)

1. **Importador del banco de preguntas** nuevo, en **página dedicada** (`/admin/preguntas/importar`), alcanzada por un botón «Importar preguntas» arriba a la izquierda de la sección Banco de preguntas — mismo patrón que el padrón (`/admin/colaboradores/importar`). Formato **Excel de 2 hojas**: «Competencias» y «Potencial».
2. **Identidad de una pregunta = competencia + texto normalizado** (sin tildes, minúsculas, espacios colapsados). Si ya existe idéntica, se salta con aviso; si no, se crea. El importador solo da de alta (no edita preguntas existentes ni sus modalidades).
3. **Descarga de plantilla `.xlsx`** en los tres importadores (botón junto al input de archivo): encabezados + una fila de ejemplo + hoja «Catálogos» con los valores reales de la BD.
4. **Modalidades como 4 columnas con X** (JEFE · PAR · ASC · AUTO) en la hoja «Competencias».
5. **Validador estricto con sugerencias** como red de seguridad (no hay dropdowns nativos — SheetJS Community no los escribe, verificado). El dry-run bloquea y lista cada error con su fila; para valores de sistema inválidos sugiere el más parecido del catálogo («"Analitica" no existe — ¿quisiste decir "Analítica"?»).
6. **Padrón migrado a aceptar `.xlsx` además de `.csv`** (retrocompatible, detección por extensión). La plantilla que se ofrece es `.xlsx`.

## Alcance de una pregunta (recordatorio del modelo)

- `Pregunta` (competencias): `texto`, `competenciaId` (→ dimensión vía competencia), `modalidades TipoEvaluacion[]` (JEFE/PAR/ASCENDENTE/AUTO), `activa`. Sin orden ni escala.
- `PreguntaPotencial` (9-box, solo jefe): `texto`, `orden`, `activa`. Sin competencia ni modalidad.
- Catálogos: `Dimension` (nombre único) → `Competencia` (nombre único, cuelga de una dimensión).

## Arquitectura

### 1. Generador de plantillas Excel — `src/shared/lib/xlsx-descarga.ts` (cliente, nuevo)

Primer uso de **escritura** de Excel del proyecto (hoy xlsx solo se lee). Helper análogo al `descargarCsv` existente pero para `.xlsx`:

- `descargarXlsx(nombreArchivo: string, hojas: { nombre: string; filas: (string | number)[][] }[]): void` — arma el workbook con `XLSX.utils.aoa_to_sheet` + `book_append_sheet`, genera un `ArrayBuffer` con `XLSX.write(wb, { type: 'array', bookType: 'xlsx' })`, y dispara la descarga vía `Blob` + `URL.createObjectURL` + `<a download>` (mismo mecanismo que `csv.ts`).
- Sanitiza celdas de texto contra inyección de fórmulas (prefijo `'` si empieza con `= + - @`), reusando el criterio de `celdaSegura` de `csv.ts`.
- Import de xlsx: `import * as XLSX from 'xlsx'` (igual que `maestro/parser.ts`).

Los **datos** de cada plantilla (encabezados, fila de ejemplo, catálogos) los arma cada importador con los catálogos que su página server le pasa como props — no hay endpoint nuevo ni consulta desde el cliente. Cada plantilla incluye una hoja «Catálogos» construida desde la BD:

- **Banco de preguntas**: hoja «Catálogos» con Dimensión → Competencias (una tabla) + la lista de modalidades válidas.
- **Carga maestra**: hoja «Catálogos» con niveles, dimensiones, competencias, países y áreas existentes.
- **Padrón**: como su importador también acepta CSV, su plantilla `.xlsx` lleva la hoja de datos (13 columnas + ejemplo) y una hoja «Catálogos» con países, áreas y niveles válidos.

### 2. Sugeridor de valores — `src/shared/lib/sugerir.ts` (puro, nuevo)

- `sugerir(valor: string, opciones: string[]): string | null` — devuelve la opción más parecida por distancia de edición (Levenshtein) bajo un umbral relativo a la longitud, o `null` si nada se parece. Normaliza (sin tildes/minúsculas) antes de comparar. Lo usan los validadores para el mensaje «¿quisiste decir X?».

### 3. Importador del banco de preguntas — `src/features/admin/preguntas-import/` (nuevo)

Réplica del patrón del importador maestro (parser puro + planificador puro + acción con dry-run + componente cliente):

- **`parser.ts`** — `parseBancoPreguntas(buffer: ArrayBuffer): BancoParseado` con:
  ```
  type FilaCompetencia = { linea: number; dimension: string; competencia: string; texto: string; modalidades: TipoEvaluacion[] }
  type FilaPotencial = { linea: number; orden: number | null; texto: string }
  type BancoParseado = { competencias: FilaCompetencia[]; potencial: FilaPotencial[]; errores: string[] }
  ```
  Lee las hojas por nombre normalizado («competencias», «potencial»); tolera hojas de instrucciones («Léeme», «Catálogos») ignorándolas. Las modalidades se leen de las 4 columnas (celda no vacía = marcada). `errores` recoge fallos de estructura (hoja/encabezado ausente).
- **`plan.ts`** — `planificarBanco(parseado, bd): PlanBanco` puro. `bd` = snapshot plano `{ dimensiones: {nombre}[]; competencias: {nombre, dimensionNombre}[]; preguntasExistentes: {competenciaNombre, textoNorm}[]; potencialExistentes: {textoNorm}[] }`. Devuelve:
  ```
  type PlanBanco = {
    errores: string[]   // bloqueantes, con nº de fila y sugerencia cuando aplica
    avisos: string[]    // duplicados que se saltan, filas vacías ignoradas
    competenciasNuevas: { competencia: string; texto: string; modalidades: TipoEvaluacion[] }[]
    potencialNuevas: { orden: number; texto: string }[]
  }
  ```
  Reglas de validación: dimensión existe; competencia existe y pertenece a esa dimensión (si no, error con sugerencia); ≥1 modalidad marcada; texto no vacío; duplicado exacto (competencia+textoNorm) → aviso, no error. Potencial: texto no vacío; orden numérico (si vacío, se autoasigna `max+1` al aplicar, como `crearPreguntaPotencial`); duplicado por textoNorm → aviso.
- **`acciones.ts`** — `importarBancoPreguntas(formData: FormData, aplicar: boolean): Promise<ResultadoBanco>`. `'use server'`. Guard `requiereAdmin('EVALUACIONES', 'GESTIONAR')`. Lee `archivo.arrayBuffer()` (límite 10 MB), llama `parseBancoPreguntas`, arma el snapshot con Prisma, llama `planificarBanco`. Si `aplicar` y sin errores: crea las preguntas en transacción (`prisma.pregunta.createMany` para competencias resolviendo `competenciaId` por nombre; `preguntaPotencial.create` con orden autoasignado), registra `AuditLog` (`accion: 'BANCO_PREGUNTAS_IMPORTADO'`), `revalidatePath('/admin/preguntas')`. Devuelve el plan + resumen (`{ competenciasNuevas, potencialNuevas, saltadas }`).
- **`ImportadorBancoPreguntas.tsx`** — cliente. Input `accept=".xlsx"`, botón «Descargar plantilla» (usa `descargarXlsx` con los catálogos recibidos por props), patrón SIMULAR/APLICAR con modal de confirmación (mismo del importador maestro). Muestra el bloque de errores en rojo (bloquea Aplicar) y avisos en ámbar.
- **Página** `src/app/(app)/admin/preguntas/importar/page.tsx` — server. Guard `requiereAdmin('EVALUACIONES', 'GESTIONAR')`. Carga los catálogos (dimensiones con sus competencias) y los pasa al componente. Link «← Volver a Diseñar evaluación».
- **Botón de entrada**: en `BancoPreguntas` (`FormPregunta.tsx`), un `Link` «Importar preguntas» arriba a la izquierda, visible solo con permiso GESTIONAR, hacia `/admin/preguntas/importar`.

### 4. Padrón: aceptar Excel — `src/features/admin/importador.ts` + `ImportadorPadron.tsx`

- `importarPadron(formData, aplicar)` (`importador.ts:340`): antes de `parseCsv`, ramifica por extensión del archivo. Si `.xlsx` → `XLSX.read(await archivo.arrayBuffer())` + `sheet_to_json(ws, { header: 1, defval: '' })` de la primera hoja de datos, produciendo la **misma forma de filas** que hoy consume `procesarPadron` (array de objetos por `ENCABEZADO`). Si `.csv` → `parseCsv` como hoy. La validación de cabecera exacta (`importador.ts:355`) se aplica a ambos. `procesarPadron` no cambia (ya es agnóstico del origen; sigue `origen: 'CSV'`).
- `ImportadorPadron.tsx`: `accept=".csv,.xlsx,text/csv"` + botón «Descargar plantilla» (`.xlsx` vía `descargarXlsx`, con catálogos de país/área/nivel que la página le pase).
- La página de importar padrón pasa a cargar esos catálogos para la plantilla; el copy «plantilla CSV» se actualiza a «plantilla Excel o CSV».

### 5. Carga maestra: botón de plantilla — `CargaMaestra.tsx`

- Botón «Descargar plantilla» junto al input, que arma un `.xlsx` con las hojas que el parser espera (Niveles, Puestos, Competencias x Puesto, Pesos x Puesto, Padrón) + hoja «Catálogos», usando `descargarXlsx` con los catálogos que la página de Configuración le pase. Es plantilla vacía con encabezados y una fila de ejemplo — no exporta los datos actuales (eso sería otra función).

## Errores y bordes

- Archivo sin la hoja esperada (Competencias/Potencial) → error de estructura, dry-run lo muestra, Aplicar bloqueado.
- Competencia que existe pero en otra dimensión → error con la dimensión correcta sugerida.
- Fila totalmente vacía → se ignora con aviso (no error).
- Pregunta duplicada (ya en el banco) → aviso «se salta», no la recrea.
- Modalidad escrita en la cabecera pero ninguna X en la fila → error «sin modalidad».
- Padrón `.xlsx` con celdas numéricas donde se espera texto (ej. código, teléfono) → se normalizan a string antes de validar (evita `404` → `404` vs `"404"`).
- Excel con fórmulas en celdas → `sheet_to_json` devuelve el valor calculado; se trata como texto.
- Límite 10 MB por archivo (igual que carga maestra).

## Testing

- **Unit** `sugerir.test.ts`: exacto, cercano (una tilde, un typo), lejano → null.
- **Unit** `preguntas-import/parser.test.ts`: 2 hojas bien formadas; modalidades por columnas; hoja faltante; filas vacías. Fabrica workbooks in-memory con `aoa_to_sheet` (patrón de `maestro/parser.test.ts`).
- **Unit** `preguntas-import/plan.test.ts`: competencia inexistente (con sugerencia), competencia en dimensión equivocada, duplicado→aviso, sin modalidad→error, potencial sin orden→autoasigna, potencial duplicado→aviso.
- **E2E en clone**: descargar cada plantilla y verificar hojas/encabezados/catálogos; cargar un banco válido (dry-run → aplicar → preguntas creadas); cargar uno con errores (bloquea, muestra sugerencias); cargar el padrón como `.xlsx` (misma salida que el `.csv` equivalente).

## Fuera de alcance

- Dropdowns nativos en el Excel (SheetJS Community no los escribe; se decidió validador + hoja de catálogos).
- Editar preguntas existentes o sus modalidades vía importador (solo altas).
- Exportar el banco/padrón actuales a Excel (la plantilla es vacía con ejemplo; exportar datos sería otra función).
- Importar evaluaciones/plantillas de evaluación (esto es el banco de preguntas, no las evaluaciones armadas).
