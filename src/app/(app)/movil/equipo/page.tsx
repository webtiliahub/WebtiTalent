import { redirect } from 'next/navigation'
import { requiereSesion } from '@/shared/lib/permisos'
import { armarGrupos } from '@/shared/lib/navegacion'
import { HubCards } from '@/shared/ui/HubCards'
import { Titulo } from '@/shared/ui/componentes'

export default async function HubEquipoPage() {
  const sesion = await requiereSesion()
  const grupo = armarGrupos(sesion).find((g) => g.titulo === 'Mi equipo')
  if (!grupo) redirect('/hoja-de-vida')
  return (
    <>
      <Titulo sub="Gestiona los objetivos y evaluaciones de tu gente">Mi equipo</Titulo>
      <HubCards items={grupo.items} />
    </>
  )
}
