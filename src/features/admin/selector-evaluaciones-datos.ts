import { prisma } from '@/shared/lib/prisma'
import type { NivelW } from './WizardCiclo'

/** Datos del selector de evaluaciones por nivel (evaluaciones activas con preguntas + excepciones
 * por puesto + conteo de colaboradores). Compartido por el wizard de creación y la edición
 * del ciclo en borrador. */
export async function nivelesParaSelectorEvaluaciones(): Promise<NivelW[]> {
  const [evaluaciones, niveles, colaboradores] = await Promise.all([
    prisma.evaluacion.findMany({
      where: { activa: true },
      include: { preguntas: { select: { preguntaId: true, modalidad: true } } },
      orderBy: { nombre: 'asc' },
    }),
    prisma.nivelJerarquico.findMany({ include: { puestos: { select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } } }, orderBy: { orden: 'asc' } }),
    prisma.colaborador.findMany({ where: { activo: true }, select: { puesto: { select: { nivelId: true } } } }),
  ])

  const colaboradoresPorNivel = new Map<string, number>()
  for (const c of colaboradores) {
    if (!c.puesto) continue
    colaboradoresPorNivel.set(c.puesto.nivelId, (colaboradoresPorNivel.get(c.puesto.nivelId) ?? 0) + 1)
  }

  const conPreguntas = evaluaciones.filter((e) => e.preguntas.length > 0)
  const resumen = (e: (typeof conPreguntas)[number]) => ({
    id: e.id,
    nombre: e.nombre,
    totalPreguntas: new Set(e.preguntas.map((p) => p.preguntaId)).size,
  })

  return niveles.map((n) => ({
    id: n.id,
    nombre: n.nombre,
    colaboradores: colaboradoresPorNivel.get(n.id) ?? 0,
    evaluaciones: conPreguntas.filter((e) => e.nivelId === n.id).map(resumen),
    // Puestos del nivel que tienen evaluación propia activa (excepciones disponibles)
    excepciones: n.puestos
      .map((p) => ({ puestoId: p.id, puesto: p.nombre, evaluaciones: conPreguntas.filter((e) => e.puestoId === p.id).map(resumen) }))
      .filter((p) => p.evaluaciones.length > 0),
  }))
}
