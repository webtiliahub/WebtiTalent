'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { crearPuesto } from './acciones'
import { Combobox } from '@/shared/ui/Combobox'

const inputCls = 'rounded-lg border border-gris-claro bg-white px-3 py-2 text-sm outline-none focus:border-hunter'

export function FormNuevoPuesto({ areas, niveles }: { areas: { id: string; nombre: string }[]; niveles: { id: string; nombre: string }[] }) {
  const [abierto, setAbierto] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()
  const router = useRouter()

  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)} className="w-full rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark md:w-auto">
        ＋ Crear puesto
      </button>
    )
  }

  function enviar(fd: FormData) {
    setAviso(null)
    startTransition(async () => {
      const res = await crearPuesto(fd)
      if (res.ok) router.push(`/admin/puestos/${res.puestoId}`)
      else setAviso(res.error)
    })
  }

  return (
    <form action={enviar} className="w-full basis-full rounded-2xl border border-gris-claro bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-52 text-xs font-bold text-gris">
          NOMBRE DEL PUESTO
          <input name="nombre" placeholder="p. ej. Analista de Monitoreo" className={`${inputCls} mt-1 w-full`} required minLength={2} autoFocus />
        </label>
        <label className="text-xs font-bold text-gris">
          NIVEL JERÁRQUICO
          <select name="nivelId" className={`${inputCls} mt-1 block`} defaultValue={niveles[0]?.id ?? ''} required>
            {niveles.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
          </select>
        </label>
        <label className="min-w-64 flex-1 text-xs font-bold text-gris">
          ÁREA
          <div className="mt-1 font-normal"><Combobox name="areaId" opciones={areas} textoVacio="Sin área" /></div>
        </label>
        <button type="submit" disabled={pendiente} className="rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:opacity-50">
          {pendiente ? 'Creando…' : 'Crear y abrir descriptor →'}
        </button>
        <button type="button" onClick={() => setAbierto(false)} className="rounded-xl px-3 py-2.5 text-[13px] font-bold text-gris hover:text-negro">Cancelar</button>
      </div>
      <p className="mt-2 text-[11px] text-gris">Al crearlo se abre el descriptor para asociar competencias y definir los pesos por dimensión.</p>
      {aviso && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-hunter-dark">{aviso}</p>}
    </form>
  )
}
