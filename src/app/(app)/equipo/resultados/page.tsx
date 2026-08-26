import type { ReactNode } from 'react'
import { prisma } from '@/shared/lib/prisma'
import { requiereJefe } from '@/shared/lib/permisos'
import { Avatar, Card, Nota, Titulo, Vacio } from '@/shared/ui/componentes'
import { FormFeedback } from '@/features/feedback/FormFeedback'

export default async function ResultadosEquipoPage() {
  const sesion = await requiereJefe()
  const ciclo = await prisma.ciclo.findFirst({
    where: { estado: { in: ['ACTIVO', 'CERRADO'] } },
    orderBy: { fechaInicio: 'desc' },
  })
  if (!ciclo) return (<><Titulo>Resultados del equipo</Titulo><Vacio>No hay ciclos registrados.</Vacio></>)

  const equipo = await prisma.colaborador.findMany({
    where: { jefeId: sesion.colaboradorId, activo: true },
    include: {
      puesto: true,
      resultados: { where: { cicloId: ciclo.id } },
      feedbacks: { where: { cicloId: ciclo.id } },
    },
    orderBy: { apellidos: 'asc' },
  })

  return (
    <>
      <Titulo sub={`${ciclo.nombre} · resultados de tu equipo directo y registro de feedback`}>Resultados del equipo</Titulo>
      <Card titulo="Mi equipo" extra="competencias · objetivos · nota final">
        {equipo.length === 0 ? (
          <Vacio>No tienes colaboradores a cargo.</Vacio>
        ) : (
          <ul className="space-y-2.5">
            {equipo.map((c) => {
              const r = c.resultados[0]
              const f = c.feedbacks[0]
              const nombre = `${c.nombres} ${c.apellidos}`
              const tieneFeedback = Boolean(f?.acuerdos || (Array.isArray(f?.pdi) && f.pdi.length > 0))
              // La sesión de feedback conversa SOBRE los resultados: sin ninguna nota
              // calculada todavía, no hay nada que retroalimentar y el registro se bloquea
              const hayResultados = Boolean(r && (r.notaFinal != null || r.notaCalibrada != null || r.notaCompetencias != null || r.cumplimientoObjetivos != null))
              const formFeedback = hayResultados ? (
                <FormFeedback
                  cicloId={ciclo.id}
                  colaboradorId={c.id}
                  nombre={nombre}
                  acuerdosIniciales={f?.acuerdos ?? ''}
                  pdiInicial={Array.isArray(f?.pdi) ? (f.pdi as { titulo: string; fechaObjetivo?: string }[]) : []}
                />
              ) : (
                <p className="w-full rounded-xl bg-hueso-2 px-3.5 py-2.5 text-center text-xs text-gris md:w-auto md:text-left">
                  El feedback se habilita cuando haya resultados de evaluación
                </p>
              )
              const metricas: [string, ReactNode][] = [
                ['Competencias', <Nota key="c" valor={r?.notaCompetencias} />],
                ['Objetivos', <b key="o" className="font-display text-marca">{r?.cumplimientoObjetivos != null ? `${Math.round(r.cumplimientoObjetivos)}%` : <span className="font-sans font-bold text-gris-claro">—</span>}</b>],
                ['Nota final', <Nota key="n" valor={r ? (r.notaCalibrada ?? r.notaFinal) : null} />],
              ]
              return (
                // Móvil: card vertical con chip de estado del feedback y las notas en celdas
                // centradas — la fila única quedaba apretada contra el borde en 390px.
                // Escritorio: la fila de siempre.
                <li key={c.id} className="rounded-xl border border-gris-claro px-4 py-3">
                  {/* Móvil */}
                  <div className="md:hidden">
                    <div className="flex items-center gap-2">
                      <Avatar nombre={nombre} />
                      <span className={`ml-auto rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ${tieneFeedback ? 'bg-emerald-50 text-emerald-700' : hayResultados ? 'bg-amber-50 text-amber-700' : 'bg-hueso-2 text-gris'}`}>
                        {tieneFeedback ? 'Feedback registrado ✓' : hayResultados ? 'Sin feedback' : 'Sin resultados aún'}
                      </span>
                    </div>
                    <p className="mt-2 text-[14.5px] font-bold leading-snug">{nombre}</p>
                    <p className="mt-0.5 text-xs text-gris">{c.puesto?.nombre ?? ''}</p>
                    <div className="my-2.5 grid grid-cols-3 gap-2">
                      {metricas.map(([etiqueta, valor]) => (
                        <div key={etiqueta} className="rounded-xl border border-hueso-2 bg-hueso/60 px-1 py-2.5 text-center">
                          <p className="text-[9px] font-bold uppercase tracking-wide text-gris">{etiqueta}</p>
                          <p className="mt-0.5 text-[19px] leading-tight">{valor}</p>
                        </div>
                      ))}
                    </div>
                    {formFeedback}
                  </div>

                  {/* Escritorio */}
                  <div className="hidden flex-wrap items-center gap-4 md:flex">
                    <Avatar nombre={nombre} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">{nombre}</p>
                      <p className="text-xs text-gris">{c.puesto?.nombre ?? ''}</p>
                    </div>
                    <div className="flex gap-6 text-center text-sm">
                      {metricas.map(([etiqueta, valor]) => (
                        <div key={etiqueta}><p className="text-[10px] font-bold uppercase text-gris">{etiqueta}</p>{valor}</div>
                      ))}
                    </div>
                    {formFeedback}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      <p className="mt-4 text-xs text-gris">Ves a tu equipo directo. El consolidado de talento (9-Box) es de acceso exclusivo de RR.HH. y la Dirección.</p>
    </>
  )
}
