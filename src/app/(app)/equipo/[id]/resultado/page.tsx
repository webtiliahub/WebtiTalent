import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/shared/lib/prisma'
import { requiereJefe, fueraDeAlcancePais } from '@/shared/lib/permisos'
import { Titulo } from '@/shared/ui/componentes'
import { BotonDescargarPdf, ResultadoColaborador } from '@/features/resultados/ResultadoColaborador'

/** Resultados publicados de un colaborador, consultados por su jefe directo o RR.HH.
 * (mismo guard que su hoja de vida). Se llega desde el historial de evaluaciones. */
export default async function ResultadoEquipoPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ ciclo?: string; desde?: string }>
}) {
  const sesion = await requiereJefe()
  const { id } = await params
  const { ciclo, desde } = await searchParams

  const colaborador = await prisma.colaborador.findUnique({
    where: { id },
    select: { id: true, jefeId: true, paisId: true, nombres: true, apellidos: true },
  })
  if (!colaborador) notFound()
  // Jefe directo, o RR.HH. dentro de su país (RR.HH. de país no ve otro país)
  const puedeVer = colaborador.jefeId === sesion.colaboradorId || (sesion.rol === 'RRHH' && !fueraDeAlcancePais(sesion, colaborador.paisId))
  if (!puedeVer) redirect('/equipo')

  const volverA = desde === 'admin' ? `/admin/colaboradores/${id}` : `/equipo/${id}`
  const hrefBase = `/equipo/${id}/resultado${desde === 'admin' ? '?desde=admin' : ''}`

  return (
    <>
      <Link href={volverA} className="mb-3 inline-block text-sm text-gris hover:text-negro">← Volver a la hoja de vida</Link>
      <Titulo
        sub="Resultados publicados, sesión de feedback y plan de desarrollo"
        accion={<BotonDescargarPdf colaboradorId={colaborador.id} cicloId={ciclo} />}
      >
        Resultados · {colaborador.nombres} {colaborador.apellidos}
      </Titulo>
      <ResultadoColaborador colaboradorId={colaborador.id} cicloParam={ciclo} hrefBase={hrefBase} propio={false} />
    </>
  )
}
