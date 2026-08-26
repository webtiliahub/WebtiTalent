# Métricas del formulario: rediseño por puesto (2026-07-13)

## Problema
La matriz competencias × puestos de la pestaña "Métricas del formulario" agrega una columna por puesto:
no escala a los ~20-40 puestos por nivel que tendrá Hunter en producción. El "balance por dimensión"
comparaba contra el peso *promedio* de los puestos, que con puestos heterogéneos es engañoso.

## Decisiones (Christian, 13-jul)
1. Uso primario = veredicto global ("¿puedo guardar sin dejar a nadie descubierto?"); la revisión a
   detalle por puesto es el drill-down.
2. La lectura transversal de la matriz se conserva destilada: bloque "Competencias sin cubrir"
   ordenado por número de puestos afectados.
3. El balance por dimensión vive SOLO en la ficha de cada puesto, contra su peso real
   (desaparece el global promediado).
4. Interacción del drill-down: accordion (puestos con huecos primero), no master-detail ni dropdown.

## Diseño
Pestaña "📊 Métricas del formulario" (en vivo sobre la selección, guardada o no):

1. **Cards de veredicto**: alcance (puestos · colaboradores activos) · preguntas por modalidad ·
   semáforo de cobertura global (modalidad Jefe).
2. **Competencias sin cubrir** (solo si hay huecos): filas ordenadas por impacto desc —
   competencia · "afecta a N puestos" (chips) · botón "＋ Agregar preguntas" que abre el modal de
   selección de esa competencia en modalidad Jefe, sin salir de las métricas.
3. **Puestos del alcance** (accordion): fila = nombre · colaboradores · cuestionario efectivo
   (Jefe/Pares/Auto) · chip cobertura X/Y. Orden: con huecos primero. Ficha expandida:
   - Competencias del puesto agrupadas por dimensión: ✓ con nº de preguntas o ⚠ sin pregunta
     (con botón agregar).
   - Cobertura por dimensión del puesto: barra de % de preguntas vs peso real del puesto
     (PesoDimensionPuesto), ⚠ si difieren ≥15 puntos.

Se eliminan: matriz, tabla global "cuestionario efectivo", balance global.

## Fuera de alcance
Métricas por modalidades distintas de Jefe en la ficha (Pares/Auto solo como conteos);
persistencia de qué puestos están expandidos; export.
