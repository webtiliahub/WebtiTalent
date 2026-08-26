'use client'

import { useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Combobox } from '@/shared/ui/Combobox'
import { SelectorMultiple } from '@/shared/ui/SelectorMultiple'

type Opcion = { valor: string; etiqueta: string }

/**
 * Filtros del log de auditoría. Van por URL y se resuelven en el servidor: la tabla crece sin
 * techo y filtrar en el cliente solo alcanzaría a lo ya cargado.
 *
 * Acción y usuario son COMBOBOX, no selects: las acciones son cerca de treinta constantes y los
 * usuarios pasan de 800 — en una lista nativa hay que buscarlos a ojo. El buscador ignora tildes.
 *
 * Al elegir cualquier filtro se navega solo (mismo criterio que los filtros de Resultados). No
 * hay filtro de año: el rango desde/hasta ya lo cubre, y tener los dos obligaba a explicar cuál
 * manda cuando se contradicen.
 */
export function FiltrosAuditoria({ acciones, usuarios, accionSel, usuarioSel, desdeSel, hastaSel, hayFiltros }: {
  acciones: Opcion[]
  usuarios: Opcion[]
  accionSel: string
  usuarioSel: string
  desdeSel: string
  hastaSel: string
  hayFiltros: boolean
}) {
  const form = useRef<HTMLFormElement>(null)
  const router = useRouter()
  const ruta = usePathname()
  // Acción es MULTISELECT (CSV en la URL): el estado local mantiene la selección viva entre
  // navegaciones suaves (el panel queda abierto y la tabla se filtra en vivo con cada check)
  const [accionesSel, setAccionesSel] = useState<string[]>(accionSel ? accionSel.split(',').filter(Boolean) : [])

  /* Navega con el resto de los filtros intactos. El campo que cambió se pasa por parámetro en
     vez de leerlo del formulario: el input oculto del Combobox se actualiza en el render que
     viene DESPUÉS de este `onChange`, así que en este instante todavía tiene el valor anterior.
     De paso los campos vacíos no viajan, y la URL queda legible. */
  const navegarCon = (campo: string, valor: string) => {
    if (!form.current) return
    const datos = new FormData(form.current)
    datos.set(campo, valor)
    const query = new URLSearchParams()
    datos.forEach((v, k) => { if (typeof v === 'string' && v !== '') query.set(k, v) })
    router.push(`${ruta}?${query.toString()}`)
  }

  const campo = 'w-full min-w-0 rounded-xl border border-gris-claro bg-white px-3 py-2.5 text-sm outline-none transition focus:border-hunter sm:py-2'
  const rotulo = 'text-[10.5px] font-bold uppercase tracking-wide text-gris'

  return (
    <form ref={form} method="get" className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
      {/* El tab de auditoría no es el primero: sin esto, al aplicar un filtro la página volvería
          a abrir «Modelo de competencias» */}
      <input type="hidden" name="tab" value="auditoria" />

      <div className="col-span-2 flex flex-col gap-1 sm:col-span-1 sm:w-52">
        <span className={rotulo}>Acción</span>
        {/* El hidden conserva la selección cuando navega OTRO filtro (navegarCon lee el form) */}
        <input type="hidden" name="accion" value={accionesSel.join(',')} />
        <SelectorMultiple
          etiqueta="Acción"
          etiquetaOculta
          opciones={acciones.map((a) => ({ id: a.valor, nombre: a.etiqueta }))}
          seleccion={accionesSel}
          textoVacio="Todas las acciones"
          onCambio={(ids) => { setAccionesSel(ids); navegarCon('accion', ids.join(',')) }}
        />
      </div>

      <div className="col-span-2 flex flex-col gap-1 sm:col-span-1 sm:w-56">
        <span className={rotulo}>Usuario</span>
        <Combobox
          name="usuario"
          tamano="campo"
          opciones={usuarios.map((u) => ({ id: u.valor, nombre: u.etiqueta }))}
          valorInicial={usuarioSel}
          textoVacio="Todos los usuarios"
          onChange={(id) => navegarCon('usuario', id)}
        />
      </div>

      <label className="flex flex-col gap-1 sm:w-40">
        <span className={rotulo}>Desde</span>
        <input type="date" name="desde" defaultValue={desdeSel} onChange={(e) => navegarCon('desde', e.target.value)} className={campo} />
      </label>

      <label className="flex flex-col gap-1 sm:w-40">
        <span className={rotulo}>Hasta</span>
        <input type="date" name="hasta" defaultValue={hastaSel} onChange={(e) => navegarCon('hasta', e.target.value)} className={campo} />
      </label>

      {hayFiltros && (
        <a
          href="?tab=auditoria"
          className="col-span-2 rounded-xl border border-gris-claro px-3 py-2.5 text-center text-xs font-bold text-gris transition hover:border-hunter hover:text-hunter sm:col-span-1 sm:w-auto sm:py-2"
        >
          Limpiar filtros
        </a>
      )}
    </form>
  )
}
