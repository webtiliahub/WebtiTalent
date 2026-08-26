import type { NextConfig } from "next";

/**
 * Cabeceras de seguridad. Hasta ahora la app no servía ninguna propia: lo único presente era el
 * HSTS que añade Vercel, así que el login se podía embutir en un iframe de cualquier sitio
 * (clickjacking) y no había ninguna barrera si algún día entra un XSS.
 *
 * Sobre la CSP: `script-src` lleva 'unsafe-inline' porque Next inyecta scripts en línea para
 * hidratar (la alternativa es un nonce por petición, que exige middleware; se puede hacer más
 * adelante). Aun con eso, las directivas que de verdad cierran vectores concretos SÍ aplican:
 * `frame-ancestors` (clickjacking), `form-action` (no se pueden desviar los formularios de login),
 * `base-uri` (no se puede reescribir la base de las URLs relativas) y `object-src`.
 *
 * Solo en producción: en desarrollo, Turbopack y el refresco en caliente necesitan `eval`, y una
 * CSP aquí rompería el dev server sin proteger a nadie.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  // Las fuentes van auto-hospedadas por next/font; data: cubre los iconos y el logo incrustado
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "worker-src 'self'", // el service worker de la PWA
  "manifest-src 'self'",
].join('; ')

const CABECERAS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  ...(process.env.NODE_ENV === 'production' ? [{ key: 'Content-Security-Policy', value: CSP }] : []),
]

const nextConfig: NextConfig = {
  // Quita el `x-powered-by: Next.js`: no protege de nada por sí solo, pero tampoco hay motivo
  // para anunciar la versión del framework
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: CABECERAS }]
  },
};

export default nextConfig;
