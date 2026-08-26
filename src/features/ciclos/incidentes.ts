import { prisma } from '@/shared/lib/prisma'
import { paisesCongelados } from '@/features/ciclos/congelamiento'

/** Incidentes del ciclo: un evaluador DADO DE BAJA dejó evaluaciones sin enviar sobre
 * participantes. Detección calculada al leer (el ciclo es una foto; nada se persiste):
 * resolverlos = reasignar / cancelar / invalidar, y desaparecen porque los datos cambian.
 * Regla 31/07: el cambio de jefe con el anterior ACTIVO no es incidente — responde él. */

const SIN_ENVIAR = new Set(['PENDIENTE', 'BORRADOR', 'PROPUESTA'])

export type AsigIncidente = {
  id: string
  tipo: 'AUTO' | 'JEFE' | 'ASCENDENTE' | 'PAR'
  estado: string
  evaluado: { id: string; nombres: string; apellidos: string; puesto: string; pais: string }
  evaluador: { id: string; nombres: string; apellidos: string; activo: boolean }
}

export type InsumoPerdido = {
  asignacionId: string
  tipo: AsigIncidente['tipo']
  estado: string
  evaluador: string
  hermanaEnviada: { asignacionId: string; evaluador: string } | null
}

export type IncidenteEvaluado = {
  colaboradorId: string
  nombre: string
  puesto: string
  pais: string
  insumos: InsumoPerdido[]
}

export function agruparIncidentes(asigs: AsigIncidente[]): IncidenteEvaluado[] {
  const porEvaluado = new Map<string, IncidenteEvaluado>()
  for (const a of asigs) {
    if (a.evaluador.activo || !SIN_ENVIAR.has(a.estado)) continue
    if (!porEvaluado.has(a.evaluado.id)) {
      porEvaluado.set(a.evaluado.id, {
        colaboradorId: a.evaluado.id,
        nombre: `${a.evaluado.nombres} ${a.evaluado.apellidos}`,
        puesto: a.evaluado.puesto,
        pais: a.evaluado.pais,
        insumos: [],
      })
    }
    // PAR con incidente: si el otro par YA respondió, esa evaluación es candidata a
    // invalidarse (una sola voz de par = sesgo y anonimato comprometido)
    const hermana = a.tipo === 'PAR'
      ? asigs.find((h) => h.id !== a.id && h.tipo === 'PAR' && h.evaluado.id === a.evaluado.id && h.estado === 'ENVIADA') ?? null
      : null
    porEvaluado.get(a.evaluado.id)!.insumos.push({
      asignacionId: a.id,
      tipo: a.tipo,
      estado: a.estado,
      evaluador: `${a.evaluador.nombres} ${a.evaluador.apellidos}`,
      hermanaEnviada: hermana ? { asignacionId: hermana.id, evaluador: `${hermana.evaluador.nombres} ${hermana.evaluador.apellidos}` } : null,
    })
  }
  return [...porEvaluado.values()].sort((a, b) => a.nombre.localeCompare(b.nombre))
}

/** Asignaciones del ciclo (acotadas al alcance) con lo necesario para detectar incidentes. */
export async function incidentesCiclo(cicloId: string, wherePais: { paisId?: string }): Promise<IncidenteEvaluado[]> {
  const [asigs, congelados] = await Promise.all([
    prisma.asignacion.findMany({
      where: { cicloId, evaluado: { is: { activo: true, ...wherePais } } },
      select: {
        id: true, tipo: true, estado: true,
        evaluado: { select: { id: true, paisId: true, nombres: true, apellidos: true, puesto: { select: { nombre: true } }, pais: { select: { nombre: true } } } },
        evaluador: { select: { id: true, nombres: true, apellidos: true, activo: true } },
      },
    }),
    paisesCongelados(cicloId),
  ])
  // Un país ya cerrado congela sus resultados: sus incidentes ya no se resuelven (no deben
  // aparecer para acción). Se filtran antes de agrupar; el tipo puro no cambia.
  return agruparIncidentes(asigs.filter((a) => !a.evaluado.paisId || !congelados.has(a.evaluado.paisId)).map((a) => ({
    id: a.id,
    tipo: a.tipo as AsigIncidente['tipo'],
    estado: a.estado,
    evaluado: { id: a.evaluado.id, nombres: a.evaluado.nombres, apellidos: a.evaluado.apellidos, puesto: a.evaluado.puesto?.nombre ?? 'Sin puesto', pais: a.evaluado.pais.nombre },
    evaluador: a.evaluador,
  })))
}
