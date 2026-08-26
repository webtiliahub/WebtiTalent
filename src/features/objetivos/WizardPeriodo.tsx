'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { crearPeriodo } from './acciones-periodo'
import { previewAlcance, type PreviewAlcance } from '@/features/ciclos/acciones-alcance'
import { resumenAlcance } from '@/features/ciclos/alcance'
import { AlcanceEditor, type CatalogoAlcance, type ColaboradorAlcanceUI } from './AlcanceEditor'

const ENCABEZADO_ALCANCE = '¿A quién aplica este período? Los colaboradores fuera del alcance no verán la carga de objetivos.'

/** Asistente de creación de un período de objetivos: mismos pasos/estructura visual que
 * WizardCiclo (breadcrumb, card blanca, botones Anterior/Siguiente) — pero solo 3 pasos,
 * sin evaluaciones (eso es un concepto de ciclo, no de período). */
export function WizardPeriodo({ paises, areas, nivelesCatalogo, colaboradores, paisFijo }: {
  paises: CatalogoAlcance[]
  areas: CatalogoAlcance[]
  nivelesCatalogo: CatalogoAlcance[]
  colaboradores: ColaboradorAlcanceUI[]
  paisFijo?: CatalogoAlcance
}) {
  const router = useRouter()
  const [paso, setPaso] = useState(1)
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState<'ANUAL' | 'SEMESTRAL'>('ANUAL')
  const [fechaLimiteCarga, setFechaLimiteCarga] = useState('')
  const [focoPaisIds, setFocoPaisIds] = useState<string[]>(paisFijo ? [paisFijo.id] : [])
  const [focoAreaIds, setFocoAreaIds] = useState<string[]>([])
  const [focoNivelIds, setFocoNivelIds] = useState<string[]>([])
  const [incluirIds, setIncluirIds] = useState<string[]>([])
  const [excluirIds, setExcluirIds] = useState<string[]>([])
  const [preview, setPreview] = useState<PreviewAlcance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()
  const [hoy] = useState(() => new Date().toISOString().slice(0, 10))

  // Preview en vivo del alcance (debounce), SIN regla de antigüedad: un período nunca la aplica
  // (un ingreso reciente también carga objetivos) — mismo resolutor que crearPeriodo/lanzarCiclo.
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

  const puedeAvanzar = paso === 1
    ? nombre.trim().length >= 2 && fechaLimiteCarga !== ''
    : true

  function crear() {
    setError(null)
    const fd = new FormData()
    fd.set('nombre', nombre)
    fd.set('tipo', tipo)
    fd.set('fechaLimiteCarga', fechaLimiteCarga)
    const alcance = { focoPaisIds, focoAreaIds, focoNivelIds, incluirIds, excluirIds }
    startTransition(async () => {
      const res = await crearPeriodo(fd, alcance)
      if (!res.ok) { setError(res.error); return }
      // La pestaña activa de /admin/ciclos es solo estado de cliente (sin querystring):
      // vuelve a abrir en "Ciclos" — coherente con el resto de asistentes de esta página.
      router.push('/admin/ciclos')
      router.refresh()
    })
  }

  const inputCls = 'w-full rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none focus:border-marca'
  const pasos = ['Datos del período', 'Alcance', 'Revisión']

  return (
    <div className="space-y-4">
      {/* indicador de pasos */}
      <div className="flex gap-2">
        {pasos.map((p, i) => (
          <div key={p} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold ${paso === i + 1 ? 'bg-blue-50 text-marca-dark ring-1 ring-marca/30' : paso > i + 1 ? 'bg-emerald-50 text-emerald-700' : 'bg-hueso-2 text-gris'}`}>
            <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${paso === i + 1 ? 'bg-marca text-white' : paso > i + 1 ? 'bg-emerald-500 text-white' : 'bg-gris-claro text-gris'}`}>
              {paso > i + 1 ? '✓' : i + 1}
            </span>
            {p}
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-gris-claro bg-white p-5">
        {paso === 1 && (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="md:col-span-2">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gris">Nombre del período</span>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="2026, 2026-S1…" className={inputCls} autoFocus />
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gris">Tipo</span>
              <select value={tipo} onChange={(e) => setTipo(e.target.value as 'ANUAL' | 'SEMESTRAL')} className={inputCls}>
                <option value="ANUAL">Anual</option>
                <option value="SEMESTRAL">Semestral</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gris">Límite de carga</span>
              <input type="date" value={fechaLimiteCarga} onChange={(e) => setFechaLimiteCarga(e.target.value)} className={inputCls} />
            </label>
          </div>
        )}

        {paso === 2 && (
          <AlcanceEditor
            encabezado={ENCABEZADO_ALCANCE}
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
        )}

        {paso === 3 && (
          <div className="space-y-3 text-sm">
            <h4 className="font-display text-base font-bold">Revisión final</h4>
            <ul className="space-y-1.5">
              <li><b>Nombre:</b> {nombre}</li>
              <li><b>Tipo:</b> {tipo === 'ANUAL' ? 'Anual' : 'Semestral'}</li>
              <li><b>Límite de carga:</b> {fechaLimiteCarga ? new Date(`${fechaLimiteCarga}T00:00:00`).toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</li>
              <li><b>Alcance:</b> {resumenAlcance(
                { focoPaisIds, focoAreaIds, focoNivelIds },
                {
                  paises: new Map(paises.map((p) => [p.id, p.nombre])),
                  areas: new Map(areas.map((a) => [a.id, a.nombre])),
                  niveles: new Map(nivelesCatalogo.map((n) => [n.id, n.nombre])),
                },
                { incluidos: incluirIds.length, excluidos: excluirIds.length },
              )} — {preview?.total ?? '…'} evaluados</li>
            </ul>
            <p className="rounded-xl bg-hueso-2 px-4 py-2.5 text-xs text-gris">
              El período se crea en estado <b>Borrador</b>: desde su detalle podrás ajustar el alcance mientras no abras la carga, y luego <b>abrir la carga</b> para notificar a la organización.
            </p>
          </div>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-alerta-dark">{error}</p>}

      <div className="flex justify-between">
        <button type="button" disabled={paso === 1} onClick={() => setPaso((p) => p - 1)} className="rounded-xl border border-gris-claro bg-white px-4 py-2.5 text-[13px] font-bold transition hover:bg-hueso disabled:opacity-40">
          ← Anterior
        </button>
        {paso < 3 ? (
          <span className="flex items-center gap-3">
            {!puedeAvanzar && paso === 1 && (
              <span className="text-xs text-gris">
                Falta: {[
                  nombre.trim().length < 2 ? 'nombre' : null,
                  !fechaLimiteCarga ? 'límite de carga' : null,
                ].filter(Boolean).join(', ')}
              </span>
            )}
            <button type="button" disabled={!puedeAvanzar} onClick={() => setPaso((p) => p + 1)} className="rounded-xl bg-marca px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark disabled:opacity-50">
              Siguiente →
            </button>
          </span>
        ) : (
          <button type="button" disabled={pendiente} onClick={crear} className="rounded-xl bg-marca px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark disabled:opacity-60">
            {pendiente ? 'Creando…' : 'Crear período ✓'}
          </button>
        )}
      </div>
    </div>
  )
}
