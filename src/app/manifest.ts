import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'WebtiTalent — Webtilia',
    short_name: 'WebtiTalent',
    // iOS añade de su cosecha un «from <app>» al título de cada notificación web y lo localiza
    // con el idioma del MANIFEST (no con el del <html> ni el del sistema): sin esto salía
    // «Notificaciones activas from WebtiTalent» en un iPhone en español
    lang: 'es',
    dir: 'ltr',
    description: 'Plataforma de gestión de desempeño y talento — Webtilia',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f4f1',
    theme_color: '#f6f4f1',
    icons: [
      { src: '/iconos/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/iconos/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/iconos/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
