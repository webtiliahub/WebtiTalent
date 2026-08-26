/**
 * Guarda de host para los scripts de `prisma/`. Los que BORRAN (purga, limpieza) ya exigían una
 * variable explícita, pero los que SIEMBRAN no comprobaban nada: un `npx tsx prisma/seed.ts` con el
 * .env de producción cargado por error creaba cuentas con una contraseña conocida —publicada en el
 * README— dentro de la base de los ~800 colaboradores, y con correos del dominio real, así que no
 * habrían destacado en un listado.
 *
 * Uso: `exigirBaseLocal('seed')` como primera línea del script.
 */

/** host:puerto/base, sin credenciales ni parámetros: lo que hay que ver antes de confirmar. */
export function baseObjetivo(): string {
  return process.env.DATABASE_URL?.split('@')[1]?.split('?')[0] ?? '(desconocida)'
}

export function esBaseLocal(): boolean {
  const destino = baseObjetivo()
  return destino.startsWith('localhost') || destino.startsWith('127.0.0.1') || destino.startsWith('[::1]')
}

/** Aborta si la base no es local, salvo que se confirme explícitamente con CONFIRMAR_PROD=SI. */
export function exigirBaseLocal(nombreScript: string): void {
  if (esBaseLocal() || process.env.CONFIRMAR_PROD === 'SI') return
  console.error(
    `\n⛔ «${nombreScript}» escribe en la base de datos y la base apuntada NO es local:\n` +
    `   ${baseObjetivo()}\n\n` +
    `   Si de verdad es lo que quieres, repite con CONFIRMAR_PROD=SI.\n`,
  )
  process.exit(1)
}
