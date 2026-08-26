import { redirect } from 'next/navigation'
import { getSesion } from '@/shared/lib/auth'

export default async function Home() {
  const sesion = await getSesion()
  redirect(sesion ? '/hoja-de-vida' : '/login')
}
