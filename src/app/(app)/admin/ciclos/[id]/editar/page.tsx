import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin, alcancePaisWhere } from '@/shared/lib/permisos'
import { Titulo } from '@/shared/ui/componentes'
import { WizardCiclo } from '@/features/admin/WizardCiclo'
import { nivelesParaSelectorEvaluaciones } from '@/features/admin/selector-evaluaciones-datos'

/** Edición de un ciclo EN BORRADOR: el mismo wizard de creación, con todo precargado
 * (nombre, alcance, período, fechas y evaluaciones). Un ciclo lanzado no se edita. */
export default async function EditarCicloPage({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR') // el wizard es 100% mutación: mismo criterio que /importar
  const { id } = await params

  const ciclo = await prisma.ciclo.findUnique({
    where: { id },
    include: { evaluaciones: { include: { evaluacion: { select: { id: true, nivelId: true, puestoId: true } } } } },
  })
  if (!ciclo) notFound()
  // Mismo piso de alcance que las demás operaciones de ciclo
  const scope = alcancePaisWhere(sesion)
  if (scope.paisId && ciclo.paisId !== scope.paisId) redirect('/admin/ciclos')
  if (ciclo.estado !== 'BORRADOR') redirect(`/admin/ciclos/${id}`)

  const [nivelesW, paises, periodos, areas, nivelesCatalogo, colaboradores] = await Promise.all([
    nivelesParaSelectorEvaluaciones(),
    prisma.pais.findMany({ orderBy: { codigo: 'asc' } }),
    prisma.periodoObjetivos.findMany({ where: { estado: { in: ['CERRADO', 'CARGA_ABIERTA'] } }, orderBy: { createdAt: 'desc' } }),
    prisma.area.findMany({ orderBy: { nombre: 'asc' } }),
    prisma.nivelJerarquico.findMany({ orderBy: { orden: 'asc' } }),
    prisma.colaborador.findMany({
      // El país es el TECHO del alcance: el recorte va en la consulta, no solo en el filtro del
      // Combobox. Todo lo que se pase a un componente cliente viaja en el payload y se lee en
      // DevTools, así que un RR.HH. de país recibía el padrón completo de la región.
      where: { activo: true, ...alcancePaisWhere(sesion) },
      select: { id: true, nombres: true, apellidos: true, paisId: true, pais: { select: { nombre: true } }, area: { select: { nombre: true } } },
      orderBy: [{ apellidos: 'asc' }],
    }),
  ])
  const paisFijo = sesion.alcanceRrhh === 'PAIS' && sesion.alcancePaisId
    ? { id: sesion.alcancePaisId, nombre: paises.find((p) => p.id === sesion.alcancePaisId)?.nombre ?? '' }
    : undefined

  return (
    <>
      <Link href={`/admin/ciclos/${id}`} className="mb-3 inline-block text-sm text-gris hover:text-negro">← Volver al ciclo</Link>
      <Titulo sub="El ciclo está en borrador: puedes ajustar sus datos, alcance, período, fechas y evaluaciones antes de lanzarlo">
        Editar ciclo · {ciclo.nombre}
      </Titulo>
      <WizardCiclo
        niveles={nivelesW}
        paises={paises.map((p) => ({ id: p.id, nombre: p.nombre }))}
        periodos={periodos.map((p) => ({ id: p.id, nombre: p.nombre, estado: p.estado }))}
        areas={areas.map((a) => ({ id: a.id, nombre: a.nombre }))}
        nivelesCatalogo={nivelesCatalogo.map((n) => ({ id: n.id, nombre: n.nombre }))}
        colaboradores={colaboradores.map((c) => ({ id: c.id, nombre: `${c.nombres} ${c.apellidos}`, detalle: `${c.pais.nombre} · ${c.area?.nombre ?? 'Sin área'}`, paisId: c.paisId }))}
        paisFijo={paisFijo}
        edicion={{
          cicloId: ciclo.id,
          nombre: ciclo.nombre,
          descripcion: ciclo.descripcion ?? '',
          periodoId: ciclo.periodoId,
          // en-CA = yyyy-mm-dd en la MISMA zona horaria del servidor con la que se parsearon
          // al guardar (toISOString correría la fecha fin —23:59:59— al día siguiente)
          fechaInicio: ciclo.fechaInicio.toLocaleDateString('en-CA'),
          fechaFin: ciclo.fechaFin.toLocaleDateString('en-CA'),
          porNivel: Object.fromEntries(
            ciclo.evaluaciones.filter((e) => e.evaluacion.nivelId).map((e) => [e.evaluacion.nivelId!, e.evaluacion.id]),
          ),
          porPuesto: Object.fromEntries(
            ciclo.evaluaciones.filter((e) => e.evaluacion.puestoId).map((e) => [e.evaluacion.puestoId!, e.evaluacion.id]),
          ),
          focoPaisIds: ciclo.focoPaisIds,
          focoAreaIds: ciclo.focoAreaIds,
          focoNivelIds: ciclo.focoNivelIds,
          incluirIds: ciclo.incluirIds,
          excluirIds: ciclo.excluirIds,
        }}
      />
    </>
  )
}
