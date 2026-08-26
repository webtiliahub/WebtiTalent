/** Recolector de pendientes de los recordatorios automáticos. Reúne, para cada proceso, a
 * quién le falta qué y con qué deadline — SIN decidir si hoy toca enviar (eso es hitos.ts) y
 * SIN enviar nada (eso es Task 4, que llama a estas funciones y a mailer.ts). */

import { prisma } from '@/shared/lib/prisma'
import { calcularResultado } from '@/features/resultados/servicio'
import { paisesCongelados } from '@/features/ciclos/congelamiento'
import { diasRestantes } from '@/features/recordatorios/hitos'
import { colaboradoresDelPeriodo } from '@/features/objetivos/alcance-periodo'
import type {
  FilaAprobacionJefe, PendienteEvaluacion, DigestPais, DigestPaisEval,
  BloqueDigestObjetivos, BloqueDigestEvaluaciones,
} from '@/shared/lib/mailer'

export type DestinatarioObjetivos = { colaboradorId: string; email: string; nombre: string; avance: number; deadline: Date }
export type DestinatarioJefe = { email: string; nombre: string; filas: FilaAprobacionJefe[] }
export type DestinatarioEvaluador = { colaboradorId: string; email: string; nombre: string; pendientes: PendienteEvaluacion[] }
export type DatosDigestRrhh = {
  usuario: { email: string; nombre: string; alcancePaisId: string | null }
  objetivos: BloqueDigestObjetivos[] // un bloque por período en carga
  evaluaciones: BloqueDigestEvaluaciones[] // un bloque por ciclo activo
}

// ───────────── Helpers puros (testeados en pendientes.test.ts) ─────────────

/** El deadline real de un colaborador: su extensión individual manda SOLO si es posterior
 * al deadline del período (una extensión no puede acortar el plazo general). */
export function deadlineEfectivo(deadlinePeriodo: Date, extension?: Date | null): Date {
  if (extension && extension.getTime() > deadlinePeriodo.getTime()) return extension
  return deadlinePeriodo
}

const ORDEN_MODALIDAD: Record<PendienteEvaluacion['modalidad'], number> = { AUTO: 0, JEFE: 1, PAR: 2, ASCENDENTE: 3 }

/** AUTO primero (es la más rápida de completar), luego JEFE/PAR/ASCENDENTE. Orden estable
 * dentro de cada modalidad (no reordena pendientes ya agrupados con sentido). */
export function ordenarPendientes(pendientes: PendienteEvaluacion[]): PendienteEvaluacion[] {
  return [...pendientes].sort((a, b) => ORDEN_MODALIDAD[a.modalidad] - ORDEN_MODALIDAD[b.modalidad])
}


// ───────────── Núcleos con Prisma (sin unit tests: los cubre el E2E de Task 5) ─────────────

/** Cobertura de carga de TODOS los colaboradores del ALCANCE DEL PERÍODO (vía
 * `colaboradoresDelPeriodo`), sin alcance de PAÍS de sesión: el cron notifica a todo el
 * alcance, no solo a lo que vería quien lo dispara. Es un duplicado deliberado del núcleo de
 * cálculo de `coberturaPeriodo` (src/features/objetivos/acciones-periodo.ts:220) — esa
 * función exige sesión admin (es un endpoint invocable directamente) y además recorta por el
 * alcance de PAÍS de quien la llama, dos cosas que NO aplican en un cron sin sesión que debe
 * cubrir a todos los países dentro del alcance del período. No se tocó el guard de la
 * original: se replicó su cálculo aquí para no acoplar el cron a una redirect().
 * Devuelve solo los colaboradores que NO llegan al 100% del peso total. */
async function incompletosDelPeriodo(periodoId: string) {
  const periodo = await prisma.periodoObjetivos.findUniqueOrThrow({ where: { id: periodoId } })
  const [colaboradores, objetivos, extensiones, paises] = await Promise.all([
    colaboradoresDelPeriodo(periodo),
    prisma.objetivo.findMany({ where: { periodoId, estado: 'APROBADO' } }),
    prisma.extensionPlazoObjetivos.findMany({ where: { periodoId, hasta: { gte: new Date() } } }),
    prisma.pais.findMany({ select: { id: true, nombre: true } }),
  ])
  const nombrePais = new Map(paises.map((p) => [p.id, p.nombre]))
  const extensionDe = new Map(extensiones.map((e) => [e.colaboradorId, e.hasta]))
  const transversales = objetivos.filter((o) => o.tipo === 'TRANSVERSAL')
  const pesoTransversalDe = (c: (typeof colaboradores)[number]) =>
    transversales
      .filter((t) => {
        const porArea = t.focoAreaIds.length === 0 || (c.areaId !== null && t.focoAreaIds.includes(c.areaId))
        const porNivel = t.focoNivelIds.length === 0 || (c.nivelId !== null && t.focoNivelIds.includes(c.nivelId))
        const porPais = t.focoPaisIds.length === 0 || t.focoPaisIds.includes(c.paisId)
        const porPuesto = t.focoPuestoIds.length === 0 || (c.puestoId !== null && t.focoPuestoIds.includes(c.puestoId))
        return porArea && porNivel && porPais && porPuesto
      })
      .reduce((a, t) => a + t.peso, 0)
  return colaboradores
    .map((c) => {
      const propios = objetivos.filter((o) => o.colaboradorId === c.id).reduce((a, o) => a + o.peso, 0)
      return {
        id: c.id,
        nombre: `${c.nombres} ${c.apellidos}`,
        paisNombre: nombrePais.get(c.paisId) ?? '',
        total: Math.min(propios + pesoTransversalDe(c), 100),
        extensionHasta: extensionDe.get(c.id) ?? null,
      }
    })
    .filter((c) => c.total < 100)
}

/** Colaboradores del período que no llegan al 100% del peso, con su deadline efectivo y
 * cuenta. Los sin cuenta activa se cuentan pero no se listan (no hay a quién avisar). */
export async function pendientesObjetivos(periodoId: string): Promise<{ deadlinePeriodo: Date; destinatarios: DestinatarioObjetivos[]; sinCuenta: number }> {
  const periodo = await prisma.periodoObjetivos.findUniqueOrThrow({ where: { id: periodoId } })
  const incompletos = await incompletosDelPeriodo(periodoId)
  const cuentas = await prisma.usuario.findMany({
    where: { activo: true, colaboradorId: { in: incompletos.map((c) => c.id) } },
    select: { email: true, colaboradorId: true },
  })
  const emailDe = new Map(cuentas.map((u) => [u.colaboradorId as string, u.email]))
  const destinatarios: DestinatarioObjetivos[] = []
  for (const c of incompletos) {
    const email = emailDe.get(c.id)
    if (!email) continue
    destinatarios.push({
      colaboradorId: c.id, email, nombre: c.nombre, avance: c.total,
      deadline: deadlineEfectivo(periodo.fechaLimiteCarga, c.extensionHasta),
    })
  }
  return { deadlinePeriodo: periodo.fechaLimiteCarga, destinatarios, sinCuenta: incompletos.length - destinatarios.length }
}

/** Propuestas de objetivos (estado PROPUESTO) pendientes de aprobación del jefe directo,
 * agrupadas por jefe. Los transversales nunca llegan aquí (nacen APROBADO). Solo cuentan las
 * propuestas de colaboradores dentro del alcance del período (`colaboradoresDelPeriodo`): un
 * colaborador que quedó fuera del alcance tras editarlo no debe generar aviso al jefe. Jefes
 * sin cuenta activa (o colaboradores sin jefe directo asignado) no reciben aviso: se cuentan
 * los jefes sin cuenta; un colaborador sin jefe es un caso borde (raíz de la jerarquía) sin
 * nadie a quien avisar y no suma al contador (no es una cuenta "faltante", es un dato del
 * padrón). */
export async function aprobacionesPorJefe(periodoId: string): Promise<{ destinatarios: DestinatarioJefe[]; sinCuenta: number }> {
  const periodo = await prisma.periodoObjetivos.findUniqueOrThrow({ where: { id: periodoId } })
  const idsAlcance = new Set((await colaboradoresDelPeriodo(periodo)).map((c) => c.id))
  const propuestos = await prisma.objetivo.findMany({
    where: { periodoId, estado: 'PROPUESTO' },
    select: { peso: true, colaboradorId: true },
  })
  const porColaborador = new Map<string, { objetivos: number; pesoTotal: number }>()
  for (const o of propuestos) {
    if (!o.colaboradorId || !idsAlcance.has(o.colaboradorId)) continue
    const acc = porColaborador.get(o.colaboradorId) ?? { objetivos: 0, pesoTotal: 0 }
    acc.objetivos += 1
    acc.pesoTotal += o.peso
    porColaborador.set(o.colaboradorId, acc)
  }
  if (porColaborador.size === 0) return { destinatarios: [], sinCuenta: 0 }

  const colaboradores = await prisma.colaborador.findMany({
    where: { id: { in: [...porColaborador.keys()] } },
    select: { id: true, nombres: true, apellidos: true, jefeId: true },
  })
  const jefeIds = [...new Set(colaboradores.map((c) => c.jefeId).filter((j): j is string => j !== null))]
  const cuentasJefes = await prisma.usuario.findMany({
    where: { activo: true, colaboradorId: { in: jefeIds } },
    select: { email: true, colaboradorId: true, colaborador: { select: { nombres: true, apellidos: true } } },
  })
  const cuentaDeJefe = new Map(cuentasJefes.map((u) => [u.colaboradorId as string, u]))

  const filasPorJefe = new Map<string, FilaAprobacionJefe[]>()
  for (const c of colaboradores) {
    if (!c.jefeId) continue
    const datos = porColaborador.get(c.id)!
    const filas = filasPorJefe.get(c.jefeId) ?? []
    filas.push({ nombre: `${c.nombres} ${c.apellidos}`, objetivos: datos.objetivos, pesoTotal: datos.pesoTotal })
    filasPorJefe.set(c.jefeId, filas)
  }

  const destinatarios: DestinatarioJefe[] = []
  let sinCuenta = 0
  for (const [jefeId, filas] of filasPorJefe) {
    const cuenta = cuentaDeJefe.get(jefeId)
    if (!cuenta) { sinCuenta++; continue }
    destinatarios.push({ email: cuenta.email, nombre: `${cuenta.colaborador!.nombres} ${cuenta.colaborador!.apellidos}`, filas })
  }
  return { destinatarios, sinCuenta }
}

/** Asignaciones pendientes (estado fuera de PROPUESTA/ENVIADA/INVALIDADA) del ciclo, agrupadas por
 * evaluador, excluyendo evaluados de países ya cerrados (congelados: no se les vuelve a
 * tocar nada, ni siquiera un recordatorio de una evaluación que ya no importa).
 * PROPUESTA no cuenta: el evaluador no puede completarla hasta que RR.HH. la apruebe
 * — mismo criterio que /evaluaciones y el avance del ciclo. */
export async function pendientesEvaluaciones(cicloId: string): Promise<{ deadline: Date; destinatarios: DestinatarioEvaluador[]; sinCuenta: number }> {
  const ciclo = await prisma.ciclo.findUniqueOrThrow({ where: { id: cicloId }, select: { fechaFin: true } })
  const paisesCerrados = await paisesCongelados(cicloId)

  const asignacionesPendientes = await prisma.asignacion.findMany({
    where: { cicloId, estado: { notIn: ['PROPUESTA', 'ENVIADA', 'INVALIDADA'] } },
    select: {
      tipo: true,
      evaluadorId: true,
      evaluador: { select: { nombres: true, apellidos: true } },
      evaluado: { select: { nombres: true, apellidos: true, paisId: true } },
    },
  })
  const vigentes = asignacionesPendientes.filter((a) => !paisesCerrados.has(a.evaluado.paisId))
  if (vigentes.length === 0) return { deadline: ciclo.fechaFin, destinatarios: [], sinCuenta: 0 }

  const evaluadorIds = [...new Set(vigentes.map((a) => a.evaluadorId))]
  const cuentas = await prisma.usuario.findMany({
    where: { activo: true, colaboradorId: { in: evaluadorIds } },
    select: { email: true, colaboradorId: true },
  })
  const emailDe = new Map(cuentas.map((u) => [u.colaboradorId as string, u.email]))

  const porEvaluador = new Map<string, { nombre: string; pendientes: PendienteEvaluacion[] }>()
  for (const a of vigentes) {
    const acc = porEvaluador.get(a.evaluadorId) ?? { nombre: `${a.evaluador.nombres} ${a.evaluador.apellidos}`, pendientes: [] }
    acc.pendientes.push({ modalidad: a.tipo, evaluado: `${a.evaluado.nombres} ${a.evaluado.apellidos}` })
    porEvaluador.set(a.evaluadorId, acc)
  }

  const destinatarios: DestinatarioEvaluador[] = []
  let sinCuenta = 0
  for (const [evaluadorId, datos] of porEvaluador) {
    const email = emailDe.get(evaluadorId)
    if (!email) { sinCuenta++; continue }
    destinatarios.push({ colaboradorId: evaluadorId, email, nombre: datos.nombre, pendientes: ordenarPendientes(datos.pendientes) })
  }
  return { deadline: ciclo.fechaFin, destinatarios, sinCuenta }
}

/** Digest de objetivos de UN período, por país: cuántos colaboradores de ese país no llegan
 * al 100% + cuántos jefes de subordinados de ese país tienen propuestas sin aprobar. El país
 * atribuido en ambos casos es el del COLABORADOR con el pendiente (no el del jefe): así el
 * RR.HH. de un país ve todo lo que afecta a su gente, aunque el jefe sea de otro país. */
async function digestObjetivosDePeriodo(periodoId: string): Promise<DigestPais[]> {
  const incompletos = await incompletosDelPeriodo(periodoId)
  const propuestos = await prisma.objetivo.findMany({ where: { periodoId, estado: 'PROPUESTO' }, select: { colaboradorId: true } })
  const colaboradorIds = [...new Set(propuestos.map((o) => o.colaboradorId).filter((id): id is string => id !== null))]
  const colaboradoresConPropuesta = colaboradorIds.length
    ? await prisma.colaborador.findMany({
        where: { id: { in: colaboradorIds } },
        select: { jefeId: true, pais: { select: { nombre: true } } },
      })
    : []

  const jefesPorPais = new Map<string, Set<string>>()
  for (const c of colaboradoresConPropuesta) {
    if (!c.jefeId) continue
    const set = jefesPorPais.get(c.pais.nombre) ?? new Set<string>()
    set.add(c.jefeId)
    jefesPorPais.set(c.pais.nombre, set)
  }
  const sinCompletarPorPais = new Map<string, number>()
  for (const c of incompletos) sinCompletarPorPais.set(c.paisNombre, (sinCompletarPorPais.get(c.paisNombre) ?? 0) + 1)

  const paises = new Set([...sinCompletarPorPais.keys(), ...jefesPorPais.keys()])
  return [...paises].map((pais) => ({
    pais,
    sinCompletar: sinCompletarPorPais.get(pais) ?? 0,
    jefesPorAprobar: jefesPorPais.get(pais)?.size ?? 0,
  }))
}

/** Digest de evaluaciones de UN ciclo, por país del evaluado: evaluadores distintos y total
 * de evaluaciones pendientes. `vigentes`/`enviadas` (para el avance GLOBAL, no por país — así
 * lo rotula el correo) excluyen PROPUESTA/INVALIDADA y a los evaluados de países ya congelados.
 * PROPUESTA no cuenta: el evaluador no puede completarla hasta que RR.HH. la apruebe
 * — mismo criterio que /evaluaciones y el avance del ciclo. */
async function digestEvaluacionesDeCiclo(cicloId: string): Promise<{ filas: DigestPaisEval[]; vigentes: number; enviadas: number }> {
  const paisesCerrados = await paisesCongelados(cicloId)
  const asignaciones = await prisma.asignacion.findMany({
    where: { cicloId, estado: { notIn: ['PROPUESTA', 'INVALIDADA'] } },
    select: { estado: true, evaluadorId: true, evaluado: { select: { paisId: true, pais: { select: { nombre: true } } } } },
  })
  const vigentes = asignaciones.filter((a) => !paisesCerrados.has(a.evaluado.paisId))
  const enviadas = vigentes.filter((a) => a.estado === 'ENVIADA').length
  const pendientes = vigentes.filter((a) => a.estado !== 'ENVIADA')

  const evaluadoresPorPais = new Map<string, Set<string>>()
  const evaluacionesPorPais = new Map<string, number>()
  for (const a of pendientes) {
    const pais = a.evaluado.pais.nombre
    evaluacionesPorPais.set(pais, (evaluacionesPorPais.get(pais) ?? 0) + 1)
    const set = evaluadoresPorPais.get(pais) ?? new Set<string>()
    set.add(a.evaluadorId)
    evaluadoresPorPais.set(pais, set)
  }
  const filas: DigestPaisEval[] = [...evaluacionesPorPais.keys()].map((pais) => ({
    pais, evaluadores: evaluadoresPorPais.get(pais)?.size ?? 0, evaluaciones: evaluacionesPorPais.get(pais) ?? 0,
  }))
  return { filas, vigentes: vigentes.length, enviadas }
}

/** Una entrada por cuenta RR.HH. activa, ya recortada a su alcance (Regional ve todos los
 * países agregados por país; de país solo el suyo). Si hay más de un período en carga o
 * ciclo activo a la vez, combina sus filas por país (sumadas) y usa el de cierre más próximo
 * como cabecera (nombre/días restantes) del bloque — el avance global de evaluaciones SÍ
 * combina los conteos crudos de todos los ciclos activos (no promedia porcentajes ya
 * calculados, para no distorsionar cuando un ciclo pesa mucho más que otro). Alcances sin
 * ningún pendiente quedan excluidos del resultado. */
export async function datosDigestRrhh(): Promise<DatosDigestRrhh[]> {
  const ahora = new Date()
  const [periodos, ciclos, usuariosRrhh] = await Promise.all([
    prisma.periodoObjetivos.findMany({ where: { estado: 'CARGA_ABIERTA' }, orderBy: { fechaLimiteCarga: 'asc' } }),
    prisma.ciclo.findMany({ where: { estado: 'ACTIVO' }, orderBy: { fechaFin: 'asc' } }),
    prisma.usuario.findMany({
      where: { activo: true, rol: 'RRHH' },
      select: { email: true, alcanceRrhh: true, alcancePaisId: true, colaborador: { select: { nombres: true, apellidos: true } } },
    }),
  ])

  /* UN BLOQUE POR PROCESO, sin combinar: sumar las filas de varios ciclos bajo el nombre del que
     cierra más pronto mostraba a RR.HH. números que no existen en ese ciclo (p.ej. «TEST
     CHRISTIAN» con los pendientes de «PRUEBA GH ECUADOR» encima). Cada bloque lleva su nombre,
     su deadline y su avance propio; los vacíos no se incluyen. */
  const bloquesObjetivos: BloqueDigestObjetivos[] = []
  for (const periodo of periodos) {
    const filas = await digestObjetivosDePeriodo(periodo.id)
    if (filas.length > 0) {
      bloquesObjetivos.push({ periodo: periodo.nombre, diasRestantes: diasRestantes(periodo.fechaLimiteCarga, ahora), filas })
    }
  }

  const bloquesEvaluaciones: BloqueDigestEvaluaciones[] = []
  for (const ciclo of ciclos) {
    const { filas, vigentes, enviadas } = await digestEvaluacionesDeCiclo(ciclo.id)
    if (filas.length > 0) {
      bloquesEvaluaciones.push({
        ciclo: ciclo.nombre,
        diasRestantes: diasRestantes(ciclo.fechaFin, ahora),
        filas,
        avancePct: vigentes > 0 ? Math.round((enviadas / vigentes) * 100) : 100,
      })
    }
  }

  if (bloquesObjetivos.length === 0 && bloquesEvaluaciones.length === 0) return []

  // Alcance de PAÍS: cada bloque se recorta a las filas de su país, y el bloque sin filas cae
  const recortarObjetivos = (alcanceRrhh: 'REGIONAL' | 'PAIS' | null, paisNombre: string | null) => {
    if (alcanceRrhh !== 'PAIS') return bloquesObjetivos // Regional: todos los países
    return bloquesObjetivos
      .map((b) => ({ ...b, filas: b.filas.filter((f) => f.pais === paisNombre) }))
      .filter((b) => b.filas.length > 0)
  }
  const recortarEvaluaciones = (alcanceRrhh: 'REGIONAL' | 'PAIS' | null, paisNombre: string | null) => {
    if (alcanceRrhh !== 'PAIS') return bloquesEvaluaciones
    return bloquesEvaluaciones
      .map((b) => ({ ...b, filas: b.filas.filter((f) => f.pais === paisNombre) }))
      .filter((b) => b.filas.length > 0)
  }

  const paisesPorId = new Map((await prisma.pais.findMany()).map((p) => [p.id, p.nombre]))
  const resultado: DatosDigestRrhh[] = []
  for (const u of usuariosRrhh) {
    if (!u.colaborador) continue // cuenta RR.HH. huérfana (sin colaborador vinculado): sin nombre para el correo
    const paisNombre = u.alcancePaisId ? paisesPorId.get(u.alcancePaisId) ?? null : null
    const objetivos = recortarObjetivos(u.alcanceRrhh, paisNombre)
    const evaluaciones = recortarEvaluaciones(u.alcanceRrhh, paisNombre)
    if (objetivos.length === 0 && evaluaciones.length === 0) continue // su alcance no tiene pendientes
    resultado.push({
      usuario: { email: u.email, nombre: `${u.colaborador.nombres} ${u.colaborador.apellidos}`, alcancePaisId: u.alcancePaisId },
      objetivos,
      evaluaciones,
    })
  }
  return resultado
}

/** Evaluados del ciclo cuya nota preliminar quedó lista HOY y aún no se les avisó. Orden de
 * filtros, del más barato al más caro (evita invocar `calcularResultado`, que persiste, para
 * toda la organización en cada corrida):
 *   1) evaluados del ciclo, ya excluyendo país congelado (mismo criterio que ciclosConNotaPreview)
 *   2) de esos, quienes tienen 0 asignaciones sin enviar (insumos completos)
 *   3) de esos, quienes NO tienen ya una fila de RecordatorioEnvio para NOTA_PRELIMINAR
 *   4) de esos, quienes tienen cuenta activa (si no, no hay a quién avisar)
 *   5) SOLO para los que llegan hasta aquí: calcularResultado + notaFinal !== null. */
export async function notasPreliminaresNuevas(cicloId: string): Promise<{ colaboradorId: string; email: string; nombre: string }[]> {
  const ciclo = await prisma.ciclo.findUnique({ where: { id: cicloId }, select: { estado: true } })
  if (!ciclo || ciclo.estado !== 'ACTIVO') return []

  const paisesCerrados = await paisesCongelados(cicloId)
  const evaluados = await prisma.asignacion.findMany({
    where: { cicloId, evaluado: { is: { paisId: { notIn: [...paisesCerrados] } } } },
    select: { evaluadoId: true },
    distinct: ['evaluadoId'],
  })
  if (evaluados.length === 0) return []

  const conPendientes = await prisma.asignacion.findMany({
    where: { cicloId, evaluadoId: { in: evaluados.map((e) => e.evaluadoId) }, estado: { notIn: ['ENVIADA', 'INVALIDADA'] } },
    select: { evaluadoId: true },
    distinct: ['evaluadoId'],
  })
  const idsConPendientes = new Set(conPendientes.map((c) => c.evaluadoId))
  const completos = evaluados.map((e) => e.evaluadoId).filter((id) => !idsConPendientes.has(id))
  if (completos.length === 0) return []

  const yaNotificados = await prisma.recordatorioEnvio.findMany({
    where: { proceso: 'NOTA_PRELIMINAR', referencia: cicloId, destinatarioId: { in: completos } },
    select: { destinatarioId: true },
  })
  const notificadosSet = new Set(yaNotificados.map((r) => r.destinatarioId))
  const candidatos = completos.filter((id) => !notificadosSet.has(id))
  if (candidatos.length === 0) return []

  const cuentas = await prisma.usuario.findMany({
    where: { activo: true, colaboradorId: { in: candidatos } },
    select: { colaboradorId: true, email: true, colaborador: { select: { nombres: true, apellidos: true } } },
  })
  if (cuentas.length === 0) return []

  const nuevos: { colaboradorId: string; email: string; nombre: string }[] = []
  for (const cuenta of cuentas) {
    // Idempotente (upsert): recalcular no daña nada, pero solo llega aquí quien ya pasó
    // todos los filtros baratos — no se recalcula a nadie de más.
    const resultado = await calcularResultado(cicloId, cuenta.colaboradorId!)
    if (resultado.notaFinal === null) continue
    nuevos.push({ colaboradorId: cuenta.colaboradorId!, email: cuenta.email, nombre: `${cuenta.colaborador!.nombres} ${cuenta.colaborador!.apellidos}` })
  }
  return nuevos
}
