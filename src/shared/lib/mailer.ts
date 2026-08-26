/**
 * Servicio de correo. El transporte se elige por variables de entorno, en este orden:
 * 1. SMTP_HOST definida → SMTP (go-live: el Office365 de Hunter TI, SPF/DKIM propios del dominio).
 *    Variables: SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, SMTP_FROM.
 * 2. RESEND_API_KEY definida → Resend (puente temporal de Webtilia durante el desarrollo),
 *    con el remitente de RESEND_FROM.
 * 3. Ninguna (desarrollo local) → imprime a consola. En producción sin transporte: LANZA.
 * Todos los correos salen en HTML (plantilla de marca) + texto plano como fallback.
 */
import type { Transporter } from 'nodemailer'
import { LOGO_CORREO_B64, LOGO_CORREO_CID } from './logo-correo'

// URL base de los correos (logo, botones CTA). Prioridad: APP_URL explícita (permite un dominio
// propio a futuro) → NEXTAUTH_URL → el dominio de producción que Vercel inyecta solo
// (VERCEL_PROJECT_PRODUCTION_URL, sin protocolo) → localhost en desarrollo. Sin este fallback de
// Vercel, en prod (donde no hay APP_URL/NEXTAUTH_URL) el logo y los enlaces apuntaban a localhost.
const URL_APP =
  process.env.APP_URL ??
  process.env.NEXTAUTH_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined) ??
  'http://localhost:3001'

// Caer en localhost es lo correcto en desarrollo y un fallo GRAVE y silencioso en producción:
// los correos salen igual, con todos los botones apuntando a una máquina que el destinatario no
// tiene. Pasó semanas sin detectarse (VERCEL_PROJECT_PRODUCTION_URL no llegaba al runtime), así
// que ahora queda constancia en los logs de Vercel: se arregla definiendo APP_URL.
if (process.env.VERCEL_ENV === 'production' && URL_APP.includes('localhost')) {
  console.error(
    '[mailer] ¡ATENCIÓN! En producción la URL base de los correos es ' + URL_APP +
    ': todos los botones y enlaces son inservibles para quien los reciba. Define APP_URL en Vercel.',
  )
}

// ───────────── Transporte SMTP (Office365 de Hunter TI) ─────────────

const smtpConfigurado = () => Boolean(process.env.SMTP_HOST)

/** Transporter con pool reutilizado entre invocaciones de la misma lambda. Office365: host
 * smtp.office365.com, puerto 587 con STARTTLS (secure solo en 465). OJO límites de O365 con
 * SMTP AUTH: ~30 mensajes/minuto y 10.000 destinatarios/día — una apertura masiva (~800
 * correos) sale, pero tarda; el pool con 2 conexiones evita que el servidor nos rebote. */
let transporterSmtp: Transporter | null = null
async function smtp(): Promise<Transporter> {
  if (!transporterSmtp) {
    const nodemailer = (await import('nodemailer')).default
    const puerto = Number(process.env.SMTP_PORT ?? 587)
    transporterSmtp = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: puerto,
      secure: puerto === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      pool: true,
      maxConnections: 2,
      maxMessages: 50,
    })
  }
  return transporterSmtp
}

const fromSmtp = () => process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'Talent Hub'

/**
 * En desarrollo sin transporte (ni SMTP ni Resend): imprime el correo a consola y devuelve true
 * (corta el envío). En producción sin transporte: LANZA — nunca imprime códigos 2FA ni
 * contraseñas temporales a los logs.
 */
function modoConsola(linea: string): boolean {
  if (smtpConfigurado() || process.env.RESEND_API_KEY) return false
  if (process.env.NODE_ENV !== 'production') { console.log(linea); return true }
  throw new Error('Sin transporte de correo (SMTP_HOST o RESEND_API_KEY): no se puede enviar')
}

/** Adjunto inline del logo para nodemailer (la plantilla lo referencia con cid:). */
const adjuntoLogoSmtp = () => ({ filename: 'hunter.png', content: Buffer.from(LOGO_CORREO_B64, 'base64'), cid: LOGO_CORREO_CID })
/** Mismo adjunto para la API de Resend (content_id = inline). */
const adjuntoLogoResend = () => ({ filename: 'hunter.png', content: LOGO_CORREO_B64, content_id: LOGO_CORREO_CID })

async function enviar(email: string, asunto: string, texto: string, html?: string) {
  const apiKey = process.env.RESEND_API_KEY
  if (modoConsola(`\n📧 [${asunto}] Para ${email}:\n${texto}\n`)) return
  if (smtpConfigurado()) {
    const t = await smtp()
    await t.sendMail({ from: fromSmtp(), to: email, subject: asunto, text: texto, ...(html ? { html, attachments: [adjuntoLogoSmtp()] } : {}) })
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM ?? 'Talent Hub <onboarding@resend.dev>',
      to: [email],
      subject: asunto,
      text: texto,
      ...(html ? { html, attachments: [adjuntoLogoResend()] } : {}),
    }),
  })
  if (!res.ok) {
    const detalle = await res.text().catch(() => '')
    console.error(`[mailer] Resend respondió ${res.status}: ${detalle}`)
    throw new Error('No se pudo enviar el correo')
  }
}

/** Correo ya construido (asunto/texto/html listos) — lo que produce cada `construirX` y consume
 * `enviarBatch`. Separar "construir" de "enviar" permite que el cron arme muchos correos y los
 * despache en lotes, sin duplicar plantillas. */
export type CorreoConstruido = { to: string; asunto: string; texto: string; html: string }

/** Límite de Resend para POST /emails/batch: máximo 100 correos por request. */
const TAMANO_CHUNK_BATCH = 100

/** Envía muchos correos vía la batch API de Resend (hasta 100 por request — ver
 * `TAMANO_CHUNK_BATCH`), partiendo `correos` en chunks. Un chunk que falla (HTTP no-2xx o
 * excepción de red) NO frena los demás: sus N correos se suman a `fallidos` con una muestra del
 * error, y el resto de chunks se sigue procesando. En modo consola no llega a Resend: imprime el
 * conteo y una muestra (sin cuerpos completos) y devuelve todo como enviado. */
export async function enviarBatch(correos: CorreoConstruido[]): Promise<{ enviados: number; fallidos: number; erroresMuestra: string[] }> {
  if (correos.length === 0) return { enviados: 0, fallidos: 0, erroresMuestra: [] }
  const apiKey = process.env.RESEND_API_KEY
  const muestra = correos.slice(0, 3).map((c) => `${c.asunto} → ${c.to}`).join(' | ')
  if (modoConsola(`\n📧 [Batch] ${correos.length} correo(s) — muestra: ${muestra}\n`)) {
    return { enviados: correos.length, fallidos: 0, erroresMuestra: [] }
  }
  // SMTP no tiene batch API: se envía secuencial sobre el pool; un correo que falla no frena
  // a los demás (mismo contrato de conteos que la ruta Resend).
  if (smtpConfigurado()) {
    const t = await smtp()
    let enviados = 0
    let fallidos = 0
    const erroresMuestra: string[] = []
    for (const c of correos) {
      try {
        await t.sendMail({ from: fromSmtp(), to: c.to, subject: c.asunto, text: c.texto, html: c.html, attachments: [adjuntoLogoSmtp()] })
        enviados++
      } catch (e) {
        fallidos++
        console.error(`[mailer] Falló SMTP a ${c.to}:`, e)
        if (erroresMuestra.length < 10) erroresMuestra.push(String(e).slice(0, 200))
      }
    }
    return { enviados, fallidos, erroresMuestra }
  }
  const from = process.env.RESEND_FROM ?? 'Talent Hub <onboarding@resend.dev>'
  let enviados = 0
  let fallidos = 0
  const erroresMuestra: string[] = []
  for (let i = 0; i < correos.length; i += TAMANO_CHUNK_BATCH) {
    const chunk = correos.slice(i, i + TAMANO_CHUNK_BATCH)
    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk.map((c) => ({ from, to: [c.to], subject: c.asunto, text: c.texto, html: c.html, attachments: [adjuntoLogoResend()] }))),
      })
      if (!res.ok) {
        const detalle = await res.text().catch(() => '')
        console.error(`[mailer] Resend batch respondió ${res.status}: ${detalle}`)
        fallidos += chunk.length
        if (erroresMuestra.length < 10) erroresMuestra.push(`HTTP ${res.status}: ${detalle.slice(0, 200)}`)
        continue
      }
      enviados += chunk.length
    } catch (e) {
      console.error('[mailer] Falló el envío de un chunk batch:', e)
      fallidos += chunk.length
      if (erroresMuestra.length < 10) erroresMuestra.push(String(e).slice(0, 200))
    }
  }
  return { enviados, fallidos, erroresMuestra }
}

// ───────────── Plantilla HTML (email-safe: tablas + estilos inline) ─────────────

function esc(texto: string) {
  return texto.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/** Pluraliza un sustantivo según la cantidad: n(1, 'día', 'días') → '1 día'. */
function n(cantidad: number, singular: string, plural: string): string {
  return `${cantidad} ${cantidad === 1 ? singular : plural}`
}

/** Envuelve el contenido en la tarjeta de marca Hunter (isotipo oficial servido desde la app).
 * `sinPadding`: usa la variante de tarjeta sin padding propio (banda superior a sangre, contenido
 * con su propio padding interno) — la usan las variantes "último día" (correo 6 del mockup). */
/** `marca`: los correos del PROCESO de evaluación salen como CENIT (default); los de ACCESO a la
 * plataforma (código 2FA, credenciales, contraseña) salen como Talent Hub. */
export function plantilla(contenido: string, opciones?: { sinPadding?: boolean; marca?: 'proceso' | 'acceso' }) {
  const padTarjeta = opciones?.sinPadding ? 'padding:0;overflow:hidden;' : 'padding:32px;'
  const marca = opciones?.marca === 'acceso'
    ? { nombre: 'Talent Hub', sub: 'Plataforma de talento — Hunter' }
    : { nombre: 'CENIT', sub: 'Evaluación de Desempeño · Talent Hub' }
  return `<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:0;background-color:#f7f5f2;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f5f2;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <tr><td style="padding:0 8px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:30px;vertical-align:middle;"><img src="cid:${LOGO_CORREO_CID}" width="24" height="35" alt="Hunter" style="display:block;border:0;outline:none;" /></td>
            <td style="padding-left:10px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:800;color:#2a2623;">${marca.nombre}
              <div style="font-size:11px;font-weight:400;color:#8a857f;">${marca.sub}</div>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="background-color:#ffffff;border-radius:16px;${padTarjeta}font-family:Arial,Helvetica,sans-serif;color:#2a2623;font-size:14px;line-height:1.6;">
          ${contenido}
        </td></tr>
        <tr><td style="padding:16px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#8a857f;">
          Correo automático de Talent Hub, la plataforma de talento de Hunter. No respondas a este mensaje.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function titulo(texto: string) {
  return `<h1 style="margin:0 0 16px;font-size:19px;line-height:1.3;font-weight:800;color:#2a2623;">${texto}</h1>`
}

function parrafo(html: string) {
  return `<p style="margin:0 0 14px;">${html}</p>`
}

function notaGris(html: string) {
  return `<p style="margin:18px 0 0;font-size:12px;color:#8a857f;">${html}</p>`
}

function botonCta(texto: string, ruta: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px;"><tr>
    <td style="background-color:#f0163e;border-radius:12px;">
      <a href="${URL_APP}${ruta}" style="display:inline-block;padding:12px 26px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">${texto}</a>
    </td>
  </tr></table>`
}

function bloqueDestacado(html: string) {
  return `<div style="background-color:#f7f5f2;border:1px solid #e5e1dc;border-radius:12px;padding:18px 20px;margin:18px 0;">${html}</div>`
}

// ───────────── Correos ─────────────

export async function enviarCodigo2FA(email: string, codigo: string) {
  if (modoConsola(`\n📧 [2FA] Código para ${email}: ${codigo} (válido 10 minutos)\n`)) return
  const html = plantilla(
    titulo('Tu código de acceso') +
    parrafo('Usa este código para completar tu ingreso a la plataforma:') +
    bloqueDestacado(`<div style="text-align:center;font-size:34px;font-weight:800;letter-spacing:10px;color:#2a2623;">${esc(codigo)}</div>`) +
    parrafo(`Es válido por <b>10 minutos</b>.`) +
    notaGris('Si no intentaste ingresar a Talent Hub, la plataforma de talento de Hunter, ignora este correo: nadie puede entrar sin este código.'),
    { marca: 'acceso' },
  )
  await enviar(
    email,
    `${codigo} es tu código de acceso — Talent Hub`,
    `Tu código de verificación es: ${codigo}\n\nEs válido por 10 minutos. Si no intentaste ingresar a Talent Hub, ignora este correo.`,
    html,
  )
}

/** Enlace de restablecimiento de contraseña (flujo «¿Olvidaste tu contraseña?»).
 * `ruta` es relativa (botonCta antepone URL_APP), p. ej. `/restablecer?token=…`. */
export async function enviarRestablecimiento(email: string, ruta: string) {
  if (modoConsola(`\n📧 [Restablecer] Para ${email}: ${URL_APP}${ruta} (válido 30 minutos)\n`)) return
  const html = plantilla(
    titulo('Restablece tu contraseña') +
    parrafo('Recibimos una solicitud para restablecer la contraseña de tu cuenta en la Plataforma de Evaluación de Desempeño 360.') +
    botonCta('Definir nueva contraseña', ruta) +
    parrafo('El enlace es válido por <b>30 minutos</b> y solo puede usarse una vez.') +
    notaGris('Si no fuiste tú, ignora este correo: tu contraseña actual sigue vigente y nadie puede cambiarla sin este enlace.'),
  )
  await enviar(
    email,
    'Restablece tu contraseña — Talent Hub',
    `Recibimos una solicitud para restablecer tu contraseña.\n\nAbre este enlace (válido 30 minutos, un solo uso):\n${URL_APP}${ruta}\n\nSi no fuiste tú, ignora este correo: tu contraseña actual sigue vigente.`,
    html,
  )
}

/** Aviso de apertura de la ventana de carga de objetivos del período. */
export async function enviarAperturaObjetivos(email: string, nombre: string, periodo: string, deadline: string) {
  if (modoConsola(`\n📧 [Objetivos] Para ${nombre} <${email}>: carga de objetivos ${periodo} abierta hasta ${deadline}\n`)) return
  const html = plantilla(
    titulo(`Ya puedes cargar tus objetivos del período ${esc(periodo)}`) +
    parrafo(`Hola, <b>${esc(nombre)}</b>:`) +
    parrafo(`RR.HH. abrió la carga de objetivos del período <b>${esc(periodo)}</b>. Entra a <b>“Mis objetivos”</b> y define tus objetivos con sus pesos: el total debe sumar <b>100%</b>.`) +
    bloqueDestacado(`<span style="font-size:12px;font-weight:700;color:#8a857f;text-transform:uppercase;letter-spacing:1px;">Fecha límite de carga</span><br><span style="font-size:17px;font-weight:800;color:#f0163e;">${esc(deadline)}</span>`) +
    parrafo('Tu jefe directo revisará y aprobará lo que propongas. Los objetivos definidos en esta ventana serán la base de tu evaluación del período.') +
    botonCta('Cargar mis objetivos', '/objetivos'),
  )
  await enviar(
    email,
    `Ya puedes cargar tus objetivos del período ${periodo} — CENIT`,
    `Hola, ${nombre}:\n\nRR.HH. abrió la carga de objetivos del período ${periodo}. Ingresa a la Plataforma de Evaluación de Desempeño 360, ve a "Mis objetivos" y define tus objetivos con sus pesos.\n\nFecha límite: ${deadline}.\n\nTu jefe directo revisará y aprobará lo que propongas. Los objetivos definidos en esta ventana serán la base de tu evaluación del período.`,
    html,
  )
}

/** Aviso de cambio en los transversales: el total del colaborador dejó de sumar 100%. */
export async function enviarCambioTransversales(email: string, nombre: string, periodo: string, total: number) {
  if (modoConsola(`\n📧 [Transversales] Para ${nombre} <${email}>: transversales de ${periodo} cambiaron · su total quedó en ${total}%\n`)) return
  const html = plantilla(
    titulo(`Los objetivos transversales del período ${esc(periodo)} cambiaron`) +
    parrafo(`Hola, <b>${esc(nombre)}</b>:`) +
    parrafo(`RR.HH. actualizó los objetivos transversales del período <b>${esc(periodo)}</b> y el peso total de tus objetivos quedó descuadrado:`) +
    bloqueDestacado(`<span style="font-size:12px;font-weight:700;color:#8a857f;text-transform:uppercase;letter-spacing:1px;">Tu total actual</span><br><span style="font-size:24px;font-weight:800;color:#f0163e;">${total}%</span> <span style="font-size:13px;color:#8a857f;">— debe sumar 100%</span>`) +
    parrafo('Ajusta los pesos de tus objetivos con tu jefe directo.') +
    botonCta('Revisar mis objetivos', '/objetivos') +
    notaGris('Si tu plazo de carga ya venció, coordina con RR.HH. para extenderlo.'),
  )
  await enviar(
    email,
    `Los objetivos transversales del período ${periodo} cambiaron — CENIT`,
    `Hola, ${nombre}:\n\nRR.HH. actualizó los objetivos transversales del período ${periodo} y el peso total de tus objetivos quedó en ${total}% (debe sumar 100%).\n\nIngresa a la plataforma, ve a "Mis objetivos" y ajusta los pesos con tu jefe directo. Si tu plazo de carga ya venció, coordina con RR.HH. para extenderlo.`,
    html,
  )
}

/** Aviso al colaborador: su jefe ajustó la propuesta al aprobarla (la original queda rechazada y
 * el objetivo vigente es la versión definida por el jefe). */
export async function enviarObjetivoReemplazado(email: string, nombre: string, periodo: string, tituloOriginal: string, tituloNuevo: string) {
  if (modoConsola(`\n📧 [Objetivos] Para ${nombre} <${email}>: su propuesta "${tituloOriginal}" fue ajustada por su jefe → "${tituloNuevo}" (${periodo})\n`)) return
  const html = plantilla(
    titulo(`Tu jefe ajustó tu propuesta de objetivo${periodo ? ` · ${esc(periodo)}` : ''}`) +
    parrafo(`Hola, <b>${esc(nombre)}</b>:`) +
    parrafo(`Al revisar tu propuesta <b>“${esc(tituloOriginal)}”</b>, tu jefe la ajustó y aprobó una versión modificada. Tu propuesta original queda registrada como rechazada y el objetivo vigente es:`) +
    bloqueDestacado(`<span style="font-size:15px;font-weight:800;color:#1a1713;">${esc(tituloNuevo)}</span>`) +
    parrafo('Revisa el detalle en “Mis objetivos”. Si algo no te cuadra, conversa con tu jefe directo.') +
    botonCta('Ver mis objetivos', '/objetivos'),
  )
  await enviar(
    email,
    `Tu jefe ajustó tu propuesta de objetivo — CENIT`,
    `Hola, ${nombre}:\n\nAl revisar tu propuesta "${tituloOriginal}"${periodo ? ` del período ${periodo}` : ''}, tu jefe la ajustó y aprobó una versión modificada. Tu propuesta original queda registrada como rechazada y el objetivo vigente es: "${tituloNuevo}".\n\nRevisa el detalle en "Mis objetivos". Si algo no te cuadra, conversa con tu jefe directo.`,
    html,
  )
}

/** Recordatorio a quien no completó la carga de objetivos del período. */
export async function enviarRecordatorioObjetivos(email: string, nombre: string, periodo: string, deadline: string, avance: number) {
  if (modoConsola(`\n📧 [Recordatorio] Para ${nombre} <${email}>: objetivos ${periodo} al ${avance}% · límite ${deadline}\n`)) return
  const pct = Math.max(0, Math.min(avance, 100))
  const html = plantilla(
    titulo(`Completa tus objetivos del período ${esc(periodo)}`) +
    parrafo(`Hola, <b>${esc(nombre)}</b>:`) +
    parrafo(`Tus objetivos del período <b>${esc(periodo)}</b> aún no llegan al 100% del peso total:`) +
    bloqueDestacado(
      `<span style="font-size:12px;font-weight:700;color:#8a857f;text-transform:uppercase;letter-spacing:1px;">Tu avance</span>` +
      `<div style="margin-top:8px;"><span style="font-size:24px;font-weight:800;color:#f0163e;">${pct}%</span> <span style="font-size:13px;color:#8a857f;">de 100%</span></div>` +
      `<div style="margin-top:10px;background-color:#e5e1dc;border-radius:6px;height:10px;"><div style="background-color:#f0163e;border-radius:6px;height:10px;width:${pct}%;"></div></div>`,
    ) +
    parrafo(`La fecha límite de carga es el <b>${esc(deadline)}</b>. Completa la definición con tu jefe directo.`) +
    botonCta('Completar mis objetivos', '/objetivos'),
  )
  await enviar(
    email,
    `Recordatorio: completa tus objetivos del período ${periodo} — CENIT`,
    `Hola, ${nombre}:\n\nTus objetivos del período ${periodo} están al ${avance}% del peso total (debe llegar a 100%).\n\nLa fecha límite de carga es el ${deadline}. Ingresa a la plataforma, ve a "Mis objetivos" y completa la definición con tu jefe directo.`,
    html,
  )
}

/** Aviso al cerrar un ciclo con publicación: los resultados del participante ya están disponibles. */
export async function enviarResultadosPublicados(email: string, nombre: string, cicloNombre: string) {
  if (modoConsola(`\n📧 [Resultados] Para ${nombre} <${email}>: resultados de "${cicloNombre}" publicados\n`)) return
  const html = plantilla(
    titulo('Tus resultados de la evaluación 360 ya están disponibles') +
    parrafo(`Hola, <b>${esc(nombre)}</b>:`) +
    parrafo(`El ciclo <b>${esc(cicloNombre)}</b> cerró y RR.HH. publicó los resultados. Ya puedes revisar tu nota final, el detalle por competencias y el cumplimiento de tus objetivos en la plataforma.`) +
    botonCta('Ver mi resultado', '/mi-resultado') +
    notaGris('Si tienes dudas sobre tu resultado, coordina una conversación de retroalimentación con tu jefe directo o con RR.HH.'),
  )
  await enviar(
    email,
    `Tus resultados del ${cicloNombre} ya están disponibles — CENIT`,
    `Hola, ${nombre}:\n\nEl ciclo ${cicloNombre} cerró y RR.HH. publicó los resultados. Ingresa a la Plataforma de Evaluación de Desempeño 360 y entra a "Mi resultado" para revisar tu nota final, el detalle por competencias y el cumplimiento de tus objetivos.\n\nSi tienes dudas sobre tu resultado, coordina una conversación de retroalimentación con tu jefe directo o con RR.HH.`,
    html,
  )
}

/** Credenciales de acceso inicial (contraseña temporal: se exige cambiarla al primer ingreso). */
export async function enviarCredenciales(email: string, nombre: string, passwordTemporal: string) {
  if (modoConsola(`\n📧 [Credenciales] Para ${nombre} <${email}> · contraseña temporal: ${passwordTemporal}\n`)) return
  const filaCredencial = (etiqueta: string, valor: string) =>
    `<tr>
      <td style="padding:6px 0;font-size:12px;font-weight:700;color:#8a857f;text-transform:uppercase;letter-spacing:1px;white-space:nowrap;">${etiqueta}</td>
      <td style="padding:6px 0 6px 18px;font-size:15px;font-weight:700;color:#2a2623;font-family:Consolas,Menlo,monospace;">${esc(valor)}</td>
    </tr>`
  const html = plantilla(
    titulo('Tu cuenta en Talent Hub está lista') +
    parrafo(`Hola, <b>${esc(nombre)}</b>:`) +
    parrafo('Te damos la bienvenida a <b>Talent Hub</b>, la plataforma de talento de Hunter. Estas son tus credenciales de acceso:') +
    bloqueDestacado(`<table role="presentation" cellpadding="0" cellspacing="0">${filaCredencial('Usuario', email)}${filaCredencial('Contraseña temporal', passwordTemporal)}</table>`) +
    parrafo('Al ingresar por primera vez se te pedirá crear tu <b>contraseña definitiva</b>. El acceso usa <b>verificación en dos pasos</b>: recibirás un código en este correo cada vez que ingreses.') +
    botonCta('Ingresar a la plataforma', '/') +
    notaGris('Por seguridad, no compartas esta contraseña; deja de servir apenas crees la definitiva.'),
  )
  await enviar(
    email,
    'Tu cuenta en Talent Hub está lista',
    `Hola, ${nombre}:\n\nTe damos la bienvenida a Talent Hub, la plataforma de talento de Hunter.\n\nUsuario: ${email}\nContraseña temporal: ${passwordTemporal}\n\nAl ingresar por primera vez se te pedirá crear tu contraseña definitiva. El acceso usa verificación en dos pasos: recibirás un código en este correo cada vez que ingreses.`,
    html,
  )
}

// ───────────── Recordatorios automáticos (cron) ─────────────

export type PendienteEvaluacion = { modalidad: 'AUTO' | 'JEFE' | 'PAR' | 'ASCENDENTE'; evaluado: string }
export type FilaAprobacionJefe = { nombre: string; objetivos: number; pesoTotal: number }
export type FilaObjetivoAprobado = { titulo: string; peso: number }
export type DigestPais = { pais: string; sinCompletar: number; jefesPorAprobar: number }
export type DigestPaisEval = { pais: string; evaluadores: number; evaluaciones: number }

/** Banda roja superior de la variante "último día" (reemplaza el título normal de la tarjeta). */
function bandaUltimoDia() {
  return `<div style="background-color:#f0163e;color:#ffffff;padding:10px 32px;font-size:13px;font-weight:800;letter-spacing:0.5px;border-radius:16px 16px 0 0;">⏰ HOY es el último día</div>`
}

/** Chip de modalidad de evaluación (AUTO/JEFE/PAR/ASCENDENTE→ASC), colores del mockup. */
function chipModalidad(modalidad: PendienteEvaluacion['modalidad']) {
  const estilos: Record<PendienteEvaluacion['modalidad'], { bg: string; color: string; etiqueta: string }> = {
    AUTO: { bg: '#fdf1f3', color: '#c30f33', etiqueta: 'AUTO' },
    JEFE: { bg: '#eef4fb', color: '#1d5ca8', etiqueta: 'JEFE' },
    PAR: { bg: '#f3eefb', color: '#6a3fb8', etiqueta: 'PAR' },
    ASCENDENTE: { bg: '#eef4fb', color: '#1d5ca8', etiqueta: 'ASC' },
  }
  const e = estilos[modalidad]
  return `<span style="display:inline-block;background:${e.bg};color:${e.color};border-radius:20px;padding:1px 10px;font-size:11px;font-weight:800;">${e.etiqueta}</span>`
}

/** Construye el correo de recordatorio de objetivos sin enviarlo — usado por el wrapper
 * individual (`enviarRecordatorioObjetivosAuto`) y por el cron para despachar en batch. */
export function construirRecordatorioObjetivosAuto(email: string, nombre: string, periodo: string, deadlineTexto: string, avance: number, diasRestantes: number, ultimoDia: boolean): CorreoConstruido {
  const pct = Math.max(0, Math.min(avance, 100))
  const verbo = diasRestantes === 1 ? 'queda' : 'quedan'
  const asunto = ultimoDia
    ? `ÚLTIMO DÍA: completa tus objetivos del período ${periodo} — CENIT`
    : `Te ${verbo} ${n(diasRestantes, 'día', 'días')} para completar tus objetivos del período ${periodo} — CENIT`

  if (ultimoDia) {
    const html = plantilla(
      bandaUltimoDia() +
      `<div style="padding:26px 32px 32px;">` +
      titulo('La carga de objetivos cierra hoy') +
      parrafo(`Hola, <b>${esc(nombre)}</b>: la ventana del período <b>${esc(periodo)}</b> cierra <b>hoy a las 23:59</b> y tu peso total está en <b style="color:#f0163e;">${pct}%</b>. Si no llegas al 100%, tu evaluación del período quedará incompleta y RR.HH. tendrá que extenderte el plazo manualmente.`) +
      botonCta('Completar ahora', '/objetivos') +
      `</div>`,
      { sinPadding: true },
    )
    return {
      to: email,
      asunto,
      texto: `HOY es el último día. Hola, ${nombre}: la ventana del período ${periodo} cierra hoy a las 23:59 y tu peso total está en ${pct}%. Si no llegas al 100%, tu evaluación del período quedará incompleta y RR.HH. tendrá que extenderte el plazo manualmente.`,
      html,
    }
  }

  const html = plantilla(
    titulo(`Te ${verbo} ${n(diasRestantes, 'día', 'días')} para completar tus objetivos`) +
    parrafo(`Hola, <b>${esc(nombre)}</b>:`) +
    parrafo(`La carga de objetivos del período <b>${esc(periodo)}</b> cierra el <b>${esc(deadlineTexto)}</b> y tus objetivos aún no llegan al 100% del peso total:`) +
    bloqueDestacado(
      `<span style="font-size:12px;font-weight:700;color:#8a857f;text-transform:uppercase;letter-spacing:1px;">Tu avance</span>` +
      `<div style="margin-top:8px;"><span style="font-size:24px;font-weight:800;color:#f0163e;">${pct}%</span> <span style="font-size:13px;color:#8a857f;">de 100% · te falta asignar ${100 - pct}%</span></div>` +
      `<div style="margin-top:10px;background-color:#e5e1dc;border-radius:6px;height:10px;"><div style="background-color:#f0163e;border-radius:6px;height:10px;width:${pct}%;"></div></div>` +
      `<div style="margin-top:12px;font-size:12px;color:#8a857f;">⏳ ${diasRestantes === 1 ? 'Queda' : 'Quedan'} <b style="color:#f0163e;">${n(diasRestantes, 'día', 'días')}</b> de ventana de carga</div>`,
    ) +
    parrafo('Completa la definición con tu jefe directo: los objetivos de esta ventana serán la base de tu evaluación del período.') +
    botonCta('Completar mis objetivos', '/objetivos'),
  )
  return {
    to: email,
    asunto,
    texto: `Hola, ${nombre}:\n\nLa carga de objetivos del período ${periodo} cierra el ${deadlineTexto} y tus objetivos aún no llegan al 100% del peso total. Tu avance actual: ${pct}% de 100% (te falta asignar ${100 - pct}%). ${diasRestantes === 1 ? 'Queda' : 'Quedan'} ${n(diasRestantes, 'día', 'días')} de ventana de carga.\n\nCompleta la definición con tu jefe directo: los objetivos de esta ventana serán la base de tu evaluación del período.`,
    html,
  }
}

/** Recordatorio al colaborador que no llegó al 100% del peso de sus objetivos del período. */
export async function enviarRecordatorioObjetivosAuto(email: string, nombre: string, periodo: string, deadlineTexto: string, avance: number, diasRestantes: number, ultimoDia: boolean): Promise<void> {
  if (modoConsola(`\n📧 [Recordatorio objetivos${ultimoDia ? ' · ÚLTIMO DÍA' : ''}] Para ${nombre} <${email}>: período ${periodo} al ${avance}% · quedan ${diasRestantes} día(s)\n`)) return
  const correo = construirRecordatorioObjetivosAuto(email, nombre, periodo, deadlineTexto, avance, diasRestantes, ultimoDia)
  await enviar(correo.to, correo.asunto, correo.texto, correo.html)
}

/** Construye el correo de aprobaciones pendientes del jefe sin enviarlo. */
export function construirRecordatorioAprobacionesJefe(email: string, nombre: string, periodo: string, deadlineTexto: string, filas: FilaAprobacionJefe[], diasRestantes: number): CorreoConstruido {
  const totalObjetivos = filas.reduce((acc, f) => acc + f.objetivos, 0)
  const asunto = `Tu equipo tiene ${n(totalObjetivos, 'objetivo', 'objetivos')} esperando tu aprobación (${diasRestantes === 1 ? 'queda' : 'quedan'} ${n(diasRestantes, 'día', 'días')}) — CENIT`
  const filasHtml = filas
    .map((f, i) => {
      const borde = i === filas.length - 1 ? '' : 'border-bottom:1px solid #e5e1dc;'
      return `<tr><td style="padding:5px 0;${borde}"><b>${esc(f.nombre)}</b></td><td style="padding:5px 0;${borde}text-align:right;color:#8a857f;">${f.objetivos} objetivo${f.objetivos === 1 ? '' : 's'} · ${f.pesoTotal}% del peso</td></tr>`
    })
    .join('')
  const html = plantilla(
    titulo('Tu equipo espera tu aprobación de objetivos') +
    parrafo(`Hola, <b>${esc(nombre)}</b>:`) +
    parrafo(`La ventana de carga del período <b>${esc(periodo)}</b> cierra el <b>${esc(deadlineTexto)}</b> y tienes propuestas de tu equipo sin revisar:`) +
    bloqueDestacado(
      `<span style="font-size:12px;font-weight:700;color:#8a857f;text-transform:uppercase;letter-spacing:1px;">Pendientes de tu aprobación</span>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:10px;width:100%;font-size:13px;">${filasHtml}</table>` +
      `<div style="margin-top:12px;font-size:12px;color:#8a857f;">⏳ ${diasRestantes === 1 ? 'Queda' : 'Quedan'} <b style="color:#f0163e;">${n(diasRestantes, 'día', 'días')}</b> — sin tu aprobación, sus objetivos no quedan activos</div>`,
    ) +
    botonCta('Revisar y aprobar', '/equipo/objetivos'),
  )
  const filasTexto = filas.map(f => `- ${f.nombre}: ${n(f.objetivos, 'objetivo', 'objetivos')} · ${f.pesoTotal}% del peso`).join('\n')
  return {
    to: email,
    asunto,
    texto: `Hola, ${nombre}:\n\nLa ventana de carga del período ${periodo} cierra el ${deadlineTexto} y tienes propuestas de tu equipo sin revisar:\n\n${filasTexto}\n\n${diasRestantes === 1 ? 'Queda' : 'Quedan'} ${n(diasRestantes, 'día', 'días')}. Sin tu aprobación, sus objetivos no quedan activos.`,
    html,
  }
}

/** Recordatorio al jefe con propuestas de objetivos de su equipo aún sin aprobar. */
export async function enviarRecordatorioAprobacionesJefe(email: string, nombre: string, periodo: string, deadlineTexto: string, filas: FilaAprobacionJefe[], diasRestantes: number): Promise<void> {
  const totalObjetivos = filas.reduce((acc, f) => acc + f.objetivos, 0)
  if (modoConsola(`\n📧 [Aprobaciones pendientes] Para ${nombre} <${email}>: ${filas.length} colaborador(es) · ${totalObjetivos} objetivo(s) sin aprobar · período ${periodo} · quedan ${diasRestantes} día(s)\n`)) return
  const correo = construirRecordatorioAprobacionesJefe(email, nombre, periodo, deadlineTexto, filas, diasRestantes)
  await enviar(correo.to, correo.asunto, correo.texto, correo.html)
}

/** Confirmación al colaborador: su jefe (o RR.HH.) aprobó sus objetivos del período. */
export async function enviarObjetivosAprobados(email: string, nombre: string, periodo: string, filas: FilaObjetivoAprobado[], totalPct: number): Promise<void> {
  if (modoConsola(`\n📧 [Objetivos aprobados] Para ${nombre} <${email}>: período ${periodo} · ${filas.length} objetivo(s) · total ${totalPct}%\n`)) return
  const filasHtml = filas
    .map((f, i) => {
      const borde = i === filas.length - 1 ? '' : 'border-bottom:1px solid #e5e1dc;'
      return `<tr><td style="padding:5px 0;${borde}">${esc(f.titulo)}</td><td style="padding:5px 0;${borde}text-align:right;font-weight:800;">${f.peso}%</td></tr>`
    })
    .join('')
  const html = plantilla(
    titulo('✅ Tus objetivos fueron aprobados') +
    parrafo(`Hola, <b>${esc(nombre)}</b>:`) +
    parrafo(`Tu jefe directo aprobó tus objetivos del período <b>${esc(periodo)}</b>:`) +
    bloqueDestacado(
      `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;">${filasHtml}</table>` +
      `<div style="margin-top:12px;font-size:12px;color:#8a857f;">Con los transversales del período, tu peso total queda en <b style="color:#2a2623;">${totalPct}% ✓</b></div>`,
    ) +
    parrafo('Estos objetivos serán la base de tu evaluación. Podrás registrar sus logros cuando el período lo habilite.') +
    botonCta('Ver mis objetivos', '/objetivos'),
  )
  const filasTexto = filas.map(f => `- ${f.titulo}: ${f.peso}%`).join('\n')
  await enviar(
    email,
    `Tus objetivos del período ${periodo} fueron aprobados — CENIT`,
    `Hola, ${nombre}:\n\nTu jefe directo aprobó tus objetivos del período ${periodo}:\n\n${filasTexto}\n\nCon los transversales del período, tu peso total queda en ${totalPct}%.\n\nEstos objetivos serán la base de tu evaluación. Podrás registrar sus logros cuando el período lo habilite.`,
    html,
  )
}

/** Aviso al colaborador: su jefe le asignó (y aprobó de una vez) un objetivo directo. */
export async function enviarObjetivoAsignado(email: string, nombre: string, periodo: string, tituloObjetivo: string, peso: number, totalPct: number): Promise<void> {
  if (modoConsola(`\n📧 [Objetivo asignado] Para ${nombre} <${email}>: "${tituloObjetivo}" (${peso}%) · período ${periodo} · total ${totalPct}%\n`)) return
  const totalTexto = totalPct >= 100
    ? `Con este objetivo, tu peso total del período queda en <b style="color:#2a2623;">${totalPct}% ✓</b>`
    : `Con este objetivo, tu peso total del período queda en <b style="color:#2a2623;">${totalPct}%</b> — recuerda completar hasta 100%`
  const html = plantilla(
    titulo('Tu jefe te asignó un objetivo') +
    parrafo(`Hola, <b>${esc(nombre)}</b>:`) +
    parrafo(`Tu jefe directo definió y aprobó este objetivo para ti en el período <b>${esc(periodo)}</b>:`) +
    bloqueDestacado(
      `<span style="font-size:15px;font-weight:800;color:#1a1713;">${esc(tituloObjetivo)}</span>` +
      `<div style="margin-top:6px;font-size:13px;color:#8a857f;">Peso: <b style="color:#2a2623;">${peso}%</b></div>` +
      `<div style="margin-top:12px;font-size:12px;color:#8a857f;">${totalTexto}</div>`,
    ) +
    parrafo('Será parte de la base de tu evaluación del período; podrás registrar su logro cuando el período lo habilite. Si tienes dudas, coordina con tu jefe directo.') +
    botonCta('Ver mis objetivos', '/objetivos'),
  )
  const totalTextoPlano = totalPct >= 100
    ? `Con este objetivo, tu peso total del período queda en ${totalPct}%.`
    : `Con este objetivo, tu peso total del período queda en ${totalPct}% — recuerda completar hasta 100%.`
  await enviar(
    email,
    `Tu jefe te asignó un objetivo del período ${periodo} — CENIT`,
    `Hola, ${nombre}:\n\nTu jefe directo definió y aprobó este objetivo para ti en el período ${periodo}:\n\n${tituloObjetivo} (${peso}%)\n\n${totalTextoPlano}\n\nSerá parte de la base de tu evaluación del período; podrás registrar su logro cuando el período lo habilite. Si tienes dudas, coordina con tu jefe directo.`,
    html,
  )
}

/** Construye el correo de evaluaciones pendientes sin enviarlo. */
export function construirRecordatorioEvaluaciones(email: string, nombre: string, ciclo: string, deadlineTexto: string, pendientes: PendienteEvaluacion[], diasRestantes: number, ultimoDia: boolean): CorreoConstruido {
  const asunto = ultimoDia
    ? `ÚLTIMO DÍA: completa tus evaluaciones del ${ciclo} — CENIT`
    : `Tienes ${n(pendientes.length, 'evaluación pendiente', 'evaluaciones pendientes')} del ${ciclo} (${diasRestantes === 1 ? 'queda' : 'quedan'} ${n(diasRestantes, 'día', 'días')}) — CENIT`

  if (ultimoDia) {
    const html = plantilla(
      bandaUltimoDia() +
      `<div style="padding:26px 32px 32px;">` +
      titulo('El ciclo de evaluación cierra hoy') +
      parrafo(`Hola, <b>${esc(nombre)}</b>: el <b>${esc(ciclo)}</b> cierra <b>hoy a las 23:59</b> y aún tienes <b style="color:#f0163e;">${n(pendientes.length, 'evaluación', 'evaluaciones')}</b> por completar. Si no las envías, quedarán fuera del resultado.`) +
      botonCta('Completar ahora', '/evaluaciones') +
      `</div>`,
      { sinPadding: true },
    )
    return {
      to: email,
      asunto,
      texto: `HOY es el último día. Hola, ${nombre}: el ${ciclo} cierra hoy a las 23:59 y aún tienes ${n(pendientes.length, 'evaluación', 'evaluaciones')} por completar. Si no las envías, quedarán fuera del resultado.`,
      html,
    }
  }

  const filasHtml = pendientes
    .map((p, i) => {
      const borde = i === pendientes.length - 1 ? '' : 'border-bottom:1px solid #e5e1dc;'
      return `<tr><td style="padding:6px 0;${borde}">${chipModalidad(p.modalidad)}</td><td style="padding:6px 0 6px 12px;${borde}">${esc(p.evaluado)}</td></tr>`
    })
    .join('')
  const html = plantilla(
    titulo(`Tienes ${n(pendientes.length, 'evaluación pendiente', 'evaluaciones pendientes')}`) +
    parrafo(`Hola, <b>${esc(nombre)}</b>:`) +
    parrafo(`El ciclo <b>${esc(ciclo)}</b> cierra el <b>${esc(deadlineTexto)}</b> y aún tienes evaluaciones por completar:`) +
    bloqueDestacado(
      `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;">${filasHtml}</table>` +
      `<div style="margin-top:12px;font-size:12px;color:#8a857f;">⏳ ${diasRestantes === 1 ? 'Queda' : 'Quedan'} <b style="color:#f0163e;">${n(diasRestantes, 'día', 'días')}</b> de ciclo</div>`,
    ) +
    botonCta('Completar mis evaluaciones', '/evaluaciones'),
  )
  const pendientesTexto = pendientes.map(p => `- [${p.modalidad}] ${p.evaluado}`).join('\n')
  return {
    to: email,
    asunto,
    texto: `Hola, ${nombre}:\n\nEl ciclo ${ciclo} cierra el ${deadlineTexto} y aún tienes evaluaciones por completar:\n\n${pendientesTexto}\n\n${diasRestantes === 1 ? 'Queda' : 'Quedan'} ${n(diasRestantes, 'día', 'días')} de ciclo.`,
    html,
  }
}

/** Aviso al colaborador que acaba de quedar como PAR evaluador de alguien (nominación directa
 * del jefe, asignación de RR.HH. o aprobación de una propuesta): a diferencia de la apertura
 * del ciclo, esta asignación aparece DESPUÉS del lanzamiento y sin este correo el par solo se
 * enteraba al entrar a la plataforma (o recién con el recordatorio automático). */
export function construirParAsignado(email: string, nombre: string, evaluado: string, ciclo: string, deadlineTexto: string): CorreoConstruido {
  const asunto = `Se te asignó como par evaluador de ${evaluado} — CENIT`
  const html = plantilla(
    titulo('Te asignaron como par evaluador') +
    parrafo(`Hola, <b>${esc(nombre)}</b>:`) +
    parrafo(`En el ciclo <b>${esc(ciclo)}</b> quedaste asignado como <b>par evaluador</b> de <b>${esc(evaluado)}</b>. Tu mirada como compañero de trabajo es parte de su evaluación 360.`) +
    bloqueDestacado(
      `<div style="font-size:13px;">📅 Por favor completa su evaluación antes del <b style="color:#f0163e;">${esc(deadlineTexto)}</b></div>`,
    ) +
    parrafo('Entra a <b>“Mis evaluaciones”</b> cuando quieras: puedes completarla en varios momentos y enviarla cuando estés conforme.') +
    botonCta('Completar su evaluación', '/evaluaciones'),
  )
  return {
    to: email,
    asunto,
    texto: `Hola, ${nombre}:

En el ciclo ${ciclo} quedaste asignado como par evaluador de ${evaluado}. Por favor completa su evaluación antes del ${deadlineTexto}.

Ingresa a la plataforma y ve a "Mis evaluaciones".`,
    html,
  }
}

/** Construye el aviso de apertura del ciclo sin enviarlo: al lanzar, cada evaluador con cuenta
 * recibe qué evaluaciones le tocan y hasta cuándo. */
export function construirAperturaCiclo(email: string, nombre: string, ciclo: string, deadlineTexto: string, pendientes: PendienteEvaluacion[]): CorreoConstruido {
  const asunto = `Se abrió el ${ciclo}: tienes ${n(pendientes.length, 'evaluación por completar', 'evaluaciones por completar')} — CENIT`
  const filasHtml = pendientes
    .map((p, i) => {
      const borde = i === pendientes.length - 1 ? '' : 'border-bottom:1px solid #e5e1dc;'
      return `<tr><td style="padding:6px 0;${borde}">${chipModalidad(p.modalidad)}</td><td style="padding:6px 0 6px 12px;${borde}">${esc(p.evaluado)}</td></tr>`
    })
    .join('')
  const html = plantilla(
    titulo(`Se abrió el ${esc(ciclo)}`) +
    parrafo(`Hola, <b>${esc(nombre)}</b>:`) +
    parrafo(`RR.HH. lanzó el ciclo de evaluación <b>${esc(ciclo)}</b> y estas son las evaluaciones que te corresponden:`) +
    bloqueDestacado(
      `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;">${filasHtml}</table>` +
      `<div style="margin-top:12px;font-size:12px;color:#8a857f;">📅 Fecha límite: <b style="color:#f0163e;">${esc(deadlineTexto)}</b></div>`,
    ) +
    parrafo('Entra a <b>“Mis evaluaciones”</b> cuando quieras: puedes completarlas en varios momentos y enviarlas cuando estés conforme.') +
    botonCta('Ver mis evaluaciones', '/evaluaciones'),
  )
  const pendientesTexto = pendientes.map(p => `- [${p.modalidad}] ${p.evaluado}`).join('\n')
  return {
    to: email,
    asunto,
    texto: `Hola, ${nombre}:\n\nRR.HH. lanzó el ciclo de evaluación ${ciclo} y estas son las evaluaciones que te corresponden:\n\n${pendientesTexto}\n\nFecha límite: ${deadlineTexto}.\n\nIngresa a la plataforma y ve a "Mis evaluaciones" para completarlas.`,
    html,
  }
}

/** Recordatorio al evaluador con evaluaciones pendientes del ciclo (incluye autoevaluación). */
export async function enviarRecordatorioEvaluaciones(email: string, nombre: string, ciclo: string, deadlineTexto: string, pendientes: PendienteEvaluacion[], diasRestantes: number, ultimoDia: boolean): Promise<void> {
  if (modoConsola(`\n📧 [Evaluaciones pendientes${ultimoDia ? ' · ÚLTIMO DÍA' : ''}] Para ${nombre} <${email}>: ${pendientes.length} pendiente(s) · ciclo ${ciclo} · quedan ${diasRestantes} día(s)\n`)) return
  const correo = construirRecordatorioEvaluaciones(email, nombre, ciclo, deadlineTexto, pendientes, diasRestantes, ultimoDia)
  await enviar(correo.to, correo.asunto, correo.texto, correo.html)
}

export type BloqueDigestObjetivos = { periodo: string; diasRestantes: number; filas: DigestPais[] }
export type BloqueDigestEvaluaciones = { ciclo: string; diasRestantes: number; filas: DigestPaisEval[]; avancePct: number }

/** Construye el digest de RR.HH. sin enviarlo. UN BLOQUE POR PROCESO (período/ciclo): mezclar
 * varios ciclos bajo una sola cabecera mostraba números que no existen en el ciclo rotulado. */
export function construirDigestRrhh(
  email: string,
  nombre: string,
  fechaTexto: string,
  objetivos: BloqueDigestObjetivos[],
  evaluaciones: BloqueDigestEvaluaciones[],
): CorreoConstruido {
  const totalSinCompletar = objetivos.reduce((acc, b) => acc + b.filas.reduce((a, f) => a + f.sinCompletar, 0), 0)
  const totalEvaluaciones = evaluaciones.reduce((acc, b) => acc + b.filas.reduce((a, f) => a + f.evaluaciones, 0), 0)

  const asunto = `Resumen de pendientes: ${n(totalSinCompletar, 'persona', 'personas')} con objetivos incompletos · ${n(totalEvaluaciones, 'evaluación', 'evaluaciones')} sin completar — CENIT`

  const bloquesObjetivos = objetivos
    .map((b) => bloqueDestacado(
      `<span style="font-size:12px;font-weight:700;color:#8a857f;text-transform:uppercase;letter-spacing:1px;">📋 Objetivos · período ${esc(b.periodo)} — cierra en ${n(b.diasRestantes, 'día', 'días')}</span>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:10px;width:100%;font-size:13px;">${b.filas
        .map((f, i) => {
          const borde = i === b.filas.length - 1 ? '' : 'border-bottom:1px solid #e5e1dc;'
          return `<tr><td style="padding:4px 0;${borde}">${esc(f.pais)}</td><td style="padding:4px 0;${borde}text-align:right;"><b>${f.sinCompletar}</b> sin completar sus objetivos · <b>${f.jefesPorAprobar}</b> ${f.jefesPorAprobar === 1 ? 'jefe' : 'jefes'} por aprobar</td></tr>`
        })
        .join('')}</table>`,
    ))
    .join('')

  const bloquesEvaluaciones = evaluaciones
    .map((b) => bloqueDestacado(
      `<span style="font-size:12px;font-weight:700;color:#8a857f;text-transform:uppercase;letter-spacing:1px;">📝 Evaluaciones · ${esc(b.ciclo)} — cierra en ${n(b.diasRestantes, 'día', 'días')}</span>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:10px;width:100%;font-size:13px;">${b.filas
        .map((f, i) => {
          const borde = i === b.filas.length - 1 ? '' : 'border-bottom:1px solid #e5e1dc;'
          return `<tr><td style="padding:4px 0;${borde}">${esc(f.pais)}</td><td style="padding:4px 0;${borde}text-align:right;"><b>${f.evaluadores}</b> ${f.evaluadores === 1 ? 'evaluador' : 'evaluadores'} ${f.evaluadores === 1 ? 'debe' : 'deben'} <b>${f.evaluaciones}</b> ${f.evaluaciones === 1 ? 'evaluación' : 'evaluaciones'}</td></tr>`
        })
        .join('')}</table>` +
      `<div style="margin-top:10px;font-size:12px;color:#8a857f;">Avance del ciclo: <b style="color:#2a2623;">${b.avancePct}%</b> de evaluaciones completadas</div>`,
    ))
    .join('')

  const html = plantilla(
    titulo('Resumen de pendientes de tus procesos') +
    parrafo(`Hola, <b>${esc(nombre)}</b>: este es el estado al <b>${esc(fechaTexto)}</b> en tu alcance.`) +
    bloquesObjetivos +
    bloquesEvaluaciones +
    `<p style="margin:0 0 6px;font-size:12px;color:#8a857f;">El detalle por persona (quién debe qué) está en la plataforma:</p>` +
    botonCta('Abrir monitoreo', '/admin/ciclos'),
  )

  const textoObjetivos = objetivos
    .map((b) => `Objetivos · período ${b.periodo} — cierra en ${n(b.diasRestantes, 'día', 'días')}\n` +
      b.filas.map(f => `- ${f.pais}: ${f.sinCompletar} sin completar sus objetivos · ${f.jefesPorAprobar} ${f.jefesPorAprobar === 1 ? 'jefe' : 'jefes'} por aprobar`).join('\n'))
    .join('\n\n')
  const textoEvaluaciones = evaluaciones
    .map((b) => `Evaluaciones · ${b.ciclo} — cierra en ${n(b.diasRestantes, 'día', 'días')}\n` +
      b.filas.map(f => `- ${f.pais}: ${f.evaluadores} ${f.evaluadores === 1 ? 'evaluador' : 'evaluadores'} ${f.evaluadores === 1 ? 'debe' : 'deben'} ${f.evaluaciones} ${f.evaluaciones === 1 ? 'evaluación' : 'evaluaciones'}`).join('\n') +
      `\nAvance del ciclo: ${b.avancePct}% de evaluaciones completadas`)
    .join('\n\n')

  return {
    to: email,
    asunto,
    texto: `Hola, ${nombre}: este es el estado al ${fechaTexto} en tu alcance.\n\n${[textoObjetivos, textoEvaluaciones].filter(Boolean).join('\n\n')}\n\nEl detalle por persona (quién debe qué) está en la plataforma.`,
    html,
  }
}

/** Resumen periódico a RR.HH. (regional o de país, según su alcance) con pendientes de objetivos y/o evaluaciones. */
export async function enviarDigestRrhh(
  email: string,
  nombre: string,
  fechaTexto: string,
  objetivos: BloqueDigestObjetivos[],
  evaluaciones: BloqueDigestEvaluaciones[],
): Promise<void> {
  const totalSinCompletar = objetivos.reduce((acc, b) => acc + b.filas.reduce((a, f) => a + f.sinCompletar, 0), 0)
  const totalEvaluaciones = evaluaciones.reduce((acc, b) => acc + b.filas.reduce((a, f) => a + f.evaluaciones, 0), 0)
  if (modoConsola(`\n📧 [Digest RR.HH.] Para ${nombre} <${email}>: ${fechaTexto} · ${totalSinCompletar} persona(s) con objetivos incompletos · ${totalEvaluaciones} evaluaciones sin completar\n`)) return
  const correo = construirDigestRrhh(email, nombre, fechaTexto, objetivos, evaluaciones)
  await enviar(correo.to, correo.asunto, correo.texto, correo.html)
}

/** Construye el aviso de nota preliminar disponible sin enviarlo. */
export function construirNotaPreliminarDisponible(email: string, nombre: string, ciclo: string): CorreoConstruido {
  const html = plantilla(
    titulo('Tu nota preliminar ya está disponible') +
    parrafo(`Hola, <b>${esc(nombre)}</b>:`) +
    parrafo(`Se completaron todas tus evaluaciones y logros del ciclo <b>${esc(ciclo)}</b>, y tu <b>nota preliminar</b> ya está visible en la plataforma, con el detalle por competencias y objetivos.`) +
    bloqueDestacado(
      `<span style="font-size:12px;font-weight:700;color:#8a857f;text-transform:uppercase;letter-spacing:1px;">Qué sigue</span>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:10px;width:100%;font-size:13px;">` +
      `<tr><td style="padding:5px 0;border-bottom:1px solid #e5e1dc;">1 · Revisa tu resultado preliminar y su detalle</td></tr>` +
      `<tr><td style="padding:5px 0;border-bottom:1px solid #e5e1dc;">2 · Conversa la retroalimentación con tu jefe directo</td></tr>` +
      `<tr><td style="padding:5px 0;">3 · Da tu conformidad o deja tus comentarios sobre la calificación</td></tr>` +
      `</table>`,
    ) +
    parrafo('Es una <b>vista previa</b>: la nota final se publica al cierre del ciclo, después de la calibración de RR.HH.') +
    botonCta('Ver mi resultado preliminar', '/mi-resultado'),
  )
  return {
    to: email,
    asunto: `Tu nota preliminar del ${ciclo} ya está disponible — CENIT`,
    texto: `Hola, ${nombre}:\n\nSe completaron todas tus evaluaciones y logros del ciclo ${ciclo}, y tu nota preliminar ya está visible en la plataforma, con el detalle por competencias y objetivos.\n\nQué sigue:\n1. Revisa tu resultado preliminar y su detalle\n2. Conversa la retroalimentación con tu jefe directo\n3. Da tu conformidad o deja tus comentarios sobre la calificación\n\nEs una vista previa: la nota final se publica al cierre del ciclo, después de la calibración de RR.HH.`,
    html,
  }
}

/** Aviso al colaborador: se completaron todos sus insumos del ciclo y su nota preliminar ya es visible. */
export async function enviarNotaPreliminarDisponible(email: string, nombre: string, ciclo: string): Promise<void> {
  if (modoConsola(`\n📧 [Nota preliminar] Para ${nombre} <${email}>: ciclo ${ciclo} disponible\n`)) return
  const correo = construirNotaPreliminarDisponible(email, nombre, ciclo)
  await enviar(correo.to, correo.asunto, correo.texto, correo.html)
}
