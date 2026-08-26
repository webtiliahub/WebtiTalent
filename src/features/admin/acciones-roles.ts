'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/shared/lib/prisma'
import { requiereRrhh } from '@/shared/lib/permisos'
import { validarPermisosRol } from '@/shared/lib/permisos-admin'

/** Gestión de roles del admin: EXCLUSIVA del rol de sistema RR.HH. (anti-escalada del spec). */

function parsear(formData: FormData) {
  const nombre = String(formData.get('nombre') ?? '').trim()
  const descripcion = String(formData.get('descripcion') ?? '').trim() || null
  let permisos: unknown
  try { permisos = JSON.parse(String(formData.get('permisos') ?? '{}')) } catch { permisos = null }
  return { nombre, descripcion, permisos }
}

export async function crearRol(formData: FormData) {
  const sesion = await requiereRrhh()
  const { nombre, descripcion, permisos } = parsear(formData)
  if (nombre.length < 3) return { ok: false as const, error: 'Escribe el nombre del rol (mínimo 3 caracteres)' }
  const valida = validarPermisosRol(permisos)
  if (!valida.ok) return { ok: false as const, error: valida.error }
  try {
    await prisma.rolAdmin.create({ data: { nombre, descripcion, permisos: valida.permisos } })
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') return { ok: false as const, error: 'Ya existe un rol con ese nombre' }
    throw e
  }
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'ROL_CREADO', detalle: { nombre, permisos: valida.permisos } } })
  revalidatePath('/admin/configuracion')
  return { ok: true as const }
}

export async function editarRol(rolId: string, formData: FormData) {
  const sesion = await requiereRrhh()
  const rol = await prisma.rolAdmin.findUnique({ where: { id: rolId }, include: { usuarios: { where: { id: sesion.id }, select: { id: true } } } })
  if (!rol) return { ok: false as const, error: 'Rol no encontrado' }
  if (rol.esSistema) return { ok: false as const, error: 'El rol de sistema no se puede editar' }
  if (rol.usuarios.length > 0) return { ok: false as const, error: 'No puedes editar tu propio rol' }
  const { nombre, descripcion, permisos } = parsear(formData)
  if (nombre.length < 3) return { ok: false as const, error: 'Escribe el nombre del rol (mínimo 3 caracteres)' }
  const valida = validarPermisosRol(permisos)
  if (!valida.ok) return { ok: false as const, error: valida.error }
  try {
    await prisma.rolAdmin.update({ where: { id: rolId }, data: { nombre, descripcion, permisos: valida.permisos } })
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') return { ok: false as const, error: 'Ya existe un rol con ese nombre' }
    throw e
  }
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'ROL_ACTUALIZADO', detalle: { nombre, antes: rol.permisos, despues: valida.permisos } } })
  revalidatePath('/admin/configuracion')
  return { ok: true as const }
}

export async function eliminarRol(rolId: string) {
  const sesion = await requiereRrhh()
  const rol = await prisma.rolAdmin.findUnique({ where: { id: rolId }, include: { _count: { select: { usuarios: true } } } })
  if (!rol) return { ok: false as const, error: 'Rol no encontrado' }
  if (rol.esSistema) return { ok: false as const, error: 'El rol de sistema no se puede eliminar' }
  if (rol._count.usuarios > 0) return { ok: false as const, error: `Ese rol tiene ${rol._count.usuarios} usuario${rol._count.usuarios === 1 ? '' : 's'} asignado${rol._count.usuarios === 1 ? '' : 's'}: reasígnalos antes de eliminarlo` }
  await prisma.rolAdmin.delete({ where: { id: rolId } })
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'ROL_ELIMINADO', detalle: { nombre: rol.nombre } } })
  revalidatePath('/admin/configuracion')
  return { ok: true as const }
}
