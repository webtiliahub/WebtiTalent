/** Esqueleto instantáneo entre navegaciones (App Router lo muestra mientras el servidor arma
 * la página). Sin él, en móvil la pantalla queda congelada 1-4 s sin ninguna señal y la
 * navegación se siente rota — el feedback inmediato es la mitad de la velocidad percibida. */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-5" aria-label="Cargando…" role="status">
      <div>
        <div className="h-7 w-48 rounded-lg bg-hueso-2" />
        <div className="mt-2 h-4 w-72 max-w-full rounded-lg bg-hueso-2/70" />
      </div>
      <div className="h-36 rounded-2xl border border-gris-claro/60 bg-white/70" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <div className="h-28 rounded-2xl border border-gris-claro/60 bg-white/70" />
        <div className="h-28 rounded-2xl border border-gris-claro/60 bg-white/70" />
        <div className="hidden h-28 rounded-2xl border border-gris-claro/60 bg-white/70 md:block" />
      </div>
      <div className="h-64 rounded-2xl border border-gris-claro/60 bg-white/70" />
    </div>
  )
}
