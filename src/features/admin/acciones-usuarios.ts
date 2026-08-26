'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { randomInt } from 'crypto'
import { prisma } from '@/shared/lib/prisma'
import { requiereRrhh, requiereSesion, alcancePaisWhere, errorDeAlcance } from '@/shared/lib/permisos'
import type { SesionUsuario } from '@/shared/lib/auth'
import { enviarCredenciales } from '@/shared/lib/mailer'
import { esquemaPasswordNueva } from '@/shared/lib/password'

export type Credencial = { nombre: string; email: string; passwordTemporal: string }

/** Contraseña temporal legible (sin caracteres ambiguos O/0, l/1…), ~70 bits de entropía. */
function generarPasswordTemporal() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  return Array.from({ length: 12 }, () => alfabeto[randomInt(alfabeto.length)]).join('')
}

function esDuplicado(e: unknown) {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'P2002'
}

// ── Alcance: RR.HH. de país solo administra cuentas de su país y nunca otorga/toca acceso regional ──

const esRegional = (s: SesionUsuario) => s.alcanceRrhh === 'REGIONAL'

/** Error si el acceso a otorgar excede lo que el caller puede conceder; null si está permitido.
 * Aplica a cualquier acceso con alcance definido: RR.HH. o un colaborador con rol admin asignado
 * (mismo requisito de alcance que RR.HH., misma restricción al otorgarlo). */
function errorAlOtorgar(sesion: SesionUsuario, acceso: { alcanceRrhh: string | null; alcancePaisId: string | null }) {
  if (esRegional(sesion) || !acceso.alcanceRrhh) return null
  if (acceso.alcanceRrhh === 'REGIONAL') return 'Solo RR.HH. Regional puede otorgar alcance regional'
  if (acceso.alcancePaisId !== sesion.alcancePaisId) return 'Solo puedes otorgar alcance de tu propio país'
  return null
}

/** Error si el rol admin elegido no existe o es el de sistema (no asignable); null si es válido. */
async function errorDeRolAdmin(rolAdminId: string | null) {
  if (!rolAdminId) return null
  const rolAdmin = await prisma.rolAdmin.findUnique({ where: { id: rolAdminId } })
  if (!rolAdmin || rolAdmin.esSistema) return 'Rol de administración no válido'
  return null
}

const esquemaAcceso = z
  .object({
    rol: z.enum(['RRHH', 'COLABORADOR']),
    rolAdminId: z.string().trim().optional(),
    alcanceRrhh: z.enum(['REGIONAL', 'PAIS']).optional(),
    alcancePaisId: z.string().trim().optional(),
  })
  .transform((d) => {
    // rolAdminId solo aplica a COLABORADOR: RR.HH. es el rol de sistema y ya implica todo.
    const rolAdminId = d.rol === 'RRHH' ? null : d.rolAdminId?.trim() || null
    // El alcance (Regional / un país) aplica a RR.HH. siempre, y a un colaborador con rol admin
    // asignado (mismo requisito: necesita un ámbito de datos definido para poder administrarlos).
    if (d.rol !== 'RRHH' && !rolAdminId) return { rol: d.rol, rolAdminId, alcanceRrhh: null, alcancePaisId: null }
    const alcance = d.alcanceRrhh ?? 'REGIONAL'
    return { rol: d.rol, rolAdminId, alcanceRrhh: alcance, alcancePaisId: alcance === 'PAIS' ? d.alcancePaisId || null : null }
  })
  .refine((d) => d.alcanceRrhh !== 'PAIS' || !!d.alcancePaisId, {
    message: 'Selecciona el país para el alcance',
  })

// ───────────── Alta individual ─────────────

export async function crearUsuario(formData: FormData) {
  const sesion = await requiereRrhh()
  const base = z
    .object({ colaboradorId: z.string().min(1, 'Selecciona un colaborador'), email: z.string().trim().toLowerCase().email('Correo inválido') })
    .safeParse(Object.fromEntries(formData))
  if (!base.success) return { ok: false as const, error: base.error.issues[0].message }
  const acceso = esquemaAcceso.safeParse(Object.fromEntries(formData))
  if (!acceso.success) return { ok: false as const, error: acceso.error.issues[0].message }

  const colaborador = await prisma.colaborador.findUnique({ where: { id: base.data.colaboradorId }, include: { usuario: true } })
  if (!colaborador || !colaborador.activo) return { ok: false as const, error: 'Colaborador no encontrado o inactivo' }
  if (colaborador.usuario) return { ok: false as const, error: 'Este colaborador ya tiene cuenta' }
  if (!esRegional(sesion) && colaborador.paisId !== sesion.alcancePaisId) {
    return { ok: false as const, error: 'Colaborador fuera de tu alcance' }
  }
  const noAutorizado = errorAlOtorgar(sesion, acceso.data)
  if (noAutorizado) return { ok: false as const, error: noAutorizado }
  const errorRolAdmin = await errorDeRolAdmin(acceso.data.rolAdminId)
  if (errorRolAdmin) return { ok: false as const, error: errorRolAdmin }

  const passwordTemporal = generarPasswordTemporal()
  try {
    await prisma.usuario.create({
      data: {
        email: base.data.email,
        passwordHash: await bcrypt.hash(passwordTemporal, 10),
        debeCambiarPassword: true,
        colaboradorId: colaborador.id,
        ...acceso.data,
      },
    })
  } catch (e) {
    if (esDuplicado(e)) return { ok: false as const, error: 'Ya existe una cuenta con ese correo' }
    throw e
  }

  const nombre = `${colaborador.nombres} ${colaborador.apellidos}`
  await enviarCredenciales(base.data.email, nombre, passwordTemporal)
  await prisma.auditLog.create({
    data: { usuarioId: sesion.id, accion: 'USUARIO_CREADO', detalle: { email: base.data.email, rol: acceso.data.rol, rolAdminId: acceso.data.rolAdminId } },
  })
  revalidatePath('/admin/configuracion')
  return { ok: true as const, credencial: { nombre, email: base.data.email, passwordTemporal } satisfies Credencial }
}

// ───────────── Edición de rol / alcance ─────────────

export async function editarAccesoUsuario(usuarioId: string, formData: FormData) {
  const sesion = await requiereRrhh()
  const acceso = esquemaAcceso.safeParse(Object.fromEntries(formData))
  if (!acceso.success) return { ok: false as const, error: acceso.error.issues[0].message }
  const target = await prisma.usuario.findUnique({ where: { id: usuarioId }, include: { colaborador: true } })
  if (!target) return { ok: false as const, error: 'Usuario no encontrado' }
  if (usuarioId === sesion.id) {
    if (acceso.data.rol !== 'RRHH') return { ok: false as const, error: 'No puedes quitarte tu propio rol de RR.HH.' }
    if (acceso.data.rolAdminId !== target.rolAdminId) return { ok: false as const, error: 'No puedes cambiar tu propio rol' }
  }
  const fueraDeAlcance = errorDeAlcance(sesion, target)
  if (fueraDeAlcance) return { ok: false as const, error: fueraDeAlcance }
  const noAutorizado = errorAlOtorgar(sesion, acceso.data)
  if (noAutorizado) return { ok: false as const, error: noAutorizado }
  const errorRolAdmin = await errorDeRolAdmin(acceso.data.rolAdminId)
  if (errorRolAdmin) return { ok: false as const, error: errorRolAdmin }
  const usuario = await prisma.usuario.update({ where: { id: usuarioId }, data: acceso.data })
  await prisma.auditLog.create({
    data: { usuarioId: sesion.id, accion: 'USUARIO_ACCESO_EDITADO', detalle: { email: usuario.email, rol: acceso.data.rol, alcance: acceso.data.alcanceRrhh } },
  })
  if (target.rolAdminId !== acceso.data.rolAdminId) {
    await prisma.auditLog.create({
      data: { usuarioId: sesion.id, accion: 'USUARIO_ROL_ADMIN', detalle: { email: usuario.email, antes: target.rolAdminId, despues: acceso.data.rolAdminId } },
    })
  }
  revalidatePath('/admin/configuracion')
  return { ok: true as const }
}

export async function alternarActivoUsuario(usuarioId: string) {
  const sesion = await requiereRrhh()
  if (usuarioId === sesion.id) return { ok: false as const, error: 'No puedes desactivar tu propia cuenta' }
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId }, include: { colaborador: true } })
  if (!usuario) return { ok: false as const, error: 'Usuario no encontrado' }
  const fueraDeAlcance = errorDeAlcance(sesion, usuario)
  if (fueraDeAlcance) return { ok: false as const, error: fueraDeAlcance }
  await prisma.usuario.update({ where: { id: usuarioId }, data: { activo: !usuario.activo } })
  await prisma.auditLog.create({
    data: { usuarioId: sesion.id, accion: usuario.activo ? 'USUARIO_DESACTIVADO' : 'USUARIO_REACTIVADO', detalle: { email: usuario.email } },
  })
  revalidatePath('/admin/configuracion')
  return { ok: true as const }
}

export async function resetearPasswordUsuario(usuarioId: string) {
  const sesion = await requiereRrhh()
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId }, include: { colaborador: true } })
  if (!usuario) return { ok: false as const, error: 'Usuario no encontrado' }
  const fueraDeAlcance = errorDeAlcance(sesion, usuario)
  if (fueraDeAlcance) return { ok: false as const, error: fueraDeAlcance }

  const passwordTemporal = generarPasswordTemporal()
  await prisma.usuario.update({
    where: { id: usuarioId },
    // passwordChangedAt nuevo invalida cualquier sesión viva del usuario (clave si la cuenta fue comprometida)
    data: { passwordHash: await bcrypt.hash(passwordTemporal, 10), debeCambiarPassword: true, passwordChangedAt: new Date() },
  })
  const nombre = usuario.colaborador ? `${usuario.colaborador.nombres} ${usuario.colaborador.apellidos}` : usuario.email
  await enviarCredenciales(usuario.email, nombre, passwordTemporal)
  await prisma.auditLog.create({
    data: { usuarioId: sesion.id, accion: 'USUARIO_PASSWORD_RESET', detalle: { email: usuario.email } },
  })
  revalidatePath('/admin/configuracion')
  return { ok: true as const, credencial: { nombre, email: usuario.email, passwordTemporal } satisfies Credencial }
}

// ───────────── Aprovisionamiento masivo ─────────────

/**
 * Crea cuentas (rol COLABORADOR) para todos los colaboradores activos con correo y sin usuario,
 * dentro del alcance de país del RR.HH. Devuelve las credenciales temporales UNA sola vez
 * (para el CSV descargable) y envía el correo a cada uno.
 */
export async function aprovisionarCuentas() {
  const sesion = await requiereRrhh()
  const pendientes = await prisma.colaborador.findMany({
    where: { activo: true, usuario: null, email: { not: null }, ...alcancePaisWhere(sesion) },
    orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
  })
  const sinCorreo = await prisma.colaborador.count({
    where: { activo: true, usuario: null, email: null, ...alcancePaisWhere(sesion) },
  })

  const credenciales: Credencial[] = []
  const errores: string[] = []
  for (const c of pendientes) {
    const passwordTemporal = generarPasswordTemporal()
    const nombre = `${c.nombres} ${c.apellidos}`
    try {
      await prisma.usuario.create({
        data: {
          email: c.email!.toLowerCase(),
          passwordHash: await bcrypt.hash(passwordTemporal, 10),
          debeCambiarPassword: true,
          rol: 'COLABORADOR',
          colaboradorId: c.id,
        },
      })
    } catch (e) {
      if (esDuplicado(e)) { errores.push(`${nombre}: ya existe una cuenta con ${c.email}`); continue }
      throw e
    }
    await enviarCredenciales(c.email!, nombre, passwordTemporal)
    credenciales.push({ nombre, email: c.email!.toLowerCase(), passwordTemporal })
  }

  await prisma.auditLog.create({
    data: { usuarioId: sesion.id, accion: 'CUENTAS_APROVISIONADAS', detalle: { creadas: credenciales.length, sinCorreo, errores: errores.length } },
  })
  revalidatePath('/admin/configuracion')
  return { ok: true as const, credenciales, sinCorreo, errores }
}

// ───────────── Cambio de contraseña del propio usuario ─────────────

export async function cambiarMiPassword(formData: FormData) {
  const sesion = await requiereSesion()
  const datos = z
    .object({
      password: esquemaPasswordNueva,
      confirmar: z.string(),
      actual: z.string().optional(),
    })
    .refine((d) => d.password === d.confirmar, { message: 'Las contraseñas no coinciden' })
    .safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }

  const usuario = await prisma.usuario.findUnique({ where: { id: sesion.id } })
  if (!usuario) return { ok: false as const, error: 'Usuario no encontrado' }
  // Cambio voluntario (no temporal): exige la contraseña actual, para que una sesión robada o
  // un dispositivo desatendido no pueda apropiarse de la cuenta cambiando la clave.
  if (!usuario.debeCambiarPassword) {
    const actualValida = datos.data.actual ? await bcrypt.compare(datos.data.actual, usuario.passwordHash) : false
    if (!actualValida) return { ok: false as const, error: 'La contraseña actual es incorrecta' }
  }

  // No reutilizar las 2 últimas (la actual + las guardadas en el historial)
  const recientes = [usuario.passwordHash, ...usuario.passwordAnteriores].slice(0, 2)
  for (const previa of recientes) {
    if (await bcrypt.compare(datos.data.password, previa)) {
      return { ok: false as const, error: 'No puedes reutilizar ninguna de tus dos últimas contraseñas' }
    }
  }

  await prisma.usuario.update({
    where: { id: sesion.id },
    data: {
      passwordHash: await bcrypt.hash(datos.data.password, 10),
      debeCambiarPassword: false,
      passwordChangedAt: new Date(),
      // Rota el historial: la contraseña que sale pasa al frente, se conservan 2
      passwordAnteriores: [usuario.passwordHash, ...usuario.passwordAnteriores].slice(0, 2),
    },
  })
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'PASSWORD_CAMBIADO' } })
  return { ok: true as const }
}
