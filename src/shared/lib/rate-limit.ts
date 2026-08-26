import { prisma } from './prisma'

/**
 * Rate limiting de ventana fija, respaldado en BD (persistente entre instancias serverless).
 * Devuelve `true` si la solicitud está permitida, `false` si excede el máximo en la ventana.
 * Ante cualquier fallo de BD, permite (fail-open): el rate limit no debe tumbar el login.
 */
export async function permitido(clave: string, max: number, ventanaMs: number): Promise<boolean> {
  return (await contarIntento(clave, max, ventanaMs)).permitido
}

/** Como `permitido`, pero además distingue si ESTE intento es exactamente el que cruza el umbral
 *  (`recienCruzado`): lo necesita quien emite UNA señal de auditoría por ráfaga —p.ej.
 *  LOGIN_CUENTA_MUCHOS_FALLOS—, no una por cada intento posterior al cruce (un spray de 5.000
 *  intentos escribía ~4.990 eventos de detección, retenidos 365 días). Fail-open sin cruce:
 *  un fallo de la base no debe fabricar eventos fantasma. */
export async function contarIntento(clave: string, max: number, ventanaMs: number): Promise<{ permitido: boolean; recienCruzado: boolean }> {
  try {
    /* Una sola sentencia ATÓMICA. Antes eran tres pasos —leer, comparar, escribir— y una ráfaga
       concurrente los leía todos con el mismo contador: el techo declarado (60/10min) no era un
       techo bajo concurrencia, que es precisamente cuando importa. Postgres resuelve el conflicto
       de clave y devuelve el contador ya incrementado, así que la comparación es sobre el valor
       real. Mismo criterio atómico que el reclamo de intentos del 2FA en auth.ts. */
    const filas = await prisma.$queryRaw<{ hits: number }[]>`
      INSERT INTO "RateLimit" ("clave", "hits", "reinicia")
      VALUES (${clave}, 1, now() + (${ventanaMs}::double precision * interval '1 millisecond'))
      ON CONFLICT ("clave") DO UPDATE SET
        "hits" = CASE WHEN "RateLimit"."reinicia" <= now() THEN 1 ELSE "RateLimit"."hits" + 1 END,
        "reinicia" = CASE WHEN "RateLimit"."reinicia" <= now()
          THEN now() + (${ventanaMs}::double precision * interval '1 millisecond')
          ELSE "RateLimit"."reinicia" END
      RETURNING "hits"
    `
    const hits = filas[0]?.hits ?? 1
    return { permitido: hits <= max, recienCruzado: hits === max + 1 }
  } catch {
    // Fail-open deliberado: el rate limit no debe tumbar el login. Queda en los logs para que un
    // fallo sostenido de la base —que desactivaría todos los límites— no pase inadvertido.
    console.error('[rate-limit] no se pudo contabilizar', clave.split(':')[0])
    return { permitido: true, recienCruzado: false }
  }
}

/** Pone a cero un contador. Lo usa el login al validar la contraseña: los intentos fallidos de una
 *  cuenta no deben acumularse contra su dueño legítimo cuando por fin entra bien. */
export async function reiniciarContador(clave: string): Promise<void> {
  try {
    await prisma.rateLimit.deleteMany({ where: { clave } })
  } catch {
    // Si no se puede borrar, el contador caduca solo al vencer su ventana
  }
}

/** Borra los contadores ya vencidos. Lo llama el cron diario: la tabla solo crecía, y su clave
 *  incluye la IP, así que un barrido de IPs dejaba una fila permanente por cada una. */
export async function purgarRateLimitVencidos(): Promise<number> {
  const { count } = await prisma.rateLimit.deleteMany({ where: { reinicia: { lt: new Date() } } })
  return count
}

/**
 * IP del cliente. Se prefiere `x-vercel-forwarded-for`, que la escribe la plataforma y el cliente
 * no puede fijar. De `x-forwarded-for` se toma el ÚLTIMO salto y no el primero: el primero es el
 * valor que el cliente envió (falsificable, y con él se anulan todos los límites usando una IP
 * distinta en cada intento); el último es el que añadió el proxy de confianza.
 * Además se valida la forma y se acota la longitud, porque este valor es la CLAVE PRIMARIA de la
 * tabla de contadores: sin eso, una cabecera arbitraria escribía filas de basura sin límite.
 */
export function ipDe(req: Request): string {
  const dePlataforma = req.headers.get('x-vercel-forwarded-for')
  const cadena = req.headers.get('x-forwarded-for')
  const ultimoSalto = cadena?.split(',').pop()?.trim()
  const candidata = dePlataforma?.trim() || ultimoSalto || req.headers.get('x-real-ip')?.trim()
  if (!candidata || !/^[0-9a-fA-F.:]{3,45}$/.test(candidata)) return 'desconocida'
  return candidata
}
