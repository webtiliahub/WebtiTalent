import { prisma } from '@/shared/lib/prisma'

/**
 * Retención del log de auditoría. Con el rastro de accesos, el log recibe dos entradas por cada
 * inicio de sesión: con ~800 personas, la tabla crecería sin techo y lo importante quedaría
 * sepultado entre ruido.
 *
 * Tres niveles, y el criterio es el VALOR PROBATORIO, no la antigüedad:
 *  - PERMANENTE: todo lo que toca una evaluación o su resultado. Es lo que sostiene una nota si
 *    alguien la impugna dentro de tres años («yo no calificé así a mi equipo», «esa calibración no
 *    la pedí»), así que no caduca nunca.
 *  - RUIDO: entradas que pesan por volumen y no por contenido. Se conservan lo justo para
 *    investigar un incidente reciente.
 *  - GENERAL: el resto (altas y bajas de personas, cuentas, roles, catálogos, importaciones,
 *    cambios de contraseña y los intentos de acceso FALLIDOS, que sí son señal de seguridad).
 */

/** Prefijos cuyas acciones no caducan: definen el instrumento, quién evaluó a quién, o la nota. */
const PERMANENTES = [
  'CICLO_',              // creación, edición, lanzamiento, cierre, publicación por país, rotación
  'EVALUACION_',         // invalidada / rehabilitada por un incidente
  'CALIBRACION',         // ajuste de nota con su motivo
  'NOTA_',               // conformidad u observación del colaborador sobre su nota
  'CONFORMIDAD_',        // exenciones y su retirada
  'PAR_',                // nominación, aprobación, rechazo y retiro de pares
  'PERIODO_',            // los objetivos del período entran en la nota final
  'OBJETIVO_',           // edición/eliminación de objetivos por RR.HH. tras el cierre (peso/título)
  'CONFIG_',             // los pesos por modalidad son insumo directo de toda nota
  'BANCO_',              // el banco de preguntas define el instrumento evaluado
  'DIMENSION_',          // idem: la estructura del desglose por dimensión
  'NIVEL_',              // qué evaluación aplica a cada nivel
  'RESULTADOS_PUBLICADOS',
] as const

/* Ruido de sistema, 90 días: alto volumen y sin valor probatorio.
 * LOGIN_OK NO está aquí a propósito: prueba quién abrió la sesión que envió una evaluación, así que
 * se retiene con el resto (12 meses). Lo diario que sí es ruido es la EMISIÓN del código —que no
 * implica acceso— y los recordatorios, cuyo detalle útil ya vive en RecordatorioEnvio. */
const RUIDO = [
  'LOGIN_CODIGO_EMITIDO',
  'PERIODO_RECORDATORIOS',
] as const

export const DIAS_RUIDO = 90
export const DIAS_GENERAL = 365

export type NivelRetencion = 'permanente' | 'ruido' | 'general'

/** El RUIDO manda sobre los prefijos: `PERIODO_RECORDATORIOS` empieza por un prefijo permanente
 *  pero no prueba nada de una evaluación. */
export function nivelDeRetencion(accion: string): NivelRetencion {
  if ((RUIDO as readonly string[]).includes(accion)) return 'ruido'
  if (PERMANENTES.some((p) => accion.startsWith(p))) return 'permanente'
  return 'general'
}

const hace = (dias: number) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000)

/** Purga según la política. La llama el cron diario; devuelve lo borrado para el resumen. */
export async function purgarAuditLog(): Promise<{ ruido: number; general: number }> {
  const ruido = await prisma.auditLog.deleteMany({
    where: { accion: { in: [...RUIDO] }, createdAt: { lt: hace(DIAS_RUIDO) } },
  })
  const general = await prisma.auditLog.deleteMany({
    where: {
      createdAt: { lt: hace(DIAS_GENERAL) },
      // Ni lo permanente ni el ruido (que ya tiene su propia ventana, más corta)
      NOT: {
        OR: [
          ...PERMANENTES.map((prefijo) => ({ accion: { startsWith: prefijo } })),
          { accion: { in: [...RUIDO] } },
        ],
      },
    },
  })
  return { ruido: ruido.count, general: general.count }
}
