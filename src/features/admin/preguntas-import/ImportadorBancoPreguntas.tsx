'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Download } from 'lucide-react'
import { descargarXlsx } from '@/shared/ui/xlsx-descarga'
import { toast } from '@/shared/ui/Toast'
import { confirmar } from '@/shared/ui/Confirmacion'
import { hojasPlantillaBanco } from './plantilla'
import { importarBancoPreguntas } from './acciones'
import type { PlanBanco } from './plan'

type Catalogos = { dimensiones: { nombre: string; competencias: { nombre: string }[] }[] }

function stat(valor: number, etiqueta: string, tono = '') {
  return (
    <div className="rounded-xl bg-hueso px-4 py-3 text-center">
      <p className={`font-display text-2xl font-extrabold ${tono}`}>{valor}</p>
      <p className="text-[11px] text-gris">{etiqueta}</p>
    </div>
  )
}

const totalNuevas = (plan: PlanBanco) => plan.competenciasNuevas.length + plan.potencialNuevas.length + plan.descriptoresActualizar.length + plan.potencialActualizar.length

/** Importación del banco de preguntas en dos pasos: analizar (dry-run, sin escribir) y aplicar
 * (solo habilitado con el plan limpio de errores). Mismo espíritu que ImportadorPadron/CargaMaestra. */
export function ImportadorBancoPreguntas({ catalogos }: { catalogos: Catalogos }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [plan, setPlan] = useState<PlanBanco | null>(null)
  const [aplicado, setAplicado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  const correr = (aplicarAhora: boolean) => {
    if (!archivo) return
    startTransition(async () => {
      setError(null)
      const fd = new FormData()
      fd.set('archivo', archivo)
      const res = await importarBancoPreguntas(fd, aplicarAhora)
      if (!res.ok) { setError(res.error); return }
      setPlan(res.plan)
      setAplicado(res.aplicado)
      if (res.aplicado) {
        toast(`Banco actualizado: ${totalNuevas(res.plan)} pregunta(s) nueva(s)`)
        router.refresh()
      }
    })
  }

  const aplicar = async () => {
    if (!plan) return
    const ok = await confirmar(
      `Se crearán ${totalNuevas(plan)} pregunta(s) en el banco. Esta acción no se puede deshacer.`,
      { titulo: 'Aplicar carga del banco', textoAceptar: 'Aplicar carga' },
    )
    if (!ok) return
    correr(true)
  }

  const puedeAplicar = !!plan && !aplicado && plan.errores.length === 0 && totalNuevas(plan) > 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => descargarXlsx('plantilla-banco-preguntas.xlsx', hojasPlantillaBanco(catalogos))}
          className="inline-flex items-center gap-1.5 rounded-xl border border-gris-claro bg-white px-4 py-2 text-[13px] font-bold transition hover:bg-hueso"
        >
          <Download size={15} /> Descargar plantilla
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          onChange={(e) => {
            setArchivo(e.target.files?.[0] ?? null)
            setPlan(null)
            setAplicado(false)
            setError(null)
          }}
          className="text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-hueso-2 file:px-4 file:py-2.5 file:text-[13px] file:font-bold file:text-negro hover:file:bg-gris-claro"
        />
        <button
          disabled={!archivo || pendiente}
          onClick={() => correr(false)}
          className="rounded-xl border border-gris-claro bg-white px-4 py-2 text-[13px] font-bold transition hover:bg-hueso disabled:opacity-50"
        >
          {pendiente ? 'Analizando…' : 'Analizar archivo'}
        </button>
        {plan && !aplicado && (
          <button
            disabled={!puedeAplicar || pendiente}
            onClick={aplicar}
            className="rounded-xl bg-marca px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark disabled:opacity-50"
          >
            {pendiente ? 'Aplicando…' : `Aplicar carga (${totalNuevas(plan)} pregunta${totalNuevas(plan) === 1 ? '' : 's'}) →`}
          </button>
        )}
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-alerta-dark">{error}</p>}

      {plan && (
        <div className="space-y-4">
          {aplicado && (
            <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">Aplicado ✓</p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {stat(plan.competenciasNuevas.length, 'preguntas de competencia nuevas', 'text-emerald-700')}
            {stat(plan.potencialNuevas.length, 'preguntas de potencial nuevas', 'text-emerald-700')}
            {stat(plan.descriptoresActualizar.length + plan.potencialActualizar.length, 'preguntas actualizarán sus descriptores', 'text-sky-700')}
          </div>

          {plan.errores.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50/60 px-4 py-3">
              <p className="mb-1.5 text-[13px] font-bold text-marca-dark">✕ {plan.errores.length} error(es) — corrígelos en el archivo y vuelve a analizar</p>
              <ul className="max-h-64 space-y-0.5 overflow-y-auto text-xs text-negro/80">
                {plan.errores.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          {plan.avisos.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
              <p className="mb-1.5 text-[13px] font-bold text-amber-800">⚠ {plan.avisos.length} aviso(s) — no bloquean, revísalos antes de aplicar</p>
              <ul className="max-h-64 space-y-0.5 overflow-y-auto text-xs text-negro/80">
                {plan.avisos.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
