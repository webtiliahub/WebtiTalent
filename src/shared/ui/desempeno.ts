/** Estilos por nivel de desempeño (misma escala que etiquetaNota en domain/calculo). */

/** Colores del badge de la etiqueta de desempeño. */
export function badgeNota(nota: number): string {
  if (nota >= 4.5) return 'bg-gradient-to-r from-amber-300 to-yellow-400 text-amber-900 shadow-sm' // Excepcional (oro)
  if (nota >= 3.5) return 'bg-emerald-600 text-white' // Superior
  if (nota >= 2.5) return 'bg-sky-600 text-white' // Competente
  if (nota >= 1.5) return 'bg-amber-50 text-amber-800' // En desarrollo
  return 'bg-red-50 text-hunter-dark' // Insuficiente
}

/** Tarjeta animada por nivel: oro (excepcional), verde (destacado), azul (sólido); sin efecto hacia abajo. */
export function cardNota(nota: number): string {
  if (nota >= 4.5) return 'card-viva card-oro' // Excepcional
  if (nota >= 3.5) return 'card-viva card-verde' // Superior
  if (nota >= 2.5) return 'card-viva card-azul' // Competente
  return ''
}
