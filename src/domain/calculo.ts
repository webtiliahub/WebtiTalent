/**
 * Motor de cálculo de la evaluación 360 — funciones puras (sin I/O).
 *
 * Modelo:
 * - Nota de competencias: promedio por dimensión → ponderado por los pesos del PUESTO
 *   (suman 100) → ponderado por modalidad (Jefe 60 / Pares 25 / Ascendente 15 / Auto 0).
 *   Si una dimensión o modalidad no tiene respuestas, los pesos se renormalizan.
 * - Cumplimiento de objetivos: Σ(logro × peso) / Σ(pesos), en %.
 * - Nota final: combinación competencias/objetivos según nivel jerárquico
 *   (Gerencial 50/50 · Mando Medio 60/40 · Especialista 50/50 · Apoyo 70/30).
 * - Potencial: promedio de las 5 preguntas del jefe (eje Y del 9-Box).
 */

export type Modalidad = 'JEFE' | 'PAR' | 'ASCENDENTE' | 'AUTO'

export type RespuestaCalculo = {
  modalidad: Modalidad
  dimensionId: string
  valor: number // 1–5
}

export type PesosModalidades = Record<Modalidad, number>
export type PesosDimension = { dimensionId: string; peso: number }[]
export type CombinacionNivel = { comp: number; obj: number }

/** Nota 1–5 de una modalidad: promedio por dimensión ponderado por pesos del puesto (renormalizados a las dimensiones presentes). */
export function notaModalidad(respuestas: RespuestaCalculo[], pesosDimension: PesosDimension): number | null {
  if (respuestas.length === 0) return null
  const porDimension = new Map<string, number[]>()
  for (const r of respuestas) {
    if (!porDimension.has(r.dimensionId)) porDimension.set(r.dimensionId, [])
    porDimension.get(r.dimensionId)!.push(r.valor)
  }
  let suma = 0
  let pesoTotal = 0
  for (const { dimensionId, peso } of pesosDimension) {
    const valores = porDimension.get(dimensionId)
    if (!valores || valores.length === 0) continue
    const promedio = valores.reduce((a, b) => a + b, 0) / valores.length
    suma += promedio * peso
    pesoTotal += peso
  }
  if (pesoTotal === 0) {
    // El puesto no tiene pesos para las dimensiones respondidas: promedio simple
    const todos = respuestas.map((r) => r.valor)
    return todos.reduce((a, b) => a + b, 0) / todos.length
  }
  return suma / pesoTotal
}

/** Nota 1–5 de competencias combinando modalidades (renormaliza si falta alguna). */
export function notaCompetencias(
  respuestas: RespuestaCalculo[],
  pesosDimension: PesosDimension,
  pesosModalidades: PesosModalidades,
): number | null {
  let suma = 0
  let pesoTotal = 0
  for (const modalidad of ['JEFE', 'PAR', 'ASCENDENTE', 'AUTO'] as Modalidad[]) {
    const peso = pesosModalidades[modalidad] ?? 0
    if (peso === 0) continue
    const nota = notaModalidad(respuestas.filter((r) => r.modalidad === modalidad), pesosDimension)
    if (nota === null) continue
    suma += nota * peso
    pesoTotal += peso
  }
  return pesoTotal === 0 ? null : suma / pesoTotal
}

export type DimensionDesglose = {
  dimensionId: string
  nota: number // 1–5: combinación de modalidades dentro de la dimensión
  pesoEfectivo: number // 0–1: contribución real a la nota de competencias (suman 1)
}

/** Desglose EXACTO de la nota de competencias por dimensión: reagrupa la misma fórmula
 * (que es lineal en los promedios dimensión×modalidad) para expresarla como
 * Σ pesoEfectivo_d × nota_d. Sirve para mostrar y CALIBRAR por dimensión sin alterar
 * la agregación aprobada (promedio por dimensión → pesos del puesto → pesos por modalidad). */
export function desgloseCompetencias(
  respuestas: RespuestaCalculo[],
  pesosDimension: PesosDimension,
  pesosModalidades: PesosModalidades,
): DimensionDesglose[] {
  // α_dm = (pesoModalidad/Σmod) × (pesoDim renormalizado dentro de la modalidad)
  const alfa = new Map<string, { suma: number; pesoTotal: number }>() // por dimensión
  const modalidades = (['JEFE', 'PAR', 'ASCENDENTE', 'AUTO'] as Modalidad[])
    .map((m) => ({ m, peso: pesosModalidades[m] ?? 0, resp: respuestas.filter((r) => r.modalidad === m) }))
    .filter((x) => x.peso > 0 && x.resp.length > 0)
  const pesoModTotal = modalidades.reduce((a, x) => a + x.peso, 0)
  if (pesoModTotal === 0) return []

  for (const { peso, resp } of modalidades) {
    const porDimension = new Map<string, number[]>()
    for (const r of resp) {
      if (!porDimension.has(r.dimensionId)) porDimension.set(r.dimensionId, [])
      porDimension.get(r.dimensionId)!.push(r.valor)
    }
    // Pesos de dimensión renormalizados a las dimensiones presentes en ESTA modalidad
    // (promedio simple si el puesto no pondera ninguna presente — espejo de notaModalidad)
    const presentes = pesosDimension.filter((p) => porDimension.has(p.dimensionId))
    const pesoDimTotal = presentes.reduce((a, p) => a + p.peso, 0)
    const pesoDe = (dimensionId: string) =>
      pesoDimTotal > 0
        ? (presentes.find((p) => p.dimensionId === dimensionId)?.peso ?? 0) / pesoDimTotal
        : 1 / porDimension.size
    for (const [dimensionId, valores] of porDimension) {
      const promedio = valores.reduce((a, b) => a + b, 0) / valores.length
      const a = (peso / pesoModTotal) * pesoDe(dimensionId)
      if (a === 0) continue
      const acc = alfa.get(dimensionId) ?? { suma: 0, pesoTotal: 0 }
      acc.suma += promedio * a
      acc.pesoTotal += a
      alfa.set(dimensionId, acc)
    }
  }
  return [...alfa.entries()].map(([dimensionId, { suma, pesoTotal }]) => ({
    dimensionId,
    nota: suma / pesoTotal,
    pesoEfectivo: pesoTotal,
  }))
}

/** Nota de competencias desde el desglose, con ajustes de calibración por dimensión
 * (el ajuste reemplaza la nota de esa dimensión; los pesos efectivos no cambian). */
export function notaCompetenciasDesdeDesglose(
  desglose: DimensionDesglose[],
  ajustes?: Record<string, number>,
): number | null {
  if (desglose.length === 0) return null
  const pesoTotal = desglose.reduce((a, d) => a + d.pesoEfectivo, 0)
  const suma = desglose.reduce((a, d) => a + (ajustes?.[d.dimensionId] ?? d.nota) * d.pesoEfectivo, 0)
  return pesoTotal === 0 ? null : suma / pesoTotal
}

export type LogroCalculo = { peso: number; logro: number /* % */ }

/** Cumplimiento ponderado de objetivos en % (cap por objetivo a 100%: cumplir es el máximo, sin sobredimensionar). */
export function cumplimientoObjetivos(logros: LogroCalculo[]): number | null {
  const validos = logros.filter((l) => l.peso > 0)
  if (validos.length === 0) return null
  const pesoTotal = validos.reduce((a, l) => a + l.peso, 0)
  const suma = validos.reduce((a, l) => a + Math.min(l.logro, 100) * l.peso, 0)
  return suma / pesoTotal
}

/** Nota final 1–5: combina competencias y objetivos según el nivel (renormaliza si falta un componente). */
export function notaFinal(
  notaComp: number | null,
  cumplimientoPct: number | null,
  combinacion: CombinacionNivel,
): number | null {
  const notaObj = cumplimientoPct === null ? null : Math.min(cumplimientoPct, 100) / 20 // % → escala 5
  let suma = 0
  let pesoTotal = 0
  if (notaComp !== null) { suma += notaComp * combinacion.comp; pesoTotal += combinacion.comp }
  if (notaObj !== null) { suma += notaObj * combinacion.obj; pesoTotal += combinacion.obj }
  return pesoTotal === 0 ? null : suma / pesoTotal
}

/** Potencial 1–5: promedio simple de las respuestas del jefe. */
export function potencial(valores: number[]): number | null {
  if (valores.length === 0) return null
  return valores.reduce((a, b) => a + b, 0) / valores.length
}

// ───────────── 9-Box ─────────────

export type Tramo = 'BAJO' | 'MEDIO' | 'ALTO'

export function tramo(valor: number): Tramo {
  if (valor < 3) return 'BAJO'
  if (valor < 4) return 'MEDIO'
  return 'ALTO'
}

/** Matriz 9-Box: X = desempeño (nota final/calibrada), Y = potencial. */
export const MATRIZ_9BOX: Record<Tramo, Record<Tramo, string>> = {
  ALTO: { BAJO: 'Enigma', MEDIO: 'Crecimiento', ALTO: 'Estrella' }, // potencial alto
  MEDIO: { BAJO: 'En riesgo', MEDIO: 'Colaborador clave', ALTO: 'Alto desempeño' },
  BAJO: { BAJO: 'Bajo desempeño', MEDIO: 'Eficaz', ALTO: 'Sólido' },
}

export const CUADRANTES_9BOX = [
  'Estrella', 'Crecimiento', 'Enigma',
  'Alto desempeño', 'Colaborador clave', 'En riesgo',
  'Sólido', 'Eficaz', 'Bajo desempeño',
] as const

export function box9(desempeno: number | null, pot: number | null): string | null {
  if (desempeno === null || pot === null) return null
  return MATRIZ_9BOX[tramo(pot)][tramo(desempeno)]
}

/** Etiqueta cualitativa de la nota final (para "Mi resultado"). */
// Nombres y cortes de la ESCALA OFICIAL del Manual de Competencias Hunter (decisión 30/07):
// 5 Excepcional · 4 Superior · 3 Competente · 2 En desarrollo · 1 Insuficiente
export function etiquetaNota(nota: number): string {
  if (nota >= 4.5) return 'Excepcional'
  if (nota >= 3.5) return 'Superior'
  if (nota >= 2.5) return 'Competente'
  if (nota >= 1.5) return 'En desarrollo'
  return 'Insuficiente'
}

/** Suma de pesos de objetivos de un colaborador (transversales aplicables + individuales). Debe ser 100 para cerrar. */
export function validarPesos(pesos: number[]): { total: number; valido: boolean } {
  const total = pesos.reduce((a, b) => a + b, 0)
  return { total, valido: total === 100 }
}
