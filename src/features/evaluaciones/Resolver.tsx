'use client'

import { PenLine, TrendingUp, Save } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { guardarEvaluacion } from './acciones'

type Pregunta = { id: string; texto: string; competencia: string; dimension: string; descriptores: string[] }
type ObjetivoItem = { id: string; titulo: string; tipo: string; peso: number; detalle: string; valorInicial: number | null; esTransversal: boolean }
type PreguntaPot = { id: string; texto: string; descriptores: string[] }

const ESCALA = [1, 2, 3, 4, 5]
const NIVELES_ESCALA = ['Insuficiente', 'En desarrollo', 'Competente', 'Superior', 'Excepcional']

function EscalaPicker({ valor, onPick }: { valor: number | undefined; onPick: (v: number) => void }) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {ESCALA.map((v) => (
        <button
          key={v} type="button" onClick={() => onPick(v)}
          className={`rounded-lg border py-2 text-sm font-semibold transition ${
            valor === v ? 'border-hunter bg-hunter text-white shadow-md shadow-hunter/30' : 'border-gris-claro bg-white hover:border-hunter/50'
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  )
}

export function Resolver({
  asignacionId, titulo, tipo, soloLectura,
  preguntas, objetivos, preguntasPotencial,
  respuestasIniciales, potencialInicial, volverA,
}: {
  asignacionId: string
  titulo: string
  tipo: 'AUTO' | 'PAR' | 'ASCENDENTE' | 'JEFE'
  soloLectura: boolean
  preguntas: Pregunta[]
  objetivos: ObjetivoItem[] // AUTO: avance · JEFE: logro
  preguntasPotencial: PreguntaPot[] // solo JEFE
  respuestasIniciales: Record<string, number>
  potencialInicial: Record<string, number>
  volverA: string
}) {
  const router = useRouter()
  // Sin objetivos que responder (ciclo sin período, o evaluado sin objetivos aprobados)
  // la etapa no existe: un tab vacío solo confunde.
  const conObjetivos = (tipo === 'AUTO' || tipo === 'JEFE') && objetivos.length > 0
  const conPotencial = tipo === 'JEFE'
  const etapas = useMemo(() => {
    const e: { clave: string; label: string }[] = [{ clave: 'comp', label: 'Competencias' }]
    if (conObjetivos) e.push({ clave: 'obj', label: 'Objetivos' })
    if (conPotencial) e.push({ clave: 'pot', label: 'Potencial' })
    return e
  }, [conObjetivos, conPotencial])

  const [etapa, setEtapa] = useState('comp')
  const [respuestas, setRespuestas] = useState<Record<string, number>>(respuestasIniciales)
  // Acordeón de competencias: nace abierta la primera sin responder; el usuario puede reabrir
  // otras para corregir sin que se cierre la actual. Al responder cualquiera, todo colapsa y
  // queda abierta solo la siguiente pendiente.
  const [abiertas, setAbiertas] = useState<Set<string>>(() => {
    const primera = preguntas.find((p) => respuestasIniciales[p.id] === undefined)
    return new Set(primera ? [primera.id] : [])
  })

  function responderCompetencia(preguntaId: string, v: number) {
    if (soloLectura) return
    const nuevas = { ...respuestas, [preguntaId]: v }
    setRespuestas(nuevas)
    const siguiente = preguntas.find((p) => nuevas[p.id] === undefined)
    setAbiertas(new Set(siguiente ? [siguiente.id] : []))
    if (siguiente) setTimeout(() => document.getElementById(`preg-${siguiente.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
  }
  function alternarAbierta(preguntaId: string) {
    setAbiertas((s) => {
      const n = new Set(s)
      if (n.has(preguntaId)) n.delete(preguntaId)
      else n.add(preguntaId)
      return n
    })
  }

  // Mismo acordeón para la etapa Potencial (5 preguntas del jefe con su propia rúbrica)
  const [abiertasPot, setAbiertasPot] = useState<Set<string>>(() => {
    const primera = preguntasPotencial.find((p) => potencialInicial[p.id] === undefined)
    return new Set(primera ? [primera.id] : [])
  })
  function responderPotencial(preguntaId: string, v: number) {
    if (soloLectura) return
    const nuevas = { ...potencial, [preguntaId]: v }
    setPotencial(nuevas)
    const siguiente = preguntasPotencial.find((p) => nuevas[p.id] === undefined)
    setAbiertasPot(new Set(siguiente ? [siguiente.id] : []))
    if (siguiente) setTimeout(() => document.getElementById(`pot-${siguiente.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
  }
  function alternarAbiertaPot(preguntaId: string) {
    setAbiertasPot((s) => {
      const n = new Set(s)
      if (n.has(preguntaId)) n.delete(preguntaId)
      else n.add(preguntaId)
      return n
    })
  }
  const [valoresObj, setValoresObj] = useState<Record<string, number | ''>>(
    Object.fromEntries(objetivos.map((o) => [o.id, o.valorInicial ?? ''])),
  )
  const [potencial, setPotencial] = useState<Record<string, number>>(potencialInicial)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  const idx = etapas.findIndex((e) => e.clave === etapa)
  const esUltima = idx === etapas.length - 1
  const respondidas = Object.keys(respuestas).length

  function armarPayload(enviar: boolean) {
    return {
      asignacionId,
      respuestas: Object.entries(respuestas).map(([preguntaId, valor]) => ({ preguntaId, valor })),
      avances: tipo === 'AUTO'
        ? Object.entries(valoresObj).filter(([, v]) => v !== '').map(([objetivoId, v]) => ({ objetivoId, avance: Number(v) }))
        : undefined,
      logros: tipo === 'JEFE'
        ? Object.entries(valoresObj).filter(([, v]) => v !== '').map(([objetivoId, v]) => ({ objetivoId, logro: Number(v) }))
        : undefined,
      potencial: conPotencial
        ? Object.entries(potencial).map(([preguntaId, valor]) => ({ preguntaId, valor }))
        : undefined,
      enviar,
    }
  }

  function persistir(enviar: boolean) {
    setError(null)
    setAviso(null)
    startTransition(async () => {
      const res = await guardarEvaluacion(armarPayload(enviar))
      if (!res.ok) setError(res.error)
      else if (enviar) {
        router.push(volverA + '?enviada=1')
        router.refresh()
      } else setAviso('Borrador guardado · puedes continuar después ✓')
    })
  }

  // ── Autoguardado: cada respuesta se persiste sola (1.5s tras el último cambio) ──
  // Antes, navegar sin pulsar «Guardar borrador» perdía todo lo respondido.
  const [autoguardado, setAutoguardado] = useState<'inactivo' | 'guardando' | 'guardado' | 'error'>('inactivo')
  const guardandoAuto = useRef(false)
  const autoguardar = async () => {
    if (soloLectura || guardandoAuto.current) return
    guardandoAuto.current = true
    setAutoguardado('guardando')
    try {
      const res = await guardarEvaluacion(armarPayload(false))
      setAutoguardado(res.ok ? 'guardado' : 'error')
    } catch {
      setAutoguardado('error')
    } finally {
      guardandoAuto.current = false
    }
  }
  const autoguardarRef = useRef(autoguardar)
  useEffect(() => { autoguardarRef.current = autoguardar })
  const primeraCarga = useRef(true)
  useEffect(() => {
    if (primeraCarga.current) { primeraCarga.current = false; return }
    if (soloLectura) return
    const t = setTimeout(() => autoguardarRef.current(), 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [respuestas, valoresObj, potencial])
  // Al ocultar la pestaña o salir, un último intento inmediato (mejor esfuerzo)
  useEffect(() => {
    if (soloLectura) return
    const h = () => { if (document.visibilityState === 'hidden') autoguardarRef.current() }
    document.addEventListener('visibilitychange', h)
    return () => document.removeEventListener('visibilitychange', h)
  }, [soloLectura])

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-hunter/25 bg-red-50/50 px-4 py-3 text-sm">
        <PenLine size={13} className="mr-1 inline -translate-y-px" />Respondiendo: <b>{titulo}</b> · escala 1 (Insuficiente) → 5 (Excepcional).
        {soloLectura && <b className="text-hunter-dark"> · Ya enviada (solo lectura)</b>}
      </div>

      {/* Etapas */}
      <div className="flex gap-2">
        {etapas.map((e, i) => (
          <button
            key={e.clave} type="button" onClick={() => setEtapa(e.clave)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold transition ${
              etapa === e.clave ? 'bg-red-50 text-hunter-dark ring-1 ring-hunter/30' : 'bg-hueso-2 text-gris hover:text-negro'
            }`}
          >
            <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${etapa === e.clave ? 'bg-hunter text-white' : 'bg-gris-claro text-gris'}`}>{i + 1}</span>
            {e.label}
          </button>
        ))}
      </div>

      {/* ETAPA: Competencias */}
      {etapa === 'comp' && (
        <div className="rounded-2xl border border-gris-claro bg-white">
          <header className="flex justify-between border-b border-gris-claro px-5 py-3.5">
            <h3 className="font-display text-sm font-bold">Competencias</h3>
            <span className="text-xs text-gris">{respondidas} de {preguntas.length} · escala 1–5</span>
          </header>
          <div className="space-y-2.5 p-4 md:p-5">
            {preguntas.map((p, i) => {
              const v = respuestas[p.id]
              const abierta = abiertas.has(p.id)
              return (
                <div key={p.id} id={`preg-${p.id}`} className="scroll-mt-24 rounded-xl border border-gris-claro">
                  <button type="button" onClick={() => alternarAbierta(p.id)} className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left">
                    <p className="text-sm font-medium">
                      <span className={`mr-2 inline-grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white ${v !== undefined ? 'bg-emerald-600' : 'bg-negro'}`}>{v !== undefined ? '✓' : i + 1}</span>
                      {p.texto}
                    </p>
                    {/* Sin chip de dimensión: el evaluador no debe poder asociar su nota a la
                        dimensión que puntúa (sesgaría la respuesta). Solo la nota elegida. */}
                    {v !== undefined && <span className="shrink-0 self-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">{v} · {NIVELES_ESCALA[v - 1]}</span>}
                  </button>
                  {abierta && (
                    <div className="px-4 pb-4">
                      {p.descriptores.length === 5 ? (
                        // Rúbrica BARS: se elige la conducta que mejor describe a la persona.
                        // Títulos anclados arriba (misma línea en las 5); la descripción flota centrada.
                        <div className="grid gap-2 md:grid-cols-5">
                          {p.descriptores.map((d, j) => (
                            <button
                              key={j} type="button" onClick={() => responderCompetencia(p.id, j + 1)}
                              className={`flex flex-col gap-1.5 rounded-xl border-[1.5px] p-3 text-left transition md:text-center ${
                                v === j + 1 ? 'border-hunter bg-red-50/70' : 'border-gris-claro bg-hueso/50 hover:border-gris'
                              }`}
                            >
                              <span className="text-[12.5px] font-bold"><span className="text-hunter">{j + 1}</span> · {NIVELES_ESCALA[j]}</span>
                              <span className={`flex-1 text-xs leading-relaxed md:grid md:place-items-center md:text-balance ${v === j + 1 ? 'text-negro' : 'text-gris'}`}>{d}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <EscalaPicker valor={v} onPick={(nota) => responderCompetencia(p.id, nota)} />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {tipo === 'PAR' && <p className="text-xs text-gris">Tu respuesta como par es anónima para la persona evaluada.</p>}
            {tipo === 'ASCENDENTE' && <p className="text-xs text-gris">Evaluación ascendente: tu respuesta es anónima para la persona evaluada.</p>}
          </div>
        </div>
      )}

      {/* ETAPA: Objetivos */}
      {etapa === 'obj' && conObjetivos && (
        <div className="rounded-2xl border border-gris-claro bg-white">
          <header className="flex justify-between border-b border-gris-claro px-5 py-3.5">
            <h3 className="font-display text-sm font-bold">{tipo === 'AUTO' ? 'Avance de mis objetivos' : 'Cumplimiento de objetivos'}</h3>
            <span className="text-xs text-gris">{objetivos.length} objetivos</span>
          </header>
          <div className="p-5">
            <p className="mb-4 rounded-xl bg-hueso-2 px-4 py-2.5 text-sm">
              {tipo === 'AUTO'
                ? 'Registra el % de avance/logro de cada uno de tus objetivos. Tu jefe lo revisará y confirmará el resultado final.'
                : 'Califica el cumplimiento de los objetivos acordados (logrado vs. meta). El % que registres es el resultado final del ciclo.'}
            </p>
            {/* Móvil: card vertical (diseño aprobado) — chips de peso y tipo arriba, título a lo
                ancho y el campo de avance grande al pie; la columna del % aplastaba el título.
                Escritorio: la fila original de siempre. */}
            <ul className="space-y-3">
              {objetivos.map((o) => {
                const etiquetaCampo = tipo === 'AUTO' ? 'Mi avance' : 'Logro'
                const valor = valoresObj[o.id]
                const onCambio = (e: React.ChangeEvent<HTMLInputElement>) =>
                  setValoresObj((s) => ({ ...s, [o.id]: e.target.value === '' ? '' : Number(e.target.value) }))
                return (
                  <li key={o.id} className="rounded-xl border border-gris-claro px-4 py-3.5 md:flex md:items-center md:gap-4 md:py-3">
                    {/* Móvil */}
                    <div className="md:hidden">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-red-50 px-3 py-0.5 font-display text-[13px] font-extrabold text-hunter">{o.peso}%</span>
                        <span className="rounded-full bg-hueso-2 px-2.5 py-0.5 text-[10.5px] font-bold text-gris">{o.tipo}</span>
                        {o.esTransversal && <span className="ml-auto rounded-full bg-amber-50 px-2.5 py-0.5 text-[10.5px] font-bold text-amber-800">Lo gestiona RR.HH.</span>}
                      </div>
                      <p className="mt-2 text-sm font-bold leading-snug">{o.titulo}</p>
                      <p className="mt-0.5 text-xs text-gris">{o.detalle}</p>
                      {o.esTransversal ? (
                        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border-[1.5px] border-dashed border-gris-claro bg-hueso/50 px-3.5 py-2.5" title="El avance del objetivo transversal lo reporta RR.HH.">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-gris">{etiquetaCampo}</span>
                          <span className="text-[13px] font-bold text-amber-800">{o.valorInicial !== null ? `${o.valorInicial}%` : 'Solo referencia — no se edita'}</span>
                        </div>
                      ) : (
                        <label className={`mt-3 flex items-center gap-3 rounded-xl border-[1.5px] px-3.5 py-2 transition ${
                          valor !== '' ? 'border-emerald-500/60 bg-emerald-50/50' : 'border-gris-claro bg-hueso/40 focus-within:border-hunter'
                        }`}>
                          <span className="text-[10px] font-bold uppercase tracking-wide text-gris">{etiquetaCampo}</span>
                          <input
                            type="number" min={0} max={100} disabled={soloLectura} placeholder="0"
                            value={valor}
                            onChange={onCambio}
                            className="min-w-0 flex-1 border-0 bg-transparent text-right text-[21px] font-extrabold outline-none"
                          />
                          <span className="text-base font-extrabold text-gris">%</span>
                        </label>
                      )}
                    </div>

                    {/* Escritorio */}
                    <span className="hidden w-20 shrink-0 self-center text-center font-display text-2xl font-extrabold tracking-tight text-hunter md:block">{o.peso}%</span>
                    <div className="hidden min-w-0 flex-1 md:block">
                      <p className="text-sm font-semibold">{o.titulo} <span className="ml-1 rounded-full bg-hueso-2 px-2 py-0.5 text-[10px] font-semibold text-gris">{o.tipo}</span></p>
                      <p className="text-xs text-gris">{o.detalle}</p>
                    </div>
                    <label className="hidden shrink-0 flex-col items-end gap-1 md:flex">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-gris">{etiquetaCampo}</span>
                      {o.esTransversal ? (
                        <span className="rounded-lg border border-gris-claro bg-hueso px-3 py-1.5 text-sm font-bold" title="El avance del objetivo transversal lo reporta RR.HH.">{o.valorInicial ?? '—'}%</span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <input
                            type="number" min={0} max={100} disabled={soloLectura}
                            value={valor}
                            onChange={onCambio}
                            className="w-20 rounded-lg border border-gris-claro bg-white px-2 py-1.5 text-right text-sm font-bold outline-none focus:border-hunter"
                          />
                          <span className="text-sm font-bold">%</span>
                        </span>
                      )}
                    </label>
                  </li>
                )
              })}
            </ul>
            <p className="mt-3 hidden text-xs text-gris md:block">Los objetivos transversales los gestiona RR.HH.; aquí se muestran como referencia y no se editan.</p>
          </div>
        </div>
      )}

      {/* ETAPA: Potencial */}
      {etapa === 'pot' && conPotencial && (
        <div className="rounded-2xl border border-gris-claro bg-white">
          <header className="flex justify-between border-b border-gris-claro px-5 py-3.5">
            <h3 className="font-display text-sm font-bold">Potencial</h3>
            <span className="text-xs text-gris">escala 1–5 · eje vertical del 9-Box</span>
          </header>
          <div className="space-y-4 p-5">
            <p className="rounded-xl bg-hueso-2 px-4 py-2.5 text-sm"><TrendingUp size={13} className="mr-1 inline -translate-y-px" />5 preguntas que solo responde el jefe. Definen el <b>potencial</b> del colaborador; no se mezclan con la nota de desempeño.</p>
            {preguntasPotencial.map((p, i) => {
              const v = potencial[p.id]
              const abierta = abiertasPot.has(p.id)
              return (
                <div key={p.id} id={`pot-${p.id}`} className="scroll-mt-24 rounded-xl border border-gris-claro">
                  <button type="button" onClick={() => alternarAbiertaPot(p.id)} className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left">
                    <p className="text-sm font-medium">
                      <span className={`mr-2 inline-grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white ${v !== undefined ? 'bg-emerald-600' : 'bg-negro'}`}>{v !== undefined ? '✓' : i + 1}</span>
                      {p.texto}
                    </p>
                    {v !== undefined && <span className="shrink-0 self-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">{v} · {NIVELES_ESCALA[v - 1]}</span>}
                  </button>
                  {abierta && (
                    <div className="px-4 pb-4">
                      {p.descriptores.length === 5 ? (
                        <div className="grid gap-2 md:grid-cols-5">
                          {p.descriptores.map((d, j) => (
                            <button
                              key={j} type="button" onClick={() => responderPotencial(p.id, j + 1)}
                              className={`flex flex-col gap-1.5 rounded-xl border-[1.5px] p-3 text-left transition md:text-center ${
                                v === j + 1 ? 'border-hunter bg-red-50/70' : 'border-gris-claro bg-hueso/50 hover:border-gris'
                              }`}
                            >
                              <span className="text-[12.5px] font-bold"><span className="text-hunter">{j + 1}</span> · {NIVELES_ESCALA[j]}</span>
                              <span className={`flex-1 text-xs leading-relaxed md:grid md:place-items-center md:text-balance ${v === j + 1 ? 'text-negro' : 'text-gris'}`}>{d}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <EscalaPicker valor={v} onPick={(nota) => responderPotencial(p.id, nota)} />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-hunter-dark">{error}</p>}
      {aviso && <p className="rounded-lg bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">{aviso}</p>}

      {/* Navegación */}
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => router.push(volverA)} className="rounded-xl border border-gris-claro bg-white px-4 py-2.5 text-[13px] font-bold transition hover:bg-hueso">
          ← Volver al listado
        </button>
        {!soloLectura && (
          <div className="flex items-center gap-2">
            {/* Autoguardado como ícono: el texto completo se partía en dos líneas en móvil.
                Disquete pulsando = guardando · disquete verde con ✓ = guardado. */}
            {autoguardado === 'guardando' && (
              <span title="Guardando…" aria-label="Guardando…" className="mr-1 animate-pulse text-gris"><Save size={16} /></span>
            )}
            {autoguardado === 'guardado' && (
              <span title="Guardado automáticamente" aria-label="Guardado automáticamente" className="mr-1 flex items-center gap-0.5 text-emerald-600">
                <Save size={16} /><span className="text-[11px] font-bold">✓</span>
              </span>
            )}
            {autoguardado === 'error' && (
              <button type="button" disabled={pendiente} onClick={() => persistir(false)} className="rounded-xl border border-gris-claro bg-white px-4 py-2.5 text-[13px] font-bold transition hover:bg-hueso disabled:opacity-60">
                <Save size={13} className="mr-1 inline -translate-y-px" /> Reintentar
              </button>
            )}
            {!esUltima ? (
              <button type="button" onClick={() => setEtapa(etapas[idx + 1].clave)} className="rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark">
                Siguiente →
              </button>
            ) : (
              <button type="button" disabled={pendiente} onClick={() => persistir(true)} className="rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:opacity-60">
                {pendiente ? 'Enviando…' : 'Enviar evaluación ✓'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
