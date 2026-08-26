'use client'

import '../login/auth.css'
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, Lock } from 'lucide-react'
import { PASSWORD_MIN_CARACTERES, esquemaPasswordNueva } from '@/shared/lib/password'

const inputCls = 'h-11 w-full rounded-[11px] border border-gris-claro bg-white pl-10 pr-4 text-sm text-negro outline-none transition-all placeholder:text-gris/70 focus:border-hunter focus:ring-4 focus:ring-hunter/15'

function FormRestablecer() {
  const router = useRouter()
  const token = useSearchParams().get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [exito, setExito] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const politica = esquemaPasswordNueva.safeParse(password)
    if (!politica.success) { setError(politica.error.issues[0].message); return }
    if (password !== confirmar) { setError('Las contraseñas no coinciden'); return }
    setCargando(true)
    try {
      const res = await fetch('/api/auth/restablecer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) { setError(json.error ?? 'No se pudo restablecer. Inténtalo de nuevo.'); return }
      setExito(true)
    } finally {
      setCargando(false)
    }
  }

  if (!token) {
    return (
      <div className="text-center">
        <h1 className="font-display text-xl font-extrabold text-negro">Enlace incompleto</h1>
        <p className="mt-2 text-sm text-gris">Abre el enlace tal como llegó a tu correo, o solicita uno nuevo desde el login.</p>
        <button onClick={() => router.push('/login')} className="mt-5 w-full rounded-xl bg-hunter px-5 py-2.5 font-display text-sm font-bold text-white transition hover:bg-hunter-dark">
          Ir a iniciar sesión
        </button>
      </div>
    )
  }

  if (exito) {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
        <h1 className="mt-3 font-display text-xl font-extrabold text-negro">Contraseña actualizada</h1>
        <p className="mt-2 text-sm text-gris">Ya puedes ingresar con tu nueva contraseña y el código que llegará a tu correo.</p>
        <button onClick={() => router.push('/login')} className="mt-5 w-full rounded-xl bg-hunter px-5 py-2.5 font-display text-sm font-bold text-white transition hover:bg-hunter-dark">
          Ir a iniciar sesión
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={enviar}>
      <h1 className="font-display text-xl font-extrabold text-negro">Define tu nueva contraseña</h1>
      <p className="mt-1 text-[13px] text-gris">Mínimo {PASSWORD_MIN_CARACTERES} caracteres, con letras y números.</p>

      <label htmlFor="password" className="mt-5 block text-[13px] font-semibold text-negro/80">Nueva contraseña</label>
      <div className="relative mt-1.5">
        <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gris" />
        <input id="password" type="password" required minLength={PASSWORD_MIN_CARACTERES} autoFocus value={password}
          onChange={(e) => setPassword(e.target.value)} placeholder={`Mínimo ${PASSWORD_MIN_CARACTERES} caracteres, letras y números`} className={inputCls} />
      </div>

      <label htmlFor="confirmar" className="mt-4 block text-[13px] font-semibold text-negro/80">Repite la contraseña</label>
      <div className="relative mt-1.5">
        <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gris" />
        <input id="confirmar" type="password" required minLength={PASSWORD_MIN_CARACTERES} value={confirmar}
          onChange={(e) => setConfirmar(e.target.value)} placeholder="Repite la contraseña" className={inputCls} />
      </div>

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2 text-[13px] text-hunter-dark">{error}</p>}

      <button type="submit" disabled={cargando}
        className="mt-5 w-full rounded-xl bg-hunter px-5 py-2.5 font-display text-sm font-bold text-white transition hover:bg-hunter-dark disabled:opacity-50">
        {cargando ? 'Guardando…' : 'Guardar contraseña'}
      </button>
      <p className="mt-3 text-center text-xs text-gris">El enlace vence a los 30 minutos y solo puede usarse una vez.</p>
    </form>
  )
}

export default function RestablecerPage() {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-gradient-to-br from-[#f6f4f1] via-hueso to-[#f6e9ec] p-4">
      <div className="auth-card">
        {/* useSearchParams exige Suspense en el App Router */}
        <Suspense fallback={null}>
          <FormRestablecer />
        </Suspense>
      </div>
    </div>
  )
}
