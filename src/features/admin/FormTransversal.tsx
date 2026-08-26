'use client'

import { useState, useTransition } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { crearTransversal, editarTransversal, eliminarTransversal, cargarLogroTransversal } from './acciones'
import { Modal } from '@/shared/ui/Modal'
import { SelectorMultiple } from '@/shared/ui/SelectorMultiple'
import { toast } from '@/shared/ui/Toast'
import { confirmar } from '@/shared/ui/Confirmacion'

/** Botón "＋ Añadir transversal" (para la cabecera) que abre el modal de creación. */
export function FormTransversal({ periodoId, areas, niveles, paises, puestos }: {
  periodoId: string
  areas: { id: string; nombre: string }[]
  niveles: { id: string; nombre: string }[]
  paises: { id: string; nombre: string }[]
  puestos: { id: string; nombre: string }[]
}) {
  const [abierto, setAbierto] = useState(false)
  const [areaIds, setAreaIds] = useState<string[]>([])
  const [nivelIds, setNivelIds] = useState<string[]>([])
  const [paisIds, setPaisIds] = useState<string[]>([])
  const [puestoIds, setPuestoIds] = useState<string[]>([])
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  function cerrar() {
    setAbierto(false)
    setAviso(null)
    setAreaIds([]); setNivelIds([]); setPaisIds([]); setPuestoIds([])
  }

  function enviar(formData: FormData) {
    setAviso(null)
    startTransition(async () => {
      const res = await crearTransversal(formData, { areaIds, nivelIds, paisIds, puestoIds })
      if (!res.ok) setAviso(res.error)
      else { cerrar(); toast(`Objetivo transversal creado${res.notificados ? ` · ${res.notificados} personas avisadas para ajustar pesos` : ''}`) }
    })
  }

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className="w-full rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark md:w-auto"
      >
        ＋ Añadir objetivo transversal
      </button>

      <Modal titulo="Nuevo objetivo transversal" abierto={abierto} onCerrar={cerrar}>
        <form action={enviar}>
          <input type="hidden" name="periodoId" value={periodoId} />
          <div className="grid gap-3 md:grid-cols-3">
            <input name="titulo" required placeholder="Título del objetivo…" autoFocus className="rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none focus:border-hunter md:col-span-2" />
            <input name="peso" type="number" min={5} max={100} required placeholder="Peso (%)" className="rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none focus:border-hunter" />
            <textarea name="descripcion" rows={2} placeholder="Descripción…" className="rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none focus:border-hunter md:col-span-2" />
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-gris">Fecha meta (opcional)</span>
              <input name="metaFecha" type="month" className="rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none" />
            </label>
          </div>

          <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-gris">
            Focalización <span className="font-normal normal-case text-gris">· sin selección = toda la organización</span>
          </p>
          <div className="grid gap-3 md:grid-cols-4">
            <SelectorMultiple etiqueta="Países" opciones={paises} seleccion={paisIds} onCambio={setPaisIds} textoVacio="Todos los países" />
            <SelectorMultiple etiqueta="Niveles" opciones={niveles} seleccion={nivelIds} onCambio={setNivelIds} textoVacio="Todos los niveles" />
            <SelectorMultiple etiqueta="Áreas" opciones={areas} seleccion={areaIds} onCambio={setAreaIds} textoVacio="Todas las áreas" />
            <SelectorMultiple etiqueta="Puestos" opciones={puestos} seleccion={puestoIds} onCambio={setPuestoIds} textoVacio="Todos los puestos" />
          </div>

          {aviso && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-hunter-dark">{aviso}</p>}
          <div className="mt-5 flex items-center justify-end gap-2">
            <button type="button" onClick={cerrar} className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">Cancelar</button>
            <button disabled={pendiente} className="rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:opacity-60">
              {pendiente ? 'Creando…' : 'Crear transversal →'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  )
}

export type TransversalItem = {
  id: string
  titulo: string
  descripcion: string | null
  peso: number
  metaFecha: string | null
  focoAreaIds: string[]
  focoNivelIds: string[]
  focoPaisIds: string[]
  focoPuestoIds: string[]
}

/** Lápiz + papelera por transversal: edición en modal y eliminación con confirmación.
 * Cualquier cambio que descuadre el 100% de alguien dispara el aviso por correo (lado servidor). */
export function AccionesTransversal({ objetivo, areas, niveles, paises, puestos, tieneLogros, congelado = false }: {
  objetivo: TransversalItem
  areas: { id: string; nombre: string }[]
  niveles: { id: string; nombre: string }[]
  paises: { id: string; nombre: string }[]
  puestos: { id: string; nombre: string }[]
  tieneLogros: boolean
  congelado?: boolean // el período ya fue evaluado por un ciclo cerrado: historial intocable
}) {
  const [abierto, setAbierto] = useState(false)
  const [areaIds, setAreaIds] = useState<string[]>(objetivo.focoAreaIds)
  const [nivelIds, setNivelIds] = useState<string[]>(objetivo.focoNivelIds)
  const [paisIds, setPaisIds] = useState<string[]>(objetivo.focoPaisIds)
  const [puestoIds, setPuestoIds] = useState<string[]>(objetivo.focoPuestoIds)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  function cerrar() {
    setAbierto(false)
    setAviso(null)
    setAreaIds(objetivo.focoAreaIds); setNivelIds(objetivo.focoNivelIds); setPaisIds(objetivo.focoPaisIds); setPuestoIds(objetivo.focoPuestoIds)
  }

  function guardar(formData: FormData) {
    setAviso(null)
    startTransition(async () => {
      const res = await editarTransversal(objetivo.id, formData, { areaIds, nivelIds, paisIds, puestoIds })
      if (!res.ok) setAviso(res.error)
      else { setAbierto(false); toast(`Transversal actualizado${res.notificados ? ` · ${res.notificados} personas avisadas para ajustar pesos` : ''}`) }
    })
  }

  async function eliminar() {
    if (!(await confirmar(`¿Eliminar "${objetivo.titulo}"? Su peso se libera en todos los alcanzados y quienes estaban al 100% quedarán descuadrados.`, { titulo: 'Eliminar transversal', textoAceptar: 'Eliminar' }))) return
    startTransition(async () => {
      const res = await eliminarTransversal(objetivo.id)
      if (!res.ok) toast(res.error, 'error')
      else toast(`Transversal eliminado${res.notificados ? ` · ${res.notificados} personas avisadas para ajustar pesos` : ''}`)
    })
  }

  return (
    <span className="flex items-center gap-1 self-center">
      <button
        onClick={() => setAbierto(true)}
        disabled={pendiente || congelado}
        title={congelado ? 'El ciclo que evaluó este período ya cerró: es historial' : 'Editar transversal'}
        className="grid h-8 w-8 place-items-center rounded-lg text-gris transition hover:bg-hueso hover:text-negro disabled:cursor-not-allowed disabled:opacity-30"
      ><Pencil size={14} /></button>
      <button
        onClick={eliminar}
        disabled={pendiente || tieneLogros || congelado}
        title={congelado ? 'El ciclo que evaluó este período ya cerró: es historial' : tieneLogros ? 'Ya tiene logros cargados: no se puede eliminar' : 'Eliminar transversal'}
        className="grid h-8 w-8 place-items-center rounded-lg text-gris transition hover:bg-red-50 hover:text-hunter disabled:cursor-not-allowed disabled:opacity-30"
      ><Trash2 size={14} /></button>

      <Modal titulo="Editar objetivo transversal" abierto={abierto} onCerrar={cerrar}>
        <p className="mb-4 rounded-xl bg-hueso-2 px-4 py-2.5 text-xs leading-relaxed text-gris">
          Si cambias el <b className="text-negro">peso</b> o la <b className="text-negro">focalización</b>, los totales por colaborador pueden dejar de sumar 100%.
          Quienes ya estaban completos recibirán un <b className="text-negro">aviso por correo</b> para ajustar sus pesos.
        </p>
        <form action={guardar}>
          <div className="grid gap-3 md:grid-cols-3">
            <input name="titulo" required defaultValue={objetivo.titulo} placeholder="Título del objetivo…" className="rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none focus:border-hunter md:col-span-2" />
            <input name="peso" type="number" min={5} max={100} required defaultValue={objetivo.peso} placeholder="Peso (%)" className="rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none focus:border-hunter" />
            <textarea name="descripcion" rows={2} defaultValue={objetivo.descripcion ?? ''} placeholder="Descripción…" className="rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none focus:border-hunter md:col-span-2" />
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-gris">Fecha meta (opcional)</span>
              <input name="metaFecha" type="month" defaultValue={objetivo.metaFecha ?? ''} className="rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none" />
            </label>
          </div>

          <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-gris">
            Focalización <span className="font-normal normal-case text-gris">· sin selección = toda la organización</span>
          </p>
          <div className="grid gap-3 md:grid-cols-4">
            <SelectorMultiple etiqueta="Países" opciones={paises} seleccion={paisIds} onCambio={setPaisIds} textoVacio="Todos los países" />
            <SelectorMultiple etiqueta="Niveles" opciones={niveles} seleccion={nivelIds} onCambio={setNivelIds} textoVacio="Todos los niveles" />
            <SelectorMultiple etiqueta="Áreas" opciones={areas} seleccion={areaIds} onCambio={setAreaIds} textoVacio="Todas las áreas" />
            <SelectorMultiple etiqueta="Puestos" opciones={puestos} seleccion={puestoIds} onCambio={setPuestoIds} textoVacio="Todos los puestos" />
          </div>

          {aviso && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-hunter-dark">{aviso}</p>}
          <div className="mt-5 flex items-center justify-end gap-2">
            <button type="button" onClick={cerrar} className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">Cancelar</button>
            <button disabled={pendiente} className="rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:opacity-60">
              {pendiente ? 'Guardando…' : 'Guardar cambios →'}
            </button>
          </div>
        </form>
      </Modal>
    </span>
  )
}

export function CargarLogro({ objetivoId, logroActual, habilitado = true, motivoDeshabilitado, puedeGestionar = true }: {
  objetivoId: string
  logroActual: number | null
  habilitado?: boolean
  motivoDeshabilitado?: string
  puedeGestionar?: boolean
}) {
  const [valor, setValor] = useState<number | ''>(logroActual ?? '')
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  // Modo VER: solo muestra el logro cargado, sin el editor.
  // En móvil los tres modos van a lo ancho y alineados a la izquierda (en la card
  // apilada); en escritorio conservan su columna alineada a la derecha.
  if (!puedeGestionar) {
    return (
      <span className="flex w-full flex-col gap-1 text-left md:w-auto md:max-w-52 md:items-end md:text-right">
        {logroActual !== null
          ? <span className="text-sm font-bold">Logro final: {logroActual}%</span>
          : <span className="text-[11px] leading-snug text-gris">Logro final aún sin cargar</span>}
      </span>
    )
  }

  if (!habilitado) {
    return (
      <span className="flex w-full flex-col gap-1 text-left md:w-auto md:max-w-52 md:items-end md:text-right">
        {logroActual !== null && (
          <span className="text-sm font-bold">Logro final: {logroActual}% <span className="text-emerald-600">🔒</span></span>
        )}
        <span className="text-[11px] leading-snug text-gris">
          {motivoDeshabilitado ?? 'El logro final se habilita cuando el ciclo de evaluación del período esté en marcha'}
        </span>
      </span>
    )
  }
  return (
    <span className="flex w-full items-center gap-2 md:w-auto md:flex-col md:items-end md:gap-1">
      <span className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-wide text-gris md:flex-none" title="Cuánto se cumplió este objetivo al cierre del período. Aplica a todos los alcanzados y alimenta su nota de objetivos.">
        Logro final del período
      </span>
      <span className="flex items-center gap-1.5">
      <input
        type="number" min={0} max={100} value={valor}
        onChange={(e) => setValor(e.target.value === '' ? '' : Number(e.target.value))}
        placeholder="—"
        className="w-16 rounded-lg border border-gris-claro px-2 py-1 text-right text-sm font-bold outline-none focus:border-hunter"
      />
      <span className="text-xs font-bold">%</span>
      <button
        disabled={pendiente || valor === ''}
        onClick={() => startTransition(async () => {
          const res = await cargarLogroTransversal(objetivoId, Number(valor))
          setAviso(res.ok ? '✓' : '✕')
          setTimeout(() => setAviso(null), 2000)
        })}
        className="rounded-lg bg-negro px-3 py-1 text-xs font-bold text-white transition hover:bg-negro/80 disabled:opacity-50"
      >
        {pendiente ? '…' : 'Cargar'}
      </button>
      {aviso && <span className={aviso === '✓' ? 'text-emerald-600' : 'text-hunter'}>{aviso}</span>}
      </span>
    </span>
  )
}
