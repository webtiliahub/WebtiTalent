import Link from 'next/link'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin, alcancePaisWhere } from '@/shared/lib/permisos'
import { Titulo } from '@/shared/ui/componentes'
import { WizardPeriodo } from '@/features/objetivos/WizardPeriodo'

export default async function NuevoPeriodoPage() {
  const sesion = await requiereAdmin('OBJETIVOS', 'GESTIONAR') // el wizard es 100% mutación: mismo criterio que /admin/ciclos/nuevo
  const [paises, areas, nivelesCatalogo, colaboradores] = await Promise.all([
    prisma.pais.findMany({ orderBy: { codigo: 'asc' } }),
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
      <Link href="/admin/ciclos" className="mb-3 inline-block text-sm text-gris hover:text-negro">← Volver a Ciclos y períodos</Link>
      <Titulo sub="Asistente de creación: datos, alcance y revisión">Nuevo período de objetivos</Titulo>
      <WizardPeriodo
        paises={paises.map((p) => ({ id: p.id, nombre: p.nombre }))}
        areas={areas.map((a) => ({ id: a.id, nombre: a.nombre }))}
        nivelesCatalogo={nivelesCatalogo.map((n) => ({ id: n.id, nombre: n.nombre }))}
        colaboradores={colaboradores.map((c) => ({ id: c.id, nombre: `${c.nombres} ${c.apellidos}`, detalle: `${c.pais.nombre} · ${c.area?.nombre ?? 'Sin área'}`, paisId: c.paisId }))}
        paisFijo={paisFijo}
      />
    </>
  )
}
