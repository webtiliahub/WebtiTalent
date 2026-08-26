'use client'

import { useState, useTransition } from 'react'
import { proponerObjetivo } from './acciones'
import { Modal } from '@/shared/ui/Modal'
import { toast } from '@/shared/ui/Toast'

const inputCls = 'rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none focus:border-hunter'

const MESES = [
  ['01', 'Enero'], ['02', 'Febrero'], ['03', 'Marzo'], ['04', 'Abril'], ['05', 'Mayo'], ['06', 'Junio'],
  ['07', 'Julio'], ['08', 'Agosto'], ['09', 'Septiembre'], ['10', 'Octubre'], ['11', 'Noviembre'], ['12', 'Diciembre'],
] as const

/** Píldora SMART que encabeza cada paso del asistente. */
function PildoraSmart({ texto }: { texto: string }) {
  return <span className="inline-flex items-center rounded-full bg-red-50 px-3 py-1 text-[11px] font-bold text-hunter-dark">{texto}</span>
}

/** Datos con los que se puede abrir el modal ya pre-llenado (p. ej. desde una
 * recomendación del plan de desarrollo de la última sesión de feedback). */
export type PrellenadoObjetivo = { titulo?: string; tipo?: 'INDIVIDUAL' | 'DESARROLLO'; metaFecha?: string }

/** Botón "＋ Proponer objetivo" (para la cabecera) que abre el asistente SMART. */
export function FormProponer({ periodoId, disponible }: { periodoId: string; disponible: number }) {
  const [abierto, setAbierto] = useState(false)
  const sinPeso = disponible <= 0

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        disabled={sinPeso}
        title={sinPeso ? 'Ya no tienes peso disponible: tus objetivos suman 100%' : undefined}
        className="rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        ＋ Proponer objetivo
      </button>
      <ModalProponer periodoId={periodoId} disponible={disponible} abierto={abierto} onCerrar={() => setAbierto(false)} />
    </>
  )
}

const TOTAL_PASOS = 4

/** Asistente SMART en 4 pasos (diseño A validado por Christian el 20/08): una pregunta por
 * pantalla, con resumen final para validar antes de enviar y navegación hacia atrás en todos
 * los pasos. El estado es CONTROLADO (no FormData del DOM): los pasos se desmontan al avanzar
 * y el resumen necesita leer todo lo escrito. */
export function ModalProponer({ periodoId, disponible, abierto, onCerrar, prellenado }: {
  periodoId: string
  disponible: number
  abierto: boolean
  onCerrar: () => void
  prellenado?: PrellenadoObjetivo
}) {
  const [paso, setPaso] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  // metaFecha viaja como 'yyyy-mm' (mismo formato que el input type=month anterior)
  const [pre_anio, pre_mes] = (prellenado?.metaFecha ?? '').split('-')
  const [titulo, setTitulo] = useState(prellenado?.titulo ?? '')
  const [descripcion, setDescripcion] = useState('')
  const [kpi, setKpi] = useState('')
  const [valorObjetivo, setValorObjetivo] = useState('')
  const [mes, setMes] = useState(pre_mes ?? '')
  const [anio, setAnio] = useState(pre_anio ?? '')
  const [tipo, setTipo] = useState<'INDIVIDUAL' | 'DESARROLLO'>(prellenado?.tipo ?? 'INDIVIDUAL')
  const pesoMax = Math.max(5, disponible)
  const [peso, setPeso] = useState(Math.min(20, pesoMax))

  const anioActual = new Date().getFullYear()
  const anios = [anioActual, anioActual + 1, anioActual + 2]

  function cerrar() {
    onCerrar()
    setError(null)
    setPaso(1)
  }

  /** Validación del paso actual antes de avanzar; devuelve el mensaje o null. */
  function faltaEnPaso(p: number): string | null {
    if (p === 1) {
      if (!titulo.trim()) return 'Escribe qué vas a lograr.'
      if (!descripcion.trim()) return 'Detalla el alcance y por qué es relevante.'
    }
    if (p === 2) {
      if (!kpi.trim()) return 'Indica el KPI con el que se mide.'
      if (!valorObjetivo.trim()) return 'Indica el valor objetivo (cuánto es éxito).'
      if (!mes || !anio) return 'Elige el mes y el año meta.'
    }
    return null
  }

  function avanzar() {
    const falta = faltaEnPaso(paso)
    if (falta) { setError(falta); return }
    setError(null)
    setPaso((p) => Math.min(TOTAL_PASOS, p + 1))
  }

  function retroceder() {
    setError(null)
    setPaso((p) => Math.max(1, p - 1))
  }

  function enviar() {
    setError(null)
    const fd = new FormData()
    fd.set('periodoId', periodoId)
    fd.set('titulo', titulo.trim())
    fd.set('descripcion', descripcion.trim())
    fd.set('metrica', `${kpi.trim()}: ${valorObjetivo.trim()}`)
    fd.set('metaFecha', `${anio}-${mes}`)
    fd.set('tipo', tipo)
    fd.set('peso', String(peso))
    startTransition(async () => {
      const res = await proponerObjetivo(fd)
      if (!res.ok) setError(res.error)
      else { cerrar(); toast('Propuesta enviada a aprobación') }
    })
  }

  const mesLabel = MESES.find(([v]) => v === mes)?.[1] ?? ''

  return (
    <Modal titulo="Proponer objetivo" abierto={abierto} onCerrar={cerrar} hoja>
      {/* Barra de progreso del asistente */}
      <div className="mb-5 flex gap-1.5" aria-label={`Paso ${paso} de ${TOTAL_PASOS}`}>
        {Array.from({ length: TOTAL_PASOS }, (_, i) => (
          <span key={i} className={`h-1 flex-1 rounded-full transition-colors ${i < paso ? 'bg-hunter' : 'bg-hueso-2'}`} />
        ))}
      </div>

      {paso === 1 && (
        <div className="space-y-4">
          <PildoraSmart texto="S · Específico" />
          <div>
            <label htmlFor="ob-titulo" className="text-[13px] font-bold">¿Qué vas a lograr exactamente?</label>
            <input
              id="ob-titulo" autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ej: Reducir el tiempo de respuesta ante incidentes"
              className={`${inputCls} mt-1.5 w-full`}
            />
            <p className="mt-1 text-[11px] text-gris">Verbo + resultado concreto.</p>
          </div>
          <div>
            <label htmlFor="ob-desc" className="text-[13px] font-bold">¿Por qué es relevante y a quién impacta?</label>
            <textarea
              id="ob-desc" rows={3} value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Qué incluye, a quién impacta y cómo aporta a tu rol y a Hunter"
              className={`${inputCls} mt-1.5 w-full`}
            />
            <p className="mt-1 text-[11px] text-gris">Esto cubre la A y la R de SMART: alcanzable con tus recursos y relevante para el negocio.</p>
          </div>
        </div>
      )}

      {paso === 2 && (
        <div className="space-y-4">
          <PildoraSmart texto="M · Medible  +  T · Tiempo" />
          <div>
            <label htmlFor="ob-kpi" className="text-[13px] font-bold">¿Con qué indicador se mide?</label>
            <input id="ob-kpi" autoFocus value={kpi} onChange={(e) => setKpi(e.target.value)} placeholder="Ej: tiempo promedio de respuesta" className={`${inputCls} mt-1.5 w-full`} />
          </div>
          <div>
            <label htmlFor="ob-valor" className="text-[13px] font-bold">¿Qué valor es éxito?</label>
            <input id="ob-valor" value={valorObjetivo} onChange={(e) => setValorObjetivo(e.target.value)} placeholder="Ej: ≤ 15 minutos" className={`${inputCls} mt-1.5 w-full`} />
          </div>
          <div>
            <span className="text-[13px] font-bold">¿Para cuándo?</span>
            <div className="mt-1.5 grid grid-cols-2 gap-3">
              <select aria-label="Mes meta" value={mes} onChange={(e) => setMes(e.target.value)} className={inputCls}>
                <option value="" disabled>Mes…</option>
                {MESES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
              </select>
              <select aria-label="Año meta" value={anio} onChange={(e) => setAnio(e.target.value)} className={inputCls}>
                <option value="" disabled>Año…</option>
                {anios.map((a) => <option key={a} value={String(a)}>{a}</option>)}
              </select>
            </div>
            <p className="mt-1 text-[11px] text-gris">La fecha meta del objetivo (mes y año).</p>
          </div>
        </div>
      )}

      {paso === 3 && (
        <div className="space-y-4">
          <PildoraSmart texto="Tipo y peso" />
          <div>
            <label htmlFor="ob-tipo" className="text-[13px] font-bold">Tipo de objetivo</label>
            <select id="ob-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as 'INDIVIDUAL' | 'DESARROLLO')} className={`${inputCls} mt-1.5 w-full`}>
              <option value="INDIVIDUAL">Individual — del negocio / tu área</option>
              <option value="DESARROLLO">Desarrollo — crecimiento profesional</option>
            </select>
          </div>
          <div>
            <span className="text-[13px] font-bold">Peso en tu nota</span>
            <div className="mt-2 flex items-center gap-4">
              <button
                type="button" onClick={() => setPeso((p) => Math.max(5, p - 5))} disabled={peso <= 5}
                aria-label="Bajar peso 5%"
                className="grid h-11 w-11 place-items-center rounded-xl border border-gris-claro bg-white text-xl font-extrabold text-hunter transition active:scale-95 disabled:opacity-30"
              >−</button>
              <span className="min-w-[4.5rem] text-center font-display text-2xl font-extrabold">{peso}%</span>
              <button
                type="button" onClick={() => setPeso((p) => Math.min(pesoMax, p + 5))} disabled={peso >= pesoMax}
                aria-label="Subir peso 5%"
                className="grid h-11 w-11 place-items-center rounded-xl border border-gris-claro bg-white text-xl font-extrabold text-hunter transition active:scale-95 disabled:opacity-30"
              >+</button>
            </div>
            <p className="mt-1.5 text-[11px] text-gris">De 5% en 5%, hasta el {pesoMax}% que tienes disponible.</p>
          </div>
        </div>
      )}

      {paso === 4 && (
        <div className="space-y-4">
          <PildoraSmart texto="Revisa y envía" />
          <dl className="space-y-2.5 rounded-xl bg-hueso px-4 py-3.5 text-sm">
            {([
              ['Objetivo', titulo.trim()],
              ['Relevancia', descripcion.trim()],
              ['Se mide con', `${kpi.trim()}: ${valorObjetivo.trim()}`],
              ['Fecha meta', `${mesLabel} ${anio}`],
              ['Tipo', tipo === 'INDIVIDUAL' ? 'Individual — del negocio / tu área' : 'Desarrollo — crecimiento profesional'],
              ['Peso en tu nota', `${peso}%`],
            ] as const).map(([k, v]) => (
              <div key={k}>
                <dt className="text-[10px] font-bold uppercase tracking-wide text-gris">{k}</dt>
                <dd className="text-negro/90">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="rounded-lg bg-hueso-2 px-3 py-2 text-xs text-gris">
            Tu jefe directo revisará la propuesta: puede aprobar el peso, ajustarlo o rechazar el objetivo. Si algo no calza, usa «Atrás» para corregirlo.
          </p>
        </div>
      )}

      {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-hunter-dark">{error}</p>}

      <div className="mt-6 flex items-center gap-2">
        {paso > 1 ? (
          <button type="button" onClick={retroceder} className="rounded-xl bg-hueso-2 px-4 py-2.5 text-[13px] font-bold text-gris transition hover:text-negro">
            ← Atrás
          </button>
        ) : (
          <button type="button" onClick={cerrar} className="rounded-xl px-4 py-2.5 text-[13px] font-bold text-gris transition hover:bg-hueso hover:text-negro">
            Cancelar
          </button>
        )}
        {paso < TOTAL_PASOS ? (
          <button type="button" onClick={avanzar} className="flex-1 rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark">
            Siguiente →
          </button>
        ) : (
          <button type="button" onClick={enviar} disabled={pendiente} className="flex-1 rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:opacity-60">
            {pendiente ? 'Enviando…' : 'Enviar a aprobación →'}
          </button>
        )}
      </div>
    </Modal>
  )
}
