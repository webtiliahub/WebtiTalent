import { prisma } from '@/shared/lib/prisma'
import {
  desgloseCompetencias, notaCompetenciasDesdeDesglose, cumplimientoObjetivos, notaFinal, potencial, box9,
  type RespuestaCalculo, type PesosModalidades, type CombinacionNivel, type Modalidad,
} from '@/domain/calculo'
import { estaEnAlcancePeriodo, type PeriodoConAlcance } from '@/features/objetivos/alcance-periodo'
import { perfilDeEvaluado } from '@/features/ciclos/perfil-evaluado'

/** Fila persistida del desglose por dimensión (lo que RR.HH. ve y calibra). */
export type DimensionResultado = {
  dimensionId: string
  nombre: string
  nota: number // 1–5 calculada de las respuestas
  pesoEfectivo: number // 0–1, contribución exacta a la nota de competencias
  ajuste: number | null // nota calibrada por RR.HH. (reemplaza a `nota` en el cálculo)
}

type ConfigCiclo = {
  pesosModalidades: PesosModalidades
  pesosModalidadesSinReportes: PesosModalidades // redistribución FIJA cuando el evaluado no tiene reportes (manual Hunter: Jefe 60 · Pares 40)
  combinacionPorNivel: Record<string, CombinacionNivel> // clave: id del nivel jerárquico (snapshot al lanzar)
}

const PESOS_MODALIDADES_DEFECTO: PesosModalidades = { JEFE: 50, PAR: 20, ASCENDENTE: 30, AUTO: 0 }
const PESOS_SIN_REPORTES_DEFECTO: PesosModalidades = { JEFE: 60, PAR: 40, ASCENDENTE: 0, AUTO: 0 }

/** Combinación viva desde el catálogo de niveles (fallback si el ciclo no congeló snapshot). */
async function combinacionDesdeCatalogo(): Promise<Record<string, CombinacionNivel>> {
  const niveles = await prisma.nivelJerarquico.findMany()
  return Object.fromEntries(niveles.map((n) => [n.id, { comp: n.compPct, obj: 100 - n.compPct }]))
}

export async function configDelCiclo(cicloId: string): Promise<ConfigCiclo> {
  const ciclo = await prisma.ciclo.findUnique({ where: { id: cicloId }, select: { configJson: true } })
  const json = ciclo?.configJson as Partial<ConfigCiclo> | null
  return {
    pesosModalidades: json?.pesosModalidades ?? PESOS_MODALIDADES_DEFECTO,
    pesosModalidadesSinReportes: json?.pesosModalidadesSinReportes ?? PESOS_SIN_REPORTES_DEFECTO,
    combinacionPorNivel: json?.combinacionPorNivel ?? (await combinacionDesdeCatalogo()),
  }
}

/** Objetivos aplicables a un colaborador en un período: transversales focalizados + individuales
 * aprobados, SOLO si el colaborador está dentro del alcance del período — fuera de alcance
 * (p.ej. tras editar el alcance en borrador, o un colaborador nunca cubierto) devuelve ambos
 * vacíos: no tiene objetivos que cumplir ni notar en el cálculo de resultado.
 * `periodoPrecargado` evita volver a leer el período por cada colaborador cuando el caller
 * (`calcularResultadosCiclo`) ya lo cargó una vez para todo el ciclo. */
export async function objetivosAplicables(periodoId: string, colaboradorId: string, periodoPrecargado?: PeriodoConAlcance) {
  const [periodo, colaborador] = await Promise.all([
    periodoPrecargado ?? prisma.periodoObjetivos.findUniqueOrThrow({ where: { id: periodoId } }),
    prisma.colaborador.findUniqueOrThrow({
      where: { id: colaboradorId },
      include: { puesto: true },
    }),
  ])
  // activo:true FORZADO — la regla «inactivo no entra» es del alcance de CARGA
  // (duenoFueraDeAlcancePeriodo), no del CÁLCULO: una baja con objetivos ya aprobados y logros
  // conservados debe seguir contando en cierre/rotación/Incidentes (CRITICAL-1 final review).
  const enAlcance = estaEnAlcancePeriodo(periodo, {
    id: colaborador.id,
    activo: true,
    paisId: colaborador.paisId,
    areaId: colaborador.areaId,
    nivelId: colaborador.puesto?.nivelId ?? null,
  })
  if (!enAlcance) return { transversales: [], individuales: [] }

  const transversales = await prisma.objetivo.findMany({
    where: { periodoId, tipo: 'TRANSVERSAL', estado: 'APROBADO' },
    include: { logros: { where: { colaboradorId } } },
  })
  const aplicables = transversales.filter((t) => {
    const porArea = t.focoAreaIds.length === 0 || (colaborador.areaId !== null && t.focoAreaIds.includes(colaborador.areaId))
    const porNivel = t.focoNivelIds.length === 0 || (colaborador.puesto !== null && t.focoNivelIds.includes(colaborador.puesto.nivelId))
    const porPais = t.focoPaisIds.length === 0 || t.focoPaisIds.includes(colaborador.paisId)
    const porPuesto = t.focoPuestoIds.length === 0 || (colaborador.puestoId !== null && t.focoPuestoIds.includes(colaborador.puestoId))
    return porArea && porNivel && porPais && porPuesto
  })
  const individuales = await prisma.objetivo.findMany({
    where: { periodoId, colaboradorId, tipo: { in: ['INDIVIDUAL', 'DESARROLLO'] } },
    include: { logros: { where: { colaboradorId } } },
    orderBy: { createdAt: 'asc' },
  })
  return { transversales: aplicables, individuales }
}

/** Calcula (y persiste) el resultado de un colaborador en un ciclo.
 * `periodoPrecargado` (opcional): el período ya cargado por el caller — lo usa
 * `calcularResultadosCiclo` para no repetir la misma lectura de `PeriodoObjetivos` por cada
 * colaborador del ciclo (N+1, deuda del ledger T4). */
export async function calcularResultado(cicloId: string, colaboradorId: string, periodoPrecargado?: PeriodoConAlcance) {
  const config = await configDelCiclo(cicloId)
  const cicloConPeriodo = await prisma.ciclo.findUniqueOrThrow({ where: { id: cicloId }, select: { periodoId: true } })
  const colaborador = await prisma.colaborador.findUniqueOrThrow({
    where: { id: colaboradorId },
    include: { puesto: { include: { pesos: true } } },
  })

  // Respuestas de competencias de todas las asignaciones ENVIADAS donde este colaborador es el evaluado
  const asignaciones = await prisma.asignacion.findMany({
    where: { cicloId, evaluadoId: colaboradorId, estado: 'ENVIADA' },
    include: {
      respuestas: { include: { pregunta: { include: { competencia: { include: { dimension: true } } } } } },
      respuestasPotencial: true,
    },
  })

  /* El PERFIL CONGELADO al lanzar manda sobre el maestro de puestos: la nota tiene que dar lo
     mismo hoy y dentro de dos años, aunque el puesto se haya reorganizado. En ciclos anteriores al
     snapshot cae al puesto en vivo, que es lo que usaron siempre. */
  const perfil = await perfilDeEvaluado(cicloId, colaboradorId)

  /* Segunda capa del candado de integridad: solo cuentan las respuestas que pertenecen al
     cuestionario de ESTE ciclo para el perfil de esta persona. La escritura ya las filtra
     (`guardarEvaluacion`), pero una respuesta fuera del cuestionario decide una nota, así que el
     cálculo no se fía del insumo: esto neutraliza —sin borrar, que es registro histórico— lo que
     se haya escrito antes de ese arreglo. Si el ciclo no tiene snapshot de preguntas, no se filtra:
     no hay con qué comparar y anular todo dejaría notas en blanco. */
  const tieneExcepcion = perfil.puestoId !== null
    && (await prisma.cicloPregunta.count({ where: { cicloId, puestoId: perfil.puestoId } })) > 0
  // Sin excepción y sin nivel no hay con qué acotar Y NO SE CONSULTA: en Prisma
  // `where { nivelId: null }` casa con las filas de excepción por puesto (nivelId IS NULL),
  // así que el whitelist se llenaría con el cuestionario de OTROS puestos y anularía todo.
  const delCuestionario = !tieneExcepcion && perfil.nivelId === null
    ? []
    : await prisma.cicloPregunta.findMany({
        where: { cicloId, ...(tieneExcepcion ? { puestoId: perfil.puestoId } : { nivelId: perfil.nivelId }) },
        select: { preguntaId: true, modalidad: true },
      })
  const clavesCuestionario = new Set(delCuestionario.map((cp) => `${cp.modalidad}:${cp.preguntaId}`))
  const enCuestionario = (modalidad: string, preguntaId: string) =>
    clavesCuestionario.size === 0 || clavesCuestionario.has(`${modalidad}:${preguntaId}`)

  const nombreDim = new Map<string, string>()
  const respuestas: RespuestaCalculo[] = asignaciones.flatMap((a) =>
    a.respuestas
      // Inertes las respuestas sobre preguntas que NO declaran la modalidad de la asignación:
      // snapshots sucios (seed) copiaron ítems de ascendente a las 4 modalidades y contaminaban
      // la nota. No se borran (registro histórico) pero no cuentan.
      .filter((r) => r.pregunta.modalidades.includes(a.tipo) && enCuestionario(a.tipo, r.preguntaId))
      .map((r) => {
        nombreDim.set(r.pregunta.competencia.dimensionId, r.pregunta.competencia.dimension.nombre)
        return {
          modalidad: a.tipo as Modalidad,
          dimensionId: r.pregunta.competencia.dimensionId,
          valor: r.valor,
        }
      }),
  )
  const pesosDim = perfil.pesos.map((p) => ({ dimensionId: p.dimensionId, peso: p.peso }))

  // Pesos de modalidades según la estructura del evaluado (manual Hunter): con reportes
  // directos rige el set base; SIN reportes (no se le generaron ascendentes al lanzar) rige
  // la redistribución FIJA Jefe 60 · Pares 40 — no la renormalización proporcional.
  const tieneReportes = (await prisma.asignacion.count({
    where: { cicloId, evaluadoId: colaboradorId, tipo: 'ASCENDENTE' },
  })) > 0
  const pesosModalidades = tieneReportes ? config.pesosModalidades : config.pesosModalidadesSinReportes

  // Desglose por dimensión (reproduce exactamente la nota de competencias) + ajustes de calibración
  const existente = await prisma.resultado.findUnique({ where: { cicloId_colaboradorId: { cicloId, colaboradorId } } })
  const ajustes = (existente?.ajustesDimJson as Record<string, number> | null) ?? undefined
  const desglose = desgloseCompetencias(respuestas, pesosDim, pesosModalidades)
  const notaComp = notaCompetenciasDesdeDesglose(desglose, ajustes)
  const desgloseDim: DimensionResultado[] = desglose
    .map((d) => ({
      dimensionId: d.dimensionId,
      nombre: nombreDim.get(d.dimensionId) ?? d.dimensionId,
      nota: d.nota,
      pesoEfectivo: d.pesoEfectivo,
      ajuste: ajustes?.[d.dimensionId] ?? null,
    }))
    .sort((a, b) => b.pesoEfectivo - a.pesoEfectivo)

  // Objetivos: logro final confirmado (jefe / Dirección). La nota de objetivos NO existe hasta
  // que TODOS los objetivos aprobados aplicables tengan logro (un promedio parcial engaña:
  // sin el transversal, los individuales al 100% mostrarían "Objetivos 100%").
  // Ciclo sin período (periodoId null) = ciclo que NO evalúa objetivos: bypass total, sin
  // consultar objetivosAplicables (recibiría null) — cumplimiento queda null y notaFinal
  // renormaliza a 100% competencias.
  const sinObjetivos = cicloConPeriodo.periodoId === null
  const { transversales, individuales } = sinObjetivos
    ? { transversales: [], individuales: [] }
    : await objetivosAplicables(cicloConPeriodo.periodoId!, colaboradorId, periodoPrecargado)
  const aprobados = [...transversales, ...individuales].filter((o) => o.estado === 'APROBADO')
  const logros = aprobados.map((o) => ({ peso: o.peso, logro: o.logros[0]?.logroFinal ?? null }))
  const faltanLogros = aprobados.length > 0 && logros.some((l) => l.logro === null)
  const cumplimiento = faltanLogros
    ? null
    : cumplimientoObjetivos(logros.filter((l): l is { peso: number; logro: number } => l.logro !== null))

  // El nivel sale del perfil congelado, como los pesos: si el puesto cambia de nivel, la mezcla
  // competencias/objetivos de un ciclo en curso no puede moverse con él
  const combinacion = (perfil.nivelId ? config.combinacionPorNivel[perfil.nivelId] : undefined) ?? { comp: 50, obj: 50 }
  // Con objetivos pendientes la nota final queda pendiente (no se renormaliza a solo competencias);
  // sin objetivos configurados sí se renormaliza (notaFinal lo maneja).
  const final = faltanLogros ? null : notaFinal(notaComp, cumplimiento, combinacion)

  // Mismo criterio y MISMO ALCANCE para el potencial (eje Y del 9-Box): excepción por puesto >
  // nivel del perfil congelado. Contarlo contra el set de todo el ciclo mezclaría niveles
  // (p.ej. tras re-homologar un puesto a mitad de ciclo, respuestas del set viejo y el nuevo).
  const tieneExcepcionPot = perfil.puestoId !== null
    && (await prisma.cicloPreguntaPotencial.count({ where: { cicloId, puestoId: perfil.puestoId } })) > 0
  const potencialDelCiclo = !tieneExcepcionPot && perfil.nivelId === null
    ? []
    : await prisma.cicloPreguntaPotencial.findMany({
        where: { cicloId, ...(tieneExcepcionPot ? { puestoId: perfil.puestoId } : { nivelId: perfil.nivelId }) },
        select: { preguntaPotencialId: true },
      })
  const idsPotencialCiclo = new Set(potencialDelCiclo.map((cp) => cp.preguntaPotencialId))
  const valoresPotencial = asignaciones
    .filter((a) => a.tipo === 'JEFE')
    .flatMap((a) => a.respuestasPotencial
      .filter((r) => idsPotencialCiclo.size === 0 || idsPotencialCiclo.has(r.preguntaId))
      .map((r) => r.valor))
  const pot = potencial(valoresPotencial)

  // El box usa la nota calibrada (ajuste directo legado) si existe
  const desempenoParaBox = existente?.notaCalibrada ?? final
  const box = box9(desempenoParaBox, pot)

  const datos = {
    notaCompetencias: notaComp, cumplimientoObjetivos: cumplimiento,
    notaFinal: final, potencial: pot, box, calculadoEn: new Date(),
    desgloseDimJson: desgloseDim,
  }
  return prisma.resultado.upsert({
    where: { cicloId_colaboradorId: { cicloId, colaboradorId } },
    create: { cicloId, colaboradorId, ...datos },
    update: datos,
  })
}

/** Recalcula los resultados de todos los evaluados del ciclo (al cerrar o bajo demanda de RR.HH.). */
/** Recalcula los resultados del ciclo; con `paisId`, solo los evaluados de ese país
 * (cierre por país: cada país corta sin tocar las notas de los demás). */
export async function calcularResultadosCiclo(cicloId: string, paisId?: string) {
  const [evaluados, ciclo] = await Promise.all([
    prisma.asignacion.findMany({
      where: { cicloId, ...(paisId ? { evaluado: { is: { paisId } } } : {}) },
      select: { evaluadoId: true },
      distinct: ['evaluadoId'],
    }),
    prisma.ciclo.findUniqueOrThrow({ where: { id: cicloId }, select: { periodoId: true } }),
  ])
  // El período es el mismo para todo el ciclo: se carga UNA vez aquí (en vez de una vez por
  // colaborador dentro de objetivosAplicables) y se pasa a cada calcularResultado.
  const periodo = ciclo.periodoId
    ? await prisma.periodoObjetivos.findUniqueOrThrow({ where: { id: ciclo.periodoId } })
    : undefined
  for (const { evaluadoId } of evaluados) await calcularResultado(cicloId, evaluadoId, periodo)
  return evaluados.length
}
