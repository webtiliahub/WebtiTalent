import type { HojaXlsx } from '@/shared/ui/xlsx-descarga'

/** Puesto de ejemplo usado en Puestos/Competencias x Puesto/Pesos x Puesto. OJO: no debe
 * contener la palabra "puesto" — en la hoja "Competencias x Puesto", `parser.ts` decide si la
 * fila siguiente al encabezado es una fila-etiqueta de códigos mirando si su columna A contiene
 * "puesto" (ver `esFilaCodigosCompetencia`); si el ejemplo la contuviera, el parser saltaría
 * nuestra única fila de datos y la plantilla quedaría con la sección vacía. */
const PUESTO_EJEMPLO = 'Cargo Ejemplo'

/** Plantilla VACÍA de la carga maestra (encabezados + fila de ejemplo) en el formato que
 * `parseMaestro` (parser.ts) espera, más una hoja «Catálogos» de referencia. No exporta datos
 * actuales — sirve solo de molde para que RR.HH. la rellene y la vuelva a subir.
 *
 * Encabezados alineados a mano con `parser.ts`:
 * - Niveles/Pesos x Puesto: `parseMaestro` lee los pesos por dimensión por POSICIÓN fija (5
 *   columnas), no por nombre — por eso siempre se emiten 5 columnas "D1 %".."D5 %" (o "D1".."D5")
 *   sin importar cuántas dimensiones tenga el catálogo real, con una columna "Total" de relleno
 *   para no correr el resto de columnas (`% Competencias`/`% Objetivos` deben caer en las
 *   columnas 7 y 8 exactas).
 * - Puestos: ancla de encabezado exacta "Puesto" + "Nivel Jerárquico" (no solo "Nivel").
 * - Competencias x Puesto: la fila de encabezado son los NOMBRES de competencia desde la
 *   columna C; la fila de ejemplo no debe parecer una fila de códigos (ver `PUESTO_EJEMPLO`).
 * - Padrón: `parseMaestro` lee por NOMBRE de columna (case/acento-insensible), así que estos
 *   encabezados deben coincidir literalmente con las claves que usa `val(fila, '…')`.
 */
export function hojasPlantillaMaestra(catalogos: { niveles: string[]; dimensiones: string[]; competencias: string[]; paises: string[]; areas: string[] }): HojaXlsx[] {
  const niv = catalogos.niveles[0] ?? 'Apoyo'
  const area = catalogos.areas[0] ?? 'TI'
  const pais = catalogos.paises[0] ?? 'Perú'
  // Siempre 5 columnas de dimensión (posiciones fijas en el parser), con el nombre real del
  // catálogo como sufijo descriptivo cuando existe.
  const dimCols = Array.from({ length: 5 }, (_, i) => {
    const nombre = catalogos.dimensiones[i]
    return nombre ? `D${i + 1} % · ${nombre}` : `D${i + 1} %`
  })
  const dimColsPesos = Array.from({ length: 5 }, (_, i) => {
    const nombre = catalogos.dimensiones[i]
    return nombre ? `D${i + 1} · ${nombre}` : `D${i + 1}`
  })

  const niveles: HojaXlsx = {
    nombre: 'Niveles',
    filas: [
      ['Nivel', ...dimCols, 'Total', '% Competencias', '% Objetivos'],
      [niv, 20, 20, 20, 20, 20, 100, 60, 40],
    ],
  }

  const puestos: HojaXlsx = {
    nombre: 'Puestos',
    filas: [
      ['Puesto', 'Nivel Jerárquico', 'Área'],
      [PUESTO_EJEMPLO, niv, area],
    ],
  }

  const competenciasXPuesto: HojaXlsx = {
    nombre: 'Competencias x Puesto',
    filas: [
      ['Puesto', 'Nivel', ...catalogos.competencias],
      [PUESTO_EJEMPLO, niv, ...catalogos.competencias.map(() => 'X')],
    ],
  }

  const pesosXPuesto: HojaXlsx = {
    nombre: 'Pesos x Puesto',
    filas: [
      ['Puesto', 'Nivel', ...dimColsPesos, 'Total'],
      [PUESTO_EJEMPLO, niv, 20, 20, 20, 20, 20, 100],
    ],
  }

  const padron: HojaXlsx = {
    nombre: 'Padrón',
    filas: [
      ['codigo', 'documento', 'nombres', 'apellidos', 'email', 'telefono', 'pais', 'area', 'cargo', 'nivel_jerarquico', 'codigo_jefe', 'nivel_liderazgo', 'fecha_ingreso'],
      ['PER-001', '40967470', 'Nombre', 'Apellido', 'correo@hunter.com', '+51 999 999 999', pais, area, PUESTO_EJEMPLO, niv, '', '', '2024-01-15'],
    ],
  }

  const catalogosHoja: HojaXlsx = {
    nombre: 'Catálogos',
    filas: [
      ['Niveles', ...catalogos.niveles],
      ['Dimensiones', ...catalogos.dimensiones],
      ['Competencias', ...catalogos.competencias],
      ['Países', ...catalogos.paises],
      ['Áreas', ...catalogos.areas],
    ],
  }

  return [niveles, puestos, competenciasXPuesto, pesosXPuesto, padron, catalogosHoja]
}
