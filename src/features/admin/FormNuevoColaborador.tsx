'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { crearColaborador } from './acciones'
import { useAccion, Aviso, Campo } from './edicion-inline'
import { Combobox } from '@/shared/ui/Combobox'

type Opcion = { id: string; nombre: string }
type PuestoOpcion = { id: string; nombre: string; areaId: string | null }

// 16px en móvil: con fuente <16px iOS hace zoom automático al enfocar el input
const inputCls = 'rounded-lg border border-gris-claro bg-white px-3 py-2 text-base outline-none focus:border-hunter md:py-1.5 md:text-sm'

export function FormNuevoColaborador({ paises, areas, puestos, jefes }: {
  paises: Opcion[]
  areas: Opcion[]
  puestos: PuestoOpcion[]
  jefes: Opcion[]
}) {
  const { aviso, pendiente, ejecutar } = useAccion()
  const [abierto, setAbierto] = useState(false)
  const [areaSel, setAreaSel] = useState('')
  const puestosFiltrados = useMemo(
    () => (areaSel ? puestos.filter((p) => p.areaId === areaSel || p.areaId === null) : puestos),
    [areaSel, puestos],
  )

  // Con el pop-up abierto la página de atrás no debe scrollear (sobre todo en móvil)
  useEffect(() => {
    if (!abierto) return
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previo }
  }, [abierto])

  return (
    <div className="w-full md:w-auto">
      <button onClick={() => setAbierto(true)} className="w-full rounded-lg border border-dashed border-gris-claro px-3 py-2.5 text-xs font-bold text-gris transition hover:border-hunter hover:text-hunter md:w-auto md:py-1.5">
        ＋ Agregar colaborador
      </button>

      {/* Pop-up en PORTAL (body): hoja desde abajo en móvil, diálogo centrado en escritorio.
          La página queda oscurecida detrás; clic en el fondo o ✕ cierran sin crear. */}
      {abierto && createPortal(
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-negro/50 md:items-center md:p-6" onClick={() => setAbierto(false)}>
          <div className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-5 md:max-h-[85vh] md:max-w-2xl md:rounded-2xl md:p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-2.5 h-1 w-9 rounded-full bg-gris-claro md:hidden" />
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold">Nuevo colaborador</p>
              <button type="button" onClick={() => setAbierto(false)} aria-label="Cerrar" className="rounded px-1.5 text-sm font-bold text-gris hover:text-hunter">✕</button>
            </div>
            <form action={(fd) => ejecutar(() => crearColaborador(fd), () => setAbierto(false))}>
              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Nombres"><input name="nombres" className={`${inputCls} w-full`} required minLength={2} /></Campo>
                <Campo etiqueta="Apellidos"><input name="apellidos" className={`${inputCls} w-full`} required minLength={2} /></Campo>
                <Campo etiqueta="Documento"><input name="documento" placeholder="p.ej. 40291855" className={`${inputCls} w-full`} required minLength={3} /></Campo>
                <Campo etiqueta="País">
                  <select name="paisId" defaultValue="" className={`${inputCls} w-full bg-white`} required>
                    <option value="" disabled>Selecciona…</option>
                    {paises.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </Campo>
                <Campo etiqueta="Correo corporativo" className="col-span-2"><input name="email" type="email" placeholder="para su cuenta de acceso" className={`${inputCls} w-full`} /></Campo>
                <Campo etiqueta="Código del padrón">
                  {/* Texto corto: el anterior («Se genera solo (PER-###)») se cortaba en móvil */}
                  <input value="Automático" disabled title="Prefijo del país + consecutivo (p. ej. PER-807): se asigna automáticamente al crear" className={`${inputCls} w-full bg-hueso text-gris`} />
                </Campo>
                <Campo etiqueta="Teléfono"><input name="telefono" placeholder="opcional" className={`${inputCls} w-full`} /></Campo>
                <Campo etiqueta="Nivel de liderazgo" className="col-span-2">
                  <select name="nivelLiderazgo" defaultValue="" className={`${inputCls} w-full bg-white`}>
                    <option value="">No aplica</option>
                    <option value="ESTRATEGICO">Estratégico</option>
                    <option value="TACTICO">Táctico</option>
                    <option value="OPERATIVO">Operativo</option>
                  </select>
                </Campo>
                <Campo etiqueta="Área" className="col-span-2 md:col-span-1">
                  <Combobox name="areaId" opciones={areas} textoVacio="Sin área" onChange={setAreaSel} />
                </Campo>
                <Campo etiqueta="Puesto (se filtra por área)" className="col-span-2 md:col-span-1">
                  <Combobox name="puestoId" opciones={puestosFiltrados} textoVacio="Sin puesto" />
                </Campo>
                <Campo etiqueta="Jefe directo" className="col-span-2">
                  <Combobox name="jefeId" opciones={jefes} textoVacio="Sin jefe directo" />
                </Campo>
              </div>
              <Aviso texto={aviso} />
              <p className="mt-3 text-[11px] text-gris">Con correo podrás crearle su cuenta de acceso en Configuración → Usuarios.</p>
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-hueso-2 pt-3 md:flex md:justify-end">
                <button type="button" onClick={() => setAbierto(false)} className="rounded-xl border border-gris-claro bg-white px-4 py-2.5 text-xs font-bold hover:bg-hueso md:py-2">Cancelar</button>
                <button type="submit" disabled={pendiente} className="rounded-xl bg-hunter px-4 py-2.5 text-xs font-bold text-white transition hover:bg-hunter-dark disabled:opacity-60 md:py-2">
                  {pendiente ? 'Creando…' : 'Crear colaborador'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
