'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { Pencil, Trash2, Upload } from 'lucide-react'
import { crearPregunta, editarPregunta, eliminarPregunta, alternarPregunta, crearPreguntaPotencial, editarPreguntaPotencial, eliminarPreguntaPotencial, alternarPreguntaPotencial } from './acciones'
import { Modal } from '@/shared/ui/Modal'
import { toast } from '@/shared/ui/Toast'
import { confirmar } from '@/shared/ui/Confirmacion'

type CompetenciaItem = { id: string; nombre: string }
type DimensionItem = { id: string; nombre: string; competencias: CompetenciaItem[] }
type PreguntaItem = { id: string; texto: string; activa: boolean; competencia: string; competenciaId: string; dimensionId: string; dimension: string; modalidades: string[]; descriptores: string[] }

export const NIVELES_BARS = ['Insuficiente', 'En desarrollo', 'Competente', 'Superior', 'Excepcional'] as const

const inputCls = 'w-full rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none focus:border-hunter'

export const ETIQUETA_MODALIDAD: Record<string, string> = { JEFE: 'Jefe', PAR: 'Pares', ASCENDENTE: 'Ascendente', AUTO: 'Auto' }
const ORDEN_MODALIDADES = ['JEFE', 'PAR', 'ASCENDENTE', 'AUTO'] as const

type PotencialItem = { id: string; texto: string; activa: boolean; descriptores: string[] }

export function BancoPreguntas({ dimensiones, preguntas, potencial, puedeGestionar = true }: { dimensiones: DimensionItem[]; preguntas: PreguntaItem[]; potencial: PotencialItem[]; puedeGestionar?: boolean }) {
  const [seccion, setSeccion] = useState<'competencias' | 'potencial'>('competencias')
  const [filtro, setFiltro] = useState<string | null>(null)
  const [modalAbierto, setModalAbierto] = useState(false)
  const [editando, setEditando] = useState<PreguntaItem | null>(null)
  const [viendo, setViendo] = useState<PreguntaItem | null>(null)
  const [, startTransition] = useTransition()
  const visibles = filtro ? preguntas.filter((p) => p.dimensionId === filtro) : preguntas

  async function eliminar(p: PreguntaItem) {
    if (!(await confirmar(`¿Eliminar la pregunta "${p.texto}"? Si está en alguna evaluación, se retirará de ella.`, { titulo: 'Eliminar pregunta', textoAceptar: 'Eliminar' }))) return
    startTransition(async () => {
      const res = await eliminarPregunta(p.id)
      if (!res.ok) toast(res.error)
      else toast(res.retiradasDePlantillas > 0 ? `Pregunta eliminada (retirada de ${res.retiradasDePlantillas} plantilla${res.retiradasDePlantillas === 1 ? '' : 's'})` : 'Pregunta eliminada')
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
          {puedeGestionar && (
            // La importación masiva es exclusiva de la web: en móvil no se ofrece
            <Link
              href="/admin/preguntas/importar"
              className="hidden items-center gap-1.5 rounded-xl border border-gris-claro bg-white px-3.5 py-2 text-[13px] font-bold transition hover:bg-hueso md:inline-flex"
            >
              <Upload size={15} /> Importar preguntas
            </Link>
          )}
          {/* Móvil: los dos selectores de sección en fila de dos */}
          <div className="grid w-full grid-cols-2 gap-2 md:contents">
            <button
              onClick={() => setSeccion('competencias')}
              className={`rounded-xl px-4 py-2 text-[13px] font-bold transition ${seccion === 'competencias' ? 'bg-hunter text-white shadow-md shadow-hunter/30' : 'border border-gris-claro bg-white text-gris hover:text-negro'}`}
            >
              🗂 Por competencia · {preguntas.length}
            </button>
            <button
              onClick={() => setSeccion('potencial')}
              className={`rounded-xl px-4 py-2 text-[13px] font-bold transition ${seccion === 'potencial' ? 'bg-hunter text-white shadow-md shadow-hunter/30' : 'border border-gris-claro bg-white text-gris hover:text-negro'}`}
            >
              📈 Potencial · {potencial.length}
            </button>
          </div>
        </div>
        {seccion === 'competencias' && puedeGestionar && (
          <button onClick={() => setModalAbierto(true)} className="w-full shrink-0 rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark md:w-auto">
            ＋ Nueva pregunta
          </button>
        )}
      </div>

      <div className={seccion === 'competencias' ? 'rounded-2xl border border-gris-claro bg-white p-5' : 'hidden'}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-bold">Banco de preguntas</h3>
            <p className="text-xs text-gris">{visibles.length} de {preguntas.length} preguntas</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setFiltro(null)}
              className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${filtro === null ? 'bg-negro text-white' : 'bg-hueso-2 text-gris hover:text-negro'}`}
            >
              Todas
            </button>
            {dimensiones.map((d) => {
              const n = preguntas.filter((p) => p.dimensionId === d.id).length
              return (
                <button
                  key={d.id}
                  onClick={() => setFiltro(filtro === d.id ? null : d.id)}
                  className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${filtro === d.id ? 'bg-hunter text-white' : 'bg-hueso-2 text-gris hover:text-negro'}`}
                >
                  {d.nombre} · {n}
                </button>
              )
            })}
          </div>
        </div>
        {visibles.length === 0 ? (
          <p className="rounded-xl bg-hueso px-4 py-6 text-center text-sm text-gris">
            {filtro ? 'Sin preguntas en esta dimensión todavía.' : 'El banco está vacío. Agrega la primera con “＋ Nueva pregunta”.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {visibles.map((p) => (
              <li key={p.id} className="rounded-xl border border-gris-claro px-4 py-2.5 md:flex md:items-center md:gap-3">
                {/* Móvil: card de lectura — tocar abre el modal de detalle (rúbrica BARS);
                    editar/eliminar/activar quedan solo en escritorio. La fila única partía
                    el texto en una columna de una palabra contra los chips. */}
                <button type="button" onClick={() => setViendo(p)} className="block w-full py-0.5 text-left md:hidden">
                  <span className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    {p.descriptores.length === 5
                      ? <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10.5px] font-bold text-emerald-700">BARS ✓</span>
                      : <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[10.5px] font-bold text-amber-800">Sin BARS</span>}
                    <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[10.5px] font-semibold text-violet-700">
                      {ORDEN_MODALIDADES.filter((m) => p.modalidades.includes(m)).map((m) => ETIQUETA_MODALIDAD[m]).join(' · ')}
                    </span>
                    {!p.activa && <span className="rounded-full bg-hueso-2 px-2.5 py-0.5 text-[10.5px] font-bold text-gris">Inactiva</span>}
                    <span className="ml-auto text-lg font-bold leading-none text-gris-claro">›</span>
                  </span>
                  <span className="block text-[13px] font-semibold leading-relaxed">{p.texto}</span>
                  <span className="mt-1.5 block border-t border-dashed border-hueso-2 pt-1.5 text-[11px] text-gris/80">{p.competencia} · {p.dimension}</span>
                </button>

                {/* Escritorio: la fila original */}
                <button type="button" onClick={() => setViendo(p)} title="Ver la pregunta completa" className="hidden min-w-0 flex-1 text-left text-sm transition hover:text-hunter-dark md:block">
                  {p.texto}
                </button>
                <span className="hidden items-center gap-3 md:flex">
                {p.descriptores.length === 5
                  ? <span title="Con descriptores por nivel de la escala" className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">BARS ✓</span>
                  : <span title="Sin descriptores: al responder se muestra solo la escala 1–5" className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">Sin BARS</span>}
                <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700">
                  {ORDEN_MODALIDADES.filter((m) => p.modalidades.includes(m)).map((m) => ETIQUETA_MODALIDAD[m]).join(' · ')}
                </span>
                <span className="rounded-full bg-hueso-2 px-2.5 py-0.5 text-[11px] font-semibold text-negro/70">{p.competencia}</span>
                <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700">{p.dimension}</span>
                {puedeGestionar
                  ? <TogglePregunta preguntaId={p.id} activa={p.activa} />
                  : <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${p.activa ? 'bg-emerald-50 text-emerald-700' : 'bg-hueso-2 text-gris'}`}>{p.activa ? 'Activa' : 'Inactiva'}</span>}
                {puedeGestionar && (
                  // Acciones detrás de un «⋯» en el borde derecho: se expanden al acercar el
                  // mouse ahí (no en toda la fila) — con hover en la fila entera, los íconos
                  // parpadeaban constantemente al recorrer la lista.
                  <span className="group/acc flex shrink-0 items-center">
                    <span className="grid h-7 w-7 place-items-center rounded-lg text-base font-bold text-gris/50 group-hover/acc:hidden group-focus-within/acc:hidden">⋯</span>
                    <span className="hidden items-center gap-1 group-hover/acc:flex group-focus-within/acc:flex">
                      <button onClick={() => setEditando(p)} title="Editar" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gris transition hover:bg-hueso hover:text-negro"><Pencil size={13} /></button>
                      <button onClick={() => eliminar(p)} title="Eliminar" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gris transition hover:bg-red-50 hover:text-hunter"><Trash2 size={13} /></button>
                    </span>
                  </span>
                )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {seccion === 'potencial' && <SeccionPotencial potencial={potencial} puedeGestionar={puedeGestionar} />}

      <Modal titulo="Detalle de la pregunta" abierto={viendo !== null} onCerrar={() => setViendo(null)}>
        {viendo && (
          <div className="space-y-4">
            <p className="text-[15px] font-medium leading-relaxed">{viendo.texto}</p>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700">{viendo.dimension}</span>
              <span className="rounded-full bg-hueso-2 px-2.5 py-0.5 text-[11px] font-semibold text-negro/70">{viendo.competencia}</span>
              <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700">
                {ORDEN_MODALIDADES.filter((m) => viendo.modalidades.includes(m)).map((m) => ETIQUETA_MODALIDAD[m]).join(' · ')}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${viendo.activa ? 'bg-emerald-50 text-emerald-700' : 'bg-hueso-2 text-gris'}`}>{viendo.activa ? 'Activa' : 'Inactiva'}</span>
            </div>
            {viendo.descriptores.length === 5 ? (
              <div className="rounded-xl bg-hueso p-4">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gris">Descriptores por nivel (escala BARS)</p>
                {/* Grid de dos columnas: los rótulos comparten ancho y las descripciones
                    arrancan alineadas en la misma vertical (con flex, cada rótulo empujaba
                    su descripción a una posición distinta). */}
                <ul className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-2 text-[13px] leading-relaxed">
                  {viendo.descriptores.map((d, i) => (
                    <li key={i} className="contents">
                      <span className="font-bold"><span className="text-hunter">{i + 1}</span> · {NIVELES_BARS[i]}</span>
                      <span className="text-gris">{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="rounded-xl bg-amber-50 px-4 py-3 text-[13px] text-amber-800">Sin descriptores de escala: al responder se muestra solo la escala 1–5.</p>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              {puedeGestionar && (
                <button type="button" onClick={() => { setEditando(viendo); setViendo(null) }} className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">
                  <Pencil size={12} className="mr-1 inline -translate-y-px" />Editar
                </button>
              )}
              <button type="button" onClick={() => setViendo(null)} className="rounded-xl bg-negro px-5 py-2.5 font-display text-[13px] font-bold text-white transition hover:bg-negro/80">Cerrar</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal amplio titulo="Nueva pregunta" abierto={modalAbierto} onCerrar={() => setModalAbierto(false)}>
        <FormPregunta dimensiones={dimensiones} dimensionInicial={filtro} onCerrar={() => setModalAbierto(false)} />
      </Modal>
      <Modal amplio titulo="Editar pregunta" abierto={editando !== null} onCerrar={() => setEditando(null)}>
        {editando && <FormPregunta dimensiones={dimensiones} dimensionInicial={null} edicion={editando} onCerrar={() => setEditando(null)} />}
      </Modal>
    </div>
  )
}

function FormPregunta({ dimensiones, dimensionInicial, edicion, onCerrar }: {
  dimensiones: DimensionItem[]
  dimensionInicial: string | null
  edicion?: PreguntaItem
  onCerrar: () => void
}) {
  const [aviso, setAviso] = useState<string | null>(null)
  // Si la lista está filtrada por una dimensión, el form la adopta al abrir; en edición, los valores actuales
  const [dimensionId, setDimensionId] = useState(edicion?.dimensionId ?? dimensionInicial ?? '')
  const [competenciaId, setCompetenciaId] = useState(edicion?.competenciaId ?? '')
  const [pendiente, startTransition] = useTransition()
  // Asistente de 2 pasos: la pregunta primero, los descriptores BARS después — todo junto
  // el formulario se hacía incómodo. Ambos pasos viven en el MISMO <form> (el 2 se oculta
  // con CSS, no se desmonta) para que el FormData del envío junte los dos.
  const [paso, setPaso] = useState<1 | 2>(1)
  const [texto, setTexto] = useState(edicion?.texto ?? '')
  const formRef = useRef<HTMLFormElement>(null)

  const competencias = dimensiones.find((d) => d.id === dimensionId)?.competencias ?? []

  function avanzar() {
    if (!texto.trim()) { setAviso('Escribe el texto de la pregunta'); return }
    if (!competenciaId) { setAviso('Elige la dimensión y la competencia'); return }
    if (!formRef.current?.querySelector('input[name="modalidades"]:checked')) { setAviso('Marca al menos una modalidad'); return }
    setAviso(null)
    setPaso(2)
  }

  // onSubmit + preventDefault (y no action=) para evitar el auto-reset del form de React 19,
  // que desincroniza los selects controlados; así se conserva dimensión y competencia en tanda.
  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)
    setAviso(null)
    startTransition(async () => {
      if (edicion) {
        const res = await editarPregunta(edicion.id, formData)
        if (!res.ok) { setAviso(res.error); return }
        toast(res.retiradasDePlantillas > 0 ? `Pregunta actualizada (retirada de ${res.retiradasDePlantillas} selección${res.retiradasDePlantillas === 1 ? '' : 'es'} de plantilla)` : 'Pregunta actualizada')
        onCerrar()
        return
      }
      const res = await crearPregunta(formData)
      if (!res.ok) setAviso(res.error)
      else {
        // Tanda: el form vuelve al paso 1 limpio (los checkboxes vuelven a su default y los
        // descriptores se vacían); dimensión y competencia se conservan por ser controlados
        setAviso('Pregunta agregada al banco ✓')
        form.reset()
        setTexto('')
        setPaso(1)
      }
    })
  }

  return (
    <form ref={formRef} onSubmit={enviar} className="space-y-3">
      {/* Progreso del asistente */}
      <div>
        <div className="mb-1.5 flex gap-1.5" aria-label={`Paso ${paso} de 2`}>
          <span className="h-1 flex-1 rounded-full bg-hunter" />
          <span className={`h-1 flex-1 rounded-full ${paso === 2 ? 'bg-hunter' : 'bg-hueso-2'}`} />
        </div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-gris">
          Paso {paso} de 2 · {paso === 1 ? 'La pregunta' : 'Descriptores de la escala (BARS)'}
        </p>
      </div>

      <div className={paso === 1 ? 'space-y-3' : 'hidden'}>
      <label className="block">
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gris">Texto de la pregunta</span>
        <input name="texto" required autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Conducta observable, p. ej. “Analiza los KPIs de su área…”" className={inputCls} />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gris">Dimensión</span>
          <select
            value={dimensionId}
            onChange={(e) => { setDimensionId(e.target.value); setCompetenciaId('') }}
            className={inputCls}
          >
            <option value="">Elegir…</option>
            {dimensiones.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gris">Competencia</span>
          <select
            name="competenciaId"
            required
            value={competenciaId}
            onChange={(e) => setCompetenciaId(e.target.value)}
            disabled={!dimensionId}
            className={`${inputCls} disabled:opacity-50`}
          >
            <option value="">{dimensionId ? 'Elegir…' : 'Elige primero la dimensión'}</option>
            {competencias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
      </div>
      <div>
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gris">Aplica a las modalidades</span>
        <div className="flex flex-wrap gap-2">
          {ORDEN_MODALIDADES.map((m) => (
            <label key={m} className="flex cursor-pointer items-center gap-2 rounded-xl border border-gris-claro bg-hueso px-3 py-2 text-[13px]">
              <input type="checkbox" name="modalidades" value={m} defaultChecked={edicion ? edicion.modalidades.includes(m) : m !== 'ASCENDENTE'} className="h-4 w-4 accent-[#f0163e]" />
              {ETIQUETA_MODALIDAD[m]}
            </label>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-gris">La ascendente evalúa al jefe y se redacta distinto (“Mi jefe…”), por eso va en preguntas aparte.</p>
      </div>
      </div>

      <div className={paso === 2 ? 'space-y-3' : 'hidden'}>
      <div>
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gris">Descriptores por nivel (escala BARS)</span>
        <div className="space-y-2">
          {NIVELES_BARS.map((nivel, i) => (
            <label key={nivel} className="flex items-start gap-2">
              <span className="mt-2 w-24 shrink-0 text-[11px] font-bold"><span className="text-hunter">{i + 1}</span> · {nivel}</span>
              <textarea
                name={`descriptor${i + 1}`}
                rows={3}
                defaultValue={edicion?.descriptores[i] ?? ''}
                placeholder={`Conducta observable del nivel ${i + 1}`}
                className={`${inputCls} resize-y`}
              />
            </label>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-gris">Opcionales, pero completos: o los 5 niveles o ninguno. Con descriptores, al responder se elige la conducta que mejor describe a la persona; sin ellos, se muestra solo la escala 1–5.</p>
      </div>
      </div>

      {aviso && <p className={`rounded-lg px-3 py-2 text-sm ${aviso.includes('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-hunter-dark'}`}>{aviso}</p>}
      <div className="flex items-center justify-between gap-2 pt-1">
        {paso === 2
          ? <button type="button" onClick={() => { setAviso(null); setPaso(1) }} className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">← Atrás</button>
          : <span />}
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCerrar} className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">Cerrar</button>
          {/* key distinto en cada botón: sin él React REUTILIZA el nodo al cambiar de paso
              (type button→submit) y la acción por defecto del mismo clic enviaba el form */}
          {paso === 1 ? (
            <button key="siguiente" type="button" onClick={avanzar} className="rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark">
              Siguiente →
            </button>
          ) : (
            <button key="enviar" type="submit" disabled={pendiente} className="rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:opacity-60">
              {pendiente ? 'Guardando…' : edicion ? 'Guardar cambios ✓' : 'Agregar al banco →'}
            </button>
          )}
        </div>
      </div>
    </form>
  )
}

export function TogglePregunta({ preguntaId, activa }: { preguntaId: string; activa: boolean }) {
  const [estado, setEstado] = useState(activa)
  const [, startTransition] = useTransition()
  return (
    <button
      onClick={() => {
        const nuevo = !estado
        setEstado(nuevo)
        startTransition(async () => { await alternarPregunta(preguntaId, nuevo) })
      }}
      className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${estado ? 'bg-emerald-50 text-emerald-700' : 'bg-hueso-2 text-gris'}`}
    >
      {estado ? 'Activa' : 'Inactiva'}
    </button>
  )
}

/** Banco de preguntas de potencial (eje Y del 9-Box): sin competencia ni dimensión — las responde
 * solo el jefe y nunca se mezclan con la nota de desempeño. Cada evaluación elige cuáles aplica. */
function SeccionPotencial({ potencial, puedeGestionar = true }: { potencial: PotencialItem[]; puedeGestionar?: boolean }) {
  const [editando, setEditando] = useState<PotencialItem | 'nueva' | null>(null)
  const [viendo, setViendo] = useState<PotencialItem | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()
  // Mismo asistente de 2 pasos que las preguntas de competencia: texto primero, BARS después.
  // El estado vive aquí (el Modal desmonta su contenido) y se reinicia al abrir/cambiar de pregunta.
  const [paso, setPaso] = useState<1 | 2>(1)
  const [texto, setTexto] = useState('')
  useEffect(() => {
    setPaso(1)
    setAviso(null)
    setTexto(editando && editando !== 'nueva' ? editando.texto : '')
  }, [editando])

  function avanzar() {
    if (!texto.trim()) { setAviso('Escribe el texto de la pregunta'); return }
    setAviso(null)
    setPaso(2)
  }

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setAviso(null)
    startTransition(async () => {
      const res = editando === 'nueva' || editando === null
        ? await crearPreguntaPotencial(formData)
        : await editarPreguntaPotencial(editando.id, formData)
      if (!res.ok) { setAviso(res.error); return }
      toast(editando === 'nueva' ? 'Pregunta de potencial creada' : 'Pregunta actualizada')
      setEditando(null)
    })
  }

  async function eliminar(p: PotencialItem) {
    if (!(await confirmar(`¿Eliminar la pregunta de potencial "${p.texto}"?`, { titulo: 'Eliminar pregunta', textoAceptar: 'Eliminar' }))) return
    startTransition(async () => {
      const res = await eliminarPreguntaPotencial(p.id)
      toast(res.ok ? 'Pregunta eliminada' : res.error)
    })
  }

  return (
    <div className="rounded-2xl border border-gris-claro bg-white p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-bold">Preguntas de potencial</h3>
          <p className="text-xs text-gris">Las responde solo el jefe · definen el eje vertical del 9-Box · sin competencia ni dimensión (no afectan la nota de desempeño)</p>
        </div>
        {puedeGestionar && (
          <button onClick={() => setEditando('nueva')} className="w-full shrink-0 rounded-xl border border-dashed border-hunter/50 px-4 py-2.5 text-[12.5px] font-bold text-hunter-dark transition hover:bg-red-50/50 md:w-auto md:py-2">
            ＋ Nueva pregunta de potencial
          </button>
        )}
      </div>
      {potencial.length === 0 ? (
        <p className="rounded-xl bg-hueso px-4 py-5 text-center text-sm text-gris">Sin preguntas de potencial. Sin ellas, el 9-Box no tendrá eje de potencial.</p>
      ) : (
        <ul className="space-y-2">
          {potencial.map((p) => (
            <li key={p.id} className="rounded-xl border border-gris-claro px-4 py-2.5 md:flex md:items-center md:gap-3">
              {/* Móvil: card de lectura — tocar abre el modal (mismo criterio que competencias) */}
              <button type="button" onClick={() => setViendo(p)} className="block w-full py-0.5 text-left md:hidden">
                <span className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  {p.descriptores.length === 5
                    ? <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10.5px] font-bold text-emerald-700">BARS ✓</span>
                    : <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[10.5px] font-bold text-amber-800">Sin BARS</span>}
                  {!p.activa && <span className="rounded-full bg-hueso-2 px-2.5 py-0.5 text-[10.5px] font-bold text-gris">Inactiva</span>}
                  <span className="ml-auto text-lg font-bold leading-none text-gris-claro">›</span>
                </span>
                <span className="block text-[13px] font-semibold leading-relaxed">{p.texto}</span>
              </button>

              {/* Escritorio: la fila original */}
              <button type="button" onClick={() => setViendo(p)} title="Ver la pregunta completa" className="hidden min-w-0 flex-1 text-left text-sm transition hover:text-hunter-dark md:block">
                {p.texto}
              </button>
              <span className="hidden items-center gap-3 md:flex">
              {p.descriptores.length === 5
                ? <span title="Con descriptores por nivel de la escala" className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">BARS ✓</span>
                : <span title="Sin descriptores: al responder se muestra solo la escala 1–5" className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">Sin BARS</span>}
              {puedeGestionar
                ? <TogglePotencial id={p.id} activa={p.activa} />
                : <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${p.activa ? 'bg-emerald-50 text-emerald-700' : 'bg-hueso-2 text-gris'}`}>{p.activa ? 'Activa' : 'Inactiva'}</span>}
              {puedeGestionar && (
                <span className="group/acc flex shrink-0 items-center">
                  <span className="grid h-7 w-7 place-items-center rounded-lg text-base font-bold text-gris/50 group-hover/acc:hidden group-focus-within/acc:hidden">⋯</span>
                  <span className="hidden items-center gap-1 group-hover/acc:flex group-focus-within/acc:flex">
                    <button onClick={() => setEditando(p)} title="Editar" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gris transition hover:bg-hueso hover:text-negro"><Pencil size={13} /></button>
                    <button onClick={() => eliminar(p)} title="Eliminar" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gris transition hover:bg-red-50 hover:text-hunter"><Trash2 size={13} /></button>
                  </span>
                </span>
              )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Modal titulo="Detalle de la pregunta de potencial" abierto={viendo !== null} onCerrar={() => setViendo(null)}>
        {viendo && (
          <div className="space-y-4">
            <p className="text-[15px] font-medium leading-relaxed">{viendo.texto}</p>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700">Responde solo el jefe · eje del 9-Box</span>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${viendo.activa ? 'bg-emerald-50 text-emerald-700' : 'bg-hueso-2 text-gris'}`}>{viendo.activa ? 'Activa' : 'Inactiva'}</span>
            </div>
            {viendo.descriptores.length === 5 ? (
              <div className="rounded-xl bg-hueso p-4">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gris">Descriptores por nivel (escala BARS)</p>
                <ul className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-2 text-[13px] leading-relaxed">
                  {viendo.descriptores.map((d, i) => (
                    <li key={i} className="contents">
                      <span className="font-bold"><span className="text-hunter">{i + 1}</span> · {NIVELES_BARS[i]}</span>
                      <span className="text-gris">{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="rounded-xl bg-amber-50 px-4 py-3 text-[13px] text-amber-800">Sin descriptores de escala: al responder se muestra solo la escala 1–5.</p>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              {puedeGestionar && (
                <button type="button" onClick={() => { setEditando(viendo); setViendo(null) }} className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">
                  <Pencil size={12} className="mr-1 inline -translate-y-px" />Editar
                </button>
              )}
              <button type="button" onClick={() => setViendo(null)} className="rounded-xl bg-negro px-5 py-2.5 font-display text-[13px] font-bold text-white transition hover:bg-negro/80">Cerrar</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal amplio titulo={editando === 'nueva' ? 'Nueva pregunta de potencial' : 'Editar pregunta de potencial'} abierto={editando !== null} onCerrar={() => setEditando(null)}>
        <form onSubmit={enviar} className="space-y-3">
          <div>
            <div className="mb-1.5 flex gap-1.5" aria-label={`Paso ${paso} de 2`}>
              <span className="h-1 flex-1 rounded-full bg-hunter" />
              <span className={`h-1 flex-1 rounded-full ${paso === 2 ? 'bg-hunter' : 'bg-hueso-2'}`} />
            </div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-gris">
              Paso {paso} de 2 · {paso === 1 ? 'La pregunta' : 'Descriptores de la escala (BARS)'}
            </p>
          </div>

          <label className={paso === 1 ? 'block' : 'hidden'}>
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gris">Texto de la pregunta</span>
            <input name="texto" required autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="p. ej. “Tiene capacidad para asumir responsabilidades de mayor alcance…”" className={inputCls} />
          </label>

          <div className={paso === 2 ? '' : 'hidden'}>
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gris">Descriptores por nivel (escala BARS)</span>
            <div className="space-y-2">
              {NIVELES_BARS.map((nivel, i) => (
                <label key={nivel} className="flex items-start gap-2">
                  <span className="mt-2 w-24 shrink-0 text-[11px] font-bold"><span className="text-hunter">{i + 1}</span> · {nivel}</span>
                  <textarea
                    name={`descriptor${i + 1}`}
                    rows={3}
                    defaultValue={editando && editando !== 'nueva' ? (editando.descriptores[i] ?? '') : ''}
                    placeholder={`Conducta observable del nivel ${i + 1}`}
                    className={`${inputCls} resize-y`}
                  />
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-gris">Opcionales, pero completos: o los 5 niveles o ninguno.</p>
          </div>

          {aviso && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-hunter-dark">{aviso}</p>}
          <div className="flex items-center justify-between gap-2 pt-1">
            {paso === 2
              ? <button type="button" onClick={() => { setAviso(null); setPaso(1) }} className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">← Atrás</button>
              : <span />}
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setEditando(null)} className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">Cancelar</button>
              {/* key distinto: evita que React reutilice el nodo y el clic de Siguiente envíe */}
              {paso === 1 ? (
                <button key="siguiente" type="button" onClick={avanzar} className="rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark">
                  Siguiente →
                </button>
              ) : (
                <button key="enviar" type="submit" disabled={pendiente} className="rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:opacity-60">
                  {pendiente ? 'Guardando…' : 'Guardar ✓'}
                </button>
              )}
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function TogglePotencial({ id, activa }: { id: string; activa: boolean }) {
  const [estado, setEstado] = useState(activa)
  const [, startTransition] = useTransition()
  return (
    <button
      onClick={() => {
        const nuevo = !estado
        setEstado(nuevo)
        startTransition(async () => { await alternarPreguntaPotencial(id, nuevo) })
      }}
      className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${estado ? 'bg-emerald-50 text-emerald-700' : 'bg-hueso-2 text-gris'}`}
    >
      {estado ? 'Activa' : 'Inactiva'}
    </button>
  )
}
