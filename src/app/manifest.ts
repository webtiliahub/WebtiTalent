import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Talent Hub — Hunter',
    short_name: 'Talent Hub',
    // iOS añade de su cosecha un «from <app>» al título de cada notificación web y lo localiza
    // con el idioma del MANIFEST (no con el del <html> ni el del sistema): sin esto salía
    // «Notificaciones activas from Talent Hub» en un iPhone en español
    lang: 'es',
    dir: 'ltr',
    description: 'Plataforma de gestión de desempeño y talento — Hunter',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f4f1',
    theme_color: '#f6f4f1',
    icons: [
      { src: '/iconos/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/iconos/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/iconos/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
