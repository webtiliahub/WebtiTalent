# Vista comparativa en Análisis del ciclo — Diseño

**Fecha:** 2026-08-07
**Estado:** Aprobado por Christian (decisiones cerradas en conversación, incluidos mockups conceptuales sobre capturas de la página actual)

## Problema

El equipo de Hunter pidió comparar el rendimiento entre áreas, y la RR.HH. Regional necesita comparar equipos de distintos países (ej. RRHH Perú vs RRHH Chile). Hoy la página de Análisis del ciclo (`/admin/resultados/analisis`) solo admite UN corte por filtros (área + nivel + país) con el total de la empresa como referencia; no hay forma de poner dos grupos frente a frente.

Además, durante el diseño se detectó que el punteado del radar «Comparación por dimensión» muestra el ciclo anterior, cuando la intención de producto siempre fue mostrar el **perfil esperado** (la expectativa definida al configurar los puestos), como ya hace el radar de la hoja de vida por persona.

## Decisiones de producto (validadas con Christian)

1. **Vista comparativa de página completa** (no una card aislada): botón «Vista comparativa» a la derecha de la fila de filtros que abre un panel pequeño para elegir **Grupo A (país + área) vs Grupo B (país + área)**. Al comparar, toda la página entra en modo comparación con una leyenda de color general.
2. **Exactamente 2 grupos**, cada uno definido por país + área. El **área es opcional**: sin área = el país completo (permite «Perú total vs Chile total»). Ambos selectores son **combobox con búsqueda** (patrón del padrón). Las **áreas sin evaluados en el ciclo elegido no aparecen** en el combobox.
3. **Colores fijos de la vista**: Grupo A = rojo Hunter (`#f0163e`), Grupo B = azul (`sky-600`), organización = **gris punteado**. La leyenda aparece sobre los KPIs y rige todos los gráficos.
4. **Compartible por URL**: los grupos viajan por `searchParams` (`comparar=1&aPais&aArea&bPais&bArea`). El link solo precarga la pantalla: el servidor exige sesión con permiso RESULTADOS y valida AMBOS grupos contra el alcance del observador (el país es el techo). RRHH-país tiene el país fijo al suyo (compara áreas internas); solo Regional cruza países.
5. **Radar corregido en AMBAS vistas**: el punteado deja de ser el ciclo anterior y pasa a ser el **perfil esperado** del corte — promedio del `puntajeEsperado` (PesoDimensionPuesto) del puesto de cada evaluado, por dimensión. En vista normal: obtenido (rojo) vs esperado del corte filtrado. En vista comparativa: esperado de la **organización** (alcance completo del observador) punteado detrás + polígonos A y B encima.
6. **Gráfico de variación en comparación**: dos barras por dimensión, una por equipo, mostrando el **cambio vs el ciclo anterior** de cada equipo (el gráfico conserva su significado actual; el radar ya cuenta la historia del esperado).
7. **Se oculta en vista comparativa**: Puntos de acción, Pain points por área y dimensión, Outliers estadísticos, Brecha de autopercepción, Sesgo del evaluador y Competencias vs objetivos descuadrados (son diagnósticos de un corte, no comparables lado a lado). También se ocultan los filtros globales de área/nivel/país (los grupos definen el corte); el selector de **ciclo** sigue mandando sobre toda la vista. Botón «Salir de la comparación» restaura la vista normal.

## Comportamiento por sección (vista comparativa activa)

| Sección | Comportamiento |
|---|---|
| Leyenda | ● rojo «{Grupo A}» · ● azul «{Grupo B}» · ┄ gris «Organización», con el n de cada grupo. Nombre de grupo = «{País} · {Área}» o «{País} (todas las áreas)» |
| KPIs (4 scorecards) | Duales: valor de A y valor de B lado a lado con su punto de color (nota promedio, evaluados, % destacado ≥4.0, % en atención <3.0), cada uno con su n |
| Distribución de notas | Dos **curvas normales** de color (A y B) + curva punteada gris de la organización. Las **barras se apilan por color** en cada rango (segmento A + segmento B). El clic en una barra abre el listado de personas de ese rango con el punto de color de su grupo |
| Evolución entre ciclos | Tres líneas: A y B en sus colores + organización punteada. El expandible «Detalle por área» se oculta en esta vista |
| Radar por dimensión | Esperado organización (punteado, detrás) + polígono A + polígono B |
| Variación por dimensión | Barras divergentes agrupadas: por cada dimensión, una barra por equipo con su cambio vs el ciclo anterior (y la fila Total con ambos) |

## Arquitectura

### Datos — `src/features/resultados/comparacion.ts` (nuevo)

`comparacionCiclo(cicloId, wherePais, grupoA, grupoB)` con `Grupo = { paisId: string; areaId?: string }`. Reutiliza las piezas de `analisis.ts` (media/mediana/desviacion/curvaNormal, `vigente`, `notaDimDe`) y devuelve, por grupo y para la organización (alcance del observador):

- `kpis`: n, promedio, mediana, sigma, tramos (alto/bajo con %)
- `distribucion`: bins apilados (`{ desde, hasta, nA, nB }`), personas por bin con su grupo, curva A, curva B, curva organización (normalizadas al estilo de `curvaRef` actual para que tamaños distintos no engañen)
- `evolucion`: serie de promedios por ciclo cerrado para A, B y organización (mismos ciclos ordenados; un grupo sin datos en un ciclo salta ese punto)
- `dimensiones`: por dimensión — nota de A, nota de B, esperado organización, y delta vs ciclo anterior de A y de B

**Esperado por dimensión** (usado también en la vista normal): promedio del `puntajeEsperado` del puesto de cada evaluado del corte (un evaluado sin puesto o sin peso en la dimensión no aporta). Cálculo en helper compartido para que `analisis.ts` (vista normal, corte filtrado) y `comparacion.ts` (organización) usen la misma regla.

**Validación de alcance en el servidor**: los grupos llegan por URL pero se validan contra `alcancePaisWhere`/sesión — un `paisId` fuera del alcance del observador se rechaza (la vista cae a normal con aviso). Nunca se consulta fuera del `wherePais`.

### UI

- **`SelectorComparacion.tsx`** (client): botón «Vista comparativa» + panel con 2×(combobox país + combobox área) y botón «Comparar» que navega con los `searchParams`. Recibe del servidor la lista de países del alcance y las áreas CON evaluados en el ciclo elegido (por país). Con la comparación activa muestra los grupos elegidos y «Salir de la comparación».
- **`page.tsx`**: rama `comparar=1` válida → llama `comparacionCiclo` y renderiza la variante comparativa de cada sección; oculta las cards no comparables y los filtros globales de área/nivel/país.
- **Gráficos**: `HistogramaInteractivo` gana un modo apilado (segmentos por grupo + 2 curvas + curva ref); `EvolucionChart` acepta series múltiples (2 de color + 1 punteada); `RadarDimensiones` gana un polígono B opcional (azul); `BarrasDelta` gana modo agrupado (dos barras por dimensión con leyenda de color). Todos con cambios retrocompatibles — la vista normal no cambia de aspecto salvo el radar (punto 5).

## Errores y bordes

- Grupo sin evaluados en el ciclo: la vista carga con aviso en el color del grupo («{Grupo B}: sin evaluados en este ciclo») y los gráficos muestran solo el grupo con datos; no rompe.
- Grupos idénticos (mismo país y misma área): aviso «elige dos grupos distintos», no se activa la comparación.
- Parámetros inválidos o fuera de alcance: la página cae a la vista normal (mismo patrón de los filtros actuales, que ignoran IDs desconocidos).
- n chico: el n de cada grupo se muestra siempre en la leyenda y los KPIs; sin umbral mínimo (RRHH sabe leer un n=3).
- Ciclo sin ciclo anterior: el gráfico de variación muestra el vacío actual («Sin ciclo anterior para comparar»).
- Sin `puntajeEsperado` cargado para los puestos del corte: el radar omite el polígono esperado (como la hoja de vida cuando el puesto no tiene perfil).

## Testing

- **Unit** (`comparacion.test.ts`): agregado del esperado por dimensión (evaluados con puestos distintos, sin puesto, sin peso en una dimensión); bins apilados (conteos por grupo); resolución/validación de grupos contra el alcance (Regional vs RRHH-país, país fuera de alcance, grupos idénticos, área opcional).
- **E2E visual en clone**: activar comparación como Regional (dos países), como RRHH-país (dos áreas del suyo), grupo vacío, URL manipulada con país fuera de alcance (debe caer a vista normal), clic en barra apilada, y verificación del radar de la vista normal con el esperado.

## Fuera de alcance

- Más de 2 grupos, o nivel jerárquico como parte de la definición de grupo.
- Comparar las secciones diagnósticas (pain points, outliers, brechas, sesgos, descuadres).
- Export/PDF de la vista comparativa.
