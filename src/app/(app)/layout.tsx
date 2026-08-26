import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/shared/lib/prisma'
import { requiereSesion } from '@/shared/lib/permisos'
import { armarGrupos, resolverNavMovil } from '@/shared/lib/navegacion'
import { Shell } from '@/shared/ui/Shell'
import { ConfirmacionHost } from '@/shared/ui/Confirmacion'
import { ToastHost } from '@/shared/ui/Toast'
import { passwordExpirada } from '@/shared/lib/password'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sesion = await requiereSesion()
  const esAdmin = Object.keys(sesion.permisosAdmin).length > 0

  // Este layout corre en CADA navegación: sus consultas van en PARALELO (en serie sumaban
  // hasta 3 viajes a la BD antes de pintar nada — el grueso del delay al alternar pestañas
  // en móvil). Contraseña temporal: flag en BD (no en el JWT) para que un reset aplique al
  // instante; países y conteo del equipo solo cuando el rol los usa.
  const [cuenta, jar, paises, equipoN] = await Promise.all([
    prisma.usuario.findUnique({ where: { id: sesion.id }, select: { debeCambiarPassword: true, passwordChangedAt: true } }),
    cookies(),
    esAdmin ? prisma.pais.findMany({ orderBy: { codigo: 'asc' } }) : Promise.resolve([]),
    sesion.esJefe ? prisma.colaborador.count({ where: { jefeId: sesion.colaboradorId, activo: true } }) : Promise.resolve(null),
  ])
  // Fuerza el cambio por contraseña temporal o por caducidad (6 meses, pedido de Hunter)
  if (cuenta?.debeCambiarPassword || passwordExpirada(cuenta?.passwordChangedAt ?? null)) redirect('/cambiar-password')
  const paisActual = jar.get('pais')?.value ?? null

  const grupos = armarGrupos(sesion)
  const esRrhhRegional = esAdmin && sesion.alcanceRrhh === 'REGIONAL'

  // Chip de alcance: solo cuando dice algo (equipo del jefe, país del RR.HH.).
  // Para un colaborador raso su alcance es él mismo y el chip sería ruido.
  let alcanceLabel: string | null = null
  if (equipoN !== null) alcanceLabel = `Mi equipo · ${equipoN}`
  if (sesion.rol === 'RRHH' && sesion.alcanceRrhh === 'PAIS' && sesion.alcancePaisId) {
    const p = paises.find((x) => x.id === sesion.alcancePaisId)
    alcanceLabel = `${p?.nombre ?? 'País'} (RR.HH.)`
  }

  const rolLabel = sesion.rol === 'RRHH'
    ? (sesion.alcanceRrhh === 'REGIONAL' ? 'RR.HH. Regional' : 'RR.HH. de país')
    : sesion.esJefe ? 'Jefe de equipo' : 'Colaborador'

  return (
    <Shell
      grupos={grupos}
      navMovil={resolverNavMovil(grupos)}
      nombre={sesion.name}
      rolLabel={rolLabel}
      alcanceLabel={alcanceLabel}
      paises={paises}
      paisActual={paisActual}
      esRrhhRegional={esRrhhRegional}
    >
      {children}
      <ConfirmacionHost />
      <ToastHost />
    </Shell>
  )
}
