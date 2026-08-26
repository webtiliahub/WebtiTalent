import { Eye } from 'lucide-react'
import { prisma } from '@/shared/lib/prisma'
import { calcularResultado } from '@/features/resultados/servicio'
import { DetalleResultado } from '@/features/resultados/ResultadoColaborador'
import { ConformidadNota } from '@/features/resultados/ConformidadNota'

/** Ciclos ACTIVOS del colaborador con nota preliminar calculable: todas sus evaluaciones
 * enviadas y todos sus objetivos con logro (recalcula de paso, preservando calibraciones).
 * La página lo usa para decidir si muestra la vista previa y colapsa lo publicado. */
export async function ciclosConNotaPreview(colaboradorId: string): Promise<string[]> {
  const yo = await prisma.colaborador.findUnique({ where: { id: colaboradorId }, select: { paisId: true } })
  if (!yo) return []
  const ciclosActivos = await prisma.ciclo.findMany({
    where: {
      estado: 'ACTIVO',
      asignaciones: { some: { evaluadoId: colaboradorId } },
      // País del colaborador ya cerrado = su resultado está congelado (y quizá publicado):
      // ya no es una vista previa — se muestra por el camino de resultados publicados
      cierresPais: { none: { paisId: yo.paisId } },
    },
    select: { id: true },
    orderBy: { fechaInicio: 'desc' },
  })
  const ids: string[] = []
  for (const ciclo of ciclosActivos) {
    // Insumos de evaluación completos = ninguna asignación sin enviar (pendiente, borrador o propuesta de par)
    const sinEnviar = await prisma.asignacion.count({
      where: { cicloId: ciclo.id, evaluadoId: colaboradorId, estado: { notIn: ['ENVIADA', 'INVALIDADA'] } },
    })
    if (sinEnviar > 0) continue
    // Recalcula (idempotente: preserva calibraciones); si faltan logros de objetivos, notaFinal queda null
    const resultado = await calcularResultado(ciclo.id, colaboradorId)
    if (resultado.notaFinal === null) continue
    ids.push(ciclo.id)
  }
  return ids
}

/** Vista previa de la nota durante un ciclo ACTIVO, solo cuando están TODOS los insumos
 * (`cicloIds` viene de ciclosConNotaPreview). Incluye la decisión de conformidad/observación.
 * Aparece únicamente en «Mi resultado» del propio colaborador, antes del cierre. */
export async function PreviewResultado({ colaboradorId, cicloIds }: { colaboradorId: string; cicloIds: string[] }) {
  if (cicloIds.length === 0) return null
  const resultados = await prisma.resultado.findMany({
    where: { colaboradorId, cicloId: { in: cicloIds } },
    include: { ciclo: true },
    orderBy: { ciclo: { fechaInicio: 'desc' } },
  })

  return (
    <div className="mb-5 space-y-5">
      {resultados.map((r) => (
        <section key={r.id} className="space-y-5 rounded-2xl border border-sky-200 bg-sky-50/50 p-4 sm:p-5">
          <div className="rounded-xl bg-white px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-bold">
              <Eye size={15} className="shrink-0 text-sky-600" />
              Vista previa de tu calificación · {r.ciclo.nombre} <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-700">ciclo en curso</span>
            </p>
            <p className="mt-1 text-xs text-gris">
              Ya se registraron todas tus evaluaciones y logros. Esta nota es <b className="text-negro">preliminar</b>: puede ajustarse en la calibración de RR.HH. antes del cierre, y es la base de la conversación con tu jefe en la sesión de feedback.
            </p>
          </div>
          <DetalleResultado resultado={r} propio preview />
          <ConformidadNota
            cicloId={r.cicloId}
            estado={r.conformidad}
            fecha={r.conformidadEn ? r.conformidadEn.toLocaleDateString('es-PE') : null}
            observacion={r.observacion}
            notaAceptada={r.notaAceptada}
          />
        </section>
      ))}
    </div>
  )
}
