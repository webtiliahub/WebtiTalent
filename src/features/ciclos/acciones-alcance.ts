'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { prisma } from '@/shared/lib/prisma'
import { requiereSesion, paisForzado } from '@/shared/lib/permisos'
import { tieneAdmin } from '@/shared/lib/permisos-admin'
import { resolverAlcance, type FocoCiclo, type AjustesCiclo, type MotivoRechazo } from './alcance'

export type PreviewAlcance = {
  total: number
  porPais: { pais: string; total: number }[]
  porNivel: Record<string, number>
  grupos: { pais: string; areas: { area: string; personas: { id: string; nombre: string; manual: boolean }[] }[] }[]
  excluidos: { id: string; nombre: string }[]
  rechazados: { id: string; nombre: string; motivo: MotivoRechazo }[]
}

const esquemaPreviewInput = z.object({
  foco: z.object({
    focoPaisIds: z.array(z.string()).max(50),
    focoAreaIds: z.array(z.string()).max(50),
    focoNivelIds: z.array(z.string()).max(50),
  }),
  ajustes: z.object({
    incluirIds: z.array(z.string()).max(500),
    excluirIds: z.array(z.string()).max(500),
  }),
  fechaInicio: z.string(),
  conAntiguedad: z.boolean().optional(),
})

/** Dry-run del alcance para la lista previa del wizard de ciclos (y el wizard de períodos,
 * que pasa `conAntiguedad: false` porque un período nunca aplica esa regla). Corre el MISMO
 * resolutor que usará lanzarCiclo: lo que muestra es lo que se genera. */
export async function previewAlcance(
  input: { foco: FocoCiclo; ajustes: AjustesCiclo; fechaInicio: string; conAntiguedad?: boolean },
): Promise<{ ok: true; preview: PreviewAlcance } | { ok: false; error: string }> {
  // Server action invocable directamente: exige tener CICLOS o OBJETIVOS en GESTIONAR
  // (la usan tanto el wizard de ciclos como el de períodos de objetivos).
  const sesion = await requiereSesion()
  if (!tieneAdmin(sesion.permisosAdmin, 'CICLOS', 'GESTIONAR') && !tieneAdmin(sesion.permisosAdmin, 'OBJETIVOS', 'GESTIONAR')) {
    redirect('/hoja-de-vida')
  }

  const parsed = esquemaPreviewInput.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: 'Solicitud inválida' }
  const datos = parsed.data

  const fechaInicio = datos.conAntiguedad === false
    ? null
    : /^\d{4}-\d{2}-\d{2}$/.test(datos.fechaInicio) ? new Date(`${datos.fechaInicio}T00:00:00`) : new Date()

  // RR.HH.-país: el foco de países queda FORZADO a su país (mismo patrón que validarAlcanceCiclo
  // en acciones.ts) — ignora lo que llegue del cliente.
  const forzadoPreview = paisForzado(sesion)
  const focoPaisIds = forzadoPreview ? [forzadoPreview] : datos.foco.focoPaisIds
  const foco: FocoCiclo = { focoPaisIds, focoAreaIds: datos.foco.focoAreaIds, focoNivelIds: datos.foco.focoNivelIds }

  const idsReferenciados = [...new Set([...datos.ajustes.incluirIds, ...datos.ajustes.excluirIds])]
  // Solo activos, salvo los referenciados en ajustes (el resolutor reporta a los incluidos
  // manuales inactivos/rechazados con su motivo — necesita verlos aunque estén inactivos).
  const colaboradores = await prisma.colaborador.findMany({
    where: idsReferenciados.length > 0 ? { OR: [{ activo: true }, { id: { in: idsReferenciados } }] } : { activo: true },
    select: {
      id: true, nombres: true, apellidos: true, activo: true, fechaIngreso: true,
      paisId: true, areaId: true,
      pais: { select: { nombre: true } }, area: { select: { nombre: true } },
      puesto: { select: { nivelId: true } },
    },
  })
  const enriquecidos = colaboradores.map((c) => ({ ...c, nivelId: c.puesto?.nivelId ?? null }))

  // RR.HH.-país: los ajustes manuales solo pueden tocar colaboradores de su propio país —
  // descarta silenciosamente del preview los ids que no lo sean (mismo alcance que ve en todo lo demás).
  const paisIdPorId = new Map(enriquecidos.map((c) => [c.id, c.paisId]))
  const filtrarPorPais = (ids: string[]) =>
    forzadoPreview
      ? ids.filter((id) => paisIdPorId.get(id) === forzadoPreview)
      : ids
  const ajustes: AjustesCiclo = {
    incluirIds: filtrarPorPais(datos.ajustes.incluirIds),
    excluirIds: filtrarPorPais(datos.ajustes.excluirIds),
  }

  const { evaluados, detalle } = resolverAlcance(enriquecidos, foco, ajustes, fechaInicio)

  const nombreDe = (c: (typeof enriquecidos)[number]) => `${c.nombres} ${c.apellidos}`
  const porId = new Map(enriquecidos.map((c) => [c.id, c]))
  const manuales = new Set(detalle.incluidosManuales)

  const porPaisMap = new Map<string, number>()
  const porNivel: Record<string, number> = {}
  const gruposMap = new Map<string, Map<string, { id: string; nombre: string; manual: boolean }[]>>()
  for (const c of evaluados) {
    porPaisMap.set(c.pais.nombre, (porPaisMap.get(c.pais.nombre) ?? 0) + 1)
    if (c.nivelId) porNivel[c.nivelId] = (porNivel[c.nivelId] ?? 0) + 1
    const areaNombre = c.area?.nombre ?? '— Sin área'
    if (!gruposMap.has(c.pais.nombre)) gruposMap.set(c.pais.nombre, new Map())
    const areas = gruposMap.get(c.pais.nombre)!
    if (!areas.has(areaNombre)) areas.set(areaNombre, [])
    areas.get(areaNombre)!.push({ id: c.id, nombre: nombreDe(c), manual: manuales.has(c.id) })
  }
  const orden = (a: string, b: string) => a.localeCompare(b)
  const preview: PreviewAlcance = {
    total: evaluados.length,
    porPais: [...porPaisMap.entries()].sort(([a], [b]) => orden(a, b)).map(([pais, total]) => ({ pais, total })),
    porNivel,
    grupos: [...gruposMap.entries()].sort(([a], [b]) => orden(a, b)).map(([pais, areas]) => ({
      pais,
      areas: [...areas.entries()].sort(([a], [b]) => orden(a, b)).map(([area, personas]) => ({
        area,
        personas: personas.sort((x, y) => orden(x.nombre, y.nombre)),
      })),
    })),
    excluidos: detalle.excluidosManuales.map((id) => ({ id, nombre: porId.get(id) ? nombreDe(porId.get(id)!) : id })),
    rechazados: detalle.incluidosRechazados.map((r) => ({ ...r, nombre: porId.get(r.id) ? nombreDe(porId.get(r.id)!) : r.id })),
  }
  return { ok: true as const, preview }
}
