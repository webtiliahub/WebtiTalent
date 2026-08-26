'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin, cicloFueraDeAlcance } from '@/shared/lib/permisos'
import { construirRecordatorioEvaluaciones, enviarBatch } from '@/shared/lib/mailer'
import { enviarPushACorreos } from '@/shared/lib/push'
import { pendientesEvaluaciones } from '@/features/recordatorios/pendientes'
import { diasRestantes } from '@/features/recordatorios/hitos'

/** Recordatorio MANUAL de evaluaciones pendientes (botón del recuadro de recordatorios del
 * ciclo): mismo correo y push que el motor automático, disparado por RR.HH. cuando lo necesita
 * (mismo patrón que `enviarRecordatoriosPeriodo` en objetivos). Queda en `RecordatorioEnvio`
 * con hito MANUAL —visible en la card junto a los automáticos— y en el log de auditoría. */
export async function enviarRecordatorioEvaluacionesManual(cicloId: string) {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  const ciclo = await prisma.ciclo.findUnique({ where: { id: cicloId } })
  if (!ciclo || ciclo.estado !== 'ACTIVO') return { ok: false as const, error: 'El ciclo no está activo' }
  if (cicloFueraDeAlcance(sesion, ciclo)) return { ok: false as const, error: 'Ese ciclo está fuera de tu país' }

  const { destinatarios, sinCuenta } = await pendientesEvaluaciones(cicloId)
  if (destinatarios.length === 0) {
    return { ok: false as const, error: 'Nadie tiene evaluaciones pendientes con cuenta activa: no hay a quién recordar' }
  }

  const hoy = new Date()
  const dias = diasRestantes(ciclo.fechaFin, hoy)
  const deadlineTexto = ciclo.fechaFin.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })
  const { enviados, fallidos, erroresMuestra } = await enviarBatch(
    destinatarios.map((d) => construirRecordatorioEvaluaciones(d.email, d.nombre, ciclo.nombre, deadlineTexto, d.pendientes, dias, false)),
  )
  const push = await enviarPushACorreos(destinatarios.map((d) => d.email), {
    titulo: 'Tienes evaluaciones pendientes',
    cuerpo: `${ciclo.nombre} · responde antes del ${deadlineTexto}`,
    ruta: '/evaluaciones',
    etiqueta: 'evaluaciones',
  }).catch(() => null)

  await prisma.recordatorioEnvio.create({
    data: {
      proceso: 'EVALUACIONES', referencia: cicloId, hito: 'MANUAL', fecha: hoy,
      enviados, fallidos,
      detalleJson: { destinatarios: destinatarios.length, sinCuenta, erroresMuestra, push: push?.enviados ?? 0, por: sesion.id },
    },
  })
  await prisma.auditLog.create({
    data: { usuarioId: sesion.id, accion: 'CICLO_RECORDATORIO_MANUAL', entidad: cicloId, detalle: { ciclo: ciclo.nombre, enviados, fallidos, sinCuenta } },
  })
  revalidatePath(`/admin/ciclos/${cicloId}`)
  return { ok: true as const, enviados, fallidos, sinCuenta }
}
