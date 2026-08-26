'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { abrirCargaPeriodo, editarAlcancePeriodo, extenderPlazoPeriodo, extenderPlazoColaborador, cerrarPeriodo, enviarRecordatoriosPeriodo, exportarObjetivosPeriodo, eliminarPeriodo } from './acciones-periodo'
import { AlcanceEditor, type CatalogoAlcance, type ColaboradorAlcanceUI } from './AlcanceEditor'
import { previewAlcance, type PreviewAlcance } from '@/features/ciclos/acciones-alcance'
import { BotonEditarObjetivo } from './FormEditarObjetivo'
import { DetalleObjetivo } from './DetalleObjetivo'
import { descargarCsv } from '@/shared/ui/csv'
import { useAccion, Aviso, btnMiniCls, inputCls } from '@/features/admin/edicion-inline'
import { chipPeriodo } from './periodo-ui'
import { confirmar } from '@/shared/ui/Confirmacion'
import { Modal } from '@/shared/ui/Modal'
import { toast } from '@/shared/ui/Toast'

export type PeriodoItem = {
  id: string
  nombre: string
  tipo: 'ANUAL' | 'SEMESTRAL'
  estado: 'BORRADOR' | 'CARGA_ABIERTA' | 'CERRADO'
  fechaLimiteCarga: string // yyyy-mm-dd
  fechaLimiteLabel: string
  dias: number // días hasta el límite (solo display; el vencimiento real viene en `vencido`)
  vencido: boolean
  objetivos: number
  cobertura: { completos: number; total: number } | null
}

/** Botón contextual del tab: lleva al asistente de creación (página dedicada con alcance). */
export function BotonCrearPeriodo() {
  return (
    <Link
      href="/admin/periodos/nuevo"
      // px-4 py-2: mismo tamaño que «Crear ciclo» (BotonLink) — antes era más alto
      className="rounded-xl bg-hunter px-4 py-2 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark"
    >
      ＋ Crear período
    </Link>
  )
}

export function PanelPeriodos({ periodos, puedeGestionar = true }: { periodos: PeriodoItem[]; puedeGestionar?: boolean }) {
  const { aviso, ejecutar } = useAccion()

  return (
    <div className="space-y-4">
      <Aviso texto={aviso} />

      <section className="overflow-hidden rounded-2xl border border-gris-claro bg-white">
        {/* Móvil: el texto de apoyo cae debajo del título (igual que el Card compartido) */}
        <header className="flex flex-col items-start gap-1 border-b border-gris-claro px-5 py-3.5 md:flex-row md:items-center md:justify-between md:gap-4">
          <h3 className="font-display text-sm font-bold">Períodos de objetivos</h3>
          <span className="text-xs text-gris">cada período agrupa la definición de objetivos que evalúan los ciclos</span>
        </header>
        <div className="space-y-2.5 p-5">
          {periodos.length === 0 && (
            <p className="rounded-xl bg-hueso-2 px-4 py-6 text-center text-sm text-gris">
              Aún no hay períodos. Crea el primero (p.ej. &ldquo;2026&rdquo;) con el botón de arriba.
            </p>
          )}
          {periodos.map((p) => {
            const chip = chipPeriodo(p.estado, p.vencido)
            const pct = p.cobertura && p.cobertura.total > 0 ? Math.round((p.cobertura.completos / p.cobertura.total) * 100) : 0
            const derecha = p.estado === 'CERRADO' ? 'cerrado' : p.estado === 'BORRADOR' ? 'sin abrir' : p.vencido ? 'vencido' : `${p.dias} día${p.dias === 1 ? '' : 's'}`
            return (
              <div key={p.id} className="flex items-center rounded-xl border border-gris-claro transition hover:bg-hueso/60">
                {/* Móvil: card apilada (chip arriba, nombre a lo ancho, barra al pie); escritorio: fila */}
                <Link href={`/admin/periodos/${p.id}`} className="block min-w-0 flex-1 px-4 py-3.5 md:flex md:items-center md:gap-4">
                  {/* Móvil: dot + título (se corta con … si es largo) + chip de estado en una fila */}
                  <div className="md:hidden">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: chip.dot }} />
                      <p className="min-w-0 flex-1 truncate text-sm font-bold">Período {p.nombre}</p>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${chip.cls}`}>{chip.label}</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-gris">
                      {p.tipo === 'ANUAL' ? 'Anual' : 'Semestral'} · límite {p.fechaLimiteLabel} · {p.objetivos} objetivos
                    </p>
                    <div className="mt-2.5">
                      <div className="h-2 rounded-full bg-hueso-2">
                        <div className={`h-2 rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-hunter'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <div className="mt-0.5 flex justify-between text-[11px] text-gris">
                        <span>{p.cobertura ? `${pct}%` : '—'}</span><span>{derecha}</span>
                      </div>
                    </div>
                  </div>

                  {/* Escritorio */}
                  <span className="hidden h-2.5 w-2.5 shrink-0 rounded-full md:block" style={{ background: chip.dot }} />
                  <div className="hidden min-w-0 flex-1 md:block">
                    <p className="text-sm font-bold">Período {p.nombre}</p>
                    <p className="text-xs text-gris">
                      {p.tipo === 'ANUAL' ? 'Anual' : 'Semestral'} · límite {p.fechaLimiteLabel} · {p.objetivos} objetivos
                    </p>
                  </div>
                  <span className={`hidden rounded-full px-2.5 py-0.5 text-[11px] font-bold md:inline ${chip.cls}`}>{chip.label}</span>
                  <div className="hidden w-36 shrink-0 md:block">
                    <div className="h-2 rounded-full bg-hueso-2">
                      <div className={`h-2 rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-hunter'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <div className="mt-0.5 flex justify-between text-[11px] text-gris">
                      <span>{p.cobertura ? `${pct}%` : '—'}</span><span>{derecha}</span>
                    </div>
                  </div>
                  <span className="hidden text-gris md:inline">→</span>
                </Link>
                {p.estado === 'BORRADOR' && puedeGestionar && (
                  <button
                    onClick={async () => {
                      const ok = await confirmar(
                        p.objetivos > 0
                          ? `Se eliminará el período «${p.nombre}» y su${p.objetivos === 1 ? '' : 's'} ${p.objetivos} objetivo${p.objetivos === 1 ? '' : 's'} transversal${p.objetivos === 1 ? '' : 'es'} en borrador.`
                          : `Se eliminará el período «${p.nombre}».`,
                        { titulo: 'Eliminar período', textoAceptar: 'Eliminar' },
                      )
                      if (ok) ejecutar(() => eliminarPeriodo(p.id))
                    }}
                    title="Eliminar borrador"
                    className="mr-2 rounded-lg p-1.5 text-gris transition hover:bg-red-50 hover:text-hunter"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

// ───────────── Acciones del período (página de detalle) ─────────────

export function AccionesPeriodo({ periodo }: {
  periodo: { id: string; nombre: string; estado: string; fechaLimiteCarga: string }
}) {
  const router = useRouter()
  const { aviso, pendiente, ejecutar } = useAccion()
  const [extendiendo, setExtendiendo] = useState(false)

  function refrescar() { router.refresh() }

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {periodo.estado === 'BORRADOR' && (
          <button
            onClick={async () => {
              if (!(await confirmar(`Se abrirá la carga de objetivos del período ${periodo.nombre} y se notificará por correo a toda la organización. ¿Continuar?`, { titulo: 'Abrir carga de objetivos', textoAceptar: 'Abrir y notificar' }))) return
              ejecutar(async () => {
                const res = await abrirCargaPeriodo(periodo.id)
                if (res.ok) { toast(`Carga abierta: ${res.notificados} personas notificadas${res.fallidos ? ` · ${res.fallidos} correos fallaron` : ''}`); refrescar() }
                return res.ok ? { ok: true } : res
              })
            }}
            disabled={pendiente}
            className="rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:opacity-50"
          >
            {pendiente ? 'Abriendo…' : 'Abrir carga y notificar'}
          </button>
        )}
        {periodo.estado !== 'BORRADOR' && (
          <button onClick={() => setExtendiendo((v) => !v)} className={`${btnMiniCls} border border-gris-claro`}>
            {periodo.estado === 'CERRADO' ? 'Reabrir con nueva fecha' : 'Extender plazo'}
          </button>
        )}
        {periodo.estado === 'CARGA_ABIERTA' && (
          <button
            onClick={async () => { if (await confirmar(`¿Cerrar el período ${periodo.nombre}? Los objetivos quedarán congelados para su evaluación.`, { titulo: 'Cerrar período', textoAceptar: 'Cerrar período' })) ejecutar(async () => { const r = await cerrarPeriodo(periodo.id); if (r.ok) { toast(`Período ${periodo.nombre} cerrado`); refrescar() } return r }) }}
            disabled={pendiente}
            className={`${btnMiniCls} border border-gris-claro`}
          >Cerrar período</button>
        )}
      </div>
      {extendiendo && (
        <form
          className="absolute right-0 top-full z-20 mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-gris-claro bg-white p-3 shadow-lg"
          action={(fd) => ejecutar(async () => { const r = await extenderPlazoPeriodo(periodo.id, fd); if (r.ok) { toast('Plazo del período actualizado'); refrescar() } return r }, () => setExtendiendo(false))}
        >
          <span className="text-xs font-bold text-gris">Nueva fecha límite:</span>
          <input type="date" name="fechaLimiteCarga" defaultValue={periodo.fechaLimiteCarga} required className={inputCls} autoFocus />
          <button type="submit" disabled={pendiente} className="rounded-lg bg-hunter px-3 py-1.5 text-xs font-bold text-white hover:bg-hunter-dark disabled:opacity-50">Guardar</button>
          <button type="button" onClick={() => setExtendiendo(false)} className={btnMiniCls}>Cancelar</button>
        </form>
      )}
      {aviso && (
        <div className="absolute right-0 top-full z-20 mt-2 w-max max-w-sm">
          <Aviso texto={aviso} />
        </div>
      )}
    </div>
  )
}

// ───────────── Edición de alcance del período (solo BORRADOR) ─────────────

const ENCABEZADO_ALCANCE_PERIODO = '¿A quién aplica este período? Los colaboradores fuera del alcance no verán la carga de objetivos.'

export type AlcancePeriodoActual = { focoPaisIds: string[]; focoAreaIds: string[]; focoNivelIds: string[]; incluirIds: string[]; excluirIds: string[] }

/** Botón + modal para editar el alcance de un período en BORRADOR. Reutiliza el mismo
 * editor de alcance del wizard de creación (AlcanceEditor) — solo mientras el período no
 * abrió su carga, mismo candado que impone `editarAlcancePeriodo` en el servidor. */
export function EditarAlcancePeriodo({ periodoId, alcanceActual, paises, areas, nivelesCatalogo, colaboradores, paisFijo }: {
  periodoId: string
  alcanceActual: AlcancePeriodoActual
  paises: CatalogoAlcance[]
  areas: CatalogoAlcance[]
  nivelesCatalogo: CatalogoAlcance[]
  colaboradores: ColaboradorAlcanceUI[]
  paisFijo?: CatalogoAlcance
}) {
  const [abierto, setAbierto] = useState(false)
  return (
    <>
      <button onClick={() => setAbierto(true)} className={`${btnMiniCls} border border-gris-claro`}>✎ Editar alcance</button>
      <Modal titulo="Editar alcance del período" abierto={abierto} onCerrar={() => setAbierto(false)}>
        <FormularioAlcancePeriodo
          periodoId={periodoId}
          alcanceActual={alcanceActual}
          paises={paises}
          areas={areas}
          nivelesCatalogo={nivelesCatalogo}
          colaboradores={colaboradores}
          paisFijo={paisFijo}
          onCerrar={() => setAbierto(false)}
        />
      </Modal>
    </>
  )
}

/** Se monta de cero cada vez que se abre el modal (Modal desmonta a `children` al cerrar),
 * así el estado del formulario siempre arranca fresco con el alcance vigente del período. */
function FormularioAlcancePeriodo({ periodoId, alcanceActual, paises, areas, nivelesCatalogo, colaboradores, paisFijo, onCerrar }: {
  periodoId: string
  alcanceActual: AlcancePeriodoActual
  paises: CatalogoAlcance[]
  areas: CatalogoAlcance[]
  nivelesCatalogo: CatalogoAlcance[]
  colaboradores: ColaboradorAlcanceUI[]
  paisFijo?: CatalogoAlcance
  onCerrar: () => void
}) {
  const router = useRouter()
  const [focoPaisIds, setFocoPaisIds] = useState<string[]>(alcanceActual.focoPaisIds)
  const [focoAreaIds, setFocoAreaIds] = useState<string[]>(alcanceActual.focoAreaIds)
  const [focoNivelIds, setFocoNivelIds] = useState<string[]>(alcanceActual.focoNivelIds)
  const [incluirIds, setIncluirIds] = useState<string[]>(alcanceActual.incluirIds)
  const [excluirIds, setExcluirIds] = useState<string[]>(alcanceActual.excluirIds)
  const [preview, setPreview] = useState<PreviewAlcance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()
  const [hoy] = useState(() => new Date().toISOString().slice(0, 10))

  // Preview en vivo (debounce), mismo patrón que WizardPeriodo — sin regla de antigüedad.
  useEffect(() => {
    let cancelado = false
    const t = setTimeout(async () => {
      const res = await previewAlcance({
        foco: { focoPaisIds, focoAreaIds, focoNivelIds },
        ajustes: { incluirIds, excluirIds },
        fechaInicio: hoy,
        conAntiguedad: false,
      })
      if (!cancelado && res.ok) setPreview(res.preview)
    }, 400)
    return () => { cancelado = true; clearTimeout(t) }
  }, [focoPaisIds, focoAreaIds, focoNivelIds, incluirIds, excluirIds, hoy])

  function guardar() {
    setError(null)
    startTransition(async () => {
      const res = await editarAlcancePeriodo(periodoId, { focoPaisIds, focoAreaIds, focoNivelIds, incluirIds, excluirIds })
      if (!res.ok) { setError(res.error); return }
      toast('Alcance del período actualizado')
      onCerrar()
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <AlcanceEditor
        encabezado={ENCABEZADO_ALCANCE_PERIODO}
        paises={paises}
        areas={areas}
        nivelesCatalogo={nivelesCatalogo}
        colaboradores={colaboradores}
        paisFijo={paisFijo}
        focoPaisIds={focoPaisIds} setFocoPaisIds={setFocoPaisIds}
        focoAreaIds={focoAreaIds} setFocoAreaIds={setFocoAreaIds}
        focoNivelIds={focoNivelIds} setFocoNivelIds={setFocoNivelIds}
        incluirIds={incluirIds} setIncluirIds={setIncluirIds}
        excluirIds={excluirIds} setExcluirIds={setExcluirIds}
        preview={preview}
      />
      {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-hunter-dark">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCerrar} className={btnMiniCls}>Cancelar</button>
        <button type="button" disabled={pendiente} onClick={guardar} className="rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:opacity-60">
          {pendiente ? 'Guardando…' : 'Guardar alcance ✓'}
        </button>
      </div>
    </div>
  )
}

// ───────────── Envío manual de recordatorios (children de CardRecordatorios) ─────────────

export function BotonEnviarRecordatoriosPeriodo({ periodoId, pendientes }: {
  periodoId: string
  pendientes: number
}) {
  const router = useRouter()
  const { aviso, pendiente, ejecutar } = useAccion()

  return (
    <div className="relative inline-block">
      <button
        onClick={async () => {
          if (!(await confirmar(`Se enviará un recordatorio por correo a las ${pendientes} personas con objetivos incompletos. ¿Continuar?`, { titulo: 'Enviar recordatorios', textoAceptar: 'Enviar' }))) return
          ejecutar(async () => {
            const res = await enviarRecordatoriosPeriodo(periodoId)
            if (res.ok) toast(`${res.enviados} recordatorio${res.enviados === 1 ? '' : 's'} enviado${res.enviados === 1 ? '' : 's'}${res.fallidos ? ` · ${res.fallidos} fallaron (revisar con soporte)` : ''}${res.sinCuenta ? ` · ${res.sinCuenta} pendientes sin cuenta de acceso` : ''}`)
            return res.ok ? { ok: true } : res
          }, () => router.refresh())
        }}
        disabled={pendiente || pendientes === 0}
        className="rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:opacity-50"
      >
        {pendiente ? 'Enviando…' : `Enviar recordatorios ahora (${pendientes})`}
      </button>
      {aviso && (
        <div className="absolute left-0 top-full z-20 mt-2 w-max max-w-sm">
          <Aviso texto={aviso} />
        </div>
      )}
    </div>
  )
}

// ───────────── Extensión individual del plazo (fila de pendiente) ─────────────

export function ExtensionIndividual({ periodoId, colaboradorId, nombre, extensionHasta }: {
  periodoId: string
  colaboradorId: string
  nombre: string
  extensionHasta: string | null
}) {
  const router = useRouter()
  const { aviso, setAviso, pendiente, ejecutar } = useAccion()
  const [abierto, setAbierto] = useState(false)

  function cerrar() {
    setAbierto(false)
    setAviso(null)
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {extensionHasta && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">hasta {extensionHasta}</span>}
      <button
        onClick={() => setAbierto(true)}
        title={`Extender el plazo solo para ${nombre}`}
        className={`${btnMiniCls} border border-gris-claro text-[11px]`}
      >⏱ Extender</button>

      <Modal titulo={`Extender plazo para ${nombre}`} abierto={abierto} onCerrar={cerrar}>
        <p className="mb-4 rounded-xl bg-hueso-2 px-4 py-2.5 text-xs text-gris">
          Solo {nombre} podrá seguir cargando objetivos hasta la fecha que definas; para el resto la ventana no cambia.
        </p>
        <form
          className="flex flex-wrap items-center gap-2"
          action={(fd) => {
            fd.set('colaboradorId', colaboradorId)
            ejecutar(async () => { const r = await extenderPlazoColaborador(periodoId, fd); if (r.ok) { toast(`Plazo extendido para ${nombre}`); router.refresh() } return r }, cerrar)
          }}
        >
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-gris">Nuevo plazo (solo para {nombre})</span>
            <input type="date" name="hasta" required className={inputCls} autoFocus />
          </label>
          <div className="flex items-center gap-2 self-end">
            <button type="button" onClick={cerrar} className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">Cancelar</button>
            <button type="submit" disabled={pendiente} className="rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:opacity-50">
              {pendiente ? 'Guardando…' : 'Extender plazo'}
            </button>
          </div>
        </form>
        {aviso && <p className="mt-3"><Aviso texto={aviso} /></p>}
      </Modal>
    </span>
  )
}

// ───────────── Avance por área (expandible: clic → integrantes) ─────────────

export type ObjetivoIntegrante = {
  id: string
  titulo: string
  descripcion: string
  tipo: string
  peso: number
  metaFecha: string | null
  metrica: string | null
  estado: string
}

export type GrupoArea = {
  area: string
  completos: number
  total: number
  integrantes: {
    id: string
    nombre: string
    total: number
    jefe: string | null
    objetivos: ObjetivoIntegrante[]
    puedeResolver: boolean // aprobar/rechazar propuestas (RR.HH. cubre a quienes no tienen jefe)
    puedeGestionar: boolean // editar/eliminar (sin-jefe con carga abierta, o post-carga corregible)
  }[]
}

export function AvanceAreas({ grupos }: { grupos: GrupoArea[] }) {
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({})

  if (grupos.length === 0) return <p className="text-sm italic text-gris">Sin colaboradores activos.</p>
  return (
    <ul className="space-y-3">
      {grupos.map((g) => {
        const pct = Math.round((g.completos / g.total) * 100)
        const abierta = abiertas[g.area]
        return (
          <li key={g.area}>
            <button
              onClick={() => setAbiertas((s) => ({ ...s, [g.area]: !s[g.area] }))}
              className="w-full rounded-lg px-1 py-1 text-left transition hover:bg-hueso"
              title={abierta ? 'Ocultar integrantes' : 'Ver integrantes'}
            >
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="font-semibold">
                  <span className={`mr-1.5 inline-block text-gris transition-transform ${abierta ? 'rotate-90' : ''}`}>▸</span>
                  {g.area}
                </span>
                <span className="text-xs text-gris">{g.completos}/{g.total} · {pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-hueso-2">
                <div className={`h-2 rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-hunter'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
            </button>
            <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${abierta ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
              <div className={`overflow-hidden transition-opacity duration-300 ${abierta ? 'opacity-100' : 'opacity-0'}`}>
                <ul className="mt-1.5 space-y-1 pb-1 pl-6">
                  {g.integrantes.map((i) => (
                    <IntegrantePeriodo key={i.id} integrante={i} />
                  ))}
                </ul>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const ESTADO_CHIP: Record<string, { label: string; cls: string }> = {
  APROBADO: { label: 'Aprobado', cls: 'bg-emerald-50 text-emerald-700' },
  PROPUESTO: { label: 'Propuesto', cls: 'bg-amber-50 text-amber-700' },
  RECHAZADO: { label: 'Rechazado', cls: 'bg-red-50 text-hunter-dark' },
}

/** Modal con los objetivos de un integrante del período: RR.HH. aprueba/rechaza propuestas de
 * personas sin jefe y, cuando el período lo permite (post-carga sin ciclos lanzados), edita o
 * elimina objetivos. Reutilizado por la fila de "Avance por área" y por el banner de aprobaciones. */
function ModalObjetivosIntegrante({ integrante: i, abierto, onCerrar }: {
  integrante: GrupoArea['integrantes'][number]
  abierto: boolean
  onCerrar: () => void
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pendiente, setPendiente] = useState(false)
  const [detalleId, setDetalleId] = useState<string | null>(null)
  // Los botones de edición aparecen solo al acercar el cursor al borde derecho de la fila
  const [bordeId, setBordeId] = useState<string | null>(null)

  async function resolver(objetivoId: string, decision: 'APROBADO' | 'RECHAZADO') {
    setError(null)
    setPendiente(true)
    const { resolverObjetivo } = await import('./acciones')
    const fd = new FormData()
    fd.set('objetivoId', objetivoId)
    fd.set('decision', decision)
    const res = await resolverObjetivo(fd)
    setPendiente(false)
    if (!res.ok) setError(res.error)
    else { toast(decision === 'APROBADO' ? 'Objetivo aprobado' : 'Objetivo rechazado'); router.refresh() }
  }

  async function eliminar(o: ObjetivoIntegrante) {
    if (!(await confirmar(`¿Eliminar "${o.titulo}" de ${i.nombre}?`, { titulo: 'Eliminar objetivo', textoAceptar: 'Eliminar' }))) return
    setError(null)
    setPendiente(true)
    const { eliminarObjetivo } = await import('./acciones')
    const res = await eliminarObjetivo(o.id)
    setPendiente(false)
    if (!res.ok) setError(res.error)
    else { toast('Objetivo eliminado'); router.refresh() }
  }

  return (
    <Modal titulo={`Objetivos de ${i.nombre}`} abierto={abierto} onCerrar={() => { onCerrar(); setError(null) }}>
        <p className="mb-4 rounded-xl bg-hueso-2 px-4 py-2.5 text-xs text-gris">
          <b className="text-negro">{i.total}%</b> del peso definido (incluye transversales)
          {i.jefe ? <> · sus propuestas las aprueba <b className="text-negro">{i.jefe}</b></> : <> · sin jefe directo: <b className="text-negro">RR.HH. aprueba sus propuestas</b></>}.
        </p>
        {i.objetivos.length === 0 ? (
          <p className="rounded-xl bg-hueso-2 px-4 py-5 text-center text-sm text-gris">Aún no tiene objetivos individuales en este período.</p>
        ) : (
          <ul className="space-y-2.5">
            {i.objetivos.map((o) => {
              const chip = ESTADO_CHIP[o.estado] ?? { label: o.estado, cls: 'bg-hueso-2 text-gris' }
              return (
                <li
                  key={o.id}
                  onClick={() => setDetalleId(o.id)}
                  onMouseMove={(e) => {
                    if (e.clientX > e.currentTarget.getBoundingClientRect().right - 90) setBordeId(o.id)
                  }}
                  onMouseLeave={() => setBordeId((actual) => (actual === o.id ? null : actual))}
                  title="Ver el detalle completo del objetivo (con su descripción)"
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-gris-claro px-4 py-3 transition hover:bg-hueso"
                >
                  <span className="w-12 shrink-0 text-center font-display text-lg font-extrabold tracking-tight text-hunter">{o.peso}%</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{o.titulo}</p>
                    <p className="text-[11px] text-gris">
                      {o.tipo === 'DESARROLLO' ? 'Desarrollo' : 'Individual'}
                      {o.metrica ? ` · ${o.metrica}` : ''}{o.metaFecha ? ` · meta ${o.metaFecha}` : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${chip.cls}`}>{chip.label}</span>
                  {i.puedeResolver && o.estado === 'PROPUESTO' && (
                    <span className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button type="button" disabled={pendiente} onClick={() => resolver(o.id, 'APROBADO')} className="rounded-lg bg-hunter px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-hunter-dark disabled:opacity-60">
                        Aprobar ✓
                      </button>
                      <button type="button" disabled={pendiente} onClick={() => resolver(o.id, 'RECHAZADO')} className="rounded-lg border border-gris-claro px-2.5 py-1.5 text-[11px] font-bold transition hover:bg-hueso disabled:opacity-60">
                        Rechazar
                      </button>
                    </span>
                  )}
                  {i.puedeGestionar && (
                    <span
                      className={`flex shrink-0 items-center gap-1.5 overflow-hidden transition-all duration-200 ${bordeId === o.id ? 'ml-0 max-w-32 opacity-100' : '-ml-3 max-w-0 opacity-0'} focus-within:ml-0 focus-within:max-w-32 focus-within:opacity-100`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <BotonEditarObjetivo
                        objetivo={o}
                        maxPeso={Math.min(100, 100 - i.total + (o.estado === 'APROBADO' ? o.peso : 0))}
                        nota="Estás gestionando este objetivo como RR.HH.: conservará su estado con los cambios que guardes."
                      />
                      <button type="button" disabled={pendiente} onClick={() => eliminar(o)} title="Eliminar este objetivo" className="rounded-lg border border-gris-claro p-2 text-gris transition hover:border-hunter hover:text-hunter disabled:opacity-50">
                        <Trash2 size={14} />
                      </button>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-hunter-dark">{error}</p>}
        {(() => {
          const o = i.objetivos.find((x) => x.id === detalleId)
          return o ? <DetalleObjetivo objetivo={o} estado={o.estado} abierto onCerrar={() => setDetalleId(null)} /> : null
        })()}
    </Modal>
  )
}

/** Fila de integrante en "Avance por área": clic para abrir el popup con sus objetivos. */
function IntegrantePeriodo({ integrante: i }: { integrante: GrupoArea['integrantes'][number] }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <li>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="flex w-full items-center justify-between gap-3 rounded-lg bg-hueso px-3 py-1.5 text-left text-sm transition hover:bg-hueso-2"
        title="Ver sus objetivos del período"
      >
        <span className="min-w-0 flex-1">
          <span className="font-medium">{i.nombre}</span>
          {i.jefe
            ? <span className="ml-2 text-[11px] text-gris">reporta a {i.jefe}</span>
            : <span className="ml-2 text-[11px] font-semibold text-amber-700">sin jefe directo</span>}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${i.total >= 100 ? 'bg-emerald-50 text-emerald-700' : i.total > 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-hunter-dark'}`}>
          {i.total}%
        </span>
      </button>
      <ModalObjetivosIntegrante integrante={i} abierto={abierto} onCerrar={() => setAbierto(false)} />
    </li>
  )
}

/** Banner de aviso para RR.HH.: colaboradores sin jefe directo con propuestas de objetivos
 * esperando su aprobación. Desplegable, con clic por persona para abrir su popup de objetivos. */
export function BannerAprobacionesRrhh({ integrantes }: { integrantes: GrupoArea['integrantes'] }) {
  const [desplegado, setDesplegado] = useState(false)
  const [abiertoId, setAbiertoId] = useState<string | null>(null)
  const pendientes = integrantes
    .map((i) => ({ ...i, propuestas: i.objetivos.filter((o) => o.estado === 'PROPUESTO').length }))
    .filter((i) => i.propuestas > 0)
  if (pendientes.length === 0) return null
  const totalPropuestas = pendientes.reduce((a, i) => a + i.propuestas, 0)

  return (
    <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50/80">
      <button
        type="button"
        onClick={() => setDesplegado((d) => !d)}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left"
        title={desplegado ? 'Ocultar el detalle' : 'Ver quiénes esperan aprobación'}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-100 text-base">🔔</span>
        <span className="min-w-0 flex-1 text-sm text-amber-900">
          <b>{pendientes.length} colaborador{pendientes.length === 1 ? '' : 'es'} sin jefe directo</b>{' '}
          {pendientes.length === 1 ? 'tiene' : 'tienen'} <b>{totalPropuestas} propuesta{totalPropuestas === 1 ? '' : 's'} de objetivos</b> esperando tu aprobación como RR.HH.
        </span>
        <span className={`shrink-0 text-amber-700 transition-transform ${desplegado ? 'rotate-90' : ''}`}>›</span>
      </button>
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${desplegado ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className={`overflow-hidden transition-opacity duration-300 ${desplegado ? 'opacity-100' : 'opacity-0'}`}>
          <ul className="space-y-1.5 px-5 pb-4">
            {pendientes.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => setAbiertoId(i.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl bg-white/70 px-4 py-2.5 text-left text-sm transition hover:bg-white"
                  title="Abrir sus objetivos para aprobar o rechazar"
                >
                  <span className="min-w-0 flex-1 font-semibold">{i.nombre}</span>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">
                    {i.propuestas} propuesta{i.propuestas === 1 ? '' : 's'}
                  </span>
                  <span className="shrink-0 text-xs font-bold text-amber-800">Revisar →</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {pendientes.map((i) => (
        <ModalObjetivosIntegrante key={i.id} integrante={i} abierto={abiertoId === i.id} onCerrar={() => setAbiertoId(null)} />
      ))}
    </div>
  )
}

/** Descarga los objetivos del período en Excel (CSV con BOM), acotados al alcance del RR.HH. */
export function ExportarObjetivosBtn({ periodoId }: { periodoId: string }) {
  const [pendiente, setPendiente] = useState(false)
  return (
    <button
      disabled={pendiente}
      onClick={async () => {
        setPendiente(true)
        try {
          const res = await exportarObjetivosPeriodo(periodoId)
          if (!res.ok) { toast(res.error); return }
          if (res.filas.length <= 1) { toast('El período no tiene objetivos dentro de tu alcance'); return }
          descargarCsv(`objetivos-${res.periodo}-${new Date().toISOString().slice(0, 10)}.csv`, res.filas)
          toast(`Excel descargado: ${res.filas.length - 1} fila${res.filas.length - 1 === 1 ? '' : 's'}`)
        } finally { setPendiente(false) }
      }}
      className="rounded-xl border border-gris-claro bg-white px-3.5 py-1.5 text-xs font-bold transition hover:bg-hueso disabled:opacity-60"
      title="Descarga los objetivos del período (solo tu alcance) en un Excel"
    >
      {pendiente ? 'Generando…' : '⬇ Exportar objetivos (CSV para Excel)'}
    </button>
  )
}
