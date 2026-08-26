import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin, alcancePaisWhere, periodoFueraDeAlcance } from '@/shared/lib/permisos'
import { tieneAdmin } from '@/shared/lib/permisos-admin'
import { AvisoSoloLectura, Card, Chip, Stat, Titulo } from '@/shared/ui/componentes'
import { coberturaPeriodo } from '@/features/objetivos/acciones-periodo'
import { focoDe } from '@/features/objetivos/alcance-periodo'
import { resumenAlcance } from '@/features/ciclos/alcance'
import { AccionesPeriodo, BotonEnviarRecordatoriosPeriodo, ExtensionIndividual, AvanceAreas, BannerAprobacionesRrhh, ExportarObjetivosBtn, EditarAlcancePeriodo, type GrupoArea } from '@/features/objetivos/PanelPeriodos'
import { chipPeriodo } from '@/features/objetivos/periodo-ui'
import { diasRestantes, ventanaVencida } from '@/features/objetivos/periodo'
import { CardRecordatorios } from '@/features/recordatorios/CardRecordatorios'

export default async function PeriodoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await requiereAdmin('OBJETIVOS', 'VER')
  const { id } = await params
  const periodo = await prisma.periodoObjetivos.findUnique({
    where: { id },
    include: { _count: { select: { objetivos: true, ciclos: true } } },
  })
  if (!periodo) notFound()
  /* La LECTURA se conserva (su cobertura ya va acotada por país y sus colaboradores pueden
     participar en un período regional), pero las acciones no se ofrecen si el período no es de su
     país: abrirlo notifica a toda su plantilla y extender el plazo reabre un período cerrado. Las
     server actions lo revalidan; esto evita ofrecer un botón que va a fallar. */
  const puedeGestionarObjetivos = tieneAdmin(sesion.permisosAdmin, 'OBJETIVOS', 'GESTIONAR')
    && !periodoFueraDeAlcance(sesion, periodo)

  const [catalogoPaises, catalogoAreas, catalogoNiveles] = await Promise.all([
    prisma.pais.findMany({ select: { id: true, nombre: true } }),
    prisma.area.findMany({ select: { id: true, nombre: true } }),
    prisma.nivelJerarquico.findMany({ select: { id: true, nombre: true } }),
  ])

  // El alcance solo se edita en borrador: catálogo de colaboradores solo si hace falta
  const puedeEditarAlcance = puedeGestionarObjetivos && periodo.estado === 'BORRADOR'
  const colaboradoresAlcance = puedeEditarAlcance
    ? await prisma.colaborador.findMany({
        // El país es el TECHO del alcance: se recorta en la consulta, no solo en el Combobox del
        // cliente (el padrón entero viajaría en el payload y se lee en DevTools)
        where: { activo: true, ...alcancePaisWhere(sesion) },
        select: { id: true, nombres: true, apellidos: true, paisId: true, pais: { select: { nombre: true } }, area: { select: { nombre: true } } },
        orderBy: [{ apellidos: 'asc' }],
      })
    : []
  const paisFijo = sesion.alcanceRrhh === 'PAIS' && sesion.alcancePaisId
    ? { id: sesion.alcancePaisId, nombre: catalogoPaises.find((p) => p.id === sesion.alcancePaisId)?.nombre ?? '' }
    : undefined

  const resumen = resumenAlcance(
    focoDe(periodo),
    {
      paises: new Map(catalogoPaises.map((p) => [p.id, p.nombre])),
      areas: new Map(catalogoAreas.map((a) => [a.id, a.nombre])),
      niveles: new Map(catalogoNiveles.map((n) => [n.id, n.nombre])),
    },
    { incluidos: periodo.incluirIds.length, excluidos: periodo.excluirIds.length },
  )

  const cobertura = await coberturaPeriodo(id)
  const avancePromedio = cobertura.porColaborador.length > 0
    ? Math.round(cobertura.porColaborador.reduce((a, c) => a + c.total, 0) / cobertura.porColaborador.length)
    : 0
  const dias = diasRestantes(periodo.fechaLimiteCarga)
  const vencido = ventanaVencida(periodo.fechaLimiteCarga)
  const chip = chipPeriodo(periodo.estado, vencido)

  // Objetivos individuales del período por colaborador (para verlos y gestionarlos desde aquí)
  const objetivosPeriodo = await prisma.objetivo.findMany({
    where: { periodoId: id, tipo: { in: ['INDIVIDUAL', 'DESARROLLO'] } },
    orderBy: { createdAt: 'asc' },
  })
  const objetivosDe = new Map<string, typeof objetivosPeriodo>()
  for (const o of objetivosPeriodo) {
    if (!o.colaboradorId) continue
    objetivosDe.set(o.colaboradorId, [...(objetivosDe.get(o.colaboradorId) ?? []), o])
  }

  // ¿El período sigue corregible por RR.HH.? Cerrado solo si ningún ciclo lanzado lo evalúa.
  const ciclosLanzados = await prisma.ciclo.count({ where: { periodoId: id, estado: { not: 'BORRADOR' } } })
  const periodoCorregible = periodo.estado === 'CARGA_ABIERTA' || (periodo.estado === 'CERRADO' && ciclosLanzados === 0)

  // Avance por área, con integrantes para el detalle expandible
  const areas = new Map<string, GrupoArea>()
  for (const c of cobertura.porColaborador) {
    const clave = c.area ?? 'Sin área'
    const g = areas.get(clave) ?? { area: clave, completos: 0, total: 0, integrantes: [] }
    g.total += 1
    if (c.total >= 100) g.completos += 1
    // Ventana del colaborador: carga abierta y (plazo vigente o extensión individual vigente)
    // (extensionHasta ya viene filtrado a extensiones vigentes en coberturaPeriodo)
    const ventanaAbierta = periodo.estado === 'CARGA_ABIERTA' && (!vencido || c.extensionHasta !== null)
    const sinJefe = c.jefe === null
    g.integrantes.push({
      id: c.id,
      nombre: c.nombre,
      total: c.total,
      jefe: c.jefe,
      objetivos: (objetivosDe.get(c.id) ?? []).map((o) => ({
        id: o.id,
        titulo: o.titulo,
        descripcion: o.descripcion ?? '',
        tipo: o.tipo,
        peso: o.peso,
        metaFecha: o.metaFecha,
        metrica: o.metrica,
        estado: o.estado,
      })),
      // RR.HH. aprueba/rechaza propuestas de personas SIN jefe; edita/elimina cuando cubre a
      // sin-jefe con la carga abierta, o a cualquiera cuando su ventana ya cerró (post-carga).
      // Aprobar sin-jefe es PROCESO de RR.HH. (no está en el catálogo admin) → exige rol RRHH;
      // gestionar objetivos sí es acción de catálogo → exige GESTIONAR de OBJETIVOS.
      puedeResolver: sesion.rol === 'RRHH' && sinJefe && (ventanaAbierta || (periodoCorregible && !ventanaAbierta)),
      puedeGestionar: puedeGestionarObjetivos && periodoCorregible && (sinJefe || !ventanaAbierta),
    })
    areas.set(clave, g)
  }
  const gruposArea = [...areas.values()].sort((a, b) => a.area.localeCompare(b.area))

  return (
    <>
      <Link href="/admin/ciclos" className="mb-3 inline-block text-sm text-gris hover:text-negro">← Volver a Ciclos y períodos</Link>
      <Titulo
        sub={`${periodo.tipo === 'ANUAL' ? 'Anual' : 'Semestral'} · límite de carga: ${periodo.fechaLimiteCarga.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })} · ${periodo._count.objetivos} objetivos · ${periodo._count.ciclos} ciclos lo evalúan`}
        accion={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <ExportarObjetivosBtn periodoId={periodo.id} />
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${chip.cls}`}>{chip.label}</span>
            {puedeGestionarObjetivos && (
              <AccionesPeriodo
                periodo={{ id: periodo.id, nombre: periodo.nombre, estado: periodo.estado, fechaLimiteCarga: periodo.fechaLimiteCarga.toISOString().slice(0, 10) }}
              />
            )}
          </div>
        }
      >
        Período {periodo.nombre}
      </Titulo>

      <p className="mb-4 flex flex-wrap items-center gap-3 text-sm text-gris">
        <span><b>Alcance:</b> {resumen}</span>
        {puedeEditarAlcance && (
          <EditarAlcancePeriodo
            periodoId={periodo.id}
            alcanceActual={{ focoPaisIds: periodo.focoPaisIds, focoAreaIds: periodo.focoAreaIds, focoNivelIds: periodo.focoNivelIds, incluirIds: periodo.incluirIds, excluirIds: periodo.excluirIds }}
            paises={catalogoPaises}
            areas={catalogoAreas}
            nivelesCatalogo={catalogoNiveles}
            colaboradores={colaboradoresAlcance.map((c) => ({ id: c.id, nombre: `${c.nombres} ${c.apellidos}`, detalle: `${c.pais.nombre} · ${c.area?.nombre ?? 'Sin área'}`, paisId: c.paisId }))}
            paisFijo={paisFijo}
          />
        )}
      </p>

      {!puedeGestionarObjetivos && <AvisoSoloLectura />}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Avance de la carga" valor={`${avancePromedio}%`} sub="promedio del peso definido" />
        <Stat label="Con objetivos al 100%" valor={cobertura.completos} sub={`de ${cobertura.total} colaboradores`} />
        <Stat label="Pendientes" valor={<span className={cobertura.incompletos.length > 0 ? 'text-hunter' : undefined}>{cobertura.incompletos.length}</span>} sub="no llegan al 100%" />
        <Stat
          label={periodo.estado === 'CERRADO' ? 'Estado' : 'Días para el límite'}
          valor={periodo.estado === 'CERRADO' ? 'Cerrado' : vencido ? 'Vencido' : dias}
          sub={periodo.estado === 'CERRADO' ? 'objetivos congelados' : vencido ? 'RR.HH. puede extender' : 'de carga de objetivos'}
        />
      </div>

      {/* Aviso: propuestas de personas sin jefe esperando aprobación de RR.HH. */}
      <BannerAprobacionesRrhh integrantes={gruposArea.flatMap((g) => g.integrantes).filter((i) => i.puedeResolver)} />

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card titulo="Avance por área" extra="clic en un área para ver a sus integrantes">
          <AvanceAreas grupos={gruposArea} />
        </Card>

        <div className="space-y-5">
          <Card titulo="Pendientes de carga" extra={`${cobertura.incompletos.length} personas · el recordatorio llega a quienes tienen cuenta`}>
            {cobertura.incompletos.length === 0 ? (
              <p className="text-sm text-emerald-700">Toda la organización tiene sus objetivos al 100% 🎯</p>
            ) : (
              <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                {cobertura.incompletos.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg bg-hueso px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{c.nombre}</span>
                      {c.jefe && <span className="ml-2 text-xs text-gris">equipo de {c.jefe}</span>}
                    </span>
                    <Chip tono={c.total > 0 ? 'pendiente' : 'rojo'}>{c.total}%</Chip>
                    {periodo.estado === 'CARGA_ABIERTA' && puedeGestionarObjetivos && (
                      <ExtensionIndividual periodoId={periodo.id} colaboradorId={c.id} nombre={c.nombre} extensionHasta={c.extensionHasta} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <CardRecordatorios proceso="OBJETIVOS" referencia={periodo.id} deadline={periodo.fechaLimiteCarga}>
            {periodo.estado === 'CARGA_ABIERTA' && puedeGestionarObjetivos && (
              <BotonEnviarRecordatoriosPeriodo periodoId={periodo.id} pendientes={cobertura.incompletos.length} />
            )}
          </CardRecordatorios>

          <CardRecordatorios proceso="APROBACIONES_JEFE" referencia={periodo.id} deadline={periodo.fechaLimiteCarga} />
        </div>
      </div>
    </>
  )
}
