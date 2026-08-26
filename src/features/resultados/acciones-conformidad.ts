'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/shared/lib/prisma'
import { requiereSesion } from '@/shared/lib/permisos'
import { paisCongelado } from '@/features/ciclos/congelamiento'

type Resp = { ok: true } | { ok: false; error: string }

/** Valida que el colaborador de la sesión pueda registrar su decisión sobre la nota del ciclo:
 * resultado propio con nota, ciclo ACTIVO (pre-cierre) y sin decisión previa (es ÚNICA). */
async function resultadoDecidible(cicloId: string) {
  const sesion = await requiereSesion()
  const resultado = await prisma.resultado.findUnique({
    where: { cicloId_colaboradorId: { cicloId, colaboradorId: sesion.colaboradorId } },
    include: {
      ciclo: { select: { estado: true, nombre: true } },
      colaborador: { select: { paisId: true } },
    },
  })
  if (!resultado || resultado.notaFinal === null) return { error: 'Tu nota de este ciclo aún no está completa.' }
  if (resultado.ciclo.estado !== 'ACTIVO') return { error: 'El ciclo ya no está activo: tu nota quedó registrada con el cierre.' }
  // País cerrado = mismo tratamiento que ciclo cerrado: la nota ya está congelada
  if (await paisCongelado(cicloId, resultado.colaborador.paisId)) {
    return { error: 'Tu país ya cerró este ciclo: tu nota quedó registrada con el cierre.' }
  }
  if (resultado.conformidad !== null) return { error: 'Ya registraste tu decisión sobre esta nota; queda como registro y no puede cambiarse.' }
  return { error: undefined, sesion, resultado }
}

/** El colaborador da conformidad con su nota (vista previa, pre-cierre). Decisión única y auditable. */
export async function darConformidadNota(cicloId: string): Promise<Resp> {
  const v = await resultadoDecidible(cicloId)
  if (v.error !== undefined) return { ok: false, error: v.error }
  // Condicionado a conformidad null: dos decisiones simultáneas (doble clic / dos pestañas) leían
  // ambas `conformidad=null` y escribían las dos, dejando el AuditLog con una CONFORMIDAD y una
  // OBSERVADA contradictorias para la misma nota. El updateMany atómico deja pasar solo a la primera.
  const aplicado = await prisma.resultado.updateMany({
    where: { id: v.resultado.id, conformidad: null },
    data: { conformidad: 'CONFORME', conformidadEn: new Date(), observacion: null, notaAceptada: v.resultado.notaCalibrada ?? v.resultado.notaFinal },
  })
  if (aplicado.count === 0) return { ok: false, error: 'Ya registraste tu decisión sobre esta nota; queda como registro y no puede cambiarse.' }
  await prisma.auditLog.create({
    data: {
      usuarioId: v.sesion.id,
      accion: 'NOTA_CONFORMIDAD',
      entidad: v.resultado.id,
      detalle: { ciclo: v.resultado.ciclo.nombre, nota: v.resultado.notaCalibrada ?? v.resultado.notaFinal },
    },
  })
  revalidatePath('/mi-resultado')
  return { ok: true }
}

/** El colaborador OBSERVA su nota con un comentario obligatorio: insumo de la calibración de RR.HH. */
export async function observarNota(cicloId: string, comentario: string): Promise<Resp> {
  const texto = comentario.trim()
  if (texto.length < 10) return { ok: false, error: 'Escribe tu comentario (mínimo 10 caracteres).' }
  if (texto.length > 2000) return { ok: false, error: 'El comentario no puede superar los 2000 caracteres.' }
  const v = await resultadoDecidible(cicloId)
  if (v.error !== undefined) return { ok: false, error: v.error }
  const aplicado = await prisma.resultado.updateMany({
    where: { id: v.resultado.id, conformidad: null },
    data: { conformidad: 'OBSERVADO', conformidadEn: new Date(), observacion: texto, notaAceptada: v.resultado.notaCalibrada ?? v.resultado.notaFinal },
  })
  if (aplicado.count === 0) return { ok: false, error: 'Ya registraste tu decisión sobre esta nota; queda como registro y no puede cambiarse.' }
  await prisma.auditLog.create({
    data: {
      usuarioId: v.sesion.id,
      accion: 'NOTA_OBSERVADA',
      entidad: v.resultado.id,
      detalle: { ciclo: v.resultado.ciclo.nombre, nota: v.resultado.notaCalibrada ?? v.resultado.notaFinal, observacion: texto },
    },
  })
  revalidatePath('/mi-resultado')
  return { ok: true }
}
