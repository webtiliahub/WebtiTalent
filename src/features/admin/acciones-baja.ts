'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin, fueraDeAlcancePais, errorDeAlcance } from '@/shared/lib/permisos'


type Resp = { ok: true } | { ok: false; error: string }

/** Da de BAJA a un colaborador (soft-delete): sale del padrón activo (cobertura de objetivos,
 * ciclos nuevos, listas) y pasa al archivo de desactivados. En el mismo paso se desactiva su
 * cuenta de acceso y su equipo queda «sin jefe directo» (lo cubre RR.HH. hasta reasignar).
 * Si participa en un ciclo ACTIVO, el bloque Rotación del ciclo detecta el caso y RR.HH.
 * decide ahí qué hacer con sus evaluaciones. */
export async function darDeBajaColaborador(colaboradorId: string): Promise<Resp> {
  const sesion = await requiereAdmin('COLABORADORES', 'GESTIONAR')
  const colaborador = await prisma.colaborador.findUnique({
    where: { id: colaboradorId },
    include: { usuario: { select: { id: true, activo: true, alcanceRrhh: true } }, _count: { select: { equipo: { where: { activo: true } } } } },
  })
  if (!colaborador || !colaborador.activo) return { ok: false, error: 'Colaborador no encontrado o ya dado de baja' }
  if (fueraDeAlcancePais(sesion, colaborador.paisId)) return { ok: false, error: 'Ese colaborador está fuera de tu país' }
  if (colaborador.id === sesion.colaboradorId) return { ok: false, error: 'No puedes darte de baja a ti mismo' }
  // La baja DESACTIVA la cuenta de acceso: no puede alcanzar a un RR.HH. que este rol no
  // administraría desde Usuarios (un rol con COLABORADORES:GESTIONAR podía tumbar a un Regional)
  if (colaborador.usuario && errorDeAlcance(sesion, { alcanceRrhh: colaborador.usuario.alcanceRrhh, colaborador: { paisId: colaborador.paisId } })) {
    return { ok: false, error: 'Esa persona tiene una cuenta que no puedes administrar: da de baja su cuenta desde Usuarios primero' }
  }

  await prisma.$transaction(async (tx) => {
    await tx.colaborador.update({ where: { id: colaboradorId }, data: { activo: false, bajaEn: new Date() } })
    // Su equipo queda sin jefe directo: RR.HH. cubre aprobaciones y feedback hasta reasignar
    await tx.colaborador.updateMany({ where: { jefeId: colaboradorId }, data: { jefeId: null } })
    if (colaborador.usuario?.activo) {
      await tx.usuario.update({ where: { id: colaborador.usuario.id }, data: { activo: false } })
    }
    await tx.auditLog.create({
      data: {
        usuarioId: sesion.id,
        accion: 'COLABORADOR_BAJA',
        entidad: colaboradorId,
        detalle: {
          nombre: `${colaborador.nombres} ${colaborador.apellidos}`,
          documento: colaborador.documento,
          equipoQuedoSinJefe: colaborador._count.equipo,
          cuentaDesactivada: !!colaborador.usuario?.activo,
        },
      },
    })
  })
  revalidatePath('/admin/colaboradores')
  revalidatePath(`/admin/colaboradores/${colaboradorId}`)
  return { ok: true }
}

/** Reactiva a un colaborador del archivo (reingreso o baja por error). La cuenta de acceso
 * se reactiva por separado en «Usuarios y acceso»; jefe y equipo se reasignan editándolo. */
export async function reactivarColaborador(colaboradorId: string): Promise<Resp> {
  const sesion = await requiereAdmin('COLABORADORES', 'GESTIONAR')
  const colaborador = await prisma.colaborador.findUnique({ where: { id: colaboradorId } })
  if (!colaborador || colaborador.activo) return { ok: false, error: 'Colaborador no encontrado o ya activo' }
  if (fueraDeAlcancePais(sesion, colaborador.paisId)) return { ok: false, error: 'Ese colaborador está fuera de tu país' }

  await prisma.colaborador.update({ where: { id: colaboradorId }, data: { activo: true, bajaEn: null } })
  await prisma.auditLog.create({
    data: {
      usuarioId: sesion.id,
      accion: 'COLABORADOR_REACTIVADO',
      entidad: colaboradorId,
      detalle: { nombre: `${colaborador.nombres} ${colaborador.apellidos}`, documento: colaborador.documento },
    },
  })
  revalidatePath('/admin/colaboradores')
  revalidatePath('/admin/colaboradores/inactivos')
  return { ok: true }
}
