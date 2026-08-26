'use client'

import { KeyRound, Download, Zap } from 'lucide-react'
import { useState } from 'react'
import { Card, Chip, thCls, tdCls } from '@/shared/ui/componentes'
import { confirmar } from '@/shared/ui/Confirmacion'
import { Desplegable, useAccion, Aviso, btnMiniCls, inputCls } from './edicion-inline'
import { Combobox } from '@/shared/ui/Combobox'
import {
  crearUsuario, editarAccesoUsuario, alternarActivoUsuario, resetearPasswordUsuario, aprovisionarCuentas,
  type Credencial,
} from './acciones-usuarios'

type UsuarioFila = {
  id: string
  nombre: string
  email: string
  rol: 'RRHH' | 'COLABORADOR'
  alcanceRrhh: 'REGIONAL' | 'PAIS' | null
  alcancePaisId: string | null
  alcancePaisNombre: string | null
  rolAdminId: string | null
  rolAdminNombre: string | null
  activo: boolean
}
type SinCuenta = { id: string; nombre: string; email: string | null; paisNombre: string }
type Pais = { id: string; nombre: string }
type RolOpcion = { id: string; nombre: string }

const selectCls = `${inputCls} bg-white`

/** Neutraliza inyecci\u00F3n de f\u00F3rmulas: una celda que empieza con = + - @ (o tab/CR) la
 * ejecutar\u00EDa Excel/Sheets; se antepone un ap\u00F3strofo para forzar texto. */
function celdaSegura(v: string) {
  const s = String(v ?? '')
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}

/** CSV con BOM y ";" para que Excel es-PE lo abra en columnas directamente. */
function descargarCsv(credenciales: Credencial[]) {
  const filas = [['nombre', 'correo', 'contrasena_temporal'], ...credenciales.map((c) => [c.nombre, c.email, c.passwordTemporal])]
  const csv = '\uFEFF' + filas.map((f) => f.map((v) => `"${celdaSegura(v).replaceAll('"', '""')}"`).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `credenciales-hunter-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** Selectores de rol, rol admin y alcance compartidos entre crear y editar. El rol admin (nunca
 * el de sistema) solo aplica a Colaborador; y, si se elige uno, exige alcance (mismo requisito
 * que RR.HH.: necesita un ámbito de datos definido). */
function CamposAcceso({ paises, roles, rolInicial, alcanceInicial, paisInicial, rolAdminInicial }: {
  paises: Pais[]
  roles: RolOpcion[]
  rolInicial?: 'RRHH' | 'COLABORADOR'
  alcanceInicial?: 'REGIONAL' | 'PAIS' | null
  paisInicial?: string | null
  rolAdminInicial?: string | null
}) {
  const [rol, setRol] = useState<'RRHH' | 'COLABORADOR'>(rolInicial ?? 'COLABORADOR')
  const [rolAdminId, setRolAdminId] = useState(rolAdminInicial ?? '')
  const [alcance, setAlcance] = useState<'REGIONAL' | 'PAIS'>(alcanceInicial === 'PAIS' ? 'PAIS' : 'REGIONAL')
  const necesitaAlcance = rol === 'RRHH' || rolAdminId !== ''
  return (
    <>
      <select
        name="rol"
        value={rol}
        onChange={(e) => { const v = e.target.value as 'RRHH' | 'COLABORADOR'; setRol(v); if (v === 'RRHH') setRolAdminId('') }}
        className={selectCls}
      >
        <option value="COLABORADOR">Colaborador</option>
        <option value="RRHH">RR.HH.</option>
      </select>
      {rol === 'COLABORADOR' && (
        <select name="rolAdminId" value={rolAdminId} onChange={(e) => setRolAdminId(e.target.value)} className={selectCls}>
          <option value="">— Sin rol de administración</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select>
      )}
      {necesitaAlcance && (
        <select name="alcanceRrhh" value={alcance} onChange={(e) => setAlcance(e.target.value as 'REGIONAL' | 'PAIS')} className={selectCls}>
          <option value="REGIONAL">Regional</option>
          <option value="PAIS">Un país</option>
        </select>
      )}
      {necesitaAlcance && alcance === 'PAIS' && (
        <select name="alcancePaisId" defaultValue={paisInicial ?? ''} className={selectCls} required>
          <option value="" disabled>País…</option>
          {paises.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      )}
    </>
  )
}

/** Credenciales temporales: visibles una sola vez, con copia y CSV. */
function PanelCredenciales({ credenciales, contexto, onCerrar }: {
  credenciales: Credencial[]
  contexto: string
  onCerrar: () => void
}) {
  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-bold text-amber-800"><KeyRound size={14} className="mr-1 inline -translate-y-px" />{contexto}</p>
      <p className="mt-0.5 text-xs text-amber-800">
        Se envió el correo con la contraseña temporal a cada persona. Guarda este respaldo ahora: <b>no se volverá a mostrar</b>.
      </p>
      <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto">
        {credenciales.map((c) => (
          <li key={c.email} className="flex flex-wrap items-center gap-2 rounded-lg bg-white/70 px-3 py-1.5 text-xs">
            <span className="font-semibold">{c.nombre}</span>
            <span className="text-gris">{c.email}</span>
            <code className="ml-auto rounded bg-hueso-2 px-2 py-0.5 font-bold">{c.passwordTemporal}</code>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={() => descargarCsv(credenciales)} className="rounded-lg bg-hunter px-3 py-1.5 text-xs font-bold text-white hover:bg-hunter-dark">
          <Download size={13} className="mr-1 inline -translate-y-px" />Descargar CSV
        </button>
        <button onClick={onCerrar} className={btnMiniCls}>Cerrar</button>
      </div>
    </div>
  )
}

/** Variante móvil de FilaUsuario: nombre y correo completos, rol y alcance como chips, y las
 * tres acciones con etiqueta en botones de 36 px (en la tabla son iconos de 26 × 24). */
function TarjetaUsuario({ usuario, paises, roles, esYo, onResultado, puedeGestionar }: {
  usuario: UsuarioFila
  paises: Pais[]
  roles: RolOpcion[]
  esYo: boolean
  onResultado: (credenciales: Credencial[], contexto: string) => void
  puedeGestionar: boolean
}) {
  const { aviso, pendiente, ejecutar } = useAccion()
  const [editando, setEditando] = useState(false)
  const iniciales = usuario.nombre.split(' ').filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase()
  const btnAcc = 'flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-gris-claro bg-white text-[11.5px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <li className={`rounded-xl border px-3 py-3 ${usuario.activo ? 'border-gris-claro bg-white' : 'border-gris-claro bg-hueso'}`}>
      <div className="flex items-start gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-negro font-display text-[11px] font-extrabold text-white">{iniciales}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-bold leading-tight">
            {usuario.nombre}
            {esYo && <span className="ml-1.5 rounded-full bg-hueso-2 px-2 py-0.5 text-[10px] font-bold uppercase text-gris">tú</span>}
          </p>
          <p className="truncate text-[11.5px] text-gris" title={usuario.email}>{usuario.email}</p>
        </div>
        {usuario.activo ? <Chip tono="ok">Activo</Chip> : <Chip tono="rojo">Inactivo</Chip>}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Chip tono={usuario.rol === 'RRHH' ? 'azul' : 'neutro'}>{usuario.rol === 'RRHH' ? 'RR.HH.' : (usuario.rolAdminNombre ?? 'Colaborador')}</Chip>
        {usuario.alcanceRrhh && (
          <Chip>{usuario.alcanceRrhh === 'REGIONAL' ? 'Regional' : (usuario.alcancePaisNombre ?? '—')}</Chip>
        )}
      </div>

      {puedeGestionar && (
        <div className="mt-2.5 flex gap-2 border-t border-hueso-2 pt-2.5">
          <button onClick={() => setEditando((v) => !v)} className={btnAcc}>✎ Editar</button>
          <button
            onClick={async () => { if (await confirmar(`¿Resetear la contraseña de ${usuario.nombre}? Se le enviará una temporal.`, { titulo: 'Resetear contraseña', textoAceptar: 'Resetear' })) ejecutar(async () => {
              const res = await resetearPasswordUsuario(usuario.id)
              if (res.ok) onResultado([res.credencial], `Contraseña temporal de ${usuario.nombre}`)
              return res
            }) }}
            disabled={pendiente}
            className={btnAcc}
          ><KeyRound size={13} /> Clave</button>
          <button
            onClick={() => ejecutar(() => alternarActivoUsuario(usuario.id))}
            disabled={pendiente || esYo}
            title={esYo ? 'No puedes desactivar tu propia cuenta' : undefined}
            className={`${btnAcc} ${usuario.activo ? 'border-red-200 text-hunter' : 'border-emerald-200 text-emerald-700'}`}
          >{usuario.activo ? '⏻ Baja' : '↩ Reactivar'}</button>
        </div>
      )}

      {(editando || aviso) && (
        <div className="mt-2.5 border-t border-hueso-2 pt-2.5">
          <Desplegable abierto={editando}>
            {/* Mismo formulario que la fila de escritorio (CamposAcceso), apilado */}
            <form
              className="flex flex-col gap-2 rounded-xl bg-hueso px-3 py-2.5 [&_select]:w-full"
              action={(fd) => ejecutar(() => editarAccesoUsuario(usuario.id, fd), () => setEditando(false))}
            >
              <span className="text-xs font-bold text-gris">Rol y alcance</span>
              <CamposAcceso
                paises={paises}
                roles={roles}
                rolInicial={usuario.rol}
                alcanceInicial={usuario.alcanceRrhh}
                paisInicial={usuario.alcancePaisId}
                rolAdminInicial={usuario.rolAdminId}
              />
              <div className="flex gap-2">
                <button type="submit" disabled={pendiente} className="flex-1 rounded-xl bg-hunter px-3 py-2.5 text-xs font-bold text-white hover:bg-hunter-dark disabled:opacity-50">Guardar</button>
                <button type="button" onClick={() => setEditando(false)} className="flex-1 rounded-xl border border-gris-claro bg-white px-3 py-2.5 text-xs font-bold">Cancelar</button>
              </div>
            </form>
          </Desplegable>
          <Aviso texto={aviso} />
        </div>
      )}
    </li>
  )
}

function FilaUsuario({ usuario, paises, roles, esYo, onResultado, puedeGestionar }: {
  usuario: UsuarioFila
  paises: Pais[]
  roles: RolOpcion[]
  esYo: boolean
  onResultado: (credenciales: Credencial[], contexto: string) => void
  puedeGestionar: boolean
}) {
  const { aviso, pendiente, ejecutar } = useAccion()
  const [editando, setEditando] = useState(false)

  return (
    <>
      <tr className="hover:bg-hueso/60">
        <td className={tdCls}><b>{usuario.nombre}</b>{esYo && <span className="ml-1.5 text-[10px] font-bold uppercase text-gris">(tú)</span>}</td>
        <td className={tdCls}>{usuario.email}</td>
        <td className={tdCls}>{usuario.rol === 'RRHH' ? 'RR.HH.' : (usuario.rolAdminNombre ?? 'Colaborador')}</td>
        <td className={tdCls}>{usuario.alcanceRrhh ? (usuario.alcanceRrhh === 'REGIONAL' ? 'Regional' : (usuario.alcancePaisNombre ?? '—')) : '—'}</td>
        <td className={tdCls}>{usuario.activo ? <Chip tono="ok">Activo</Chip> : <Chip tono="rojo">Inactivo</Chip>}</td>
        <td className={`${tdCls} whitespace-nowrap text-right`}>
          {puedeGestionar && <>
          <button onClick={() => setEditando((v) => !v)} className={btnMiniCls} title="Editar rol y alcance">✎</button>
          <button
            onClick={async () => { if (await confirmar(`¿Resetear la contraseña de ${usuario.nombre}? Se le enviará una temporal.`, { titulo: 'Resetear contraseña', textoAceptar: 'Resetear' })) ejecutar(async () => {
              const res = await resetearPasswordUsuario(usuario.id)
              if (res.ok) onResultado([res.credencial], `Contraseña temporal de ${usuario.nombre}`)
              return res
            }) }}
            disabled={pendiente}
            className={btnMiniCls}
            title="Resetear contraseña"
          ><KeyRound size={14} /></button>
          <button
            onClick={() => ejecutar(() => alternarActivoUsuario(usuario.id))}
            disabled={pendiente || esYo}
            className={`${btnMiniCls} disabled:cursor-not-allowed disabled:opacity-30`}
            title={esYo ? 'No puedes desactivar tu propia cuenta' : usuario.activo ? 'Desactivar' : 'Reactivar'}
          >{usuario.activo ? '⏻' : '↩'}</button>
          </>}
        </td>
      </tr>
      {(editando || aviso) && (
        <tr>
          <td colSpan={6} className="px-4 pb-3">
            <Desplegable abierto={editando}>
              <form
                className="flex flex-wrap items-center gap-2 rounded-xl bg-hueso px-3 py-2.5"
                action={(fd) => ejecutar(() => editarAccesoUsuario(usuario.id, fd), () => setEditando(false))}
              >
                <span className="text-xs font-bold text-gris">Rol y alcance:</span>
                <CamposAcceso
                  paises={paises}
                  roles={roles}
                  rolInicial={usuario.rol}
                  alcanceInicial={usuario.alcanceRrhh}
                  paisInicial={usuario.alcancePaisId}
                  rolAdminInicial={usuario.rolAdminId}
                />
                <button type="submit" disabled={pendiente} className="rounded-lg bg-hunter px-3 py-1.5 text-xs font-bold text-white hover:bg-hunter-dark disabled:opacity-50">Guardar</button>
                <button type="button" onClick={() => setEditando(false)} className={btnMiniCls}>Cancelar</button>
              </form>
            </Desplegable>
            <Aviso texto={aviso} />
          </td>
        </tr>
      )}
    </>
  )
}

export function PanelUsuarios({ usuarios, sinCuenta, paises, roles, miUsuarioId, puedeGestionar = true }: {
  usuarios: UsuarioFila[]
  sinCuenta: SinCuenta[]
  paises: Pais[]
  roles: RolOpcion[]
  miUsuarioId: string
  puedeGestionar?: boolean
}) {
  const { aviso, pendiente, ejecutar } = useAccion()
  const [creando, setCreando] = useState(false)
  const [email, setEmail] = useState('')
  const [resultado, setResultado] = useState<{ credenciales: Credencial[]; contexto: string } | null>(null)
  // Con el padrón completo la lista es inmanejable: pestaña activos/inactivos + buscador
  const [verInactivos, setVerInactivos] = useState(false)
  const [q, setQ] = useState('')

  const conCorreo = sinCuenta.filter((c) => c.email)
  const sinCorreo = sinCuenta.length - conCorreo.length

  const activos = usuarios.filter((u) => u.activo)
  const inactivos = usuarios.filter((u) => !u.activo)
  // Sin tildes: «Sofia» encuentra a «Sofía» (mismo criterio que el Combobox y la calibración)
  const sinTildes = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const term = sinTildes(q.trim())
  const rolDe = (u: UsuarioFila) => (u.rol === 'RRHH' ? 'RR.HH.' : (u.rolAdminNombre ?? 'Colaborador'))
  const alcanceDe = (u: UsuarioFila) => (u.alcanceRrhh ? (u.alcanceRrhh === 'REGIONAL' ? 'Regional' : (u.alcancePaisNombre ?? '')) : '')
  const visibles = (verInactivos ? inactivos : activos).filter((u) =>
    !term || [u.nombre, u.email, rolDe(u), alcanceDe(u)].some((campo) => sinTildes(campo).includes(term)))

  function elegirColaborador(id: string) {
    setEmail(sinCuenta.find((c) => c.id === id)?.email ?? '')
  }

  function crear(fd: FormData) {
    ejecutar(async () => {
      const res = await crearUsuario(fd)
      if (res.ok) {
        setCreando(false)
        setEmail('')
        setResultado({ credenciales: [res.credencial], contexto: `Cuenta creada para ${res.credencial.nombre}` })
      }
      return res
    })
  }

  async function aprovisionar() {
    if (!(await confirmar(`Se crearán ${conCorreo.length} cuentas y se enviará la contraseña temporal a cada correo. ¿Continuar?`, { titulo: 'Aprovisionar cuentas', textoAceptar: 'Crear cuentas' }))) return
    ejecutar(async () => {
      const res = await aprovisionarCuentas()
      if (res.ok) {
        const partes = [`${res.credenciales.length} cuentas creadas`]
        if (res.errores.length) partes.push(`${res.errores.length} con error`)
        if (res.sinCorreo) partes.push(`${res.sinCorreo} sin correo en el padrón`)
        setResultado({ credenciales: res.credenciales, contexto: partes.join(' · ') })
      }
      return res
    })
  }

  const pastilla = (on: boolean) =>
    `flex-1 rounded-xl px-3 py-2 text-center font-display text-[12.5px] font-bold transition md:flex-none md:px-4 ${
      on ? 'bg-negro text-white' : 'border border-gris-claro bg-white text-gris hover:bg-hueso hover:text-negro'
    }`

  return (
    <Card titulo="Usuarios con acceso" extra={`${activos.length} activos · ${inactivos.length} inactivos`}>
      {/* Activos e inactivos separados, y buscador: con +800 cuentas la lista sola no sirve */}
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center">
        <div className="flex gap-2">
          <button type="button" onClick={() => setVerInactivos(false)} className={pastilla(!verInactivos)}>Activos ({activos.length})</button>
          <button type="button" onClick={() => setVerInactivos(true)} className={pastilla(verInactivos)}>Inactivos ({inactivos.length})</button>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre, correo, rol o alcance…"
          aria-label="Buscar usuario"
          className="w-full min-w-0 rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none transition focus:border-hunter md:ml-auto md:w-72 md:py-2"
        />
      </div>
      {visibles.length === 0 && (
        <p className="rounded-xl bg-hueso px-4 py-6 text-center text-sm text-gris">
          {term
            ? <>Sin coincidencias para “{q}” entre los {verInactivos ? 'inactivos' : 'activos'}.</>
            : verInactivos ? 'No hay usuarios inactivos.' : 'No hay usuarios activos.'}
        </p>
      )}

      {/* Móvil: tarjeta por usuario — la tabla pedía 720 px y dejaba correo, alcance y
          acciones al otro lado del scroll */}
      {visibles.length > 0 && (
      <ul className="flex flex-col gap-2.5 md:hidden">
        {visibles.map((u) => (
          <TarjetaUsuario
            key={u.id}
            usuario={u}
            paises={paises}
            roles={roles}
            esYo={u.id === miUsuarioId}
            puedeGestionar={puedeGestionar}
            onResultado={(credenciales, contexto) => setResultado({ credenciales, contexto })}
          />
        ))}
      </ul>
      )}

      <div className={`-mx-5 overflow-x-auto ${visibles.length === 0 ? 'hidden' : 'hidden md:block'}`}>
        <table className="w-full min-w-[720px]">
          <thead><tr>
            <th className={thCls}>Usuario</th><th className={thCls}>Correo</th><th className={thCls}>Rol</th><th className={thCls}>Alcance</th><th className={thCls}>Estado</th><th className={`${thCls} text-right`}>Acciones</th>
          </tr></thead>
          <tbody>
            {visibles.map((u) => (
              <FilaUsuario
                key={u.id}
                usuario={u}
                paises={paises}
                roles={roles}
                esYo={u.id === miUsuarioId}
                puedeGestionar={puedeGestionar}
                onResultado={(credenciales, contexto) => setResultado({ credenciales, contexto })}
              />
            ))}
          </tbody>
        </table>
      </div>

      {puedeGestionar && (
      <div className="mt-4 border-t border-gris-claro/50 pt-3">
        <Desplegable abierto={!creando}>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setCreando(true)}
              disabled={sinCuenta.length === 0}
              className="rounded-lg border border-dashed border-gris-claro px-3 py-1.5 text-xs font-bold text-gris transition hover:border-hunter hover:text-hunter disabled:cursor-not-allowed disabled:opacity-40"
              title={sinCuenta.length === 0 ? 'Todos los colaboradores activos ya tienen cuenta' : undefined}
            >
              ＋ Crear usuario
            </button>
            {conCorreo.length > 0 && (
              <button onClick={aprovisionar} disabled={pendiente} className="rounded-lg border border-hunter px-3 py-1.5 text-xs font-bold text-hunter transition hover:bg-hunter hover:text-white disabled:opacity-50">
                {pendiente ? 'Creando cuentas…' : <><Zap size={13} className="mr-1 inline -translate-y-px" />Crear cuentas faltantes ({conCorreo.length})</>}
              </button>
            )}
            {sinCorreo > 0 && (
              <span className="text-xs text-gris">{sinCorreo} colaborador{sinCorreo === 1 ? '' : 'es'} sin correo en el padrón: agrégalo para poder crearles cuenta.</span>
            )}
          </div>
        </Desplegable>

        <Desplegable abierto={creando}>
          <form action={crear} className="flex flex-wrap items-center gap-2 rounded-xl bg-hueso px-3 py-2.5">
            <div className="min-w-72 flex-1">
              <Combobox
                name="colaboradorId"
                opciones={sinCuenta.map((c) => ({ id: c.id, nombre: c.nombre, detalle: c.paisNombre }))}
                textoVacio="Colaborador sin cuenta…"
                onChange={elegirColaborador}
              />
            </div>
            <input
              name="email" type="email" required placeholder="correo@hunter.com.pe"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className={`${inputCls} min-w-56 flex-1`}
            />
            <CamposAcceso paises={paises} roles={roles} />
            <button type="submit" disabled={pendiente} className="rounded-lg bg-hunter px-3 py-1.5 text-xs font-bold text-white hover:bg-hunter-dark disabled:opacity-50">
              {pendiente ? 'Creando…' : 'Crear cuenta'}
            </button>
            <button type="button" onClick={() => setCreando(false)} className={btnMiniCls}>Cancelar</button>
          </form>
        </Desplegable>

        <Aviso texto={aviso} />
        {resultado && (
          <PanelCredenciales credenciales={resultado.credenciales} contexto={resultado.contexto} onCerrar={() => setResultado(null)} />
        )}
        <p className="mt-3 text-[11px] text-gris">
          Las cuentas nuevas reciben una contraseña temporal por correo y deben cambiarla en su primer ingreso. El acceso usa verificación en dos pasos por correo.
        </p>
      </div>
      )}
    </Card>
  )
}
