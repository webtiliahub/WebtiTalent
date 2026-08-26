'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { Icono } from './iconos'
import { confirmar } from './Confirmacion'
import { MenuAvatar } from './MenuAvatar'
import { IslaNav } from './IslaNav'
import { BannerInstalar } from './BannerInstalar'
import type { GrupoNav, NavMovil } from '../lib/navegacion'

export type { ItemNav, GrupoNav } from '../lib/navegacion'

function IconoNav({ slug }: { slug: string }) {
  return (
    <span className="grid w-5 shrink-0 place-items-center">
      <Icono slug={slug} />
    </span>
  )
}

export function Shell({
  grupos, navMovil, nombre, rolLabel, alcanceLabel, paises, paisActual, esRrhhRegional, children,
}: {
  grupos: GrupoNav[]
  navMovil: NavMovil
  nombre: string
  rolLabel: string
  alcanceLabel: string | null
  paises: { id: string; codigo: string; nombre: string }[]
  paisActual: string | null
  esRrhhRegional: boolean
  children: React.ReactNode
}) {
  const pathname = usePathname()
  // Activo = el ítem con el prefijo MÁS LARGO que coincide con la ruta (en /equipo/objetivos
  // matchean /equipo y /equipo/objetivos; solo debe encenderse el segundo)
  const hrefActivo = grupos
    .flatMap((g) => g.items)
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href
  const [abierto, setAbierto] = useState(false)
  const iniciales = nombre.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()

  async function cambiarPais(paisId: string) {
    await fetch('/api/preferencias/pais', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paisId: paisId || null }),
    })
    window.location.reload()
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        onMouseEnter={() => setAbierto(true)}
        onMouseLeave={() => setAbierto(false)}
        className={`hidden md:flex fixed inset-y-0 left-0 z-40 flex-col bg-negro text-white transition-all duration-200 ${abierto ? 'w-60' : 'w-16'}`}
      >
        <div className="flex h-16 items-center gap-3 px-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo/webtilia-iso.png" alt="Webtilia" className="h-8 w-8 shrink-0 object-contain" />
          <span className={`whitespace-nowrap font-display text-sm font-bold tracking-wide transition-opacity ${abierto ? 'opacity-100' : 'opacity-0'}`}>
            WebtiTalent
          </span>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {grupos.map((g) => (
            <div key={g.titulo} className="mt-4">
              <p className={`overflow-hidden whitespace-nowrap px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/40 transition-opacity ${abierto ? 'opacity-100' : 'opacity-0'}`}>
                {g.titulo}
              </p>
              <ul className="mt-1 space-y-0.5">
                {g.items.map((item) => {
                  const activo = item.href === hrefActivo
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={item.label}
                        className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] transition ${
                          activo
                            ? 'bg-gradient-to-r from-marca/30 to-transparent font-semibold text-white shadow-[inset_3px_0_0_0_#0067ff]'
                            : 'text-white/70 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <IconoNav slug={item.icono} />
                        <span className={`whitespace-nowrap transition-opacity ${abierto ? 'opacity-100' : 'opacity-0'}`}>{item.label}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
        <button
          onClick={async () => {
            if (await confirmar('¿Cerrar tu sesión?', { titulo: 'Cerrar sesión', textoAceptar: 'Cerrar sesión' })) signOut({ callbackUrl: '/login' })
          }}
          className="m-2 flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] text-white/60 transition hover:bg-white/5 hover:text-white"
        >
          <IconoNav slug="cerrar-sesion" />
          <span className={`whitespace-nowrap transition-opacity ${abierto ? 'opacity-100' : 'opacity-0'}`}>Cerrar sesión</span>
        </button>
      </aside>

      {/* Main */}
      <div className="md:ml-16 flex min-h-screen min-w-0 flex-1 flex-col">
        {/* Topbar móvil: marca + avatar (menú con país y cerrar sesión confirmado) */}
        {/* min-h (no h fija): en la PWA instalada con notch, el safe-area-inset-top crece la barra
            en vez de aplastar su contenido (h-14 fija dejaba ~9px útiles bajo el inset) */}
        <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between border-b border-gris-claro bg-hueso px-4 md:hidden" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <span className="flex items-center gap-2 font-display text-sm font-bold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo/webtilia-iso.png" alt="Webtilia" className="h-6 w-6 object-contain" />
            WebtiTalent
          </span>
          <MenuAvatar nombre={nombre} rolLabel={rolLabel} paises={paises} paisActual={paisActual} esRrhhRegional={esRrhhRegional} />
        </header>
        <BannerInstalar />
        <header className="sticky top-0 z-30 hidden md:flex h-16 items-center justify-between border-b border-gris-claro bg-white px-6">
          <div className="font-display text-lg font-bold">Evaluación de Desempeño 360</div>
          <div className="flex items-center gap-4">
            {esRrhhRegional ? (
              <select
                value={paisActual ?? ''}
                onChange={(e) => cambiarPais(e.target.value)}
                title="Alcance de datos (tu rol no cambia)"
                className="rounded-full border border-gris-claro bg-hueso px-3 py-1.5 text-xs font-semibold outline-none"
              >
                <option value="">Todos los países</option>
                {paises.map((p) => (
                  <option key={p.id} value={p.id}>{p.codigo === 'PE' ? '🇵🇪' : p.codigo === 'EC' ? '🇪🇨' : p.codigo === 'CO' ? '🇨🇴' : '🇨🇱'} {p.nombre}</option>
                ))}
              </select>
            ) : alcanceLabel ? (
              <span className="rounded-full border border-gris-claro bg-hueso px-3 py-1.5 text-xs font-semibold">{alcanceLabel}</span>
            ) : null}
            <div className="flex items-center gap-2.5">
              <div className="text-right leading-tight">
                <div className="text-sm font-bold">{nombre}</div>
                <div className="text-[11px] text-gris">{rolLabel}</div>
              </div>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-marca font-display text-xs font-extrabold text-white">{iniciales}</span>
            </div>
          </div>
        </header>
        {/* min-w-0: sin esto, el main (flex-1) tiene min-width:auto y CRECE con su contenido
            en vez de ceñirse al ancho disponible — los contenedores con overflow-x-auto
            interiores (steppers, tablas) no scrolleaban y empujaban toda la página */}
        <main className="min-w-0 flex-1 px-4 pb-28 pt-4 md:px-6 md:py-6">{children}</main>
        <IslaNav nav={navMovil} />
      </div>
    </div>
  )
}
