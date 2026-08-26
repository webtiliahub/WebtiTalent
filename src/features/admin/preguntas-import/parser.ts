import * as XLSX from 'xlsx'
import { normalizar } from '../maestro/parser'
import type { TipoEvaluacion } from '@/generated/prisma/enums'

/** Parser puro del Excel del banco de preguntas: hoja «Competencias» (Dimensión · Competencia ·
 * Texto · JEFE · PAR · ASC · AUTO · 5 descriptores BARS) y hoja «Potencial» (Orden · Texto).
 * `descriptores` trae los 5 valores crudos (con vacíos si faltan); el plan valida todo-o-nada. */

export type FilaCompetencia = { linea: number; dimension: string; competencia: string; texto: string; modalidades: TipoEvaluacion[]; descriptores: string[] }
export type FilaPotencial = { linea: number; orden: number | null; texto: string; descriptores: string[] }
export type BancoParseado = { competencias: FilaCompetencia[]; potencial: FilaPotencial[]; errores: string[] }

// ASC (columna) → ASCENDENTE (enum). Orden de columnas de modalidad tras Dimensión/Competencia/Texto.
const COLS_MODALIDAD: TipoEvaluacion[] = ['JEFE', 'PAR', 'ASCENDENTE', 'AUTO']

const txt = (v: unknown) => String(v ?? '').trim()

function hojaPorClave(wb: XLSX.WorkBook, clave: string): unknown[][] | null {
  const nombre = wb.SheetNames.find((n) => normalizar(n).includes(clave))
  if (!nombre) return null
  return XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, defval: '' }) as unknown[][]
}

export function parseBancoPreguntas(buffer: ArrayBuffer): BancoParseado {
  const errores: string[] = []
  const wb = XLSX.read(buffer)
  const competencias: FilaCompetencia[] = []
  const potencial: FilaPotencial[] = []

  const hComp = hojaPorClave(wb, 'competencia')
  if (!hComp) errores.push('Falta la hoja «Competencias».')
  else {
    for (let i = 1; i < hComp.length; i++) {
      const f = hComp[i] ?? []
      const dimension = txt(f[0]), competencia = txt(f[1]), texto = txt(f[2])
      if (!dimension && !competencia && !texto) continue // fila vacía
      const modalidades = COLS_MODALIDAD.filter((_, k) => txt(f[3 + k]) !== '')
      const descriptores = [0, 1, 2, 3, 4].map((k) => txt(f[7 + k]))
      competencias.push({ linea: i + 1, dimension, competencia, texto, modalidades, descriptores })
    }
  }

  const hPot = hojaPorClave(wb, 'potencial')
  if (!hPot) errores.push('Falta la hoja «Potencial».')
  else {
    for (let i = 1; i < hPot.length; i++) {
      const f = hPot[i] ?? []
      const ordenRaw = txt(f[0]), texto = txt(f[1])
      if (!ordenRaw && !texto) continue
      const orden = ordenRaw && !Number.isNaN(Number(ordenRaw)) ? Number(ordenRaw) : null
      const descriptores = [0, 1, 2, 3, 4].map((k) => txt(f[2 + k]))
      potencial.push({ linea: i + 1, orden, texto, descriptores })
    }
  }

  return { competencias, potencial, errores }
}
