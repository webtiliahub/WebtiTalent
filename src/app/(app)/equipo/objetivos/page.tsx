import { prisma } from '@/shared/lib/prisma'
import { requiereJefe, alcancePaisWhere } from '@/shared/lib/permisos'
import { objetivosAplicables } from '@/features/resultados/servicio'
import { PanelObjetivosEquipo, FormAsignar } from '@/features/objetivos/PanelEquipo'
import { TarjetaMiembro } from '@/features/objetivos/TarjetaMiembro'
import { BannerVentana, ventanaVencida } from '@/features/objetivos/periodo'
import { estaEnAlcancePeriodo } from '@/features/objetivos/alcance-periodo'
import { Card, Titulo, Vacio } from '@/shared/ui/componentes'

export default async function ObjetivosEquipoPage() {
  const sesion = await requiereJefe()

  const esRrhh = sesion.rol === 'RRHH'
  // El jefe gestiona a su equipo directo; RR.HH. además cubre a quienes no tienen jefe (p.ej. CEO)
  const equipoCompleto = await prisma.colaborador.findMany({
    where: {
      activo: true,
      OR: [
        { jefeId: sesion.colaboradorId },
        ...(esRrhh ? [{ jefeId: null, ...alcancePaisWhere(sesion, null) }] : []),
      ],
    },
    include: { puesto: { select: { nivelId: true } } },
    orderBy: { apellidos: 'asc' },
  })
  const paraAlcance = equipoCompleto.map((c) => ({ id: c.id, activo: c.activo, paisId: c.paisId, areaId: c.areaId, nivelId: c.puesto?.nivelId ?? null }))

  // El período mostrado es el CARGA_ABIERTA/CERRADO más reciente (mismo orden de candidatos
  // que periodoVigenteParaColaborador) que incluya al MENOS a un miembro del equipo.
  const buscarPeriodoDelEquipo = async () => {
    const abiertos = await prisma.periodoObjetivos.findMany({ where: { estado: 'CARGA_ABIERTA' }, orderBy: { createdAt: 'desc' } })
    const vigente = abiertos.find((p) => paraAlcance.some((c) => estaEnAlcancePeriodo(p, c)))
    if (vigente) return vigente
    const cerrados = await prisma.periodoObjetivos.findMany({ where: { estado: 'CERRADO' }, orderBy: { createdAt: 'desc' } })
    return cerrados.find((p) => paraAlcance.some((c) => estaEnAlcancePeriodo(p, c))) ?? null
  }
  const periodo = await buscarPeriodoDelEquipo()
  if (!periodo) {
    return (<><Titulo>Objetivos del equipo</Titulo><Vacio>No hay un período de objetivos activo para tu equipo.</Vacio></>)
  }

  // El jefe solo ve/gestiona a los miembros dentro del alcance del período elegido
  const incluidosIds = new Set(paraAlcance.filter((c) => estaEnAlcancePeriodo(periodo, c)).map((c) => c.id))
  const equipo = equipoCompleto.filter((c) => incluidosIds.has(c.id))
  const equipoIds = equipo.map((c) => c.id)
  const pendientes = await prisma.objetivo.findMany({
    where: {
      periodoId: periodo.id,
      estado: 'PROPUESTO',
      // El jefe aprueba a su equipo directo; RR.HH. además cubre a quienes no tienen jefe (p.ej. CEO)
      OR: [
        { colaboradorId: { in: equipoIds } },
        ...(esRrhh ? [{ colaborador: { is: { jefeId: null, activo: true, ...alcancePaisWhere(sesion, null) } } }] : []),
      ],
    },
    include: { colaborador: true },
    orderBy: { createdAt: 'asc' },
  })

  // Estado de pesos por miembro
  const resumen = await Promise.all(equipo.map(async (c) => {
    const { transversales, individuales } = await objetivosAplicables(periodo.id, c.id)
    const usado = transversales.reduce((a, t) => a + t.peso, 0) +
      individuales.filter((o) => o.estado !== 'RECHAZADO').reduce((a, o) => a + o.peso, 0)
    const etiqueta = c.id === sesion.colaboradorId ? ' (tú)' : c.jefeId === null ? ' · sin jefe directo' : ''
    return {
      id: c.id,
      nombre: `${c.nombres} ${c.apellidos}${etiqueta}`,
      usado,
      transversales: transversales.length,
      objetivos: individuales.map((o) => ({
        id: o.id,
        titulo: o.titulo,
        descripcion: o.descripcion ?? '',
        tipo: o.tipo,
        peso: o.peso,
        metaFecha: o.metaFecha,
        metrica: o.metrica,
        estado: o.estado,
      })),
    }
  }))
  // Ventana efectiva por miembro: plazo global vigente, o extensión individual vigente
  const vencida = ventanaVencida(periodo.fechaLimiteCarga)
  const extendidos = new Set(
    (await prisma.extensionPlazoObjetivos.findMany({
      where: { periodoId: periodo.id, hasta: { gte: new Date() } },
      select: { colaboradorId: true },
    })).map((e) => e.colaboradorId),
  )
  const ventanaDe = (colaboradorId: string) =>
    periodo.estado === 'CARGA_ABIERTA' && (!vencida || extendidos.has(colaboradorId))

  const miembros = resumen
    .filter((r) => ventanaDe(r.id))
    .map((r) => ({ id: r.id, nombre: r.nombre, disponible: Math.max(100 - r.usado, 0) }))

  return (
    <>
      <Titulo
        sub={`Período ${periodo.nombre} · aprueba propuestas, ajusta pesos y asigna objetivos`}
        accion={miembros.length > 0 ? <FormAsignar periodoId={periodo.id} miembros={miembros} /> : undefined}
      >
        Objetivos del equipo
      </Titulo>
      <BannerVentana periodo={periodo} />
      <div className="space-y-5">
        <Card titulo="Estado por colaborador" extra="la suma de pesos debe llegar a 100%">
          <ul className="grid gap-2.5 md:grid-cols-3">
            {resumen.map((r) => (
              <TarjetaMiembro
                key={r.id}
                nombre={r.nombre}
                transversales={r.transversales}
                usado={r.usado}
                objetivos={r.objetivos}
                ventanaAbierta={ventanaDe(r.id)}
              />
            ))}
          </ul>
        </Card>

        <PanelObjetivosEquipo
          pendientes={pendientes.map((o) => ({
            id: o.id,
            titulo: o.titulo,
            descripcion: o.descripcion ?? '',
            peso: o.peso,
            tipo: o.tipo,
            metrica: o.metrica,
            metaFecha: o.metaFecha,
            colaborador: o.colaborador
              ? `${o.colaborador.nombres} ${o.colaborador.apellidos}${o.colaborador.jefeId === null ? ' · sin jefe directo (apruebas como RR.HH.)' : ''}`
              : '',
          }))}
        />
      </div>
    </>
  )
}
