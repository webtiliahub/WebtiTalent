/** Franja de cortesía para funciones exclusivas de escritorio (importadores):
 * visible solo en móvil, no bloquea. Decisión de Christian (spec 2026-08-10 §8). */
export function AvisoSoloEscritorio() {
  return (
    <p className="mb-4 rounded-xl bg-sky-50 px-3.5 py-2.5 text-xs font-semibold text-sky-800 md:hidden">
      Esta función se usa desde una computadora.
    </p>
  )
}
