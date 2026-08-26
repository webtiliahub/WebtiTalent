'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { editarObjetivo } from './acciones'
import { Modal } from '@/shared/ui/Modal'
import { toast } from '@/shared/ui/Toast'

const inputCls = 'rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none focus:border-hunter'

export type ObjetivoEditable = {
  id: string
  titulo: string
  descripcion: string
  tipo: string
  peso: number
  metaFecha: string | null
  metrica: string | null
}

/** Separa la métrica "KPI: valor" en sus dos campos del formulario. */
function partesMetrica(metrica: string | null): { kpi: string; valor: string } {
  if (!metrica) return { kpi: '', valor: '' }
  const idx = metrica.indexOf(': ')
  if (idx === -1) return { kpi: metrica, valor: '' }
  return { kpi: metrica.slice(0, idx), valor: metrica.slice(idx + 2) }
}

/** Lápiz que abre el modal de edición de un objetivo existente (dueño no aprobados / jefe aprobados / RR.HH. post-carga).
 * `nota` explica al usuario la consecuencia según su rol (p.ej. "volverá a propuesto"). */
export function BotonEditarObjetivo({ objetivo, maxPeso, nota }: { objetivo: ObjetivoEditable; maxPeso: number; nota?: string }) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()
  const metrica = partesMetrica(objetivo.metrica)

  function cerrar() {
    setAbierto(false)
    setError(null)
  }

  function guardar(formData: FormData) {
    setError(null)
    const kpi = String(formData.get('kpi') ?? '').trim()
    const valorObjetivo = String(formData.get('valorObjetivo') ?? '').trim()
    formData.set('metrica', kpi || valorObjetivo ? `${kpi}: ${valorObjetivo}` : '')
    startTransition(async () => {
      const res = await editarObjetivo(formData)
      if (!res.ok) setError(res.error)
      else { cerrar(); toast('Objetivo actualizado'); router.refresh() }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        title="Editar este objetivo"
        className="rounded-lg border border-gris-claro p-2 text-gris transition hover:border-hunter hover:text-hunter"
      >
        <Pencil size={14} />
      </button>

      <Modal titulo="Editar objetivo" abierto={abierto} onCerrar={cerrar}>
        {nota && <p className="mb-4 rounded-xl bg-hueso-2 px-4 py-2.5 text-xs leading-relaxed text-gris">{nota}</p>}
        {/* onSubmit manual: React 19 resetea el <form action> al terminar y un error
            del servidor borraba los valores editados */}
        <form onSubmit={(e) => { e.preventDefault(); guardar(new FormData(e.currentTarget)) }} className="space-y-4">
          <input type="hidden" name="objetivoId" value={objetivo.id} />

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-gris">Título</span>
            <input name="titulo" required defaultValue={objetivo.titulo} className={`${inputCls} w-full`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-gris">Descripción</span>
            <textarea name="descripcion" required rows={2} defaultValue={objetivo.descripcion} className={`${inputCls} w-full`} />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-gris">KPI / indicador</span>
              <input name="kpi" defaultValue={metrica.kpi} placeholder="Ej: % de incidentes resueltos" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-gris">Valor objetivo</span>
              <input name="valorObjetivo" defaultValue={metrica.valor} placeholder="Ej: ≥ 98%" className={inputCls} />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-gris">Fecha meta</span>
              <input name="metaFecha" type="month" defaultValue={objetivo.metaFecha ?? ''} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-gris">Tipo</span>
              <select name="tipo" defaultValue={objetivo.tipo} className={inputCls}>
                <option value="INDIVIDUAL">Individual — del negocio</option>
                <option value="DESARROLLO">Desarrollo — profesional</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-gris">Peso — máx {maxPeso}%</span>
              <input name="peso" type="number" min={5} max={maxPeso} required defaultValue={objetivo.peso} className={inputCls} />
            </label>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-hunter-dark">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={cerrar} className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">Cancelar</button>
            <button disabled={pendiente} className="rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:opacity-60">
              {pendiente ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  )
}
