import type { Viewport } from 'next'
import { requiereSesion } from '@/shared/lib/permisos'
import { prisma } from '@/shared/lib/prisma'
import { FormCambiarPassword } from './FormCambiarPassword'
import { passwordExpirada } from '@/shared/lib/password'

// Fondo negro propio: la barra de estado se tiñe igual para no dejar franja clara arriba
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#2a2623' }

export default async function CambiarPasswordPage() {
  const sesion = await requiereSesion()
  const cuenta = await prisma.usuario.findUnique({ where: { id: sesion.id }, select: { debeCambiarPassword: true, passwordChangedAt: true } })
  const esTemporal = cuenta?.debeCambiarPassword ?? false
  const caducada = passwordExpirada(cuenta?.passwordChangedAt ?? null)
  const forzado = esTemporal || caducada
  // Temporal: no se conoce una contraseña "actual" propia → no se pide. Caducidad o cambio
  // voluntario: sí se exige la actual (evita que una sesión robada se apropie de la cuenta).
  const pideActual = !esTemporal
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-negro">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border border-hunter/25 [animation-duration:4s]" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[340px] w-[340px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-hunter/15" />

      <div className="relative w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="font-display text-3xl font-extrabold tracking-tight">
            <span className="text-hunter">●</span> Hunter
          </div>
          <p className="mt-1 text-xs uppercase tracking-[0.25em] text-gris">Evaluación de Desempeño 360</p>
        </div>
        <h1 className="font-display text-lg font-bold">{forzado ? 'Crea tu contraseña' : 'Cambiar contraseña'}</h1>
        <p className="mb-4 mt-1 text-sm text-gris">
          Hola, <b className="text-negro">{sesion.name}</b>.{' '}
          {esTemporal ? 'Tu contraseña actual es temporal: define una nueva para continuar.' : caducada ? 'Tu contraseña venció (política de 6 meses): define una nueva para continuar.' : 'Define una nueva contraseña; deberás iniciar sesión otra vez.'}
        </p>
        <FormCambiarPassword forzado={forzado} pideActual={pideActual} />
      </div>
    </div>
  )
}
