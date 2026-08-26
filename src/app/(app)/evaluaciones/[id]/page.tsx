import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/shared/lib/prisma'
import { requiereSesion } from '@/shared/lib/permisos'
import { objetivosAplicables } from '@/features/resultados/servicio'
import { preguntasParaAsignacion, preguntasPotencialParaAsignacion } from '@/features/evaluaciones/cuestionario'
import { Resolver } from '@/features/evaluaciones/Resolver'
import { mesLegible } from '@/features/objetivos/periodo-ui'
import { Titulo } from '@/shared/ui/componentes'

/** Resolver de una evaluación (todas las modalidades). Solo el evaluador asignado puede abrirla. */
export default async function ResolverPage({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await requiereSesion()
  const { id } = await params

  const asignacion = await prisma.asignacion.findUnique({
    where: { id },
    include: {
      ciclo: true,
      evaluado: { include: { puesto: { include: { competencias: true } } } },
      respuestas: true,
      respuestasPotencial: true,
    },
  })
  if (!asignacion) notFound()
  if (asignacion.evaluadorId !== sesion.colaboradorId) redirect('/evaluaciones')
  if (asignacion.estado === 'PROPUESTA') redirect('/evaluaciones') // propuesta de par aún sin aprobar
  if (asignacion.estado === 'INVALIDADA') redirect('/evaluaciones') // invalidada por RR.HH. al resolver un incidente

  // Cuestionario derivado: alcance puesto>nivel + modalidad de la asignación + competencias del puesto
  const preguntasCiclo = await preguntasParaAsignacion(asignacion.cicloId, asignacion.tipo, asignacion.evaluado)
  const preguntas = preguntasCiclo.map((cp) => ({
    id: cp.preguntaId,
    texto: cp.pregunta.texto,
    competencia: cp.pregunta.competencia.nombre,
    dimension: cp.pregunta.competencia.dimension.nombre,
    descriptores: cp.pregunta.descriptores,
  }))

  // Objetivos (solo AUTO y JEFE) — ciclo sin período: sin objetivos que responder
  let objetivos: { id: string; titulo: string; tipo: string; peso: number; detalle: string; valorInicial: number | null; esTransversal: boolean }[] = []
  if ((asignacion.tipo === 'AUTO' || asignacion.tipo === 'JEFE') && asignacion.ciclo.periodoId) {
    const { transversales, individuales } = await objetivosAplicables(asignacion.ciclo.periodoId, asignacion.evaluadoId)
    const aprobados = [...transversales, ...individuales.filter((o) => o.estado === 'APROBADO')]
    objetivos = aprobados.map((o) => ({
      id: o.id,
      titulo: o.titulo,
      tipo: o.tipo === 'TRANSVERSAL' ? 'Transversal' : o.tipo === 'DESARROLLO' ? 'Desarrollo' : 'Individual',
      peso: o.peso,
      detalle: [o.metrica, o.metaFecha ? `meta ${mesLegible(o.metaFecha)}` : null].filter(Boolean).join(' · ') || (o.descripcion ?? ''),
      valorInicial: asignacion.tipo === 'AUTO' ? (o.logros[0]?.avanceColaborador ?? null) : (o.logros[0]?.logroFinal ?? o.logros[0]?.avanceColaborador ?? null),
      esTransversal: o.tipo === 'TRANSVERSAL',
    }))
  }

  const preguntasPotencial = asignacion.tipo === 'JEFE'
    ? (await preguntasPotencialParaAsignacion(asignacion.cicloId, asignacion.evaluadoId)).map((p) => ({ id: p.id, texto: p.texto, descriptores: p.descriptores }))
    : []

  const nombreEvaluado = `${asignacion.evaluado.nombres} ${asignacion.evaluado.apellidos}`
  const titulo = asignacion.tipo === 'AUTO' ? 'Autoevaluación'
    : asignacion.tipo === 'PAR' ? `Evaluación de par · ${nombreEvaluado}`
    : asignacion.tipo === 'ASCENDENTE' ? `Evaluación ascendente a ${nombreEvaluado}`
    : `Evaluación de desempeño · ${nombreEvaluado}`

  const volverA = asignacion.tipo === 'JEFE' ? '/equipo/evaluar' : '/evaluaciones'

  return (
    <>
      <Titulo sub={asignacion.ciclo.nombre}>Resolver evaluación</Titulo>
      <Resolver
        asignacionId={asignacion.id}
        titulo={titulo}
        tipo={asignacion.tipo}
        soloLectura={asignacion.estado === 'ENVIADA' || asignacion.ciclo.estado !== 'ACTIVO'}
        preguntas={preguntas}
        objetivos={objetivos}
        preguntasPotencial={preguntasPotencial}
        respuestasIniciales={Object.fromEntries(asignacion.respuestas.map((r) => [r.preguntaId, r.valor]))}
        potencialInicial={Object.fromEntries(asignacion.respuestasPotencial.map((r) => [r.preguntaId, r.valor]))}
        volverA={volverA}
      />
    </>
  )
}
