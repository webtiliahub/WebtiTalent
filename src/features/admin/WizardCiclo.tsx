'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { crearCiclo, editarCiclo } from './acciones'
import { previewAlcance, type PreviewAlcance } from '@/features/ciclos/acciones-alcance'
import { resumenAlcance } from '@/features/ciclos/alcance'
import { SelectorMultiple } from '@/shared/ui/SelectorMultiple'
import { Combobox } from '@/shared/ui/Combobox'

type EvaluacionW = { id: string; nombre: string; totalPreguntas: number }
export type NivelW = {
  id: string; nombre: string; colaboradores: number
  evaluaciones: EvaluacionW[]
  excepciones: { puestoId: string; puesto: string; evaluaciones: EvaluacionW[] }[]
}

/** Selector del set de evaluaciones del ciclo: una por nivel + excepciones por puesto.
 * Compartido entre el wizard de creación y la edición del ciclo en borrador. */
export function SelectorEvaluaciones({ niveles, porNivel, setPorNivel, porPuesto, setPorPuesto, conteos }: {
  niveles: NivelW[]
  conteos?: Record<string, number> // nivelId → evaluados del alcance; sin definir, usa los totales del nivel
  porNivel: Record<string, string>
  setPorNivel: React.Dispatch<React.SetStateAction<Record<string, string>>>
  porPuesto: Record<string, string>
  setPorPuesto: React.Dispatch<React.SetStateAction<Record<string, string>>>
}) {
  const hayEvaluaciones = niveles.some((n) => n.evaluaciones.length > 0 || n.excepciones.length > 0)
  const hayExcepciones = niveles.some((n) => n.excepciones.length > 0)
  const evaluacionIds = [...Object.values(porNivel), ...Object.values(porPuesto)].filter(Boolean)
  // Conteo acotado al alcance: sin `conteos`, el total del nivel; con él, solo los que caen en el alcance
  const conteoDe = (n: NivelW) => (conteos ? (conteos[n.id] ?? 0) : n.colaboradores)
  const nivelesSinEvaluar = niveles.filter((n) => !porNivel[n.id] && conteoDe(n) > 0)

  if (!hayEvaluaciones) {
    return (
      <p className="rounded-xl border border-gris-claro bg-hueso px-4 py-6 text-center text-sm text-gris">
        No hay evaluaciones con preguntas. Crea una en <b>Diseñar evaluación → Creación de evaluaciones</b> antes de continuar.
      </p>
    )
  }
  return (
    <>
      <ul className="space-y-2">
        {niveles.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gris-claro px-4 py-3">
            <div className="min-w-[130px]">
              <p className="text-sm font-bold">{n.nombre}</p>
              <p className="text-[11px] text-gris">{conteoDe(n)} colaborador{conteoDe(n) === 1 ? '' : 'es'}{conteos ? ' en el alcance' : ''}</p>
            </div>
            <select
              value={porNivel[n.id] ?? ''}
              onChange={(e) => setPorNivel((s) => ({ ...s, [n.id]: e.target.value }))}
              className="min-w-0 flex-1 rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none focus:border-marca"
            >
              <option value="">— Este nivel no se evalúa —</option>
              {n.evaluaciones.map((e) => <option key={e.id} value={e.id}>{e.nombre} · {e.totalPreguntas} preguntas</option>)}
            </select>
          </li>
        ))}
      </ul>

      {hayExcepciones && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3">
          <p className="mb-2 text-xs font-bold text-amber-800">Excepciones por puesto (reemplazan a la evaluación del nivel para ese puesto)</p>
          <ul className="space-y-2">
            {niveles.flatMap((n) => n.excepciones.map((ex) => (
              <li key={ex.puestoId} className="flex flex-wrap items-center gap-3">
                <p className="min-w-[130px] text-[13px] font-semibold">{ex.puesto} <span className="text-[11px] font-normal text-gris">({n.nombre})</span></p>
                <select
                  value={porPuesto[ex.puestoId] ?? ''}
                  onChange={(e) => setPorPuesto((s) => {
                    const nuevo = { ...s }
                    if (e.target.value) nuevo[ex.puestoId] = e.target.value; else delete nuevo[ex.puestoId]
                    return nuevo
                  })}
                  className="min-w-0 flex-1 rounded-xl border border-gris-claro bg-white px-3.5 py-2 text-[13px] outline-none focus:border-marca"
                >
                  <option value="">— Usa la evaluación del nivel —</option>
                  {ex.evaluaciones.map((e) => <option key={e.id} value={e.id}>{e.nombre} · {e.totalPreguntas} preguntas</option>)}
                </select>
              </li>
            )))}
          </ul>
        </div>
      )}

      {nivelesSinEvaluar.length > 0 && evaluacionIds.length > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          ⚠️ Sin evaluación de competencias en este ciclo: {nivelesSinEvaluar.map((n) => `${n.nombre} (${conteoDe(n)})`).join(', ')}. Esos colaboradores no recibirán cuestionario de competencias.
        </p>
      )}
    </>
  )
}

/** Datos iniciales para editar un ciclo en borrador (el wizard se abre con todo precargado). */
export type CicloEdicion = {
  cicloId: string
  nombre: string
  descripcion: string
  periodoId: string | null // null = ciclo sin objetivos
  fechaInicio: string // yyyy-mm-dd
  fechaFin: string // yyyy-mm-dd
  porNivel: Record<string, string>
  porPuesto: Record<string, string>
  focoPaisIds: string[]
  focoAreaIds: string[]
  focoNivelIds: string[]
  incluirIds: string[]
  excluirIds: string[]
}

export function WizardCiclo({ niveles, paises, periodos, areas, nivelesCatalogo, colaboradores, paisFijo, edicion }: {
  niveles: NivelW[]
  paises: { id: string; nombre: string }[]
  periodos: { id: string; nombre: string; estado: string }[]
  areas: { id: string; nombre: string }[]
  nivelesCatalogo: { id: string; nombre: string }[]
  colaboradores: { id: string; nombre: string; detalle: string; paisId: string }[]
  paisFijo?: { id: string; nombre: string }
  edicion?: CicloEdicion
}) {
  const router = useRouter()
  const [paso, setPaso] = useState(1)
  // Paso más avanzado alcanzado: habilita saltar (navegar) a pasos ya visitados desde el
  // indicador. En edición todos están disponibles desde el inicio.
  const [maxPaso, setMaxPaso] = useState(edicion ? 4 : 1)
  const [nombre, setNombre] = useState(edicion?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(edicion?.descripcion ?? '')
  // Sin objetivos = no viaja periodoId; en edición, un ciclo sin período precarga esa opción
  const [conObjetivos, setConObjetivos] = useState(edicion ? edicion.periodoId !== null : true)
  const [periodoId, setPeriodoId] = useState(edicion?.periodoId ?? periodos[0]?.id ?? '')
  const [fechaInicio, setFechaInicio] = useState(edicion?.fechaInicio ?? '')
  const [fechaFin, setFechaFin] = useState(edicion?.fechaFin ?? '')
  const [focoPaisIds, setFocoPaisIds] = useState<string[]>(edicion?.focoPaisIds ?? (paisFijo ? [paisFijo.id] : []))
  const [focoAreaIds, setFocoAreaIds] = useState<string[]>(edicion?.focoAreaIds ?? [])
  const [focoNivelIds, setFocoNivelIds] = useState<string[]>(edicion?.focoNivelIds ?? [])
  const [incluirIds, setIncluirIds] = useState<string[]>(edicion?.incluirIds ?? [])
  const [excluirIds, setExcluirIds] = useState<string[]>(edicion?.excluirIds ?? [])
  // Sin ningún filtro, el buscador necesita saber la INTENCIÓN: ¿acotar a solo estas
  // personas (modo lista) o retirarlas del universo completo? Con filtros no aplica.
  const [modoSinFiltros, setModoSinFiltros] = useState<'solo' | 'retirar'>(
    () => (edicion && edicion.excluirIds.length > 0 && edicion.incluirIds.length === 0 ? 'retirar' : 'solo'),
  )
  const [preview, setPreview] = useState<PreviewAlcance | null>(null)
  // Una evaluación por nivel ('' = ese nivel no se evalúa); si el nivel tiene una sola, se preselecciona
  const [porNivel, setPorNivel] = useState<Record<string, string>>(() =>
    edicion?.porNivel ?? Object.fromEntries(niveles.map((n) => [n.id, n.evaluaciones.length === 1 ? n.evaluaciones[0].id : ''])),
  )
  // Excepciones por puesto ('' = usa la del nivel)
  const [porPuesto, setPorPuesto] = useState<Record<string, string>>(edicion?.porPuesto ?? {})
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  const evaluacionIds = [...Object.values(porNivel), ...Object.values(porPuesto)].filter(Boolean)
  const nivelesSinEvaluar = niveles.filter((n) => !porNivel[n.id])
  const sinFiltros = focoPaisIds.length === 0 && focoAreaIds.length === 0 && focoNivelIds.length === 0

  // Preview en vivo del alcance (debounce): corre el MISMO resolutor que lanzarCiclo, así la
  // lista previa nunca promete algo distinto de lo que se genera al lanzar.
  useEffect(() => {
    let cancelado = false
    const t = setTimeout(async () => {
      const res = await previewAlcance({
        foco: { focoPaisIds, focoAreaIds, focoNivelIds },
        ajustes: { incluirIds, excluirIds },
        fechaInicio,
      })
      if (!cancelado && res.ok) setPreview(res.preview)
    }, 400)
    return () => { cancelado = true; clearTimeout(t) }
  }, [focoPaisIds, focoAreaIds, focoNivelIds, incluirIds, excluirIds, fechaInicio])

  const puedeAvanzar = paso === 1
    ? nombre.trim().length >= 4 && fechaInicio && fechaFin && (!conObjetivos || periodoId !== '')
    : paso === 2 ? true
    : paso === 3 ? evaluacionIds.length > 0
    : true

  function crear() {
    setError(null)
    const fd = new FormData()
    fd.set('nombre', nombre)
    fd.set('descripcion', descripcion)
    // Sin objetivos: no viaja periodoId (input ausente → undefined en el server → null)
    if (conObjetivos) fd.set('periodoId', periodoId)
    fd.set('fechaInicio', fechaInicio)
    fd.set('fechaFin', fechaFin)
    const alcance = { focoPaisIds, focoAreaIds, focoNivelIds, incluirIds, excluirIds }
    startTransition(async () => {
      if (edicion) {
        const res = await editarCiclo(edicion.cicloId, fd, evaluacionIds, alcance)
        if (!res.ok) setError(res.error)
        else {
          router.push(`/admin/ciclos/${edicion.cicloId}`)
          router.refresh()
        }
        return
      }
      const res = await crearCiclo(fd, evaluacionIds, alcance)
      if (!res.ok) setError(res.error)
      else {
        router.push(`/admin/ciclos/${res.cicloId}?creado=1`)
        router.refresh()
      }
    })
  }

  // min-w-0: los inputs type="date" tienen un ancho mínimo intrínseco en Chromium que ignora
  // w-full y empujaba el grid (y con él toda la página) más allá del viewport en móvil
  const inputCls = 'w-full min-w-0 rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none focus:border-marca'
  const pasos = ['Datos', 'Alcance', 'Evaluaciones', 'Revisión']
  const nombreEvaluacion = new Map(niveles.flatMap((n) => [...n.evaluaciones, ...n.excepciones.flatMap((p) => p.evaluaciones)]).map((e) => [e.id, e] as const))

  return (
    <div className="space-y-4">
      {/* Indicador de pasos: en móvil las 4 casillas se reparten a ancho uniforme (número
          arriba, etiqueta debajo) para que TODAS quepan; en escritorio, fila con número al
          lado. Cada casilla es navegable hasta el paso más avanzado alcanzado. */}
      <div className="flex gap-1.5 md:flex-wrap md:gap-2">
        {pasos.map((p, i) => {
          const n = i + 1
          const navegable = n <= maxPaso
          return (
            <button
              key={p}
              type="button"
              disabled={!navegable}
              onClick={() => navegable && setPaso(n)}
              className={`flex flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2 text-center text-[11px] font-bold leading-tight md:flex-none md:flex-row md:gap-2 md:px-4 md:py-2.5 md:text-[13px] ${paso === n ? 'bg-blue-50 text-marca-dark ring-1 ring-marca/30' : paso > n ? 'bg-emerald-50 text-emerald-700' : 'bg-hueso-2 text-gris'} ${navegable ? '' : 'cursor-default opacity-60'}`}
            >
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${paso === n ? 'bg-marca text-white' : paso > n ? 'bg-emerald-500 text-white' : 'bg-gris-claro text-gris'}`}>
                {paso > n ? '✓' : n}
              </span>
              {p}
            </button>
          )
        })}
      </div>

      <div className="rounded-2xl border border-gris-claro bg-white p-5">
        {paso === 1 && (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="md:col-span-2">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gris">Nombre del ciclo</span>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="p. ej. Ciclo Anual 2027" className={inputCls} />
            </label>
            <label className="md:col-span-2">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gris">Descripción</span>
              <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Anual · competencias + objetivos" className={inputCls} />
            </label>
            <fieldset className="md:col-span-2 space-y-1.5">
              <legend className="text-xs font-bold uppercase tracking-wide text-gris">¿Este ciclo evalúa objetivos?</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="evaluaObjetivos" checked={conObjetivos} onChange={() => setConObjetivos(true)} className="accent-[#0067ff]" />
                Sí — se elige un período de objetivos
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="evaluaObjetivos" checked={!conObjetivos} onChange={() => setConObjetivos(false)} className="accent-[#0067ff]" />
                No — la nota final se calculará 100% con competencias
              </label>
            </fieldset>
            {conObjetivos && (
              <label className="md:col-span-2">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gris">Período de objetivos que evalúa</span>
                <select value={periodoId} onChange={(e) => setPeriodoId(e.target.value)} className={inputCls}>
                  {periodos.length === 0 && <option value="">No hay períodos con carga abierta o cerrada</option>}
                  {periodos.map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre}{p.estado === 'CARGA_ABIERTA' ? ' · carga aún abierta' : ''}</option>
                  ))}
                </select>
                {periodos.find((p) => p.id === periodoId)?.estado === 'CARGA_ABIERTA' && (
                  <span className="mt-1 block text-[11px] text-marca-dark">La carga de este período sigue abierta: idealmente ciérrala antes de lanzar el ciclo para congelar los objetivos.</span>
                )}
              </label>
            )}
            {/* Inicio y Fin: date nativo, apiladas a lo ancho en móvil y lado a lado en
                escritorio. A todo el ancho el control nativo tiene espacio y el toque abre
                directo el selector de fecha (no el teclado). */}
            <label>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gris">Inicio</span>
              <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} className={inputCls} />
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gris">Fin</span>
              <input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} className={inputCls} />
            </label>
          </div>
        )}

        {paso === 2 && (
          <div className="space-y-4">
            <p className="text-sm">Alcance del ciclo: los filtros definen a los <b>evaluados</b> (quienes reciben calificación). El sistema generará autoevaluación, evaluación de jefe y ascendente para cada uno; los pares se asignan después. Jefe y reportes evalúan aunque estén fuera del alcance.</p>
            <div className="grid gap-3 md:grid-cols-3">
              {paisFijo ? (
                <div>
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gris">Países</span>
                  <p className="rounded-xl border border-gris-claro bg-hueso-2 px-3.5 py-2.5 text-sm text-gris">{paisFijo.nombre} (tu alcance)</p>
                </div>
              ) : (
                <SelectorMultiple etiqueta="Países" opciones={paises} seleccion={focoPaisIds} onCambio={setFocoPaisIds} />
              )}
              <SelectorMultiple etiqueta="Áreas" opciones={areas} seleccion={focoAreaIds} onCambio={setFocoAreaIds} />
              <SelectorMultiple etiqueta="Niveles jerárquicos" opciones={nivelesCatalogo} seleccion={focoNivelIds} onCambio={setFocoNivelIds} />
            </div>

            {/* Ajustes manuales: con filtros, el buscador decide la acción según si la persona
                ya está en el alcance; sin filtros, la intención la marca el mini-toggle
                (seleccionar = SOLO esas personas, o retirar del universo completo) */}
            <div className="rounded-xl border border-gris-claro bg-hueso/50 p-3.5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-gris">Ajustes manuales</p>
                {sinFiltros && (
                  <span className="flex gap-1 rounded-full bg-hueso-2 p-0.5">
                    <button type="button" onClick={() => setModoSinFiltros('solo')}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${modoSinFiltros === 'solo' ? 'bg-white shadow-sm' : 'text-gris'}`}>
                      Solo estas personas
                    </button>
                    <button type="button" onClick={() => setModoSinFiltros('retirar')}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${modoSinFiltros === 'retirar' ? 'bg-white shadow-sm' : 'text-gris'}`}>
                      Todos menos estas
                    </button>
                  </span>
                )}
              </div>
              <Combobox
                key={incluirIds.length + excluirIds.length}
                name="ajuste"
                // El país es el techo del alcance: de otros países ni aparecen — no se pueden
                // agregar (regla nueva) ni excluir (no están en el alcance de todos modos).
                opciones={colaboradores.filter((c) =>
                  !incluirIds.includes(c.id) && !excluirIds.includes(c.id) &&
                  (focoPaisIds.length === 0 || focoPaisIds.includes(c.paisId)),
                )}
                textoVacio="Buscar persona para agregar o excluir…"
                onChange={(id) => {
                  if (!id) return
                  if (sinFiltros) {
                    if (modoSinFiltros === 'solo') setIncluirIds((xs) => [...xs, id])
                    else setExcluirIds((xs) => [...xs, id])
                    return
                  }
                  const enAlcance = preview?.grupos.some((g) => g.areas.some((a) => a.personas.some((p) => p.id === id)))
                  if (enAlcance) setExcluirIds((xs) => [...xs, id])
                  else setIncluirIds((xs) => [...xs, id])
                }}
              />
              {(incluirIds.length > 0 || excluirIds.length > 0) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {incluirIds.map((id) => {
                    // Redundante: los filtros ya lo cubren (el preview lo trae con manual=false) — el
                    // resolutor lo trata como inocuo, así que el chip se conserva pero atenuado.
                    const persona = preview?.grupos.flatMap((g) => g.areas.flatMap((a) => a.personas)).find((p) => p.id === id)
                    const redundante = persona !== undefined && persona.manual === false
                    return (
                      <button key={id} type="button" onClick={() => setIncluirIds((xs) => xs.filter((x) => x !== id))}
                        className={`rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 ${redundante ? 'opacity-60' : ''}`}
                        title={redundante ? 'Ya lo cubren los filtros' : 'Quitar ajuste'}>
                        {colaboradores.find((c) => c.id === id)?.nombre ?? id} · agregado{redundante ? ' (ya lo cubren los filtros)' : ''} ✕
                      </button>
                    )
                  })}
                  {excluirIds.map((id) => {
                    // Redundante: ya no está en el alcance sin necesidad de excluirlo (no aparece
                    // en preview.excluidos porque los filtros ya lo dejaron fuera).
                    const redundante = preview !== null && !preview.excluidos.some((e) => e.id === id)
                    return (
                      <button key={id} type="button" onClick={() => setExcluirIds((xs) => xs.filter((x) => x !== id))}
                        className={`rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-bold text-alerta-dark hover:bg-red-100 ${redundante ? 'opacity-60' : ''}`}
                        title={redundante ? 'Ya no está en el alcance' : 'Quitar ajuste'}>
                        {colaboradores.find((c) => c.id === id)?.nombre ?? id} · excluido{redundante ? ' (ya no está en el alcance)' : ''} ✕
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Lista previa */}
            <div className="rounded-xl border border-gris-claro p-3.5">
              {preview === null ? (
                <p className="text-sm text-gris">Calculando alcance…</p>
              ) : (
                <>
                  <p className="text-sm">
                    <span className="font-display text-2xl font-bold">{preview.total}</span> evaluado{preview.total === 1 ? '' : 's'}
                    {preview.porPais.length > 1 && <span className="text-gris"> · {preview.porPais.map((p) => `${p.pais} ${p.total}`).join(' · ')}</span>}
                  </p>
                  {preview.total === 0 && <p className="mt-1 text-xs text-marca-dark">Con estos filtros nadie queda en el ciclo: no se podrá lanzar.</p>}
                  {preview.rechazados.length > 0 && (
                    <p className="mt-1 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                      No entrarán aunque los agregaste: {preview.rechazados.map((r) => `${r.nombre} (${r.motivo === 'INACTIVO' ? 'inactivo' : r.motivo === 'FUERA_DE_PAIS' ? 'fuera de los países del alcance' : 'menos de 6 meses de antigüedad'})`).join(' · ')}
                    </p>
                  )}
                  <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
                    {preview.grupos.map((g) => (
                      <div key={g.pais}>
                        <p className="text-xs font-bold uppercase tracking-wide text-gris">{g.pais}</p>
                        {g.areas.map((a) => (
                          <p key={a.area} className="ml-3 text-[13px]">
                            <span className="font-semibold">{a.area}:</span>{' '}
                            {a.personas.map((p) => p.manual ? <b key={p.id} title="Agregado manualmente"> {p.nombre}*</b> : <span key={p.id}> {p.nombre} ·</span>)}
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                  {incluirIds.length > 0 && <p className="mt-1 text-[11px] text-gris">* agregado manualmente (fuera de los filtros)</p>}
                </>
              )}
            </div>
          </div>
        )}

        {paso === 3 && (
          <div className="space-y-3">
            <p className="rounded-xl bg-red-50/60 px-4 py-2.5 text-sm text-alerta-dark">
              Cada <b>nivel jerárquico</b> aplica su propia evaluación (sus preguntas se copian al ciclo como una foto). Dentro del nivel, cada colaborador responde solo lo de las competencias de su puesto y la modalidad. Las evaluaciones se arman en <b>Diseñar evaluación</b>.
            </p>
            <SelectorEvaluaciones niveles={niveles} porNivel={porNivel} setPorNivel={setPorNivel} porPuesto={porPuesto} setPorPuesto={setPorPuesto} conteos={preview?.porNivel} />
          </div>
        )}

        {paso === 4 && (
          <div className="space-y-3 text-sm">
            <h4 className="font-display text-base font-bold">Revisión final</h4>
            <ul className="space-y-1.5">
              <li><b>Nombre:</b> {nombre}</li>
              <li><b>Alcance:</b> {resumenAlcance(
                { focoPaisIds, focoAreaIds, focoNivelIds },
                {
                  paises: new Map(paises.map((p) => [p.id, p.nombre])),
                  areas: new Map(areas.map((a) => [a.id, a.nombre])),
                  niveles: new Map(nivelesCatalogo.map((n) => [n.id, n.nombre])),
                },
                { incluidos: incluirIds.length, excluidos: excluirIds.length },
              )} — {preview?.total ?? '…'} evaluados</li>
              <li><b>Período de objetivos:</b> {conObjetivos ? (periodos.find((p) => p.id === periodoId)?.nombre ?? '—') : 'Sin objetivos (nota 100% competencias)'}</li>
              <li><b>Período:</b> {new Date(`${fechaInicio}T00:00:00`).toLocaleDateString('es-PE')} → {new Date(`${fechaFin}T00:00:00`).toLocaleDateString('es-PE')}</li>
              <li>
                <b>Evaluaciones:</b>
                <ul className="ml-4 mt-1 list-disc space-y-0.5">
                  {niveles.filter((n) => porNivel[n.id]).map((n) => (
                    <li key={n.id}>{n.nombre}: {nombreEvaluacion.get(porNivel[n.id])?.nombre} <span className="text-gris">({nombreEvaluacion.get(porNivel[n.id])?.totalPreguntas} preguntas)</span></li>
                  ))}
                  {niveles.flatMap((n) => n.excepciones.filter((ex) => porPuesto[ex.puestoId]).map((ex) => (
                    <li key={ex.puestoId}>Excepción · {ex.puesto}: {nombreEvaluacion.get(porPuesto[ex.puestoId])?.nombre}</li>
                  )))}
                  {nivelesSinEvaluar.length > 0 && <li className="text-gris">Sin evaluar: {nivelesSinEvaluar.map((n) => n.nombre).join(', ')}</li>}
                </ul>
              </li>
              <li><b>Modalidades y ponderaciones:</b> se toma una foto de la configuración vigente al crear el ciclo.</li>
            </ul>
            <p className="rounded-xl bg-hueso-2 px-4 py-2.5 text-xs text-gris">{edicion ? <>Al guardar, las preguntas se vuelven a copiar del catálogo y la <b>verificación de lanzamiento</b> se recalcula.</> : <>El ciclo se crea en estado <b>Borrador</b>. Desde su detalle podrás asignar pares y <b>lanzarlo</b> (genera las evaluaciones y notifica al equipo).</>}</p>
          </div>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-alerta-dark">{error}</p>}

      {/* El mensaje «Falta:» va a lo ancho ENCIMA de los botones; los dos botones quedan
          alineados en una fila (Anterior a la izquierda, Siguiente/Crear a la derecha). */}
      <div className="space-y-2">
        {!puedeAvanzar && paso === 1 && (
          <p className="text-xs text-gris">
            Falta: {[
              nombre.trim().length < 4 ? 'nombre (mín. 4 letras)' : null,
              !fechaInicio ? 'fecha de inicio' : null,
              !fechaFin ? 'fecha de fin' : null,
              conObjetivos && periodoId === '' ? 'período de objetivos' : null,
            ].filter(Boolean).join(', ')}
          </p>
        )}
        {!puedeAvanzar && paso === 3 && <p className="text-xs text-gris">Falta: elegir al menos una evaluación</p>}
        <div className="flex items-center justify-between gap-2">
          <button type="button" disabled={paso === 1} onClick={() => setPaso((p) => p - 1)} className="rounded-xl border border-gris-claro bg-white px-4 py-2.5 text-[13px] font-bold transition hover:bg-hueso disabled:opacity-40">
            ← Anterior
          </button>
          {paso < 4 ? (
            <button type="button" disabled={!puedeAvanzar} onClick={() => setPaso((p) => { const n = p + 1; setMaxPaso((m) => Math.max(m, n)); return n })} className="rounded-xl bg-marca px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark disabled:opacity-50">
              Siguiente →
            </button>
          ) : (
            <button type="button" disabled={pendiente} onClick={crear} className="rounded-xl bg-marca px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark disabled:opacity-60">
              {pendiente ? (edicion ? 'Guardando…' : 'Creando…') : edicion ? 'Guardar cambios ✓' : 'Crear ciclo ✓'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
