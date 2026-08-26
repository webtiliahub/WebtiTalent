import type { HojaXlsx } from '@/shared/ui/xlsx-descarga'

/** Arma las hojas del .xlsx de plantilla del banco de preguntas con los catálogos reales. */
export function hojasPlantillaBanco(catalogos: { dimensiones: { nombre: string; competencias: { nombre: string }[] }[] }): HojaXlsx[] {
  const primera = catalogos.dimensiones[0]
  const ejemploDim = primera?.nombre ?? 'Analítica'
  const ejemploComp = primera?.competencias[0]?.nombre ?? 'Análisis de datos y KPIs'
  const competencias: HojaXlsx = {
    nombre: 'Competencias',
    filas: [
      ['Dimensión', 'Competencia', 'Texto', 'JEFE', 'PAR', 'ASC', 'AUTO', '1 · Insuficiente', '2 · En desarrollo', '3 · Competente', '4 · Superior', '5 · Excepcional'],
      [
        ejemploDim, ejemploComp, 'Ejemplo: ¿toma decisiones con datos?', 'X', 'X', '', 'X',
        'Decide por intuición, sin respaldo en datos.', 'Usa los datos de forma selectiva o superficial.', 'Consulta los datos disponibles antes de decidir.', 'Fundamenta sus decisiones con análisis sólido.', 'Sus decisiones basadas en datos son referencia para otros.',
      ],
    ],
  }
  const potencial: HojaXlsx = {
    nombre: 'Potencial',
    filas: [
      ['Orden', 'Texto', '1 · Insuficiente', '2 · En desarrollo', '3 · Competente', '4 · Superior', '5 · Excepcional'],
      [
        1, 'Ejemplo: ¿tiene proyección de crecimiento?',
        'No muestra interés por crecer más allá de su rol.', 'Declara interés pero sin acciones concretas.', 'Demuestra interés con acciones visibles.', 'Busca activamente mayores responsabilidades.', 'Su proyección es evidente y reconocida por otros.',
      ],
    ],
  }
  const catFilas: (string | number)[][] = [['Dimensión', 'Competencia']]
  for (const d of catalogos.dimensiones) {
    if (d.competencias.length === 0) catFilas.push([d.nombre, ''])
    for (const c of d.competencias) catFilas.push([d.nombre, c.nombre])
  }
  catFilas.push(
    [],
    ['Modalidades válidas', 'JEFE, PAR, ASC, AUTO (marca con X)'],
    ['Descriptores BARS', 'Opcionales pero completos: llena los 5 niveles o deja los 5 vacíos. Si la pregunta ya existe, la importación actualiza sus descriptores.'],
  )
  return [competencias, potencial, { nombre: 'Catálogos', filas: catFilas }]
}
