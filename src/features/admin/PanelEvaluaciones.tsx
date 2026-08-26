'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Zap, Pencil, Trash2, ListChecks, AlertTriangle, Search, Archive, ArchiveRestore } from 'lucide-react'
import { crearEvaluacion, editarEvaluacion, eliminarEvaluacion, alternarEvaluacion, guardarPreguntasEvaluacion, guardarPotencialEvaluacion, type Modalidad } from './acciones'
import { ETIQUETA_MODALIDAD } from './FormPregunta'
import { Modal } from '@/shared/ui/Modal'
import { toast } from '@/shared/ui/Toast'
import { confirmar } from '@/shared/ui/Confirmacion'

type Preg = { id: string; texto: string; modalidades: string[] }
type Comp = { id: string; nombre: string; preguntas: Preg[] }
type Dim = { id: string; nombre: string; competencias: Comp[] }
type PuestoW = {
  id: string; nombre: string; competenciaIds: string[]
  colaboradores: number
  lidera: boolean // sus titulares tienen subordinados activos (solo entonces aplica la ascendente)
  pesos: { dimensionId: string; peso: number }[]
}
type NivelW = { id: string; nombre: string; puestos: PuestoW[] }
type Ev = {
  id: string; nombre: string; descripcion: string | null; activa: boolean
  nivelId: string | null; puestoId: string | null
  preguntas: { preguntaId: string; modalidad: string }[]
  potencialIds: string[] // preguntas de potencial que aplica (las responde solo el jefe)
  ciclos: number // ciclos (vigentes o históricos) que la aplicaron; >0 bloquea la eliminación
}
type PotencialDisponible = { id: string; texto: string }

const MODALIDADES: Modalidad[] = ['JEFE', 'PAR', 'ASCENDENTE', 'AUTO']
const inputCls = 'w-full rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none focus:border-hunter'
const btnRojo = 'rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:opacity-60'

/** Puestos que caen dentro del alcance de una evaluación (los del nivel, o el puesto de la excepción). */
function puestosDelAlcance(ev: Pick<Ev, 'nivelId' | 'puestoId'>, niveles: NivelW[]): PuestoW[] {
  if (ev.puestoId) {
    const p = niveles.flatMap((n) => n.puestos).find((p) => p.id === ev.puestoId)
    return p ? [p] : []
  }
  return niveles.find((n) => n.id === ev.nivelId)?.puestos ?? []
}

function competenciaDePregunta(dimensiones: Dim[]) {
  const m = new Map<string, string>()
  for (const d of dimensiones) for (const c of d.competencias) for (const p of c.preguntas) m.set(p.id, c.id)
  return m
}

export function PanelEvaluaciones({ evaluaciones, dimensiones, niveles, potencial, puedeGestionar }: {
  evaluaciones: Ev[]
  dimensiones: Dim[]
  niveles: NivelW[]
  potencial: PotencialDisponible[]
  puedeGestionar: boolean
}) {
  const router = useRouter()
  const [editando, setEditando] = useState<Ev | null>(null)
  const [modal, setModal] = useState<{ modo: 'crear' } | { modo: 'renombrar'; ev: Ev } | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [alcance, setAlcance] = useState<'nivel' | 'puesto'>('nivel')
  const [pendiente, startTransition] = useTransition()

  const compDePreg = useMemo(() => competenciaDePregunta(dimensiones), [dimensiones])

  if (editando) {
    return (
      <EditorPreguntas
        evaluacion={editando}
        dimensiones={dimensiones}
        niveles={niveles}
        potencial={potencial}
        onVolver={() => { setEditando(null); router.refresh() }}
      />
    )
  }

  function guardarNombre(formData: FormData) {
    setAviso(null)
    startTransition(async () => {
      const res = modal?.modo === 'renombrar'
        ? await editarEvaluacion(modal.ev.id, formData)
        : await crearEvaluacion(formData)
      if (!res.ok) { setAviso(res.error); return }
      setModal(null)
      toast(modal?.modo === 'renombrar' ? 'Evaluación actualizada' : 'Evaluación creada')
      router.refresh()
    })
  }

  const nombrePuesto = new Map(niveles.flatMap((n) => n.puestos.map((p) => [p.id, p.nombre] as const)))

  return (
    <div className="space-y-4">
      {/* Móvil: texto a lo ancho y botón debajo — al costado, el texto quedaba en una
          columna angosta contra el botón. Escritorio: la fila de siempre. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-gris">Cada evaluación pertenece a un <b>nivel jerárquico</b> (vía rápida) o a un <b>puesto</b> (excepción que reemplaza a la del nivel). Dentro del alcance, cada colaborador responde solo las preguntas de las competencias de su puesto.</p>
        {puedeGestionar && (
          <button onClick={() => { setAviso(null); setAlcance('nivel'); setModal({ modo: 'crear' }) }} className={`w-full shrink-0 md:w-auto ${btnRojo}`}>
            ＋ Nueva evaluación
          </button>
        )}
      </div>

      {niveles.map((nivel) => {
        const delNivel = evaluaciones.filter((e) => e.activa && e.nivelId === nivel.id)
        const excepciones = evaluaciones.filter((e) => e.activa && e.puestoId && nivel.puestos.some((p) => p.id === e.puestoId))
        const enUso = new Set(nivel.puestos.flatMap((p) => p.competenciaIds))
        return (
          <div key={nivel.id}>
            <div className="mb-2 mt-4 flex items-baseline gap-3">
              <h3 className="font-display text-[15px] font-bold">{nivel.nombre}</h3>
              <span className="text-xs text-gris">{nivel.puestos.length} puesto{nivel.puestos.length === 1 ? '' : 's'} · {enUso.size} competencias en uso</span>
            </div>
            {delNivel.length + excepciones.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-gris-claro bg-white/60 px-4 py-5 text-center text-sm text-gris">
                Sin evaluación para este nivel todavía.
              </p>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {[...delNivel, ...excepciones].map((ev) => {
                  const puestos = puestosDelAlcance(ev, niveles)
                  const enUsoEv = new Set(puestos.flatMap((p) => p.competenciaIds))
                  const cubiertas = new Set(
                    ev.preguntas.filter((p) => p.modalidad === 'JEFE').map((p) => compDePreg.get(p.preguntaId)).filter((c): c is string => c !== undefined && enUsoEv.has(c)),
                  )
                  const porModalidad = [...MODALIDADES.map((m) => `${ETIQUETA_MODALIDAD[m]} ${ev.preguntas.filter((p) => p.modalidad === m).length}`), `Potencial ${ev.potencialIds.length}`].join(' · ')
                  return (
                    <li key={ev.id} className="group flex flex-col rounded-2xl border border-gris-claro bg-white p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-display text-sm font-bold">{ev.nombre}</p>
                          {ev.puestoId && <span className="mt-0.5 inline-block rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">Excepción · {nombrePuesto.get(ev.puestoId)}</span>}
                          {ev.descripcion && <p className="mt-0.5 text-xs text-gris">{ev.descripcion}</p>}
                        </div>
                        <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700">Activa</span>
                      </div>
                      <p className="mb-4 mt-3 text-xs text-gris">
                        <ListChecks size={13} className="mr-1 inline -translate-y-px" />
                        {porModalidad} · Jefe cubre {cubiertas.size} de {enUsoEv.size} competencias
                      </p>
                      {puedeGestionar && (
                        <div className="mt-auto flex items-center gap-2 border-t border-gris-claro pt-3">
                          <button onClick={() => setEditando(ev)} className="flex-1 rounded-lg bg-hunter/10 px-3 py-2 text-xs font-bold text-hunter-dark transition hover:bg-hunter/20">
                            Editar preguntas →
                          </button>
                          {/* Móvil: siempre visibles (el hover no existe en táctil y no había forma
                              de renombrar/archivar/eliminar). Escritorio: se revelan al acercarse. */}
                          <span className="flex items-center gap-2 md:max-w-0 md:overflow-hidden md:opacity-0 md:transition-all md:duration-200 md:group-hover:max-w-40 md:group-hover:opacity-100 md:group-focus-within:max-w-40 md:group-focus-within:opacity-100">
                          <button onClick={() => { setAviso(null); setModal({ modo: 'renombrar', ev }) }} title="Renombrar" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-gris transition hover:bg-hueso hover:text-negro"><Pencil size={14} /></button>
                          <button
                            onClick={async () => {
                              if (!(await confirmar(`¿Archivar "${ev.nombre}"? Saldrá de esta lista y de los ciclos nuevos; podrás reactivarla desde Archivadas.`, { titulo: 'Archivar evaluación', textoAceptar: 'Archivar' }))) return
                              startTransition(async () => { await alternarEvaluacion(ev.id, false); toast('Evaluación archivada'); router.refresh() })
                            }}
                            title="Archivar" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-gris transition hover:bg-hueso hover:text-negro"><Archive size={14} /></button>
                          <button
                            onClick={async () => {
                              if (!(await confirmar(`¿Eliminar la evaluación "${ev.nombre}"? Esta acción no se puede deshacer.`, { titulo: 'Eliminar evaluación', textoAceptar: 'Eliminar' }))) return
                              startTransition(async () => { const r = await eliminarEvaluacion(ev.id); if (r.ok) { toast('Evaluación eliminada') } else { toast(r.error) } router.refresh() })
                            }}
                            title="Eliminar (solo si nunca se usó en un ciclo)" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-gris transition hover:bg-red-50 hover:text-hunter"><Trash2 size={14} /></button>
                          </span>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}

      {evaluaciones.some((e) => !e.activa) && (
        <details className="rounded-2xl border border-gris-claro bg-hueso/60 px-5 py-4">
          <summary className="cursor-pointer text-sm font-bold text-gris">
            🗄 Evaluaciones archivadas ({evaluaciones.filter((e) => !e.activa).length}) — deprecadas; los ciclos que las usaron conservan su historia
          </summary>
          <ul className="mt-3 space-y-2">
            {evaluaciones.filter((e) => !e.activa).map((ev) => (
              <li key={ev.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gris-claro bg-white px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{ev.nombre}
                    {ev.puestoId && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Excepción · {nombrePuesto.get(ev.puestoId)}</span>}
                    {!ev.puestoId && !ev.nivelId && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-hunter-dark">sin alcance</span>}
                  </p>
                  <p className="text-[11px] text-gris">{ev.preguntas.length} pregunta{ev.preguntas.length === 1 ? '' : 's'} · usada en {ev.ciclos} ciclo{ev.ciclos === 1 ? '' : 's'}</p>
                </div>
                {puedeGestionar && (
                  <button
                    onClick={() => startTransition(async () => { await alternarEvaluacion(ev.id, true); toast('Evaluación reactivada'); router.refresh() })}
                    className="flex items-center gap-1.5 rounded-lg border border-gris-claro px-3 py-1.5 text-[12px] font-bold text-negro transition hover:bg-hueso"
                  ><ArchiveRestore size={13} /> Reactivar</button>
                )}
                {puedeGestionar && ev.ciclos === 0 && (
                  <button
                    onClick={async () => {
                      if (!(await confirmar(`¿Eliminar la evaluación "${ev.nombre}"? Esta acción no se puede deshacer.`, { titulo: 'Eliminar evaluación', textoAceptar: 'Eliminar' }))) return
                      startTransition(async () => { const r = await eliminarEvaluacion(ev.id); if (r.ok) { toast('Evaluación eliminada') } else { toast(r.error) } router.refresh() })
                    }}
                    title="Eliminar" className="grid h-8 w-8 place-items-center rounded-lg text-gris transition hover:bg-red-50 hover:text-hunter"><Trash2 size={14} /></button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Modal titulo={modal?.modo === 'renombrar' ? 'Renombrar evaluación' : 'Nueva evaluación'} abierto={modal !== null} onCerrar={() => setModal(null)}>
        <form action={guardarNombre} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gris">Nombre</span>
            <input name="nombre" required autoFocus defaultValue={modal?.modo === 'renombrar' ? modal.ev.nombre : ''} placeholder="Ej: Evaluación Mando Medio 2026" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gris">Descripción (opcional)</span>
            <input name="descripcion" defaultValue={modal?.modo === 'renombrar' ? (modal.ev.descripcion ?? '') : ''} placeholder="Anual · competencias por puesto" className={inputCls} />
          </label>
          {modal?.modo === 'crear' && (
            <div>
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gris">Alcance</span>
              <div className="mb-2 flex gap-2">
                <label className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[13px] ${alcance === 'nivel' ? 'border-hunter/50 bg-red-50/40' : 'border-gris-claro'}`}>
                  <input type="radio" checked={alcance === 'nivel'} onChange={() => setAlcance('nivel')} className="h-4 w-4 accent-[#f0163e]" />
                  Nivel jerárquico <span className="text-[11px] text-gris">(vía rápida)</span>
                </label>
                <label className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[13px] ${alcance === 'puesto' ? 'border-hunter/50 bg-red-50/40' : 'border-gris-claro'}`}>
                  <input type="radio" checked={alcance === 'puesto'} onChange={() => setAlcance('puesto')} className="h-4 w-4 accent-[#f0163e]" />
                  Puesto <span className="text-[11px] text-gris">(excepción)</span>
                </label>
              </div>
              {alcance === 'nivel' ? (
                <select name="nivelId" required className={inputCls}>
                  <option value="">Nivel…</option>
                  {niveles.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
                </select>
              ) : (
                <select name="puestoId" required className={inputCls}>
                  <option value="">Puesto…</option>
                  {niveles.flatMap((n) => n.puestos.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({n.nombre})</option>))}
                </select>
              )}
              {alcance === 'puesto' && <p className="mt-1 text-[11px] text-gris">La evaluación de puesto reemplaza por completo a la del nivel para ese puesto en el ciclo.</p>}
            </div>
          )}
          {aviso && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-hunter-dark">{aviso}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={() => setModal(null)} className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">Cancelar</button>
            <button disabled={pendiente} className={btnRojo}>
              {pendiente ? 'Guardando…' : modal?.modo === 'renombrar' ? 'Guardar' : 'Crear evaluación →'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

// ───────────── Editor: solo seleccionadas + modal de selección, por modalidad ─────────────

function EditorPreguntas({ evaluacion, dimensiones, niveles, potencial, onVolver }: {
  evaluacion: Ev
  dimensiones: Dim[]
  niveles: NivelW[]
  potencial: PotencialDisponible[]
  onVolver: () => void
}) {
  const [vista, setVista] = useState<'preguntas' | 'metricas'>('preguntas')
  const [modalidad, setModalidad] = useState<Modalidad | 'POTENCIAL'>('JEFE')
  const [seleccionPotencial, setSeleccionPotencial] = useState<Set<string>>(() => new Set(evaluacion.potencialIds))
  const [seleccion, setSeleccion] = useState<Record<Modalidad, Set<string>>>(() => {
    const base = Object.fromEntries(MODALIDADES.map((m) => [m, new Set<string>()])) as Record<Modalidad, Set<string>>
    for (const p of evaluacion.preguntas) base[p.modalidad as Modalidad]?.add(p.preguntaId)
    return base
  })
  const [selector, setSelector] = useState<Comp | null>(null) // modal de selección abierto para una competencia
  const [pendiente, startTransition] = useTransition()

  const puestos = useMemo(() => puestosDelAlcance(evaluacion, niveles), [evaluacion, niveles])
  const enUso = useMemo(() => new Set(puestos.flatMap((p) => p.competenciaIds)), [puestos])
  const nombreAlcance = evaluacion.puestoId
    ? `puesto ${puestos[0]?.nombre ?? ''}`
    : `nivel ${niveles.find((n) => n.id === evaluacion.nivelId)?.nombre ?? ''}`

  // En la pestaña Potencial no hay competencias: los cálculos de abajo usan la última modalidad real
  const modAsig: Modalidad = modalidad === 'POTENCIAL' ? 'JEFE' : modalidad

  // Competencias visibles para la modalidad activa: las del alcance (o, en ascendente, todas las que tengan preguntas ascendentes)
  const conPregunta = (c: Comp) => c.preguntas.some((p) => p.modalidades.includes(modAsig))
  const dimensionesVisibles = dimensiones
    .map((d) => ({ ...d, competencias: d.competencias.filter((c) => (modalidad === 'ASCENDENTE' ? conPregunta(c) : enUso.has(c.id))) }))
    .filter((d) => d.competencias.length > 0)
  const fueraDeAlcance = modalidad === 'ASCENDENTE' ? [] : dimensiones
    .map((d) => ({ ...d, competencias: d.competencias.filter((c) => !enUso.has(c.id) && conPregunta(c)) }))
    .filter((d) => d.competencias.length > 0)

  const sel = seleccion[modAsig]
  const totales = [...MODALIDADES.map((m) => ({ m: ETIQUETA_MODALIDAD[m], n: seleccion[m].size })), { m: 'Potencial', n: seleccionPotencial.size }]

  // Cobertura en Jefe (define la nota principal y bloquea el lanzamiento del ciclo) y Auto
  // (mismo cuestionario autocalificado): competencias sin pregunta, AGRUPADAS por competencia —
  // 50 puestos con el mismo hueco son una sola fila, no cincuenta.
  const compDePreg = useMemo(() => competenciaDePregunta(dimensiones), [dimensiones])
  const huecos = useMemo(() => {
    if (modalidad !== 'JEFE' && modalidad !== 'AUTO') return []
    const cubiertas = new Set([...seleccion[modalidad]].map((id) => compDePreg.get(id)))
    const nombreComp = new Map(dimensiones.flatMap((d) => d.competencias.map((c) => [c.id, c.nombre] as const)))
    const porComp = new Map<string, string[]>()
    for (const p of puestos) {
      for (const c of p.competenciaIds) {
        if (cubiertas.has(c)) continue
        const nombre = nombreComp.get(c) ?? c
        porComp.set(nombre, [...(porComp.get(nombre) ?? []), p.nombre])
      }
    }
    return [...porComp.entries()]
      .map(([competencia, afectados]) => ({ competencia, puestos: afectados }))
      .sort((a, b) => b.puestos.length - a.puestos.length)
  }, [modalidad, seleccion, puestos, compDePreg, dimensiones])

  // En Pares la cobertura parcial es INTENCIONAL (el manual los acota a Operativa y Liderazgo):
  // solo avisa si un puesto queda sin NINGUNA pregunta — sus pares no tendrían nada que responder
  // y el peso de la modalidad se redistribuye.
  const paresSinPreguntas = useMemo(() => {
    if (modalidad !== 'PAR') return []
    const cubiertas = new Set([...seleccion.PAR].map((id) => compDePreg.get(id)))
    return puestos.filter((p) => !p.competenciaIds.some((c) => cubiertas.has(c))).map((p) => p.nombre)
  }, [modalidad, seleccion, puestos, compDePreg])

  const alternar = (preguntaId: string) => setSeleccion((s) => {
    const nuevo = new Set(s[modAsig])
    if (nuevo.has(preguntaId)) nuevo.delete(preguntaId); else nuevo.add(preguntaId)
    return { ...s, [modAsig]: nuevo }
  })

  // Recomendadas de la modalidad: Jefe/Auto = competencias del alcance; Pares = solo Operativa y Liderazgo (manual); Ascendente = todas las ascendentes
  const recomendar = () => {
    if (modalidad === 'POTENCIAL') {
      setSeleccionPotencial(new Set(potencial.map((p) => p.id)))
      return
    }
    const ids = dimensiones.flatMap((d) =>
      d.competencias
        .filter((c) => (modalidad === 'ASCENDENTE' ? true : enUso.has(c.id)))
        .filter(() => modalidad !== 'PAR' || /Operativa|Liderazgo/i.test(d.nombre))
        .flatMap((c) => c.preguntas.filter((p) => p.modalidades.includes(modalidad)).map((p) => p.id)),
    )
    setSeleccion((s) => ({ ...s, [modalidad]: new Set(ids) }))
  }

  function guardar() {
    const lista = MODALIDADES.flatMap((m) => [...seleccion[m]].map((preguntaId) => ({ preguntaId, modalidad: m })))
    startTransition(async () => {
      const [res, resPot] = await Promise.all([
        guardarPreguntasEvaluacion(evaluacion.id, lista),
        guardarPotencialEvaluacion(evaluacion.id, [...seleccionPotencial]),
      ])
      if (res.ok && resPot.ok) { toast(`Preguntas guardadas (${res.total} + ${resPot.total} de potencial)`); onVolver() }
    })
  }

  const renderCompetencia = (d: Dim, c: Comp, atenuada: boolean) => {
    const seleccionadas = c.preguntas.filter((p) => p.modalidades.includes(modAsig) && sel.has(p.id))
    const disponibles = c.preguntas.filter((p) => p.modalidades.includes(modAsig) && !sel.has(p.id))
    const usos = puestos.filter((p) => p.competenciaIds.includes(c.id)).length
    let indice = 0
    return (
      <div key={c.id} className={atenuada ? 'opacity-60' : ''}>
        <p className="mb-1.5 text-xs font-semibold text-negro/70">
          {d.nombre} · <b>{c.nombre}</b>
          {usos > 0
            ? <span className="ml-2 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">{usos} puesto{usos === 1 ? '' : 's'}</span>
            : modalidad !== 'ASCENDENTE' && <span className="ml-2 rounded-full bg-hueso-2 px-2 py-0.5 text-[10px] font-bold text-gris">fuera del alcance</span>}
        </p>
        {seleccionadas.length === 0 ? (
          <p className="mb-2 rounded-xl border border-dashed border-gris-claro px-3.5 py-2.5 text-[12.5px] text-gris">
            Sin preguntas en el formulario.
            <button type="button" onClick={() => setSelector(c)} className="ml-2 font-bold text-hunter hover:underline">＋ Agregar del banco{disponibles.length > 0 ? ` (${disponibles.length})` : ''}</button>
          </p>
        ) : (
          <>
            <ul className="mb-1.5 space-y-1.5">
              {seleccionadas.map((p) => {
                indice += 1
                return (
                  <li key={p.id} className="flex items-start gap-2.5 rounded-xl border border-hunter/30 bg-red-50/40 px-3.5 py-2 text-[13px]">
                    <span className="mt-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-hunter text-[10px] font-bold text-white">{indice}</span>
                    <span className="min-w-0 flex-1">{p.texto}</span>
                    <button type="button" onClick={() => alternar(p.id)} title="Quitar del formulario" className="shrink-0 px-1 font-bold text-gris transition hover:text-hunter">✕</button>
                  </li>
                )
              })}
            </ul>
            <button type="button" onClick={() => setSelector(c)} className="mb-2 rounded-xl border border-dashed border-hunter/40 px-3.5 py-1.5 text-[12px] font-bold text-hunter-dark transition hover:bg-red-50/40">
              ＋ Agregar del banco{disponibles.length > 0 ? ` (${disponibles.length} disponibles)` : ' (crear nuevas en la pestaña Banco)'}
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={onVolver} className="text-sm text-gris transition hover:text-negro">← Volver a evaluaciones</button>
          <h3 className="mt-1 font-display text-lg font-bold">
            {evaluacion.nombre} <span className="text-sm font-normal text-gris">· {nombreAlcance} · {totales.map((t) => `${t.m} ${t.n}`).join(' · ')}</span>
          </h3>
        </div>
        <button disabled={pendiente} onClick={guardar} className={btnRojo}>
          {pendiente ? 'Guardando…' : 'Guardar preguntas ✓'}
        </button>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setVista('preguntas')}
          className={`rounded-xl px-4 py-2 text-[13px] font-bold transition ${vista === 'preguntas' ? 'bg-hunter text-white shadow-md shadow-hunter/30' : 'border border-gris-claro bg-white text-gris hover:text-negro'}`}
        >
          ✏️ Preguntas
        </button>
        <button
          onClick={() => setVista('metricas')}
          className={`rounded-xl px-4 py-2 text-[13px] font-bold transition ${vista === 'metricas' ? 'bg-hunter text-white shadow-md shadow-hunter/30' : 'border border-gris-claro bg-white text-gris hover:text-negro'}`}
        >
          📊 Métricas del formulario
        </button>
      </div>

      {vista === 'metricas' && (
        <MetricasFormulario
          evaluacion={evaluacion}
          seleccion={seleccion}
          dimensiones={dimensiones}
          puestos={puestos}
          onAgregarPreguntas={(c, m) => { setModalidad(m); setSelector(c) }}
        />
      )}

      <div className={vista === 'preguntas' ? 'space-y-5 rounded-2xl border border-gris-claro bg-white p-5' : 'hidden'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {MODALIDADES.map((m) => (
              <button
                key={m}
                onClick={() => setModalidad(m)}
                className={`rounded-full px-3.5 py-1.5 text-[12px] font-bold transition ${modalidad === m ? 'bg-hunter text-white' : 'bg-hueso-2 text-gris hover:text-negro'}`}
              >
                {ETIQUETA_MODALIDAD[m]} · {seleccion[m].size}
              </button>
            ))}
            <button
              onClick={() => setModalidad('POTENCIAL')}
              className={`rounded-full px-3.5 py-1.5 text-[12px] font-bold transition ${modalidad === 'POTENCIAL' ? 'bg-hunter text-white' : 'bg-hueso-2 text-gris hover:text-negro'}`}
            >
              📈 Potencial · {seleccionPotencial.size}
            </button>
          </div>
          <button type="button" onClick={recomendar} className="shrink-0 text-xs font-bold text-hunter hover:underline">
            <Zap size={12} className="inline -translate-y-px" /> Usar recomendadas ({modalidad === 'POTENCIAL' ? 'Potencial' : ETIQUETA_MODALIDAD[modalidad]})
          </button>
        </div>

        <p className="rounded-xl bg-red-50/60 px-4 py-2.5 text-[12.5px] text-hunter-dark">
          {modalidad === 'JEFE' && <>Preguntas que responde el <b>jefe directo</b> sobre cada colaborador. Cada evaluado ve solo las de las competencias de su puesto.</>}
          {modalidad === 'PAR' && <>Preguntas que responden los <b>pares</b>. El manual sugiere limitarlas a las dimensiones Operativa y Liderazgo (así las marca &ldquo;Usar recomendadas&rdquo;).</>}
          {modalidad === 'ASCENDENTE' && <>Preguntas que responde el <b>equipo sobre su jefe</b> (&ldquo;Mi jefe…&rdquo;). El evaluado es el jefe: por eso se configuran aquí, en el formulario del alcance del jefe, y las responde su equipo venga del puesto que venga, sin filtro.</>}
          {modalidad === 'AUTO' && <>Preguntas de la <b>autoevaluación</b> (misma redacción, el colaborador se califica a sí mismo). El manual le da 0% de peso el primer año: es referencial.</>}
          {modalidad === 'POTENCIAL' && <>Preguntas de <b>potencial</b>: las responde solo el jefe y definen el <b>eje vertical del 9-Box</b>. No pertenecen a competencias y nunca se mezclan con la nota de desempeño. Se crean en la pestaña Banco de preguntas.</>}
        </p>

        {puestos.length > 0 && modalidad !== 'ASCENDENTE' && (
          // Con pocos puestos los chips se muestran directo; con muchos (81 en un nivel grande)
          // la lista se resume a una línea expandible
          puestos.length <= 8 ? (
            <div className="text-xs text-gris">
              Alcance: {puestos.map((p) => (
                <span key={p.id} className="mr-1.5 inline-block rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700">{p.nombre}</span>
              ))}
            </div>
          ) : (
            <details className="text-xs text-gris">
              <summary className="cursor-pointer select-none">
                Alcance: <b>{puestos.length} puestos</b> de {nombreAlcance} <span className="text-gris/70">(ver lista)</span>
              </summary>
              <div className="mt-1.5">
                {puestos.map((p) => (
                  <span key={p.id} className="mr-1.5 mt-1 inline-block rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700">{p.nombre}</span>
                ))}
              </div>
            </details>
          )
        )}

        {huecos.length > 0 && (
          <details className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <summary className="cursor-pointer select-none text-xs font-bold text-amber-800">
              <AlertTriangle size={13} className="mr-1 inline -translate-y-px" />
              Cobertura incompleta: {huecos.length === 1 ? '1 competencia' : `${huecos.length} competencias`} sin ninguna pregunta seleccionada
              {' '}· afecta a {new Set(huecos.flatMap((h) => h.puestos)).size} puesto{new Set(huecos.flatMap((h) => h.puestos)).size === 1 ? '' : 's'}
              <span className="ml-1 font-normal text-amber-800/70">(ver detalle)</span>
            </summary>
            <ul className="mt-2 space-y-1.5 text-xs text-amber-800/90">
              {huecos.map((h) => (
                <li key={h.competencia}>
                  <b>{h.competencia}</b> — {h.puestos.length === puestos.length
                    ? `falta en los ${puestos.length} puestos del alcance`
                    : <>falta en {h.puestos.length} puesto{h.puestos.length === 1 ? '' : 's'}: {h.puestos.join(' · ')}</>}
                </li>
              ))}
            </ul>
          </details>
        )}

        {paresSinPreguntas.length > 0 && (
          <details className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <summary className="cursor-pointer select-none text-xs font-bold text-amber-800">
              <AlertTriangle size={13} className="mr-1 inline -translate-y-px" />
              {paresSinPreguntas.length === 1 ? '1 puesto quedaría' : `${paresSinPreguntas.length} puestos quedarían`} sin ninguna pregunta de pares
              <span className="ml-1 font-normal text-amber-800/70">(ver detalle)</span>
            </summary>
            <p className="mt-2 text-xs text-amber-800/90">
              Sus pares no tendrían nada que responder y el peso de la modalidad se redistribuye: {paresSinPreguntas.join(' · ')}
            </p>
          </details>
        )}

        {modalidad === 'POTENCIAL' ? (
          potencial.length === 0 ? (
            <p className="rounded-xl bg-hueso px-4 py-6 text-center text-sm text-gris">
              No hay preguntas de potencial en el banco. Créalas en la pestaña <b>Banco de preguntas → Preguntas de potencial</b>.
            </p>
          ) : (
            <ul className="grid gap-1.5 md:grid-cols-2">
              {potencial.map((p) => {
                const activa = seleccionPotencial.has(p.id)
                return (
                  <li key={p.id}>
                    <label className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 text-[13px] transition ${activa ? 'border-hunter/40 bg-red-50/40' : 'border-gris-claro hover:bg-hueso'}`}>
                      <input
                        type="checkbox" checked={activa}
                        onChange={() => setSeleccionPotencial((sp) => { const n = new Set(sp); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n })}
                        className="mt-0.5 h-4 w-4 accent-[#f0163e]"
                      />
                      <span>{p.texto}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )
        ) : dimensionesVisibles.length === 0 ? (
          <p className="rounded-xl bg-hueso px-4 py-6 text-center text-sm text-gris">
            No hay preguntas en el banco para esta modalidad. Créalas en la pestaña <b>Banco de preguntas</b>.
          </p>
        ) : (
          <div className="space-y-4">
            {dimensionesVisibles.map((d) => d.competencias.map((c) => renderCompetencia(d, c, false)))}
          </div>
        )}

        {modalidad !== 'POTENCIAL' && fueraDeAlcance.length > 0 && (
          <details className="rounded-xl border border-gris-claro bg-hueso/60 px-4 py-3">
            <summary className="cursor-pointer text-xs font-bold text-gris">Competencias fuera del alcance ({fueraDeAlcance.reduce((a, d) => a + d.competencias.length, 0)}) — agregar solo si quieres medir algo extra al perfil de los puestos</summary>
            <div className="mt-3 space-y-4">
              {fueraDeAlcance.map((d) => d.competencias.map((c) => renderCompetencia(d, c, true)))}
            </div>
          </details>
        )}
      </div>

      <SelectorPreguntas
        competencia={selector}
        modalidad={modAsig}
        seleccionadas={sel}
        onAplicar={(idsCompetencia) => {
          if (!selector) return
          setSeleccion((s) => {
            const nuevo = new Set(s[modAsig])
            for (const p of selector.preguntas.filter((p) => p.modalidades.includes(modAsig))) nuevo.delete(p.id)
            for (const id of idsCompetencia) nuevo.add(id)
            return { ...s, [modalidad]: nuevo }
          })
          setSelector(null)
        }}
        onCerrar={() => setSelector(null)}
      />
    </div>
  )
}

/** Métricas en vivo del formulario (sobre la selección actual, guardada o no):
 * veredicto global → competencias sin cubrir (transversal) → accordion por puesto con su ficha,
 * inspeccionable por modalidad (los conteos de la fila son botones). */
function MetricasFormulario({ evaluacion, seleccion, dimensiones, puestos, onAgregarPreguntas }: {
  evaluacion: Ev
  seleccion: Record<Modalidad, Set<string>>
  dimensiones: Dim[]
  puestos: PuestoW[]
  onAgregarPreguntas: (c: Comp, m: Modalidad) => void
}) {
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const [modalidadFicha, setModalidadFicha] = useState<Record<string, Modalidad>>({})

  const compDePreg = useMemo(() => competenciaDePregunta(dimensiones), [dimensiones])
  const compPorId = useMemo(() => new Map(dimensiones.flatMap((d) => d.competencias.map((c) => [c.id, c] as const))), [dimensiones])
  const dimDeComp = useMemo(() => new Map(dimensiones.flatMap((d) => d.competencias.map((c) => [c.id, d] as const))), [dimensiones])

  // Preguntas seleccionadas por competencia, por modalidad
  const preguntasPorComp = useMemo(() => {
    const porModalidad = new Map<Modalidad, Map<string, number>>()
    for (const m of MODALIDADES) {
      const mapa = new Map<string, number>()
      for (const id of seleccion[m]) {
        const c = compDePreg.get(id)
        if (c) mapa.set(c, (mapa.get(c) ?? 0) + 1)
      }
      porModalidad.set(m, mapa)
    }
    return porModalidad
  }, [seleccion, compDePreg])
  const nPreguntas = (m: Modalidad, compId: string) => preguntasPorComp.get(m)?.get(compId) ?? 0

  const totalColaboradores = puestos.reduce((a, p) => a + p.colaboradores, 0)

  // Ficha por puesto: cuestionario efectivo por modalidad, huecos (Jefe) y dimensiones con SU peso real
  const porPuesto = useMemo(() => puestos.map((p) => {
    const comps = new Set(p.competenciaIds)
    const efectivo = (m: Modalidad) => [...seleccion[m]].filter((id) => comps.has(compDePreg.get(id) ?? '')).length
    const faltan = p.competenciaIds.filter((c) => (preguntasPorComp.get('JEFE')?.get(c) ?? 0) === 0)
    const porDimension = dimensiones
      .map((d) => {
        const compsDim = d.competencias.filter((c) => comps.has(c.id))
        const peso = p.pesos.find((w) => w.dimensionId === d.id)?.peso ?? 0
        return { id: d.id, nombre: d.nombre, competencias: compsDim, peso }
      })
      .filter((d) => d.competencias.length > 0 || d.peso > 0)
    return { ...p, jefe: efectivo('JEFE'), par: efectivo('PAR'), auto: efectivo('AUTO'), faltan, porDimension }
  }), [puestos, seleccion, compDePreg, preguntasPorComp, dimensiones])

  // Orden: puestos con huecos primero
  const ordenados = [...porPuesto].sort((a, b) => (b.faltan.length > 0 ? 1 : 0) - (a.faltan.length > 0 ? 1 : 0) || a.nombre.localeCompare(b.nombre))
  const puestosConHuecos = porPuesto.filter((p) => p.faltan.length > 0)

  // Transversal: competencias en uso sin pregunta (Jefe), ordenadas por nº de puestos afectados
  const sinCubrir = useMemo(() => {
    const afectados = new Map<string, PuestoW[]>()
    for (const p of puestos) for (const c of p.competenciaIds) {
      if ((preguntasPorComp.get('JEFE')?.get(c) ?? 0) === 0) afectados.set(c, [...(afectados.get(c) ?? []), p])
    }
    return [...afectados.entries()]
      .map(([compId, pts]) => ({ comp: compPorId.get(compId), dimension: dimDeComp.get(compId)?.nombre ?? '', puestos: pts }))
      .filter((x): x is { comp: Comp; dimension: string; puestos: PuestoW[] } => x.comp !== undefined)
      .sort((a, b) => b.puestos.length - a.puestos.length)
  }, [puestos, preguntasPorComp, compPorId, dimDeComp])

  // Descuadres del catálogo de puestos: dimensiones que pesan pero no tienen competencias (o al revés).
  // No se arreglan en este formulario: el peso queda sin nada que lo mida (o se pregunta lo que no puntúa).
  const descuadresCatalogo = useMemo(() => porPuesto.flatMap((p) =>
    p.porDimension
      .filter((d) => (d.peso > 0 && d.competencias.length === 0) || (d.peso === 0 && d.competencias.length > 0))
      .map((d) => ({ puesto: p.nombre, dimension: d.nombre, peso: d.peso, sinCompetencias: d.competencias.length === 0 })),
  ), [porPuesto])

  const abrirEn = (puestoId: string, m: Modalidad) => {
    setModalidadFicha((s) => ({ ...s, [puestoId]: m }))
    setAbiertos((s) => new Set(s).add(puestoId))
  }
  const alternarPuesto = (id: string) => setAbiertos((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  return (
    <div className="space-y-4">
      {/* ① Veredicto */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-gris-claro bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gris">Alcance</p>
          <p className="mt-1 font-display text-2xl font-bold">{puestos.length} <span className="text-sm font-normal text-gris">puesto{puestos.length === 1 ? '' : 's'}</span></p>
          <p className="text-xs text-gris">{totalColaboradores} colaborador{totalColaboradores === 1 ? '' : 'es'} activo{totalColaboradores === 1 ? '' : 's'} alcanzado{totalColaboradores === 1 ? '' : 's'}</p>
        </div>
        <div className="rounded-2xl border border-gris-claro bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gris">Preguntas por modalidad</p>
          <p className="mt-1 text-sm">{MODALIDADES.map((m) => `${ETIQUETA_MODALIDAD[m]} ${seleccion[m].size}`).join(' · ')}</p>
          <p className="text-xs text-gris">la ascendente la responde el equipo del jefe evaluado, completa</p>
        </div>
        <div className={`rounded-2xl border p-4 ${puestosConHuecos.length === 0 ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'}`}>
          <p className="text-[11px] font-bold uppercase tracking-wide text-gris">Cobertura (modalidad Jefe)</p>
          {puestosConHuecos.length === 0 ? (
            <p className="mt-1 text-sm font-bold text-emerald-700">✓ Todos los puestos del alcance quedan cubiertos</p>
          ) : (
            <p className="mt-1 text-sm font-bold text-amber-700">⚠ {puestosConHuecos.length} de {puestos.length} puesto{puestos.length === 1 ? '' : 's'} con competencias sin pregunta</p>
          )}
        </div>
      </div>

      {/* ② Competencias sin cubrir (transversal, ordenado por impacto) */}
      {sinCubrir.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-white p-5">
          <h4 className="mb-1 font-display text-sm font-bold">Competencias sin cubrir</h4>
          <p className="mb-3 text-xs text-gris">Competencias que algún puesto del alcance necesita y que no tienen ninguna pregunta en la modalidad Jefe, ordenadas por impacto.</p>
          <ul className="space-y-2">
            {sinCubrir.map(({ comp, dimension, puestos: pts }) => (
              <li key={comp.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/50 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold">{comp.nombre} <span className="text-[11px] font-normal text-gris">· {dimension}</span></p>
                  <p className="mt-0.5 text-[11px] text-amber-800">
                    Afecta a {pts.length} puesto{pts.length === 1 ? '' : 's'}: {pts.slice(0, 4).map((p) => p.nombre).join(', ')}{pts.length > 4 ? ` y ${pts.length - 4} más` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onAgregarPreguntas(comp, 'JEFE')}
                  className="shrink-0 rounded-xl border border-dashed border-hunter/50 px-3 py-1.5 text-[12px] font-bold text-hunter-dark transition hover:bg-red-50/50"
                >
                  ＋ Agregar preguntas{comp.preguntas.filter((q) => q.modalidades.includes('JEFE')).length === 0 ? ' (banco vacío)' : ''}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ②b Descuadres del catálogo (peso sin competencias): prioridad, pero se arregla en Puestos y niveles */}
      {descuadresCatalogo.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-white p-5">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="font-display text-sm font-bold">Descuadres del catálogo de puestos</h4>
            <Link href="/admin/puestos" className="text-xs font-bold text-hunter hover:underline">Ir a Puestos y niveles →</Link>
          </div>
          <p className="mb-3 text-xs text-gris">No se arreglan en este formulario: un peso sin competencias deja ese porcentaje de la nota sin nada que lo mida.</p>
          <ul className="space-y-2">
            {descuadresCatalogo.map((d, i) => (
              <li key={i} className="rounded-xl border border-amber-200 bg-amber-50/50 px-3.5 py-2.5 text-[13px]">
                {d.sinCompetencias ? (
                  <><b>{d.puesto}</b>: pondera <b>{d.dimension}</b> con {d.peso}% pero no tiene competencias asignadas en esa dimensión — ese {d.peso}% de la nota queda sin medir.</>
                ) : (
                  <><b>{d.puesto}</b>: tiene competencias en <b>{d.dimension}</b> pero la dimensión pesa 0% — lo que se responda ahí no afecta la nota.</>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ③ Puestos del alcance (accordion, con huecos primero) */}
      <div className="rounded-2xl border border-gris-claro bg-white p-5">
        <h4 className="mb-1 font-display text-sm font-bold">Puestos del alcance</h4>
        <p className="mb-3 text-xs text-gris">Expande un puesto para ver su ficha. Los conteos son botones: abren la ficha en esa modalidad para revisar qué competencias se evalúan en cada tipo de evaluación.</p>
        {ordenados.length === 0 ? (
          <p className="rounded-xl bg-hueso px-4 py-5 text-center text-sm text-gris">El alcance no tiene puestos todavía.</p>
        ) : (
          <ul className="space-y-2">
            {ordenados.map((p) => {
              const abierto = abiertos.has(p.id)
              const modalidad = modalidadFicha[p.id] === 'ASCENDENTE' && !p.lidera ? 'JEFE' : (modalidadFicha[p.id] ?? 'JEFE')
              const conteos: { m: Modalidad; n: number }[] = [
                { m: 'JEFE', n: p.jefe }, { m: 'PAR', n: p.par }, { m: 'AUTO', n: p.auto },
                // La ascendente solo aplica a puestos cuyos titulares lideran a alguien
                ...(p.lidera ? [{ m: 'ASCENDENTE' as Modalidad, n: seleccion.ASCENDENTE.size }] : []),
              ]
              return (
                <li key={p.id} className="rounded-xl border border-gris-claro">
                  {/* Móvil: el nombre ocupa su línea completa y los conteos caen debajo — en la
                      fila compartida el nombre se partía en una columna de una palabra con los
                      chips montados encima. Escritorio: la fila de siempre. */}
                  <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                    <button type="button" onClick={() => alternarPuesto(p.id)} className="flex w-full min-w-0 items-center gap-3 text-left md:w-auto md:flex-1">
                      <span className="text-gris">{abierto ? '▾' : '▸'}</span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{p.nombre}</span>
                        <span className="block text-[11px] text-gris">{p.colaboradores} colaborador{p.colaboradores === 1 ? '' : 'es'}</span>
                      </span>
                    </button>
                    <span className="flex flex-wrap gap-1">
                      {conteos.map(({ m, n }) => (
                        <button
                          key={m}
                          type="button"
                          title={`Ver qué se evalúa en la modalidad ${ETIQUETA_MODALIDAD[m]} para este puesto`}
                          onClick={() => abrirEn(p.id, m)}
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold transition ${abierto && modalidad === m ? 'bg-hunter text-white' : 'bg-hueso-2 text-gris hover:text-negro'}`}
                        >
                          {ETIQUETA_MODALIDAD[m]} {n}
                        </button>
                      ))}
                    </span>
                    {p.competenciaIds.length === 0 ? (
                      <span className="rounded-full bg-hueso-2 px-2.5 py-0.5 text-[11px] font-bold text-gris">sin competencias asignadas</span>
                    ) : p.faltan.length === 0 ? (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">{p.competenciaIds.length}/{p.competenciaIds.length} ✓</span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">{p.competenciaIds.length - p.faltan.length}/{p.competenciaIds.length} ⚠</span>
                    )}
                  </div>
                  {abierto && (
                    <FichaPuestoModalidad
                      puesto={p}
                      modalidad={modalidad}
                      dimensiones={dimensiones}
                      nPreguntas={nPreguntas}
                      onAgregarPreguntas={onAgregarPreguntas}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {evaluacion.puestoId && (
        <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          Esta es una evaluación de <b>puesto (excepción)</b>: en el ciclo reemplaza por completo a la del nivel para este puesto, en todas las modalidades.
        </p>
      )}
    </div>
  )
}

/** Ficha del puesto para una modalidad. Jefe: barras vs peso real + huecos accionables.
 * Pares/Auto: qué competencias entran (sin alarma de hueco: en pares es normal cubrir menos).
 * Ascendente: qué responderá el EQUIPO de un jefe con este puesto (el evaluado es el jefe). */
function FichaPuestoModalidad({ puesto, modalidad, dimensiones, nPreguntas, onAgregarPreguntas }: {
  puesto: PuestoW & { jefe: number; porDimension: { id: string; nombre: string; competencias: Comp[]; peso: number }[] }
  modalidad: Modalidad
  dimensiones: Dim[]
  nPreguntas: (m: Modalidad, compId: string) => number
  onAgregarPreguntas: (c: Comp, m: Modalidad) => void
}) {
  const chip = (c: Comp) => {
    const n = nPreguntas(modalidad, c.id)
    if (n > 0) {
      return <span className="inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">✓ {c.nombre} · {n}</span>
    }
    if (modalidad === 'JEFE') {
      return (
        <button
          type="button"
          onClick={() => onAgregarPreguntas(c, 'JEFE')}
          title="Sin pregunta en el formulario — clic para agregar del banco"
          className="inline-block rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-700 transition hover:bg-amber-100"
        >
          ⚠ {c.nombre} · agregar
        </button>
      )
    }
    return (
      <button
        type="button"
        onClick={() => onAgregarPreguntas(c, modalidad)}
        title={`No se evalúa en ${ETIQUETA_MODALIDAD[modalidad]} — clic para agregar si quieres incluirla`}
        className="inline-block rounded-full bg-hueso-2 px-2.5 py-0.5 text-[11px] font-semibold text-gris transition hover:text-negro"
      >
        {c.nombre} · no se evalúa
      </button>
    )
  }

  if (modalidad === 'ASCENDENTE') {
    const conAscendente = dimensiones
      .map((d) => ({ ...d, competencias: d.competencias.filter((c) => nPreguntas('ASCENDENTE', c.id) > 0) }))
      .filter((d) => d.competencias.length > 0)
    return (
      <div className="space-y-3 border-t border-gris-claro px-4 py-4">
        <p className="rounded-xl bg-sky-50 px-3.5 py-2.5 text-[12px] text-sky-800">
          La ascendente evalúa <b>al jefe</b>: esto es lo que responderá el equipo de un jefe con el puesto <b>{puesto.nombre}</b> (&ldquo;Mi jefe…&rdquo;). Por eso se configura en este formulario — el del alcance del jefe — y no en el del puesto de sus subordinados.
        </p>
        {conAscendente.length === 0 ? (
          <p className="text-[12.5px] text-gris">Sin preguntas ascendentes en el formulario. Se agregan en la pestaña Preguntas → Ascendente.</p>
        ) : (
          conAscendente.map((d) => (
            <div key={d.id}>
              <p className="mb-1 text-xs font-bold">{d.nombre}</p>
              <ul className="flex flex-wrap gap-1.5">
                {d.competencias.map((c) => (
                  <li key={c.id}>
                    <span className="inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">✓ {c.nombre} · {nPreguntas('ASCENDENTE', c.id)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4 border-t border-gris-claro px-4 py-4">
      {modalidad === 'PAR' && (
        <p className="rounded-xl bg-sky-50 px-3.5 py-2.5 text-[12px] text-sky-800">
          Los pares no evalúan el perfil completo: el manual sugiere solo Operativa y Liderazgo. Que una competencia no se evalúe aquí es normal.
        </p>
      )}
      {puesto.porDimension
        // En Pares/Auto solo interesan las dimensiones donde el puesto tiene competencias
        .filter((d) => modalidad === 'JEFE' || d.competencias.length > 0)
        .map((d) => {
          const preguntasDim = d.competencias.reduce((a, c) => a + nPreguntas(modalidad, c.id), 0)
          const totalModalidad = puesto.porDimension.reduce((a, dd) => a + dd.competencias.reduce((b, c) => b + nPreguntas(modalidad, c.id), 0), 0)
          const pctPreguntas = totalModalidad > 0 ? Math.round((preguntasDim / totalModalidad) * 100) : 0
          const sinCompetencias = d.competencias.length === 0
          const desbalance = modalidad === 'JEFE' && !sinCompetencias && d.peso > 0 && totalModalidad > 0 && Math.abs(pctPreguntas - d.peso) >= 15
          return (
            <div key={d.id}>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="font-bold">{d.nombre}</span>
                {/* El % vs peso solo tiene sentido en Jefe (el perfil completo); en Pares/Auto basta el conteo */}
                <span className={desbalance ? 'font-bold text-amber-700' : 'text-gris'}>
                  {modalidad === 'JEFE'
                    ? <>{preguntasDim} preg. ({pctPreguntas}%) · peso del puesto {d.peso}%{desbalance ? ' ⚠' : ''}</>
                    : <>{preguntasDim} preg.</>}
                </span>
              </div>
              {modalidad === 'JEFE' && !sinCompetencias && (
                <div className="relative mb-2 h-2 overflow-hidden rounded-full bg-hueso-2">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-hunter/70" style={{ width: `${Math.min(100, pctPreguntas)}%` }} />
                  <div className="absolute inset-y-0 w-0.5 bg-negro/50" style={{ left: `${Math.min(100, d.peso)}%` }} title={`Peso de la dimensión en este puesto: ${d.peso}%`} />
                </div>
              )}
              {modalidad === 'JEFE' && sinCompetencias && (
                <p className="mb-2 rounded-lg bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
                  ⚠ El puesto pondera esta dimensión {d.peso}% pero no tiene competencias asignadas en ella: ese {d.peso}% de la nota queda sin medir — se define en <b>Puestos y niveles</b>, no en este formulario.
                </p>
              )}
              {d.competencias.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {d.competencias.map((c) => <li key={c.id}>{chip(c)}</li>)}
                </ul>
              )}
            </div>
          )
        })}
    </div>
  )
}


/** Modal de selección: el banco de UNA competencia (filtrado a la modalidad), con buscador y marcar todas. */
function SelectorPreguntas({ competencia, modalidad, seleccionadas, onAplicar, onCerrar }: {
  competencia: Comp | null
  modalidad: Modalidad
  seleccionadas: Set<string>
  onAplicar: (ids: string[]) => void
  onCerrar: () => void
}) {
  const [busqueda, setBusqueda] = useState('')
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [clave, setClave] = useState<string | null>(null)

  // Al abrir para otra competencia, sembrar las marcadas con la selección vigente
  const disponibles = useMemo(
    () => (competencia?.preguntas ?? []).filter((p) => p.modalidades.includes(modalidad)),
    [competencia, modalidad],
  )
  if (competencia && clave !== `${competencia.id}|${modalidad}`) {
    setClave(`${competencia.id}|${modalidad}`)
    setBusqueda('')
    setMarcadas(new Set(disponibles.filter((p) => seleccionadas.has(p.id)).map((p) => p.id)))
  }

  const visibles = disponibles.filter((p) => p.texto.toLowerCase().includes(busqueda.toLowerCase()))

  return (
    <Modal titulo={`Agregar preguntas · ${competencia?.nombre ?? ''}`} abierto={competencia !== null} onCerrar={onCerrar}>
      <p className="mb-3 text-xs text-gris">Modalidad <b>{ETIQUETA_MODALIDAD[modalidad]}</b> · {disponibles.length} pregunta{disponibles.length === 1 ? '' : 's'} en el banco para esta competencia</p>
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gris" />
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar en el banco de esta competencia…"
          className="w-full rounded-xl border border-gris-claro bg-hueso py-2.5 pl-9 pr-3.5 text-sm outline-none focus:border-hunter"
        />
      </div>
      {visibles.length === 0 ? (
        <p className="rounded-xl bg-hueso px-4 py-5 text-center text-sm text-gris">Sin resultados. Crea preguntas nuevas en la pestaña <b>Banco de preguntas</b>.</p>
      ) : (
        <ul className="max-h-[46vh] space-y-1.5 overflow-y-auto pr-1">
          {visibles.map((p) => {
            const activa = marcadas.has(p.id)
            return (
              <li key={p.id}>
                <label className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-2 text-[13px] transition ${activa ? 'border-hunter/40 bg-red-50/40' : 'border-gris-claro hover:bg-hueso'}`}>
                  <input
                    type="checkbox" checked={activa}
                    onChange={() => setMarcadas((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n })}
                    className="mt-0.5 h-4 w-4 accent-[#f0163e]"
                  />
                  <span>{p.texto}</span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
      <div className="mt-4 flex items-center justify-between gap-2">
        <button type="button" onClick={() => setMarcadas(new Set(disponibles.map((p) => p.id)))} className="text-xs font-bold text-hunter hover:underline">✓ Marcar todas</button>
        <div className="flex gap-2">
          <button type="button" onClick={onCerrar} className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">Cancelar</button>
          <button type="button" onClick={() => onAplicar([...marcadas])} className={btnRojo}>Aplicar ({marcadas.size}) ✓</button>
        </div>
      </div>
    </Modal>
  )
}
