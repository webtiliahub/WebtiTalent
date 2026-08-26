export const dynamic = 'force-static'

/** Página de cortesía sin conexión (servida por el service worker cuando una navegación falla).
 * Estilos INLINE a propósito: offline el CSS hasheado de /_next/static puede no estar disponible
 * (evicción o deploy posterior), así que la página no depende de ninguna hoja externa. */
export default function OfflinePage() {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#f7f5f2', padding: '0 24px', textAlign: 'center', fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo/hunter-iso-red.png" alt="Hunter" style={{ margin: '0 auto', height: 48, objectFit: 'contain', display: 'block' }} />
        <h1 style={{ marginTop: 16, fontSize: 20, fontWeight: 800, color: '#17130f' }}>Sin conexión</h1>
        <p style={{ marginTop: 4, fontSize: 14, color: '#8a857f' }}>Revisa tu red e inténtalo de nuevo.</p>
        <a href="/" style={{ marginTop: 20, display: 'inline-block', background: '#f0163e', color: '#ffffff', padding: '10px 20px', borderRadius: 12, fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>Reintentar</a>
      </div>
    </main>
  )
}
