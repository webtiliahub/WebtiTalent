import { prisma } from '@/shared/lib/prisma'
import { construirParAsignado, enviarBatch } from '@/shared/lib/mailer'
import { enviarPushACorreos } from '@/shared/lib/push'

/** Aviso (correo + push) al colaborador que ACABA de quedar como PAR evaluador: lo llaman
 * `nominarPar` (nominación directa del jefe), `asignarPar` (RR.HH.) y `aprobarPar` (propuesta
 * aprobada), siempre dentro de `after()` — el aviso no puede frenar ni romper la asignación.
 * Una PROPUESTA no avisa: el par no ve la evaluación hasta que RR.HH. la apruebe.
 * Sin cuenta activa no hay a quién avisar (verá la evaluación al recibir su acceso). */
export async function notificarParAsignado(cicloId: string, evaluadorId: string, evaluadoId: string): Promise<{ enviados: number }> {
  const [ciclo, evaluador, evaluado] = await Promise.all([
    prisma.ciclo.findUnique({ where: { id: cicloId }, select: { nombre: true, fechaFin: true } }),
    prisma.colaborador.findUnique({
      where: { id: evaluadorId },
      select: { nombres: true, apellidos: true, usuario: { select: { email: true, activo: true } } },
    }),
    prisma.colaborador.findUnique({ where: { id: evaluadoId }, select: { nombres: true, apellidos: true } }),
  ])
  if (!ciclo || !evaluador || !evaluado) return { enviados: 0 }
  if (!evaluador.usuario?.activo || !evaluador.usuario.email) return { enviados: 0 }

  const deadlineTexto = ciclo.fechaFin.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })
  const nombreEvaluado = `${evaluado.nombres} ${evaluado.apellidos}`
  const r = await enviarBatch([
    construirParAsignado(evaluador.usuario.email, `${evaluador.nombres} ${evaluador.apellidos}`, nombreEvaluado, ciclo.nombre, deadlineTexto),
  ])
  // El push acompaña al correo: es el aviso que más gana con llegar al instante
  await enviarPushACorreos([evaluador.usuario.email], {
    titulo: 'Te asignaron como par evaluador',
    cuerpo: `${nombreEvaluado} · completa su evaluación antes del ${deadlineTexto}`,
    ruta: '/evaluaciones',
    etiqueta: 'evaluaciones',
  }).catch(() => null)
  return { enviados: r.enviados }
}
