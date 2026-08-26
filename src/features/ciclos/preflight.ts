import { prisma } from '@/shared/lib/prisma'
import { excluidoPorAntiguedad, ANTIGUEDAD_MINIMA_MESES } from '@/domain/antiguedad'
import { resolverAlcance, type MotivoRechazo } from './alcance'
import { estaEnAlcancePeriodo, type PeriodoConAlcance } from '@/features/objetivos/alcance-periodo'

/** Participantes (nombre completo) fuera del alcance del período de objetivos elegido —
 * puro, testeable sin Prisma. Sin período (ciclo sin objetivos) no hay nada que evaluar:
 * devuelve vacío. Quedan igualmente en `objetivosIncompletos` (0%, bloqueante); este aviso
 * solo explica el por qué. */
export function participantesFueraDelPeriodo(
  periodo: PeriodoConAlcance | null,
  participantes: { id: string; nombres: string; apellidos: string; activo: boolean; paisId: string; areaId: string | null; nivelId: string | null }[],
): string[] {
  if (!periodo) return []
  return participantes.filter((c) => !estaEnAlcancePeriodo(periodo, c)).map((c) => `${c.nombres} ${c.apellidos}`)
}

type ColaboradorParaObjetivos = {
  id: string; nombres: string; apellidos: string; activo: boolean
  paisId: string; areaId: string | null; puestoId: string | null; nivelId: string | null
}
type ObjetivoParaTotal = {
  colaboradorId: string | null; tipo: string; peso: number
  focoAreaIds: string[]; focoNivelIds: string[]; focoPaisIds: string[]; focoPuestoIds: string[]
}

/** % de objetivos cubierto por cada participante (transversales aplicables por su focalización
 * + individuales/desarrollo propios aprobados) — 0 si está fuera del alcance del período, aunque
 * un transversal de foco vacío le diera 100%: el cálculo real (`objetivosAplicables`) no le
 * cuenta nada, así que aquí tampoco puede contar (intersección que faltaba, IMPORTANT-1 de la
 * final review — la 5.ª implementación de "transversal ∩ alcance" que quedaba sin ella).
 * Puro, testeable sin Prisma (mismo patrón que `participantesFueraDelPeriodo`). */
export function objetivosIncompletosDe(
  periodo: PeriodoConAlcance | null,
  participantes: ColaboradorParaObjetivos[],
  aprobados: ObjetivoParaTotal[],
): { nombre: string; pct: number }[] {
  const transversales = aprobados.filter((o) => o.tipo === 'TRANSVERSAL')
  const pctDe = (c: ColaboradorParaObjetivos) => {
    if (periodo && !estaEnAlcancePeriodo(periodo, c)) return 0
    const aplic = transversales.filter((t) => {
      const porArea = t.focoAreaIds.length === 0 || (c.areaId !== null && t.focoAreaIds.includes(c.areaId))
      const porNivel = t.focoNivelIds.length === 0 || (c.nivelId !== null && t.focoNivelIds.includes(c.nivelId))
      const porPais = t.focoPaisIds.length === 0 || t.focoPaisIds.includes(c.paisId)
      const porPuesto = t.focoPuestoIds.length === 0 || (c.puestoId !== null && t.focoPuestoIds.includes(c.puestoId))
      return porArea && porNivel && porPais && porPuesto
    })
    const propios = aprobados.filter((o) => o.colaboradorId === c.id).reduce((a, o) => a + o.peso, 0)
    return aplic.reduce((a, t) => a + t.peso, 0) + propios
  }
  return participantes
    .map((c) => ({ nombre: `${c.nombres} ${c.apellidos}`, pct: pctDe(c) }))
    .filter((x) => x.pct < 100)
    .sort((a, b) => a.pct - b.pct)
}

/** Verificación de pre-vuelo del lanzamiento de un ciclo: el último gate antes del acto
 * irreversible. Bloqueantes = configuración rota (no se puede lanzar); avisos = decisiones
 * conscientes que RR.HH. debe ver antes de confirmar. Lo usa la página del detalle (mostrar)
 * y lanzarCiclo (re-verificar server-side). */

/** Colaboradores con nota en el ciclo que aún no tienen su sesión de feedback registrada.
 * Flujo del manual: resultados visibles → conversación jefe-colaborador (feedback + PDI) →
 * recién ahí se cierra el ciclo. Lo usa la página del detalle (mostrar) y cerrarCiclo (gate). */
export async function feedbackPendiente(cicloId: string, paisId?: string) {
  const [conNota, conFeedback] = await Promise.all([
    prisma.resultado.findMany({
      where: { cicloId, OR: [{ notaFinal: { not: null } }, { notaCalibrada: { not: null } }], colaborador: { is: { activo: true, ...(paisId ? { paisId } : {}) } } },
      include: { colaborador: { select: { nombres: true, apellidos: true } } },
    }),
    prisma.feedback.findMany({ where: { cicloId }, select: { colaboradorId: true } }),
  ])
  const registrados = new Set(conFeedback.map((f) => f.colaboradorId))
  return {
    requeridos: conNota.length,
    faltantes: conNota
      .filter((r) => !registrados.has(r.colaboradorId))
      .map((r) => `${r.colaborador.nombres} ${r.colaborador.apellidos}`),
  }
}

/** Estado de la conformidad de nota de cada participante con nota en el ciclo. El cierre
 * exige que todos hayan CONFIRMADO (conforme u observado) o estén EXIMIDOS por RR.HH.
 * Regional (por colaborador, con motivo auditado). Lo usan el gate de cierre y la pestaña
 * «Conformidad» del detalle del ciclo. */
export type FilaConformidad = {
  resultadoId: string
  colaboradorId: string
  nombre: string
  puesto: string
  pais: string
  area: string
  jefe: string
  nota: number
  estado: 'CONFORME' | 'OBSERVADO' | 'EXIMIDO' | 'PENDIENTE'
  fecha: string | null // decisión o exención
  observacion: string | null
  motivoExencion: string | null
  sinCuenta: boolean // no puede confirmar por sí mismo: candidato natural a exención
}

export async function conformidadPendiente(cicloId: string, paisId?: string) {
  const conNota = await prisma.resultado.findMany({
    where: { cicloId, OR: [{ notaFinal: { not: null } }, { notaCalibrada: { not: null } }], colaborador: { is: { activo: true, ...(paisId ? { paisId } : {}) } } },
    include: { colaborador: { select: { nombres: true, apellidos: true, puesto: { select: { nombre: true } }, pais: { select: { nombre: true } }, area: { select: { nombre: true } }, jefe: { select: { nombres: true, apellidos: true } }, usuario: { select: { id: true } } } } },
    orderBy: [{ colaborador: { apellidos: 'asc' } }],
  })
  const detalle: FilaConformidad[] = conNota.map((r) => ({
    resultadoId: r.id,
    colaboradorId: r.colaboradorId,
    nombre: `${r.colaborador.nombres} ${r.colaborador.apellidos}`,
    puesto: r.colaborador.puesto?.nombre ?? 'Sin puesto',
    pais: r.colaborador.pais.nombre,
    area: r.colaborador.area?.nombre ?? '— Sin área',
    jefe: r.colaborador.jefe ? `${r.colaborador.jefe.nombres} ${r.colaborador.jefe.apellidos}` : '— Sin jefe directo',
    nota: r.notaCalibrada ?? r.notaFinal!,
    estado: r.conformidad ?? (r.conformidadEximidaEn ? 'EXIMIDO' : 'PENDIENTE'),
    fecha: (r.conformidadEn ?? r.conformidadEximidaEn)?.toLocaleDateString('es-PE') ?? null,
    observacion: r.observacion,
    motivoExencion: r.conformidadEximidaMotivo,
    sinCuenta: !r.colaborador.usuario,
  }))
  return {
    requeridos: detalle.length,
    faltantes: detalle.filter((d) => d.estado === 'PENDIENTE').map((d) => d.nombre),
    detalle,
  }
}

export type Preflight = {
  colaboradores: number
  bloqueantes: {
    objetivosIncompletos: { nombre: string; pct: number }[]
    cuestionariosVacios: { nombre: string; causa: string }[]
    // Los logros de objetivos son únicos por período: un segundo ciclo lanzado sobre el
    // mismo período pisaría el detalle de resultados ya calculados/publicados
    periodoYaEvaluado: { ciclo: string; estado: string } | null
    // El alcance (foco + ajustes manuales) no dejó a ningún evaluado: no hay nada que lanzar
    sinEvaluados: boolean
  }
  avisos: {
    sinPuesto: string[]
    sinCuenta: string[]
    sinJefe: string[]
    nivelesSinEvaluacion: { nivel: string; afectados: number }[]
    coberturaParcial: { nombre: string; puesto: string; faltan: string[] }[] // el formulario evalúa solo parte de sus competencias
    periodoAbierto: boolean
    excluidosAntiguedad: { nombre: string; ingreso: string }[] // < ANTIGUEDAD_MINIMA_MESES al inicio del ciclo
    sinFechaIngreso: string[] // sin dato: se incluyen igual
    // Jefes y reportes de OTRO país (o fuera del ciclo) que igual evaluarán a participantes:
    // el país acota a los evaluados, no a los insumos. Sin cuenta no podrán responder.
    evaluadoresExternos: { nombre: string; pais: string; relacion: string; sinCuenta: boolean }[]
    // Agregados manualmente (incluirIds) que la regla de negocio frena de todas formas
    incluidosRechazados: { nombre: string; motivo: MotivoRechazo }[]
    // Ciclo sin período de objetivos: la nota final se calcula 100% con competencias
    sinObjetivos: boolean
    // Con período: participantes fuera del alcance del período elegido (quedan en 0% de
    // objetivos y por lo tanto bloqueados por objetivosIncompletos; este aviso lo explica)
    fueraDelPeriodo: string[]
  }
  impacto: { auto: number; jefe: number; ascendente: number; total: number }
  listo: boolean
}

export async function preflightCiclo(cicloId: string): Promise<Preflight | null> {
  const ciclo = await prisma.ciclo.findUnique({ where: { id: cicloId } })
  if (!ciclo) return null

  const [colaboradores, todosActivos, snapshot, periodo, niveles] = await Promise.all([
    // El mismo alcance que usará lanzarCiclo: activos, resuelto por el foco + ajustes del ciclo
    prisma.colaborador.findMany({
      where: { activo: true },
      include: {
        puesto: { include: { competencias: { select: { competenciaId: true, competencia: { select: { nombre: true } } } }, nivel: true } },
        usuario: { select: { id: true } },
      },
    }),
    // Pool de evaluadores: TODOS los activos de la región — el jefe y los reportes de un
    // participante evalúan aunque sean de otro país o no participen del ciclo
    prisma.colaborador.findMany({
      where: { activo: true },
      select: { id: true, nombres: true, apellidos: true, jefeId: true, fechaIngreso: true, pais: { select: { nombre: true } }, usuario: { select: { id: true } } },
    }),
    prisma.cicloPregunta.findMany({ where: { cicloId, modalidad: 'JEFE' }, select: { preguntaId: true, nivelId: true, puestoId: true, pregunta: { select: { competenciaId: true } } } }),
    // Ciclo sin período (evalúa 100% con competencias): no hay período que consultar
    ciclo.periodoId ? prisma.periodoObjetivos.findUnique({ where: { id: ciclo.periodoId } }) : null,
    prisma.nivelJerarquico.findMany(),
  ])
  const sinObjetivos = ciclo.periodoId === null

  // Alcance resuelto: mismo foco + ajustes manuales que usará lanzarCiclo (única fuente de verdad).
  const foco = { focoPaisIds: ciclo.focoPaisIds, focoAreaIds: ciclo.focoAreaIds, focoNivelIds: ciclo.focoNivelIds }
  const ajustes = { incluirIds: ciclo.incluirIds, excluirIds: ciclo.excluirIds }
  const resuelto = resolverAlcance(
    colaboradores.map((c) => ({ ...c, nivelId: c.puesto?.nivelId ?? null })),
    foco, ajustes, ciclo.fechaInicio,
  )
  const participantes = resuelto.evaluados
  const porIdColab = new Map(colaboradores.map((c) => [c.id, c]))
  // Del foco, fuera por antigüedad (sin contar los agregados manuales, que van en incluidosRechazados)
  const excluidos = resuelto.detalle.excluidosAntiguedad.map((id) => porIdColab.get(id)!)

  const ids = new Set(participantes.map((c) => c.id))
  const nombreDe = (c: (typeof colaboradores)[number]) => `${c.nombres} ${c.apellidos}`

  // ── Agregados manualmente (incluirIds) que la regla de negocio frena de todas formas:
  // inactivos (la consulta base solo trae activos, así que se buscan aparte) y por antigüedad ──
  const inactivosIncluidos = ciclo.incluirIds.length === 0 ? [] : await prisma.colaborador.findMany({
    where: { id: { in: ciclo.incluirIds }, activo: false },
    select: { nombres: true, apellidos: true },
  })
  // El resolutor solo procesa la lista de activos que se le pasó, así que sus rechazos
  // (ANTIGUEDAD, FUERA_DE_PAIS) nunca comparten id con inactivosIncluidos (query aparte, solo inactivos)
  const incluidosRechazados = [
    ...inactivosIncluidos.map((c) => ({ nombre: `${c.nombres} ${c.apellidos}`, motivo: 'INACTIVO' as const })),
    ...resuelto.detalle.incluidosRechazados
      .map((r) => ({ nombre: porIdColab.has(r.id) ? nombreDe(porIdColab.get(r.id)!) : r.id, motivo: r.motivo })),
  ]

  // ── Objetivos: transversales aplicables + propios aprobados deben sumar 100% ──
  // Ciclo SIN período (aviso `sinObjetivos`): nada que verificar, no hay bloqueante.
  const aprobados = sinObjetivos ? [] : await prisma.objetivo.findMany({ where: { periodoId: ciclo.periodoId!, estado: 'APROBADO' } })
  // Intersecado con el alcance del período elegido (no solo la focalización propia del
  // transversal): un participante fuera del alcance queda en 0%, igual que en el cálculo real.
  const objetivosIncompletos = sinObjetivos ? [] : objetivosIncompletosDe(
    periodo,
    participantes.map((c) => ({
      id: c.id, nombres: c.nombres, apellidos: c.apellidos, activo: c.activo,
      paisId: c.paisId, areaId: c.areaId, puestoId: c.puestoId, nivelId: c.puesto?.nivelId ?? null,
    })),
    aprobados,
  )

  // ── Período exclusivo: solo UN ciclo lanzado puede evaluar un período (no aplica sin período) ──
  const otroCiclo = sinObjetivos ? null : await prisma.ciclo.findFirst({
    where: { periodoId: ciclo.periodoId!, estado: { not: 'BORRADOR' }, id: { not: cicloId } },
    select: { nombre: true, estado: true },
  })
  const periodoYaEvaluado = otroCiclo ? { ciclo: otroCiclo.nombre, estado: otroCiclo.estado } : null

  // ── Fuera del alcance del período elegido: quedan en 0% de objetivos (objetivosIncompletos
  // los bloquea igual); este aviso solo explica el por qué, no bloquea por sí mismo ──
  const fueraDelPeriodo = participantesFueraDelPeriodo(
    periodo,
    participantes.map((c) => ({ id: c.id, nombres: c.nombres, apellidos: c.apellidos, activo: c.activo, paisId: c.paisId, areaId: c.areaId, nivelId: c.puesto?.nivelId ?? null })),
  )

  // ── Cuestionarios: derivación real por persona con el snapshot del ciclo ──
  // Competencias con preguntas (modalidad Jefe) por alcance: excepción de puesto o nivel
  const porPuesto = new Map<string, Set<string>>()
  const porNivel = new Map<string, Set<string>>()
  for (const s of snapshot) {
    if (s.puestoId) {
      if (!porPuesto.has(s.puestoId)) porPuesto.set(s.puestoId, new Set())
      porPuesto.get(s.puestoId)!.add(s.pregunta.competenciaId)
    } else if (s.nivelId) {
      if (!porNivel.has(s.nivelId)) porNivel.set(s.nivelId, new Set())
      porNivel.get(s.nivelId)!.add(s.pregunta.competenciaId)
    }
  }

  const sinPuesto: string[] = []
  const cuestionariosVacios: { nombre: string; causa: string }[] = []
  const coberturaParcial: { nombre: string; puesto: string; faltan: string[] }[] = []
  for (const c of participantes) {
    if (!c.puesto) { sinPuesto.push(nombreDe(c)); continue }
    const compIds = c.puesto.competencias.map((x) => x.competenciaId)
    if (compIds.length === 0) {
      cuestionariosVacios.push({ nombre: nombreDe(c), causa: `su puesto (${c.puesto.nombre}) no tiene competencias asignadas` })
      continue
    }
    const tieneExcepcion = porPuesto.has(c.puesto.id)
    const cubiertas = tieneExcepcion ? porPuesto.get(c.puesto.id)! : porNivel.get(c.puesto.nivelId)
    if (!cubiertas) {
      cuestionariosVacios.push({
        nombre: nombreDe(c),
        causa: `ninguna de las evaluaciones del ciclo aplica a su nivel (${c.puesto.nivel.nombre}) — asigna una en «✎ Editar evaluaciones»`,
      })
      continue
    }
    const nombresFaltantes = c.puesto.competencias.filter((x) => !cubiertas.has(x.competenciaId)).map((x) => x.competencia.nombre)
    if (!compIds.some((id) => cubiertas.has(id))) {
      cuestionariosVacios.push({
        nombre: nombreDe(c),
        causa: `el formulario ${tieneExcepcion ? 'elegido para su puesto' : `elegido para su nivel (${c.puesto.nivel.nombre})`} no evalúa ninguna de las competencias de su puesto ${c.puesto.nombre}: ${nombresFaltantes.join(', ')}`,
      })
    } else if (nombresFaltantes.length > 0) {
      // Cuestionario PARCIAL: hay preguntas, pero algunas competencias del puesto quedan sin evaluar
      coberturaParcial.push({ nombre: nombreDe(c), puesto: c.puesto.nombre, faltan: nombresFaltantes })
    }
  }

  // ── Evaluadores (jefe y ascendentes): mismo criterio que lanzarCiclo — cualquier activo
  // de la región con antigüedad mínima, participe o no del ciclo ──
  const puedeEvaluar = (x: { fechaIngreso: Date | null }) => !excluidoPorAntiguedad(x.fechaIngreso, ciclo.fechaInicio)
  const evaluadorPorId = new Map(todosActivos.map((x) => [x.id, x]))
  const reportesPorJefe = new Map<string, typeof todosActivos>()
  for (const x of todosActivos) {
    if (x.jefeId && puedeEvaluar(x)) reportesPorJefe.set(x.jefeId, [...(reportesPorJefe.get(x.jefeId) ?? []), x])
  }
  const jefeValidoDe = (c: (typeof colaboradores)[number]) => {
    const j = c.jefeId ? evaluadorPorId.get(c.jefeId) : undefined
    return j && puedeEvaluar(j) ? j : null
  }

  // ── Avisos ──
  const sinCuenta = participantes.filter((c) => !c.usuario).map(nombreDe)
  // Sin jefe REAL: no existe, está inactivo o quedó excluido por antigüedad (que sea de otro
  // país o no participe ya NO lo deja sin evaluación descendente)
  const sinJefe = participantes.filter((c) => !jefeValidoDe(c)).map(nombreDe)
  // Evaluadores externos al ciclo (jefes y reportes que no participan): aviso informativo +
  // alerta de cuenta, porque sin cuenta no pueden responder lo que se les asigne
  const externosMap = new Map<string, { nombre: string; pais: string; relaciones: string[]; sinCuenta: boolean }>()
  for (const c of participantes) {
    const j = jefeValidoDe(c)
    if (j && !ids.has(j.id)) {
      if (!externosMap.has(j.id)) externosMap.set(j.id, { nombre: `${j.nombres} ${j.apellidos}`, pais: j.pais.nombre, relaciones: [], sinCuenta: !j.usuario })
      externosMap.get(j.id)!.relaciones.push(`jefe de ${nombreDe(c)}`)
    }
    for (const r of reportesPorJefe.get(c.id) ?? []) {
      if (ids.has(r.id)) continue
      if (!externosMap.has(r.id)) externosMap.set(r.id, { nombre: `${r.nombres} ${r.apellidos}`, pais: r.pais.nombre, relaciones: [], sinCuenta: !r.usuario })
      externosMap.get(r.id)!.relaciones.push(`ascendente sobre ${nombreDe(c)}`)
    }
  }
  const evaluadoresExternos = [...externosMap.values()]
    .map((e) => ({ nombre: e.nombre, pais: e.pais, relacion: e.relaciones.join(' · '), sinCuenta: e.sinCuenta }))
    .sort((a, b) => Number(b.sinCuenta) - Number(a.sinCuenta) || a.nombre.localeCompare(b.nombre))
  const nombreNivel = new Map(niveles.map((n) => [n.id, n.nombre]))
  const afectadosPorNivelSinEval = new Map<string, number>()
  for (const c of participantes) {
    if (!c.puesto) continue
    if (!porNivel.has(c.puesto.nivelId) && !porPuesto.has(c.puesto.id)) {
      afectadosPorNivelSinEval.set(c.puesto.nivelId, (afectadosPorNivelSinEval.get(c.puesto.nivelId) ?? 0) + 1)
    }
  }
  const nivelesSinEvaluacion = [...afectadosPorNivelSinEval.entries()].map(([nivelId, afectados]) => ({
    nivel: nombreNivel.get(nivelId) ?? nivelId,
    afectados,
  }))

  // ── Impacto: exactamente las asignaciones que generará lanzarCiclo ──
  let jefe = 0
  let ascendente = 0
  for (const c of participantes) {
    if (jefeValidoDe(c)) jefe += 1
    ascendente += (reportesPorJefe.get(c.id) ?? []).length
  }
  const impacto = { auto: participantes.length, jefe, ascendente, total: participantes.length + jefe + ascendente }

  const bloqueantes = { objetivosIncompletos, cuestionariosVacios, periodoYaEvaluado, sinEvaluados: participantes.length === 0 }
  return {
    colaboradores: participantes.length,
    bloqueantes,
    avisos: {
      sinPuesto,
      sinCuenta,
      sinJefe,
      nivelesSinEvaluacion,
      coberturaParcial,
      periodoAbierto: periodo?.estado === 'CARGA_ABIERTA',
      excluidosAntiguedad: excluidos
        .map((c) => ({ nombre: nombreDe(c), ingreso: c.fechaIngreso!.toLocaleDateString('es-PE') }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre)),
      sinFechaIngreso: participantes.filter((c) => !c.fechaIngreso).map(nombreDe),
      evaluadoresExternos,
      incluidosRechazados,
      sinObjetivos,
      fueraDelPeriodo,
    },
    impacto,
    listo: objetivosIncompletos.length === 0 && cuestionariosVacios.length === 0 && periodoYaEvaluado === null && !bloqueantes.sinEvaluados,
  }
}
