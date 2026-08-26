import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin, alcancePaisWhere, cicloFueraDeAlcance } from '@/shared/lib/permisos'
import { tieneAdmin } from '@/shared/lib/permisos-admin'
import { Avatar, AvisoSoloLectura, Card, Chip, Nota, Stat, Titulo, Vacio } from '@/shared/ui/componentes'
import { Tabs } from '@/shared/ui/Tabs'
import { PreflightLanzamiento, TablaParesRrhh, ListaCalibracion, PanelCierre, PanelAvancePais, ExportarResultadosBtn, type MiembroCalibracion } from '@/features/admin/PanelCiclo'
import { TabIncidentes, type BajaCiclo } from '@/features/admin/TabIncidentes'
import { incidentesCiclo, type IncidenteEvaluado } from '@/features/ciclos/incidentes'
import { preflightCiclo, feedbackPendiente, conformidadPendiente } from '@/features/ciclos/preflight'
import { resumenAlcance } from '@/features/ciclos/alcance'
import { TablaConformidad } from '@/features/admin/TablaConformidad'
import { EditarEvaluacionesCiclo } from '@/features/admin/EditarEvaluacionesCiclo'
import { nivelesParaSelectorEvaluaciones } from '@/features/admin/selector-evaluaciones-datos'
import { configDelCiclo, objetivosAplicables, type DimensionResultado } from '@/features/resultados/servicio'
import { CardRecordatorios } from '@/features/recordatorios/CardRecordatorios'
import { BotonRecordatorioManual } from '@/features/recordatorios/BotonRecordatorioManual'

export default async function CicloDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await requiereAdmin('CICLOS', 'VER')
  const puedeGestionar = tieneAdmin(sesion.permisosAdmin, 'CICLOS', 'GESTIONAR')
  // Calibrar/cerrar/publicar escribe la nota: exclusivo del rol de sistema RR.HH. (el servidor lo
  // exige; aquí se ocultan los controles para no ofrecer un botón que va a fallar)
  const puedeTocarNotas = puedeGestionar && sesion.rol === 'RRHH'
  const { id } = await params
  const jar = await cookies()

  const ciclo = await prisma.ciclo.findUnique({
    where: { id },
    include: { _count: { select: { asignaciones: true, preguntas: true } } },
  })
  if (!ciclo) notFound()

  const [paisesCat, areasCat, nivelesCat] = await Promise.all([
    prisma.pais.findMany({ select: { id: true, nombre: true } }),
    prisma.area.findMany({ select: { id: true, nombre: true } }),
    prisma.nivelJerarquico.findMany({ select: { id: true, nombre: true } }),
  ])
  const alcanceTexto = resumenAlcance(
    { focoPaisIds: ciclo.focoPaisIds, focoAreaIds: ciclo.focoAreaIds, focoNivelIds: ciclo.focoNivelIds },
    {
      paises: new Map(paisesCat.map((x) => [x.id, x.nombre])),
      areas: new Map(areasCat.map((x) => [x.id, x.nombre])),
      niveles: new Map(nivelesCat.map((x) => [x.id, x.nombre])),
    },
    { incluidos: ciclo.incluirIds.length, excluidos: ciclo.excluirIds.length },
  )

  // El alcance del RR.HH. de país SIEMPRE manda (piso): un ciclo de otro país o global se
  // recorta a su país. RR.HH. Regional ve el filtro de la barra superior (o nada, sin filtro)
  // — igual para un ciclo de un solo país que para uno regional, así el incluido cross-país
  // vía `incluirIds` no queda invisible en las vistas del detalle.
  const scopeSesion = alcancePaisWhere(sesion)
  const wherePais = scopeSesion.paisId
    ? scopeSesion
    : alcancePaisWhere(sesion, jar.get('pais')?.value ?? null)

  // Asignaciones ACOTADAS al alcance: los contadores del ciclo (evaluaciones, avance,
  // modalidades, pendientes por evaluador) respetan el país del RR.HH., incluso en ciclos regionales.
  const asignaciones = await prisma.asignacion.findMany({
    where: { cicloId: id, estado: { notIn: ['PROPUESTA', 'INVALIDADA'] }, evaluado: { is: wherePais } }, // las propuestas de par aún no son evaluaciones
    select: {
      estado: true, tipo: true,
      evaluado: { select: { nombres: true, apellidos: true } },
      evaluador: { select: { id: true, nombres: true, apellidos: true, area: { select: { nombre: true } }, jefe: { select: { nombres: true, apellidos: true } } } },
    },
  })
  const enviadas = asignaciones.filter((a) => a.estado === 'ENVIADA').length
  const pendientes = asignaciones.length - enviadas
  const avance = asignaciones.length === 0 ? 0 : Math.round((enviadas / asignaciones.length) * 100)

  // Resultados para calibración (solo evaluados con nota, acotados al alcance)
  const resultados = ciclo.estado !== 'BORRADOR'
    ? await prisma.resultado.findMany({
        where: { cicloId: id, notaFinal: { not: null }, colaborador: { is: wherePais } },
        include: {
          colaborador: { include: { puesto: true, area: { select: { nombre: true } }, jefe: { select: { id: true, nombres: true, apellidos: true } } } },
          calibraciones: { include: { usuario: { include: { colaborador: true } } }, orderBy: { createdAt: 'desc' } },
        },
        orderBy: { notaFinal: 'desc' },
      })
    : []

  const colaboradoresAlcance = ciclo.estado !== 'BORRADOR'
    ? await prisma.colaborador.findMany({
        where: { activo: true, ...wherePais },
        include: { jefe: { select: { id: true, nombres: true, apellidos: true } }, puesto: { select: { nombre: true } }, area: { select: { nombre: true } } },
        orderBy: { apellidos: 'asc' },
        take: 1200,
      })
    : []

  const paresTodos = await prisma.asignacion.findMany({
    where: { cicloId: id, tipo: 'PAR', evaluado: { is: wherePais } },
    include: { evaluador: true, evaluado: { include: { jefe: { select: { nombres: true, apellidos: true } } } } },
  })

  // La reasignación de evaluador en TabIncidentes busca server-side (buscarCandidatosParRrhh),
  // igual que TablaParesRrhh: ya no se materializa ningún pool del padrón hacia el cliente.
  const pares = paresTodos.filter((p) => p.estado !== 'PROPUESTA' && p.estado !== 'INVALIDADA')
  const propuestasPares = paresTodos.filter((p) => p.estado === 'PROPUESTA')

  // ── Rotación: el padrón cambió desde el lanzamiento (solo ciclo ACTIVO) ──
  // El ciclo es una foto; aquí se detecta lo que divergió y RR.HH. lo resuelve auditado.
  let rotacionBajas: BajaCiclo[] = []
  let incidentes: IncidenteEvaluado[] = []
  if (ciclo.estado === 'ACTIVO') {
    const asigsRotacion = await prisma.asignacion.findMany({
      where: { cicloId: id, estado: { not: 'PROPUESTA' }, evaluado: { is: wherePais } },
      select: {
        id: true, tipo: true, estado: true,
        evaluado: { select: { id: true, nombres: true, apellidos: true, activo: true, puesto: { select: { nombre: true } } } },
        evaluador: { select: { id: true, nombres: true, apellidos: true, activo: true } },
      },
    })
    const bajasMap = new Map<string, BajaCiclo>()
    const bajaDe = (c: { id: string; nombres: string; apellidos: string; puesto?: { nombre: string } | null }) => {
      if (!bajasMap.has(c.id)) {
        bajasMap.set(c.id, {
          colaboradorId: c.id,
          nombre: `${c.nombres} ${c.apellidos}`,
          puesto: c.puesto?.nombre ?? 'Sin puesto',
          enviadasSobreEl: 0, pendientesSobreEl: 0, pendientesSuyas: 0,
          tieneResultado: false, logrosFaltantes: 0, resuelta: false,
        })
      }
      return bajasMap.get(c.id)!
    }
    for (const a of asigsRotacion) {
      // Baja del EVALUADO: todas sus evaluaciones (aun las enviadas) quedan en cuestión
      if (!a.evaluado.activo) {
        const b = bajaDe(a.evaluado)
        if (a.estado === 'ENVIADA') b.enviadasSobreEl += 1
        else b.pendientesSobreEl += 1
      }
      // Baja del EVALUADOR con pendientes: se cuentan en su ficha (sus enviadas se conservan)
      if (!a.evaluador.activo && a.estado !== 'ENVIADA' && a.evaluador.id !== a.evaluado.id) {
        bajaDe(a.evaluador).pendientesSuyas += 1
      }
    }
    // Estado de cada baja: ¿ya tiene nota conservada? ¿faltan logros para calcularla?
    if (bajasMap.size > 0) {
      const conResultado = new Set(
        (await prisma.resultado.findMany({
          where: { cicloId: id, colaboradorId: { in: [...bajasMap.keys()] }, notaFinal: { not: null } },
          select: { colaboradorId: true },
        })).map((r) => r.colaboradorId),
      )
      for (const [cid, b] of bajasMap) {
        b.tieneResultado = conResultado.has(cid)
        if (b.enviadasSobreEl > 0) {
          // Ciclo sin período (periodoId null): no evalúa objetivos, nunca faltan logros
          const { transversales, individuales } = ciclo.periodoId
            ? await objetivosAplicables(ciclo.periodoId, cid)
            : { transversales: [], individuales: [] }
          b.logrosFaltantes = [...transversales, ...individuales]
            .filter((o) => o.estado === 'APROBADO' && o.logros[0]?.logroFinal == null).length
        }
        // Baja resuelta: sin pendientes (sobre él ni suyas) y con su nota de salida ya
        // conservada. Sigue listada como informativa, pero no cuenta como incidente abierto
        // ni re-ofrece la acción destructiva de retiro.
        b.resuelta = b.pendientesSobreEl === 0 && b.pendientesSuyas === 0 && b.tieneResultado
      }
    }
    rotacionBajas = [...bajasMap.values()]
    incidentes = await incidentesCiclo(id, wherePais)
  }

  // Evaluaciones invalidadas del ciclo: reversibles solo mientras el ciclo esté ACTIVO y el
  // país del evaluado no haya cerrado (después quedan definitivas como registro)
  const invalidadas = ciclo.estado === 'ACTIVO'
    ? (await prisma.asignacion.findMany({
        where: { cicloId: id, estado: 'INVALIDADA', evaluado: { is: wherePais } },
        select: {
          id: true, tipo: true,
          evaluado: { select: { nombres: true, apellidos: true } },
          evaluador: { select: { nombres: true, apellidos: true } },
        },
      })).map((a) => ({
        asignacionId: a.id,
        tipo: a.tipo,
        evaluado: `${a.evaluado.nombres} ${a.evaluado.apellidos}`,
        evaluador: `${a.evaluador.nombres} ${a.evaluador.apellidos}`,
      }))
    : []

  // Pre-flight del lanzamiento: solo mientras el ciclo es borrador
  /* El checklist de lanzamiento se calcula sobre TODA la región a propósito (simula lo que hará
     `lanzarCiclo`: el jefe y los reportes de otro país también evalúan), y sus listas de nombres
     viajan enteras al componente cliente. Solo se calcula, entonces, para quien puede lanzar este
     ciclo: un RR.HH. de país no puede lanzar uno regional, así que verlo solo le mostraría
     nombres, puestos y jerarquías fuera de su alcance. */
  const puedeLanzar = !cicloFueraDeAlcance(sesion, ciclo)
  const preflight = ciclo.estado === 'BORRADOR' && puedeLanzar ? await preflightCiclo(ciclo.id) : null

  // Edición del set de evaluaciones (solo en borrador): selector del wizard + selección actual
  const [nivelesSelector, evalsCiclo] = ciclo.estado === 'BORRADOR'
    ? await Promise.all([
        nivelesParaSelectorEvaluaciones(),
        prisma.cicloEvaluacion.findMany({
          where: { cicloId: id },
          include: { evaluacion: { select: { id: true, nivelId: true, puestoId: true } } },
        }),
      ])
    : [null, []]
  const porNivelInicial = Object.fromEntries(
    evalsCiclo.filter((e) => e.evaluacion.nivelId).map((e) => [e.evaluacion.nivelId!, e.evaluacion.id]),
  )
  const porPuestoInicial = Object.fromEntries(
    evalsCiclo.filter((e) => e.evaluacion.puestoId).map((e) => [e.evaluacion.puestoId!, e.evaluacion.id]),
  )

  // Sesiones de feedback (gate del cierre): resultados → conversación jefe-colaborador → cierre.
  // Para el RR.HH. de país, el gate y el contador se acotan a su país.
  const feedback = ciclo.estado === 'ACTIVO' ? await feedbackPendiente(ciclo.id, wherePais.paisId) : null
  const feedbacksCiclo = ciclo.estado !== 'BORRADOR' ? await prisma.feedback.findMany({ where: { cicloId: id } }) : []

  // Conformidad de nota (segundo gate del cierre): cada colaborador con nota confirma o
  // RR.HH. Regional lo exime por persona. Acotada al alcance, igual que el feedback.
  const conformidad = ciclo.estado !== 'BORRADOR' ? await conformidadPendiente(ciclo.id, wherePais.paisId) : null

  // ── Cierre por país (ciclos regionales): estado de cierre + avance por país ──
  const esRegionalSesion = sesion.alcanceRrhh === 'REGIONAL'
  const cierresPais = !ciclo.paisId && ciclo.estado !== 'BORRADOR'
    ? await prisma.cicloPaisCierre.findMany({ where: { cicloId: id }, include: { pais: true } })
    : []
  const filasAvancePais = !ciclo.paisId && ciclo.estado !== 'BORRADOR'
    ? await (async () => {
        const [asigsGlobal, resultadosGlobal, feedbacksGlobal, paisesTodos] = await Promise.all([
          prisma.asignacion.findMany({
            where: { cicloId: id, estado: { notIn: ['PROPUESTA', 'INVALIDADA'] } },
            select: { estado: true, evaluadoId: true, evaluado: { select: { paisId: true } } },
          }),
          prisma.resultado.findMany({
            // Solo ACTIVOS: el gate de feedback no exige sesión a los dados de baja, y contarlos
            // dejaba el avance por país en n−1/n para siempre
            where: { cicloId: id, OR: [{ notaFinal: { not: null } }, { notaCalibrada: { not: null } }], colaborador: { is: { activo: true } } },
            select: { colaboradorId: true, colaborador: { select: { paisId: true } } },
          }),
          prisma.feedback.findMany({ where: { cicloId: id }, select: { colaboradorId: true, colaborador: { select: { paisId: true } } } }),
          prisma.pais.findMany({ orderBy: { nombre: 'asc' } }),
        ])
        const conFeedback = new Set(feedbacksGlobal.map((f) => f.colaboradorId))
        return paisesTodos
          .map((p) => {
            const asigs = asigsGlobal.filter((a) => a.evaluado.paisId === p.id)
            const conNota = resultadosGlobal.filter((r) => r.colaborador.paisId === p.id)
            const cierre = cierresPais.find((c) => c.paisId === p.id)
            return {
              paisId: p.id,
              pais: p.nombre,
              participantes: new Set(asigs.map((a) => a.evaluadoId)).size,
              total: asigs.length,
              enviadas: asigs.filter((a) => a.estado === 'ENVIADA').length,
              feedbackRequeridos: conNota.length,
              feedbackRegistrados: conNota.filter((r) => conFeedback.has(r.colaboradorId)).length,
              cerrado: Boolean(cierre),
              publicado: ciclo.publicado || Boolean(cierre?.publicado),
              cerradoEn: cierre ? cierre.cerradoEn.toLocaleDateString('es-PE') : null,
              puedeCerrar: esRegionalSesion || sesion.alcancePaisId === p.id,
            }
          })
          .filter((f) => f.participantes > 0)
          // El RR.HH. de país solo ve la fila de su país; el Regional, todas
          .filter((f) => esRegionalSesion || f.paisId === sesion.alcancePaisId)
      })()
    : []
  const notaPorColaborador = new Map(resultados.map((r) => [r.colaboradorId, r.notaCalibrada ?? r.notaFinal!]))
  const feedbackPorColaborador = new Map(feedbacksCiclo.map((f) => [f.colaboradorId, f]))
  const requierenSesion = colaboradoresAlcance.filter((c) => notaPorColaborador.has(c.id)).length
  const sesionesRegistradas = colaboradoresAlcance.filter((c) => notaPorColaborador.has(c.id) && feedbackPorColaborador.has(c.id)).length

  const calibraciones = resultados.flatMap((r) =>
    r.calibraciones.map((c) => ({
      id: c.id,
      colaborador: `${r.colaborador.nombres} ${r.colaborador.apellidos}`,
      ambito: c.ambito, referencia: c.referencia,
      de: c.valorAnterior, a: c.valorNuevo, motivo: c.motivo,
      por: c.usuario.colaborador ? `${c.usuario.colaborador.nombres} ${c.usuario.colaborador.apellidos}` : c.usuario.id,
      fecha: c.createdAt,
    })),
  ).sort((a, b) => b.fecha.getTime() - a.fecha.getTime())

  // Datos del calibrador: objetivos aplicables (con logro) y combinación comp/obj por nivel
  const configCiclo = ciclo.estado !== 'BORRADOR' ? await configDelCiclo(ciclo.id) : null
  const objetivosPorColaborador = new Map<string, { id: string; titulo: string; tipo: string; peso: number; logro: number | null }[]>()
  for (const r of resultados) {
    // Ciclo sin período (periodoId null): no evalúa objetivos, sin consultar objetivosAplicables
    const { transversales, individuales } = ciclo.periodoId
      ? await objetivosAplicables(ciclo.periodoId, r.colaboradorId)
      : { transversales: [], individuales: [] }
    objetivosPorColaborador.set(r.colaboradorId, [...transversales, ...individuales]
      .filter((o) => o.estado === 'APROBADO')
      .map((o) => ({
        id: o.id,
        titulo: o.titulo,
        tipo: o.tipo === 'TRANSVERSAL' ? 'Transversal' : o.tipo === 'DESARROLLO' ? 'Desarrollo' : 'Individual',
        peso: o.peso,
        logro: o.logros[0]?.logroFinal ?? null,
      })))
  }

  // Monitoreo: avance por modalidad + pendientes por evaluador (con lo ya cargado)
  const ETIQUETA: Record<string, string> = { AUTO: 'Autoevaluación', JEFE: 'Jefe directo', PAR: 'Pares', ASCENDENTE: 'Ascendente' }
  const porModalidad = (['JEFE', 'AUTO', 'PAR', 'ASCENDENTE'] as const)
    .map((t) => {
      const del = asignaciones.filter((a) => a.tipo === t)
      return { tipo: t, total: del.length, enviadas: del.filter((a) => a.estado === 'ENVIADA').length }
    })
    .filter((x) => x.total > 0)
  // Pendientes por evaluador, agrupados por área → jefe directo, con el detalle de QUÉ
  // evaluación le falta a cada uno (auto, jefe, par o ascendente, y sobre quién)
  const SIN_AREA = '— Sin área'
  const pendientesEvaluador = new Map<string, { nombre: string; area: string; jefe: string; pendientes: { tipo: string; sobre: string }[] }>()
  for (const a of asignaciones.filter((x) => x.estado !== 'ENVIADA')) {
    const k = a.evaluador.id
    if (!pendientesEvaluador.has(k)) {
      pendientesEvaluador.set(k, {
        nombre: `${a.evaluador.nombres} ${a.evaluador.apellidos}`,
        area: a.evaluador.area?.nombre ?? SIN_AREA,
        jefe: a.evaluador.jefe ? `${a.evaluador.jefe.nombres} ${a.evaluador.jefe.apellidos}` : '— Sin jefe directo',
        pendientes: [],
      })
    }
    pendientesEvaluador.get(k)!.pendientes.push({
      tipo: ETIQUETA[a.tipo],
      sobre: a.tipo === 'AUTO' ? '' : `${a.evaluado.nombres} ${a.evaluado.apellidos}`,
    })
  }
  // área → jefe → evaluadores (áreas y jefes alfabéticos, "Sin…" al final)
  const alFinal = (s: string) => (s.startsWith('—') ? `zz${s}` : s)
  const areasPendientes = [...pendientesEvaluador.values()]
    .reduce((m, e) => {
      if (!m.has(e.area)) m.set(e.area, new Map<string, typeof e[]>())
      const porJefe = m.get(e.area)!
      if (!porJefe.has(e.jefe)) porJefe.set(e.jefe, [])
      porJefe.get(e.jefe)!.push(e)
      return m
    }, new Map<string, Map<string, { nombre: string; area: string; jefe: string; pendientes: { tipo: string; sobre: string }[] }[]>>())
  const listaAreasPendientes = [...areasPendientes.entries()]
    .sort((a, b) => alFinal(a[0]).localeCompare(alFinal(b[0])))
    .map(([area, porJefe]) => ({
      area,
      jefes: [...porJefe.entries()]
        .sort((a, b) => alFinal(a[0]).localeCompare(alFinal(b[0])))
        .map(([jefe, evaluadores]) => ({ jefe, evaluadores: evaluadores.sort((a, b) => b.pendientes.length - a.pendientes.length) })),
    }))
  const totalPendientesEval = [...pendientesEvaluador.values()].reduce((n, e) => n + e.pendientes.length, 0)

  // Cobertura de nominación de pares por equipo (el jefe nomina 2 por persona; RR.HH. es último recurso)
  // Solo cuentan los PARTICIPANTES del ciclo: excluidos por antigüedad, retirados por rotación
  // y reingresos posteriores al lanzamiento no reciben pares (contarlos marcaba huecos falsos)
  const participaIds = ciclo.estado !== 'BORRADOR'
    ? new Set((await prisma.asignacion.findMany({ where: { cicloId: id, tipo: 'AUTO' }, select: { evaluadoId: true } })).map((a) => a.evaluadoId))
    : new Set<string>()
  const participantesAlcance = colaboradoresAlcance.filter((c) => participaIds.has(c.id))
  const paresVigentes = paresTodos.filter((p) => p.estado !== 'INVALIDADA')
  const paresPorEvaluado = paresVigentes.reduce((m, p) => m.set(p.evaluadoId, (m.get(p.evaluadoId) ?? 0) + 1), new Map<string, number>())
  const equipos = new Map<string, { jefe: string; total: number; cubiertos: number }>()
  for (const c of participantesAlcance) {
    const clave = c.jefe ? c.jefe.id : '__sin_jefe__'
    const nombre = c.jefe ? `${c.jefe.nombres} ${c.jefe.apellidos}` : '— Sin jefe directo (los nomina RR.HH.)'
    if (!equipos.has(clave)) equipos.set(clave, { jefe: nombre, total: 0, cubiertos: 0 })
    const e = equipos.get(clave)!
    e.total += 1
    if ((paresPorEvaluado.get(c.id) ?? 0) >= 2) e.cubiertos += 1
  }
  const listaEquipos = [...equipos.values()].sort((a, b) => (a.cubiertos / a.total) - (b.cubiertos / b.total))
  const totalCubiertos = participantesAlcance.filter((c) => (paresPorEvaluado.get(c.id) ?? 0) >= 2).length
  const sinNingunPar = participantesAlcance.filter((c) => (paresPorEvaluado.get(c.id) ?? 0) === 0).length
  // Equipos con TODOS sus miembros con 2 pares: es el dato del resumen plegado
  const equiposAlDia = [...equipos.values()].filter((e) => e.cubiertos === e.total).length

  const tabMonitoreo = (
    <div className="space-y-5 rounded-2xl border border-gris-claro bg-white p-5">
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gris">Avance por modalidad</p>
        <ul className="space-y-2.5">
          {porModalidad.map((m) => {
            const pct = m.total === 0 ? 0 : Math.round((m.enviadas / m.total) * 100)
            return (
              <li key={m.tipo}>
                <div className="mb-1 flex items-baseline justify-between text-xs">
                  <span className="font-semibold">{ETIQUETA[m.tipo]}</span>
                  <span className="text-gris">{m.enviadas} de {m.total} enviadas · {pct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-hueso-2">
                  <div className="h-full rounded-full bg-hunter/70" style={{ width: `${pct}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
      </div>
      {ciclo.estado === 'ACTIVO' && participantesAlcance.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gris">Nominación de pares por equipo</p>
          <p className="mb-3 text-xs text-gris">Cada jefe nomina 2 pares por miembro de su equipo desde <b>Evaluar a mi equipo</b>. Aquí verificas que lo hayan hecho; interviene desde la pestaña Pares solo como último recurso.</p>
          {/* Las tres cifras lado a lado también en el teléfono: una por fila empujaba el
              detalle por equipo fuera de pantalla */}
          <div className="mb-3 grid grid-cols-3 gap-2 sm:gap-3">
            <div className="rounded-xl bg-hueso px-3 py-2.5 sm:px-4 sm:py-3">
              <p className={`font-display text-lg font-bold sm:text-xl ${totalCubiertos === participantesAlcance.length ? 'text-emerald-700' : ''}`}>{Math.round((totalCubiertos / participantesAlcance.length) * 100)}%</p>
              <p className="text-[10.5px] leading-tight text-gris sm:text-[11px]">con sus 2 pares nominados</p>
            </div>
            <div className="rounded-xl bg-hueso px-3 py-2.5 sm:px-4 sm:py-3">
              <p className={`font-display text-lg font-bold sm:text-xl ${sinNingunPar > 0 ? 'text-hunter' : 'text-emerald-700'}`}>{sinNingunPar}</p>
              <p className="text-[10.5px] leading-tight text-gris sm:text-[11px]">sin ningún par asignado</p>
            </div>
            <div className="rounded-xl bg-hueso px-3 py-2.5 sm:px-4 sm:py-3">
              <p className="font-display text-lg font-bold sm:text-xl">{listaEquipos.length}</p>
              <p className="text-[10.5px] leading-tight text-gris sm:text-[11px]">equipos / jefes</p>
            </div>
          </div>

          {/* El detalle por equipo, plegado (en móvil y en escritorio): la cifra que interesa
              es cuántos equipos están al día, y esa vive en el resumen */}
          <details className="group/eq rounded-xl border border-gris-claro">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 transition hover:bg-hueso [&::-webkit-details-marker]:hidden">
              <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
                <span className="shrink-0 text-gris transition group-open/eq:rotate-90">›</span>
                <span className="truncate">Detalle por equipo</span>
                <span className="shrink-0 text-xs font-normal text-gris">· {listaEquipos.length} jefe{listaEquipos.length === 1 ? '' : 's'}</span>
              </span>
              {equiposAlDia === listaEquipos.length
                ? <Chip tono="ok">{equiposAlDia}/{listaEquipos.length} al día ✓</Chip>
                : <Chip tono="pendiente">{equiposAlDia}/{listaEquipos.length} al día</Chip>}
            </summary>
            <ul className="space-y-1.5 px-3 pb-3">
              {listaEquipos.map((e) => (
                <li key={e.jefe} className="flex items-center justify-between gap-3 rounded-xl bg-hueso px-3.5 py-2 text-[13px]">
                  {/* Nombres largos: en móvil el conteo baja de línea (al costado dejaba el
                      nombre en tres renglones); en escritorio, todo en una línea */}
                  <span className="min-w-0">
                    <span className="line-clamp-2 font-semibold">{e.jefe}</span>
                    <span className="block text-xs text-gris sm:hidden">{e.total} colaborador{e.total === 1 ? '' : 'es'}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="hidden text-xs text-gris sm:inline">{e.total} colaborador{e.total === 1 ? '' : 'es'}</span>
                    {e.cubiertos === e.total
                      ? <Chip tono="ok">{e.cubiertos}/{e.total} ✓</Chip>
                      : <Chip tono="pendiente">{e.cubiertos}/{e.total}</Chip>}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {listaAreasPendientes.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gris">Evaluaciones pendientes por evaluador · {totalPendientesEval}</p>
          <div className="space-y-2">
            {listaAreasPendientes.map((a) => {
              const nArea = a.jefes.reduce((n, j) => n + j.evaluadores.reduce((x, e) => x + e.pendientes.length, 0), 0)
              return (
                <details key={a.area} className="group rounded-xl border border-gris-claro">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 transition hover:bg-hueso [&::-webkit-details-marker]:hidden">
                    <span className="flex min-w-0 items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-gris">
                      <span className="shrink-0 transition group-open:rotate-90">›</span>
                      <span className="truncate">{a.area}</span>
                    </span>
                    <Chip tono="pendiente">{nArea} pendiente{nArea === 1 ? '' : 's'}</Chip>
                  </summary>
                  <div className="space-y-2 px-4 pb-3">
                    {a.jefes.map((j) => (
                      <div key={j.jefe}>
                        <p className="mb-1.5 truncate text-[11px] font-semibold text-gris">Equipo de {j.jefe}</p>
                        <ul className="space-y-1.5">
                          {j.evaluadores.map((e) => (
                            <li key={e.nombre}>
                              <details className="group/eval rounded-xl bg-hueso">
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3.5 py-2 text-[13px] transition hover:bg-hueso-2 [&::-webkit-details-marker]:hidden">
                                  <span className="flex min-w-0 items-center gap-2 font-semibold">
                                    <span className="shrink-0 text-[11px] text-gris transition group-open/eval:rotate-90">›</span>
                                    <span className="line-clamp-2">{e.nombre}</span>
                                  </span>
                                  <Chip tono="pendiente">{e.pendientes.length} pendiente{e.pendientes.length === 1 ? '' : 's'}</Chip>
                                </summary>
                                <ul className="list-disc space-y-1 pb-2.5 pl-9 pr-4 pt-0.5 marker:text-gris">
                                  {e.pendientes.map((p, i) => (
                                    <li key={i} className="text-xs text-gris">
                                      <b className="text-negro">{p.tipo}</b>
                                      {p.sobre && <> sobre <b className="text-negro">{p.sobre}</b></>}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </details>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )

  // Tabla de pares para RR.HH.: colaboradores agrupados por jefe directo, con sus 2 slots
  const paresPorEvaluadoId = paresVigentes.reduce((m, p) => {
    const lista = m.get(p.evaluadoId) ?? []
    lista.push({ asignacionId: p.id, evaluadorId: p.evaluadorId, nombre: `${p.evaluador.nombres} ${p.evaluador.apellidos}`, estado: p.estado })
    return m.set(p.evaluadoId, lista)
  }, new Map<string, { asignacionId: string; evaluadorId: string; nombre: string; estado: string }[]>())
  // Grupos por (área del colaborador, jefe directo): las pestañas Pares y Feedback muestran
  // áreas como primer nivel y equipos (jefe) como segundo
  const gruposPares = new Map<string, { area: string; jefeId: string | null; jefe: string; miembros: { id: string; nombre: string; puesto: string; jefeId: string | null; pares: { asignacionId: string; evaluadorId: string; nombre: string; estado: string }[] }[] }>()
  for (const c of participantesAlcance) {
    const area = c.area?.nombre ?? SIN_AREA
    const clave = `${area}|${c.jefe?.id ?? '__sin_jefe__'}`
    if (!gruposPares.has(clave)) gruposPares.set(clave, { area, jefeId: c.jefe?.id ?? null, jefe: c.jefe ? `${c.jefe.nombres} ${c.jefe.apellidos}` : '', miembros: [] })
    gruposPares.get(clave)!.miembros.push({
      id: c.id,
      nombre: `${c.nombres} ${c.apellidos}`,
      puesto: c.puesto?.nombre ?? 'Sin puesto',
      jefeId: c.jefe?.id ?? null,
      pares: paresPorEvaluadoId.get(c.id) ?? [],
    })
  }
  // Equipos con huecos primero; "Sin jefe directo" al final
  const listaGruposPares = [...gruposPares.values()].sort((a, b) => {
    if (a.jefeId === null !== (b.jefeId === null)) return a.jefeId === null ? 1 : -1
    const pctA = a.miembros.filter((m) => m.pares.length >= 2).length / a.miembros.length
    const pctB = b.miembros.filter((m) => m.pares.length >= 2).length / b.miembros.length
    return pctA - pctB || a.jefe.localeCompare(b.jefe)
  })
  // Primer nivel: áreas (alfabético, "Sin área" al final); dentro, los equipos ya ordenados
  const areasGrupos = [...listaGruposPares
    .reduce((m, g) => m.set(g.area, [...(m.get(g.area) ?? []), g]), new Map<string, typeof listaGruposPares>())
    .entries()]
    .sort((a, b) => alFinal(a[0]).localeCompare(alFinal(b[0])))
    .map(([area, grupos]) => ({ area, grupos }))

  const textoAvisoPares = (
    <>La nominación de pares la hacen los <b>jefes directos</b> desde <b>Evaluar a mi equipo</b> (2 por persona). Aquí validas que cada colaborador tenga sus 2 pares e intervienes solo como <b>último recurso</b>: asignar en huecos, retirar mal asignados y aprobar propuestas de pares de otro equipo. Los pares responden lo configurado para su modalidad, anónimo para la persona evaluada.</>
  )

  const tabPares = (
    <div className="rounded-2xl border border-gris-claro bg-white p-5">
      {ciclo.estado === 'ACTIVO' ? (
        <>
          {/* Móvil: plegado (el párrafo entero empujaba al primer colaborador fuera de pantalla) */}
          <details className="group/aviso mb-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 md:hidden">
            <summary className="flex cursor-pointer list-none items-center gap-2 font-bold [&::-webkit-details-marker]:hidden">
              <span className="transition group-open/aviso:rotate-90">›</span>
              Cómo funciona la nominación
            </summary>
            <p className="mt-2 leading-relaxed">{textoAvisoPares}</p>
          </details>
          <p className="mb-4 hidden rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 md:block">{textoAvisoPares}</p>
        </>
      ) : (
        <p className="mb-4 rounded-xl bg-hueso px-3.5 py-2.5 text-xs text-gris">
          Registro histórico de las nominaciones de pares de este ciclo. Solo RR.HH. puede ver quién evaluó a quién: para la persona evaluada los pares son anónimos.
        </p>
      )}
      <div className="space-y-3">
        {areasGrupos.map((a) => {
          const nMiembros = a.grupos.reduce((n, g) => n + g.miembros.length, 0)
          const nCubiertos = a.grupos.reduce((n, g) => n + g.miembros.filter((m) => m.pares.filter((p) => p.estado !== 'PROPUESTA').length >= 2).length, 0)
          return (
            <details key={a.area} open={areasGrupos.length === 1 ? true : undefined} className="group/area rounded-xl border-2 border-gris-claro">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl bg-hueso/60 px-4 py-3 transition hover:bg-hueso [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 items-center gap-2 font-display text-[13px] font-bold">
                  <span className="shrink-0 text-gris transition group-open/area:rotate-90">›</span>
                  <span className="min-w-0">
                    <span className="block truncate md:inline">{a.area}</span>
                    {/* Un solo equipo: el jefe vive aquí y en móvil el equipo ya no dibuja su caja */}
                    <span className="block truncate text-[11px] font-semibold text-gris md:inline md:ps-1.5">
                      {a.grupos.length === 1 && a.grupos[0].jefeId ? `${a.grupos[0].jefe} · ` : a.grupos.length === 1 ? 'Sin jefe directo · ' : ''}
                      {nMiembros} colaborador{nMiembros === 1 ? '' : 'es'}
                    </span>
                  </span>
                </span>
                {nCubiertos === nMiembros
                  ? <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">{nCubiertos}/{nMiembros} ✓</span>
                  : <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">{nCubiertos}/{nMiembros}</span>}
              </summary>
              {/* Cobertura del área de un barrido, sin abrirla (solo móvil: en escritorio la tabla ya se ve) */}
              <div className="mx-4 mb-2 h-[3px] overflow-hidden rounded-full bg-hueso-2 md:hidden">
                <i className={`block h-full rounded-full ${nCubiertos === nMiembros ? 'bg-emerald-600' : 'bg-amber-500'}`} style={{ width: `${nMiembros ? Math.round((nCubiertos / nMiembros) * 100) : 0}%` }} />
              </div>
              <div className="p-3 pt-0 md:pt-3">
                <TablaParesRrhh
                  cicloId={ciclo.id}
                  grupos={a.grupos}
                  soloLectura={!puedeGestionar || ciclo.estado !== 'ACTIVO'}
                />
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )

  // Seguimiento de sesiones de feedback: mismos grupos por jefe que la pestaña Pares.
  // El jefe registra en "Resultados del equipo"; aquí RR.HH. verifica cobertura antes del cierre.
  const textoAvisoFeedback = (
    <>Con los resultados a la vista, cada <b>jefe directo</b> conversa con su colaborador y registra los <b>acuerdos y el PDI</b> en <b>Resultados del equipo</b>. El ciclo <b>no puede cerrarse</b> hasta que todos los colaboradores con nota tengan su sesión registrada. RR.HH. puede registrarla como último recurso desde esa misma pantalla.</>
  )

  type MiembroFeedback = { id: string; nombre: string; puesto: string }

  /* Tarjeta móvil de Feedback: la NOTA en primer plano (es el dato que decide si la sesión
     corresponde) y el estado de la sesión debajo. Vista de solo lectura: la sesión se registra
     en «Resultados del equipo», así que la tarjeta no lleva acciones. */
  const tarjetaFeedback = (m: MiembroFeedback) => {
    const nota = notaPorColaborador.get(m.id)
    const f = feedbackPorColaborador.get(m.id)
    const nPdi = f && Array.isArray(f.pdi) ? f.pdi.length : 0
    const sinNota = nota === undefined
    return (
      <li key={m.id} className={`rounded-xl border px-3 py-3 ${sinNota ? 'border-dashed border-gris-claro bg-hueso' : f ? 'border-gris-claro bg-white' : 'border-amber-300 bg-amber-50/40'}`}>
        <div className="flex items-start gap-2.5">
          <Avatar nombre={m.nombre} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-bold leading-tight">{m.nombre}</p>
            <p className="text-xs text-gris">{m.puesto}</p>
          </div>
          <p className="shrink-0 text-right leading-none">
            <span className={`font-display text-xl font-extrabold ${sinNota ? 'text-gris' : 'text-hunter'}`}>{sinNota ? '—' : nota.toFixed(1)}</span>
            <span className="mt-1 block text-[9.5px] font-bold uppercase tracking-wide text-gris">{sinNota ? 'sin nota' : 'nota'}</span>
          </p>
        </div>
        {!sinNota && (
          <div className="mt-2.5 border-t border-hueso-2 pt-2.5">
            {f ? (
              <>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-gris">
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Registrada ✓</span>
                  <span>{f.realizadaEn.toLocaleDateString('es-PE')}{nPdi > 0 ? ` · ${nPdi} acci${nPdi === 1 ? 'ón' : 'ones'} de PDI` : ''}</span>
                </p>
                {/* Los acuerdos, legibles: en el teléfono no hay hover, así que el title del
                    escritorio no sirve de nada. Dos líneas y a la vista. */}
                {f.acuerdos && <p className="mt-1.5 line-clamp-2 rounded-lg bg-hueso px-2.5 py-1.5 text-xs">“{f.acuerdos}”</p>}
              </>
            ) : (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">⚠ Sesión pendiente</span>
            )}
          </div>
        )}
      </li>
    )
  }

  /* Lista móvil de un equipo: las sesiones PENDIENTES primero (esta pestaña existe para
     perseguirlas antes del cierre), luego las registradas; los que aún no tienen nota no son
     trabajo pendiente y se pliegan al final. El escritorio mantiene su orden alfabético. */
  const listaFeedbackMovil = (g: { miembros: MiembroFeedback[] }, conBorde: boolean) => {
    const conNota = g.miembros.filter((m) => notaPorColaborador.has(m.id))
    const pendientesEq = conNota.filter((m) => !feedbackPorColaborador.has(m.id))
    const registradasEq = conNota.filter((m) => feedbackPorColaborador.has(m.id))
    const sinNota = g.miembros.filter((m) => !notaPorColaborador.has(m.id))
    return (
      <div className={conBorde ? 'px-3 pb-3' : ''}>
        {conNota.length > 0 && (
          <ul className="space-y-2.5">
            {[...pendientesEq, ...registradasEq].map((m) => tarjetaFeedback(m))}
          </ul>
        )}
        {sinNota.length > 0 && (
          <details className={`group/sn ${conNota.length > 0 ? 'mt-2.5' : ''}`}>
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-dashed border-gris-claro bg-hueso px-3 py-2.5 text-[11.5px] font-bold text-gris [&::-webkit-details-marker]:hidden">
              <span className="transition group-open/sn:rotate-90">›</span>
              {sinNota.length} sin nota aún — no requiere{sinNota.length === 1 ? '' : 'n'} sesión todavía
            </summary>
            <ul className="mt-2.5 space-y-2.5">{sinNota.map((m) => tarjetaFeedback(m))}</ul>
          </details>
        )}
      </div>
    )
  }

  const tabFeedback = (
    <div className="rounded-2xl border border-gris-claro bg-white p-5">
      {/* Móvil: plegado; escritorio: el párrafo completo de siempre */}
      <details className="group/avisof mb-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 md:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-bold [&::-webkit-details-marker]:hidden">
          <span className="transition group-open/avisof:rotate-90">›</span>
          Cómo se registra la sesión
        </summary>
        <p className="mt-2 leading-relaxed">{textoAvisoFeedback}</p>
      </details>
      <p className="mb-4 hidden rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 md:block">{textoAvisoFeedback}</p>
      <div className="space-y-3">
        {areasGrupos.map((a) => {
          const reqArea = a.grupos.reduce((n, g) => n + g.miembros.filter((m) => notaPorColaborador.has(m.id)).length, 0)
          const regArea = a.grupos.reduce((n, g) => n + g.miembros.filter((m) => notaPorColaborador.has(m.id) && feedbackPorColaborador.has(m.id)).length, 0)
          const nMiembrosArea = a.grupos.reduce((n, g) => n + g.miembros.length, 0)
          return (
            <details key={a.area} open={areasGrupos.length === 1 ? true : undefined} className="group/area rounded-xl border-2 border-gris-claro">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl bg-hueso/60 px-4 py-3 transition hover:bg-hueso [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 items-center gap-2 font-display text-[13px] font-bold">
                  <span className="shrink-0 text-gris transition group-open/area:rotate-90">›</span>
                  <span className="min-w-0">
                    <span className="block truncate md:inline">{a.area}</span>
                    {/* Con un solo equipo el jefe vive aquí (en móvil el equipo no dibuja su caja) */}
                    <span className="block truncate text-[11px] font-semibold text-gris md:inline md:ps-1.5">
                      {a.grupos.length === 1 && a.grupos[0].jefeId ? `${a.grupos[0].jefe} · ` : a.grupos.length === 1 ? 'Sin jefe directo · ' : ''}
                      {nMiembrosArea} colaborador{nMiembrosArea === 1 ? '' : 'es'}
                    </span>
                  </span>
                </span>
                {reqArea === 0
                  ? <span className="shrink-0 rounded-full bg-hueso-2 px-2.5 py-0.5 text-[11px] font-bold text-gris">sin notas aún</span>
                  : regArea === reqArea
                    ? <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">{regArea}/{reqArea} ✓</span>
                    : <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">{regArea}/{reqArea}</span>}
              </summary>
              {/* Cobertura del área de un barrido (solo móvil) */}
              {reqArea > 0 && (
                <div className="mx-4 mb-2 h-[3px] overflow-hidden rounded-full bg-hueso-2 md:hidden">
                  <i className={`block h-full rounded-full ${regArea === reqArea ? 'bg-emerald-600' : 'bg-amber-500'}`} style={{ width: `${Math.round((regArea / reqArea) * 100)}%` }} />
                </div>
              )}

              {/* ── Móvil: tarjetas ── */}
              <div className="space-y-2 p-3 pt-0 md:hidden">
                {a.grupos.length === 1
                  ? listaFeedbackMovil(a.grupos[0], false)
                  : a.grupos.map((g) => {
                      const requeridos = g.miembros.filter((m) => notaPorColaborador.has(m.id))
                      const registrados = requeridos.filter((m) => feedbackPorColaborador.has(m.id))
                      return (
                        <details key={g.jefeId ?? '__sin_jefe__'} className="group rounded-xl border border-gris-claro">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                            <span className="flex min-w-0 items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-gris">
                              <span className="shrink-0 transition group-open:rotate-90">›</span>
                              <span className="truncate">{g.jefeId ? `Equipo de ${g.jefe}` : 'Sin jefe directo (sesión con RR.HH.)'}</span>
                            </span>
                            {requeridos.length === 0
                              ? <span className="shrink-0 rounded-full bg-hueso-2 px-2.5 py-0.5 text-[11px] font-bold text-gris">sin notas aún</span>
                              : registrados.length === requeridos.length
                                ? <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">{registrados.length}/{requeridos.length} ✓</span>
                                : <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">{registrados.length}/{requeridos.length}</span>}
                          </summary>
                          {listaFeedbackMovil(g, true)}
                        </details>
                      )
                    })}
              </div>

              {/* ── Escritorio: la tabla de siempre, intacta ── */}
              <div className="hidden space-y-2 p-3 md:block">
        {a.grupos.map((g) => {
          const requeridos = g.miembros.filter((m) => notaPorColaborador.has(m.id))
          const registrados = requeridos.filter((m) => feedbackPorColaborador.has(m.id))
          return (
            <details key={g.jefeId ?? '__sin_jefe__'} open={a.grupos.length === 1 ? true : undefined} className="group rounded-xl border border-gris-claro">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 transition hover:bg-hueso [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-gris">
                  <span className="transition group-open:rotate-90">›</span>
                  {g.jefeId ? `Equipo de ${g.jefe}` : 'Sin jefe directo (sesión con RR.HH.)'}
                  <span className="font-semibold normal-case tracking-normal text-gris/70">· {g.miembros.length} colaborador{g.miembros.length === 1 ? '' : 'es'}</span>
                </span>
                {requeridos.length === 0
                  ? <span className="rounded-full bg-hueso-2 px-2.5 py-0.5 text-[11px] font-bold text-gris">sin notas aún</span>
                  : registrados.length === requeridos.length
                    ? <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">{registrados.length}/{requeridos.length} ✓</span>
                    : <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">{registrados.length}/{requeridos.length}</span>}
              </summary>
              <div className="overflow-x-auto px-4 pb-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gris-claro text-left text-[11px] font-bold uppercase tracking-wide text-gris">
                      <th className="py-2 pr-3">Colaborador</th>
                      <th className="py-2 pr-3">Nota</th>
                      <th className="py-2 pr-3">Sesión de feedback</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.miembros.map((m) => {
                      const nota = notaPorColaborador.get(m.id)
                      const f = feedbackPorColaborador.get(m.id)
                      const nPdi = f && Array.isArray(f.pdi) ? f.pdi.length : 0
                      return (
                        <tr key={m.id} className="border-b border-hueso-2 align-middle">
                          <td className="py-2.5 pr-3">
                            <p className="font-bold">{m.nombre}</p>
                            <p className="text-xs text-gris">{m.puesto}</p>
                          </td>
                          <td className="py-2.5 pr-3">{nota !== undefined ? <Nota valor={nota} /> : <span className="text-xs text-gris">—</span>}</td>
                          <td className="py-2.5 pr-3">
                            {nota === undefined ? (
                              <span className="text-xs text-gris">Aún sin nota: no requiere sesión todavía</span>
                            ) : f ? (
                              <div className="text-[13px]">
                                <p><span className="font-bold text-emerald-700">Registrada ✓</span> <span className="text-xs text-gris">· {f.realizadaEn.toLocaleDateString('es-PE')}{nPdi > 0 ? ` · ${nPdi} acci${nPdi === 1 ? 'ón' : 'ones'} de PDI` : ''}</span></p>
                                {f.acuerdos && <p className="mt-0.5 max-w-xl truncate text-xs text-gris" title={f.acuerdos}>“{f.acuerdos}”</p>}
                              </div>
                            ) : (
                              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">⚠ Sesión pendiente</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )
        })}
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )

  // Calibración agrupada por área → equipo (mismo patrón que Pares/Feedback) con buscador
  const gruposCalibracion = new Map<string, { area: string; jefeId: string | null; jefe: string; miembros: MiembroCalibracion[] }>()
  for (const r of resultados) {
    const areaCal = r.colaborador.area?.nombre ?? SIN_AREA
    const clave = `${areaCal}|${r.colaborador.jefe?.id ?? '__sin_jefe__'}`
    if (!gruposCalibracion.has(clave)) {
      gruposCalibracion.set(clave, { area: areaCal, jefeId: r.colaborador.jefe?.id ?? null, jefe: r.colaborador.jefe ? `${r.colaborador.jefe.nombres} ${r.colaborador.jefe.apellidos}` : '', miembros: [] })
    }
    gruposCalibracion.get(clave)!.miembros.push({
      resultadoId: r.id,
      nombre: `${r.colaborador.nombres} ${r.colaborador.apellidos}`,
      puesto: r.colaborador.puesto?.nombre ?? 'Sin puesto',
      notaVigente: r.notaCalibrada ?? r.notaFinal!,
      notaOriginal: r.notaCalibrada !== null ? r.notaFinal : null,
      fueCalibrado: r.calibraciones.length > 0,
      dims: (r.desgloseDimJson as DimensionResultado[] | null) ?? [],
      objetivos: objetivosPorColaborador.get(r.colaboradorId) ?? [],
      // Ciclo sin período: 100% competencias (no la combinación del nivel, que no aplica sin objetivos)
      combinacion: ciclo.periodoId === null
        ? { comp: 100, obj: 0 }
        : (r.colaborador.puesto && configCiclo?.combinacionPorNivel[r.colaborador.puesto.nivelId]) || { comp: 50, obj: 50 },
      conformidad: r.conformidad,
      conformidadFecha: r.conformidadEn ? r.conformidadEn.toLocaleDateString('es-PE') : null,
      observacion: r.observacion,
      notaAceptada: r.notaAceptada,
    })
  }
  const notasObservadas = resultados.filter((r) => r.conformidad === 'OBSERVADO')
  const notasConformes = resultados.filter((r) => r.conformidad === 'CONFORME').length
  const listaGruposCalibracion = [...gruposCalibracion.values()].sort((a, b) => {
    const porArea = alFinal(a.area).localeCompare(alFinal(b.area))
    if (porArea !== 0) return porArea
    if (a.jefeId === null !== (b.jefeId === null)) return a.jefeId === null ? 1 : -1
    return a.jefe.localeCompare(b.jefe)
  })

  const tabCalibracion = (
    <div className="rounded-2xl border border-gris-claro bg-white p-5">
      <p className="mb-3 text-xs text-gris">
        Ajustes auditados sobre la nota final: todo cambio queda registrado de forma inmutable.
        {resultados.length > 0 && (notasConformes > 0 || notasObservadas.length > 0) && (
          <> Conformidad de colaboradores: <b className="text-emerald-700">{notasConformes} conforme{notasConformes === 1 ? '' : 's'}</b> · <b className="text-amber-800">{notasObservadas.length} observada{notasObservadas.length === 1 ? '' : 's'}</b> · {resultados.length - notasConformes - notasObservadas.length} sin respuesta.</>
        )}
      </p>
      {/* Observaciones de colaboradores: insumo directo del proceso de calibración */}
      {notasObservadas.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-amber-900">
            ⚠ Notas observadas por colaboradores · {notasObservadas.length}
          </p>
          <ul className="space-y-2">
            {notasObservadas.map((r) => (
              <li key={r.id} className="rounded-lg bg-white px-3.5 py-2.5 text-sm">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <b>{r.colaborador.nombres} {r.colaborador.apellidos}</b>
                  <span className="text-xs text-gris">observó la nota {(r.notaAceptada ?? r.notaCalibrada ?? r.notaFinal)?.toFixed(2)}{r.conformidadEn ? ` el ${r.conformidadEn.toLocaleDateString('es-PE')}` : ''}{r.notaAceptada !== null && (r.notaCalibrada ?? r.notaFinal) !== r.notaAceptada ? ` · vigente ${(r.notaCalibrada ?? r.notaFinal)?.toFixed(2)}` : ''}</span>
                </p>
                {r.observacion && <p className="mt-1 whitespace-pre-wrap text-[13px] text-negro/80">“{r.observacion}”</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {resultados.length === 0 ? (
        <Vacio>Aún no hay resultados: se calculan solos conforme se envían las evaluaciones del ciclo.</Vacio>
      ) : (
        <ListaCalibracion grupos={listaGruposCalibracion} puedeGestionar={puedeTocarNotas} />
      )}
      {calibraciones.length > 0 && (
        <div className="mt-4 border-t border-gris-claro pt-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gris">Registro de auditoría (inmutable)</p>
          <ul className="space-y-1.5 text-xs">
            {calibraciones.map((c) => {
              const esObjetivo = c.ambito === 'OBJETIVO'
              const etiqueta = c.ambito === 'DIMENSION' ? `dimensión ${c.referencia}` : esObjetivo ? `objetivo “${c.referencia}”` : 'nota final'
              const valor = (v: number) => esObjetivo ? `${Math.round(v)}%` : v.toFixed(2)
              return (
                <li key={c.id} className="rounded-lg bg-hueso px-3 py-2">
                  <b>{c.colaborador}</b> · {etiqueta}: {valor(c.de)} → <b className="text-hunter">{valor(c.a)}</b> · “{c.motivo}” —{' '}
                  <span className="text-gris">{c.por}, {c.fecha.toLocaleString('es-PE')}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )

  return (
    <>
      <Link href="/admin/ciclos" className="mb-3 inline-block text-sm text-gris hover:text-negro">← Volver a Ciclos</Link>
      <Titulo
        sub={`${alcanceTexto} · ${ciclo.fechaInicio.toLocaleDateString('es-PE')} – ${ciclo.fechaFin.toLocaleDateString('es-PE')} · ${ciclo._count.preguntas} preguntas configuradas (sumando niveles y modalidades)`}
        accion={ciclo.estado === 'BORRADOR'
          ? (puedeGestionar
              ? (
                  <Link
                    href={`/admin/ciclos/${ciclo.id}/editar`}
                    className="rounded-xl border border-gris-claro bg-white px-4 py-2.5 text-[13px] font-bold transition hover:border-hunter hover:text-hunter"
                  >
                    ✎ Editar ciclo
                  </Link>
                )
              : undefined)
          : ciclo.estado === 'CERRADO' || cierresPais.some((c) => !scopeSesion.paisId || c.paisId === scopeSesion.paisId)
            ? <ExportarResultadosBtn cicloId={ciclo.id} />
            : undefined}
      >
        {ciclo.nombre}
      </Titulo>

      {/* Móvil: 2×2 (una por fila dejaba el encabezado larguísimo antes del primer tab) */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <Stat label="Estado" valor={ciclo.estado === 'BORRADOR' ? 'Borrador' : ciclo.estado === 'ACTIVO' ? 'Activo' : 'Cerrado'} sub={ciclo.publicado ? 'resultados publicados' : undefined} />
        <Stat label="Evaluaciones" valor={asignaciones.length} sub={`${enviadas} enviadas · ${pendientes} pendientes`} />
        <Stat label="Avance" valor={`${avance}%`} sub="del ciclo" />
        <Stat label="Pares asignados" valor={pares.length} />
      </div>

      {ciclo.estado === 'BORRADOR' && !puedeLanzar ? (
        <Card titulo="Lanzamiento">
          <p className="text-sm text-gris">
            Este ciclo no es de tu país: su verificación y su lanzamiento los gestiona RR.HH. Regional.
            Cuando esté activo verás aquí el monitoreo de tu alcance.
          </p>
        </Card>
      ) : ciclo.estado === 'BORRADOR' && preflight ? (
        puedeGestionar ? (
          <Card
            titulo="Lanzamiento"
            extra={nivelesSelector && (
              <EditarEvaluacionesCiclo
                cicloId={ciclo.id}
                niveles={nivelesSelector}
                porNivelInicial={porNivelInicial}
                porPuestoInicial={porPuestoInicial}
              />
            )}
          >
            <PreflightLanzamiento cicloId={ciclo.id} cicloNombre={ciclo.nombre} preflight={preflight} />
          </Card>
        ) : (
          <Card titulo="Lanzamiento">
            <p className="text-sm text-gris">Este ciclo está en borrador. Necesitas permiso de gestión de Ciclos para editarlo o lanzarlo.</p>
          </Card>
        )
      ) : (
        <>
        {!puedeGestionar && <AvisoSoloLectura />}
        <Tabs
          rejillaMovil
          tabs={[
            { id: 'monitoreo', label: 'Monitoreo del ciclo', icono: 'monitoreo', contenido: tabMonitoreo },
            ...(ciclo.estado === 'ACTIVO' && incidentes.length + rotacionBajas.filter((b) => !b.resuelta).length + invalidadas.length > 0
              ? [{
                  id: 'incidentes',
                  label: `⚠ Incidentes (${incidentes.length + rotacionBajas.filter((b) => !b.resuelta).length + invalidadas.length})`,
                  icono: 'monitoreo',
                  contenido: (
                    <TabIncidentes
                      cicloId={ciclo.id}
                      bajas={rotacionBajas}
                      incidentes={incidentes}
                      invalidadas={invalidadas}
                      puedeGestionar={puedeGestionar}
                    />
                  ),
                }]
              : []),
            { id: 'pares', label: `Pares (${pares.length})${ciclo.estado === 'ACTIVO' && propuestasPares.length > 0 ? ` · ${propuestasPares.length} por aprobar` : ''}`, icono: 'equipo', contenido: tabPares },
            { id: 'feedback', label: `Feedback (${sesionesRegistradas}/${requierenSesion})`, icono: 'feedback', contenido: tabFeedback },
            {
              id: 'conformidad',
              label: `Conformidad (${conformidad ? conformidad.requeridos - conformidad.faltantes.length : 0}/${conformidad?.requeridos ?? 0})`,
              icono: 'feedback',
              contenido: (
                <TablaConformidad
                  filas={conformidad?.detalle ?? []}
                  esRegional={esRegionalSesion}
                  cicloActivo={ciclo.estado === 'ACTIVO'}
                  puedeGestionar={puedeGestionar}
                />
              ),
            },
            { id: 'calibracion', label: 'Calibración', icono: 'ponderaciones', contenido: tabCalibracion },
            // Cumplimiento por país (ciclos regionales, solo Regional): avance y cierre país por país
            ...(esRegionalSesion && filasAvancePais.length > 0
              ? [{
                  id: 'paises',
                  label: `Avance por país (${filasAvancePais.filter((f) => f.cerrado).length}/${filasAvancePais.length} cerrados)`,
                  icono: 'monitoreo',
                  contenido: (
                    <div className="rounded-2xl border border-gris-claro bg-white p-5">
                      <p className="mb-3 text-xs text-gris">
                        Cumplimiento del ciclo por país. Cada país puede <b>cerrarse y publicarse de forma independiente</b> (el RR.HH. de país
                        también puede cerrar el suyo); al cerrar el último país pendiente, el ciclo pasa a Cerrado automáticamente.
                      </p>
                      <PanelAvancePais cicloId={ciclo.id} cicloEstado={ciclo.estado} filas={filasAvancePais} puedeGestionar={puedeGestionar} />
                    </div>
                  ),
                }]
              : []),
            {
              id: 'cierre', label: 'Cierre y publicación', icono: 'cierre',
              contenido: (
                <div className="space-y-5">
                  {ciclo.estado === 'ACTIVO' && (
                    <CardRecordatorios proceso="EVALUACIONES" referencia={ciclo.id} deadline={ciclo.fechaFin}>
                      {ciclo.estado === 'ACTIVO' && puedeGestionar && <BotonRecordatorioManual cicloId={ciclo.id} />}
                    </CardRecordatorios>
                  )}
                  <div className="rounded-2xl border border-gris-claro bg-white p-5">
                  {!esRegionalSesion && filasAvancePais.length > 0 ? (
                    // RR.HH. de país en ciclo regional: cierra SU país (el cierre global es del Regional)
                    <>
                      <p className="mb-3 text-xs text-gris">
                        Este ciclo es regional: como RR.HH. de país, cierras y publicas <b>tu país</b> cuando su proceso termina.
                        El cierre global del ciclo lo realiza RR.HH. Regional (o sucede solo al cerrar el último país).
                      </p>
                      <PanelAvancePais cicloId={ciclo.id} cicloEstado={ciclo.estado} filas={filasAvancePais} puedeGestionar={puedeGestionar} />
                    </>
                  ) : (
                    <PanelCierre
                      cicloId={ciclo.id}
                      pendientes={pendientes}
                      estado={ciclo.estado}
                      publicado={ciclo.publicado}
                      feedbackRequeridos={feedback?.requeridos ?? 0}
                      feedbackFaltantes={feedback?.faltantes ?? []}
                      puedeGestionar={puedeTocarNotas}
                    />
                  )}
                  </div>
                </div>
              ),
            },
          ]}
        />
        </>
      )}
    </>
  )
}
