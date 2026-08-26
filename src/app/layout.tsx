import type { Metadata, Viewport } from 'next'
import { Raleway, Roboto } from 'next/font/google'
import { RegistrarSW } from '@/shared/ui/RegistrarSW'
import './globals.css'

const raleway = Raleway({ subsets: ['latin'], variable: '--font-display', weight: ['400', '500', '600', '700', '800'] })
const roboto = Roboto({ subsets: ['latin'], variable: '--font-body', weight: ['300', '400', '500', '700'] })

export const metadata: Metadata = {
  title: 'Talent Hub · Hunter',
  description: 'Plataforma de gestión de desempeño y talento — Hunter',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Talent Hub', statusBarStyle: 'default' },
  // Sin un `icon` declarado, el navegador pide /favicon.ico por su cuenta y recibía un 404 en cada
  // carga (visible en la consola de cualquiera que abriera DevTools). Se declara el PNG de 32 px
  // derivado del mismo icono de la PWA, en vez de añadir un .ico: un PNG renombrado a .ico dejaría
  // de renderizar ahora que se sirve `X-Content-Type-Options: nosniff`.
  icons: {
    icon: [{ url: '/iconos/favicon-32.png', sizes: '32x32', type: 'image/png' }],
    apple: '/iconos/apple-touch-icon.png',
  },
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#f6f4f1' }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${raleway.variable} ${roboto.variable} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <RegistrarSW />
      </body>
    </html>
  )
}
