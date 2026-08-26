import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin } from '@/shared/lib/permisos'
import { tieneAdmin } from '@/shared/lib/permisos-admin'
import { Avatar, Card, Chip, NivelChip, Titulo } from '@/shared/ui/componentes'
import { Tabs } from '@/shared/ui/Tabs'
import { PerfilDimensiones, SelectorCompetencias } from '@/features/admin/EditorPuesto'
import { CardProposito, CardRequisitos, EditarIdentidadPuesto } from '@/features/admin/FichaPuesto'

export default async function PuestoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await requiereAdmin('PUESTOS', 'VER')
  const puedeGestionar = tieneAdmin(sesion.permisosAdmin, 'PUESTOS', 'GESTIONAR')
  const { id } = await params

  const puesto = await prisma.puesto.findUnique({
    where: { id },
    include: {
      area: true,
      nivel: true,
      pesos: true,
      competencias: true,
      colaboradores: { where: { activo: true }, select: { paisId: true } },
    },
  })
  if (!puesto) notFound()

  const [dimensiones, competencias, niveles, areas] = await Promise.all([
    prisma.dimension.findMany({ orderBy: { orden: 'asc' } }),
    prisma.competencia.findMany({ include: { dimension: true }, orderBy: { nombre: 'asc' } }),
    prisma.nivelJerarquico.findMany({ orderBy: { orden: 'asc' } }),
    prisma.area.findMany({ orderBy: { nombre: 'asc' } }),
  ])
  const perfilDe = (dimId: string) => puesto.pesos.find((p) => p.dimensionId === dimId)
  const activas = new Set(puesto.competencias.map((c) => c.competenciaId))
  const nPersonas = puesto.colaboradores.length
  const nPaises = new Set(puesto.colaboradores.map((c) => c.paisId)).size

  const tabPerfil = (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <CardProposito puestoId={puesto.id} descripcion={puesto.descripcion} responsabilidades={puesto.responsabilidades} puedeGestionar={puedeGestionar} />
      <CardRequisitos
        puestoId={puesto.id}
        puedeGestionar={puedeGestionar}
        valores={{
          formacion: puesto.formacion,
          experiencia: puesto.experiencia,
          certificaciones: puesto.certificaciones,
          reportaA: puesto.reportaA,
          supervisa: puesto.supervisa,
        }}
      />
    </div>
  )

  const tabCompetencias = (
    <Card titulo="Competencias requeridas" extra="el ciclo recomienda preguntas según estas competencias">
      <SelectorCompetencias
        puestoId={puesto.id}
        puedeGestionar={puedeGestionar}
        grupos={dimensiones.map((d) => ({
          nombre: d.nombre,
          competencias: competencias
            .filter((c) => c.dimensionId === d.id)
            .map((c) => ({ id: c.id, nombre: c.nombre, activa: activas.has(c.id) })),
        })).filter((g) => g.competencias.length > 0)}
      />
    </Card>
  )

  const tabPesos = (
    <Card titulo="Perfil por dimensión" extra="peso en la nota y puntaje esperado del puesto">
      <PerfilDimensiones
        puestoId={puesto.id}
        puedeGestionar={puedeGestionar}
        dimensiones={dimensiones.map((d) => ({
          id: d.id,
          nombre: d.nombre,
          peso: perfilDe(d.id)?.peso ?? 0,
          puntajeEsperado: perfilDe(d.id)?.puntajeEsperado ?? 3,
        }))}
      />
    </Card>
  )

  return (
    <>
      <Link href="/admin/puestos" className="mb-3 inline-block text-sm text-gris hover:text-negro">← Volver a Puestos y niveles</Link>
      <Titulo>Descripción del puesto</Titulo>

      {/* Cabecera tipo ficha */}
      <div className="group mb-5 flex flex-wrap items-center gap-4 rounded-2xl border border-gris-claro bg-white p-5">
        <Avatar nombre={puesto.nombre} size="lg" />
        <div className="min-w-48 flex-1">
          <h2 className="font-display text-xl font-bold">{puesto.nombre}</h2>
          <p className="text-sm text-gris">
            {puesto.nivel.nombre}{puesto.area ? ` · ${puesto.area.nombre}` : ''}{puesto.reportaA ? ` · reporta a ${puesto.reportaA}` : ''}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <NivelChip nivel={puesto.nivel.nombre} />
            {puesto.supervisa && <Chip>Supervisa: {puesto.supervisa}</Chip>}
            <Chip>{nPersonas} en el cargo{nPaises > 1 ? ` · ${nPaises} países` : ''}</Chip>
          </div>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-extrabold tracking-tight">{puesto.nivel.compPct}/{100 - puesto.nivel.compPct}</div>
          <div className="text-[11px] leading-tight text-gris">Competencias /<br />Objetivos</div>
        </div>
        <EditarIdentidadPuesto
          puedeGestionar={puedeGestionar}
          puestoId={puesto.id}
          nombre={puesto.nombre}
          nivelId={puesto.nivelId}
          areaId={puesto.areaId}
          niveles={niveles.map((n) => ({ id: n.id, nombre: n.nombre }))}
          areas={areas.map((a) => ({ id: a.id, nombre: a.nombre }))}
        />
      </div>

      <Tabs
        tabs={[
          { id: 'perfil', label: 'Perfil del puesto', icono: 'perfil-puesto', contenido: tabPerfil },
          { id: 'competencias', label: 'Competencias requeridas', icono: 'competencias', contenido: tabCompetencias },
          { id: 'pesos', label: 'Pesos y evaluación', icono: 'pesos-evaluacion', contenido: tabPesos },
        ]}
      />
    </>
  )
}
