'use client'

import { useEffect, useState, useTransition, type ReactNode } from 'react'

export const inputCls = 'rounded-lg border border-gris-claro bg-white px-3 py-1.5 text-sm outline-none focus:border-marca'
// min-h/min-w solo en móvil: estos botones son iconos de ~26 px, imposibles de acertar con el
// dedo. En escritorio (md+) conservan su tamaño compacto de siempre.
export const btnMiniCls = 'inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg px-2 py-1 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro md:min-h-0 md:min-w-0'

export function useAccion() {
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()
  function ejecutar(fn: () => Promise<{ ok: boolean; error?: string; aviso?: string | null }>, exito?: () => void) {
    setAviso(null)
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) { setAviso(res.error ?? 'Ocurrió un error'); return }
      // Éxito CON advertencia: el cambio se aplicó, pero algo quedó fuera y hay que decirlo (por
      // ejemplo, un correo de acceso que esta persona no tiene permiso para mover). No se llama a
      // `exito` para que el pop-up siga abierto: si se cerrara, nadie leería el aviso.
      if (res.aviso) { setAviso(res.aviso); return }
      exito?.()
    })
  }
  return { aviso, setAviso, pendiente, ejecutar }
}

// ── Despliegue animado en ambos sentidos (mismo patrón grid-rows que las dimensiones).
// Monta el contenido al abrir y lo desmonta al terminar la animación de cierre,
// así los formularios siempre arrancan frescos (defaultValue al día).
export function Desplegable({ abierto, children }: { abierto: boolean; children: ReactNode }) {
  const [montado, setMontado] = useState(abierto)
  const [expandido, setExpandido] = useState(abierto)
  if (abierto && !montado) setMontado(true)
  useEffect(() => {
    const id = requestAnimationFrame(() => setExpandido(abierto))
    const t = abierto ? undefined : setTimeout(() => setMontado(false), 300)
    return () => {
      cancelAnimationFrame(id)
      if (t) clearTimeout(t)
    }
  }, [abierto])
  if (!montado) return null
  return (
    <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${expandido ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
      <div className={`overflow-hidden transition-opacity duration-300 ${expandido ? 'opacity-100' : 'opacity-0'}`}>{children}</div>
    </div>
  )
}

export function Aviso({ texto }: { texto: string | null }) {
  if (!texto) return null
  return <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-alerta-dark">{texto}</p>
}

// ── Fila editable (nombre + descripción opcional, con renombrar/eliminar al hover) ──
export function FilaEditable({ nombre, descripcion, enUso, conDescripcion, mostrarDescripcion, soloLectura = false, onClickNombre, onGuardar, onEliminar }: {
  nombre: string
  descripcion?: string | null
  enUso: boolean
  conDescripcion?: boolean
  mostrarDescripcion?: boolean
  soloLectura?: boolean // modo VER: sin renombrar/eliminar
  onClickNombre?: () => void
  onGuardar: (fd: FormData) => void
  onEliminar: () => void
}) {
  const [editando, setEditando] = useState(false)
  if (soloLectura) {
    return (
      <div className="flex items-center gap-2 py-1">
        <span className={`flex-1 ${onClickNombre ? 'cursor-pointer select-none' : ''}`} onClick={onClickNombre}>
          <span className="block text-sm">{nombre}</span>
          {mostrarDescripcion && descripcion && <span className="block text-xs text-gris">{descripcion}</span>}
        </span>
      </div>
    )
  }
  return (
    <>
      <Desplegable abierto={editando}>
        <form
          className="flex flex-wrap items-center gap-2"
          action={(fd) => { onGuardar(fd); setEditando(false) }}
        >
          <input name="nombre" defaultValue={nombre} className={`${inputCls} flex-1 min-w-40`} autoFocus />
          {conDescripcion && <input name="descripcion" defaultValue={descripcion ?? ''} placeholder="Descripción (opcional)" className={`${inputCls} flex-1 min-w-40`} />}
          <button type="submit" className="rounded-lg bg-marca px-3 py-1.5 text-xs font-bold text-white hover:bg-marca-dark">Guardar</button>
          <button type="button" onClick={() => setEditando(false)} className={btnMiniCls}>Cancelar</button>
        </form>
      </Desplegable>
      <Desplegable abierto={!editando}>
        <div className="group flex items-center gap-2">
          <span className={`flex-1 ${onClickNombre ? 'cursor-pointer select-none' : ''}`} onClick={onClickNombre}>
            <span className="block text-sm">{nombre}</span>
            {mostrarDescripcion && descripcion && <span className="block text-xs text-gris">{descripcion}</span>}
          </span>
          <button onClick={() => setEditando(true)} className={`${btnMiniCls} opacity-0 group-hover:opacity-100`} title="Renombrar">✎</button>
          <button
            onClick={onEliminar}
            disabled={enUso}
            className={`${btnMiniCls} opacity-0 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30`}
            title={enUso ? 'En uso: no se puede eliminar' : 'Eliminar'}
          >✕</button>
        </div>
      </Desplegable>
    </>
  )
}

// ── Form inline "agregar" (colapsado: los inputs aparecen al pulsar el botón) ──
export function FormAgregar({ etiqueta, placeholder, onCrear, pendiente, conDescripcion }: {
  etiqueta: string
  placeholder: string
  onCrear: (fd: FormData) => void
  pendiente: boolean
  conDescripcion?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  return (
    <>
      <Desplegable abierto={!abierto}>
        <button onClick={() => setAbierto(true)} className="mt-2 rounded-lg border border-dashed border-gris-claro px-3 py-1.5 text-xs font-bold text-gris transition hover:border-marca hover:text-marca">
          ＋ {etiqueta}
        </button>
      </Desplegable>
      <Desplegable abierto={abierto}>
        <form className="mt-2 flex flex-wrap gap-2" action={onCrear}>
          <input name="nombre" placeholder={placeholder} className={`${inputCls} flex-1 min-w-44`} required minLength={2} autoFocus />
          {conDescripcion && <input name="descripcion" placeholder="Descripción (opcional)" className={`${inputCls} flex-[2] min-w-56`} />}
          <button type="submit" disabled={pendiente} className="rounded-lg border border-marca px-3 py-1.5 text-xs font-bold text-marca transition hover:bg-marca hover:text-white disabled:opacity-50">
            ＋ Agregar
          </button>
          <button type="button" onClick={() => setAbierto(false)} className={btnMiniCls}>Cancelar</button>
        </form>
      </Desplegable>
    </>
  )
}

/** Campo etiquetado para formularios en grilla (etiqueta uppercase + control full-width). */
export function Campo({ etiqueta, className = '', children }: { etiqueta: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gris">{etiqueta}</span>
      {children}
    </label>
  )
}
