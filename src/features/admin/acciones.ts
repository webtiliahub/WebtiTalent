'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/shared/lib/prisma'
import { requiereRrhh, requiereAdmin, fueraDeAlcancePais, alcancePaisWhere, cicloFueraDeAlcance, paisForzado } from '@/shared/lib/permisos'
import { tieneAdmin } from '@/shared/lib/permisos-admin'
import { excluidoPorAntiguedad } from '@/domain/antiguedad'
import { calcularResultado, calcularResultadosCiclo } from '@/features/resultados/servicio'
import { preflightCiclo, feedbackPendiente, conformidadPendiente } from '@/features/ciclos/preflight'
import { paisCongelado, paisesCongelados } from '@/features/ciclos/congelamiento'
import { validarVentanaCarga } from '@/features/objetivos/acciones-periodo'
import { colaboradoresDelPeriodo } from '@/features/objetivos/alcance-periodo'
import { construirAperturaCiclo, enviarBatch, enviarCambioTransversales, enviarResultadosPublicados } from '@/shared/lib/mailer'
import { enviarPushACorreos } from '@/shared/lib/push'
import { pendientesEvaluaciones } from '@/features/recordatorios/pendientes'
import { notificarParAsignado } from '@/features/evaluaciones/notificar-par'
import { paisIdDerivado, resolverAlcance } from '@/features/ciclos/alcance'

// ───────────── Puestos: pesos por dimensión ─────────────

export async function guardarPesosPuesto(puestoId: string, pesos: { dimensionId: string; peso: number; puntajeEsperado: number }[]) {
  await requiereAdmin('PUESTOS', 'GESTIONAR')
  /* Cada peso 0-100 ANTES de sumar. Validar solo la suma dejaba pasar [{peso:200},{peso:-100}]
     (suma 100), y la nota se iba fuera del rango 1-5; o dimensiones repetidas que el upsert por
     (puesto,dimensión) colapsa al último, descuadrando el total real. Como el ciclo CONGELA estos
     pesos al lanzar, un valor envenenado quedaría permanente e irrevisable. */
  if (pesos.some((p) => !Number.isFinite(p.peso) || p.peso < 0 || p.peso > 100)) {
    return { ok: false as const, error: 'Cada peso debe estar entre 0 y 100' }
  }
  if (new Set(pesos.map((p) => p.dimensionId)).size !== pesos.length) {
    return { ok: false as const, error: 'Hay dimensiones repetidas en los pesos' }
  }
  const total = pesos.reduce((a, p) => a + p.peso, 0)
  if (total !== 100) return { ok: false as const, error: `Los pesos deben sumar 100% (suman ${total}%)` }
  if (pesos.some((p) => !Number.isFinite(p.puntajeEsperado) || p.puntajeEsperado < 1 || p.puntajeEsperado > 5)) {
    return { ok: false as const, error: 'El puntaje esperado debe estar entre 1 y 5' }
  }
  await prisma.$transaction(
    pesos.map((p) =>
      prisma.pesoDimensionPuesto.upsert({
        where: { puestoId_dimensionId: { puestoId, dimensionId: p.dimensionId } },
        create: { puestoId, dimensionId: p.dimensionId, peso: p.peso, puntajeEsperado: p.puntajeEsperado },
        update: { peso: p.peso, puntajeEsperado: p.puntajeEsperado },
      }),
    ),
  )
  revalidatePath(`/admin/puestos/${puestoId}`)
  return { ok: true as const }
}

const CAMPOS_FICHA_PUESTO = ['descripcion', 'responsabilidades', 'formacion', 'experiencia', 'certificaciones', 'reportaA', 'supervisa'] as const

/** Actualiza solo los campos de la ficha presentes en el form (propósito/responsabilidades o requisitos). */
export async function editarFichaPuesto(puestoId: string, formData: FormData) {
  await requiereAdmin('PUESTOS', 'GESTIONAR')
  const data: Record<string, string | null> = {}
  // Tope por campo: son textos largos por naturaleza (responsabilidades, requisitos), pero sin
  // límite una sola petición escribía megas en una fila TEXT
  const MAX_FICHA = 5000
  for (const campo of CAMPOS_FICHA_PUESTO) {
    const valor = formData.get(campo)
    if (valor === null) continue
    const texto = String(valor).trim()
    if (texto.length > MAX_FICHA) {
      return { ok: false as const, error: `El campo «${campo}» supera los ${MAX_FICHA} caracteres` }
    }
    data[campo] = texto || null
  }
  if (Object.keys(data).length === 0) return { ok: false as const, error: 'Nada que guardar' }
  await prisma.puesto.update({ where: { id: puestoId }, data })
  revalidatePath(`/admin/puestos/${puestoId}`)
  return { ok: true as const }
}

export async function alternarCompetenciaPuesto(puestoId: string, competenciaId: string, activa: boolean) {
  await requiereAdmin('PUESTOS', 'GESTIONAR')
  if (activa) {
    await prisma.puestoCompetencia.upsert({
      where: { puestoId_competenciaId: { puestoId, competenciaId } },
      create: { puestoId, competenciaId },
      update: {},
    })
  } else {
    await prisma.puestoCompetencia.deleteMany({ where: { puestoId, competenciaId } })
  }
  revalidatePath(`/admin/puestos/${puestoId}`)
  return { ok: true as const }
}

// ───────────── Catálogo: dimensiones y competencias ─────────────

const esquemaNombre = z.object({
  nombre: z.string().trim().min(2, 'Escribe un nombre').max(150),
  descripcion: z.string().trim().max(2000).optional(),
})

function esDuplicado(e: unknown) {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'P2002'
}

export async function crearDimension(formData: FormData) {
  const sesion = await requiereAdmin('CONFIGURACION', 'GESTIONAR')
  const datos = esquemaNombre.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  try {
    const ultimo = await prisma.dimension.aggregate({ _max: { orden: true } })
    await prisma.dimension.create({ data: { ...datos.data, orden: (ultimo._max.orden ?? -1) + 1 } })
  } catch (e) {
    if (esDuplicado(e)) return { ok: false as const, error: 'Ya existe una dimensión con ese nombre' }
    throw e
  }
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'DIMENSION_CREADA', detalle: { nombre: datos.data.nombre } } })
  revalidatePath('/admin/configuracion')
  return { ok: true as const }
}

export async function editarDimension(dimensionId: string, formData: FormData) {
  await requiereAdmin('CONFIGURACION', 'GESTIONAR')
  const datos = esquemaNombre.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  try {
    await prisma.dimension.update({ where: { id: dimensionId }, data: datos.data })
  } catch (e) {
    if (esDuplicado(e)) return { ok: false as const, error: 'Ya existe una dimensión con ese nombre' }
    throw e
  }
  revalidatePath('/admin/configuracion')
  return { ok: true as const }
}

export async function eliminarDimension(dimensionId: string) {
  const sesion = await requiereAdmin('CONFIGURACION', 'GESTIONAR')
  const enUso = await prisma.competencia.count({ where: { dimensionId } })
  if (enUso > 0) return { ok: false as const, error: `La dimensión tiene ${enUso} competencias: elimínalas o muévelas primero` }
  const dim = await prisma.dimension.delete({ where: { id: dimensionId } })
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'DIMENSION_ELIMINADA', detalle: { nombre: dim.nombre } } })
  revalidatePath('/admin/configuracion')
  return { ok: true as const }
}

export async function crearCompetencia(dimensionId: string, formData: FormData) {
  await requiereAdmin('CONFIGURACION', 'GESTIONAR')
  const datos = esquemaNombre.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  try {
    await prisma.competencia.create({ data: { ...datos.data, dimensionId } })
  } catch (e) {
    if (esDuplicado(e)) return { ok: false as const, error: 'Ya existe una competencia con ese nombre' }
    throw e
  }
  revalidatePath('/admin/configuracion')
  return { ok: true as const }
}

export async function editarCompetencia(competenciaId: string, formData: FormData) {
  await requiereAdmin('CONFIGURACION', 'GESTIONAR')
  const datos = esquemaNombre.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  try {
    await prisma.competencia.update({ where: { id: competenciaId }, data: datos.data })
  } catch (e) {
    if (esDuplicado(e)) return { ok: false as const, error: 'Ya existe una competencia con ese nombre' }
    throw e
  }
  revalidatePath('/admin/configuracion')
  return { ok: true as const }
}

export async function eliminarCompetencia(competenciaId: string) {
  await requiereAdmin('CONFIGURACION', 'GESTIONAR')
  const [preguntas, puestos] = await Promise.all([
    prisma.pregunta.count({ where: { competenciaId } }),
    prisma.puestoCompetencia.count({ where: { competenciaId } }),
  ])
  if (preguntas > 0 || puestos > 0) {
    return { ok: false as const, error: `En uso por ${preguntas} preguntas y ${puestos} puestos: quítala de ahí primero` }
  }
  await prisma.competencia.delete({ where: { id: competenciaId } })
  revalidatePath('/admin/configuracion')
  return { ok: true as const }
}

// ───────────── Catálogo: áreas ─────────────

export async function crearArea(formData: FormData) {
  await requiereAdmin('PUESTOS', 'GESTIONAR')
  const datos = esquemaNombre.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  try {
    await prisma.area.create({ data: { nombre: datos.data.nombre } })
  } catch (e) {
    if (esDuplicado(e)) return { ok: false as const, error: 'Ya existe un área con ese nombre' }
    throw e
  }
  revalidatePath('/admin/puestos')
  return { ok: true as const }
}

export async function editarArea(areaId: string, formData: FormData) {
  await requiereAdmin('PUESTOS', 'GESTIONAR')
  const datos = esquemaNombre.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  try {
    await prisma.area.update({ where: { id: areaId }, data: { nombre: datos.data.nombre } })
  } catch (e) {
    if (esDuplicado(e)) return { ok: false as const, error: 'Ya existe un área con ese nombre' }
    throw e
  }
  revalidatePath('/admin/puestos')
  return { ok: true as const }
}

export async function eliminarArea(areaId: string) {
  await requiereAdmin('PUESTOS', 'GESTIONAR')
  const [colaboradores, puestos] = await Promise.all([
    prisma.colaborador.count({ where: { areaId } }),
    prisma.puesto.count({ where: { areaId } }),
  ])
  if (colaboradores > 0 || puestos > 0) {
    return { ok: false as const, error: `En uso por ${colaboradores} colaboradores y ${puestos} puestos: reasígnalos primero` }
  }
  await prisma.area.delete({ where: { id: areaId } })
  revalidatePath('/admin/puestos')
  return { ok: true as const }
}

// ───────────── Puestos: alta y edición ─────────────

const esquemaPuesto = z.object({
  nombre: z.string().trim().min(2, 'Escribe el nombre del puesto').max(150),
  nivelId: z.string().min(1, 'Elige el nivel jerárquico'),
  areaId: z.string().trim().optional(),
  descripcion: z.string().trim().max(2000).optional(),
})

export async function crearPuesto(formData: FormData) {
  const sesion = await requiereAdmin('PUESTOS', 'GESTIONAR')
  const datos = esquemaPuesto.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  const { areaId, ...resto } = datos.data
  let puesto
  try {
    puesto = await prisma.puesto.create({ data: { ...resto, areaId: areaId || null } })
  } catch (e) {
    if (esDuplicado(e)) return { ok: false as const, error: 'Ya existe un puesto con ese nombre' }
    throw e
  }
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'PUESTO_CREADO', detalle: { nombre: puesto.nombre } } })
  revalidatePath('/admin/puestos')
  return { ok: true as const, puestoId: puesto.id }
}

export async function editarPuesto(puestoId: string, formData: FormData) {
  await requiereAdmin('PUESTOS', 'GESTIONAR')
  const datos = esquemaPuesto.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  const { areaId, ...resto } = datos.data

  try {
    await prisma.puesto.update({ where: { id: puestoId }, data: { ...resto, areaId: areaId || null } })
  } catch (e) {
    if (esDuplicado(e)) return { ok: false as const, error: 'Ya existe un puesto con ese nombre' }
    throw e
  }
  revalidatePath('/admin/puestos')
  revalidatePath(`/admin/puestos/${puestoId}`)
  return { ok: true as const }
}

export async function eliminarPuesto(puestoId: string) {
  const sesion = await requiereAdmin('PUESTOS', 'GESTIONAR')
  const [colaboradores, evaluaciones] = await Promise.all([
    prisma.colaborador.count({ where: { puestoId } }),
    prisma.evaluacion.count({ where: { puestoId } }),
  ])
  if (colaboradores > 0) return { ok: false as const, error: `${colaboradores} colaboradores tienen este puesto: reasígnalos primero` }
  if (evaluaciones > 0) return { ok: false as const, error: `${evaluaciones} evaluaciones usan este puesto: elimínalas primero` }
  const puesto = await prisma.puesto.delete({ where: { id: puestoId } })
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'PUESTO_ELIMINADO', detalle: { nombre: puesto.nombre } } })
  revalidatePath('/admin/puestos')
  return { ok: true as const }
}

// ───────────── Banco de preguntas ─────────────

const MODALIDADES = ['JEFE', 'PAR', 'ASCENDENTE', 'AUTO'] as const
export type Modalidad = (typeof MODALIDADES)[number]

const esquemaPregunta = z.object({
  texto: z.string().trim().min(8, 'Escribe la pregunta').max(1000),
  competenciaId: z.string().min(1, 'Elige la competencia'),
})

/** Descriptores BARS del form (descriptor1..descriptor5): o los 5 completos o ninguno —
 * una escala a medias confunde más que no tenerla. */
function descriptoresDeForm(formData: FormData): { ok: true; descriptores: string[] } | { ok: false; error: string } {
  const textos = [1, 2, 3, 4, 5].map((n) => String(formData.get(`descriptor${n}`) ?? '').trim())
  const llenos = textos.filter(Boolean).length
  if (llenos === 0) return { ok: true, descriptores: [] }
  if (llenos < 5) return { ok: false, error: 'Los descriptores de la escala van completos: llena los 5 niveles o deja todos vacíos' }
  return { ok: true, descriptores: textos }
}

export async function crearPregunta(formData: FormData) {
  await requiereAdmin('EVALUACIONES', 'GESTIONAR')
  const datos = esquemaPregunta.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  const modalidades = formData
    .getAll('modalidades')
    .map(String)
    .filter((m): m is Modalidad => (MODALIDADES as readonly string[]).includes(m))
  if (modalidades.length === 0) return { ok: false as const, error: 'Marca al menos una modalidad' }
  const desc = descriptoresDeForm(formData)
  if (!desc.ok) return { ok: false as const, error: desc.error }
  await prisma.pregunta.create({ data: { ...datos.data, modalidades, descriptores: desc.descriptores } })
  revalidatePath('/admin/preguntas')
  return { ok: true as const }
}

export async function alternarPregunta(preguntaId: string, activa: boolean) {
  await requiereAdmin('EVALUACIONES', 'GESTIONAR')
  await prisma.pregunta.update({ where: { id: preguntaId }, data: { activa } })
  revalidatePath('/admin/preguntas')
  return { ok: true as const }
}

/** Edita texto, competencia y modalidades. La competencia no puede cambiar si la pregunta ya está
 * en ciclos (cambiaría cuestionarios en curso); quitar una modalidad la retira de las plantillas. */
export async function editarPregunta(preguntaId: string, formData: FormData) {
  await requiereAdmin('EVALUACIONES', 'GESTIONAR')
  const datos = esquemaPregunta.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  const modalidades = formData
    .getAll('modalidades')
    .map(String)
    .filter((m): m is Modalidad => (MODALIDADES as readonly string[]).includes(m))
  if (modalidades.length === 0) return { ok: false as const, error: 'Marca al menos una modalidad' }
  const desc = descriptoresDeForm(formData)
  if (!desc.ok) return { ok: false as const, error: desc.error }

  const pregunta = await prisma.pregunta.findUnique({ where: { id: preguntaId } })
  if (!pregunta) return { ok: false as const, error: 'Pregunta no encontrada' }
  if (datos.data.competenciaId !== pregunta.competenciaId) {
    const enCiclos = await prisma.cicloPregunta.count({ where: { preguntaId } })
    if (enCiclos > 0) return { ok: false as const, error: 'No se puede cambiar la competencia: la pregunta ya se usó en ciclos. Desactívala y crea una nueva.' }
  }
  const modalidadesQuitadas = pregunta.modalidades.filter((m) => !modalidades.includes(m as Modalidad))
  const [, quitadas] = await prisma.$transaction([
    prisma.pregunta.update({ where: { id: preguntaId }, data: { ...datos.data, modalidades, descriptores: desc.descriptores } }),
    prisma.evaluacionPregunta.deleteMany({ where: { preguntaId, modalidad: { in: modalidadesQuitadas } } }),
  ])
  revalidatePath('/admin/preguntas')
  return { ok: true as const, retiradasDePlantillas: quitadas.count }
}

/** Elimina una pregunta del banco. Solo si nunca se usó: con respuestas o en ciclos se desactiva, no se borra. */
export async function eliminarPregunta(preguntaId: string) {
  await requiereAdmin('EVALUACIONES', 'GESTIONAR')
  const [respuestas, enCiclos, enPlantillas] = await Promise.all([
    prisma.respuesta.count({ where: { preguntaId } }),
    prisma.cicloPregunta.count({ where: { preguntaId } }),
    prisma.evaluacionPregunta.count({ where: { preguntaId } }),
  ])
  if (respuestas > 0) return { ok: false as const, error: `Tiene ${respuestas} respuestas históricas: desactívala en lugar de eliminarla` }
  if (enCiclos > 0) return { ok: false as const, error: 'Está en el snapshot de algún ciclo: desactívala en lugar de eliminarla' }
  await prisma.pregunta.delete({ where: { id: preguntaId } }) // cascade la retira de las plantillas
  revalidatePath('/admin/preguntas')
  return { ok: true as const, retiradasDePlantillas: enPlantillas }
}

// ───────────── Preguntas de potencial (eje Y del 9-Box; solo las responde el jefe) ─────────────

const esquemaPotencial = z.object({ texto: z.string().trim().min(8, 'Escribe la pregunta').max(1000) })

export async function crearPreguntaPotencial(formData: FormData) {
  await requiereAdmin('EVALUACIONES', 'GESTIONAR')
  const datos = esquemaPotencial.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  const desc = descriptoresDeForm(formData)
  if (!desc.ok) return { ok: false as const, error: desc.error }
  const ultimo = await prisma.preguntaPotencial.aggregate({ _max: { orden: true } })
  await prisma.preguntaPotencial.create({ data: { texto: datos.data.texto, orden: (ultimo._max.orden ?? 0) + 1, descriptores: desc.descriptores } })
  revalidatePath('/admin/preguntas')
  return { ok: true as const }
}

export async function editarPreguntaPotencial(id: string, formData: FormData) {
  await requiereAdmin('EVALUACIONES', 'GESTIONAR')
  const datos = esquemaPotencial.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  const desc = descriptoresDeForm(formData)
  if (!desc.ok) return { ok: false as const, error: desc.error }
  await prisma.preguntaPotencial.update({ where: { id }, data: { texto: datos.data.texto, descriptores: desc.descriptores } })
  revalidatePath('/admin/preguntas')
  return { ok: true as const }
}

export async function alternarPreguntaPotencial(id: string, activa: boolean) {
  await requiereAdmin('EVALUACIONES', 'GESTIONAR')
  await prisma.preguntaPotencial.update({ where: { id }, data: { activa } })
  revalidatePath('/admin/preguntas')
  return { ok: true as const }
}

/** Solo se eliminan si nunca se usaron: con respuestas o snapshot de ciclo se desactivan. */
export async function eliminarPreguntaPotencial(id: string) {
  await requiereAdmin('EVALUACIONES', 'GESTIONAR')
  const [respuestas, enCiclos] = await Promise.all([
    prisma.respuestaPotencial.count({ where: { preguntaId: id } }),
    prisma.cicloPreguntaPotencial.count({ where: { preguntaPotencialId: id } }),
  ])
  if (respuestas > 0) return { ok: false as const, error: `Tiene ${respuestas} respuestas históricas: desactívala en lugar de eliminarla` }
  if (enCiclos > 0) return { ok: false as const, error: 'Está en el snapshot de algún ciclo: desactívala en lugar de eliminarla' }
  await prisma.preguntaPotencial.delete({ where: { id } })
  revalidatePath('/admin/preguntas')
  return { ok: true as const }
}

/** Reemplaza el set de preguntas de potencial que aplica una evaluación. */
export async function guardarPotencialEvaluacion(evaluacionId: string, ids: string[]) {
  await requiereAdmin('EVALUACIONES', 'GESTIONAR')
  const activas = new Set((await prisma.preguntaPotencial.findMany({ where: { activa: true }, select: { id: true } })).map((p) => p.id))
  const unicos = [...new Set(ids.filter((id) => activas.has(id)))]
  await prisma.$transaction([
    prisma.evaluacionPreguntaPotencial.deleteMany({ where: { evaluacionId } }),
    prisma.evaluacionPreguntaPotencial.createMany({ data: unicos.map((preguntaPotencialId) => ({ evaluacionId, preguntaPotencialId })) }),
  ])
  revalidatePath('/admin/preguntas')
  return { ok: true as const, total: unicos.length }
}

// ───────────── Evaluaciones (plantillas por nivel, con excepciones por puesto) ─────────────

const esquemaEvaluacion = z.object({
  nombre: z.string().trim().min(4, 'Escribe un nombre para la evaluación').max(150),
  descripcion: z.string().trim().max(2000).optional(),
})

/** Crea una evaluación con alcance: exactamente uno de nivelId/puestoId.
 * La de puesto es una excepción que pisa a la del nivel en el ciclo. */
export async function crearEvaluacion(formData: FormData) {
  await requiereAdmin('EVALUACIONES', 'GESTIONAR')
  const datos = esquemaEvaluacion.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  const nivelId = String(formData.get('nivelId') ?? '').trim() || null
  const puestoId = String(formData.get('puestoId') ?? '').trim() || null
  if ((nivelId === null) === (puestoId === null)) return { ok: false as const, error: 'Elige el alcance: un nivel jerárquico o un puesto' }
  try {
    const ev = await prisma.evaluacion.create({
      data: { nombre: datos.data.nombre, descripcion: datos.data.descripcion || null, nivelId, puestoId },
    })
    revalidatePath('/admin/preguntas')
    return { ok: true as const, id: ev.id }
  } catch (e) {
    if (esDuplicado(e)) return { ok: false as const, error: 'Ya existe una evaluación con ese nombre' }
    throw e
  }
}

export async function editarEvaluacion(evaluacionId: string, formData: FormData) {
  await requiereAdmin('EVALUACIONES', 'GESTIONAR')
  const datos = esquemaEvaluacion.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  try {
    await prisma.evaluacion.update({ where: { id: evaluacionId }, data: { nombre: datos.data.nombre, descripcion: datos.data.descripcion || null } })
    revalidatePath('/admin/preguntas')
    return { ok: true as const }
  } catch (e) {
    if (esDuplicado(e)) return { ok: false as const, error: 'Ya existe una evaluación con ese nombre' }
    throw e
  }
}

export async function alternarEvaluacion(evaluacionId: string, activa: boolean) {
  await requiereAdmin('EVALUACIONES', 'GESTIONAR')
  await prisma.evaluacion.update({ where: { id: evaluacionId }, data: { activa } })
  revalidatePath('/admin/preguntas')
  return { ok: true as const }
}

/** Solo se eliminan evaluaciones que nunca se usaron: si un ciclo (vigente o histórico) la aplicó,
 * se archiva (activa=false) para conservar la trazabilidad de qué evaluación usó cada ciclo. */
export async function eliminarEvaluacion(evaluacionId: string) {
  await requiereAdmin('EVALUACIONES', 'GESTIONAR')
  const enUso = await prisma.cicloEvaluacion.count({ where: { evaluacionId } })
  if (enUso > 0) return { ok: false as const, error: `Se usó en ${enUso} ciclo${enUso === 1 ? '' : 's'}: archívala en lugar de eliminarla` }
  await prisma.evaluacion.delete({ where: { id: evaluacionId } })
  revalidatePath('/admin/preguntas')
  return { ok: true as const }
}

/** Reemplaza el conjunto de preguntas (por modalidad) de una evaluación. El cuestionario
 * de cada colaborador se deriva luego de las competencias de su puesto + la modalidad. */
export async function guardarPreguntasEvaluacion(evaluacionId: string, lista: { preguntaId: string; modalidad: Modalidad }[]) {
  await requiereAdmin('EVALUACIONES', 'GESTIONAR')
  const evaluacion = await prisma.evaluacion.findUnique({ where: { id: evaluacionId } })
  if (!evaluacion) return { ok: false as const, error: 'Evaluación no encontrada' }
  // Solo preguntas activas y en una modalidad que la pregunta declare; sin duplicados
  const banco = new Map(
    (await prisma.pregunta.findMany({ where: { activa: true }, select: { id: true, modalidades: true } }))
      .map((p) => [p.id, new Set(p.modalidades)]),
  )
  const claves = new Map(
    lista
      .filter((x) => (MODALIDADES as readonly string[]).includes(x.modalidad) && banco.get(x.preguntaId)?.has(x.modalidad))
      .map((x) => [`${x.preguntaId}|${x.modalidad}`, x]),
  )
  await prisma.$transaction([
    prisma.evaluacionPregunta.deleteMany({ where: { evaluacionId } }),
    prisma.evaluacionPregunta.createMany({ data: [...claves.values()].map((x) => ({ evaluacionId, preguntaId: x.preguntaId, modalidad: x.modalidad })) }),
  ])
  revalidatePath('/admin/preguntas')
  return { ok: true as const, total: claves.size }
}

// ───────────── Objetivos transversales ─────────────

const esquemaTransversal = z.object({
  periodoId: z.string().min(1),
  titulo: z.string().trim().min(4).max(300),
  descripcion: z.string().trim().max(2000).optional(),
  peso: z.coerce.number().int().min(5).max(100),
  metaFecha: z.string().trim().max(30).optional(),
})

/** Total (transversales aplicables + individuales no rechazados) por colaborador del alcance del período. */
async function totalesPeriodo(periodoId: string) {
  const periodo = await prisma.periodoObjetivos.findUniqueOrThrow({ where: { id: periodoId } })
  const [colaboradores, objetivos] = await Promise.all([
    // Población = alcance del período: quien queda fuera no tiene objetivos reales que cuadrar.
    colaboradoresDelPeriodo(periodo),
    prisma.objetivo.findMany({ where: { periodoId, estado: { not: 'RECHAZADO' } } }),
  ])
  const transversales = objetivos.filter((o) => o.tipo === 'TRANSVERSAL' && o.estado === 'APROBADO')
  return new Map(colaboradores.map((c) => {
    const aplicables = transversales.filter((t) => {
      const porArea = t.focoAreaIds.length === 0 || (c.areaId !== null && t.focoAreaIds.includes(c.areaId))
      const porNivel = t.focoNivelIds.length === 0 || (c.nivelId !== null && t.focoNivelIds.includes(c.nivelId))
      const porPais = t.focoPaisIds.length === 0 || t.focoPaisIds.includes(c.paisId)
      const porPuesto = t.focoPuestoIds.length === 0 || (c.puestoId !== null && t.focoPuestoIds.includes(c.puestoId))
      return porArea && porNivel && porPais && porPuesto
    })
    const propios = objetivos.filter((o) => o.colaboradorId === c.id).reduce((a, o) => a + o.peso, 0)
    return [c.id, aplicables.reduce((a, t) => a + t.peso, 0) + propios] as const
  }))
}

/** Avisa por correo a quienes estaban al 100% y quedaron descuadrados por un cambio de transversales. */
async function notificarDescuadre(periodoId: string, antes: Map<string, number>) {
  const periodo = await prisma.periodoObjetivos.findUnique({ where: { id: periodoId } })
  if (!periodo || periodo.estado !== 'CARGA_ABIERTA') return 0
  const despues = await totalesPeriodo(periodoId)
  const afectados = [...despues.entries()]
    .filter(([id, total]) => total !== 100 && antes.get(id) === 100)
    .map(([id]) => id)
  if (afectados.length === 0) return 0

  const usuarios = await prisma.usuario.findMany({
    where: { activo: true, colaboradorId: { in: afectados } },
    include: { colaborador: { select: { nombres: true, apellidos: true } } },
  })
  const envios = await Promise.allSettled(
    // colaboradorId viene de `afectados` (ids reales de colaboradores con objetivos): el join
    // siempre resuelve, salvo una cuenta huérfana (sin colaborador) que se descarta por las dudas.
    usuarios.filter((u) => u.colaborador && u.colaboradorId).map((u) =>
      enviarCambioTransversales(u.email, `${u.colaborador!.nombres} ${u.colaborador!.apellidos}`, periodo.nombre, despues.get(u.colaboradorId!) ?? 0),
    ),
  )
  return envios.filter((e) => e.status === 'fulfilled').length
}

/** Bloquea crear/editar un transversal si algún colaborador alcanzado superaría el 100%
 * SOLO con transversales: ese exceso no lo puede corregir el colaborador (los transversales
 * los gestiona RR.HH.), así que se valida aquí en lugar de notificar el descuadre. */
async function validarPesoTransversales(
  periodoId: string,
  foco: { areaIds: string[]; nivelIds: string[]; paisIds: string[]; puestoIds: string[] },
  peso: number,
  excluirObjetivoId?: string,
) {
  const periodo = await prisma.periodoObjetivos.findUniqueOrThrow({ where: { id: periodoId } })
  const [colaboradores, transversales] = await Promise.all([
    // Candidatos = alcance del período: quien queda fuera no suma al candado de 100%
    colaboradoresDelPeriodo(periodo),
    prisma.objetivo.findMany({
      where: { periodoId, tipo: 'TRANSVERSAL', estado: 'APROBADO', ...(excluirObjetivoId ? { id: { not: excluirObjetivoId } } : {}) },
    }),
  ])
  const aplica = (f: { areaIds: string[]; nivelIds: string[]; paisIds: string[]; puestoIds: string[] }, c: (typeof colaboradores)[number]) =>
    (f.areaIds.length === 0 || (c.areaId !== null && f.areaIds.includes(c.areaId))) &&
    (f.nivelIds.length === 0 || (c.nivelId !== null && f.nivelIds.includes(c.nivelId))) &&
    (f.paisIds.length === 0 || f.paisIds.includes(c.paisId)) &&
    (f.puestoIds.length === 0 || (c.puestoId !== null && f.puestoIds.includes(c.puestoId)))

  const excedidos = colaboradores
    .filter((c) => aplica(foco, c))
    .map((c) => {
      const existentes = transversales
        .filter((t) => aplica({ areaIds: t.focoAreaIds, nivelIds: t.focoNivelIds, paisIds: t.focoPaisIds, puestoIds: t.focoPuestoIds }, c))
        .reduce((a, t) => a + t.peso, 0)
      return { nombre: `${c.nombres} ${c.apellidos}`, total: existentes + peso }
    })
    .filter((x) => x.total > 100)
    .sort((a, b) => b.total - a.total)

  if (excedidos.length === 0) return null
  const ejemplo = excedidos[0]
  return `Con este peso, ${excedidos.length} colaborador${excedidos.length === 1 ? '' : 'es'} superaría${excedidos.length === 1 ? '' : 'n'} el 100% solo con transversales (p.ej. ${ejemplo.nombre} quedaría en ${ejemplo.total}%). Ajusta el peso o la focalización.`
}

/** El RR.HH. de país solo gestiona transversales acotados EXACTAMENTE a su país (no org-wide ni ajenos). */
function transversalFueraDeAlcance(sesion: Awaited<ReturnType<typeof requiereRrhh>>, focoPaisIds: string[]): boolean {
  if (sesion.alcanceRrhh !== 'PAIS') return false
  if (!sesion.alcancePaisId) return true // fail-closed: RR.HH. de país sin país no gestiona nada
  return focoPaisIds.length !== 1 || focoPaisIds[0] !== sesion.alcancePaisId
}

/** Fuerza la focalización de país al alcance del RR.HH. de país (Regional mantiene lo elegido). */
function focoPaisEfectivo(sesion: Awaited<ReturnType<typeof requiereRrhh>>, paisIds: string[]): string[] {
  const forzado = paisForzado(sesion); return forzado ? [forzado] : paisIds
}

export async function crearTransversal(formData: FormData, foco: { areaIds: string[]; nivelIds: string[]; paisIds: string[]; puestoIds: string[] }) {
  const sesion = await requiereAdmin('OBJETIVOS', 'GESTIONAR')
  const datos = esquemaTransversal.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  const bloqueo = await validarVentanaCarga(datos.data.periodoId, true)
  if (bloqueo) return { ok: false as const, error: bloqueo }
  const focoEfectivo = { ...foco, paisIds: focoPaisEfectivo(sesion, foco.paisIds) }
  const exceso = await validarPesoTransversales(datos.data.periodoId, focoEfectivo, datos.data.peso)
  if (exceso) return { ok: false as const, error: exceso }
  const antes = await totalesPeriodo(datos.data.periodoId)
  await prisma.objetivo.create({
    data: {
      periodoId: datos.data.periodoId,
      tipo: 'TRANSVERSAL',
      titulo: datos.data.titulo,
      descripcion: datos.data.descripcion || null,
      peso: datos.data.peso,
      metaFecha: datos.data.metaFecha || null,
      estado: 'APROBADO',
      focoAreaIds: foco.areaIds,
      focoNivelIds: foco.nivelIds,
      focoPaisIds: focoPaisEfectivo(sesion, foco.paisIds),
      focoPuestoIds: foco.puestoIds,
    },
  })
  const notificados = await notificarDescuadre(datos.data.periodoId, antes)
  revalidatePath('/admin/transversales')
  revalidatePath('/objetivos')
  revalidatePath('/equipo/objetivos')
  return { ok: true as const, notificados }
}

/** Un período con algún ciclo CERRADO es historial: sus transversales ya no se editan ni eliminan. */
async function periodoCongelado(periodoId: string): Promise<string | null> {
  const cerrados = await prisma.ciclo.count({ where: { periodoId, estado: 'CERRADO' } })
  return cerrados > 0 ? 'El ciclo que evaluó este período ya está cerrado: sus objetivos son parte del historial y no se pueden modificar' : null
}

export async function editarTransversal(objetivoId: string, formData: FormData, foco: { areaIds: string[]; nivelIds: string[]; paisIds: string[]; puestoIds: string[] }) {
  const sesion = await requiereAdmin('OBJETIVOS', 'GESTIONAR')
  const objetivo = await prisma.objetivo.findUnique({ where: { id: objetivoId } })
  if (!objetivo || objetivo.tipo !== 'TRANSVERSAL') return { ok: false as const, error: 'Objetivo no encontrado' }
  if (transversalFueraDeAlcance(sesion, objetivo.focoPaisIds)) return { ok: false as const, error: 'Este transversal está fuera de tu país' }
  const datos = esquemaTransversal.omit({ periodoId: true }).safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  const congelado = await periodoCongelado(objetivo.periodoId)
  if (congelado) return { ok: false as const, error: congelado }
  const bloqueo = await validarVentanaCarga(objetivo.periodoId, true)
  if (bloqueo) return { ok: false as const, error: bloqueo }
  const focoEfectivo = { ...foco, paisIds: focoPaisEfectivo(sesion, foco.paisIds) }
  const exceso = await validarPesoTransversales(objetivo.periodoId, focoEfectivo, datos.data.peso, objetivoId)
  if (exceso) return { ok: false as const, error: exceso }

  const antes = await totalesPeriodo(objetivo.periodoId)
  await prisma.objetivo.update({
    where: { id: objetivoId },
    data: {
      titulo: datos.data.titulo,
      descripcion: datos.data.descripcion || null,
      peso: datos.data.peso,
      metaFecha: datos.data.metaFecha || null,
      focoAreaIds: foco.areaIds,
      focoNivelIds: foco.nivelIds,
      focoPaisIds: focoPaisEfectivo(sesion, foco.paisIds),
      focoPuestoIds: foco.puestoIds,
    },
  })
  const notificados = await notificarDescuadre(objetivo.periodoId, antes)
  revalidatePath('/admin/transversales')
  revalidatePath('/objetivos')
  revalidatePath('/equipo/objetivos')
  return { ok: true as const, notificados }
}

export async function eliminarTransversal(objetivoId: string) {
  const sesion = await requiereAdmin('OBJETIVOS', 'GESTIONAR')
  const objetivo = await prisma.objetivo.findUnique({ where: { id: objetivoId }, include: { _count: { select: { logros: true } } } })
  if (!objetivo || objetivo.tipo !== 'TRANSVERSAL') return { ok: false as const, error: 'Objetivo no encontrado' }
  if (transversalFueraDeAlcance(sesion, objetivo.focoPaisIds)) return { ok: false as const, error: 'Este transversal está fuera de tu país' }
  if (objetivo._count.logros > 0) {
    return { ok: false as const, error: 'Ya tiene logros cargados: eliminarlo afectaría resultados del período' }
  }
  const congelado = await periodoCongelado(objetivo.periodoId)
  if (congelado) return { ok: false as const, error: congelado }
  const bloqueo = await validarVentanaCarga(objetivo.periodoId, true)
  if (bloqueo) return { ok: false as const, error: bloqueo }

  const antes = await totalesPeriodo(objetivo.periodoId)
  await prisma.objetivo.delete({ where: { id: objetivoId } })
  const notificados = await notificarDescuadre(objetivo.periodoId, antes)
  revalidatePath('/admin/transversales')
  revalidatePath('/objetivos')
  revalidatePath('/equipo/objetivos')
  return { ok: true as const, notificados }
}

export async function cargarLogroTransversal(objetivoId: string, logro: number) {
  const sesion = await requiereAdmin('OBJETIVOS', 'GESTIONAR')
  const objetivo = await prisma.objetivo.findUnique({ where: { id: objetivoId } })
  if (!objetivo || objetivo.tipo !== 'TRANSVERSAL') return { ok: false as const, error: 'Objetivo no encontrado' }
  if (transversalFueraDeAlcance(sesion, objetivo.focoPaisIds)) return { ok: false as const, error: 'Este transversal está fuera de tu país' }
  // El logro se carga con el ciclo en marcha; con todos los ciclos del período cerrados,
  // los resultados son historial congelado y el logro ya no se toca.
  const ciclosActivos = await prisma.ciclo.count({ where: { periodoId: objetivo.periodoId, estado: 'ACTIVO' } })
  if (ciclosActivos === 0) {
    const cerrados = await prisma.ciclo.count({ where: { periodoId: objetivo.periodoId, estado: 'CERRADO' } })
    return {
      ok: false as const,
      error: cerrados > 0
        ? 'El ciclo que evaluó este período ya está cerrado: sus resultados quedaron congelados y el logro no se puede modificar'
        : 'El logro se carga cuando el ciclo de evaluación del período esté en marcha',
    }
  }
  // Aplica el logro a los evaluados de los ciclos que evalúan este período (acotado al país del RR.HH.)
  const evaluados = await prisma.asignacion.findMany({
    where: { ciclo: { periodoId: objetivo.periodoId }, evaluado: { is: alcancePaisWhere(sesion) } },
    select: { evaluadoId: true }, distinct: ['evaluadoId'],
  })
  const valor = Math.max(0, Math.min(Math.round(logro), 100))
  await prisma.$transaction(
    evaluados.map(({ evaluadoId }) =>
      prisma.objetivoLogro.upsert({
        where: { objetivoId_colaboradorId: { objetivoId, colaboradorId: evaluadoId } },
        create: { objetivoId, colaboradorId: evaluadoId, logroFinal: valor },
        update: { logroFinal: valor },
      }),
    ),
  )
  // El logro del transversal entra a la nota de objetivos: recalcular los resultados vivos
  // (los de ciclos CERRADOS quedan congelados tal como se publicaron, y dentro de un ciclo
  // activo también los de PAÍSES ya cerrados)
  const resultados = await prisma.resultado.findMany({
    where: { ciclo: { periodoId: objetivo.periodoId, estado: 'ACTIVO' } },
    select: { cicloId: true, colaboradorId: true, colaborador: { select: { paisId: true } } },
  })
  const congeladosPorCiclo = new Map<string, Set<string>>()
  let recalculados = 0
  for (const r of resultados) {
    if (!congeladosPorCiclo.has(r.cicloId)) congeladosPorCiclo.set(r.cicloId, await paisesCongelados(r.cicloId))
    if (congeladosPorCiclo.get(r.cicloId)!.has(r.colaborador.paisId)) continue
    await calcularResultado(r.cicloId, r.colaboradorId)
    recalculados += 1
  }
  revalidatePath('/admin/transversales')
  return { ok: true as const, recalculados }
}

// ───────────── Ciclos ─────────────

const esquemaCiclo = z.object({
  nombre: z.string().trim().min(4).max(150),
  descripcion: z.string().trim().max(2000).optional(),
  // Vacío/ausente = ciclo sin objetivos: la nota final se calcula 100% con competencias.
  periodoId: z.string().optional(),
  fechaInicio: z.string().min(8),
  fechaFin: z.string().min(8),
})

/** Resuelve el período de objetivos del ciclo a partir del input del wizard: vacío/ausente
 * → ciclo sin objetivos (periodoId: null); si viene, valida que exista y no esté en borrador
 * (mismas reglas de siempre). Compartido por crearCiclo y editarCiclo. */
async function resolverPeriodoCiclo(periodoIdInput: string | undefined) {
  if (!periodoIdInput) return { ok: true as const, periodoId: null }
  const periodo = await prisma.periodoObjetivos.findUnique({ where: { id: periodoIdInput } })
  if (!periodo) return { ok: false as const, error: 'Período de objetivos no encontrado' }
  if (periodo.estado === 'BORRADOR') return { ok: false as const, error: 'El período aún no abrió su carga de objetivos' }
  return { ok: true as const, periodoId: periodo.id }
}

/** Valida un set de evaluaciones para un ciclo: activas, con preguntas y sin alcances repetidos. */
async function validarSetEvaluaciones(evaluacionIds: string[]) {
  const idsUnicos = [...new Set(evaluacionIds)].filter(Boolean)
  if (idsUnicos.length === 0) return { ok: false as const, error: 'Selecciona al menos una evaluación' }
  const evaluaciones = await prisma.evaluacion.findMany({
    where: { id: { in: idsUnicos }, activa: true },
    include: {
      // Solo filas cuya modalidad la pregunta DECLARA: la plantilla pudo ensuciarse por seed
      // (ítems ascendente copiados a las 4 modalidades) y el snapshot no debe heredarlo
      preguntas: {
        select: { preguntaId: true, modalidad: true, pregunta: { select: { modalidades: true } } },
      },
      preguntasPotencial: { select: { preguntaPotencialId: true } },
    },
  })
  if (evaluaciones.length !== idsUnicos.length) return { ok: false as const, error: 'Alguna evaluación elegida no existe o está inactiva' }
  for (const e of evaluaciones) {
    e.preguntas = e.preguntas.filter((p) => p.pregunta.modalidades.includes(p.modalidad))
  }
  const sinPreguntas = evaluaciones.filter((e) => e.preguntas.length === 0)
  if (sinPreguntas.length > 0) return { ok: false as const, error: `Sin preguntas configuradas: ${sinPreguntas.map((e) => e.nombre).join(', ')}` }
  // Un alcance no puede repetirse (dos evaluaciones del mismo nivel o del mismo puesto)
  const alcances = evaluaciones.map((e) => (e.nivelId ? `nivel:${e.nivelId}` : `puesto:${e.puestoId}`))
  if (new Set(alcances).size !== alcances.length) return { ok: false as const, error: 'Hay dos evaluaciones con el mismo alcance (nivel o puesto)' }
  return { ok: true as const, evaluaciones }
}

/** Snapshot vigente de configuración para el ciclo (pesos de modalidades y combinación por nivel). */
async function configSnapshotCiclo() {
  const [pesosModalidades, pesosSinReportes, niveles] = await Promise.all([
    prisma.config.findUnique({ where: { clave: 'pesosModalidades' } }),
    prisma.config.findUnique({ where: { clave: 'pesosModalidadesSinReportes' } }),
    prisma.nivelJerarquico.findMany(),
  ])
  return {
    pesosModalidades: (pesosModalidades?.valor as object) ?? {},
    // Manual Hunter: sin reportes directos, redistribución FIJA (Jefe 60 · Pares 40) — no proporcional
    pesosModalidadesSinReportes: (pesosSinReportes?.valor as object) ?? { JEFE: 60, PAR: 40, ASCENDENTE: 0, AUTO: 0 },
    combinacionPorNivel: Object.fromEntries(niveles.map((n) => [n.id, { comp: n.compPct, obj: 100 - n.compPct }])),
  }
}

/** Crea el ciclo con su set de evaluaciones: una por nivel (vía rápida) + excepciones por puesto.
 * Las preguntas se COPIAN al ciclo (snapshot con alcance y modalidad) para que editar
 * las plantillas luego no altere ciclos ya creados. Un nivel sin evaluación solo genera aviso en el wizard. */
export async function crearCiclo(formData: FormData, evaluacionIds: string[], alcance: AlcanceInput) {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  const datos = esquemaCiclo.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }

  const set = await validarSetEvaluaciones(evaluacionIds)
  if (!set.ok) return set
  const evaluaciones = set.evaluaciones

  const per = await resolverPeriodoCiclo(datos.data.periodoId)
  if (!per.ok) return per

  const va = await validarAlcanceCiclo(sesion, alcance)
  if (!va.ok) return va

  const ciclo = await prisma.ciclo.create({
    data: {
      nombre: datos.data.nombre,
      descripcion: datos.data.descripcion || null,
      periodoId: per.periodoId,
      paisId: va.paisId,
      focoPaisIds: va.alcance.focoPaisIds,
      focoAreaIds: va.alcance.focoAreaIds,
      focoNivelIds: va.alcance.focoNivelIds,
      incluirIds: va.alcance.incluirIds,
      excluirIds: va.alcance.excluirIds,
      // Medianoche LOCAL (un 'yyyy-mm-dd' pelado se parsea como UTC y en América se ve un día antes)
      fechaInicio: new Date(`${datos.data.fechaInicio}T00:00:00`),
      fechaFin: new Date(`${datos.data.fechaFin}T23:59:59`),
      estado: 'BORRADOR',
      configJson: await configSnapshotCiclo(),
      evaluaciones: { create: evaluaciones.map((e) => ({ evaluacionId: e.id })) },
      preguntas: {
        create: evaluaciones.flatMap((e) =>
          e.preguntas.map((p) => ({ preguntaId: p.preguntaId, modalidad: p.modalidad, nivelId: e.nivelId, puestoId: e.puestoId })),
        ),
      },
      preguntasPotencial: {
        create: evaluaciones.flatMap((e) =>
          e.preguntasPotencial.map((p) => ({ preguntaPotencialId: p.preguntaPotencialId, nivelId: e.nivelId, puestoId: e.puestoId })),
        ),
      },
    },
  })
  await prisma.auditLog.create({
    data: {
      usuarioId: sesion.id,
      accion: 'CICLO_CREADO',
      entidad: ciclo.id,
      detalle: { nombre: ciclo.nombre, evaluaciones: evaluaciones.map((e) => e.nombre), alcance: { ...va.alcance } },
    },
  })
  revalidatePath('/admin/ciclos')
  return { ok: true as const, cicloId: ciclo.id }
}

/** Carga un ciclo verificando que sea editable: existe, dentro del alcance y EN BORRADOR. */
async function cicloBorradorEditable(sesion: Awaited<ReturnType<typeof requiereRrhh>>, cicloId: string) {
  const ciclo = await prisma.ciclo.findUnique({
    where: { id: cicloId },
    include: { evaluaciones: { include: { evaluacion: { select: { nombre: true } } } } },
  })
  if (!ciclo) return { ok: false as const, error: 'Ciclo no encontrado' }
  if (cicloFueraDeAlcance(sesion, ciclo)) return { ok: false as const, error: 'Ese ciclo está fuera de tu país' }
  if (ciclo.estado !== 'BORRADOR') {
    return { ok: false as const, error: 'Solo se puede editar un ciclo en borrador: uno lanzado ya generó sus cuestionarios' }
  }
  return { ok: true as const, ciclo }
}

/** Re-snapshot del set de evaluaciones de un ciclo en borrador (transacción compartida por
 * «Editar evaluaciones» y «Editar ciclo»): borra el snapshot anterior y copia el nuevo. */
type SetEvaluaciones = Extract<Awaited<ReturnType<typeof validarSetEvaluaciones>>, { ok: true }>['evaluaciones']

async function reemplazarSnapshotEvaluaciones(
  cicloId: string,
  evaluaciones: SetEvaluaciones,
  datosCiclo: Record<string, unknown> = {},
) {
  await prisma.$transaction([
    prisma.cicloEvaluacion.deleteMany({ where: { cicloId } }),
    prisma.cicloPregunta.deleteMany({ where: { cicloId } }),
    prisma.cicloPreguntaPotencial.deleteMany({ where: { cicloId } }),
    prisma.ciclo.update({
      where: { id: cicloId },
      data: {
        ...datosCiclo,
        configJson: await configSnapshotCiclo(),
        evaluaciones: { create: evaluaciones.map((e) => ({ evaluacionId: e.id })) },
        preguntas: {
          create: evaluaciones.flatMap((e) =>
            e.preguntas.map((p) => ({ preguntaId: p.preguntaId, modalidad: p.modalidad, nivelId: e.nivelId, puestoId: e.puestoId })),
          ),
        },
        preguntasPotencial: {
          create: evaluaciones.flatMap((e) =>
            e.preguntasPotencial.map((p) => ({ preguntaPotencialId: p.preguntaPotencialId, nivelId: e.nivelId, puestoId: e.puestoId })),
          ),
        },
      },
    }),
  ])
}

/** Reemplaza SOLO el set de evaluaciones de un ciclo EN BORRADOR (re-snapshot completo de
 * preguntas): corrige el set antes de lanzar, p.ej. si un nivel quedó sin evaluación o si el
 * catálogo cambió después de crear el ciclo. También refresca el snapshot de configuración. */
export async function editarEvaluacionesCiclo(cicloId: string, evaluacionIds: string[]) {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  const editable = await cicloBorradorEditable(sesion, cicloId)
  if (!editable.ok) return editable
  const ciclo = editable.ciclo

  const set = await validarSetEvaluaciones(evaluacionIds)
  if (!set.ok) return set

  await reemplazarSnapshotEvaluaciones(cicloId, set.evaluaciones)
  await prisma.auditLog.create({
    data: {
      usuarioId: sesion.id,
      accion: 'CICLO_EVALUACIONES_EDITADAS',
      entidad: cicloId,
      detalle: {
        nombre: ciclo.nombre,
        antes: ciclo.evaluaciones.map((e) => e.evaluacion.nombre),
        despues: set.evaluaciones.map((e) => e.nombre),
      },
    },
  })
  revalidatePath(`/admin/ciclos/${cicloId}`)
  revalidatePath('/admin/ciclos')
  return { ok: true as const }
}

/** Edita un ciclo EN BORRADOR completo (mismos datos del wizard de creación): nombre,
 * descripción, alcance de país, período, fechas y set de evaluaciones (re-snapshot). */
export async function editarCiclo(cicloId: string, formData: FormData, evaluacionIds: string[], alcance: AlcanceInput) {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  const editable = await cicloBorradorEditable(sesion, cicloId)
  if (!editable.ok) return editable
  const ciclo = editable.ciclo

  const datos = esquemaCiclo.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }

  const set = await validarSetEvaluaciones(evaluacionIds)
  if (!set.ok) return set

  const per = await resolverPeriodoCiclo(datos.data.periodoId)
  if (!per.ok) return per

  const va = await validarAlcanceCiclo(sesion, alcance)
  if (!va.ok) return va

  await reemplazarSnapshotEvaluaciones(cicloId, set.evaluaciones, {
    nombre: datos.data.nombre,
    descripcion: datos.data.descripcion || null,
    periodoId: per.periodoId,
    paisId: va.paisId,
    focoPaisIds: va.alcance.focoPaisIds,
    focoAreaIds: va.alcance.focoAreaIds,
    focoNivelIds: va.alcance.focoNivelIds,
    incluirIds: va.alcance.incluirIds,
    excluirIds: va.alcance.excluirIds,
    // Medianoche LOCAL (un 'yyyy-mm-dd' pelado se parsea como UTC y en América se ve un día antes)
    fechaInicio: new Date(`${datos.data.fechaInicio}T00:00:00`),
    fechaFin: new Date(`${datos.data.fechaFin}T23:59:59`),
  })
  await prisma.auditLog.create({
    data: {
      usuarioId: sesion.id,
      accion: 'CICLO_EDITADO',
      entidad: cicloId,
      detalle: {
        antes: { nombre: ciclo.nombre, evaluaciones: ciclo.evaluaciones.map((e) => e.evaluacion.nombre) },
        despues: { nombre: datos.data.nombre, evaluaciones: set.evaluaciones.map((e) => e.nombre), alcance: { ...va.alcance } },
      },
    },
  })
  revalidatePath(`/admin/ciclos/${cicloId}`)
  revalidatePath('/admin/ciclos')
  return { ok: true as const }
}

export type AlcanceInput = { focoPaisIds: string[]; focoAreaIds: string[]; focoNivelIds: string[]; incluirIds: string[]; excluirIds: string[] }

/** Normaliza y valida el alcance del wizard: ids contra catálogos, sin intersección
 * incluir/excluir, y el foco de países FORZADO al país del RR.HH.-país (mismo patrón
 * que focoPaisEfectivo de transversales). Devuelve el alcance saneado + paisId derivado. */
async function validarAlcanceCiclo(sesion: Awaited<ReturnType<typeof requiereRrhh>>, input: AlcanceInput) {
  const limpiar = (xs: string[]) => [...new Set(xs.map((x) => String(x).trim()).filter(Boolean))]
  const forzadoCiclo = paisForzado(sesion)
  const focoPaisIds = forzadoCiclo ? [forzadoCiclo] : limpiar(input.focoPaisIds)
  const focoAreaIds = limpiar(input.focoAreaIds)
  const focoNivelIds = limpiar(input.focoNivelIds)
  const incluirIds = limpiar(input.incluirIds)
  const excluirIds = limpiar(input.excluirIds)

  // Tope de tamaño: el mismo límite que valida la forma del input de previewAlcance (zod .max()).
  if (
    focoPaisIds.length > 50 || focoAreaIds.length > 50 || focoNivelIds.length > 50 ||
    incluirIds.length + excluirIds.length > 500
  ) {
    return { ok: false as const, error: 'Solicitud inválida' }
  }

  const enAmbas = incluirIds.filter((id) => excluirIds.includes(id))
  if (enAmbas.length > 0) return { ok: false as const, error: 'Una persona no puede estar agregada y excluida a la vez' }

  const [paises, areas, niveles, personas] = await Promise.all([
    prisma.pais.count({ where: { id: { in: focoPaisIds } } }),
    prisma.area.count({ where: { id: { in: focoAreaIds } } }),
    prisma.nivelJerarquico.count({ where: { id: { in: focoNivelIds } } }),
    prisma.colaborador.findMany({ where: { id: { in: [...incluirIds, ...excluirIds] } }, select: { id: true, paisId: true } }),
  ])
  if (paises !== focoPaisIds.length || areas !== focoAreaIds.length || niveles !== focoNivelIds.length) {
    return { ok: false as const, error: 'El alcance referencia países, áreas o niveles que no existen' }
  }
  if (personas.length !== incluirIds.length + excluirIds.length) {
    return { ok: false as const, error: 'El alcance referencia colaboradores que no existen' }
  }
  // RR.HH.-país: los ajustes manuales solo pueden tocar colaboradores de su propio país
  // (rechazo explícito — nunca filtrado silencioso, para que RR.HH. sepa que no puede).
  if (forzadoCiclo) {
    const fueraDePais = personas.some((p) => p.paisId !== sesion.alcancePaisId)
    if (fueraDePais) return { ok: false as const, error: 'Los ajustes manuales solo pueden incluir colaboradores de tu país' }
  }
  // El país es el TECHO del alcance: un agregado manual (incluirIds) nunca puede
  // pertenecer a un país fuera del foco de países — solo excluirIds cross-país es inocuo.
  if (focoPaisIds.length > 0) {
    const paisIdPorId = new Map(personas.map((p) => [p.id, p.paisId]))
    const incluidoFueraDePais = incluirIds.some((id) => {
      const paisId = paisIdPorId.get(id)
      return paisId !== undefined && !focoPaisIds.includes(paisId)
    })
    if (incluidoFueraDePais) {
      return { ok: false as const, error: 'Los agregados manuales deben pertenecer a los países del alcance del ciclo' }
    }
  }
  return {
    ok: true as const,
    alcance: { focoPaisIds, focoAreaIds, focoNivelIds, incluirIds, excluirIds },
    paisId: paisIdDerivado(focoPaisIds),
  }
}

export async function lanzarCiclo(cicloId: string) {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  const ciclo = await prisma.ciclo.findUnique({ where: { id: cicloId } })
  if (!ciclo) return { ok: false as const, error: 'Ciclo no encontrado' }
  if (cicloFueraDeAlcance(sesion, ciclo)) return { ok: false as const, error: 'Ese ciclo está fuera de tu país' }
  if (ciclo.estado !== 'BORRADOR') return { ok: false as const, error: 'El ciclo ya fue lanzado' }

  // Pre-flight: el mismo checklist que ve RR.HH. se re-verifica aquí (defensa server-side).
  const pf = await preflightCiclo(cicloId)
  if (!pf) return { ok: false as const, error: 'Ciclo no encontrado' }
  if (!pf.listo) {
    const objetivos = pf.bloqueantes.objetivosIncompletos.slice(0, 3).map((x) => `${x.nombre} (${x.pct}%)`).join(', ')
    const vacios = pf.bloqueantes.cuestionariosVacios.slice(0, 3).map((x) => x.nombre).join(', ')
    const partes = [
      pf.bloqueantes.sinEvaluados ? 'el alcance no incluye a ningún evaluado — edita el ciclo y ajusta filtros o ajustes manuales' : null,
      pf.bloqueantes.periodoYaEvaluado ? `el período ya es evaluado por «${pf.bloqueantes.periodoYaEvaluado.ciclo}» (los logros de objetivos son únicos por período: usa un período nuevo)` : null,
      pf.bloqueantes.objetivosIncompletos.length > 0 ? `objetivos incompletos: ${objetivos}` : null,
      pf.bloqueantes.cuestionariosVacios.length > 0 ? `cuestionarios vacíos: ${vacios}` : null,
    ].filter(Boolean)
    return { ok: false as const, error: `La verificación de lanzamiento tiene pendientes — ${partes.join(' · ')}` }
  }

  // El país del ciclo acota a los EVALUADOS (quienes reciben calificación). Los insumos que
  // impactan su nota — jefe y ascendentes; los pares se nominan aparte — se habilitan sin
  // importar el país ni la participación del evaluador: un gerente de país suele tener a su
  // jefe y a parte de sus reportes en otro país. Al evaluador externo solo se le exige lo
  // mismo que a un par: estar activo y tener la antigüedad mínima.
  const todos = await prisma.colaborador.findMany({
    where: { activo: true },
    select: { id: true, jefeId: true, fechaIngreso: true, paisId: true, areaId: true, puestoId: true, puesto: { select: { nivelId: true } } },
  })
  // Regla de antigüedad: menos de 6 meses al inicio del ciclo → no evalúa ni es evaluado;
  // su carga de objetivos del período no se toca.
  const puedeEvaluar = (c: { fechaIngreso: Date | null }) => !excluidoPorAntiguedad(c.fechaIngreso, ciclo.fechaInicio)
  const porId = new Map(todos.map((c) => [c.id, c]))
  const { evaluados: colaboradores } = resolverAlcance(
    todos.map((c) => ({ ...c, activo: true, nivelId: c.puesto?.nivelId ?? null })),
    { focoPaisIds: ciclo.focoPaisIds, focoAreaIds: ciclo.focoAreaIds, focoNivelIds: ciclo.focoNivelIds },
    { incluirIds: ciclo.incluirIds, excluirIds: ciclo.excluirIds },
    ciclo.fechaInicio,
  )
  if (colaboradores.length === 0) return { ok: false as const, error: 'El alcance no incluye a ningún evaluado: edita el ciclo y ajusta filtros o ajustes manuales' }
  const reportesPorJefe = new Map<string, string[]>()
  for (const c of todos) {
    if (c.jefeId && puedeEvaluar(c)) reportesPorJefe.set(c.jefeId, [...(reportesPorJefe.get(c.jefeId) ?? []), c.id])
  }

  const asignaciones: { evaluadorId: string; evaluadoId: string; tipo: 'AUTO' | 'JEFE' | 'ASCENDENTE' }[] = []
  for (const c of colaboradores) {
    asignaciones.push({ evaluadorId: c.id, evaluadoId: c.id, tipo: 'AUTO' })
    const jefe = c.jefeId ? porId.get(c.jefeId) : undefined
    if (jefe && puedeEvaluar(jefe)) {
      asignaciones.push({ evaluadorId: jefe.id, evaluadoId: c.id, tipo: 'JEFE' })
    }
    for (const reporteId of reportesPorJefe.get(c.id) ?? []) {
      asignaciones.push({ evaluadorId: reporteId, evaluadoId: c.id, tipo: 'ASCENDENTE' })
    }
  }

  /* Perfil de evaluación CONGELADO de cada participante (ver CicloPerfilEvaluado): el puesto y
     el nivel por los que se le evalúa, las competencias que filtran su cuestionario y los pesos
     por dimensión de su nota. Sin esto, editar el maestro de puestos movía la nota y el
     cuestionario de gente a medio evaluar. Va en la misma transacción que las asignaciones: un
     participante sin perfil caería al maestro, que es justo lo que se quiere evitar. */
  const puestosEvaluados = await prisma.puesto.findMany({
    where: { id: { in: [...new Set(colaboradores.map((c) => c.puestoId).filter((x): x is string => Boolean(x)))] } },
    select: {
      id: true, nivelId: true,
      competencias: { select: { competenciaId: true } },
      pesos: { select: { dimensionId: true, peso: true, puntajeEsperado: true } },
    },
  })
  const puestoPorId = new Map(puestosEvaluados.map((p) => [p.id, p]))
  const perfiles = colaboradores.map((c) => {
    const puesto = c.puestoId ? puestoPorId.get(c.puestoId) : undefined
    return {
      cicloId,
      colaboradorId: c.id,
      puestoId: c.puestoId ?? null,
      nivelId: puesto?.nivelId ?? null,
      competenciaIds: puesto?.competencias.map((x) => x.competenciaId) ?? [],
      pesosJson: puesto?.pesos.map((x) => ({ dimensionId: x.dimensionId, peso: x.peso, puntajeEsperado: x.puntajeEsperado })) ?? [],
    }
  })

  await prisma.$transaction([
    prisma.asignacion.createMany({
      data: asignaciones.map((a) => ({ ...a, cicloId })),
      skipDuplicates: true,
    }),
    prisma.cicloPerfilEvaluado.createMany({ data: perfiles, skipDuplicates: true }),
    prisma.ciclo.update({ where: { id: cicloId }, data: { estado: 'ACTIVO' } }),
    prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'CICLO_LANZADO', entidad: cicloId, detalle: { asignaciones: asignaciones.length, alcance: { focoPaisIds: ciclo.focoPaisIds, focoAreaIds: ciclo.focoAreaIds, focoNivelIds: ciclo.focoNivelIds, incluidos: ciclo.incluirIds.length, excluidos: ciclo.excluirIds.length } } } }),
  ])
  // Sin revalidar el propio detalle, en producción el Router Cache puede seguir sirviendo la
  // vista de borrador tras el lanzamiento (en dev no hay cache y no se nota).
  revalidatePath('/admin/ciclos')
  revalidatePath(`/admin/ciclos/${cicloId}`)

  // Aviso de apertura a cada evaluador con cuenta: qué evaluaciones le tocan y hasta cuándo.
  // after(): en serverless un `void promesa` muere al responder; esto corre tras la respuesta.
  after(async () => {
    try {
      const { deadline, destinatarios, sinCuenta } = await pendientesEvaluaciones(cicloId)
      const deadlineTexto = deadline.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })
      const correos = destinatarios.map((d) => construirAperturaCiclo(d.email, d.nombre, ciclo.nombre, deadlineTexto, d.pendientes))
      const r = await enviarBatch(correos)
      // El push acompaña al correo de apertura: es el aviso que más gana con llegar al instante
      const push = await enviarPushACorreos(destinatarios.map((d) => d.email), {
        titulo: 'Tienes evaluaciones por responder',
        cuerpo: `${ciclo.nombre} · hasta el ${deadlineTexto}`,
        ruta: '/evaluaciones',
        etiqueta: 'evaluaciones',
      }).catch(() => null)
      console.log(`[lanzarCiclo] Apertura «${ciclo.nombre}»: ${r.enviados} enviados · ${r.fallidos} fallidos · ${sinCuenta} sin cuenta · push ${push?.enviados ?? 0}`)
      if (r.erroresMuestra.length > 0) console.error('[lanzarCiclo] Muestra de errores:', r.erroresMuestra)
    } catch (e) {
      console.error(`[lanzarCiclo] Falló el aviso de apertura del ciclo ${cicloId}:`, e)
    }
  })
  return { ok: true as const, total: asignaciones.length }
}

/** Un ciclo solo se elimina mientras es BORRADOR: nadie fue notificado ni respondió nada.
 * Lanzado (activo o cerrado) se conserva como historial. El delete arrastra el snapshot
 * de preguntas y las referencias a evaluaciones (cascade). */
export async function eliminarCiclo(cicloId: string) {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  const ciclo = await prisma.ciclo.findUnique({ where: { id: cicloId } })
  if (!ciclo) return { ok: false as const, error: 'Ciclo no encontrado' }
  if (cicloFueraDeAlcance(sesion, ciclo)) return { ok: false as const, error: 'Ese ciclo está fuera de tu país' }
  if (ciclo.estado !== 'BORRADOR') return { ok: false as const, error: 'Solo se puede eliminar un ciclo en borrador: uno ya lanzado se conserva como historial' }
  await prisma.ciclo.delete({ where: { id: cicloId } })
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'CICLO_ELIMINADO', entidad: cicloId, detalle: { nombre: ciclo.nombre } } })
  revalidatePath('/admin/ciclos')
  return { ok: true as const }
}

/** Asigna pares manualmente (RR.HH. o el jefe en su alcance). */
export async function asignarPar(cicloId: string, evaluadorId: string, evaluadoId: string) {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  if (evaluadorId === evaluadoId) return { ok: false as const, error: 'Un colaborador no puede ser su propio par' }
  const [ciclo, evaluador, evaluado] = await Promise.all([
    prisma.ciclo.findUnique({ where: { id: cicloId }, select: { fechaInicio: true } }),
    prisma.colaborador.findUnique({ where: { id: evaluadorId }, select: { activo: true, fechaIngreso: true } }),
    prisma.colaborador.findUnique({ where: { id: evaluadoId }, select: { paisId: true } }),
  ])
  if (!ciclo || !evaluador || !evaluado) return { ok: false as const, error: 'Ciclo o colaboradores no encontrados' }
  // El alcance de RR.HH. de país aplica sobre el EVALUADO (a quién gestiona); el par
  // evaluador puede ser de cualquier país — aporta su mirada, no recibe evaluación
  // (altos mandos suelen tener a sus pares reales en otro país).
  if (fueraDeAlcancePais(sesion, evaluado.paisId)) {
    return { ok: false as const, error: 'El evaluado está fuera de tu país' }
  }
  if (!evaluador.activo) return { ok: false as const, error: 'Ese colaborador está dado de baja: no puede evaluar' }
  if (excluidoPorAntiguedad(evaluador.fechaIngreso, ciclo.fechaInicio)) {
    return { ok: false as const, error: 'Ese colaborador tiene menos de 6 meses de antigüedad al inicio del ciclo: aún no puede evaluar como par' }
  }
  // Solo se evalúa a quien PARTICIPA: un PAR sobre un excluido o un retirado le crearía
  // una nota parcial (o «resucitaría» a quien RR.HH. sacó del ciclo en Rotación)
  const evaluadoParticipa = await prisma.asignacion.findFirst({ where: { cicloId, evaluadoId, tipo: 'AUTO' }, select: { id: true } })
  if (!evaluadoParticipa) return { ok: false as const, error: 'Esa persona no participa de este ciclo (excluida por antigüedad o retirada por rotación): no puede recibir evaluaciones de par' }
  // Una evaluación de ese par ya invalidada por RR.HH. es registro terminal: re-asignarlo
  // reviviría un slot cerrado (el upsert sobre la unique lo despertaría en silencio).
  const previa = await prisma.asignacion.findUnique({
    where: { cicloId_evaluadorId_evaluadoId_tipo: { cicloId, evaluadorId, evaluadoId, tipo: 'PAR' } },
    select: { estado: true },
  })
  if (previa?.estado === 'INVALIDADA') return { ok: false as const, error: 'La evaluación de ese par fue invalidada en este ciclo y se conserva como registro: nomina a otra persona como par' }
  await prisma.asignacion.upsert({
    where: { cicloId_evaluadorId_evaluadoId_tipo: { cicloId, evaluadorId, evaluadoId, tipo: 'PAR' } },
    create: { cicloId, evaluadorId, evaluadoId, tipo: 'PAR' },
    update: {},
  })
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'PAR_ASIGNADO', entidad: cicloId, detalle: { evaluadorId, evaluadoId } } })
  // Aviso al par (correo + push) solo si la asignación es nueva: el upsert sobre una existente no re-avisa
  if (!previa) {
    after(async () => {
      try {
        const r = await notificarParAsignado(cicloId, evaluadorId, evaluadoId)
        console.log(`[asignarPar] Aviso al par ${evaluadorId}: ${r.enviados} enviado(s)`)
      } catch (e) {
        console.error('[asignarPar] Falló el aviso al par (la asignación ya está hecha):', e)
      }
    })
  }
  revalidatePath(`/admin/ciclos/${cicloId}`)
  return { ok: true as const }
}

/** RR.HH. aprueba la propuesta de un par externo al equipo (hecha por el jefe): pasa a evaluar. */
export async function aprobarPar(asignacionId: string) {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  const asignacion = await prisma.asignacion.findUnique({ where: { id: asignacionId }, include: { evaluado: { select: { paisId: true } } } })
  if (!asignacion || asignacion.tipo !== 'PAR' || asignacion.estado !== 'PROPUESTA') return { ok: false as const, error: 'La propuesta no existe o ya fue resuelta' }
  if (fueraDeAlcancePais(sesion, asignacion.evaluado.paisId)) return { ok: false as const, error: 'Esa propuesta está fuera de tu país' }
  await prisma.asignacion.update({ where: { id: asignacionId }, data: { estado: 'PENDIENTE' } })
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'PAR_APROBADO', entidad: asignacion.cicloId, detalle: { evaluadorId: asignacion.evaluadorId, evaluadoId: asignacion.evaluadoId } } })
  // Recién aprobada, la evaluación aparece para el par: es el momento del aviso (correo + push)
  after(async () => {
    try {
      const r = await notificarParAsignado(asignacion.cicloId, asignacion.evaluadorId, asignacion.evaluadoId)
      console.log(`[aprobarPar] Aviso al par ${asignacion.evaluadorId}: ${r.enviados} enviado(s)`)
    } catch (e) {
      console.error('[aprobarPar] Falló el aviso al par (la aprobación ya está hecha):', e)
    }
  })
  revalidatePath(`/admin/ciclos/${asignacion.cicloId}`)
  return { ok: true as const }
}

/** RR.HH. rechaza la propuesta de par externo: se elimina (el jefe puede proponer otro). */
export async function rechazarPar(asignacionId: string) {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  const asignacion = await prisma.asignacion.findUnique({ where: { id: asignacionId }, include: { evaluado: { select: { paisId: true } } } })
  if (!asignacion || asignacion.tipo !== 'PAR' || asignacion.estado !== 'PROPUESTA') return { ok: false as const, error: 'La propuesta no existe o ya fue resuelta' }
  if (fueraDeAlcancePais(sesion, asignacion.evaluado.paisId)) return { ok: false as const, error: 'Esa propuesta está fuera de tu país' }
  await prisma.asignacion.delete({ where: { id: asignacionId } })
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'PAR_RECHAZADO', entidad: asignacion.cicloId, detalle: { evaluadorId: asignacion.evaluadorId, evaluadoId: asignacion.evaluadoId } } })
  revalidatePath(`/admin/ciclos/${asignacion.cicloId}`)
  return { ok: true as const }
}

/** RR.HH. retira un par que aún no respondió (mal asignado, cambio de equipo, etc.). */
export async function quitarParRrhh(asignacionId: string) {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  const asignacion = await prisma.asignacion.findUnique({ where: { id: asignacionId }, include: { evaluado: { select: { paisId: true } } } })
  if (!asignacion || asignacion.tipo !== 'PAR') return { ok: false as const, error: 'La asignación no existe' }
  if (asignacion.estado === 'ENVIADA') return { ok: false as const, error: 'Ese par ya envió su evaluación: no se puede retirar' }
  if (asignacion.estado === 'INVALIDADA') return { ok: false as const, error: 'Esa evaluación fue invalidada por RR.HH.: se conserva como registro y no puede modificarse' }
  if (fueraDeAlcancePais(sesion, asignacion.evaluado.paisId)) return { ok: false as const, error: 'Esa asignación está fuera de tu país' }
  await prisma.asignacion.delete({ where: { id: asignacionId } })
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'PAR_RETIRADO', entidad: asignacion.cicloId, detalle: { evaluadorId: asignacion.evaluadorId, evaluadoId: asignacion.evaluadoId, por: 'rrhh' } } })
  revalidatePath(`/admin/ciclos/${asignacion.cicloId}`)
  return { ok: true as const }
}

/** Calibración por componentes: RR.HH. ajusta la nota de dimensiones específicas o el logro
 * de objetivos concretos, y la NOTA FINAL SE RECALCULA con la fórmula real — así el desglose
 * que ve el evaluado siempre explica su nota. Cada ajuste queda en el registro inmutable. */
export async function calibrarDetallado(
  resultadoId: string,
  ajustes: {
    dimensiones: { dimensionId: string; valor: number | null }[] // null = quitar el ajuste (vuelve a la nota calculada)
    objetivos: { objetivoId: string; logro: number }[]
  },
  motivo: string,
) {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  // Escribir la nota es exclusivo del rol de sistema RR.HH.: RESULTADOS es solo-VER anti-escalada,
  // así que un rol configurable con CICLOS:GESTIONAR no debe poder calibrar (alinea con
  // eximirConformidad, que ya exige requiereRrhh). El maker-checker de arriba impide además la
  // propia nota.
  if (sesion.rol !== 'RRHH') return { ok: false as const, error: 'Calibrar, cerrar y publicar resultados es exclusivo de RR.HH.' }
  if (!motivo || motivo.trim().length < 5) return { ok: false as const, error: 'El motivo es obligatorio' }
  if (motivo.trim().length > 2000) return { ok: false as const, error: 'El motivo supera los 2000 caracteres' }
  if (ajustes.dimensiones.some((a) => a.valor !== null && (a.valor < 1 || a.valor > 5))) {
    return { ok: false as const, error: 'La nota de una dimensión debe estar entre 1 y 5' }
  }
  if (ajustes.objetivos.some((a) => a.logro < 0 || a.logro > 100)) {
    return { ok: false as const, error: 'El logro de un objetivo debe estar entre 0 y 100%' }
  }

  const resultado = await prisma.resultado.findUnique({
    where: { id: resultadoId },
    include: { colaborador: { select: { paisId: true } }, ciclo: { select: { periodoId: true } } },
  })
  if (!resultado) return { ok: false as const, error: 'Resultado no encontrado' }
  // Separación de funciones: nadie calibra su PROPIA nota. La calibración es el insumo más directo
  // de la nota final; el mismo maker-checker ya bloquea auto-aprobarse objetivos (objetivos/acciones).
  if (resultado.colaboradorId === sesion.colaboradorId) return { ok: false as const, error: 'No puedes calibrar tu propia nota: que lo haga otra persona de RR.HH.' }
  if (fueraDeAlcancePais(sesion, resultado.colaborador.paisId)) return { ok: false as const, error: 'Ese resultado está fuera de tu país' }
  // Un país cerrado congela sus resultados (mismo criterio que un ciclo cerrado)
  const paisCerrado = await prisma.cicloPaisCierre.findUnique({
    where: { cicloId_paisId: { cicloId: resultado.cicloId, paisId: resultado.colaborador.paisId } },
  })
  if (paisCerrado) return { ok: false as const, error: 'El país de este colaborador ya cerró en este ciclo: su resultado está congelado' }

  const desglose = (resultado.desgloseDimJson as { dimensionId: string; nombre: string; nota: number; ajuste: number | null }[] | null) ?? []
  const vigentes = { ...((resultado.ajustesDimJson as Record<string, number> | null) ?? {}) }
  const registros: { ambito: string; referencia: string; valorAnterior: number; valorNuevo: number }[] = []

  // Ajustes por dimensión: sobre el desglose real del resultado
  for (const a of ajustes.dimensiones) {
    const dim = desglose.find((d) => d.dimensionId === a.dimensionId)
    if (!dim) return { ok: false as const, error: 'Una de las dimensiones ajustadas no existe en este resultado' }
    const actual = vigentes[a.dimensionId] ?? dim.nota
    const nuevo = a.valor ?? dim.nota // quitar el ajuste = volver a la nota calculada
    if (Math.abs(nuevo - actual) < 0.005) continue
    registros.push({ ambito: 'DIMENSION', referencia: dim.nombre, valorAnterior: actual, valorNuevo: nuevo })
    if (a.valor === null) delete vigentes[a.dimensionId]
    else vigentes[a.dimensionId] = a.valor
  }

  // Ajustes de logro por objetivo: sobre la fuente real (ObjetivoLogro), del período del ciclo.
  // Los TRANSVERSALES quedan fuera: su logro lo carga la Dirección y aplica a todos por igual.
  for (const a of ajustes.objetivos) {
    const objetivo = await prisma.objetivo.findUnique({ where: { id: a.objetivoId }, include: { logros: { where: { colaboradorId: resultado.colaboradorId } } } })
    if (!objetivo || objetivo.periodoId !== resultado.ciclo.periodoId) {
      return { ok: false as const, error: 'Uno de los objetivos ajustados no pertenece al período de este ciclo' }
    }
    if (objetivo.tipo === 'TRANSVERSAL') {
      return { ok: false as const, error: 'El logro de un transversal aplica a todos por igual: se gestiona desde Objetivos transversales, no por persona' }
    }
    const actual = objetivo.logros[0]?.logroFinal ?? null
    const nuevo = Math.round(a.logro)
    if (actual !== null && Math.abs(nuevo - actual) < 0.5) continue
    registros.push({ ambito: 'OBJETIVO', referencia: objetivo.titulo, valorAnterior: actual ?? 0, valorNuevo: nuevo })
    await prisma.objetivoLogro.upsert({
      where: { objetivoId_colaboradorId: { objetivoId: objetivo.id, colaboradorId: resultado.colaboradorId } },
      create: { objetivoId: objetivo.id, colaboradorId: resultado.colaboradorId, logroFinal: nuevo },
      update: { logroFinal: nuevo },
    })
  }

  if (registros.length === 0) return { ok: false as const, error: 'No hay cambios que calibrar' }

  await prisma.$transaction([
    prisma.calibracion.createMany({
      data: registros.map((r) => ({ resultadoId, ...r, motivo: motivo.trim(), usuarioId: sesion.id })),
    }),
    // La calibración por componentes reemplaza al ajuste directo legado de la nota final
    prisma.resultado.update({ where: { id: resultadoId }, data: { ajustesDimJson: vigentes, notaCalibrada: null } }),
    prisma.auditLog.create({
      data: { usuarioId: sesion.id, accion: 'CALIBRACION', entidad: resultadoId, detalle: { ajustes: registros, motivo: motivo.trim() } },
    }),
  ])

  // Recalcular con la fórmula real: los ajustes de dimensión y logros entran a la nota final
  const nuevo = await calcularResultado(resultado.cicloId, resultado.colaboradorId)
  revalidatePath('/admin/ciclos')
  revalidatePath('/admin/resultados')
  return { ok: true as const, notaFinal: nuevo.notaFinal }
}

/** Correo a cada participante con resultado en el ciclo: sus resultados ya se pueden revisar.
 * Un correo que falle no revierte la publicación (se registra el conteo en el audit log). */
async function notificarResultadosPublicados(cicloId: string, cicloNombre: string, opts?: { paisId?: string; soloPaisIds?: string[] }) {
  const resultados = await prisma.resultado.findMany({
    where: {
      cicloId,
      // Solo quien TIENE nota: un participante al que nadie le envió evaluaciones queda con
      // resultado vacío, y avisarle «tu resultado ya está disponible» lo manda a una vista en blanco
      OR: [{ notaFinal: { not: null } }, { notaCalibrada: { not: null } }],
      ...(opts?.paisId ? { colaborador: { is: { paisId: opts.paisId } } } : {}),
      ...(opts?.soloPaisIds ? { colaborador: { is: { paisId: { in: opts.soloPaisIds } } } } : {}),
    },
    include: { colaborador: { include: { usuario: { select: { email: true, activo: true } } } } },
  })
  const destinos = resultados
    .map((r) => r.colaborador)
    .filter((c) => c.activo && c.usuario?.activo && c.usuario.email)
  const envios = await Promise.allSettled(
    destinos.map((c) => enviarResultadosPublicados(c.usuario!.email, `${c.nombres} ${c.apellidos}`, cicloNombre)),
  )
  await enviarPushACorreos(destinos.map((c) => c.usuario!.email), {
    titulo: 'Tu resultado ya está disponible',
    cuerpo: `${cicloNombre} · ábrelo en Mi resultado`,
    ruta: '/mi-resultado',
    etiqueta: 'resultado',
  }).catch(() => null)
  return { enviados: envios.filter((e) => e.status === 'fulfilled').length, total: destinos.length }
}

/** Países con participantes en el ciclo (por el país del evaluado) y cuáles ya cerraron. */
async function estadoPaisesCiclo(cicloId: string) {
  const [evaluados, cierres] = await Promise.all([
    prisma.asignacion.findMany({
      where: { cicloId },
      select: { evaluado: { select: { paisId: true } } },
      distinct: ['evaluadoId'],
    }),
    prisma.cicloPaisCierre.findMany({ where: { cicloId } }),
  ])
  const participantes = [...new Set(evaluados.map((e) => e.evaluado.paisId))]
  const cerrados = new Set(cierres.map((c) => c.paisId))
  return { participantes, cierres, pendientes: participantes.filter((p) => !cerrados.has(p)) }
}

function errorFeedbackPendiente(faltantes: string[]) {
  const nombres = faltantes.slice(0, 4).join(', ') + (faltantes.length > 4 ? ` y ${faltantes.length - 4} más` : '')
  const n = faltantes.length
  return `Falta${n === 1 ? '' : 'n'} ${n} sesi${n === 1 ? 'ón' : 'ones'} de feedback por registrar (${nombres}). Los jefes las registran en "Resultados del equipo" antes del cierre.`
}

/** RR.HH. Regional exime a UN colaborador del gate de conformidad (no puede confirmar su nota:
 * vacaciones, licencia, sin cuenta). Por colaborador, con motivo obligatorio y auditado. */
export async function eximirConformidad(resultadoId: string, motivo: string) {
  const sesion = await requiereRrhh()
  if (sesion.alcanceRrhh === 'PAIS') return { ok: false as const, error: 'Solo RR.HH. Regional puede eximir la conformidad (es una excepción al control del cierre)' }
  const limpio = motivo.trim()
  if (limpio.length < 10) return { ok: false as const, error: 'Explica el motivo de la exención (mínimo 10 caracteres): queda en el log de auditoría' }
  if (limpio.length > 2000) return { ok: false as const, error: 'El motivo supera los 2000 caracteres' }

  const resultado = await prisma.resultado.findUnique({
    where: { id: resultadoId },
    include: { ciclo: { select: { id: true, estado: true } }, colaborador: { select: { nombres: true, apellidos: true, paisId: true } } },
  })
  if (!resultado) return { ok: false as const, error: 'Resultado no encontrado' }
  if (resultado.colaboradorId === sesion.colaboradorId) return { ok: false as const, error: 'No puedes eximir tu propia conformidad' }
  if (resultado.ciclo.estado !== 'ACTIVO') return { ok: false as const, error: 'El ciclo no está activo' }
  if (await paisCongelado(resultado.ciclo.id, resultado.colaborador.paisId)) {
    return { ok: false as const, error: 'El país de ese colaborador ya cerró en este ciclo' }
  }
  if (resultado.conformidad) return { ok: false as const, error: 'Ese colaborador ya registró su decisión: no necesita exención' }
  if (resultado.conformidadEximidaEn) return { ok: false as const, error: 'Ese colaborador ya está eximido' }

  const nombre = `${resultado.colaborador.nombres} ${resultado.colaborador.apellidos}`
  await prisma.$transaction([
    prisma.resultado.update({ where: { id: resultadoId }, data: { conformidadEximidaEn: new Date(), conformidadEximidaMotivo: limpio } }),
    prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'CONFORMIDAD_EXIMIDA', entidad: resultado.ciclo.id, detalle: { colaborador: nombre, motivo: limpio } } }),
  ])
  revalidatePath(`/admin/ciclos/${resultado.ciclo.id}`)
  return { ok: true as const }
}

/** Retira una exención de conformidad (el colaborador volvió y puede confirmar). */
export async function quitarExencionConformidad(resultadoId: string) {
  const sesion = await requiereRrhh()
  if (sesion.alcanceRrhh === 'PAIS') return { ok: false as const, error: 'Solo RR.HH. Regional gestiona las exenciones de conformidad' }
  const resultado = await prisma.resultado.findUnique({
    where: { id: resultadoId },
    include: { ciclo: { select: { id: true, estado: true } }, colaborador: { select: { nombres: true, apellidos: true, paisId: true } } },
  })
  if (!resultado || !resultado.conformidadEximidaEn) return { ok: false as const, error: 'Ese colaborador no está eximido' }
  if (resultado.ciclo.estado !== 'ACTIVO') return { ok: false as const, error: 'El ciclo no está activo' }
  if (await paisCongelado(resultado.ciclo.id, resultado.colaborador.paisId)) {
    return { ok: false as const, error: 'El país de ese colaborador ya cerró en este ciclo' }
  }
  await prisma.$transaction([
    prisma.resultado.update({ where: { id: resultadoId }, data: { conformidadEximidaEn: null, conformidadEximidaMotivo: null } }),
    prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'CONFORMIDAD_EXENCION_RETIRADA', entidad: resultado.ciclo.id, detalle: { colaborador: `${resultado.colaborador.nombres} ${resultado.colaborador.apellidos}` } } }),
  ])
  revalidatePath(`/admin/ciclos/${resultado.ciclo.id}`)
  return { ok: true as const }
}

function errorConformidadPendiente(faltantes: string[]) {
  const nombres = faltantes.slice(0, 4).join(', ') + (faltantes.length > 4 ? ` y ${faltantes.length - 4} más` : '')
  const n = faltantes.length
  return `Falta${n === 1 ? '' : 'n'} ${n} conformidad${n === 1 ? '' : 'es'} de nota por registrar (${nombres}). Cada colaborador la registra en "Mi resultado"; si alguien no puede hacerlo, RR.HH. Regional puede eximirlo (con motivo auditado) en la pestaña "Conformidad" del ciclo.`
}

/** Cierra el ciclo: exige las sesiones de feedback registradas, recalcula todos los resultados
 * y opcionalmente publica (con correo a los participantes). Respeta los países ya cerrados:
 * sus notas no se recalculan y sus colaboradores no reciben un segundo correo. */
export async function cerrarCiclo(cicloId: string, publicar: boolean) {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  if (sesion.rol !== 'RRHH') return { ok: false as const, error: 'Calibrar, cerrar y publicar resultados es exclusivo de RR.HH.' }
  const ciclo = await prisma.ciclo.findUnique({ where: { id: cicloId } })
  if (!ciclo || ciclo.estado !== 'ACTIVO') return { ok: false as const, error: 'El ciclo no está activo' }
  if (cicloFueraDeAlcance(sesion, ciclo)) return { ok: false as const, error: 'Ese ciclo está fuera de tu país' }

  const { cierres, pendientes } = await estadoPaisesCiclo(cicloId)

  // Recalcular y exigir feedback + conformidad SOLO de los países aún no cerrados (los cerrados están congelados)
  let total = 0
  const faltantes: string[] = []
  const sinConformidad: string[] = []
  if (cierres.length === 0) {
    total = await calcularResultadosCiclo(cicloId)
    faltantes.push(...(await feedbackPendiente(cicloId)).faltantes)
    sinConformidad.push(...(await conformidadPendiente(cicloId)).faltantes)
  } else {
    for (const paisId of pendientes) {
      total += await calcularResultadosCiclo(cicloId, paisId)
      faltantes.push(...(await feedbackPendiente(cicloId, paisId)).faltantes)
      sinConformidad.push(...(await conformidadPendiente(cicloId, paisId)).faltantes)
    }
  }
  if (faltantes.length > 0) return { ok: false as const, error: errorFeedbackPendiente(faltantes) }
  if (sinConformidad.length > 0) return { ok: false as const, error: errorConformidadPendiente(sinConformidad) }

  /* Claim atómico ACTIVO→CERRADO ANTES de enviar los correos. El botón ya se deshabilita en el
     cliente durante la acción, pero dos pestañas simultáneas podían pasar ambas el guard de arriba
     y publicar dos veces «tu resultado está disponible» a 800 personas. updateMany condicionado
     por estado deja reclamar el cierre a una sola; la otra se retira sin notificar. */
  const reclamo = await prisma.ciclo.updateMany({ where: { id: cicloId, estado: 'ACTIVO' }, data: { estado: 'CERRADO', publicado: publicar } })
  if (reclamo.count === 0) return { ok: false as const, error: 'El ciclo ya fue cerrado' }

  const yaPublicados = cierres.filter((c) => c.publicado).map((c) => c.paisId)
  try {
    await prisma.$transaction([
      // El estado ya se reclamó atómicamente arriba; aquí solo el desglose por país y el audit
      // El desglose por país queda consistente: los pendientes se marcan cerrados aquí
      ...pendientes.map((paisId) =>
        prisma.cicloPaisCierre.upsert({
          where: { cicloId_paisId: { cicloId, paisId } },
          create: { cicloId, paisId, publicado: publicar },
          update: { publicado: publicar },
        }),
      ),
      ...(publicar
        ? [prisma.cicloPaisCierre.updateMany({ where: { cicloId, paisId: { notIn: yaPublicados } }, data: { publicado: true } })]
        : []),
      prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'CICLO_CERRADO', entidad: cicloId, detalle: { resultados: total, publicado: publicar } } }),
    ])
  } catch (e) {
    /* COMPENSACIÓN del claim: sin esto, un error transitorio de la base dejaba el ciclo CERRADO
       sin desglose por país, sin audit y sin correos — y cada reintento moría en «El ciclo no
       está activo» sin acción de reabrir. Se libera el claim y el cierre queda reintentable. */
    await prisma.ciclo.updateMany({ where: { id: cicloId, estado: 'CERRADO' }, data: { estado: 'ACTIVO', publicado: false } })
    console.error('[cerrarCiclo] La transacción del cierre falló; el ciclo se liberó (vuelve a ACTIVO):', e)
    return { ok: false as const, error: 'No se pudo completar el cierre; el ciclo sigue activo. Inténtalo de nuevo.' }
  }
  // Correo solo a quienes aún no habían recibido publicación (países pendientes + cerrados sin
  // publicar), DESPUÉS del commit (patrón lanzarCiclo): un fallo de la base ya no puede dejar
  // correos enviados sobre un cierre que no se persistió.
  if (publicar) {
    after(async () => {
      try {
        const correos = await notificarResultadosPublicados(cicloId, ciclo.nombre, cierres.length > 0
          ? { soloPaisIds: [...pendientes, ...cierres.filter((c) => !c.publicado).map((c) => c.paisId)] }
          : undefined)
        console.log(`[cerrarCiclo] Publicación «${ciclo.nombre}»: ${correos.enviados}/${correos.total} correos enviados`)
      } catch (e) {
        console.error('[cerrarCiclo] Falló el envío de correos de publicación (el cierre ya está persistido):', e)
      }
    })
  }
  revalidatePath('/admin/ciclos')
  return { ok: true as const, total }
}

/** Cierra UN PAÍS de un ciclo regional: exige el feedback de ese país, recalcula solo sus
 * resultados y opcionalmente los publica (correo solo a ese país). El RR.HH. de país cierra
 * el suyo; el Regional, cualquiera. Al cerrar el último país pendiente, el ciclo pasa a
 * CERRADO automáticamente (queda auditado como cierre automático). */
export async function cerrarPaisCiclo(cicloId: string, paisId: string, publicar: boolean) {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  if (sesion.rol !== 'RRHH') return { ok: false as const, error: 'Calibrar, cerrar y publicar resultados es exclusivo de RR.HH.' }
  const ciclo = await prisma.ciclo.findUnique({ where: { id: cicloId } })
  if (!ciclo || ciclo.estado !== 'ACTIVO') return { ok: false as const, error: 'El ciclo no está activo' }
  if (ciclo.paisId) return { ok: false as const, error: 'Este ciclo es de un solo país: usa el cierre del ciclo' }
  if (sesion.alcanceRrhh === 'PAIS' && sesion.alcancePaisId !== paisId) {
    return { ok: false as const, error: 'Solo puedes cerrar tu propio país' }
  }
  const { participantes, cierres } = await estadoPaisesCiclo(cicloId)
  if (!participantes.includes(paisId)) return { ok: false as const, error: 'Ese país no tiene participantes en este ciclo' }
  if (cierres.some((c) => c.paisId === paisId)) return { ok: false as const, error: 'Ese país ya está cerrado en este ciclo' }

  const total = await calcularResultadosCiclo(cicloId, paisId)
  const feedback = await feedbackPendiente(cicloId, paisId)
  if (feedback.faltantes.length > 0) return { ok: false as const, error: errorFeedbackPendiente(feedback.faltantes) }
  const conformidad = await conformidadPendiente(cicloId, paisId)
  if (conformidad.faltantes.length > 0) return { ok: false as const, error: errorConformidadPendiente(conformidad.faltantes) }

  /* CLAIM atómico: crear el cierre ANTES de notificar. El @@unique(cicloId, paisId) garantiza que
     solo una pestaña lo reclame; el `cierres.some` de arriba es solo el mensaje rápido — dos
     pestañas simultáneas lo pasan ambas, y sin este orden las dos enviaban «tu resultado está
     disponible» a todo el país. */
  try {
    await prisma.cicloPaisCierre.create({ data: { cicloId, paisId, publicado: publicar } })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') return { ok: false as const, error: 'Ese país ya está cerrado en este ciclo' }
    throw e
  }
  const pais = await prisma.pais.findUnique({ where: { id: paisId } })
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'CICLO_PAIS_CERRADO', entidad: cicloId, detalle: { pais: pais?.nombre ?? paisId, resultados: total, publicado: publicar } } })
  if (publicar) {
    after(async () => {
      try {
        const correos = await notificarResultadosPublicados(cicloId, ciclo.nombre, { paisId })
        console.log(`[cerrarPaisCiclo] Publicación «${ciclo.nombre}» (${pais?.nombre ?? paisId}): ${correos.enviados}/${correos.total} correos enviados`)
      } catch (e) {
        console.error('[cerrarPaisCiclo] Falló el envío de correos de publicación (el cierre ya está persistido):', e)
      }
    })
  }

  // Auto-cierre del ciclo cuando ya no queda ningún país pendiente
  const despues = await estadoPaisesCiclo(cicloId)
  if (despues.pendientes.length === 0) {
    const publicadoGlobal = despues.cierres.every((c) => c.publicado)
    await prisma.$transaction([
      prisma.ciclo.update({ where: { id: cicloId }, data: { estado: 'CERRADO', publicado: publicadoGlobal } }),
      prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'CICLO_CERRADO', entidad: cicloId, detalle: { automatico: true, motivo: 'todos los países cerrados', publicado: publicadoGlobal } } }),
    ])
  }
  revalidatePath('/admin/ciclos')
  revalidatePath(`/admin/ciclos/${cicloId}`)
  return { ok: true as const, total, cicloCerrado: despues.pendientes.length === 0 }
}

/** Publica los resultados de un país que cerró sin publicar (correo solo a ese país). */
export async function publicarPaisCiclo(cicloId: string, paisId: string) {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  if (sesion.rol !== 'RRHH') return { ok: false as const, error: 'Calibrar, cerrar y publicar resultados es exclusivo de RR.HH.' }
  const ciclo = await prisma.ciclo.findUnique({ where: { id: cicloId }, select: { nombre: true, publicado: true } })
  if (!ciclo) return { ok: false as const, error: 'Ciclo no encontrado' }
  if (ciclo.publicado) return { ok: false as const, error: 'Los resultados ya estaban publicados para todos' }
  if (sesion.alcanceRrhh === 'PAIS' && sesion.alcancePaisId !== paisId) {
    return { ok: false as const, error: 'Solo puedes publicar tu propio país' }
  }
  const cierre = await prisma.cicloPaisCierre.findUnique({ where: { cicloId_paisId: { cicloId, paisId } } })
  if (!cierre) return { ok: false as const, error: 'Ese país aún no está cerrado' }
  if (cierre.publicado) return { ok: false as const, error: 'Ese país ya publicó sus resultados' }

  /* CLAIM atómico: dos pestañas leen publicado:false arriba, pero solo una gana este updateMany
     condicionado — la otra se retira sin reenviar el correo a todo el país. Los correos salen
     DESPUÉS del claim: la publicación no puede quedar «enviada» sin persistirse. */
  const reclamo = await prisma.cicloPaisCierre.updateMany({
    where: { cicloId, paisId, publicado: false },
    data: { publicado: true },
  })
  if (reclamo.count === 0) return { ok: false as const, error: 'Ese país ya publicó sus resultados' }
  const pais = await prisma.pais.findUnique({ where: { id: paisId } })
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'CICLO_PAIS_PUBLICADO', entidad: cicloId, detalle: { pais: pais?.nombre ?? paisId } } })
  after(async () => {
    try {
      const correos = await notificarResultadosPublicados(cicloId, ciclo.nombre, { paisId })
      console.log(`[publicarPaisCiclo] «${ciclo.nombre}» (${pais?.nombre ?? paisId}): ${correos.enviados}/${correos.total} correos enviados`)
    } catch (e) {
      console.error('[publicarPaisCiclo] Falló el envío de correos (la publicación ya está persistida):', e)
    }
  })
  revalidatePath(`/admin/ciclos/${cicloId}`)
  return { ok: true as const }
}

export async function publicarResultados(cicloId: string) {
  const sesion = await requiereAdmin('CICLOS', 'GESTIONAR')
  if (sesion.rol !== 'RRHH') return { ok: false as const, error: 'Calibrar, cerrar y publicar resultados es exclusivo de RR.HH.' }
  const ciclo = await prisma.ciclo.findUnique({ where: { id: cicloId }, select: { paisId: true, nombre: true, publicado: true } })
  if (!ciclo) return { ok: false as const, error: 'Ciclo no encontrado' }
  if (ciclo.publicado) return { ok: false as const, error: 'Los resultados ya estaban publicados' }
  if (cicloFueraDeAlcance(sesion, ciclo)) return { ok: false as const, error: 'Ese ciclo está fuera de tu país' }
  // Los países que ya publicaron por su cuenta no reciben un segundo correo
  const cierres = await prisma.cicloPaisCierre.findMany({ where: { cicloId } })
  const yaPublicados = cierres.filter((c) => c.publicado).map((c) => c.paisId)
  const { participantes } = await estadoPaisesCiclo(cicloId)
  const correos = await notificarResultadosPublicados(cicloId, ciclo.nombre,
    yaPublicados.length > 0 ? { soloPaisIds: participantes.filter((p) => !yaPublicados.includes(p)) } : undefined)
  await prisma.$transaction([
    prisma.ciclo.update({ where: { id: cicloId }, data: { publicado: true } }),
    prisma.cicloPaisCierre.updateMany({ where: { cicloId }, data: { publicado: true } }),
    prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'RESULTADOS_PUBLICADOS', entidad: cicloId, detalle: { correosEnviados: correos.enviados } } }),
  ])
  revalidatePath('/admin/ciclos')
  return { ok: true as const }
}

// ───────────── Configuración ─────────────

export type ClavePesos = 'pesosModalidades' | 'pesosModalidadesSinReportes'

const MODALIDADES_PESO = ['JEFE', 'PAR', 'ASCENDENTE', 'AUTO'] as const

export async function guardarConfiguracion(pesos: Record<string, number>, clave: ClavePesos = 'pesosModalidades') {
  const sesion = await requiereAdmin('CONFIGURACION', 'GESTIONAR')
  /* Cada peso 0-100 y solo las 4 modalidades conocidas. Validar solo la suma dejaba pasar
     {JEFE:200, AUTO:-100} (suma 100): la nota de competencias se iba a rango -3..9 y descuadraba
     el 9-Box de los ~800 de golpe. `calculo.ts` ya filtra `peso>0` en el desglose por dimensión,
     así que nota y desglose dejarían de cuadrar. */
  const claves = Object.keys(pesos)
  if (claves.some((k) => !(MODALIDADES_PESO as readonly string[]).includes(k))) {
    return { ok: false as const, error: 'Modalidad de peso desconocida' }
  }
  if (Object.values(pesos).some((v) => !Number.isInteger(v) || v < 0 || v > 100)) {
    return { ok: false as const, error: 'Cada peso debe ser un entero entre 0 y 100' }
  }
  const totalMod = Object.values(pesos).reduce((a, b) => a + b, 0)
  if (totalMod !== 100) return { ok: false as const, error: `Los pesos de modalidades deben sumar 100% (suman ${totalMod}%)` }
  await prisma.$transaction([
    prisma.config.upsert({ where: { clave }, create: { clave, valor: pesos }, update: { valor: pesos } }),
    prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'CONFIG_ACTUALIZADA', detalle: { [clave]: pesos } } }),
  ])
  revalidatePath('/admin/configuracion')
  return { ok: true as const }
}

// ───────────── Niveles jerárquicos ─────────────

const esquemaNivel = z.object({
  nombre: z.string().trim().min(2, 'Escribe el nombre del nivel').max(100),
  compPct: z.coerce.number().int().min(0).max(100),
})

export async function crearNivel(formData: FormData) {
  const sesion = await requiereAdmin('CONFIGURACION', 'GESTIONAR')
  const datos = esquemaNivel.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  try {
    const ultimo = await prisma.nivelJerarquico.aggregate({ _max: { orden: true } })
    await prisma.nivelJerarquico.create({ data: { ...datos.data, orden: (ultimo._max.orden ?? -1) + 1 } })
  } catch (e) {
    if (esDuplicado(e)) return { ok: false as const, error: 'Ya existe un nivel con ese nombre' }
    throw e
  }
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'NIVEL_CREADO', detalle: { nombre: datos.data.nombre } } })
  revalidatePath('/admin/configuracion')
  revalidatePath('/admin/puestos')
  return { ok: true as const }
}

export async function editarNivel(nivelId: string, formData: FormData) {
  const sesion = await requiereAdmin('CONFIGURACION', 'GESTIONAR')
  const datos = esquemaNivel.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  try {
    await prisma.nivelJerarquico.update({ where: { id: nivelId }, data: datos.data })
  } catch (e) {
    if (esDuplicado(e)) return { ok: false as const, error: 'Ya existe un nivel con ese nombre' }
    throw e
  }
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'NIVEL_ACTUALIZADO', detalle: { nombre: datos.data.nombre, compPct: datos.data.compPct } } })
  revalidatePath('/admin/configuracion')
  revalidatePath('/admin/puestos')
  return { ok: true as const }
}

export async function eliminarNivel(nivelId: string) {
  const sesion = await requiereAdmin('CONFIGURACION', 'GESTIONAR')
  const [puestos, evaluaciones] = await Promise.all([
    prisma.puesto.count({ where: { nivelId } }),
    prisma.evaluacion.count({ where: { nivelId } }),
  ])
  if (puestos > 0 || evaluaciones > 0) {
    return { ok: false as const, error: `En uso por ${puestos} puestos y ${evaluaciones} evaluaciones: reasígnalos primero` }
  }
  const nivel = await prisma.nivelJerarquico.delete({ where: { id: nivelId } })
  await prisma.auditLog.create({ data: { usuarioId: sesion.id, accion: 'NIVEL_ELIMINADO', detalle: { nombre: nivel.nombre } } })
  revalidatePath('/admin/configuracion')
  revalidatePath('/admin/puestos')
  return { ok: true as const }
}

// ───────────── Alta individual de colaborador ─────────────

const esquemaColaborador = z.object({
  codigo: z.string().trim().max(40).optional(),
  nombres: z.string().trim().min(2, 'Escribe los nombres').max(120),
  apellidos: z.string().trim().min(2, 'Escribe los apellidos').max(120),
  documento: z.string().trim().min(3, 'Escribe el documento').max(40),
  email: z.string().trim().toLowerCase().email('Correo inválido').optional().or(z.literal('')),
  telefono: z.string().trim().max(40).optional(),
  nivelLiderazgo: z.enum(['', 'ESTRATEGICO', 'TACTICO', 'OPERATIVO']).optional(),
  paisId: z.string().min(1, 'Selecciona el país'),
  areaId: z.string().optional(),
  puestoId: z.string().optional(),
  jefeId: z.string().optional(),
})

/** El jefe asignado debe existir y estar dentro del país del RR.HH. (evita jerarquías cruzadas). */
async function validarJefeEnAlcance(sesion: Awaited<ReturnType<typeof requiereRrhh>>, jefeId?: string): Promise<string | null> {
  if (!jefeId) return null
  const jefe = await prisma.colaborador.findUnique({ where: { id: jefeId }, select: { paisId: true } })
  if (!jefe) return 'El jefe seleccionado no existe'
  if (fueraDeAlcancePais(sesion, jefe.paisId)) return 'El jefe seleccionado está fuera de tu país'
  return null
}

/** Anti-ciclo jerárquico: nadie puede tener como jefe a alguien de su propia cadena de reportes
 * (A es jefe de B y B jefe de A — o cadenas más largas A→B→C→A). Sube por la cadena de jefes del
 * candidato; si aparece el colaborador, hay ciclo. Cota de profundidad por si los datos ya
 * tuvieran un ciclo preexistente (evita el bucle infinito). */
async function validarCicloJerarquico(colaboradorId: string, jefeId?: string): Promise<string | null> {
  if (!jefeId) return null
  let actual: string | null = jefeId
  for (let paso = 0; actual && paso < 50; paso++) {
    if (actual === colaboradorId) {
      if (paso === 0) return 'Un colaborador no puede ser su propio jefe'
      if (paso === 1) return 'La persona elegida reporta directamente a este colaborador: no puede ser a la vez su jefe. Cambia primero el jefe de esa persona.'
      return 'Ese jefe crea un ciclo en la jerarquía: la persona elegida ya reporta (indirectamente) a este colaborador.'
    }
    const fila: { jefeId: string | null } | null = await prisma.colaborador.findUnique({ where: { id: actual }, select: { jefeId: true } })
    actual = fila?.jefeId ?? null
  }
  return null
}

/** Siguiente código del padrón para un país: prefijo (PER, ECU, COL, CHI…) + consecutivo.
 * El prefijo son las 3 primeras letras del nombre del país, como en el padrón oficial. */
async function siguienteCodigoPadron(paisId: string): Promise<string> {
  const pais = await prisma.pais.findUniqueOrThrow({ where: { id: paisId } })
  const prefijo = pais.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').slice(0, 3).toUpperCase()
  const existentes = await prisma.colaborador.findMany({
    where: { codigo: { startsWith: `${prefijo}-` } },
    select: { codigo: true },
  })
  const max = existentes.reduce((m, c) => {
    const n = parseInt(c.codigo!.slice(prefijo.length + 1), 10)
    return isNaN(n) ? m : Math.max(m, n)
  }, 0)
  return `${prefijo}-${String(max + 1).padStart(3, '0')}`
}

export async function crearColaborador(formData: FormData) {
  const sesion = await requiereAdmin('COLABORADORES', 'GESTIONAR')
  const datos = esquemaColaborador.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }
  if (sesion.alcanceRrhh === 'PAIS' && datos.data.paisId !== sesion.alcancePaisId) {
    return { ok: false as const, error: 'Solo puedes crear colaboradores de tu país' }
  }
  const jefeError = await validarJefeEnAlcance(sesion, datos.data.jefeId)
  if (jefeError) return { ok: false as const, error: jefeError }
  // El código del padrón se genera solo (PER-365, ECU-375…): único y consecutivo por país
  const codigo = datos.data.codigo || (await siguienteCodigoPadron(datos.data.paisId))
  try {
    const colaborador = await prisma.colaborador.create({
      data: {
        codigo,
        telefono: datos.data.telefono || null,
        nivelLiderazgo: datos.data.nivelLiderazgo || null,
        nombres: datos.data.nombres,
        apellidos: datos.data.apellidos,
        documento: datos.data.documento,
        email: datos.data.email || null,
        paisId: datos.data.paisId,
        areaId: datos.data.areaId || null,
        puestoId: datos.data.puestoId || null,
        jefeId: datos.data.jefeId || null,
      },
    })
    await prisma.auditLog.create({
      data: { usuarioId: sesion.id, accion: 'COLABORADOR_CREADO', detalle: { nombre: `${colaborador.nombres} ${colaborador.apellidos}`, documento: colaborador.documento } },
    })
  } catch (e) {
    if (esDuplicado(e)) return { ok: false as const, error: 'Ya existe un colaborador con ese documento, correo o código' }
    throw e
  }
  revalidatePath('/admin/colaboradores')
  revalidatePath('/admin/configuracion')
  return { ok: true as const }
}

export async function editarColaborador(colaboradorId: string, formData: FormData) {
  const sesion = await requiereAdmin('COLABORADORES', 'GESTIONAR')
  const datos = esquemaColaborador.safeParse(Object.fromEntries(formData))
  if (!datos.success) return { ok: false as const, error: datos.error.issues[0].message }

  const actual = await prisma.colaborador.findUnique({ where: { id: colaboradorId }, include: { usuario: true } })
  if (!actual) return { ok: false as const, error: 'Colaborador no encontrado' }
  if (sesion.alcanceRrhh === 'PAIS' && (actual.paisId !== sesion.alcancePaisId || datos.data.paisId !== sesion.alcancePaisId)) {
    return { ok: false as const, error: 'Solo puedes editar colaboradores de tu país' }
  }
  const cicloJerarquico = await validarCicloJerarquico(colaboradorId, datos.data.jefeId)
  if (cicloJerarquico) return { ok: false as const, error: cicloJerarquico }
  const jefeError = await validarJefeEnAlcance(sesion, datos.data.jefeId)
  if (jefeError) return { ok: false as const, error: jefeError }

  // CANDADO de rotación: ni el PUESTO (cuestionario y pesos del cálculo se derivan de él)
  // ni el PAÍS (define qué cierre por país congela su resultado y su alcance RR.HH.) se
  // cambian mientras participa en un ciclo ACTIVO. El cambio rige al cierre (o RR.HH. lo
  // retira antes desde Rotación).
  const cambiaPuesto = (datos.data.puestoId || null) !== actual.puestoId
  const cambiaPais = datos.data.paisId !== actual.paisId
  if (cambiaPuesto || cambiaPais) {
    const enCiclo = await prisma.asignacion.findFirst({
      where: { evaluadoId: colaboradorId, ciclo: { estado: 'ACTIVO' } },
      select: { ciclo: { select: { nombre: true } } },
    })
    if (enCiclo) {
      return {
        ok: false as const,
        error: cambiaPuesto
          ? `No puedes cambiar su puesto mientras participa en el ciclo activo «${enCiclo.ciclo.nombre}»: el cuestionario y los pesos del ciclo dependen del puesto. Aplica el cambio al cierre, o retíralo del ciclo desde el bloque Rotación del ciclo.`
          : `No puedes cambiar su país mientras participa en el ciclo activo «${enCiclo.ciclo.nombre}»: el país define qué cierre congela su resultado. Aplica el cambio al cierre, o retíralo del ciclo desde el bloque Rotación del ciclo.`,
      }
    }
  }

  const email = datos.data.email || null
  // Cambiar el correo de ACCESO exige administrar cuentas (mismo criterio que resetear su
  // contraseña); sin ese permiso solo se actualiza el correo del colaborador
  const puedeGestionarCuentas = sesion.rol === 'RRHH' || tieneAdmin(sesion.permisosAdmin, 'USUARIOS_ROLES', 'GESTIONAR')
  let avisoCuenta: string | null = null

  try {
    await prisma.$transaction(async (tx) => {
      await tx.colaborador.update({
        where: { id: colaboradorId },
        data: {
          codigo: datos.data.codigo || null,
          telefono: datos.data.telefono || null,
          nivelLiderazgo: datos.data.nivelLiderazgo || null,
          nombres: datos.data.nombres,
          apellidos: datos.data.apellidos,
          documento: datos.data.documento,
          email,
          paisId: datos.data.paisId,
          areaId: datos.data.areaId || null,
          puestoId: datos.data.puestoId || null,
          jefeId: datos.data.jefeId || null,
        },
      })
      /* El correo de ACCESO (login + 2FA) solo lo mueve quien administra cuentas.
         Cambiarlo es tomar la cuenta: con el correo nuevo se pide «¿Recuperar contraseña?», llega
         el enlace y el código 2FA al buzón del que lo cambió. Como esta acción solo exige
         COLABORADORES:GESTIONAR, sincronizar aquí rodeaba el candado anti-escalada que declara
         USUARIOS_ROLES como solo-lectura para los roles configurables. Al sincronizar se cierran
         las sesiones vivas y se anula todo lo que sirva para entrar con el correo anterior. */
      if (actual.usuario && email && actual.usuario.email !== email) {
        if (!puedeGestionarCuentas) {
          avisoCuenta = 'El correo del colaborador se actualizó, pero el correo de acceso a la plataforma lo cambia RR.HH. desde Configuración › Usuarios.'
        } else {
          await tx.usuario.update({
            where: { id: actual.usuario.id },
            data: { email, passwordChangedAt: new Date() },
          })
          await tx.tokenRestablecimiento.updateMany({ where: { usuarioId: actual.usuario.id, usado: false }, data: { usado: true } })
          await tx.codigo2FA.updateMany({ where: { usuarioId: actual.usuario.id, usado: false }, data: { usado: true } })
          await tx.auditLog.create({
            data: {
              usuarioId: sesion.id,
              accion: 'USUARIO_EMAIL_CAMBIADO',
              entidad: actual.usuario.id,
              detalle: { antes: actual.usuario.email, despues: email, colaboradorId },
            },
          })
        }
      }
    })
    await prisma.auditLog.create({
      data: { usuarioId: sesion.id, accion: 'COLABORADOR_EDITADO', entidad: colaboradorId, detalle: { documento: datos.data.documento, emailCuentaSincronizado: !!(actual.usuario && email && actual.usuario.email !== email) } },
    })
  } catch (e) {
    if (esDuplicado(e)) return { ok: false as const, error: 'Documento, correo o código ya usados por otro colaborador o cuenta' }
    throw e
  }
  revalidatePath('/admin/colaboradores')
  revalidatePath(`/admin/colaboradores/${colaboradorId}`)
  revalidatePath('/admin/configuracion')
  // `aviso` cuando el correo de acceso NO se movió: sin decirlo, quien edita cree que cambió el
  // correo de login y la persona seguiría entrando con el anterior
  return { ok: true as const, aviso: avisoCuenta }
}

/** Exporta los RESULTADOS de un ciclo a filas de CSV/Excel, solo de países ya CERRADOS
 * (resultados congelados) y dentro del alcance del RR.HH.: el de país exporta el suyo
 * cuando su país cerró; el Regional, todos los países cerrados (el ciclo cerrado = todos).
 * Incluye la nota vigente (calibrada si existe), desglose por dimensión, potencial y 9-Box. */
export async function exportarResultadosCiclo(cicloId: string) {
  const sesion = await requiereAdmin('RESULTADOS', 'VER')
  const ciclo = await prisma.ciclo.findUnique({ where: { id: cicloId }, include: { cierresPais: true } })
  if (!ciclo) return { ok: false as const, error: 'Ciclo no encontrado' }

  // Países exportables: cerrados (con el ciclo CERRADO, todos), recortados al alcance de la sesión
  const scope = alcancePaisWhere(sesion)
  let paisesCerrados: string[] | null // null = sin restricción de país (ciclo cerrado, sesión regional)
  if (ciclo.estado === 'CERRADO') {
    paisesCerrados = scope.paisId ? [scope.paisId] : null
  } else {
    const cerrados = ciclo.cierresPais.map((c) => c.paisId)
    const delAlcance = scope.paisId ? cerrados.filter((p) => p === scope.paisId) : cerrados
    if (delAlcance.length === 0) {
      return { ok: false as const, error: 'Los resultados se exportan cuando el ciclo está cerrado (o cuando tu país ya cerró en este ciclo)' }
    }
    paisesCerrados = delAlcance
  }

  const [resultados, dimensiones, feedbacks] = await Promise.all([
    prisma.resultado.findMany({
      where: {
        cicloId,
        OR: [{ notaFinal: { not: null } }, { notaCalibrada: { not: null } }],
        colaborador: { is: { ...(paisesCerrados ? { paisId: { in: paisesCerrados } } : {}) } },
      },
      include: {
        colaborador: {
          include: {
            pais: true, area: true,
            puesto: { include: { nivel: true } },
            jefe: { select: { nombres: true, apellidos: true } },
          },
        },
      },
      orderBy: { notaFinal: 'desc' },
    }),
    prisma.dimension.findMany({ orderBy: { orden: 'asc' } }),
    prisma.feedback.findMany({ where: { cicloId }, select: { colaboradorId: true, realizadaEn: true } }),
  ])
  const feedbackDe = new Map(feedbacks.map((f) => [f.colaboradorId, f.realizadaEn]))

  const num = (v: number | null | undefined, dec = 2) => (v === null || v === undefined ? '' : v.toFixed(dec))
  const filas: string[][] = [[
    'colaborador', 'codigo', 'documento', 'pais', 'area', 'puesto', 'nivel', 'jefe_directo',
    'nota_competencias', 'cumplimiento_objetivos_pct', 'nota_final', 'nota_calibrada', 'nota_vigente',
    'potencial', 'box_9', ...dimensiones.map((d) => `dim_${d.nombre}`), 'calibrado', 'feedback_registrado',
  ]]
  for (const r of resultados) {
    const c = r.colaborador
    const desglose = (r.desgloseDimJson as { dimensionId: string; nota: number; ajuste: number | null }[] | null) ?? []
    const notaDim = (dimensionId: string) => {
      const d = desglose.find((x) => x.dimensionId === dimensionId)
      return d ? num(d.ajuste ?? d.nota) : ''
    }
    const feedback = feedbackDe.get(r.colaboradorId)
    filas.push([
      `${c.nombres} ${c.apellidos}`, c.codigo ?? '', c.documento, c.pais.nombre,
      c.area?.nombre ?? '', c.puesto?.nombre ?? '', c.puesto?.nivel.nombre ?? '',
      c.jefe ? `${c.jefe.nombres} ${c.jefe.apellidos}` : '',
      num(r.notaCompetencias), num(r.cumplimientoObjetivos, 0), num(r.notaFinal), num(r.notaCalibrada),
      num(r.notaCalibrada ?? r.notaFinal),
      num(r.potencial), r.box ?? '',
      ...dimensiones.map((d) => notaDim(d.id)),
      r.notaCalibrada !== null || (r.ajustesDimJson && Object.keys(r.ajustesDimJson as object).length > 0) ? 'Sí' : 'No',
      feedback ? feedback.toLocaleDateString('es-PE') : 'No',
    ])
  }

  await prisma.auditLog.create({
    data: { usuarioId: sesion.id, accion: 'CICLO_RESULTADOS_EXPORTADO', entidad: cicloId, detalle: { ciclo: ciclo.nombre, filas: filas.length - 1 } },
  })
  return { ok: true as const, filas, ciclo: ciclo.nombre }
}

/** Buscador server-side de candidatos a par para RR.HH. (reemplaza el volcado de `poolPares`, que
 *  viajaba al cliente una vez POR ÁREA). ≤20 por término y con el MISMO universo que asignarPar
 *  acepta: sin acotar por país —el par real de un alto mando suele estar en otro país, y el
 *  alcance del RR.HH. ya se valida sobre el EVALUADO al asignar— y sin candidatos que asignarPar
 *  rechazaría después por antigüedad (<6 meses al inicio del ciclo). */
export async function buscarCandidatosParRrhh(cicloId: string, termino: string) {
  await requiereAdmin('CICLOS', 'GESTIONAR')
  const q = termino.trim()
  if (q.length < 2) return []
  const ciclo = await prisma.ciclo.findUnique({ where: { id: cicloId }, select: { estado: true, fechaInicio: true } })
  if (!ciclo || ciclo.estado !== 'ACTIVO') return []
  const filas = await prisma.colaborador.findMany({
    where: {
      activo: true,
      OR: [
        { nombres: { contains: q, mode: 'insensitive' } },
        { apellidos: { contains: q, mode: 'insensitive' } },
        { puesto: { is: { nombre: { contains: q, mode: 'insensitive' } } } },
      ],
    },
    select: { id: true, nombres: true, apellidos: true, jefeId: true, fechaIngreso: true, pais: { select: { codigo: true } } },
    orderBy: [{ apellidos: 'asc' }],
    take: 20,
  })
  return filas
    .filter((c) => !excluidoPorAntiguedad(c.fechaIngreso, ciclo.fechaInicio))
    .map((c) => ({ id: c.id, nombre: `${c.nombres} ${c.apellidos}`, jefeId: c.jefeId, pais: c.pais.codigo }))
}
