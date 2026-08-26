import { NextResponse, after } from 'next/server'
import bcrypt from 'bcryptjs'
import { createHash, randomInt } from 'crypto'
import { prisma } from '@/shared/lib/prisma'
import { enviarCodigo2FA } from '@/shared/lib/mailer'
import { contarIntento, permitido, ipDe, reiniciarContador } from '@/shared/lib/rate-limit'

// Hash bcrypt señuelo (de una contraseña aleatoria) para gastar el mismo tiempo cuando el
// usuario no existe/está inactivo. Constante en módulo: nunca coincide con una contraseña real.
const HASH_SENUELO = '$2b$10$nCECP.r5EGDvICX8ozX70uaFIEA6feu7j1kT/NMKMMjZlHL9Pxk.q'

/**
 * Paso 1 del login: valida email + contraseña (bcrypt) y envía código 2FA por correo.
 * Respuesta genérica ante credenciales inválidas (no revela si el correo existe).
 */
const RESP_429 = () => NextResponse.json({ ok: false, error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }, { status: 429 })

export async function POST(req: Request) {
  // Límite por IP (antes de tocar la BD de usuarios): frena fuerza bruta y credential stuffing.
  // Holgado (60/10min) para no bloquear a toda una oficina tras un mismo NAT el día de alta masiva;
  // el límite real anti-abuso es el de emisión por cuenta más abajo.
  if (!(await permitido(`solicitar:ip:${ipDe(req)}`, 60, 10 * 60 * 1000))) return RESP_429()

  const { email, password } = await req.json().catch(() => ({}))
  // Tope de tamaño ANTES de tocar nada: este endpoint es anónimo y el `correo` acaba en el
  // AuditLog de cada intento fallido. Sin esto, un email de 4 MB escribía 4 MB por petición en el
  // log —retenido un año— y además pasaba por bcrypt.compare. 254 es el máximo real de un correo.
  if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 200) {
    return NextResponse.json({ ok: false, error: 'Solicitud inválida' }, { status: 400 })
  }
  const correo = email.toLowerCase().trim()

  const usuario = await prisma.usuario.findUnique({ where: { email: correo } })
  const respuestaGenerica = NextResponse.json({ ok: false, error: 'Correo o contraseña incorrectos' }, { status: 401 })

  /* Tope de contraseñas falladas POR CUENTA. El límite por IP solo (60/10min) dejaba pulverizar
     contraseñas: una equivocada no contaba para nada, así que con unas pocas IPs se probaba un
     diccionario contra las ~800 cuentas. El 2FA tapa la entrada, pero lo que se cosecha —un par
     correo corporativo + contraseña válida— sirve en O365 o en la VPN, que es donde duele.
     La clave va HASHEADA para no dejar el padrón de correos en una tabla auxiliar, y al agotarse
     se responde el MISMO 401 genérico, nunca un 429: un 429 aquí delataría qué correos existen,
     que es justo lo que el resto de este endpoint se esfuerza en ocultar. */
  const claveFallos = `pwdfail:${createHash('sha256').update(correo).digest('hex').slice(0, 32)}`

  // Constante en tiempo: siempre se ejecuta un bcrypt.compare (contra un hash señuelo si el
  // usuario no existe o está inactivo) para no revelar por latencia qué correos son válidos.
  const hashComparar = usuario?.activo ? usuario.passwordHash : HASH_SENUELO
  const valida = await bcrypt.compare(password, hashComparar)
  const credencialesOk = Boolean(usuario && usuario.activo && valida)

  /* Rastro de accesos: sin él, un «yo no calificé así a mi equipo» no se puede investigar (no hay
     forma de saber desde qué IP ni cuándo se abrió esa sesión, ni si alguien estuvo probando
     contraseñas). Se registra tras responder para no añadir latencia. */
  const registrar = (accion: string, detalle: Record<string, unknown>) => {
    after(() =>
      prisma.auditLog.create({
        data: { usuarioId: usuario?.id ?? null, accion, detalle: { correo, ip: ipDe(req), ...detalle } },
      }).catch(() => {}),
    )
  }

  /* Contador de fallos POR CUENTA. La contraseña CORRECTA siempre pasa y limpia el contador; los
     fallos solo se CUENTAN. Un tope que además bloqueara reintroduciría el apagón de login (bastaba
     agotar el cupo con contraseñas basura para dejar fuera a la víctima), así que aquí el contador
     NO previene: DETECTA. Al superar el umbral se registra un evento propio —una sola vez por
     ventana— para que la pulverización dirigida contra una cuenta salte en auditoría; la prevención
     real la dan el tope por IP y el 2FA obligatorio. */
  if (!credencialesOk) {
    const fallos = await contarIntento(claveFallos, 10, 15 * 60 * 1000)
    registrar('LOGIN_FALLIDO', {
      motivo: !usuario ? 'correo inexistente' : !usuario.activo ? 'cuenta inactiva' : 'contraseña incorrecta',
    })
    // El evento de detección se emite SOLO en el intento que cruza el umbral (el 11), no en cada
    // fallo posterior: una señal por ráfaga, no ruido — un spray de 5.000 intentos escribía
    // ~4.990 eventos de detección retenidos 365 días
    if (fallos.recienCruzado && usuario) registrar('LOGIN_CUENTA_MUCHOS_FALLOS', { umbral: 10 })
    return respuestaGenerica
  }
  await reiniciarContador(claveFallos)
  if (!usuario) return respuestaGenerica // inalcanzable (credencialesOk lo garantiza); estrecha el tipo

  // Límite de EMISIÓN por cuenta (solo tras validar la contraseña, así no es un oráculo de
  // enumeración): frena el email-bombing y el ciclo emitir-código→fuerza-bruta sobre una víctima.
  if (!(await permitido(`solicitar:email:${correo}`, 5, 15 * 60 * 1000))) return RESP_429()

  registrar('LOGIN_CODIGO_EMITIDO', {})

  // Invalidar códigos previos y emitir uno nuevo (10 minutos, un solo uso)
  const codigo = String(randomInt(100000, 1000000))
  const codigoHash = createHash('sha256').update(codigo).digest('hex')
  await prisma.$transaction([
    prisma.codigo2FA.updateMany({ where: { usuarioId: usuario.id, usado: false }, data: { usado: true } }),
    prisma.codigo2FA.create({
      data: { usuarioId: usuario.id, codigoHash, expiraEn: new Date(Date.now() + 10 * 60 * 1000) },
    }),
  ])
  await enviarCodigo2FA(usuario.email, codigo)

  return NextResponse.json({ ok: true })
}
