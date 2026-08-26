'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { resolverObjetivo, asignarObjetivo } from './acciones'
import { Modal } from '@/shared/ui/Modal'
import { Combobox } from '@/shared/ui/Combobox'
import { toast } from '@/shared/ui/Toast'

type ObjetivoPendiente = { id: string; titulo: string; descripcion: string; peso: number; colaborador: string; tipo: string; metrica: string | null; metaFecha: string | null }
type Miembro = { id: string; nombre: string; disponible: number }

const inputCls = 'rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none focus:border-hunter'

const MESES_ASIGNAR = [
  ['01', 'Enero'], ['02', 'Febrero'], ['03', 'Marzo'], ['04', 'Abril'], ['05', 'Mayo'], ['06', 'Junio'],
  ['07', 'Julio'], ['08', 'Agosto'], ['09', 'Septiembre'], ['10', 'Octubre'], ['11', 'Noviembre'], ['12', 'Diciembre'],
] as const

function PildoraSmart({ texto }: { texto: string }) {
  return <span className="inline-flex items-center rounded-full bg-red-50 px-3 py-1 text-[11px] font-bold text-hunter-dark">{texto}</span>
}

const TOTAL_PASOS_ASIGNAR = 4

/** Botón "＋ Asignar objetivo" (para la cabecera): mismo asistente SMART de 4 pasos que
 * «Proponer objetivo» (diseño aprobado), con el selector de colaborador en el paso 1 y el
 * stepper de peso limitado al disponible del elegido. El objetivo asignado nace aprobado. */
export function FormAsignar({ periodoId, miembros }: { periodoId: string; miembros: Miembro[] }) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [paso, setPaso] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  const [colaboradorId, setColaboradorId] = useState('')
  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [kpi, setKpi] = useState('')
  const [valorObjetivo, setValorObjetivo] = useState('')
  const [mes, setMes] = useState('')
  const [anio, setAnio] = useState('')
  const [tipo, setTipo] = useState<'INDIVIDUAL' | 'DESARROLLO'>('INDIVIDUAL')
  const [peso, setPeso] = useState(20)

  const elegido = miembros.find((m) => m.id === colaboradorId)
  const pesoMax = Math.max(5, elegido?.disponible ?? 95)
  const anioActual = new Date().getFullYear()
  const anios = [anioActual, anioActual + 1, anioActual + 2]

  function cerrar() {
    setAbierto(false)
    setError(null)
    setPaso(1)
    setColaboradorId('')
  }

  function faltaEnPaso(p: number): string | null {
    if (p === 1) {
      if (!colaboradorId) return 'Elige a quién le asignas el objetivo.'
      if (!titulo.trim()) return 'Escribe qué debe lograr.'
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
    if (paso === 1) setPeso((p) => Math.min(p, pesoMax)) // el disponible depende del elegido
    setPaso((p) => Math.min(TOTAL_PASOS_ASIGNAR, p + 1))
  }

  function retroceder() {
    setError(null)
    setPaso((p) => Math.max(1, p - 1))
  }

  function asignar() {
    setError(null)
    const fd = new FormData()
    fd.set('periodoId', periodoId)
    fd.set('colaboradorId', colaboradorId)
    fd.set('titulo', titulo.trim())
    fd.set('descripcion', descripcion.trim())
    fd.set('metrica', `${kpi.trim()}: ${valorObjetivo.trim()}`)
    fd.set('metaFecha', `${anio}-${mes}`)
    fd.set('tipo', tipo)
    fd.set('peso', String(peso))
    const nombreElegido = elegido?.nombre
    startTransition(async () => {
      const res = await asignarObjetivo(fd)
      if (!res.ok) setError(res.error)
      else { cerrar(); toast(`Objetivo asignado a ${nombreElegido ?? 'tu colaborador'}`); router.refresh() }
    })
  }

  const mesLabel = MESES_ASIGNAR.find(([v]) => v === mes)?.[1] ?? ''

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        disabled={miembros.length === 0}
        title={miembros.length === 0 ? 'No tienes equipo directo a cargo' : undefined}
        className="rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        ＋ Asignar objetivo
      </button>

      <Modal titulo="Asignar objetivo a tu equipo" abierto={abierto} onCerrar={cerrar} hoja>
        <div className="mb-5 flex gap-1.5" aria-label={`Paso ${paso} de ${TOTAL_PASOS_ASIGNAR}`}>
          {Array.from({ length: TOTAL_PASOS_ASIGNAR }, (_, i) => (
            <span key={i} className={`h-1 flex-1 rounded-full transition-colors ${i < paso ? 'bg-hunter' : 'bg-hueso-2'}`} />
          ))}
        </div>

        {paso === 1 && (
          <div className="space-y-4">
            <PildoraSmart texto="S · Específico" />
            <div>
              <span className="text-[13px] font-bold">¿Para quién?</span>
              <div className="mt-1.5">
                <Combobox
                  name="as-colaborador"
                  opciones={miembros.map((m) => ({ id: m.id, nombre: m.nombre.split(' · ')[0].replace(' (tú)', ''), detalle: `${m.nombre.includes('sin jefe directo') ? 'sin jefe directo · ' : ''}disponible ${m.disponible}%` }))}
                  valorInicial={colaboradorId}
                  textoVacio="Elige a un miembro de tu equipo…"
                  onChange={(id) => setColaboradorId(id)}
                />
              </div>
            </div>
            <div>
              <label htmlFor="as-titulo" className="text-[13px] font-bold">¿Qué debe lograr exactamente?</label>
              <input
                id="as-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ej: Elevar la precisión del registro de incidentes"
                className={`${inputCls} mt-1.5 w-full`}
              />
              <p className="mt-1 text-[11px] text-gris">Verbo + resultado concreto.</p>
            </div>
            <div>
              <label htmlFor="as-desc" className="text-[13px] font-bold">¿Por qué es relevante y a quién impacta?</label>
              <textarea
                id="as-desc" rows={3} value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Qué incluye, a quién impacta y cómo aporta a su rol y a Hunter"
                className={`${inputCls} mt-1.5 w-full`}
              />
              <p className="mt-1 text-[11px] text-gris">Esto cubre la A y la R de SMART: alcanzable con sus recursos y relevante para el negocio.</p>
            </div>
          </div>
        )}

        {paso === 2 && (
          <div className="space-y-4">
            <PildoraSmart texto="M · Medible  +  T · Tiempo" />
            <div>
              <label htmlFor="as-kpi" className="text-[13px] font-bold">¿Con qué indicador se mide?</label>
              <input id="as-kpi" autoFocus value={kpi} onChange={(e) => setKpi(e.target.value)} placeholder="Ej: % de incidentes bien registrados" className={`${inputCls} mt-1.5 w-full`} />
            </div>
            <div>
              <label htmlFor="as-valor" className="text-[13px] font-bold">¿Qué valor es éxito?</label>
              <input id="as-valor" value={valorObjetivo} onChange={(e) => setValorObjetivo(e.target.value)} placeholder="Ej: ≥ 98%" className={`${inputCls} mt-1.5 w-full`} />
            </div>
            <div>
              <span className="text-[13px] font-bold">¿Para cuándo?</span>
              <div className="mt-1.5 grid grid-cols-2 gap-3">
                <select aria-label="Mes meta" value={mes} onChange={(e) => setMes(e.target.value)} className={inputCls}>
                  <option value="" disabled>Mes…</option>
                  {MESES_ASIGNAR.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
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
              <label htmlFor="as-tipo" className="text-[13px] font-bold">Tipo de objetivo</label>
              <select id="as-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as 'INDIVIDUAL' | 'DESARROLLO')} className={`${inputCls} mt-1.5 w-full`}>
                <option value="INDIVIDUAL">Individual — del negocio / su área</option>
                <option value="DESARROLLO">Desarrollo — crecimiento profesional</option>
              </select>
            </div>
            <div>
              <span className="text-[13px] font-bold">Peso en su nota</span>
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
              <p className="mt-1.5 text-[11px] text-gris">De 5% en 5%, hasta el {pesoMax}% disponible de {elegido?.nombre ?? 'tu colaborador'}.</p>
            </div>
          </div>
        )}

        {paso === 4 && (
          <div className="space-y-4">
            <PildoraSmart texto="Revisa y asigna" />
            <dl className="space-y-2.5 rounded-xl bg-hueso px-4 py-3.5 text-sm">
              {([
                ['Para', elegido?.nombre ?? ''],
                ['Objetivo', titulo.trim()],
                ['Relevancia', descripcion.trim()],
                ['Se mide con', `${kpi.trim()}: ${valorObjetivo.trim()}`],
                ['Fecha meta', `${mesLabel} ${anio}`],
                ['Tipo', tipo === 'INDIVIDUAL' ? 'Individual — del negocio / su área' : 'Desarrollo — crecimiento profesional'],
                ['Peso en su nota', `${peso}%`],
              ] as const).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-gris">{k}</dt>
                  <dd className="text-negro/90">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="rounded-lg bg-hueso-2 px-3 py-2 text-xs text-gris">
              El objetivo asignado <b className="text-negro">nace aprobado</b>, sin pasar por propuesta. Si algo no calza, usa «Atrás» para corregirlo.
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
          {paso < TOTAL_PASOS_ASIGNAR ? (
            <button type="button" onClick={avanzar} className="flex-1 rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark">
              Siguiente →
            </button>
          ) : (
            <button type="button" onClick={asignar} disabled={pendiente} className="flex-1 rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:opacity-60">
              {pendiente ? 'Asignando…' : 'Asignar objetivo →'}
            </button>
          )}
        </div>
      </Modal>
    </>
  )
}

export function PanelObjetivosEquipo({ pendientes }: { pendientes: ObjetivoPendiente[] }) {
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  function decidir(objetivoId: string, decision: 'APROBADO' | 'RECHAZADO', peso?: number) {
    setError(null)
    const fd = new FormData()
    fd.set('objetivoId', objetivoId)
    fd.set('decision', decision)
    if (peso !== undefined) fd.set('peso', String(peso))
    startTransition(async () => {
      const res = await resolverObjetivo(fd)
      if (!res.ok) setError(res.error)
      else toast(decision === 'APROBADO' ? 'Objetivo aprobado' : 'Objetivo rechazado')
    })
  }

  return (
    <div className="space-y-5">
      {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-hunter-dark">{error}</p>}

      <section className="rounded-2xl border border-gris-claro bg-white">
        <header className="flex justify-between border-b border-gris-claro px-5 py-3.5">
          <h3 className="font-display text-sm font-bold">Propuestas por aprobar</h3>
          <span className="text-xs text-gris">{pendientes.length} pendientes · tú defines el peso final</span>
        </header>
        <div className="p-5">
          {pendientes.length === 0 ? (
            <p className="rounded-xl bg-hueso-2 px-4 py-5 text-center text-sm text-gris">No hay propuestas pendientes de tu equipo.</p>
          ) : (
            <ul className="space-y-3">
              {pendientes.map((o) => (
                <PropuestaFila key={o.id} o={o} onDecidir={decidir} deshabilitado={pendiente} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

function PropuestaFila({ o, onDecidir, deshabilitado }: {
  o: ObjetivoPendiente
  onDecidir: (id: string, d: 'APROBADO' | 'RECHAZADO', peso?: number) => void
  deshabilitado: boolean
}) {
  const [peso, setPeso] = useState(o.peso)
  return (
    <li className="rounded-xl border border-gris-claro px-4 py-3">
      {/* En móvil el título toma el ancho completo y los controles bajan a su propia fila —
          compartir fila con peso + 3 botones lo aplastaba a una columna angosta */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full min-w-0 md:w-auto md:flex-1">
          <p className="text-sm font-semibold">{o.titulo} <span className="ml-1 rounded-full bg-hueso-2 px-2 py-0.5 text-[10px] font-semibold text-gris">{o.tipo === 'DESARROLLO' ? 'Desarrollo' : 'Individual'}</span></p>
          <p className="text-xs text-gris">{o.colaborador} · {o.descripcion}</p>
        </div>
        <label className="flex items-center gap-2 text-[13px] font-bold">
          Peso
          <input
            type="number" min={5} max={100} value={peso} disabled={deshabilitado}
            onChange={(e) => setPeso(Number(e.target.value))}
            className="w-20 rounded-xl border border-gris-claro px-3 py-2.5 text-right text-sm font-bold outline-none focus:border-hunter"
          />%
        </label>
        <div className="grid w-full grid-cols-2 gap-2 md:ml-auto md:flex md:w-auto">
          <button type="button" disabled={deshabilitado} onClick={() => onDecidir(o.id, 'APROBADO', peso)} className="rounded-xl bg-hunter px-4 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:opacity-60">
            Aprobar ✓
          </button>
          <AjustarYAprobar o={o} deshabilitado={deshabilitado} />
          <button type="button" disabled={deshabilitado} onClick={() => onDecidir(o.id, 'RECHAZADO')} className="col-span-2 rounded-xl border border-gris-claro px-4 py-2.5 text-[13px] font-bold transition hover:bg-hueso disabled:opacity-60 md:col-auto">
            Rechazar
          </button>
        </div>
      </div>
    </li>
  )
}

/** El jefe ajusta la propuesta (título, métrica, fecha, tipo o peso) y la aprueba en un paso:
 * la propuesta original queda rechazada y el objetivo vigente es la versión del jefe. */
function AjustarYAprobar({ o, deshabilitado }: { o: ObjetivoPendiente; deshabilitado: boolean }) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()
  const idx = (o.metrica ?? '').indexOf(': ')
  const kpiActual = idx === -1 ? (o.metrica ?? '') : o.metrica!.slice(0, idx)
  const valorActual = idx === -1 ? '' : o.metrica!.slice(idx + 2)

  function cerrar() {
    setAbierto(false)
    setError(null)
  }

  function enviar(formData: FormData) {
    setError(null)
    const kpi = String(formData.get('kpi') ?? '').trim()
    const valorObjetivo = String(formData.get('valorObjetivo') ?? '').trim()
    formData.set('metrica', kpi || valorObjetivo ? `${kpi}: ${valorObjetivo}` : '')
    formData.set('objetivoId', o.id)
    formData.set('decision', 'APROBADO')
    startTransition(async () => {
      const res = await resolverObjetivo(formData)
      if (!res.ok) setError(res.error)
      else { cerrar(); toast('Objetivo ajustado y aprobado'); router.refresh() }
    })
  }

  return (
    <>
      <button type="button" disabled={deshabilitado} onClick={() => setAbierto(true)} className="rounded-xl border border-hunter/40 px-4 py-2.5 text-[13px] font-bold text-hunter transition hover:bg-hunter/5 disabled:opacity-60">
        ✎ Ajustar y aprobar
      </button>

      <Modal titulo="Ajustar y aprobar la propuesta" abierto={abierto} onCerrar={cerrar}>
        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800">
          Si modificas el contenido, la propuesta de <b>{o.colaborador}</b> quedará registrada como <b>rechazada</b> y
          el objetivo vigente será esta versión tuya, ya <b>aprobada</b>. {o.colaborador} recibirá el aviso.
        </p>
        <form action={enviar} className="space-y-4">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-gris">Título</span>
            <input name="titulo" required defaultValue={o.titulo} className={`${inputCls} w-full`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-gris">Descripción</span>
            <textarea name="descripcion" required rows={2} defaultValue={o.descripcion} className={`${inputCls} w-full`} />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-gris">KPI / indicador</span>
              <input name="kpi" defaultValue={kpiActual} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-gris">Valor objetivo</span>
              <input name="valorObjetivo" defaultValue={valorActual} className={inputCls} />
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-gris">Fecha meta</span>
              <input name="metaFecha" type="month" defaultValue={o.metaFecha ?? ''} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-gris">Tipo</span>
              <select name="tipo" defaultValue={o.tipo} className={inputCls}>
                <option value="INDIVIDUAL">Individual — del negocio</option>
                <option value="DESARROLLO">Desarrollo — profesional</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-gris">Peso final</span>
              <input name="peso" type="number" min={5} max={100} required defaultValue={o.peso} className={inputCls} />
            </label>
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-hunter-dark">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={cerrar} className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">Cancelar</button>
            <button disabled={pendiente} className="rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:opacity-60">
              {pendiente ? 'Aprobando…' : 'Aprobar esta versión ✓'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  )
}
