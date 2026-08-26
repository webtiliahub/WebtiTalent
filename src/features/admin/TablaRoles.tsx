'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, KeyRound, Trash2 } from 'lucide-react'
import { toast } from '@/shared/ui/Toast'
import { confirmar } from '@/shared/ui/Confirmacion'
import { Card, Chip, thCls, tdCls } from '@/shared/ui/componentes'
import { Modal } from '@/shared/ui/Modal'
import { btnMiniCls, inputCls } from './edicion-inline'
import { crearRol, editarRol, eliminarRol } from './acciones-roles'
import {
  SECCIONES_ADMIN, SECCIONES_SOLO_VER, ETIQUETA_SECCION,
  type SeccionAdmin, type NivelAdmin, type PermisosAdmin,
} from '@/shared/lib/permisos-admin'

export type RolFila = {
  id: string
  nombre: string
  descripcion: string | null
  esSistema: boolean
  permisos: PermisosAdmin
  usuarios: number
}

type NivelSel = NivelAdmin | ''

const selectCls = `${inputCls} bg-white`

/** — / Ver / Gestionar; las secciones SOLO_VER no ofrecen Gestionar en roles creados. */
function opcionesNivel(seccion: SeccionAdmin): { value: NivelSel; label: string }[] {
  const base: { value: NivelSel; label: string }[] = [{ value: '', label: '—' }, { value: 'VER', label: 'Ver' }]
  if (!(SECCIONES_SOLO_VER as readonly string[]).includes(seccion)) base.push({ value: 'GESTIONAR', label: 'Gestionar' })
  return base
}

/** Forma canónica (orden fijo, sin claves vacías) para comparar y persistir. */
function canonico(p: Partial<Record<SeccionAdmin, NivelSel>>): PermisosAdmin {
  const out: PermisosAdmin = {}
  for (const s of SECCIONES_ADMIN) { const v = p[s]; if (v) out[s] = v }
  return out
}

/** Lista de secciones con su nivel — el cuerpo del popup de permisos (ver/editar y crear). */
function ListaPermisos({ valores, onCambiar, deshabilitado, fijoGestionar }: {
  valores: Partial<Record<SeccionAdmin, NivelSel>>
  onCambiar: (seccion: SeccionAdmin, valor: NivelSel) => void
  deshabilitado: boolean
  fijoGestionar: boolean // rol de sistema: todo «Gestionar», sin selects
}) {
  return (
    <ul className="space-y-1.5">
      {SECCIONES_ADMIN.map((seccion) => (
        <li key={seccion} className="flex items-center justify-between gap-3 rounded-lg bg-hueso px-3.5 py-2">
          <span className="text-[13px] font-semibold">{ETIQUETA_SECCION[seccion]}</span>
          {fijoGestionar ? (
            <span className="text-xs font-bold text-gris">Gestionar</span>
          ) : (
            <select
              value={valores[seccion] ?? ''}
              onChange={(e) => onCambiar(seccion, e.target.value as NivelSel)}
              disabled={deshabilitado}
              className={`${selectCls} w-36 disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {opcionesNivel(seccion).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Pestaña «Roles y permisos»: tabla con la lista de roles y botón «Ver permisos» que abre
 * un popup con las secciones del módulo de administración y su nivel (—/Ver/Gestionar).
 * RR.HH. (sistema) es de solo lectura; con `puedeGestionar=false` todo queda en lectura. */
export function TablaRoles({ roles, puedeGestionar }: { roles: RolFila[]; puedeGestionar: boolean }) {
  const router = useRouter()
  const [pendiente, startTransition] = useTransition()
  const [abierto, setAbierto] = useState<{ modo: 'permisos'; rol: RolFila } | { modo: 'crear' } | null>(null)
  const [valores, setValores] = useState<Partial<Record<SeccionAdmin, NivelSel>>>({})
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const [avisoFila, setAvisoFila] = useState<Record<string, string>>({})

  function abrirPermisos(rol: RolFila) {
    setValores({ ...rol.permisos })
    setAviso(null)
    setAbierto({ modo: 'permisos', rol })
  }

  function abrirCrear() {
    setValores({})
    setNombre('')
    setDescripcion('')
    setAviso(null)
    setAbierto({ modo: 'crear' })
  }

  function cerrar() {
    setAbierto(null)
    setAviso(null)
  }

  const hayCambios = abierto?.modo === 'permisos'
    && JSON.stringify(canonico(valores)) !== JSON.stringify(canonico(abierto.rol.permisos))

  function guardar() {
    if (abierto?.modo !== 'permisos') return
    const rol = abierto.rol
    setAviso(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('nombre', rol.nombre)
      fd.set('descripcion', rol.descripcion ?? '')
      fd.set('permisos', JSON.stringify(canonico(valores)))
      const res = await editarRol(rol.id, fd)
      if (!res.ok) { setAviso(res.error); return }
      cerrar()
      toast(`Rol «${rol.nombre}» actualizado`)
      router.refresh()
    })
  }

  function crear() {
    setAviso(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('nombre', nombre)
      fd.set('descripcion', descripcion)
      fd.set('permisos', JSON.stringify(canonico(valores)))
      const res = await crearRol(fd)
      if (!res.ok) { setAviso(res.error); return }
      cerrar()
      toast('Rol creado')
      router.refresh()
    })
  }

  async function eliminar(rol: RolFila) {
    if (!(await confirmar(`¿Eliminar el rol "${rol.nombre}"? Esta acción no se puede deshacer.`, { titulo: 'Eliminar rol', textoAceptar: 'Eliminar' }))) return
    setAvisoFila((a) => ({ ...a, [rol.id]: '' }))
    startTransition(async () => {
      const res = await eliminarRol(rol.id)
      if (!res.ok) { setAvisoFila((a) => ({ ...a, [rol.id]: res.error })); return }
      toast(`Rol «${rol.nombre}» eliminado`)
      router.refresh()
    })
  }

  return (
    <Card titulo="Roles y permisos" extra={`${roles.length} rol${roles.length === 1 ? '' : 'es'}`}>
      {!puedeGestionar && (
        <p className="mb-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
          Vista de solo lectura: la gestión de roles es exclusiva de RR.HH.
        </p>
      )}
      {/* Móvil: tarjeta por rol. La tabla pedía 560 px y, sobre todo, su botón de eliminar
          vive en `opacity-0 group-hover:opacity-100`: sin cursor no hay hover, así que en el
          teléfono la acción no existía. Aquí va visible. */}
      <ul className="flex flex-col gap-2.5 md:hidden">
        {roles.map((r) => (
          <li key={r.id} className="rounded-xl border border-gris-claro bg-white px-3 py-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-bold leading-tight">
                  {r.esSistema && <Lock size={11} className="mr-1 inline -translate-y-px text-gris" />}
                  {r.nombre}
                </p>
                {r.descripcion && <p className="mt-0.5 text-[11.5px] text-gris">{r.descripcion}</p>}
              </div>
              {r.esSistema ? <Chip tono="ok">Sistema</Chip> : <Chip tono="pendiente">Personalizado</Chip>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Chip>{r.usuarios} usuario{r.usuarios === 1 ? '' : 's'}</Chip>
            </div>
            {avisoFila[r.id] && <p className="mt-1.5 text-[11.5px] text-marca-dark">{avisoFila[r.id]}</p>}
            <div className="mt-2.5 flex gap-2 border-t border-hueso-2 pt-2.5">
              <button
                onClick={() => abrirPermisos(r)}
                className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-gris-claro bg-white text-[11.5px] font-bold"
              ><KeyRound size={13} />{r.esSistema || !puedeGestionar ? 'Ver permisos' : 'Permisos'}</button>
              {!r.esSistema && puedeGestionar && (
                <button
                  onClick={() => eliminar(r)}
                  disabled={pendiente}
                  className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white text-[11.5px] font-bold text-alerta disabled:opacity-40"
                ><Trash2 size={13} /> Eliminar</button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="-mx-5 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr>
              <th className={thCls}>Rol</th>
              <th className={thCls}>Tipo</th>
              <th className={thCls}>Usuarios</th>
              <th className={thCls}></th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id} className="group hover:bg-hueso/60">
                <td className={tdCls}>
                  <p className="text-[13px] font-bold">
                    {r.esSistema && <Lock size={11} className="mr-1 inline -translate-y-px text-gris" />}
                    {r.nombre}
                  </p>
                  {r.descripcion && <p className="mt-0.5 text-[11px] text-gris">{r.descripcion}</p>}
                  {avisoFila[r.id] && <p className="mt-1 text-[11px] text-marca-dark">{avisoFila[r.id]}</p>}
                </td>
                <td className={tdCls}>
                  {r.esSistema ? <Chip tono="ok">Sistema</Chip> : <Chip tono="pendiente">Personalizado</Chip>}
                </td>
                <td className={`${tdCls} text-sm`}>{r.usuarios}</td>
                <td className={`${tdCls} text-right`}>
                  <div className="flex items-center justify-end gap-1.5">
                    <button onClick={() => abrirPermisos(r)} className={`${btnMiniCls} border border-gris-claro`}>
                      <KeyRound size={12} className="mr-1 inline -translate-y-px" />Ver permisos
                    </button>
                    {/* Hueco fijo w-8: el tacho solo cambia de opacidad, la fila nunca se reacomoda */}
                    <span className="grid h-8 w-8 shrink-0 place-items-center">
                      {!r.esSistema && puedeGestionar && (
                        <button
                          onClick={() => eliminar(r)}
                          disabled={pendiente}
                          title="Eliminar rol"
                          className="grid h-8 w-8 place-items-center rounded-lg text-gris opacity-0 transition-all duration-200 hover:bg-red-50 hover:text-alerta group-hover:opacity-100 focus-visible:opacity-100"
                        ><Trash2 size={14} /></button>
                      )}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {puedeGestionar && (
        <div className="mt-4 border-t border-gris-claro/50 pt-3">
          <button onClick={abrirCrear} className="w-full rounded-xl border border-dashed border-gris-claro px-3 py-2.5 text-xs font-bold text-gris transition hover:border-marca hover:text-marca md:w-auto md:rounded-lg md:py-1.5">
            ＋ Crear rol
          </button>
        </div>
      )}

      {/* Popup de permisos de un rol existente */}
      <Modal
        titulo={abierto?.modo === 'permisos' ? `Permisos · ${abierto.rol.nombre}` : ''}
        abierto={abierto?.modo === 'permisos'}
        onCerrar={cerrar}
      >
        {abierto?.modo === 'permisos' && (
          <>
            {abierto.rol.esSistema ? (
              <p className="mb-3 rounded-lg bg-hueso-2 px-3 py-2 text-xs text-gris">
                <Lock size={11} className="mr-1 inline -translate-y-px" />
                Rol de sistema: administración completa y poderes de proceso. No se puede editar ni eliminar.
              </p>
            ) : !puedeGestionar ? (
              <p className="mb-3 rounded-lg bg-hueso-2 px-3 py-2 text-xs text-gris">Solo lectura: la gestión de roles es exclusiva de RR.HH.</p>
            ) : (
              <p className="mb-3 text-xs text-gris">Nivel de acceso por sección del módulo de administración. Los cambios aplican al instante para los usuarios con este rol.</p>
            )}
            <ListaPermisos
              valores={valores}
              onCambiar={(s, v) => setValores((p) => ({ ...p, [s]: v }))}
              deshabilitado={pendiente || abierto.rol.esSistema || !puedeGestionar}
              fijoGestionar={abierto.rol.esSistema}
            />
            {aviso && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-alerta-dark">{aviso}</p>}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={cerrar} className={btnMiniCls}>Cerrar</button>
              {!abierto.rol.esSistema && puedeGestionar && (
                <button
                  onClick={guardar}
                  disabled={pendiente || !hayCambios}
                  className="rounded-xl bg-marca px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark disabled:opacity-50"
                >
                  {pendiente ? 'Guardando…' : 'Guardar cambios ✓'}
                </button>
              )}
            </div>
          </>
        )}
      </Modal>

      {/* Popup de creación de rol */}
      <Modal titulo="Crear rol" abierto={abierto?.modo === 'crear'} onCerrar={cerrar}>
        {abierto?.modo === 'crear' && (
          <>
            <div className="mb-3 space-y-2">
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del rol" autoFocus className={`${inputCls} w-full`} />
              <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Descripción (opcional)" className={`${inputCls} w-full`} />
            </div>
            <ListaPermisos
              valores={valores}
              onCambiar={(s, v) => setValores((p) => ({ ...p, [s]: v }))}
              deshabilitado={pendiente}
              fijoGestionar={false}
            />
            {aviso && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-alerta-dark">{aviso}</p>}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={cerrar} className={btnMiniCls}>Cancelar</button>
              <button
                onClick={crear}
                disabled={pendiente || nombre.trim().length < 3 || Object.values(canonico(valores)).length === 0}
                title={nombre.trim().length < 3 ? 'Escribe el nombre del rol (mínimo 3 caracteres)' : Object.values(canonico(valores)).length === 0 ? 'Otorga acceso a al menos una sección' : undefined}
                className="rounded-xl bg-marca px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark disabled:opacity-50"
              >
                {pendiente ? 'Creando…' : 'Crear rol ✓'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </Card>
  )
}
