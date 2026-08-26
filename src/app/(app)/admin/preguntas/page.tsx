import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin } from '@/shared/lib/permisos'
import { tieneAdmin } from '@/shared/lib/permisos-admin'
import { AvisoSoloLectura, Titulo } from '@/shared/ui/componentes'
import { Tabs } from '@/shared/ui/Tabs'
import { BancoPreguntas } from '@/features/admin/FormPregunta'
import { PanelEvaluaciones } from '@/features/admin/PanelEvaluaciones'

export default async function DisenarEvaluacionPage() {
  const sesion = await requiereAdmin('EVALUACIONES', 'VER')
  const puedeGestionar = tieneAdmin(sesion.permisosAdmin, 'EVALUACIONES', 'GESTIONAR')
  const [preguntas, dimensiones, evaluaciones, niveles] = await Promise.all([
    prisma.pregunta.findMany({
      include: { competencia: { include: { dimension: true } } },
      orderBy: [{ activa: 'desc' }, { competencia: { dimension: { orden: 'asc' } } }, { competencia: { nombre: 'asc' } }],
    }),
    prisma.dimension.findMany({ include: { competencias: { orderBy: { nombre: 'asc' } } }, orderBy: { orden: 'asc' } }),
    prisma.evaluacion.findMany({ include: { preguntas: { select: { preguntaId: true, modalidad: true } }, preguntasPotencial: { select: { preguntaPotencialId: true } }, _count: { select: { ciclos: true } } }, orderBy: { nombre: 'asc' } }),
    prisma.nivelJerarquico.findMany({
      include: {
        puestos: {
          include: { competencias: true, pesos: true, _count: { select: { colaboradores: { where: { activo: true } } } } },
          orderBy: { nombre: 'asc' },
        },
      },
      orderBy: { orden: 'asc' },
    }),
  ])

  // Puestos cuyos titulares tienen subordinados activos (solo esos reciben evaluación ascendente)
  const conEquipo = await prisma.colaborador.findMany({
    where: { activo: true, jefe: { activo: true, puestoId: { not: null } } },
    select: { jefe: { select: { puestoId: true } } },
  })
  const puestosQueLideran = new Set(conEquipo.map((c) => c.jefe?.puestoId).filter(Boolean))
  const potencial = await prisma.preguntaPotencial.findMany({ orderBy: { orden: 'asc' } })

  // Preguntas activas del banco agrupadas por dimensión → competencia (para el editor de evaluaciones)
  const activasPorCompetencia = new Map<string, { id: string; texto: string; modalidades: string[] }[]>()
  for (const p of preguntas.filter((p) => p.activa)) {
    activasPorCompetencia.set(p.competenciaId, [...(activasPorCompetencia.get(p.competenciaId) ?? []), { id: p.id, texto: p.texto, modalidades: p.modalidades }])
  }
  const dimensionesW = dimensiones.map((d) => ({
    id: d.id,
    nombre: d.nombre,
    competencias: d.competencias.map((c) => ({ id: c.id, nombre: c.nombre, preguntas: activasPorCompetencia.get(c.id) ?? [] })),
  }))

  const tabEvaluaciones = (
    <PanelEvaluaciones
      puedeGestionar={puedeGestionar}
      evaluaciones={evaluaciones.map((e) => ({
        id: e.id, nombre: e.nombre, descripcion: e.descripcion, activa: e.activa,
        nivelId: e.nivelId, puestoId: e.puestoId, preguntas: e.preguntas, ciclos: e._count.ciclos,
        potencialIds: e.preguntasPotencial.map((p) => p.preguntaPotencialId),
      }))}
      potencial={potencial.filter((p) => p.activa).map((p) => ({ id: p.id, texto: p.texto }))}
      dimensiones={dimensionesW}
      niveles={niveles.map((n) => ({
        id: n.id, nombre: n.nombre,
        puestos: n.puestos.map((p) => ({
          id: p.id, nombre: p.nombre,
          competenciaIds: p.competencias.map((c) => c.competenciaId),
          colaboradores: p._count.colaboradores,
          lidera: puestosQueLideran.has(p.id),
          pesos: p.pesos.map((w) => ({ dimensionId: w.dimensionId, peso: w.peso })),
        })),
      }))}
    />
  )

  const tabBanco = (
    <BancoPreguntas
      puedeGestionar={puedeGestionar}
      dimensiones={dimensiones.map((d) => ({ id: d.id, nombre: d.nombre, competencias: d.competencias.map((c) => ({ id: c.id, nombre: c.nombre })) }))}
      preguntas={preguntas.map((p) => ({ id: p.id, texto: p.texto, activa: p.activa, competencia: p.competencia.nombre, competenciaId: p.competenciaId, dimensionId: p.competencia.dimensionId, dimension: p.competencia.dimension.nombre, modalidades: p.modalidades, descriptores: p.descriptores }))}
      potencial={potencial.map((p) => ({ id: p.id, texto: p.texto, activa: p.activa, descriptores: p.descriptores }))}
    />
  )

  return (
    <>
      <Titulo sub="Arma una evaluación por nivel (o por puesto como excepción); cada colaborador responde según su puesto y la modalidad">Diseñar evaluación</Titulo>
      {!puedeGestionar && <AvisoSoloLectura />}
      <Tabs
        tabs={[
          { id: 'evaluaciones', label: 'Creación de evaluaciones', icono: 'preguntas', contenido: tabEvaluaciones },
          { id: 'banco', label: 'Banco de preguntas', icono: 'transversales', contenido: tabBanco },
        ]}
      />
    </>
  )
}
