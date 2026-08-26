import type { Viewport } from 'next'

// Misma pantalla clara del login: la barra de estado se tiñe del tope del degradado
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#f6f4f1' }

export default function RestablecerLayout({ children }: { children: React.ReactNode }) {
  return children
}
