'use client'

import { useState, useTransition } from 'react'
import { editarFichaPuesto } from './acciones'
import { editarPuesto } from './acciones'
import { Modal } from '@/shared/ui/Modal'
import { Combobox } from '@/shared/ui/Combobox'
import { toast } from '@/shared/ui/Toast'
import { Pencil } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Desplegable, useAccion, Aviso, btnMiniCls, inputCls } from './edicion-inline'

const labelCls = 'mb-1 block text-[10px] font-bold uppercase tracking-wide text-gris'

function BotonesGuardar({ pendiente, onCancelar }: { pendiente: boolean; onCancelar: () => void }) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <button type="submit" disabled={pendiente} className="rounded-lg bg-marca px-4 py-1.5 text-xs font-bold text-white hover:bg-marca-dark disabled:opacity-50">
        {pendiente ? 'Guardando…' : 'Guardar'}
      </button>
      <button type="button" onClick={onCancelar} className={btnMiniCls}>Cancelar</button>
    </div>
  )
}

// ───────────── Propósito y responsabilidades ─────────────

export function CardProposito({ puestoId, descripcion, responsabilidades, puedeGestionar = true }: {
  puestoId: string
  descripcion: string | null
  responsabilidades: string | null
  puedeGestionar?: boolean
}) {
  const { aviso, pendiente, ejecutar } = useAccion()
  const [editando, setEditando] = useState(false)
  const lineas = (responsabilidades ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
  const [items, setItems] = useState<string[]>(lineas.length > 0 ? lineas : [''])

  function abrir() {
    setItems(lineas.length > 0 ? lineas : [''])
    setEditando(true)
  }
  function cambiarItem(i: number, valor: string) {
    setItems((s) => s.map((v, j) => (j === i ? valor : v)))
  }
  function quitarItem(i: number) {
    setItems((s) => (s.length > 1 ? s.filter((_, j) => j !== i) : ['']))
  }

  return (
    <section className="rounded-2xl border border-gris-claro bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-sm font-bold">Propósito y responsabilidades</h3>
        {puedeGestionar && !editando && <button onClick={abrir} className={`${btnMiniCls} shrink-0 border border-gris-claro`}>✎ Editar</button>}
      </div>

      <Desplegable abierto={!editando}>
        {descripcion
          ? <p className="mt-2 text-sm leading-relaxed"><b>Propósito:</b> {descripcion}</p>
          : <p className="mt-2 text-sm italic text-gris">Sin propósito definido: para qué existe el puesto y qué asegura en la operación.</p>}
        {lineas.length > 0 && (
          <ul className="mt-3">
            {lineas.map((l, i) => (
              <li key={i} className="flex items-start gap-2.5 border-b border-gris-claro/50 py-2.5 text-sm last:border-b-0">
                <span className="mt-px font-bold text-marca">›</span>{l}
              </li>
            ))}
          </ul>
        )}
      </Desplegable>

      <Desplegable abierto={editando}>
        <form
          className="mt-2 space-y-3"
          action={(fd) => {
            fd.set('responsabilidades', items.map((l) => l.trim()).filter(Boolean).join('\n'))
            ejecutar(() => editarFichaPuesto(puestoId, fd), () => setEditando(false))
          }}
        >
          <div>
            <label className={labelCls}>Propósito</label>
            <textarea name="descripcion" defaultValue={descripcion ?? ''} rows={2} placeholder="Para qué existe el puesto y qué asegura en la operación…" className={`${inputCls} w-full resize-y leading-relaxed`} autoFocus />
          </div>
          <div>
            <label className={labelCls}>Responsabilidades</label>
            <ul className="space-y-2">
              {items.map((valor, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="font-bold text-marca">›</span>
                  <input
                    value={valor}
                    onChange={(e) => cambiarItem(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); setItems((s) => [...s, '']) }
                    }}
                    placeholder="Describe una responsabilidad…"
                    className={`${inputCls} flex-1`}
                  />
                  <button type="button" onClick={() => quitarItem(i)} className={btnMiniCls} title="Quitar línea">✕</button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setItems((s) => [...s, ''])}
              className="mt-2 rounded-lg border border-dashed border-gris-claro px-3 py-1.5 text-xs font-bold text-gris transition hover:border-marca hover:text-marca"
            >
              ＋ Agregar responsabilidad
            </button>
          </div>
          <BotonesGuardar pendiente={pendiente} onCancelar={() => setEditando(false)} />
        </form>
      </Desplegable>
      <Aviso texto={aviso} />
    </section>
  )
}

// ───────────── Requisitos del puesto ─────────────

const REQUISITOS = [
  ['formacion', 'Formación', 'Ing. Industrial / Adm. o afines'],
  ['experiencia', 'Experiencia', '3+ años liderando equipos'],
  ['certificaciones', 'Certificaciones', 'Gestión de proyectos (deseable)'],
  ['reportaA', 'Reporta a', 'Gerente de País'],
  ['supervisa', 'Supervisa', 'Equipo de operaciones'],
] as const

export function CardRequisitos({ puestoId, valores, puedeGestionar = true }: {
  puestoId: string
  valores: Record<string, string | null>
  puedeGestionar?: boolean
}) {
  const { aviso, pendiente, ejecutar } = useAccion()
  const [editando, setEditando] = useState(false)
  const hayAlguno = REQUISITOS.some(([campo]) => valores[campo])

  return (
    <section className="rounded-2xl border border-gris-claro bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-sm font-bold">Requisitos del puesto</h3>
        {puedeGestionar && !editando && <button onClick={() => setEditando(true)} className={`${btnMiniCls} shrink-0 border border-gris-claro`}>✎ Editar</button>}
      </div>

      <Desplegable abierto={!editando}>
        {hayAlguno ? (
          <ul className="mt-2">
            {REQUISITOS.map(([campo, label]) => (
              <li key={campo} className="flex items-baseline justify-between gap-4 border-b border-gris-claro/50 py-2.5 text-sm last:border-b-0">
                <span className="shrink-0 text-gris">{label}</span>
                <span className="text-right font-semibold">{valores[campo] ?? <span className="font-normal text-gris-claro">—</span>}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm italic text-gris">Sin requisitos definidos: formación, experiencia, certificaciones y líneas de reporte.</p>
        )}
      </Desplegable>

      <Desplegable abierto={editando}>
        <form className="mt-2 space-y-3" action={(fd) => ejecutar(() => editarFichaPuesto(puestoId, fd), () => setEditando(false))}>
          {REQUISITOS.map(([campo, label, placeholder]) => (
            <div key={campo}>
              <label className={labelCls}>{label}</label>
              <input name={campo} defaultValue={valores[campo] ?? ''} placeholder={placeholder} className={`${inputCls} w-full`} />
            </div>
          ))}
          <BotonesGuardar pendiente={pendiente} onCancelar={() => setEditando(false)} />
        </form>
      </Desplegable>
      <Aviso texto={aviso} />
    </section>
  )
}

/** Edición de la identidad del puesto (nombre, nivel, área) desde la cabecera de la ficha. */
export function EditarIdentidadPuesto({ puestoId, nombre, nivelId, areaId, niveles, areas, puedeGestionar = true }: {
  puestoId: string
  nombre: string
  nivelId: string
  areaId: string | null
  niveles: { id: string; nombre: string }[]
  areas: { id: string; nombre: string }[]
  puedeGestionar?: boolean
}) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()
  const inputCls = 'w-full rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none focus:border-marca'

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setAviso(null)
    startTransition(async () => {
      const res = await editarPuesto(puestoId, formData)
      if (!res.ok) { setAviso(res.error); return }
      toast('Puesto actualizado')
      setAbierto(false)
      router.refresh()
    })
  }

  if (!puedeGestionar) return null

  return (
    <>
      <button
        onClick={() => { setAviso(null); setAbierto(true) }}
        title="Editar nombre, nivel y área"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-gris-claro text-gris opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:bg-hueso hover:text-negro"
      >
        <Pencil size={15} />
      </button>
      <Modal titulo="Editar puesto" abierto={abierto} onCerrar={() => setAbierto(false)}>
        <form onSubmit={enviar} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gris">Nombre del puesto</span>
            <input name="nombre" required autoFocus defaultValue={nombre} className={inputCls} />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gris">Nivel jerárquico</span>
              <select name="nivelId" required defaultValue={nivelId} className={inputCls}>
                {niveles.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gris">Área</span>
              <Combobox name="areaId" opciones={areas} valorInicial={areaId ?? ''} textoVacio="Sin área" />
            </label>
          </div>
          <p className="text-[11px] text-gris">Cambiar el nivel cambia qué evaluación aplica a este puesto en los ciclos que se lancen desde ahora; los que están en curso conservan el perfil con el que se lanzaron.</p>
          {aviso && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-alerta-dark">{aviso}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={() => setAbierto(false)} className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">Cancelar</button>
            <button disabled={pendiente} className="rounded-xl bg-marca px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark disabled:opacity-60">
              {pendiente ? 'Guardando…' : 'Guardar ✓'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  )
}
