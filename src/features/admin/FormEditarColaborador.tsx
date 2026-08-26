'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { editarColaborador } from './acciones'
import { useAccion, Aviso, Campo } from './edicion-inline'
import { Combobox } from '@/shared/ui/Combobox'

type Opcion = { id: string; nombre: string }
type PuestoOpcion = { id: string; nombre: string; areaId: string | null }

// 16px en móvil: con fuente <16px iOS hace zoom automático al enfocar el input
const inputCls = 'rounded-lg border border-gris-claro bg-white px-3 py-2 text-base outline-none focus:border-marca md:py-1.5 md:text-sm'

export type ColaboradorEditable = {
  id: string
  codigo: string | null
  nombres: string
  apellidos: string
  documento: string
  email: string | null
  telefono: string | null
  nivelLiderazgo: string | null
  paisId: string
  areaId: string | null
  puestoId: string | null
  jefeId: string | null
  tieneCuenta: boolean
}

export function FormEditarColaborador({ colaborador, paises, areas, puestos, jefes, cicloActivo = null }: {
  colaborador: ColaboradorEditable
  paises: Opcion[]
  areas: Opcion[]
  puestos: PuestoOpcion[]
  jefes: Opcion[]
  cicloActivo?: string | null // nombre del ciclo activo en el que participa: puesto y país quedan bloqueados
}) {
  const { aviso, pendiente, ejecutar } = useAccion()
  const [abierto, setAbierto] = useState(false)
  const [areaSel, setAreaSel] = useState(colaborador.areaId ?? '')
  // El puesto se acota al área elegida (los sin área siguen disponibles)
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
    <div className="mb-4">
      <button onClick={() => setAbierto(true)} className="w-full rounded-lg border border-dashed border-gris-claro px-3 py-2.5 text-xs font-bold text-gris transition hover:border-marca hover:text-marca md:w-auto md:py-1.5">
        ✎ Editar datos
      </button>

      {/* Pop-up en PORTAL (body), mismo estilo que «Nuevo colaborador»: hoja desde abajo en
          móvil, diálogo centrado en escritorio. Clic en el fondo o ✕ cierran sin guardar. */}
      {abierto && createPortal(
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-negro/50 md:items-center md:p-6" onClick={() => setAbierto(false)}>
          <div className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-5 md:max-h-[85vh] md:max-w-2xl md:rounded-2xl md:p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-2.5 h-1 w-9 rounded-full bg-gris-claro md:hidden" />
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold">Editar colaborador</p>
              <button type="button" onClick={() => setAbierto(false)} aria-label="Cerrar" className="rounded px-1.5 text-sm font-bold text-gris hover:text-marca">✕</button>
            </div>
            <form action={(fd) => ejecutar(() => editarColaborador(colaborador.id, fd), () => setAbierto(false))}>
              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Nombres"><input name="nombres" defaultValue={colaborador.nombres} className={`${inputCls} w-full`} required minLength={2} /></Campo>
                <Campo etiqueta="Apellidos"><input name="apellidos" defaultValue={colaborador.apellidos} className={`${inputCls} w-full`} required minLength={2} /></Campo>
                <Campo etiqueta="Documento"><input name="documento" defaultValue={colaborador.documento} className={`${inputCls} w-full`} required minLength={3} /></Campo>
                <Campo etiqueta={cicloActivo ? 'País 🔒' : 'País'}>
                  {cicloActivo ? (
                    <>
                      <input type="hidden" name="paisId" value={colaborador.paisId} />
                      <select disabled defaultValue={colaborador.paisId} title={`Bloqueado: participa en el ciclo activo «${cicloActivo}»`} className={`${inputCls} w-full bg-hueso-2 text-gris`}>
                        {paises.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                    </>
                  ) : (
                    <select name="paisId" defaultValue={colaborador.paisId} className={`${inputCls} w-full bg-white`} required>
                      {paises.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  )}
                </Campo>
                <Campo etiqueta="Correo corporativo" className="col-span-2"><input name="email" type="email" defaultValue={colaborador.email ?? ''} placeholder="—" className={`${inputCls} w-full`} /></Campo>
                <Campo etiqueta="Código del padrón"><input name="codigo" defaultValue={colaborador.codigo ?? ''} placeholder="PER-001" className={`${inputCls} w-full`} /></Campo>
                <Campo etiqueta="Teléfono"><input name="telefono" defaultValue={colaborador.telefono ?? ''} placeholder="+51 …" className={`${inputCls} w-full`} /></Campo>
                <Campo etiqueta="Nivel de liderazgo" className="col-span-2">
                  <select name="nivelLiderazgo" defaultValue={colaborador.nivelLiderazgo ?? ''} className={`${inputCls} w-full bg-white`}>
                    <option value="">No aplica</option>
                    <option value="ESTRATEGICO">Estratégico</option>
                    <option value="TACTICO">Táctico</option>
                    <option value="OPERATIVO">Operativo</option>
                  </select>
                </Campo>
                <Campo etiqueta="Área" className="col-span-2 md:col-span-1">
                  <Combobox name="areaId" opciones={areas} valorInicial={colaborador.areaId ?? ''} textoVacio="Sin área" onChange={setAreaSel} />
                </Campo>
                <Campo etiqueta={cicloActivo ? 'Puesto 🔒' : 'Puesto (se filtra por área)'} className="col-span-2 md:col-span-1">
                  {cicloActivo ? (
                    <>
                      <input type="hidden" name="puestoId" value={colaborador.puestoId ?? ''} />
                      <div title={`Bloqueado: participa en el ciclo activo «${cicloActivo}»`} className={`${inputCls} w-full cursor-not-allowed bg-hueso-2 text-gris`}>
                        {puestos.find((p) => p.id === colaborador.puestoId)?.nombre ?? 'Sin puesto'}
                      </div>
                    </>
                  ) : (
                    <Combobox name="puestoId" opciones={puestosFiltrados} valorInicial={colaborador.puestoId ?? ''} textoVacio="Sin puesto" />
                  )}
                </Campo>
                <Campo etiqueta="Jefe directo" className="col-span-2">
                  <Combobox name="jefeId" opciones={jefes.filter((j) => j.id !== colaborador.id)} valorInicial={colaborador.jefeId ?? ''} textoVacio="Sin jefe directo" />
                </Campo>
              </div>
              {cicloActivo && (
                <p className="mt-3 rounded-lg bg-hueso-2 px-3 py-2 text-xs text-gris">
                  🔒 Puesto y país bloqueados mientras participa en el ciclo activo «{cicloActivo}»: el cuestionario, los pesos del cálculo y el cierre dependen de ellos. Aplica esos cambios al cierre, o retíralo del ciclo desde Rotación.
                </p>
              )}
              <Aviso texto={aviso} />
              {colaborador.tieneCuenta && (
                <p className="mt-3 text-[11px] text-gris">Si cambias el correo, su correo de acceso (login y 2FA) se actualiza también.</p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-hueso-2 pt-3 md:flex md:justify-end">
                <button type="button" onClick={() => setAbierto(false)} className="rounded-xl border border-gris-claro bg-white px-4 py-2.5 text-xs font-bold hover:bg-hueso md:py-2">Cancelar</button>
                <button type="submit" disabled={pendiente} className="rounded-xl bg-marca px-4 py-2.5 text-xs font-bold text-white transition hover:bg-marca-dark disabled:opacity-60 md:py-2">
                  {pendiente ? 'Guardando…' : 'Guardar cambios'}
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
