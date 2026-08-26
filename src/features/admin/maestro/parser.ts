import * as XLSX from 'xlsx'

/** Sin tildes, minúsculas, espacios colapsados — criterio único de matching del importador. */
export function normalizar(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

export type SeccionNiveles = { nivel: string; pesosDim: number[]; compPct: number; objPct: number }[]
export type SeccionPuestos = { puesto: string; nivel: string }[]
export type SeccionCompetencias = { puesto: string; competencias: string[] }[]
export type SeccionPesosPuesto = { puesto: string; nivel: string; pesosDim: number[] }[]
export type FilaPadronMaestro = {
  linea: number; codigo: string; documento: string; nombres: string; apellidos: string
  email: string; telefono: string; pais: string; area: string; cargo: string
  nivel: string; codigoJefe: string; liderazgo: string; fechaIngreso: string
}
export type MaestroParseado = {
  niveles: SeccionNiveles; puestos: SeccionPuestos; competencias: SeccionCompetencias
  pesosPuesto: SeccionPesosPuesto; padron: FilaPadronMaestro[]
  errores: string[] // hoja/encabezado ausente
}

type ClaveSeccion = 'niveles' | 'puestos' | 'competencias' | 'pesosPuesto' | 'padron'
type Fila = unknown[]

// Identificación de hojas: la CLAVE debe estar contenida en el nombre normalizado.
// OJO: 'puestos' también matchea 'competencias x puesto' y 'pesos x puesto' —
// se resuelve por especificidad: claves más largas primero, excluyendo hojas ya asignadas.
// La hoja 7 ("Pesos evaluadores") ya NO se identifica ni se lee: esa configuración se gestiona
// directamente en la plataforma (Configuración → pesos de modalidades) — decisión de Christian 05/08.
const CLAVES_HOJA: Record<ClaveSeccion, string> = {
  niveles: 'niveles', puestos: 'puestos', competencias: 'competencias x puesto',
  pesosPuesto: 'pesos x puesto', padron: 'padron',
}

// Nombres canónicos usados en los mensajes de error cuando la hoja no aparece en el libro.
const NOMBRES_SECCION: Record<ClaveSeccion, string> = {
  niveles: 'Niveles', puestos: 'Puestos', competencias: 'Competencias x Puesto',
  pesosPuesto: 'Pesos x Puesto', padron: 'Padrón',
}

// Localización de encabezado: primera fila que contiene TODAS las columnas ancla de la sección.
// (hoja 5 "Competencias x Puesto" tiene encabezado doble — ver localizarEncabezadoCompetencias)
const ANCLAS: Record<'niveles' | 'puestos' | 'pesosPuesto' | 'padron', string[]> = {
  niveles: ['nivel', 'd1 %'], puestos: ['puesto', 'nivel jerarquico'],
  pesosPuesto: ['puesto', 'nivel', 'd1'],
  padron: ['codigo', 'documento', 'nombres'],
}

/** Asigna cada hoja del libro a su sección, resolviendo ambigüedades por especificidad de la clave. */
function identificarHojas(nombresHoja: string[]): Partial<Record<ClaveSeccion, string>> {
  const usadas = new Set<string>()
  const resultado: Partial<Record<ClaveSeccion, string>> = {}
  const entradas = (Object.entries(CLAVES_HOJA) as [ClaveSeccion, string][]).sort((a, b) => b[1].length - a[1].length)
  for (const [clave, patron] of entradas) {
    const hoja = nombresHoja.find((n) => !usadas.has(n) && normalizar(n).includes(patron))
    if (hoja) {
      resultado[clave] = hoja
      usadas.add(hoja)
    }
  }
  return resultado
}

/** Primera fila (0-based) cuyas celdas contienen, entre todas, cada una de las anclas dadas. */
function localizarEncabezado(filas: Fila[], anclas: string[]): number {
  for (let i = 0; i < filas.length; i++) {
    const celdas = filas[i].map((c) => normalizar(String(c ?? '')))
    if (anclas.every((a) => celdas.some((c) => c.includes(a)))) return i
  }
  return -1
}

const ES_CODIGO_COMPETENCIA = /^\d+(\.\d+)?$/

/** ¿Es esta la fila de NOMBRES de competencia? Sus celdas desde la col. 3 son textos
 *  reales — ni códigos ("1.1", "1.2") ni etiquetas de dimensión ("D1 · Analítica"). */
function esFilaNombresCompetencia(fila: Fila): boolean {
  const candidatas = fila.slice(2).map((c) => String(c ?? '').trim()).filter((c) => c !== '')
  if (candidatas.length === 0) return false
  return candidatas.every((c) => !ES_CODIGO_COMPETENCIA.test(c) && !c.includes('·'))
}

/** ¿Es esta la fila-etiqueta "Puesto | Nivel | 1.1 | 1.2 | ... | Total" (con códigos)? */
function esFilaCodigosCompetencia(fila: Fila): boolean {
  return normalizar(String(fila[0] ?? '')).includes('puesto')
}

/** Hoja "Competencias x Puesto": encabezado de DOS o TRES filas según el archivo —
 *  (dimensiones,) NOMBRES de competencia, (códigos "Puesto | Nivel | 1.1 | 1.2 | ...").
 *  La fila real de nombres es la primera cuyo contenido desde la col. 3 son textos
 *  largos (no códigos, no etiquetas de dimensión con "·"). Si la fila siguiente es la
 *  fila-etiqueta de códigos, se salta como parte del encabezado y los datos empiezan después. */
function localizarEncabezadoCompetencias(filas: Fila[]): { nombres: number; datos: number } | null {
  for (let i = 0; i < filas.length; i++) {
    if (esFilaNombresCompetencia(filas[i])) {
      const siguiente = filas[i + 1]
      const datos = siguiente && esFilaCodigosCompetencia(siguiente) ? i + 2 : i + 1
      return { nombres: i, datos }
    }
  }
  return null
}

/** Filas de datos: desde `inicio` hasta la primera fila completamente vacía o el fin de la hoja. */
function filasDeDatos(filas: Fila[], inicio: number): { fila: Fila; indice: number }[] {
  const resultado: { fila: Fila; indice: number }[] = []
  for (let i = inicio; i < filas.length; i++) {
    const fila = filas[i] ?? []
    const vacia = fila.length === 0 || fila.every((c) => String(c ?? '').trim() === '')
    if (vacia) break
    resultado.push({ fila, indice: i })
  }
  return resultado
}

/** Mapa nombre-de-columna-normalizado → índice. Permite leer por nombre y tolera columnas extra (p. ej. la de observaciones del padrón, que simplemente nunca se consulta). */
function mapaColumnas(encabezado: Fila): Map<string, number> {
  const mapa = new Map<string, number>()
  encabezado.forEach((celda, i) => {
    const clave = normalizar(String(celda ?? ''))
    if (clave && !mapa.has(clave)) mapa.set(clave, i)
  })
  return mapa
}

function aHoja(wb: XLSX.WorkBook, nombre: string): Fila[] {
  const ws = wb.Sheets[nombre]
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as Fila[]
}

export function parseMaestro(buffer: ArrayBuffer): MaestroParseado {
  const wb = XLSX.read(buffer)
  const hojas = identificarHojas(wb.SheetNames)
  const errores: string[] = []

  const niveles: SeccionNiveles = []
  const puestos: SeccionPuestos = []
  const competencias: SeccionCompetencias = []
  const pesosPuesto: SeccionPesosPuesto = []
  const padron: FilaPadronMaestro[] = []

  // --- 3. Niveles: pesos por dimensión ---
  if (!hojas.niveles) {
    errores.push(`Hoja "${NOMBRES_SECCION.niveles}" no encontrada en el archivo`)
  } else {
    const filas = aHoja(wb, hojas.niveles)
    const idx = localizarEncabezado(filas, ANCLAS.niveles)
    if (idx === -1) {
      errores.push(`No se encontró el encabezado esperado en la hoja "${hojas.niveles}"`)
    } else {
      for (const { fila } of filasDeDatos(filas, idx + 1)) {
        const nivel = String(fila[0] ?? '').trim()
        if (!nivel) continue
        niveles.push({
          nivel,
          pesosDim: [1, 2, 3, 4, 5].map((c) => Number(fila[c])),
          compPct: Number(fila[7]),
          objPct: Number(fila[8]),
        })
      }
    }
  }

  // --- 4. Puestos del padrón ---
  if (!hojas.puestos) {
    errores.push(`Hoja "${NOMBRES_SECCION.puestos}" no encontrada en el archivo`)
  } else {
    const filas = aHoja(wb, hojas.puestos)
    const idx = localizarEncabezado(filas, ANCLAS.puestos)
    if (idx === -1) {
      errores.push(`No se encontró el encabezado esperado en la hoja "${hojas.puestos}"`)
    } else {
      for (const { fila } of filasDeDatos(filas, idx + 1)) {
        const puesto = String(fila[0] ?? '').trim()
        if (!puesto) continue
        puestos.push({ puesto, nivel: String(fila[1] ?? '').trim() })
      }
    }
  }

  // --- 5. Competencias x Puesto ---
  if (!hojas.competencias) {
    errores.push(`Hoja "${NOMBRES_SECCION.competencias}" no encontrada en el archivo`)
  } else {
    const filas = aHoja(wb, hojas.competencias)
    const idx = localizarEncabezadoCompetencias(filas)
    if (idx === null) {
      errores.push(`No se encontró el encabezado esperado en la hoja "${hojas.competencias}"`)
    } else {
      const encabezado = filas[idx.nombres]
      const nombresCompetencia = encabezado.slice(2).map((c) => String(c ?? '').trim())
      for (const { fila } of filasDeDatos(filas, idx.datos)) {
        const puesto = String(fila[0] ?? '').trim()
        if (!puesto) continue
        const marcadas: string[] = []
        nombresCompetencia.forEach((nombre, j) => {
          if (!nombre) return
          if (String(fila[j + 2] ?? '').trim() !== '') marcadas.push(nombre)
        })
        competencias.push({ puesto, competencias: marcadas })
      }
    }
  }

  // --- 6. Pesos x Puesto ---
  if (!hojas.pesosPuesto) {
    errores.push(`Hoja "${NOMBRES_SECCION.pesosPuesto}" no encontrada en el archivo`)
  } else {
    const filas = aHoja(wb, hojas.pesosPuesto)
    const idx = localizarEncabezado(filas, ANCLAS.pesosPuesto)
    if (idx === -1) {
      errores.push(`No se encontró el encabezado esperado en la hoja "${hojas.pesosPuesto}"`)
    } else {
      for (const { fila } of filasDeDatos(filas, idx + 1)) {
        const puesto = String(fila[0] ?? '').trim()
        if (!puesto) continue
        pesosPuesto.push({
          puesto,
          nivel: String(fila[1] ?? '').trim(),
          pesosDim: [2, 3, 4, 5, 6].map((c) => Number(fila[c])),
        })
      }
    }
  }

  // --- 8. Padrón de colaboradores ---
  // NOTA: la hoja 7 ("Pesos evaluadores") se IGNORA por completo — esté presente o ausente en el
  // libro, no es error. Esa configuración se gestiona directamente en la plataforma
  // (Configuración → pesos de modalidades, que además maneja el set "sin reportes directos" que
  // el Excel no contempla). Decisión de Christian 05/08.
  if (!hojas.padron) {
    errores.push(`Hoja "${NOMBRES_SECCION.padron}" no encontrada en el archivo`)
  } else {
    const filas = aHoja(wb, hojas.padron)
    const idx = localizarEncabezado(filas, ANCLAS.padron)
    if (idx === -1) {
      errores.push(`No se encontró el encabezado esperado en la hoja "${hojas.padron}"`)
    } else {
      const cols = mapaColumnas(filas[idx])
      const val = (fila: Fila, nombre: string) => {
        const i = cols.get(nombre)
        return i === undefined ? '' : String(fila[i] ?? '').trim()
      }
      for (const { fila, indice } of filasDeDatos(filas, idx + 1)) {
        const codigo = val(fila, 'codigo')
        if (!codigo) continue
        padron.push({
          linea: indice + 1, // número de fila real en la hoja (1-based), para mensajes "Fila N"
          codigo,
          documento: val(fila, 'documento'),
          nombres: val(fila, 'nombres'),
          apellidos: val(fila, 'apellidos'),
          email: val(fila, 'email'),
          telefono: val(fila, 'telefono'),
          pais: val(fila, 'pais'),
          area: val(fila, 'area'),
          cargo: val(fila, 'cargo'),
          nivel: val(fila, 'nivel_jerarquico'),
          codigoJefe: val(fila, 'codigo_jefe'),
          liderazgo: val(fila, 'nivel_liderazgo'),
          fechaIngreso: val(fila, 'fecha_ingreso'),
        })
      }
    }
  }

  return { niveles, puestos, competencias, pesosPuesto, padron, errores }
}
