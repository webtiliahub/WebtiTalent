import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/shared/lib/prisma'
import { requiereJefe, fueraDeAlcancePais } from '@/shared/lib/permisos'
import { HojaDeVida } from '@/features/colaboradores/HojaDeVida'
import { Titulo } from '@/shared/ui/componentes'

/** Hoja de vida de un miembro del equipo — solo su jefe directo (o RR.HH.) puede verla. */
export default async function HojaDeVidaEquipoPage({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await requiereJefe()
  const { id } = await params

  const colaborador = await prisma.colaborador.findUnique({ where: { id }, select: { id: true, jefeId: true, paisId: true, nombres: true, apellidos: true } })
  if (!colaborador) notFound()
  // Jefe directo, o RR.HH. dentro de su país (RR.HH. de país no ve otro país)
  const puedeVer = colaborador.jefeId === sesion.colaboradorId || (sesion.rol === 'RRHH' && !fueraDeAlcancePais(sesion, colaborador.paisId))
  if (!puedeVer) redirect('/equipo')

  return (
    <>
      <Link href="/equipo" className="mb-3 inline-block text-sm text-gris hover:text-negro">← Volver a Mi equipo</Link>
      <Titulo>Hoja de vida</Titulo>
      <HojaDeVida colaboradorId={colaborador.id} verComoGestor />
    </>
  )
}
