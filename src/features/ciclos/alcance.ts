import { excluidoPorAntiguedad } from '@/domain/antiguedad'

/** Alcance flexible del ciclo: filtros combinables + ajustes manuales.
 * ÚNICA fuente de verdad de «quiénes son los evaluados» — la consumen el preview
 * del wizard, el preflight y lanzarCiclo, así el preview nunca promete algo
 * distinto de lo que el lanzamiento genera. Puro: sin Prisma, sin fechas propias.
 *
 * El PAÍS es el TECHO del alcance: los ajustes manuales (incluirIds) pueden saltar
 * los filtros de área/nivel, pero nunca la dimensión país del foco (decisión de
 * Christian 04/08). Si el foco acota a un país (o varios), solo se puede agregar
 * a mano a colaboradores de esos países; para evaluar a alguien de otro país hay
 * que ampliar el foco de países. */

export type FocoCiclo = { focoPaisIds: string[]; focoAreaIds: string[]; focoNivelIds: string[] }
export type AjustesCiclo = { incluirIds: string[]; excluirIds: string[] }
export type ColaboradorAlcance = {
  id: string
  activo: boolean
  fechaIngreso: Date | null
  paisId: string
  areaId: string | null
  nivelId: string | null // vía puesto.nivelId; sin puesto = null
}
export type MotivoRechazo = 'FUERA_DE_PAIS' | 'INACTIVO' | 'ANTIGUEDAD'
export type AlcanceResuelto<T> = {
  evaluados: T[]
  detalle: {
    incluidosManuales: string[] // entraron por incluirIds (no cumplían filtros)
    excluidosManuales: string[] // cumplían filtros pero están en excluirIds
    incluidosRechazados: { id: string; motivo: MotivoRechazo }[] // manuales frenados por reglas de negocio
    excluidosAntiguedad: string[] // del foco, fuera por antigüedad (sin contar manuales)
  }
}

/** OR dentro de cada dimensión, AND entre dimensiones, vacía = todos.
 * areaId/nivelId null NO cumplen una dimensión con filtro activo (igual que transversales). */
export function cumpleFoco(foco: FocoCiclo, c: Pick<ColaboradorAlcance, 'paisId' | 'areaId' | 'nivelId'>): boolean {
  const porPais = foco.focoPaisIds.length === 0 || foco.focoPaisIds.includes(c.paisId)
  const porArea = foco.focoAreaIds.length === 0 || (c.areaId !== null && foco.focoAreaIds.includes(c.areaId))
  const porNivel = foco.focoNivelIds.length === 0 || (c.nivelId !== null && foco.focoNivelIds.includes(c.nivelId))
  return porPais && porArea && porNivel
}

/** paisId del ciclo DERIVADO: foco de exactamente un país → ese; si no, null (multi-país/todos). */
export function paisIdDerivado(focoPaisIds: string[]): string | null {
  return focoPaisIds.length === 1 ? focoPaisIds[0] : null
}

/** MODO LISTA: sin ningún filtro de foco y con personas seleccionadas, el alcance es
 * SOLO esa lista (no «todos + agregados»). Lo comparten el resolutor, los wizards y los
 * resúmenes para que el preview y el lanzamiento cuenten siempre lo mismo. */
export function esModoLista(foco: FocoCiclo, ajustes: Pick<AjustesCiclo, 'incluirIds'>): boolean {
  return foco.focoPaisIds.length === 0 && foco.focoAreaIds.length === 0 && foco.focoNivelIds.length === 0 && ajustes.incluirIds.length > 0
}

export function resolverAlcance<T extends ColaboradorAlcance>(
  colaboradores: T[],
  foco: FocoCiclo,
  ajustes: AjustesCiclo,
  // Fecha de inicio del ciclo para la regla de antigüedad; null = SIN regla (alcance de
  // un período de objetivos: un ingreso reciente también carga objetivos)
  fechaInicio: Date | null,
): AlcanceResuelto<T> {
  const excluir = new Set(ajustes.excluirIds)
  // Un id en ambas listas: EXCLUIR gana (la UI impide llegar aquí; defensa igual)
  const incluir = new Set(ajustes.incluirIds.filter((id) => !excluir.has(id)))

  const evaluados: T[] = []
  const incluidosManuales: string[] = []
  const excluidosManuales: string[] = []
  const incluidosRechazados: { id: string; motivo: MotivoRechazo }[] = []
  const excluidosAntiguedad: string[] = []

  // MODO LISTA (decisión de Christian 22/08): sin ningún filtro de foco, seleccionar
  // personas significa «evaluar SOLO a estas» — no un retiro del universo. Las reglas de
  // negocio (activo, antigüedad) aplican igual; el techo de país no existe sin foco.
  if (esModoLista(foco, ajustes)) {
    for (const c of colaboradores) {
      if (!incluir.has(c.id)) continue
      if (!c.activo) { incluidosRechazados.push({ id: c.id, motivo: 'INACTIVO' }); continue }
      if (fechaInicio !== null && excluidoPorAntiguedad(c.fechaIngreso, fechaInicio)) {
        incluidosRechazados.push({ id: c.id, motivo: 'ANTIGUEDAD' })
        continue
      }
      incluidosManuales.push(c.id)
      evaluados.push(c)
    }
    return { evaluados, detalle: { incluidosManuales, excluidosManuales, incluidosRechazados, excluidosAntiguedad } }
  }

  for (const c of colaboradores) {
    const porFoco = cumpleFoco(foco, c)
    if (excluir.has(c.id)) {
      if (porFoco) excluidosManuales.push(c.id)
      continue
    }
    const manual = !porFoco && incluir.has(c.id)
    if (!porFoco && !manual) continue
    // El país es el TECHO: un manual puede saltar área/nivel, pero nunca país — se
    // chequea ANTES de activo/antigüedad porque es la razón más fuerte de rechazo.
    if (manual) {
      const porPais = foco.focoPaisIds.length === 0 || foco.focoPaisIds.includes(c.paisId)
      if (!porPais) {
        incluidosRechazados.push({ id: c.id, motivo: 'FUERA_DE_PAIS' })
        continue
      }
    }
    // Reglas de negocio AL FINAL, también para los manuales: nadie inactivo o junior entra ni a mano
    if (!c.activo) {
      if (manual) incluidosRechazados.push({ id: c.id, motivo: 'INACTIVO' })
      continue
    }
    if (fechaInicio !== null && excluidoPorAntiguedad(c.fechaIngreso, fechaInicio)) {
      if (manual) incluidosRechazados.push({ id: c.id, motivo: 'ANTIGUEDAD' })
      else excluidosAntiguedad.push(c.id)
      continue
    }
    if (manual) incluidosManuales.push(c.id)
    evaluados.push(c)
  }
  return { evaluados, detalle: { incluidosManuales, excluidosManuales, incluidosRechazados, excluidosAntiguedad } }
}

/** El alcance en palabras, para la revisión del wizard, el detalle del ciclo y el AuditLog.
 * Ej.: «Chile y Perú · áreas: Comercial, Operaciones · niveles: Mando medio · 1 agregado manual · 1 excluido» */
export function resumenAlcance(
  foco: FocoCiclo,
  nombres: { paises: Map<string, string>; areas: Map<string, string>; niveles: Map<string, string> },
  nAjustes: { incluidos: number; excluidos: number },
): string {
  const n = (ids: string[], mapa: Map<string, string>) => ids.map((id) => mapa.get(id) ?? id)
  // Modo lista: el alcance ES la selección manual — el resumen lo dice sin rodeos
  const sinFoco = foco.focoPaisIds.length === 0 && foco.focoAreaIds.length === 0 && foco.focoNivelIds.length === 0
  if (sinFoco && nAjustes.incluidos > 0) {
    const partes = [`Solo ${nAjustes.incluidos} persona${nAjustes.incluidos === 1 ? '' : 's'} seleccionada${nAjustes.incluidos === 1 ? '' : 's'}`]
    if (nAjustes.excluidos > 0) partes.push(`${nAjustes.excluidos} excluido${nAjustes.excluidos === 1 ? '' : 's'}`)
    return partes.join(' · ')
  }
  const partes: string[] = []
  partes.push(foco.focoPaisIds.length === 0 ? 'Todos los países' : n(foco.focoPaisIds, nombres.paises).join(' y '))
  if (foco.focoAreaIds.length > 0) partes.push(`área${foco.focoAreaIds.length === 1 ? '' : 's'}: ${n(foco.focoAreaIds, nombres.areas).join(', ')}`)
  if (foco.focoNivelIds.length > 0) partes.push(`nivel${foco.focoNivelIds.length === 1 ? '' : 'es'}: ${n(foco.focoNivelIds, nombres.niveles).join(', ')}`)
  if (nAjustes.incluidos > 0) partes.push(`${nAjustes.incluidos} agregado${nAjustes.incluidos === 1 ? '' : 's'} manual${nAjustes.incluidos === 1 ? '' : 'es'}`)
  if (nAjustes.excluidos > 0) partes.push(`${nAjustes.excluidos} excluido${nAjustes.excluidos === 1 ? '' : 's'}`)
  return partes.join(' · ')
}
