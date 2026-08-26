import { requiereSesion } from '@/shared/lib/permisos'
import { HojaDeVida } from '@/features/colaboradores/HojaDeVida'
import { Titulo, Vacio } from '@/shared/ui/componentes'

export default async function MiHojaDeVidaPage() {
  const sesion = await requiereSesion()
  return (
    <>
      <Titulo sub="Tu información, competencias y trayectoria en Hunter">Mi hoja de vida</Titulo>
      {/* Cuenta sin colaborador vinculado (p. ej. tras una purga de carga inicial, antes de
      re-vincular por correo): no hay ficha propia que mostrar. */}
      {sesion.colaboradorId
        ? <HojaDeVida colaboradorId={sesion.colaboradorId} /> // hoja propia: sin datos confidenciales (9-Box)
        : <Vacio>Tu cuenta no tiene un colaborador vinculado todavía.</Vacio>}
    </>
  )
}
