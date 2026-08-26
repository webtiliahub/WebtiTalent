'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/shared/lib/prisma'
import { requiereSesion, requiereJefe, alcancePaisWhere } from '@/shared/lib/permisos'
import { tieneAdmin } from '@/shared/lib/permisos-admin'
import type { SesionUsuario } from '@/shared/lib/auth'
import { objetivosAplicables } from '@/features/resultados/servicio'
import { enviarObjetivoAsignado, enviarObjetivoReemplazado, enviarObjetivosAprobados } from '@/shared/lib/mailer'
import { validarVentanaCarga } from './acciones-periodo'
import { estaEnAlcancePeriodo } from './alcance-periodo'

/** El jefe directo gestiona los objetivos de su equipo; RR.HH. —y, SOLO en el camino de
 * gestión (editar/eliminar), un rol con OBJETIVOS:GESTIONAR— cubren a quienes no tienen jefe
 * (p.ej. CEO) y dentro de su alcance de país. El camino de aprobación NUNCA pasa `admiteGestionAdmin`:
 * aprobar propuestas de sin-jefe es proceso exclusivo del rol de sistema RR.HH. */
async function puedeGestionarObjetivosDe(
  sesion: SesionUsuario,
  colaborador: { id: string; jefeId: string | null },
  admiteGestionAdmin = false,
) {
  // Nadie gestiona sus PROPIOS objetivos: un RR.HH. sin jefe (p.ej. el director) se aparecía en su
  // propia lista de «sin jefe» y podía auto-aprobarse o auto-asignarse objetivos con el peso que
  // quisiera — insumo directo de su nota final.
  if (colaborador.id === sesion.colaboradorId) return false
  if (colaborador.jefeId === sesion.colaboradorId) return true
  const cubreSinJefe = sesion.rol === 'RRHH' || (admiteGestionAdmin && tieneAdmin(sesion.permisosAdmin, 'OBJETIVOS', 'GESTIONAR'))
  if (!cubreSinJefe || colaborador.jefeId !== null) return false
  return colaboradorEnAlcance(sesion, colaborador.id)
}

async function colaboradorEnAlcance(sesion: SesionUsuario, colaboradorId: string) {
  const enAlcance = await prisma.colaborador.findFirst({
    where: { id: colaboradorId, ...alcancePaisWhere(sesion, null) },
    select: { id: true },
  })
  return enAlcance !== null
}

/** El dueño del objetivo (INDIVIDUAL/DESARROLLO) debe estar dentro del alcance del período
 * (foco país/área/nivel + ajustes manuales, país-techo): al crear o editar, nunca a mano. */
async function duenoFueraDeAlcancePeriodo(periodoId: string, colaboradorId: string) {
  const [periodo, dueno] = await Promise.all([
    prisma.periodoObjetivos.findUnique({ where: { id: periodoId } }),
    prisma.colaborador.findUnique({
      where: { id: colaboradorId },
      select: { id: true, activo: true, paisId: true, areaId: true, puesto: { select: { nivelId: true } } },
    }),
  ])
  if (!periodo || !dueno) return true
  return !estaEnAlcancePeriodo(periodo, { ...dueno, nivelId: dueno.puesto?.nivelId ?? null })
}

/** ¿La ventana de carga del colaborador ya no está abierta (plazo vencido sin extensión o período cerrado)?
 * Tras la carga, RR.HH. es el ÚNICO que puede editar/eliminar/reemplazar objetivos (de cualquiera en su alcance). */
async function ventanaColaboradorCerrada(periodoId: string, colaboradorId: string) {
  const periodo = await prisma.periodoObjetivos.findUnique({ where: { id: periodoId } })
  if (!periodo || periodo.estado !== 'CARGA_ABIERTA') return true
  if (periodo.fechaLimiteCarga >= new Date()) return false
  const extension = await prisma.extensionPlazoObjetivos.findUnique({
    where: { periodoId_colaboradorId: { periodoId, colaboradorId } },
  })
  return !(extension && extension.hasta >= new Date())
}

/** RR.HH. —o, en el camino de gestión, un rol con OBJETIVOS:GESTIONAR— gestionando fuera de la
 * ventana de carga (post-carga): cualquiera en su alcance de país. `admiteGestionAdmin` solo lo
 * pasan editar/eliminar; el camino de aprobación no llega aquí. */
async function esGestionRrhhPostCarga(
  sesion: SesionUsuario,
  objetivo: { periodoId: string; colaboradorId: string | null },
  admiteGestionAdmin = false,
) {
  const puedePostCarga = sesion.rol === 'RRHH' || (admiteGestionAdmin && tieneAdmin(sesion.permisosAdmin, 'OBJETIVOS', 'GESTIONAR'))
  if (!puedePostCarga || !objetivo.colaboradorId) return false
  if (!(await ventanaColaboradorCerrada(objetivo.periodoId, objetivo.colaboradorId))) return false
  return colaboradorEnAlcance(sesion, objetivo.colaboradorId)
}

async function auditarGestionRrhh(sesion: SesionUsuario, accion: string, objetivo: { id: string; titulo: string; periodoId: string; colaboradorId: string | null }, detalle?: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: {
      usuarioId: sesion.id,
      accion,
      entidad: `objetivo:${objetivo.id}`,
      detalle: { titulo: objetivo.titulo, periodoId: objetivo.periodoId, colaboradorId: objetivo.colaboradorId, ...detalle },
    },
  })
}

const esquemaProponer = z.object({
  periodoId: z.string().min(1),
  titulo: z.string().trim().min(4, 'Escribe un título para el objetivo').max(300, 'El título es demasiado largo (máximo 300 caracteres)'),
  descripcion: z.string().trim().min(4, 'Describe el objetivo').max(3000, 'La descripción es demasiado larga (máximo 3000 caracteres)'),
  tipo: z.enum(['INDIVIDUAL', 'DESARROLLO']),
  peso: z.coerce.number().int().min(5, 'El peso mínimo es 5%').max(100),
  metaFecha: z.string().trim().max(30).optional(),
  metrica: z.string().trim().max(300).optional(),
})

/** El colaborador propone un objetivo (queda PROPUESTO hasta que su jefe lo apruebe). */
export async function proponerObjetivo(formData: FormData) {
  const sesion = await requiereSesion()
  const datos = esquemaProponer.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }

  const bloqueo = await validarVentanaCarga(datos.data.periodoId, sesion.rol === 'RRHH', sesion.colaboradorId)
  if (bloqueo) return { ok: false as const, error: bloqueo }
  if (await duenoFueraDeAlcancePeriodo(datos.data.periodoId, sesion.colaboradorId)) {
    return { ok: false as const, error: 'Este período no aplica a ese colaborador' }
  }

  // El peso propuesto no puede exceder el disponible (transversales + aprobados + propuestos)
  const { transversales, individuales } = await objetivosAplicables(datos.data.periodoId, sesion.colaboradorId)
  const usado = transversales.reduce((a, t) => a + t.peso, 0) +
    individuales.filter((o) => o.estado !== 'RECHAZADO').reduce((a, o) => a + o.peso, 0)
  if (usado + datos.data.peso > 100) {
    return { ok: false as const, error: `El peso excede el disponible (${100 - usado}%)` }
  }

  await prisma.objetivo.create({
    data: {
      periodoId: datos.data.periodoId,
      colaboradorId: sesion.colaboradorId,
      tipo: datos.data.tipo,
      titulo: datos.data.titulo,
      descripcion: datos.data.descripcion,
      peso: datos.data.peso,
      metaFecha: datos.data.metaFecha || null,
      metrica: datos.data.metrica || null,
      estado: 'PROPUESTO',
    },
  })
  revalidatePath('/objetivos')
  revalidatePath('/equipo/objetivos')
  return { ok: true as const }
}

/** El jefe aprueba/rechaza un objetivo propuesto, pudiendo ajustar el peso (él define el peso final).
 * Si además modifica el contenido (título, descripción, métrica, fecha o tipo), la propuesta original
 * queda RECHAZADA y se crea un objetivo nuevo APROBADO definido por el jefe — así el colaborador ve
 * con claridad qué propuso él y qué definió su jefe. */
export async function resolverObjetivo(formData: FormData) {
  const sesion = await requiereJefe()
  const objetivoId = String(formData.get('objetivoId') ?? '')
  const decision = String(formData.get('decision') ?? '')
  let pesoAjustado: number | null = null
  if (formData.get('peso')) {
    // Mismo rango que al proponer/asignar: entero 5–100 (un peso negativo o 0 sacaría el objetivo del cálculo)
    const parse = z.coerce.number().int().min(5, 'El peso mínimo es 5%').max(100).safeParse(formData.get('peso'))
    if (!parse.success) return { ok: false as const, error: parse.error.issues[0].message }
    pesoAjustado = parse.data
  }

  const objetivo = await prisma.objetivo.findUnique({ where: { id: objetivoId }, include: { colaborador: true } })
  if (!objetivo?.colaborador) return { ok: false as const, error: 'Objetivo no encontrado' }
  const esRrhh = sesion.rol === 'RRHH'
  if (!(await puedeGestionarObjetivosDe(sesion, objetivo.colaborador))) {
    return { ok: false as const, error: 'Solo el jefe directo puede aprobar este objetivo' }
  }
  const bloqueo = await validarVentanaCarga(objetivo.periodoId, esRrhh, objetivo.colaboradorId ?? undefined)
  if (bloqueo) return { ok: false as const, error: bloqueo }

  if (decision === 'RECHAZADO') {
    // Rechazar no crea ni edita contenido: exento del guard de alcance para no dejar en
    // limbo un objetivo PROPUESTO de un colaborador transferido fuera del alcance del período.
    await prisma.objetivo.update({ where: { id: objetivoId }, data: { estado: 'RECHAZADO' } })
    revalidatePath('/objetivos')
    revalidatePath('/equipo/objetivos')
    return { ok: true as const }
  }
  if (await duenoFueraDeAlcancePeriodo(objetivo.periodoId, objetivo.colaboradorId!)) {
    return { ok: false as const, error: 'Este período no aplica a ese colaborador' }
  }

  // Campos editables al aprobar (opcionales: si no llegan o no cambian, aprobación simple)
  // Topes iguales a los de proponer/editar: esta rama escribe título/descripción/métrica con
  // `prisma.objetivo.create` y sin ellos evadía los `.max()` de los esquemas (y mandaba el título
  // íntegro por correo). Se recorta en vez de rechazar: un campo largo es un pegado accidental.
  const MAX = { titulo: 300, descripcion: 3000, metrica: 300, metaFecha: 30, tipo: 20 } as const
  const texto = (campo: keyof typeof MAX) => {
    const v = formData.get(campo)
    return v === null ? null : String(v).trim().slice(0, MAX[campo])
  }
  const edicion = {
    titulo: texto('titulo'),
    descripcion: texto('descripcion'),
    metrica: texto('metrica'),
    metaFecha: texto('metaFecha'),
    tipo: texto('tipo'),
  }
  const cambia = (nuevo: string | null, actual: string | null) => nuevo !== null && nuevo !== '' && nuevo !== (actual ?? '')
  const modificado =
    cambia(edicion.titulo, objetivo.titulo) ||
    cambia(edicion.descripcion, objetivo.descripcion) ||
    cambia(edicion.metrica, objetivo.metrica) ||
    cambia(edicion.metaFecha, objetivo.metaFecha) ||
    cambia(edicion.tipo, objetivo.tipo)
  if (edicion.tipo && !['INDIVIDUAL', 'DESARROLLO'].includes(edicion.tipo)) {
    return { ok: false as const, error: 'Tipo de objetivo no válido' }
  }

  const peso = pesoAjustado ?? objetivo.peso
  const { transversales, individuales } = await objetivosAplicables(objetivo.periodoId, objetivo.colaboradorId!)
  const usado = transversales.reduce((a, t) => a + t.peso, 0) +
    individuales.filter((o) => o.estado === 'APROBADO' && o.id !== objetivoId).reduce((a, o) => a + o.peso, 0)
  if (usado + peso > 100) return { ok: false as const, error: `Con ese peso supera 100% (usado: ${usado}%)` }

  if (!modificado) {
    await prisma.objetivo.update({ where: { id: objetivoId }, data: { estado: 'APROBADO', peso } })
    // Aviso al colaborador: aprobación simple (sin ajuste de contenido — con ajuste ya sale
    // enviarObjetivoReemplazado más abajo, no se duplica). Best-effort: un correo caído no
    // revierte la aprobación, mismo patrón que el aviso de reemplazo.
    const usuarioAprobado = await prisma.usuario.findFirst({
      where: { colaboradorId: objetivo.colaboradorId!, activo: true },
      include: { colaborador: { select: { nombres: true, apellidos: true } } },
    })
    if (usuarioAprobado && usuarioAprobado.colaborador) {
      const periodoAprobado = await prisma.periodoObjetivos.findUnique({ where: { id: objetivo.periodoId }, select: { nombre: true } })
      // `usado` ya excluye este objetivo (ver cálculo de tope arriba): sumarle su peso da el
      // total vigente del colaborador tras esta aprobación (propios APROBADO + transversales).
      await enviarObjetivosAprobados(
        usuarioAprobado.email,
        `${usuarioAprobado.colaborador.nombres} ${usuarioAprobado.colaborador.apellidos}`,
        periodoAprobado?.nombre ?? '',
        [{ titulo: objetivo.titulo, peso }],
        usado + peso,
      ).catch(() => {})
    }
  } else {
    // Reemplazo: la propuesta original queda rechazada y el jefe define el objetivo aprobado
    await prisma.$transaction([
      prisma.objetivo.update({ where: { id: objetivoId }, data: { estado: 'RECHAZADO' } }),
      prisma.objetivo.create({
        data: {
          periodoId: objetivo.periodoId,
          colaboradorId: objetivo.colaboradorId,
          tipo: (edicion.tipo as 'INDIVIDUAL' | 'DESARROLLO' | null) ?? (objetivo.tipo as 'INDIVIDUAL' | 'DESARROLLO'),
          titulo: edicion.titulo || objetivo.titulo,
          descripcion: edicion.descripcion || objetivo.descripcion,
          peso,
          metaFecha: edicion.metaFecha || objetivo.metaFecha,
          metrica: edicion.metrica || objetivo.metrica,
          estado: 'APROBADO',
        },
      }),
    ])
    // Aviso al colaborador: su propuesta fue reemplazada por la versión de su jefe
    const usuario = await prisma.usuario.findFirst({
      where: { colaboradorId: objetivo.colaboradorId!, activo: true },
      include: { colaborador: { select: { nombres: true, apellidos: true } } },
    })
    if (usuario && usuario.colaborador) {
      const periodo = await prisma.periodoObjetivos.findUnique({ where: { id: objetivo.periodoId }, select: { nombre: true } })
      await enviarObjetivoReemplazado(
        usuario.email,
        `${usuario.colaborador.nombres} ${usuario.colaborador.apellidos}`,
        periodo?.nombre ?? '',
        objetivo.titulo,
        edicion.titulo || objetivo.titulo,
      ).catch(() => {})
    }
  }
  revalidatePath('/objetivos')
  revalidatePath('/equipo/objetivos')
  return { ok: true as const }
}

/** Eliminar un objetivo, según rol y momento:
 * - El dueño: solo los suyos PROPUESTOS, con su ventana de carga abierta.
 * - El jefe (o RR.HH. cubriendo a sin-jefe): también los APROBADOS de su equipo, con la carga abierta.
 * - Los RECHAZADOS quedan como registro histórico (pedido de auditoría): nadie los borra,
 *   salvo RR.HH. post-carga como corrección extrema (queda en AuditLog).
 * - RR.HH. post-carga (plazo vencido o período cerrado sin ciclos lanzados): cualquiera en su alcance. */
export async function eliminarObjetivo(objetivoId: string) {
  const sesion = await requiereSesion()
  const objetivo = await prisma.objetivo.findUnique({ where: { id: objetivoId }, include: { colaborador: true } })
  if (!objetivo?.colaborador) return { ok: false as const, error: 'Objetivo no encontrado' }
  if (objetivo.tipo === 'TRANSVERSAL') return { ok: false as const, error: 'Los transversales los gestiona RR.HH. en su propia sección' }

  // Camino de GESTIÓN: además del rol de sistema RR.HH., un rol con OBJETIVOS:GESTIONAR
  // gestiona (sin-jefe con carga abierta, o cualquiera post-carga) dentro de su alcance.
  const esRrhhOAdmin = sesion.rol === 'RRHH' || tieneAdmin(sesion.permisosAdmin, 'OBJETIVOS', 'GESTIONAR')
  const esDueno = objetivo.colaboradorId === sesion.colaboradorId
  const gestionaComoJefe = await puedeGestionarObjetivosDe(sesion, objetivo.colaborador, true)
  const rrhhPostCarga = await esGestionRrhhPostCarga(sesion, objetivo, true)

  if (!rrhhPostCarga) {
    if (objetivo.estado === 'RECHAZADO') {
      return { ok: false as const, error: 'Un objetivo rechazado queda como registro del proceso: no se elimina' }
    }
    if (esDueno && objetivo.estado === 'APROBADO' && !gestionaComoJefe) {
      return { ok: false as const, error: 'Ya está aprobado: solo tu jefe puede modificarlo o eliminarlo' }
    }
    if (!esDueno && !gestionaComoJefe) return { ok: false as const, error: 'Objetivo no encontrado' }
    const bloqueo = await validarVentanaCarga(objetivo.periodoId, esRrhhOAdmin, objetivo.colaboradorId ?? undefined)
    if (bloqueo) return { ok: false as const, error: bloqueo }
  } else {
    // Post-carga: además del alcance, exige que el período siga corregible (sin ciclos lanzados)
    const bloqueo = await validarVentanaCarga(objetivo.periodoId, true, objetivo.colaboradorId ?? undefined)
    if (bloqueo) return { ok: false as const, error: bloqueo }
  }

  await prisma.objetivo.delete({ where: { id: objetivoId } })
  if (rrhhPostCarga && !esDueno && !gestionaComoJefe) {
    await auditarGestionRrhh(sesion, 'OBJETIVO_ELIMINADO_RRHH', objetivo)
  }
  revalidatePath('/objetivos')
  revalidatePath('/equipo/objetivos')
  return { ok: true as const }
}

const esquemaEditar = z.object({
  objetivoId: z.string().min(1),
  titulo: z.string().trim().min(4, 'Escribe un título para el objetivo').max(300, 'El título es demasiado largo (máximo 300 caracteres)'),
  descripcion: z.string().trim().min(4, 'Describe el objetivo').max(3000, 'La descripción es demasiado larga (máximo 3000 caracteres)'),
  tipo: z.enum(['INDIVIDUAL', 'DESARROLLO']),
  peso: z.coerce.number().int().min(5, 'El peso mínimo es 5%').max(100),
  metaFecha: z.string().trim().max(30).optional(),
  metrica: z.string().trim().max(300).optional(),
})

/** Editar un objetivo existente, según rol y momento:
 * - El dueño: solo los suyos PROPUESTOS (los RECHAZADOS quedan como registro: para
 *   reintentar se propone uno nuevo).
 * - El jefe (o RR.HH. cubriendo a sin-jefe): los APROBADOS de su equipo; siguen aprobados.
 * - RR.HH. post-carga (sin ciclos lanzados): cualquiera en su alcance; conserva su estado. */
export async function editarObjetivo(formData: FormData) {
  const sesion = await requiereSesion()
  const datos = esquemaEditar.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }

  const objetivo = await prisma.objetivo.findUnique({ where: { id: datos.data.objetivoId }, include: { colaborador: true } })
  if (!objetivo?.colaborador) return { ok: false as const, error: 'Objetivo no encontrado' }
  if (objetivo.tipo === 'TRANSVERSAL') return { ok: false as const, error: 'Los transversales los gestiona RR.HH. en su propia sección' }

  // Camino de GESTIÓN: además del rol de sistema RR.HH., un rol con OBJETIVOS:GESTIONAR
  // gestiona (sin-jefe con carga abierta, o cualquiera post-carga) dentro de su alcance.
  const esRrhhOAdmin = sesion.rol === 'RRHH' || tieneAdmin(sesion.permisosAdmin, 'OBJETIVOS', 'GESTIONAR')
  const esDueno = objetivo.colaboradorId === sesion.colaboradorId
  const gestionaComoJefe = await puedeGestionarObjetivosDe(sesion, objetivo.colaborador, true)
  const rrhhPostCarga = await esGestionRrhhPostCarga(sesion, objetivo, true)

  let estadoFinal = objetivo.estado
  if (rrhhPostCarga) {
    // conserva el estado que tenga
  } else if (objetivo.estado === 'RECHAZADO') {
    return { ok: false as const, error: 'Un objetivo rechazado queda como registro del proceso: propón uno nuevo en su lugar' }
  } else if (gestionaComoJefe && objetivo.estado === 'APROBADO') {
    estadoFinal = 'APROBADO'
  } else if (esDueno && objetivo.estado === 'PROPUESTO') {
    estadoFinal = 'PROPUESTO'
  } else if (esDueno && objetivo.estado === 'APROBADO') {
    return { ok: false as const, error: 'Ya está aprobado: solo tu jefe puede modificarlo' }
  } else if (gestionaComoJefe) {
    return { ok: false as const, error: 'Las propuestas se ajustan al aprobarlas (Ajustar y aprobar)' }
  } else {
    return { ok: false as const, error: 'Objetivo no encontrado' }
  }

  const bloqueo = await validarVentanaCarga(objetivo.periodoId, esRrhhOAdmin, objetivo.colaboradorId ?? undefined)
  if (bloqueo) return { ok: false as const, error: bloqueo }
  if (await duenoFueraDeAlcancePeriodo(objetivo.periodoId, objetivo.colaboradorId!)) {
    return { ok: false as const, error: 'Este período no aplica a ese colaborador' }
  }

  // El peso editado no puede exceder el 100% (transversales + demás no rechazados)
  const { transversales, individuales } = await objetivosAplicables(objetivo.periodoId, objetivo.colaboradorId!)
  const usado = transversales.reduce((a, t) => a + t.peso, 0) +
    individuales.filter((o) => o.estado !== 'RECHAZADO' && o.id !== objetivo.id).reduce((a, o) => a + o.peso, 0)
  if (usado + datos.data.peso > 100) {
    return { ok: false as const, error: `El peso excede el disponible (${100 - usado}%)` }
  }

  await prisma.objetivo.update({
    where: { id: objetivo.id },
    data: {
      titulo: datos.data.titulo,
      descripcion: datos.data.descripcion,
      tipo: datos.data.tipo,
      peso: datos.data.peso,
      metaFecha: datos.data.metaFecha || null,
      metrica: datos.data.metrica || null,
      estado: estadoFinal,
    },
  })
  if (rrhhPostCarga && !esDueno && !gestionaComoJefe) {
    await auditarGestionRrhh(sesion, 'OBJETIVO_EDITADO_RRHH', objetivo, { tituloNuevo: datos.data.titulo, pesoNuevo: datos.data.peso })
  }
  revalidatePath('/objetivos')
  revalidatePath('/equipo/objetivos')
  return { ok: true as const }
}

/** El jefe devuelve un objetivo aprobado a PROPUESTO mientras la carga siga abierta, para que pueda modificarse. */
export async function desaprobarObjetivo(objetivoId: string) {
  const sesion = await requiereJefe()
  const objetivo = await prisma.objetivo.findUnique({ where: { id: objetivoId }, include: { colaborador: true } })
  if (!objetivo?.colaborador) return { ok: false as const, error: 'Objetivo no encontrado' }
  if (objetivo.tipo === 'TRANSVERSAL') return { ok: false as const, error: 'Los transversales los gestiona RR.HH.' }
  const esRrhh = sesion.rol === 'RRHH'
  if (!(await puedeGestionarObjetivosDe(sesion, objetivo.colaborador))) {
    return { ok: false as const, error: 'Solo el jefe directo puede desaprobar este objetivo' }
  }
  if (objetivo.estado !== 'APROBADO') return { ok: false as const, error: 'Solo se puede desaprobar un objetivo aprobado' }
  const bloqueo = await validarVentanaCarga(objetivo.periodoId, esRrhh, objetivo.colaboradorId ?? undefined)
  if (bloqueo) return { ok: false as const, error: bloqueo }

  await prisma.objetivo.update({ where: { id: objetivoId }, data: { estado: 'PROPUESTO' } })
  revalidatePath('/objetivos')
  revalidatePath('/equipo/objetivos')
  return { ok: true as const }
}

/** El jefe asigna un objetivo directamente a un miembro de su equipo (nace aprobado). */
export async function asignarObjetivo(formData: FormData) {
  const sesion = await requiereJefe()
  const datos = esquemaProponer.extend({ colaboradorId: z.string().min(1) }).safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }

  const colaborador = await prisma.colaborador.findUnique({ where: { id: datos.data.colaboradorId } })
  if (!colaborador) return { ok: false as const, error: 'Colaborador no encontrado' }
  if (!(await puedeGestionarObjetivosDe(sesion, colaborador))) {
    return { ok: false as const, error: 'Solo puedes asignar objetivos a tu equipo directo' }
  }
  const bloqueo = await validarVentanaCarga(datos.data.periodoId, sesion.rol === 'RRHH', colaborador.id)
  if (bloqueo) return { ok: false as const, error: bloqueo }
  if (await duenoFueraDeAlcancePeriodo(datos.data.periodoId, colaborador.id)) {
    return { ok: false as const, error: 'Este período no aplica a ese colaborador' }
  }

  const { transversales, individuales } = await objetivosAplicables(datos.data.periodoId, colaborador.id)
  const usado = transversales.reduce((a, t) => a + t.peso, 0) +
    individuales.filter((o) => o.estado !== 'RECHAZADO').reduce((a, o) => a + o.peso, 0)
  if (usado + datos.data.peso > 100) return { ok: false as const, error: `El peso excede el disponible (${100 - usado}%)` }

  await prisma.objetivo.create({
    data: {
      periodoId: datos.data.periodoId,
      colaboradorId: colaborador.id,
      tipo: datos.data.tipo,
      titulo: datos.data.titulo,
      descripcion: datos.data.descripcion,
      peso: datos.data.peso,
      metaFecha: datos.data.metaFecha || null,
      metrica: datos.data.metrica || null,
      estado: 'APROBADO',
    },
  })
  // Aviso al colaborador: su jefe le asignó (y aprobó de una vez) un objetivo directo. Best-effort:
  // un correo caído no revierte la asignación, mismo patrón que las demás notificaciones de objetivos.
  const usuarioAsignado = await prisma.usuario.findFirst({
    where: { colaboradorId: colaborador.id, activo: true },
    include: { colaborador: { select: { nombres: true, apellidos: true } } },
  })
  if (usuarioAsignado && usuarioAsignado.colaborador) {
    const periodoAsignado = await prisma.periodoObjetivos.findUnique({ where: { id: datos.data.periodoId }, select: { nombre: true } })
    // `usado` ya se calculó arriba para validar el tope de 100% (excluye este objetivo nuevo):
    // sumarle su peso da el total vigente del colaborador tras esta asignación.
    await enviarObjetivoAsignado(
      usuarioAsignado.email,
      `${usuarioAsignado.colaborador.nombres} ${usuarioAsignado.colaborador.apellidos}`,
      periodoAsignado?.nombre ?? '',
      datos.data.titulo,
      datos.data.peso,
      usado + datos.data.peso,
    ).catch(() => {})
  }
  revalidatePath('/objetivos')
  revalidatePath('/equipo/objetivos')
  return { ok: true as const }
}
