/**
 * MOTOR del importador de padrón. Vive en un archivo SIN `'use server'` a propósito: en un archivo
 * de server actions, CADA export es un endpoint invocable, y este motor escribe el padrón completo
 * —incluido `jefeId`, que reparte accesos— y firma el AuditLog con el `sesionId` que le pasan.
 * Expuesto como endpoint, cualquiera podía ponerse jefe de cualquier persona y atribuir el cambio
 * a otro. Sus dos únicas puertas de entrada legítimas son `importarPadron` (COLABORADORES) e
 * `importarMaestro` (CONFIGURACION), cada una con su propio guard y ambas exigiendo RR.HH.
 * Regional. Mismo motivo por el que `importador-xlsx.ts` también vive fuera de esa frontera.
 */
import { revalidatePath } from 'next/cache'
import { prisma } from '@/shared/lib/prisma'
import { normalizar } from './maestro/parser'
import type { NivelLiderazgo } from '@/generated/prisma/enums'

// Pesos por dimensión según nivel jerárquico (resumen oficial del padrón Hunter 2026).
// Orden = orden del catálogo de dimensiones: Analítica, Know-How, Operativa, Liderazgo, Digital.
const PESOS_POR_NIVEL: Record<string, number[]> = {
  'Gerencial': [20, 15, 15, 30, 20],
  'Mando Medio': [20, 20, 25, 20, 15],
  'Especialista': [30, 25, 20, 10, 15],
  'Apoyo': [15, 35, 30, 10, 10],
}


const LIDERAZGOS = new Set(['ESTRATEGICO', 'TACTICO', 'OPERATIVO'])

export type ResumenImportacion = {
  filas: number
  nuevos: number
  actualizados: number
  areasNuevas: number
  puestosNuevos: number
  errores: string[] // bloqueantes: no se puede aplicar
  avisos: string[] // conscientes: se aplica igual
  aplicado: boolean
}

export type FilaPadron = {
  linea: number
  codigo: string
  documento: string
  nombres: string
  apellidos: string
  email: string
  telefono: string
  pais: string
  area: string
  cargo: string
  nivel: string
  codigoJefe: string
  liderazgo: string
  fechaIngreso: string
}

function acotar(lista: string[], max = 40): string[] {
  return lista.length <= max ? lista : [...lista.slice(0, max), `… y ${lista.length - max} más`]
}

export async function procesarPadron(
  filas: FilaPadron[],
  opciones: { sesionId: string; aplicar: boolean; origen: 'CSV' | 'MAESTRO'; archivoNombre?: string },
): Promise<{ resumen: ResumenImportacion }> {
  const { sesionId, aplicar, origen, archivoNombre } = opciones

  // ── Catálogos existentes ──
  const [paises, niveles, areas, puestos, dimensiones, existentes] = await Promise.all([
    prisma.pais.findMany(),
    prisma.nivelJerarquico.findMany(),
    prisma.area.findMany(),
    prisma.puesto.findMany({ select: { id: true, nombre: true, nivelId: true } }),
    prisma.dimension.findMany({ orderBy: { orden: 'asc' } }),
    prisma.colaborador.findMany({ select: { id: true, codigo: true, documento: true, email: true } }),
  ])
  // Criterio de indexación por nombre unificado con el planificador (`plan.ts` en el camino
  // MAESTRO): `normalizar` (NFD + strip diacríticos + minúsculas + espacios colapsados), NO
  // `.toLowerCase()`. Antes, un puesto/área/nivel/país que llegaba SIN tilde por el archivo pero
  // ya existía CON tilde en BD (o viceversa) no matcheaba aquí aunque el plan lo mostrara como
  // "existente" — se creaba un duplicado sin competencias. Esto es una corrección estricta que
  // afecta también al camino CSV: antes, dos filas del mismo CSV con tildes distintas para el
  // mismo cargo/área ya se fusionaban igual en un solo registro por casualidad de mayúsculas
  // (`.toLowerCase()` no toca tildes), así que el comportamiento visible para ESE caso no cambia.
  const paisPorNombre = new Map(paises.map((p) => [normalizar(p.nombre), p]))
  const nivelPorNombre = new Map(niveles.map((n) => [normalizar(n.nombre), n]))
  const areaPorNombre = new Map(areas.map((a) => [normalizar(a.nombre), a]))
  const puestoPorNombre = new Map(puestos.map((p) => [normalizar(p.nombre), p]))
  const porCodigo = new Map(existentes.filter((c) => c.codigo).map((c) => [c.codigo!, c]))
  const porDocumento = new Map(existentes.map((c) => [c.documento, c]))
  // Deuda de la revisión T3: el email de BD no se normalizaba a minúsculas, así que un colaborador
  // con email en mayúsculas en BD producía un falso negativo del cruce "el correo ya pertenece a
  // X" (la fila del archivo, que sí llega en minúsculas, nunca matcheaba). Alineado con el mismo
  // criterio que ya usa `revincularCuentas` (`acciones.ts`).
  const porEmail = new Map(existentes.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c]))

  // ── Validación ──
  const errores: string[] = []
  const avisos: string[] = []
  const codigosArchivo = new Map<string, number>()
  const documentosArchivo = new Map<string, number>()
  const emailsArchivo = new Map<string, number>()

  for (const f of filas) {
    const donde = `Fila ${f.linea} (${f.codigo || 'sin código'})`
    if (!f.codigo) errores.push(`${donde}: falta el código`)
    else if (codigosArchivo.has(f.codigo)) errores.push(`${donde}: código repetido en el archivo (también en fila ${codigosArchivo.get(f.codigo)})`)
    else codigosArchivo.set(f.codigo, f.linea)

    if (!f.documento) errores.push(`${donde}: falta el documento`)
    else if (documentosArchivo.has(f.documento)) errores.push(`${donde}: documento repetido en el archivo (también en fila ${documentosArchivo.get(f.documento)})`)
    else documentosArchivo.set(f.documento, f.linea)

    if (!f.nombres || !f.apellidos) errores.push(`${donde}: faltan nombres o apellidos`)
    if (!paisPorNombre.has(normalizar(f.pais))) errores.push(`${donde}: país desconocido "${f.pais}"`)
    if (!nivelPorNombre.has(normalizar(f.nivel))) errores.push(`${donde}: nivel jerárquico desconocido "${f.nivel}"`)
    if (f.liderazgo && !LIDERAZGOS.has(f.liderazgo)) errores.push(`${donde}: nivel de liderazgo inválido "${f.liderazgo}"`)

    if (f.email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) errores.push(`${donde}: correo inválido "${f.email}"`)
      else if (emailsArchivo.has(f.email)) errores.push(`${donde}: correo repetido en el archivo (también en fila ${emailsArchivo.get(f.email)})`)
      else emailsArchivo.set(f.email, f.linea)
    } else avisos.push(`${donde}: sin correo — no podrá tener cuenta de acceso`)

    if (f.fechaIngreso && isNaN(Date.parse(f.fechaIngreso))) avisos.push(`${donde}: fecha de ingreso inválida "${f.fechaIngreso}" — se ignorará`)

    // Cruces contra BD: mismo documento o correo en un colaborador con OTRO código
    const porDoc = porDocumento.get(f.documento)
    if (porDoc && porDoc.codigo && porDoc.codigo !== f.codigo) errores.push(`${donde}: el documento ya pertenece a ${porDoc.codigo}`)
    const porMail = f.email ? porEmail.get(f.email) : undefined
    if (porMail && porMail.codigo && porMail.codigo !== f.codigo) errores.push(`${donde}: el correo ya pertenece a ${porMail.codigo}`)
  }

  // Jefes: deben existir en el archivo o en la BD
  const jefesSinResolver = filas.filter((f) => f.codigoJefe && !codigosArchivo.has(f.codigoJefe) && !porCodigo.has(f.codigoJefe))
  for (const f of jefesSinResolver) errores.push(`Fila ${f.linea} (${f.codigo}): el jefe ${f.codigoJefe} no existe en el archivo ni en la plataforma`)
  const sinJefe = filas.filter((f) => !f.codigoJefe)
  if (sinJefe.length > 0) avisos.push(`${sinJefe.length} colaborador(es) sin jefe directo: ${sinJefe.map((f) => f.codigo).slice(0, 10).join(', ')}`)

  // Líderes (aparecen como jefe de alguien) sin nivel de liderazgo
  const codigosJefes = new Set(filas.map((f) => f.codigoJefe).filter(Boolean))
  const lideresSinNivel = filas.filter((f) => codigosJefes.has(f.codigo) && !f.liderazgo)
  if (lideresSinNivel.length > 0) avisos.push(`${lideresSinNivel.length} líder(es) sin nivel de liderazgo: ${lideresSinNivel.map((f) => f.codigo).slice(0, 10).join(', ')}`)

  // Mismo cargo con niveles distintos: el puesto se crea con el nivel de la primera aparición
  const nivelPorCargo = new Map<string, string>()
  const avisosNivelBD = new Set<string>()
  for (const f of filas) {
    const clave = normalizar(f.cargo)
    if (!clave) continue
    if (!nivelPorCargo.has(clave)) nivelPorCargo.set(clave, f.nivel)
    else if (nivelPorCargo.get(clave) !== f.nivel) avisos.push(`Cargo "${f.cargo}" aparece con niveles distintos (${nivelPorCargo.get(clave)} y ${f.nivel}): el puesto usará ${nivelPorCargo.get(clave)}`)
    // El puesto ya existe con OTRO nivel: el importador no lo cambia (podría alterar evaluaciones en curso)
    const existente = puestoPorNombre.get(clave)
    const nivelArchivo = nivelPorNombre.get(normalizar(f.nivel))
    // El aviso de "se conserva el nivel actual" solo aplica al camino CSV: en MAESTRO la hoja 4
    // (Puestos y niveles) manda y la re-homologación ya se aplicó (o se aplicará) en
    // `aplicarEstructura` antes de llegar aquí — el aviso sería falso y contradictorio con lo
    // que ya reporta la sección Puestos del mismo plan.
    if (existente && nivelArchivo && existente.nivelId !== nivelArchivo.id && !avisosNivelBD.has(clave) && origen === 'CSV') {
      avisosNivelBD.add(clave)
      const nivelActual = niveles.find((n) => n.id === existente.nivelId)?.nombre ?? '?'
      avisos.push(`Puesto "${f.cargo}" ya existe con nivel ${nivelActual} y el archivo dice ${f.nivel}: se conserva ${nivelActual} — si el cambio es real, ajústalo en Puestos y niveles`)
    }
  }

  // ── Plan ──
  const areasNuevas = [...new Set(filas.map((f) => f.area).filter((a) => a && !areaPorNombre.has(normalizar(a))))]
  const cargosNuevos = [...nivelPorCargo.keys()].filter((c) => !puestoPorNombre.has(c))
  const nuevos = filas.filter((f) => f.codigo && !porCodigo.has(f.codigo))
  const actualizados = filas.filter((f) => f.codigo && porCodigo.has(f.codigo))

  // El aviso de "caparazón sin competencias" solo aplica al camino CSV: en MAESTRO los
  // puestos nuevos ya se crearon (con competencias de la hoja 5) antes de llegar aquí, así
  // que para ese origen el aviso sería falso.
  if (cargosNuevos.length > 0 && origen === 'CSV') {
    avisos.push(`Los ${cargosNuevos.length} puestos nuevos se crean como caparazón: con los pesos por dimensión de su nivel (oficiales del padrón) pero SIN competencias asociadas — RR.HH. debe configurarlas antes de lanzar un ciclo (el pre-flight bloqueará cuestionarios vacíos)`)
  }

  const resumen: ResumenImportacion = {
    filas: filas.length,
    nuevos: nuevos.length,
    actualizados: actualizados.length,
    areasNuevas: areasNuevas.length,
    puestosNuevos: cargosNuevos.length,
    errores: acotar(errores),
    avisos: acotar(avisos),
    aplicado: false,
  }

  if (!aplicar || errores.length > 0) return { resumen }

  // ── Aplicación por fases (idempotente: un fallo parcial se corrige re-aplicando) ──
  // 1. Áreas
  for (const nombre of areasNuevas) {
    const area = await prisma.area.create({ data: { nombre } })
    areaPorNombre.set(normalizar(nombre), area)
  }

  // 2. Puestos nuevos: nivel + pesos por dimensión del nivel + todas las competencias activas
  const cargoOriginal = new Map(filas.map((f) => [normalizar(f.cargo), f.cargo]))
  for (const clave of cargosNuevos) {
    const nivel = nivelPorNombre.get(normalizar(nivelPorCargo.get(clave)!))!
    const pesos = PESOS_POR_NIVEL[nivel.nombre] ?? [20, 20, 20, 20, 20]
    const puesto = await prisma.puesto.create({
      data: {
        nombre: cargoOriginal.get(clave)!,
        nivelId: nivel.id,
        pesos: { create: dimensiones.map((d, i) => ({ dimensionId: d.id, peso: pesos[i] ?? 0 })) },
        // Sin competencias: las asocia RR.HH. de Hunter (el importador solo crea el caparazón)
      },
    })
    puestoPorNombre.set(clave, { id: puesto.id, nombre: puesto.nombre, nivelId: puesto.nivelId })
  }

  // 3. Colaboradores (upsert por código; el jefe se conecta en la fase 4)
  // Candado de rotación: a quien participa en un ciclo ACTIVO no se le cambia el puesto por
  // import (el cuestionario y los pesos del cálculo se derivan del puesto). El resto de sus
  // datos sí se actualiza; el cambio de puesto se aplica re-importando tras el cierre.
  const titularesPrevios = await prisma.colaborador.findMany({
    where: { codigo: { in: filas.map((f) => f.codigo) } },
    select: { codigo: true, puestoId: true, _count: { select: { evaluacionesRecibidas: { where: { ciclo: { estado: 'ACTIVO' } } } } } },
  })
  const enCicloActivo = new Map(titularesPrevios.map((c) => [c.codigo!, { puestoId: c.puestoId, bloqueado: c._count.evaluacionesRecibidas > 0 }]))
  let puestosProtegidos = 0
  for (const f of filas) {
    const datos = {
      nombres: f.nombres,
      apellidos: f.apellidos,
      documento: f.documento,
      email: f.email || null,
      telefono: f.telefono || null,
      nivelLiderazgo: (LIDERAZGOS.has(f.liderazgo) ? f.liderazgo : null) as NivelLiderazgo | null,
      fechaIngreso: f.fechaIngreso && !isNaN(Date.parse(f.fechaIngreso)) ? new Date(f.fechaIngreso) : null,
      paisId: paisPorNombre.get(normalizar(f.pais))!.id,
      areaId: f.area ? areaPorNombre.get(normalizar(f.area))!.id : null,
      puestoId: f.cargo ? puestoPorNombre.get(normalizar(f.cargo))!.id : null,
    }
    const previo = enCicloActivo.get(f.codigo)
    const protegerPuesto = !!previo && previo.bloqueado && datos.puestoId !== previo.puestoId
    if (protegerPuesto) puestosProtegidos += 1
    await prisma.colaborador.upsert({
      where: { codigo: f.codigo },
      create: { codigo: f.codigo, ...datos },
      update: protegerPuesto ? { ...datos, puestoId: previo.puestoId } : datos,
    })
  }
  if (puestosProtegidos > 0) {
    resumen.avisos.push(`${puestosProtegidos} cambio(s) de puesto NO aplicados: participan en un ciclo activo (el cuestionario y los pesos dependen del puesto). Re-importa tras el cierre.`)
  }

  // 3.5. Área del puesto: los puestos sin área heredan la MAYORITARIA entre sus titulares
  // del archivo (el padrón asocia área a la persona; el puesto la deriva de sus titulares)
  const areasPorPuesto = new Map<string, Map<string, number>>()
  for (const f of filas) {
    if (!f.cargo || !f.area) continue
    const puestoId = puestoPorNombre.get(normalizar(f.cargo))!.id
    const areaId = areaPorNombre.get(normalizar(f.area))!.id
    const conteo = areasPorPuesto.get(puestoId) ?? new Map<string, number>()
    conteo.set(areaId, (conteo.get(areaId) ?? 0) + 1)
    areasPorPuesto.set(puestoId, conteo)
  }
  for (const [puestoId, conteo] of areasPorPuesto) {
    const mayoritaria = [...conteo.entries()].sort((a, b) => b[1] - a[1])[0][0]
    await prisma.puesto.updateMany({ where: { id: puestoId, areaId: null }, data: { areaId: mayoritaria } })
  }

  // 4. Jefes (segunda pasada: ya existen todos). Un jefe DADO DE BAJA no se asigna:
  // el colaborador queda «sin jefe directo» (lo cubre RR.HH.) y se avisa en el resumen.
  const todos = await prisma.colaborador.findMany({ where: { codigo: { not: null } }, select: { id: true, codigo: true, activo: true } })
  const idPorCodigo = new Map(todos.filter((c) => c.activo).map((c) => [c.codigo!, c.id]))
  const codigosInactivos = new Set(todos.filter((c) => !c.activo).map((c) => c.codigo!))
  let jefesInactivosOmitidos = 0
  for (const f of filas) {
    if (f.codigoJefe && codigosInactivos.has(f.codigoJefe)) jefesInactivosOmitidos += 1
    const jefeId = f.codigoJefe ? (idPorCodigo.get(f.codigoJefe) ?? null) : null
    await prisma.colaborador.update({ where: { codigo: f.codigo }, data: { jefeId } })
  }
  if (jefesInactivosOmitidos > 0) {
    resumen.avisos.push(`${jefesInactivosOmitidos} fila(s) referencian a un jefe DADO DE BAJA: quedaron «sin jefe directo» (RR.HH. cubre aprobaciones y feedback hasta reasignar)`)
  }

  await prisma.auditLog.create({
    data: {
      usuarioId: sesionId,
      accion: origen === 'CSV' ? 'PADRON_IMPORTADO' : 'IMPORTACION_MAESTRA_PADRON',
      detalle: { filas: filas.length, nuevos: nuevos.length, actualizados: actualizados.length, areasNuevas: areasNuevas.length, puestosNuevos: cargosNuevos.length, archivo: archivoNombre },
    },
  })
  revalidatePath('/admin/colaboradores')
  revalidatePath('/admin/puestos')
  return { resumen: { ...resumen, aplicado: true } }
}
