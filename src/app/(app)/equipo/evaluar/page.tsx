import Link from 'next/link'
import { prisma } from '@/shared/lib/prisma'
import { requiereJefe } from '@/shared/lib/permisos'
import { Avatar, Card, Chip, Stat, Titulo, Vacio } from '@/shared/ui/componentes'
import { NominadorPares } from '@/features/evaluaciones/NominadorPares'

export default async function EvaluarEquipoPage({ searchParams }: { searchParams: Promise<{ enviada?: string }> }) {
  const sesion = await requiereJefe()
  const { enviada } = await searchParams

  const asignaciones = await prisma.asignacion.findMany({
    where: { evaluadorId: sesion.colaboradorId, tipo: 'JEFE', ciclo: { estado: 'ACTIVO' } },
    include: { evaluado: { include: { puesto: true } }, ciclo: true },
    orderBy: { evaluado: { apellidos: 'asc' } },
  })

  // Avance general del equipo en el ciclo (todas las evaluaciones donde el equipo participa)
  const equipo = await prisma.colaborador.findMany({
    where: { jefeId: sesion.colaboradorId, activo: true },
    include: { puesto: true },
    orderBy: { apellidos: 'asc' },
  })
  const equipoIds = equipo.map((c) => c.id)
  const delEquipo = await prisma.asignacion.findMany({
    where: { ciclo: { estado: 'ACTIVO' }, evaluadorId: { in: equipoIds }, estado: { notIn: ['PROPUESTA', 'INVALIDADA'] } },
    select: { estado: true },
  })
  const enviadas = delEquipo.filter((a) => a.estado === 'ENVIADA').length

  // Nominación de pares: el jefe nomina 2 por miembro. El par evaluador NO necesita
  // participar del ciclo ni ser del país del ciclo (aporta su mirada, no recibe evaluación;
  // los altos mandos suelen tener a sus pares reales en otro país). Pool = todos los ACTIVOS
  // de la región con antigüedad mínima; los de fuera del equipo entran como PROPUESTA que
  // aprueba RR.HH.
  const cicloActivo = asignaciones[0]?.ciclo ?? (await prisma.ciclo.findFirst({ where: { estado: 'ACTIVO' } }))
  // El padrón de candidatos a par YA NO se vuelca aquí: NominadorPares busca server-side (≤20 por
  // término) vía buscarCandidatosPar, así el directorio de ~800 no viaja al navegador de cada jefe.
  const [paresEquipo, participantes] = cicloActivo
    ? await Promise.all([
        prisma.asignacion.findMany({
          where: { cicloId: cicloActivo.id, tipo: 'PAR', evaluadoId: { in: equipoIds }, estado: { not: 'INVALIDADA' } },
          include: { evaluador: true },
        }),
        prisma.asignacion.findMany({
          where: { cicloId: cicloActivo.id, tipo: 'AUTO' },
          select: { evaluadorId: true },
        }),
      ])
    : [[], []]
  const participaIds = new Set(participantes.map((a) => a.evaluadorId))
  // Solo se nominan pares para quienes PARTICIPAN del ciclo (alguien de otro país o excluido
  // no tiene evaluación en este ciclo, aunque sea parte del equipo directo)
  const equipoParticipante = equipo.filter((m) => participaIds.has(m.id))

  return (
    <>
      <Titulo sub="Evalúa a tu equipo directo: competencias, cumplimiento de objetivos y potencial">Evaluar a mi equipo</Titulo>
      {enviada && <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">Evaluación enviada ✓</p>}

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <Stat label="Mis evaluaciones de jefe" valor={`${asignaciones.filter((a) => a.estado === 'ENVIADA').length} / ${asignaciones.length}`} sub="enviadas" />
        <Stat label="Avance de mi equipo" valor={delEquipo.length === 0 ? '—' : `${Math.round((enviadas / delEquipo.length) * 100)}%`} sub={`${enviadas} de ${delEquipo.length} respuestas del equipo`} />
        <Stat label="Ciclo" valor={asignaciones[0]?.ciclo.nombre ?? '—'} sub="vigente" />
      </div>

      <Card titulo="Evaluaciones de desempeño" extra="competencias + objetivos + potencial">
        {asignaciones.length === 0 ? (
          <Vacio>No tienes evaluaciones de equipo en el ciclo vigente.</Vacio>
        ) : (
          <ul className="space-y-2.5">
            {asignaciones.map((a) => (
              // Móvil: card completa tocable (mismo diseño que Mis evaluaciones) — el nombre se
              // partía en 3 líneas contra la columna del botón. Escritorio: la fila de siempre.
              <li key={a.id} className="relative rounded-xl border border-gris-claro px-4 py-3 transition hover:border-gris/60">
                <Link href={`/evaluaciones/${a.id}`} aria-label={`Evaluar a ${a.evaluado.nombres} ${a.evaluado.apellidos}`} className="absolute inset-0 z-10 rounded-xl md:hidden" />

                {/* Móvil */}
                <div className="flex items-center gap-2 md:hidden">
                  <Avatar nombre={`${a.evaluado.nombres} ${a.evaluado.apellidos}`} />
                  {a.estado === 'ENVIADA' && <span className="ml-auto rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10.5px] font-extrabold text-emerald-700">Enviada ✓</span>}
                  {a.estado === 'BORRADOR' && <span className="ml-auto rounded-full bg-blue-50 px-2.5 py-0.5 text-[10.5px] font-extrabold text-blue-700">En curso</span>}
                  {a.estado === 'PENDIENTE' && <span className="ml-auto rounded-full bg-amber-50 px-2.5 py-0.5 text-[10.5px] font-extrabold text-amber-700">Pendiente</span>}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 md:hidden">
                  <p className="text-[14.5px] font-bold leading-snug">{a.evaluado.nombres} {a.evaluado.apellidos}</p>
                  <span className="shrink-0 text-xl font-bold text-gris-claro">›</span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-gris md:hidden">
                  {a.evaluado.puesto?.nombre ? `${a.evaluado.puesto.nombre} · ` : ''}{a.estado === 'ENVIADA' ? 'toca para ver tus respuestas' : 'competencias + objetivos + potencial'}
                </p>

                {/* Escritorio */}
                <div className="hidden items-center gap-4 md:flex">
                  <Avatar nombre={`${a.evaluado.nombres} ${a.evaluado.apellidos}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">{a.evaluado.nombres} {a.evaluado.apellidos}</p>
                    <p className="text-xs text-gris">{a.evaluado.puesto?.nombre ?? ''} · Competencias + objetivos + potencial</p>
                  </div>
                  {a.estado === 'ENVIADA' ? <Chip tono="ok">Enviada</Chip> : a.estado === 'BORRADOR' ? <Chip tono="pendiente">En curso</Chip> : <Chip tono="pendiente">Pendiente</Chip>}
                  <Link href={`/evaluaciones/${a.id}`} className="rounded-xl bg-hunter px-4 py-2 font-display text-xs font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark">
                    {a.estado === 'ENVIADA' ? 'Ver' : 'Evaluar →'}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {cicloActivo && equipoParticipante.length > 0 && (
        <div className="mt-5">
          <Card titulo="Pares evaluadores de mi equipo" extra="nominas 2 por persona · anónimo para la persona evaluada">
            <p className="mb-3 text-xs text-gris">
              Los pares responden el cuestionario de la modalidad Pares definido en la evaluación del ciclo. La persona evaluada nunca sabe quién la evaluó; RR.HH. sí puede verlo.
            </p>
            <NominadorPares
              cicloId={cicloActivo.id}
              equipo={equipoParticipante.map((m) => ({
                id: m.id,
                nombre: `${m.nombres} ${m.apellidos}`,
                puesto: m.puesto?.nombre ?? '—',
                pares: paresEquipo
                  .filter((p) => p.evaluadoId === m.id)
                  .map((p) => ({ evaluadorId: p.evaluadorId, nombre: `${p.evaluador.nombres} ${p.evaluador.apellidos}`, estado: p.estado })),
              }))}
            />
          </Card>
        </div>
      )}
    </>
  )
}
