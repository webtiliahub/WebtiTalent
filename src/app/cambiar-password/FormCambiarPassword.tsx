'use client'

import { PASSWORD_MIN_CARACTERES } from '@/shared/lib/password'
import { useState, useTransition } from 'react'
import { cambiarMiPassword } from '@/features/admin/acciones-usuarios'

const inputCls = 'w-full rounded-xl border border-gris-claro bg-hueso px-4 py-3 text-sm outline-none focus:border-marca'

export function FormCambiarPassword({ forzado, pideActual }: { forzado: boolean; pideActual: boolean }) {
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  function enviar(fd: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await cambiarMiPassword(fd)
      if (!res.ok) { setError(res.error); return }
      // El cambio invalida esta sesión (sello de contraseña): se vuelve a iniciar sesión con la nueva.
      window.location.assign('/login')
    })
  }

  return (
    <form action={enviar} className="space-y-4">
      {pideActual && (
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-gris">Contraseña actual</label>
          <input type="password" name="actual" required autoFocus placeholder="Tu contraseña actual" className={inputCls} />
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-gris">Nueva contraseña</label>
        <input type="password" name="password" required minLength={PASSWORD_MIN_CARACTERES} autoFocus={!pideActual} placeholder={`Mínimo ${PASSWORD_MIN_CARACTERES} caracteres, letras y números`} className={inputCls} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-gris">Confirmar contraseña</label>
        <input type="password" name="confirmar" required minLength={PASSWORD_MIN_CARACTERES} placeholder="Repite la contraseña" className={inputCls} />
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-alerta-dark">{error}</p>}
      <button
        type="submit" disabled={pendiente}
        className="w-full rounded-xl bg-marca py-3 font-display text-sm font-bold text-white shadow-lg shadow-marca/40 transition hover:bg-marca-dark disabled:opacity-60"
      >
        {pendiente ? 'Guardando…' : 'Guardar y continuar →'}
      </button>
    </form>
  )
}
