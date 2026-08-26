'use client'

import './auth.css'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { signIn, getSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Mail, Lock, Check } from 'lucide-react'
import { playLoginChime } from '@/features/auth/chime'

// Formato completo: requiere dominio con TLD (a@b.co), no solo a@b
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Bienvenida post-login: mínimo para que la transición se sienta (no un parpadeo),
// máximo para nunca retener al usuario por una precarga lenta.
const BIENVENIDA_MIN_MS = 1200
const BIENVENIDA_MAX_MS = 2500
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

const inputCls = 'h-11 w-full rounded-[11px] border border-gris-claro bg-white pl-10 pr-10 text-sm text-negro outline-none transition-all placeholder:text-gris/70 focus:border-marca focus:ring-4 focus:ring-marca/15'

/** Sección que se expande/colapsa con transición de grid. Libera el overflow al terminar
 *  de expandirse para que el glow del focus y la sombra del hover no queden recortados. */
function Reveal({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [settled, setSettled] = useState(false)
  return (
    <div
      aria-hidden={!open}
      className={`grid transition-[grid-template-rows] duration-500 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      onTransitionEnd={() => setSettled(open)}
    >
      <div className={`min-h-0 ${open && settled ? '' : 'overflow-hidden'}`}>{children}</div>
    </div>
  )
}

/** Isotipo de Webtilia (la W) con halo pulsante y anillo girando. */
function AuthLogo() {
  return (
    <div className="flex justify-center">
      <div className="auth-logo">
        <div className="auth-logo-halo" />
        <div className="auth-logo-ring" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo/webtilia-w.png" alt="Webtilia" className="auth-logo-iso" />
      </div>
    </div>
  )
}

/** Fondo animado: mesh + anillos orbitando + partículas + slogan. Decorativo puro. */
function AuthBackground() {
  return (
    <div aria-hidden className="pointer-events-none">
      <div className="auth-mesh" />
      <div className="fixed left-1/2 top-1/2 h-0 w-0">
        <div className="auth-ring auth-ring-1" />
        <div className="auth-ring auth-ring-2" />
        <div className="auth-ring auth-ring-3" />
        <div className="auth-orbit-dot" />
        <div className="auth-orbit-dot auth-orbit-dot--negro" />
      </div>
      <div className="auth-particle" style={{ left: '12%', width: 5, height: 5, animationDuration: '14s' }} />
      <div className="auth-particle" style={{ left: '28%', width: 4, height: 4, animationDuration: '18s', animationDelay: '3s' }} />
      <div className="auth-particle auth-particle--negro" style={{ left: '66%', width: 6, height: 6, animationDuration: '16s', animationDelay: '6s' }} />
      <div className="auth-particle" style={{ left: '84%', width: 4, height: 4, animationDuration: '20s', animationDelay: '1.5s' }} />
      <div className="auth-particle" style={{ left: '48%', width: 3, height: 3, animationDuration: '22s', animationDelay: '9s' }} />
      <p className="auth-slogan auth-stagger auth-s6 fixed bottom-6 left-0 right-0 z-[5] text-center font-display text-[13px] font-semibold tracking-wide text-negro/45">
        Evaluación de Desempeño <b className="font-bold text-marca">360</b>
      </p>
      {/* Velo superior: la franja de estado del sistema se pinta #f6f4f1 (manifest) y las capas
          decorativas rosas llegaban al borde creando una costura — este fundido hace que el tope
          de la página sea EXACTAMENTE ese color y el rosa aparezca gradualmente más abajo */}
      <div className="fixed inset-x-0 top-0 z-[5] h-28 bg-gradient-to-b from-[#f6f4f1] from-15% via-[#f6f4f1]/70 to-transparent" />
    </div>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const [paso, setPaso] = useState<1 | 2>(1)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  // null = sin bienvenida; con valor = overlay visible (nombre llega async desde la sesión)
  const [bienvenida, setBienvenida] = useState<{ nombre: string | null } | null>(null)
  // Modo «¿Olvidaste tu contraseña?»: la misma tarjeta pide solo el correo y responde SIEMPRE
  // el mismo mensaje (no revela si la cuenta existe)
  const [recuperando, setRecuperando] = useState(false)
  const [recuperacionEnviada, setRecuperacionEnviada] = useState(false)

  async function solicitarRestablecimiento(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setCargando(true)
    try {
      const res = await fetch('/api/auth/solicitar-restablecimiento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      // Solo el ÉXITO muestra el mensaje neutro; un error del servidor no debe fingir envío
      if (!res.ok) { setError(data.error ?? 'No se pudo procesar. Intenta nuevamente.'); return }
      setRecuperacionEnviada(true)
    } catch {
      setError('No se pudo conectar. Intenta nuevamente.')
    } finally {
      setCargando(false)
    }
  }

  function volverAlLogin() {
    setRecuperando(false)
    setRecuperacionEnviada(false)
    setError(null)
  }

  // Login progresivo: la contraseña aparece con email válido; el botón, con ambos campos llenos
  const emailValido = EMAIL_RE.test(email.trim())
  const mostrarBoton = emailValido && password.length > 0

  async function solicitarCodigo(e: React.FormEvent) {
    e.preventDefault()
    if (!mostrarBoton) return
    setError(null)
    setCargando(true)
    try {
      const res = await fetch('/api/auth/solicitar-codigo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!data.ok) {
        setError(data.error ?? 'Correo o contraseña incorrectos')
        return
      }
      setPaso(2)
    } catch {
      setError('No se pudo conectar. Intenta nuevamente.')
    } finally {
      setCargando(false)
    }
  }

  async function verificarCodigo(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setCargando(true)
    try {
      const res = await signIn('credentials', { email, codigo, redirect: false })
      if (res?.error) {
        setError('Código incorrecto o vencido')
        return
      }
      playLoginChime()
      // Bienvenida con precarga: mientras corre la animación se calientan la ruta destino y la sesión (saludo).
      const destino = '/hoja-de-vida'
      const inicioTs = Date.now()
      setBienvenida({ nombre: null })
      router.prefetch(destino)
      const precarga = getSession().then((s) => {
        const nombre = s?.user?.name?.split(' ')[0]
        if (nombre) setBienvenida({ nombre })
      })
      await Promise.race([precarga, esperar(BIENVENIDA_MAX_MS)])
      const restante = BIENVENIDA_MIN_MS - (Date.now() - inicioTs)
      if (restante > 0) await esperar(restante)
      router.push(destino)
      router.refresh()
    } finally {
      setCargando(false)
    }
  }

  // min-h-dvh (no screen/100vh): en móvil 100vh incluye el espacio tras la barra del navegador
  // y descentra la tarjeta con scroll fantasma; dvh mide lo realmente visible en cada dispositivo
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-gradient-to-br from-[#f6f4f1] via-hueso to-[#f6e9ec] p-4">
      <AuthBackground />

      <div className="auth-card">
        <div className="auth-stagger auth-s1">
          <AuthLogo />
        </div>
        <div className="auth-stagger auth-s2 mb-7 mt-3 text-center">
          <h1 className="font-display text-[23px] font-extrabold tracking-tight text-negro">
            Talent <span className="text-marca">Hub</span>
          </h1>
          <p className="mt-1 text-[13.5px] text-gris">Plataforma de talento — Webtilia</p>
        </div>

        {recuperando ? (
          recuperacionEnviada ? (
            <div className="text-center">
              <p className="text-[14px] font-semibold text-negro">Revisa tu correo</p>
              <p className="mt-2 text-[13px] text-gris">Si la cuenta existe, enviamos un enlace para cambiar tu contraseña a:</p>
              <p className="mt-1.5 break-all text-[13.5px] font-semibold text-negro">{email.trim()}</p>
              <p className="mt-1.5 text-[12.5px] text-gris/80">El enlace es válido por 30 minutos.</p>
              <button type="button" onClick={volverAlLogin} className="mt-5 text-[13px] font-semibold text-marca hover:underline">
                ← Volver a iniciar sesión
              </button>
            </div>
          ) : (
            <form onSubmit={solicitarRestablecimiento}>
              <p className="text-[14px] font-semibold text-negro">Restablecer contraseña</p>
              <p className="mt-1 text-[13px] text-gris">Te enviaremos un enlace a tu correo corporativo para cambiar tu contraseña.</p>
              <label htmlFor="email-rec" className="mt-4 block text-[13px] font-semibold text-negro/80">Correo corporativo</label>
              <div className="relative mt-1.5">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gris" />
                <input
                  id="email-rec" type="email" autoComplete="username" required autoFocus value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nombre@marca.com.pe"
                  className={inputCls}
                />
              </div>
              {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2 text-[13px] text-alerta-dark">{error}</p>}
              <button
                type="submit" disabled={cargando || !emailValido}
                className="mt-4 h-[46px] w-full rounded-[11px] bg-gradient-to-r from-marca-dark to-marca font-display text-[15px] font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-60"
              >
                {cargando ? 'Enviando…' : 'Enviar enlace'}
              </button>
              <button type="button" onClick={volverAlLogin} className="mt-3 w-full text-center text-[13px] text-gris hover:text-negro">
                ← Volver a iniciar sesión
              </button>
            </form>
          )
        ) : paso === 1 ? (
          <form onSubmit={solicitarCodigo}>
            <div className="auth-stagger auth-s3">
              <label htmlFor="email" className="text-[13px] font-semibold text-negro/80">Correo corporativo</label>
              <div className="relative mt-1.5">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gris" />
                <input
                  id="email" name="email" type="email" autoComplete="username" required autoFocus value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nombre@marca.com.pe"
                  className={inputCls}
                />
                <Check
                  aria-hidden
                  className={`pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-marca transition-all duration-300 ${emailValido ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}
                />
              </div>
            </div>

            <Reveal open={!emailValido}>
              <p className="pt-3 text-center text-[12.5px] text-gris/80">Ingresa tu correo para continuar</p>
            </Reveal>

            <Reveal open={emailValido}>
              <div className="pt-4">
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="text-[13px] font-semibold text-negro/80">Contraseña</label>
                  {/* Gris claro a la derecha del label (pedido de Christian): visible sin saturar */}
                  <button type="button" onClick={() => { setRecuperando(true); setError(null) }} className="text-xs text-gris/70 transition hover:text-negro">
                    ¿Recuperar contraseña?
                  </button>
                </div>
                <div className="relative mt-1.5">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gris" />
                  <input
                    id="password" name="password" type="password" autoComplete="current-password"
                    required={emailValido}
                    tabIndex={emailValido ? undefined : -1}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className={inputCls}
                  />
                </div>
              </div>
            </Reveal>

            <Reveal open={mostrarBoton}>
              <div className="pt-4">
                <button
                  type="submit" disabled={cargando}
                  tabIndex={mostrarBoton ? undefined : -1}
                  className="auth-btn-shine h-[46px] w-full rounded-[11px] bg-gradient-to-r from-marca-dark to-marca font-display text-[15px] font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_26px_rgba(240,22,62,0.4)] disabled:opacity-60"
                >
                  {cargando ? 'Verificando…' : 'Continuar →'}
                </button>
                <p className="pt-3 text-center text-[12.5px] text-gris/80">
                  Verificación en dos pasos: te enviaremos un código a tu correo.
                </p>
              </div>
            </Reveal>

            {error && <p className="pt-4 text-center text-sm text-marca-dark">{error}</p>}
          </form>
        ) : (
          <form onSubmit={verificarCodigo}>
            <p className="auth-stagger auth-s1 text-center text-[13.5px] text-gris">
              Enviamos un código de 6 dígitos a<br /><b className="text-negro">{email}</b> · válido por 10 minutos.
            </p>
            <div className="auth-stagger auth-s2 pt-4">
              <input
                inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="h-14 w-full rounded-[11px] border border-gris-claro bg-white text-center font-display text-2xl font-bold tracking-[0.5em] text-negro outline-none transition-all placeholder:text-gris/40 focus:border-marca focus:ring-4 focus:ring-marca/15"
              />
            </div>
            <Reveal open={codigo.length === 6}>
              <div className="pt-4">
                <button
                  type="submit" disabled={cargando || codigo.length !== 6}
                  className="auth-btn-shine h-[46px] w-full rounded-[11px] bg-gradient-to-r from-marca-dark to-marca font-display text-[15px] font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_26px_rgba(240,22,62,0.4)] disabled:opacity-60"
                >
                  {cargando ? 'Ingresando…' : 'Ingresar ✓'}
                </button>
              </div>
            </Reveal>
            {error && <p className="pt-4 text-center text-sm text-marca-dark">{error}</p>}
            <div className="auth-stagger auth-s3 pt-4">
              <button
                type="button"
                onClick={() => { setPaso(1); setCodigo(''); setError(null) }}
                className="w-full text-center text-[12.5px] text-gris transition-colors hover:text-negro"
              >
                ← Volver
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Portal a body: la card tiene transform (respiración) y atraparía un position:fixed */}
      {bienvenida && createPortal(
        <div className="auth-welcome" role="status" aria-live="polite">
          <AuthLogo />
          <h2 className="auth-stagger auth-s2 mt-2 font-display text-[21px] font-bold tracking-tight text-negro">
            ¡Bienvenido{bienvenida.nombre ? `, ${bienvenida.nombre}` : ''}!
          </h2>
          <p className="auth-stagger auth-s3 text-[13.5px] text-gris">Preparando tu espacio…</p>
          <div className="auth-stagger auth-s4 auth-progress" />
        </div>,
        document.body,
      )}
    </div>
  )
}
