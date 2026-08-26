import type { Viewport } from 'next'

/** El login pinta su propio degradado claro: la barra de estado del teléfono debe teñirse del
 * color superior del degradado (no del hueso global) para que el fondo llegue al borde del
 * dispositivo sin franja. page.tsx es client component, por eso el viewport vive aquí. */
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#f6f4f1' }

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
