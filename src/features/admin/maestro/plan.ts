import { normalizar } from './parser'
import type { MaestroParseado, FilaPadronMaestro } from './parser'

/**
 * Planificador puro del importador maestro: cruza lo parseado del Excel (Task 1) contra un
 * snapshot plano de la BD y devuelve un plan de cambios + errores/avisos, SIN tocar Prisma.
 * La action (Task 3) arma el `SnapshotBD`, llama a `planificarMaestro` y aplica el plan.
 */

export type SnapshotBD = {
  niveles: { id: string; nombre: string; compPct: number }[]
  dimensiones: { id: string; nombre: string; orden: number }[] // orden ↔ posición D1..D5
  competencias: { id: string; nombre: string }[]
  paises: { nombre: string }[]
  puestos: { id: string; nombre: string; nivelId: string; pesos: { dimensionId: string; peso: number }[]; competenciaIds: string[] }[]
  hayCicloActivo: boolean
}

export type PlanMaestro = {
  errores: string[] // bloqueantes: no se puede aplicar
  avisos: string[] // conscientes: se aplica igual
  bloqueadoPorCiclo: boolean // ciclo ACTIVO: dry-run visible, aplicación bloqueada
  niveles: { nombre: string; compPctAntes: number; compPctDespues: number }[] // solo los que cambian
  puestosNuevos: { nombre: string; nivel: string }[]
  puestosRehomologados: { nombre: string; nivelAntes: string; nivelDespues: string }[]
  competenciasCambian: { puesto: string; antes: number; despues: number }[] // sets que difieren
  competenciasPuestosNuevos: { puesto: string; competencias: string[] }[] // ids de competencia para puestos nuevos (hoja 4 ∩ hoja 5, sin BD): Task 3 los crea
  pesosDerivados: number // puestos cuyos pesos = su nivel (hoja 6 igual o ausente)
  pesosPersonalizados: { puesto: string; pesos: number[]; nivel: string }[] // hoja 6 ≠ nivel: se aplica y se lista
  padron: {
    filas: FilaPadronMaestro[] // filas con nivel YA derivado de hoja 4
    nivelesIgnorados: number
    // `nuevos`/`actualizados`: el planificador NO los llena (es puro, sin BD del padrón) — los
    // llena la action (`importarMaestro`) tras correr `procesarPadron` en modo dry-run, único que
    // conoce qué código ya existe en la tabla Colaborador.
    nuevos?: number
    actualizados?: number
  }
}

function sumar(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0)
}

/** Fusiona filas cuya clave normalizada coincide (última fila gana); avisa "Hoja N: <tipo> "X" ... se fusiona". */
function fusionar<T>(filas: T[], clave: (f: T) => string, hoja: string, tipo: string, avisos: string[]): Map<string, T> {
  const mapa = new Map<string, T>()
  for (const fila of filas) {
    const valor = clave(fila)
    const k = normalizar(valor)
    if (!k) continue
    if (mapa.has(k)) {
      avisos.push(`${hoja}: ${tipo} "${valor}" aparece repetido en el archivo — se fusiona en un solo registro`)
    }
    mapa.set(k, fila)
  }
  return mapa
}

export function planificarMaestro(parseado: MaestroParseado, bd: SnapshotBD): PlanMaestro {
  const errores: string[] = []
  const avisos: string[] = []

  // ── Índices de la BD ──
  const nivelPorNombre = new Map(bd.niveles.map((n) => [normalizar(n.nombre), n]))
  const nivelPorId = new Map(bd.niveles.map((n) => [n.id, n]))
  const competenciaPorNombre = new Map(bd.competencias.map((c) => [normalizar(c.nombre), c]))
  const paisesArchivo = new Set(bd.paises.map((p) => normalizar(p.nombre)))
  const puestoPorNombre = new Map(bd.puestos.map((p) => [normalizar(p.nombre), p]))

  // ── Hoja 3: Niveles (pesos por dimensión, % competencias/objetivos) ──
  const nivelesDedup = fusionar(parseado.niveles, (n) => n.nivel, 'Hoja 3', 'el nivel', avisos)
  const nivelPesosDimPorNombre = new Map<string, number[]>()
  const niveles: PlanMaestro['niveles'] = []
  for (const fila of nivelesDedup.values()) {
    const suma = sumar(fila.pesosDim)
    const todosCero = fila.pesosDim.every((p) => p === 0)
    let pesosValidos = false
    if (todosCero) {
      errores.push(`Hoja 3: el nivel "${fila.nivel}" no tiene pesos`)
    } else if (suma !== 100) {
      errores.push(`Hoja 3: el nivel "${fila.nivel}" - los pesos por dimensión suman ${suma} (deben sumar 100)`)
    } else {
      pesosValidos = true
    }

    const sumaPct = fila.compPct + fila.objPct
    if (sumaPct !== 100) {
      errores.push(`Hoja 3: el nivel "${fila.nivel}" - % competencias + % objetivos suman ${sumaPct} (deben sumar 100)`)
    }

    const nivelBD = nivelPorNombre.get(normalizar(fila.nivel))
    if (!nivelBD) {
      errores.push(`Hoja 3: nivel desconocido "${fila.nivel}"`)
      continue
    }
    if (pesosValidos) nivelPesosDimPorNombre.set(normalizar(fila.nivel), fila.pesosDim)
    if (fila.compPct !== nivelBD.compPct) {
      niveles.push({ nombre: nivelBD.nombre, compPctAntes: nivelBD.compPct, compPctDespues: fila.compPct })
    }
  }

  // ── Hoja 4: Puestos del padrón (nivel jerárquico) ──
  type PuestoResuelto = { puesto: string; nivelBD: { id: string; nombre: string; compPct: number } }
  const puestosDedupRaw = fusionar(parseado.puestos, (p) => p.puesto, 'Hoja 4', 'el puesto', avisos)
  const puestosDedup = new Map<string, PuestoResuelto>()
  for (const [k, fila] of puestosDedupRaw) {
    const nivelBD = nivelPorNombre.get(normalizar(fila.nivel))
    if (!nivelBD) {
      errores.push(`Hoja 4: el puesto "${fila.puesto}" tiene un nivel desconocido "${fila.nivel}"`)
      continue
    }
    puestosDedup.set(k, { puesto: fila.puesto, nivelBD })
  }

  const puestosNuevos: PlanMaestro['puestosNuevos'] = []
  const puestosRehomologados: PlanMaestro['puestosRehomologados'] = []
  for (const { puesto, nivelBD } of puestosDedup.values()) {
    const actual = puestoPorNombre.get(normalizar(puesto))
    if (!actual) {
      puestosNuevos.push({ nombre: puesto, nivel: nivelBD.nombre })
    } else if (actual.nivelId !== nivelBD.id) {
      const nivelAntes = nivelPorId.get(actual.nivelId)?.nombre ?? '?'
      puestosRehomologados.push({ nombre: puesto, nivelAntes, nivelDespues: nivelBD.nombre })
    }
  }

  // Puestos que ya no vienen en el archivo: el importador nunca los borra, solo se avisa
  for (const p of bd.puestos) {
    if (!puestosDedupRaw.has(normalizar(p.nombre))) {
      avisos.push(`El puesto "${p.nombre}" ya no aparece en el archivo — no se elimina (el importador nunca borra puestos)`)
    }
  }

  // ── Hoja 3 ↔ Hoja 4: cobertura obligatoria — todo nivel usado por un puesto de la Hoja 4 debe
  // tener una fila VÁLIDA en la Hoja 3. Si no, `aplicarEstructura` (Task 3) deriva los pesos de
  // ese nivel con `pesosDimPorNivel.get(...)?.pesosDim ?? []`, que produce [0,0,0,0,0] en silencio
  // para cualquier puesto "derivado" de ese nivel. En rigor este requisito solo lo necesitan los
  // puestos que van a derivar sus pesos de la Hoja 3 (los que tienen fila propia en la Hoja 6 no
  // la necesitan) — pero por simplicidad y robustez se exige la fila para TODO nivel referenciado
  // en la Hoja 4: el archivo maestro real siempre trae los 4 niveles, así que el costo de la
  // exigencia extra es nulo en la práctica y evita depender de qué puestos tienen hoja 6.
  const nivelesReferenciadosPorHoja4 = new Set(Array.from(puestosDedup.values()).map((p) => p.nivelBD.nombre))
  for (const nombreNivel of nivelesReferenciadosPorHoja4) {
    if (!nivelPesosDimPorNombre.has(normalizar(nombreNivel))) {
      errores.push(`Hoja 3: el nivel "${nombreNivel}" (usado por puestos de la Hoja 4) no tiene fila de pesos`)
    }
  }

  // ── Hoja 5: Competencias x Puesto ──
  const competenciasDedup = fusionar(parseado.competencias, (c) => c.puesto, 'Hoja 5', 'el puesto', avisos)
  const competenciasCambian: PlanMaestro['competenciasCambian'] = []
  const competenciasPuestosNuevos: PlanMaestro['competenciasPuestosNuevos'] = []
  for (const fila of competenciasDedup.values()) {
    const ids: string[] = []
    let desconocida = false
    for (const nombreComp of fila.competencias) {
      const comp = competenciaPorNombre.get(normalizar(nombreComp))
      if (!comp) {
        errores.push(`Hoja 5: competencia desconocida "${nombreComp}" (puesto "${fila.puesto}")`)
        desconocida = true
        continue
      }
      ids.push(comp.id)
    }
    if (desconocida) continue
    if (ids.length === 0) {
      errores.push(`Hoja 5: el puesto "${fila.puesto}" no tiene competencias marcadas`)
      continue
    }
    const actual = puestoPorNombre.get(normalizar(fila.puesto))
    if (!actual) {
      // Puesto nuevo (no existe en BD): no hay "actual" con qué comparar. Si además está en la
      // Hoja 4, sus competencias viajan en el plan para que la Task 3 las cree junto al puesto.
      const nuevoEnHoja4 = puestosDedup.get(normalizar(fila.puesto))
      if (nuevoEnHoja4) competenciasPuestosNuevos.push({ puesto: nuevoEnHoja4.puesto, competencias: ids })
      continue
    }
    const antesSet = new Set(actual.competenciaIds)
    const despuesSet = new Set(ids)
    const iguales = antesSet.size === despuesSet.size && [...antesSet].every((id) => despuesSet.has(id))
    if (!iguales) competenciasCambian.push({ puesto: fila.puesto, antes: actual.competenciaIds.length, despues: ids.length })
  }

  // ── Hoja 4 ↔ Hoja 5: cobertura obligatoria — todo puesto de la Hoja 4 debe tener fila en Hoja 5 ──
  for (const [k, resuelto] of puestosDedup) {
    if (!competenciasDedup.has(k)) {
      errores.push(`Hoja 5: el puesto "${resuelto.puesto}" no tiene fila de competencias`)
    }
  }

  // ── Hoja 6: Pesos x Puesto (jerarquía sobre hoja 3) ──
  const pesosPuestoDedup = fusionar(parseado.pesosPuesto, (p) => p.puesto, 'Hoja 6', 'el puesto', avisos)
  let pesosDerivados = 0
  const pesosPersonalizados: PlanMaestro['pesosPersonalizados'] = []
  for (const [k, resuelto] of puestosDedup) {
    const fila = pesosPuestoDedup.get(k)
    if (!fila) {
      pesosDerivados += 1 // sin fila en hoja 6: derivado del nivel
      continue
    }
    // Number('') === 0: una fila con todos los pesos vacíos/0 se trata como "sin fila" (fallback al nivel)
    if (fila.pesosDim.every((p) => p === 0)) {
      pesosDerivados += 1
      continue
    }
    const suma = sumar(fila.pesosDim)
    if (suma !== 100) {
      errores.push(`Hoja 6: el puesto "${resuelto.puesto}" - los pesos suman ${suma} (deben sumar 100)`)
      continue
    }
    const pesosNivel = nivelPesosDimPorNombre.get(normalizar(resuelto.nivelBD.nombre))
    if (pesosNivel && pesosNivel.every((p, i) => p === fila.pesosDim[i])) {
      pesosDerivados += 1
    } else {
      pesosPersonalizados.push({ puesto: resuelto.puesto, pesos: fila.pesosDim, nivel: resuelto.nivelBD.nombre })
    }
  }
  for (const [k, fila] of pesosPuestoDedup) {
    if (!puestosDedup.has(k)) errores.push(`Hoja 6: el puesto "${fila.puesto}" no está en la Hoja 4 (Puestos)`)
  }

  // ── Padrón: el nivel se DERIVA de hoja 4 (nunca se confía en la columna del padrón) ──
  const filas: FilaPadronMaestro[] = []
  let nivelesIgnorados = 0
  for (const f of parseado.padron) {
    const donde = `Padrón: fila ${f.linea} (${f.codigo || 'sin código'})`
    const resuelto = puestosDedup.get(normalizar(f.cargo))
    if (!resuelto) {
      errores.push(`${donde} - el cargo "${f.cargo}" no está en la Hoja 4 (Puestos)`)
      filas.push(f)
      continue
    }
    if (!paisesArchivo.has(normalizar(f.pais))) {
      errores.push(`${donde} - país desconocido "${f.pais}"`)
    }
    const nivelDerivado = resuelto.nivelBD.nombre
    if (normalizar(f.nivel) !== normalizar(nivelDerivado)) nivelesIgnorados += 1
    filas.push({ ...f, nivel: nivelDerivado })
  }

  // ── Candado: ciclo ACTIVO no bloquea el dry-run, solo la aplicación ──
  const bloqueadoPorCiclo = bd.hayCicloActivo
  if (bloqueadoPorCiclo) {
    avisos.push('Hay un ciclo ACTIVO: los cambios se pueden revisar pero no se aplicarán hasta que cierre')
  }

  return {
    errores,
    avisos,
    bloqueadoPorCiclo,
    niveles,
    puestosNuevos,
    puestosRehomologados,
    competenciasCambian,
    competenciasPuestosNuevos,
    pesosDerivados,
    pesosPersonalizados,
    padron: { filas, nivelesIgnorados },
  }
}
