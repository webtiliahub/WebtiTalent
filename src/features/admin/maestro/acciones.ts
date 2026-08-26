'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin } from '@/shared/lib/permisos'
import { parseMaestro, normalizar, type MaestroParseado } from './parser'
import { planificarMaestro, type PlanMaestro, type SnapshotBD } from './plan'
import { procesarPadron, type FilaPadron } from '../importador-motor'

/**
 * Server action de la carga maestra (Excel único: niveles, puestos, competencias, pesos
 * y padrón). Dos modos como el importador CSV: dry-run (arma el plan, no escribe)
 * y aplicación. A diferencia del CSV, esta SÍ puede reconfigurar la estructura del modelo
 * (niveles, puestos, competencias, pesos) antes de cargar el padrón — por eso exige RR.HH.
 * Regional y bloquea la aplicación (no la vista) si hay un ciclo ACTIVO.
 */

export type ResultadoMaestro =
  | { ok: true; plan: PlanMaestro; aplicado: boolean }
  | { ok: false; error: string }

/** Último valor por clave normalizada (mismo criterio de fusión que `planificarMaestro`,
 * sin el efecto secundario de avisar duplicados — eso ya lo hizo el planificador). */
function ultimoPorClave<T>(filas: T[], clave: (f: T) => string): Map<string, T> {
  const mapa = new Map<string, T>()
  for (const fila of filas) {
    const k = normalizar(clave(fila))
    if (k) mapa.set(k, fila)
  }
  return mapa
}

async function snapshotBD(): Promise<SnapshotBD> {
  const [niveles, dimensiones, competencias, paises, puestos, ciclosActivos] = await Promise.all([
    prisma.nivelJerarquico.findMany({ select: { id: true, nombre: true, compPct: true } }),
    prisma.dimension.findMany({ orderBy: { orden: 'asc' }, select: { id: true, nombre: true, orden: true } }),
    prisma.competencia.findMany({ select: { id: true, nombre: true } }),
    prisma.pais.findMany({ select: { nombre: true } }),
    prisma.puesto.findMany({
      select: {
        id: true,
        nombre: true,
        nivelId: true,
        pesos: { select: { dimensionId: true, peso: true } },
        competencias: { select: { competenciaId: true } },
      },
    }),
    prisma.ciclo.count({ where: { estado: 'ACTIVO' } }),
  ])
  return {
    niveles,
    dimensiones,
    competencias,
    paises,
    puestos: puestos.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      nivelId: p.nivelId,
      pesos: p.pesos,
      competenciaIds: p.competencias.map((c) => c.competenciaId),
    })),
    hayCicloActivo: ciclosActivos > 0,
  }
}

/**
 * Aplica la estructura del maestro (niveles, puestos, competencias, pesos) en una
 * transacción ordenada. Recibe `parseado` además de `plan` porque `PlanMaestro` es un resumen
 * pensado para pantalla (diffs y conteos) — para ESCRIBIR faltan datos que no expone: los pesos
 * por dimensión de cada nivel (hoja 3, usados por los puestos "derivados") y los ids de
 * competencia de los puestos EXISTENTES que cambiaron (hoja 5; para los puestos nuevos sí vienen
 * resueltos en `plan.competenciasPuestosNuevos`). Se recalculan aquí con el mismo criterio
 * `normalizar` que usa el planificador — ya validado: si algo no calzara, `plan.errores` habría
 * bloqueado la aplicación antes de llegar aquí.
 */
async function aplicarEstructura(parseado: MaestroParseado, plan: PlanMaestro, bd: SnapshotBD): Promise<void> {
  const nivelPorNombre = new Map(bd.niveles.map((n) => [normalizar(n.nombre), n]))
  const competenciaPorNombre = new Map(bd.competencias.map((c) => [normalizar(c.nombre), c]))
  const dimensionesOrdenadas = bd.dimensiones // ya vienen orderBy orden asc: posición ↔ D1..D5, igual que el parser
  const puestoPorNombre = new Map(bd.puestos.map((p) => [normalizar(p.nombre), p]))

  const pesosDimPorNivel = ultimoPorClave(parseado.niveles, (n) => n.nivel) // hoja 3
  const nivelHojaPorPuesto = ultimoPorClave(parseado.puestos, (p) => p.puesto) // hoja 4: TODO puesto del archivo
  const competenciasHojaPorPuesto = ultimoPorClave(parseado.competencias, (c) => c.puesto) // hoja 5 (nombres crudos)

  const pesosPersonalizadosPorPuesto = new Map(plan.pesosPersonalizados.map((p) => [normalizar(p.puesto), p]))
  const competenciasNuevoPorPuesto = new Map(plan.competenciasPuestosNuevos.map((c) => [normalizar(c.puesto), c.competencias]))

  await prisma.$transaction(async (tx) => {
    // 1. Niveles: % competencias/objetivos (hoja 3)
    for (const n of plan.niveles) {
      const nivelBD = nivelPorNombre.get(normalizar(n.nombre))
      if (!nivelBD) continue // validado por planificarMaestro; defensivo
      await tx.nivelJerarquico.update({ where: { id: nivelBD.id }, data: { compPct: n.compPctDespues } })
    }

    // 2. Puestos nuevos (nivel + competencias de hoja 5). Los pesos los resuelve el paso 4 para
    // no duplicar esa lógica — el puesto ya existe en la transacción para cuando ese paso corre.
    // Re-homologados: solo cambia el nivel (sus competencias/pesos van por sus propios caminos).
    for (const nuevo of plan.puestosNuevos) {
      const nivelBD = nivelPorNombre.get(normalizar(nuevo.nivel))
      if (!nivelBD) continue
      const competenciaIds = competenciasNuevoPorPuesto.get(normalizar(nuevo.nombre)) ?? []
      const creado = await tx.puesto.create({
        data: {
          nombre: nuevo.nombre,
          nivelId: nivelBD.id,
          competencias: { create: competenciaIds.map((competenciaId) => ({ competenciaId })) },
        },
      })
      puestoPorNombre.set(normalizar(nuevo.nombre), { id: creado.id, nombre: creado.nombre, nivelId: creado.nivelId, pesos: [], competenciaIds })
    }
    for (const rehomologado of plan.puestosRehomologados) {
      const puestoBD = puestoPorNombre.get(normalizar(rehomologado.nombre))
      const nivelBD = nivelPorNombre.get(normalizar(rehomologado.nivelDespues))
      if (!puestoBD || !nivelBD) continue
      await tx.puesto.update({ where: { id: puestoBD.id }, data: { nivelId: nivelBD.id } })
    }

    // 3. Competencias de puestos EXISTENTES cuyo set cambió (hoja 5): se reemplaza completo
    for (const cambio of plan.competenciasCambian) {
      const puestoBD = puestoPorNombre.get(normalizar(cambio.puesto))
      const filaHoja5 = competenciasHojaPorPuesto.get(normalizar(cambio.puesto))
      if (!puestoBD || !filaHoja5) continue
      const ids = filaHoja5.competencias
        .map((nombre) => competenciaPorNombre.get(normalizar(nombre))?.id)
        .filter((id): id is string => !!id)
      await tx.puestoCompetencia.deleteMany({ where: { puestoId: puestoBD.id } })
      if (ids.length > 0) {
        await tx.puestoCompetencia.createMany({ data: ids.map((competenciaId) => ({ puestoId: puestoBD.id, competenciaId })) })
      }
    }

    // 4. Pesos por dimensión de TODO puesto de la hoja 4 (nuevos, re-homologados y sin cambio de
    // nivel): personalizados (hoja 6) si están, si no los de su nivel (hoja 3). Conserva
    // `puntajeEsperado`: el update solo toca `peso`; el create usa el default del schema (3).
    // Solo se escribe lo que CAMBIA: la carga inicial son ~1.600 filas y contra Neon los
    // upserts fila a fila reventaban el timeout de la transacción — filas idénticas se saltan,
    // las nuevas van en un solo createMany y solo las divergentes se actualizan una a una.
    const pesosACrear: { puestoId: string; dimensionId: string; peso: number }[] = []
    for (const [clave, filaHoja4] of nivelHojaPorPuesto) {
      const puestoBD = puestoPorNombre.get(clave)
      if (!puestoBD) continue
      const personalizado = pesosPersonalizadosPorPuesto.get(clave)
      const pesos = personalizado ? personalizado.pesos : (pesosDimPorNivel.get(normalizar(filaHoja4.nivel))?.pesosDim ?? [])
      const actualesPorDimension = new Map(puestoBD.pesos.map((p) => [p.dimensionId, p.peso]))
      for (let i = 0; i < dimensionesOrdenadas.length; i++) {
        const dimensionId = dimensionesOrdenadas[i].id
        const peso = pesos[i] ?? 0
        const actual = actualesPorDimension.get(dimensionId)
        if (actual === peso) continue // sin cambio: cero escrituras
        if (actual === undefined) {
          pesosACrear.push({ puestoId: puestoBD.id, dimensionId, peso })
        } else {
          await tx.pesoDimensionPuesto.update({
            where: { puestoId_dimensionId: { puestoId: puestoBD.id, dimensionId } },
            data: { peso },
          })
        }
      }
    }
    if (pesosACrear.length > 0) await tx.pesoDimensionPuesto.createMany({ data: pesosACrear })
    // Timeout amplio: la carga inicial escribe cientos de filas contra Neon; el default de 5 s
    // de las transacciones interactivas de Prisma quedaba corto en producción (rollback total).
  }, { timeout: 120_000, maxWait: 15_000 })
}

/** Colaboradores ACTIVOS en BD cuyo código no viene en el archivo: informativo (nunca da de
 * baja — las bajas son individuales desde Colaboradores). Se calcula con una query barata por
 * `codigo` y se agrega a `plan.avisos` en TODOS los caminos (dry-run y aplicado), para proteger
 * recargas futuras del maestro. */
async function avisoColaboradoresNoIncluidos(plan: PlanMaestro): Promise<string[]> {
  const codigosArchivo = new Set(plan.padron.filas.map((f) => f.codigo))
  const activos = await prisma.colaborador.findMany({ where: { activo: true, codigo: { not: null } }, select: { codigo: true } })
  const faltantes = activos.map((c) => c.codigo!).filter((codigo) => !codigosArchivo.has(codigo))
  if (faltantes.length === 0) return []
  const muestra = faltantes.slice(0, 10).join(', ')
  return [`${faltantes.length} colaborador(es) activos en la plataforma no vienen en el archivo: no se dan de baja (las bajas son individuales desde Colaboradores) — ${muestra}${faltantes.length > 10 ? '…' : ''}`]
}

/**
 * Re-vincula `Usuario.colaboradorId` cuando el colaborador vinculado cambió de identidad (p. ej.
 * tras una purga y recarga del padrón: el colaborador viejo ya no existe y el nuevo, con el mismo
 * correo, tiene otro id). Empareja por correo (case-insensitive). `Usuario.colaboradorId` es
 * `@unique`: si el colaborador que coincide por correo ya está vinculado a OTRA cuenta, esa fila
 * se omite con aviso (nunca se fuerza ni se desvincula a la otra cuenta). Sin match por correo →
 * aviso con el correo, nunca desactivación.
 */
async function revincularCuentas(): Promise<{ revinculadas: number; sinMatch: number; avisos: string[] }> {
  const [usuarios, colaboradores] = await Promise.all([
    prisma.usuario.findMany({ select: { id: true, email: true, colaboradorId: true } }),
    prisma.colaborador.findMany({ select: { id: true, email: true } }),
  ])
  const colaboradorPorEmail = new Map(colaboradores.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c]))
  const colaboradorIdsOcupados = new Set(usuarios.map((u) => u.colaboradorId))
  const avisos: string[] = []
  const sinMatch: string[] = []
  let revinculadas = 0

  for (const u of usuarios) {
    const colab = colaboradorPorEmail.get(u.email.toLowerCase())
    if (!colab) { sinMatch.push(u.email); continue }
    if (colab.id === u.colaboradorId) continue // ya está vinculado correctamente (caso normal)

    if (colaboradorIdsOcupados.has(colab.id)) {
      avisos.push(`Cuenta ${u.email}: el colaborador que coincide por correo ya está vinculado a otra cuenta de usuario — se omite (revisar manualmente)`)
      continue
    }
    await prisma.usuario.update({ where: { id: u.id }, data: { colaboradorId: colab.id } })
    colaboradorIdsOcupados.delete(u.colaboradorId) // libera el vínculo viejo de esta misma cuenta
    colaboradorIdsOcupados.add(colab.id)
    revinculadas += 1
  }

  if (sinMatch.length > 0) {
    avisos.push(`${sinMatch.length} cuenta(s) de usuario sin colaborador con correo coincidente: ${sinMatch.slice(0, 10).join(', ')} — no se desactivan, revisar manualmente`)
  }
  return { revinculadas, sinMatch: sinMatch.length, avisos }
}

export async function importarMaestro(formData: FormData, aplicar: boolean): Promise<ResultadoMaestro> {
  const sesion = await requiereAdmin('CONFIGURACION', 'GESTIONAR')
  // El maestro reconfigura estructura + padrón, que cruza países: solo RR.HH. Regional
  if (sesion.alcanceRrhh !== 'REGIONAL') return { ok: false, error: 'Solo RR.HH. Regional puede ejecutar la carga maestra (cruza países)' }

  const archivo = formData.get('archivo')
  if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'Adjunta el Excel maestro (.xlsx)' }
  if (archivo.size > 10 * 1024 * 1024) return { ok: false, error: 'El archivo supera los 10 MB' }

  let parseado: MaestroParseado
  try {
    parseado = parseMaestro(await archivo.arrayBuffer())
  } catch {
    return { ok: false, error: 'El archivo no se pudo leer como Excel (.xlsx): verifica que sea el archivo maestro sin modificaciones de formato' }
  }
  const bd = await snapshotBD()
  const plan = planificarMaestro(parseado, bd)
  // Hoja/encabezado ausente (p. ej. el archivo no es el maestro real): son bloqueantes, van primero.
  plan.errores.unshift(...parseado.errores)

  // Informativo en TODOS los caminos (dry-run, bloqueado por errores/ciclo, y aplicado):
  // protege recargas futuras del maestro.
  plan.avisos.push(...(await avisoColaboradoresNoIncluidos(plan)))

  if (!aplicar) {
    // El motor de padrón no corría en dry-run: la sección Padrón no mostraba nuevos/actualizados
    // ni los errores/avisos propios del motor (jefe inexistente, documento duplicado, etc.) — se
    // veían recién al aplicar. Solo tiene sentido correrlo si el archivo no tiene errores
    // estructurales ya detectados (niveles/puestos/competencias): con esos, el padrón derivado
    // podría venir con cargos/países sin resolver y el motor arrojaría ruido no representativo.
    if (plan.errores.length === 0) {
      const filasPadron: FilaPadron[] = plan.padron.filas.map((f) => ({ ...f, email: f.email.toLowerCase() }))
      const { resumen } = await procesarPadron(filasPadron, { sesionId: sesion.id, aplicar: false, origen: 'MAESTRO' })
      // Los errores del motor (jefe inexistente, documento duplicado, etc.) deben bloquear desde
      // el análisis, igual que los estructurales — por eso van a `plan.errores`, no a avisos.
      plan.errores.push(...resumen.errores)
      plan.avisos.push(...resumen.avisos)
      plan.padron.nuevos = resumen.nuevos
      plan.padron.actualizados = resumen.actualizados
    }
    return { ok: true, plan, aplicado: false }
  }
  if (plan.errores.length > 0) return { ok: true, plan, aplicado: false }

  // Candado de ciclo ACTIVO: no basta con `plan.bloqueadoPorCiclo` (viene del snapshot tomado
  // antes) — se recalcula en el mismo request de aplicación para cerrar la carrera.
  const hayCicloActivo = (await prisma.ciclo.count({ where: { estado: 'ACTIVO' } })) > 0
  if (hayCicloActivo) return { ok: false, error: 'Hay un ciclo de evaluación ACTIVO: la carga maestra se aplica solo sin ciclos en curso' }

  // Riesgo aceptado: de aquí al AuditLog final no hay una única transacción de BD envolvente
  // (`aplicarEstructura` sí usa `$transaction` internamente, pero `procesarPadron` y
  // `revincularCuentas` corren aparte) — una excepción a mitad de este tramo puede dejar la
  // estructura aplicada pero el padrón/cuentas sin procesar, y sin AuditLog de éxito. Mitigaciones:
  // (1) el candado de ciclo ACTIVO ya se verificó arriba ⇒ no hay evaluaciones en curso que un
  // estado parcial pueda corromper; (2) el proceso es idempotente y re-ejecutable — un reintento
  // con un snapshot fresco de BD repara el estado (`aplicarEstructura` vuelve a upsert-ear lo
  // mismo, `procesarPadron` reprocesa el padrón completo); (3) el catch registra un AuditLog
  // best-effort para no perder trazabilidad del incidente.
  try {
    await aplicarEstructura(parseado, plan, bd)
    // El parser de hoja 8 no normaliza el correo (a diferencia del CSV, que ya llega en minúsculas
    // y así quedó guardado en BD históricamente): se alinea aquí para que el cruce por correo del
    // motor de padrón y de `revincularCuentas` sea consistente.
    const filasPadron: FilaPadron[] = plan.padron.filas.map((f) => ({ ...f, email: f.email.toLowerCase() }))
    const { resumen } = await procesarPadron(filasPadron, { sesionId: sesion.id, aplicar: true, origen: 'MAESTRO', archivoNombre: archivo.name })
    // El dry-run ya asigna estos conteos (líneas arriba); tras aplicar también hay que
    // refrescarlos, si no la sección Padrón del plan se queda con los del análisis (o vacíos)
    // y el toast cae al fallback inflado.
    plan.padron.nuevos = resumen.nuevos
    plan.padron.actualizados = resumen.actualizados
    if (!resumen.aplicado) {
      // El motor validó de nuevo al aplicar (con el snapshot fresco de BD) y encontró errores que
      // el dry-run no vio (p. ej. una fila que otro proceso insertó entre el análisis y el clic de
      // aplicar) — no aplicó el padrón. La estructura (pasos 1-5 de `aplicarEstructura`) SÍ quedó
      // aplicada porque corrió antes en su propia transacción: sin este corte, seguíamos de largo
      // (re-link + AuditLog) y devolvíamos `aplicado: true` — éxito falso con estructura aplicada
      // y padrón sin cargar. El proceso es re-ejecutable: `aplicarEstructura` vuelve a upsert-ear
      // lo mismo, así que corregir el archivo y volver a subirlo repara el estado completo.
      plan.errores.push(...resumen.errores)
      try {
        await prisma.auditLog.create({
          data: { usuarioId: sesion.id, accion: 'IMPORTACION_MAESTRA_ERROR', detalle: { archivo: archivo.name, errores: resumen.errores } },
        })
      } catch {
        // Best-effort: si el AuditLog también falla, no enmascarar el error original.
      }
      return {
        ok: false,
        error: `El padrón no se aplicó por errores de validación — la estructura sí quedó aplicada; corrige el archivo y vuelve a subirlo (re-ejecutable): ${resumen.errores.slice(0, 3).join(' · ')}`,
      }
    }
    const cuentas = await revincularCuentas()
    plan.avisos.push(...resumen.avisos, ...cuentas.avisos)

    await prisma.auditLog.create({
      data: {
        usuarioId: sesion.id,
        accion: 'IMPORTACION_MAESTRA',
        detalle: {
          archivo: archivo.name,
          niveles: plan.niveles.length,
          puestosNuevos: plan.puestosNuevos.length,
          rehomologados: plan.puestosRehomologados.length,
          competenciasCambian: plan.competenciasCambian.length,
          pesosPersonalizados: plan.pesosPersonalizados.length,
          padron: resumen.filas,
          cuentasRevinculadas: cuentas.revinculadas,
          cuentasSinMatch: cuentas.sinMatch,
        },
      },
    })
    revalidatePath('/admin/configuracion')
    revalidatePath('/admin/colaboradores')
    revalidatePath('/admin/puestos')
    return { ok: true, plan, aplicado: true }
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e)
    try {
      await prisma.auditLog.create({
        data: { usuarioId: sesion.id, accion: 'IMPORTACION_MAESTRA_ERROR', detalle: { archivo: archivo.name, error: mensaje } },
      })
    } catch {
      // Best-effort: si el AuditLog de error también falla, no enmascarar el error original.
    }
    return {
      ok: false,
      error: `La carga falló a mitad de la aplicación: la estructura pudo quedar aplicada. Corrige la causa y vuelve a subir el archivo — el proceso es re-ejecutable y repara el estado. Detalle: ${mensaje}`,
    }
  }
}
