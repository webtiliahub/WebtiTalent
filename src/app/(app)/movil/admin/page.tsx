import { redirect } from 'next/navigation'
import { requiereSesion } from '@/shared/lib/permisos'
import { armarGrupos } from '@/shared/lib/navegacion'
import { HubCards } from '@/shared/ui/HubCards'
import { Titulo } from '@/shared/ui/componentes'

export default async function HubAdminPage() {
  const sesion = await requiereSesion()
  const grupo = armarGrupos(sesion).find((g) => g.titulo === 'Administración')
  if (!grupo) redirect('/hoja-de-vida')
  return (
    <>
      <Titulo sub="Secciones habilitadas según tu rol">Administración</Titulo>
      <HubCards items={grupo.items} />
    </>
  )
}
