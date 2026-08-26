import { requiereSesion } from '@/shared/lib/permisos'
import { armarGrupos } from '@/shared/lib/navegacion'
import { HubCards } from '@/shared/ui/HubCards'
import { Titulo } from '@/shared/ui/componentes'

export default async function HubLoMioPage() {
  const sesion = await requiereSesion()
  const grupo = armarGrupos(sesion).find((g) => g.titulo === 'Lo mío')!
  return (
    <>
      <Titulo sub="Tu desempeño, objetivos y evaluaciones">Lo mío</Titulo>
      <HubCards items={grupo.items} />
    </>
  )
}
