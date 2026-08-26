import Link from 'next/link'
import { prisma } from '@/shared/lib/prisma'
import { requiereSesion } from '@/shared/lib/permisos'
import { preguntasParaAsignacion } from '@/features/evaluaciones/cuestionario'
import { Avatar, Card, Chip, Titulo, Vacio } from '@/shared/ui/componentes'

const TIPO_DESC: Record<string, string> = {
  AUTO: 'Competencias + avance de mis objetivos · escala 1–5',
  PAR: 'Anónima para la persona evaluada',
  ASCENDENTE: 'Evaluación ascendente · solo competencias · anónima para el evaluado',
}

const CHIP_MODALIDAD: Record<string, { etiqueta: string; clase: string }> = {
  AUTO: { etiqueta: 'AUTO', clase: 'bg-blue-50 text-marca-dark' },
  PAR: { etiqueta: 'PAR', clase: 'bg-violet-50 text-violet-700' },
  ASCENDENTE: { etiqueta: 'ASCENDENTE', clase: 'bg-orange-50 text-orange-700' },
}

export default async function MisEvaluacionesPage({ searchParams }: { searchParams: Promise<{ enviada?: string }> }) {
  const sesion = await requiereSesion()
  const { enviada } = await searchParams

  const asignaciones = await prisma.asignacion.findMany({
    where: {
      evaluadorId: sesion.colaboradorId,
      tipo: { not: 'JEFE' },
      estado: { notIn: ['PROPUESTA', 'INVALIDADA'] }, // propuestas sin aprobar e invalidadas por RR.HH.
      ciclo: { estado: 'ACTIVO' },
    },
    include: {
      evaluado: { include: { puesto: { include: { competencias: true } } } },
      ciclo: true,
      _count: { select: { respuestas: true } },
    },
    orderBy: [{ tipo: 'asc' }],
  })

  // Barrita de avance de las que están en curso (BORRADOR): respuestas dadas vs preguntas del
  // cuestionario. Solo se calcula para esas (rara vez más de una o dos a la vez).
  const avancePorAsignacion = new Map<string, number>()
  for (const a of asignaciones.filter((x) => x.estado === 'BORRADOR')) {
    const total = (await preguntasParaAsignacion(a.cicloId, a.tipo as 'AUTO' | 'PAR' | 'ASCENDENTE', a.evaluado)).length
    if (total > 0) avancePorAsignacion.set(a.id, Math.min(100, Math.round((a._count.respuestas / total) * 100)))
  }

  const enviadas = asignaciones.filter((a) => a.estado === 'ENVIADA').length
  const extraCabecera = asignaciones.length > 0
    ? `${asignaciones[0].ciclo.nombre} · ${enviadas} de ${asignaciones.length} enviadas`
    : undefined

  return (
    <>
      <Titulo sub="Evaluaciones que te corresponde responder en el ciclo vigente">Mis evaluaciones</Titulo>
      {enviada && <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">Evaluación enviada ✓</p>}
      <Card titulo="Pendientes y enviadas" extra={extraCabecera}>
        {asignaciones.length === 0 ? (
          <Vacio>No tienes evaluaciones asignadas en el ciclo vigente.</Vacio>
        ) : (
          <ul className="space-y-2.5">
            {asignaciones.map((a) => {
              const esAuto = a.tipo === 'AUTO'
              const nombre = esAuto ? 'Autoevaluación' : `${a.evaluado.nombres} ${a.evaluado.apellidos}`
              const tituloEscritorio = esAuto ? 'Autoevaluación'
                : a.tipo === 'PAR' ? `Par · ${nombre}`
                : `Evaluación ascendente a ${nombre}`
              const meta = `${!esAuto && a.evaluado.puesto ? `${a.evaluado.puesto.nombre} · ` : ''}${TIPO_DESC[a.tipo]}`
              const mod = CHIP_MODALIDAD[a.tipo]
              const avance = avancePorAsignacion.get(a.id)
              const avatar = esAuto
                ? <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-marca font-display text-[10px] font-extrabold text-white">YO</span>
                : <Avatar nombre={nombre} />
              return (
                // En móvil TODA la card navega (Link superpuesto); en escritorio se mantiene la
                // fila con su botón. El nombre va a lo ancho: contra la columna angosta de antes
                // se partía en 3–4 líneas.
                <li key={a.id} className="relative rounded-xl border border-gris-claro px-4 py-3 transition hover:border-gris/60">
                  <Link href={`/evaluaciones/${a.id}`} aria-label={`${tituloEscritorio}: abrir`} className="absolute inset-0 z-10 rounded-xl md:hidden" />

                  {/* Móvil: fila de chips → nombre a lo ancho + chevron → meta → barrita */}
                  <div className="flex items-center gap-2 md:hidden">
                    {avatar}
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold tracking-wide ${mod.clase}`}>{mod.etiqueta}</span>
                    {a.estado === 'ENVIADA' && <span className="ml-auto rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10.5px] font-extrabold text-emerald-700">Enviada ✓</span>}
                    {a.estado === 'BORRADOR' && <span className="ml-auto rounded-full bg-blue-50 px-2.5 py-0.5 text-[10.5px] font-extrabold text-blue-700">En curso</span>}
                    {a.estado === 'PENDIENTE' && <span className="ml-auto rounded-full bg-amber-50 px-2.5 py-0.5 text-[10.5px] font-extrabold text-amber-700">Pendiente</span>}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 md:hidden">
                    <p className="text-[14.5px] font-bold leading-snug">{nombre}</p>
                    <span className="shrink-0 text-xl font-bold text-gris-claro">›</span>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-gris md:hidden">
                    {meta}{a.estado === 'ENVIADA' ? ' · toca para ver tus respuestas' : ''}
                  </p>
                  {avance !== undefined && (
                    <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-hueso-2 md:hidden">
                      <div className="h-full rounded-full bg-blue-600" style={{ width: `${avance}%` }} />
                    </div>
                  )}

                  {/* Escritorio: la fila de siempre */}
                  <div className="hidden items-center gap-4 md:flex">
                    {avatar}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">{tituloEscritorio}</p>
                      <p className="text-xs text-gris">{meta}</p>
                    </div>
                    {a.estado === 'ENVIADA' && <Chip tono="ok">Enviada</Chip>}
                    {a.estado === 'BORRADOR' && <Chip tono="pendiente">En curso</Chip>}
                    {a.estado === 'PENDIENTE' && <Chip tono="pendiente">Pendiente</Chip>}
                    <Link
                      href={`/evaluaciones/${a.id}`}
                      className="rounded-xl bg-marca px-4 py-2 font-display text-xs font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark"
                    >
                      {a.estado === 'ENVIADA' ? 'Ver' : 'Responder'}
                    </Link>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </>
  )
}
