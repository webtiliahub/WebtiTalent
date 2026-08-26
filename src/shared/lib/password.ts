import { z } from 'zod'

/** Política de contraseñas de la plataforma — ÚNICA fuente de verdad, compartida por el cambio
 * forzado/voluntario (cambiarMiPassword) y el restablecimiento self-service. Si la política
 * cambia, cambia aquí para que ningún flujo diverja. */
/** Palabras que no deben aparecer en una contraseña: las más comunes y el nombre de la empresa.
 *  El botín peligroso de un login es el par correo+contraseña reutilizable en O365/VPN, donde no
 *  hay 2FA de Hunter — de ahí que valga endurecer aunque el 2FA cubra la entrada a la plataforma. */
const PALABRAS_PROHIBIDAS = ['password', 'contrasena', 'contraseña', '12345678', 'qwerty', 'webtitalent', 'webtilia', 'admin']

/** Longitud mínima — exportada para que los formularios (minLength y copy) no diverjan del esquema. */
export const PASSWORD_MIN_CARACTERES = 10

export const esquemaPasswordNueva = z
  .string()
  .min(PASSWORD_MIN_CARACTERES, `Mínimo ${PASSWORD_MIN_CARACTERES} caracteres`)
  // bcrypt trunca a 72 bytes, pero bcryptjs recorre TODA la cadena en UTF-8 antes: sin tope, una
  // contraseña de 100 MB en el restablecimiento (endpoint con token, pero repetible) quema CPU
  .max(128, 'Máximo 128 caracteres')
  .regex(/[A-Za-z]/, 'Debe incluir letras')
  .regex(/[0-9]/, 'Debe incluir al menos un número')
  .superRefine((valor, ctx) => {
    const bajo = valor.toLowerCase()
    if (PALABRAS_PROHIBIDAS.some((w) => bajo.includes(w))) {
      ctx.addIssue({ code: 'custom', message: 'No uses palabras comunes ni el nombre de la empresa' })
    }
  })


/** Contraseña caduca a los 6 meses (política heredada del diseño original). Se compara contra passwordChangedAt. */
export const PASSWORD_EXPIRA_DIAS = 180

export function passwordExpirada(passwordChangedAt: Date | null): boolean {
  if (!passwordChangedAt) return false // nunca cambiada (cuenta muy nueva): no forzar por antigüedad
  const vence = passwordChangedAt.getTime() + PASSWORD_EXPIRA_DIAS * 24 * 60 * 60 * 1000
  return Date.now() > vence
}
