import Link from 'next/link'
import { Ayuda } from './Ayuda'

export function Card({ titulo, extra, ayuda, children, className = '' }: {
  titulo?: React.ReactNode; extra?: React.ReactNode; ayuda?: string; children: React.ReactNode; className?: string
}) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-gris-claro bg-white ${className}`}>
      {titulo !== undefined && (
        // Móvil: el texto de apoyo (extra) cae DEBAJO del título; escritorio: al lado
        <header className="flex flex-col items-start gap-1 border-b border-gris-claro px-5 py-3.5 md:flex-row md:items-center md:justify-between md:gap-4">
          <h3 className="flex items-center gap-1.5 font-display text-sm font-bold">
            {titulo}
            {ayuda && <Ayuda texto={ayuda} />}
          </h3>
          {extra && <div className="text-xs text-gris">{extra}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}

export function Chip({ children, tono = 'neutro' }: { children: React.ReactNode; tono?: 'neutro' | 'ok' | 'pendiente' | 'rojo' | 'azul' }) {
  const tonos = {
    neutro: 'bg-hueso-2 text-negro/70',
    ok: 'bg-emerald-50 text-emerald-700',
    pendiente: 'bg-amber-50 text-amber-700',
    rojo: 'bg-red-50 text-alerta-dark',
    azul: 'bg-sky-50 text-sky-700',
  }
  return <span className={`inline-flex max-w-full shrink-0 items-center overflow-hidden whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tonos[tono]}`}>{children}</span>
}

// Tono estable por nombre de nivel: los 4 del manual conservan su color; los nuevos rotan la paleta.
const NIVEL_TONO: Record<string, string> = {
  'Gerencial': 'bg-purple-50 text-purple-700', 'Mando Medio': 'bg-sky-50 text-sky-700',
  'Especialista': 'bg-emerald-50 text-emerald-700', 'Apoyo': 'bg-amber-50 text-amber-700',
}
const NIVEL_PALETA = ['bg-purple-50 text-purple-700', 'bg-sky-50 text-sky-700', 'bg-emerald-50 text-emerald-700', 'bg-amber-50 text-amber-700', 'bg-rose-50 text-rose-700', 'bg-teal-50 text-teal-700']
export function NivelChip({ nivel }: { nivel: string }) {
  const hash = [...nivel].reduce((a, ch) => a + ch.charCodeAt(0), 0)
  const tono = NIVEL_TONO[nivel] ?? NIVEL_PALETA[hash % NIVEL_PALETA.length]
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tono}`}>{nivel}</span>
}

export function Avatar({ nombre, size = 'md' }: { nombre: string; size?: 'sm' | 'md' | 'lg' }) {
  const iniciales = nombre.split(' ').filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase()
  const s = size === 'lg' ? 'h-14 w-14 text-lg' : size === 'sm' ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-xs'
  return <span className={`grid shrink-0 place-items-center rounded-full bg-negro font-display font-extrabold text-white ${s}`}>{iniciales}</span>
}

export function Stat({ label, valor, sub }: { label: string; valor: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-2xl border border-gris-claro bg-white p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-gris">{label}</p>
      <p className="mt-1 font-display text-2xl font-extrabold">{valor}</p>
      {sub && <p className="mt-0.5 text-xs text-gris">{sub}</p>}
    </div>
  )
}

export function Titulo({ children, sub, accion }: { children: React.ReactNode; sub?: React.ReactNode; accion?: React.ReactNode }) {
  return (
    // Móvil: la acción cae DEBAJO del título a lo ancho (al costado quedaba aplastada
    // contra el texto); escritorio: título a la izquierda y acción a la derecha.
    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-4">
      <div>
        <h1 className="font-display text-2xl font-extrabold">{children}</h1>
        {sub && <p className="mt-0.5 text-sm text-gris">{sub}</p>}
      </div>
      {accion}
    </div>
  )
}

export function BotonLink({ href, children, variante = 'primario' }: { href: string; children: React.ReactNode; variante?: 'primario' | 'sec' }) {
  const cls = variante === 'primario'
    ? 'bg-marca text-white hover:bg-marca-dark shadow-md shadow-marca/30'
    : 'border border-gris-claro bg-white hover:bg-hueso'
  return <Link href={href} className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 font-display text-[13px] font-bold transition ${cls}`}>{children}</Link>
}

export function Nota({ valor, grande = false }: { valor: number | null | undefined; grande?: boolean }) {
  if (valor === null || valor === undefined) return <span className="text-gris">—</span>
  return <b className={`font-display text-marca ${grande ? 'text-3xl' : ''}`}>{valor.toFixed(1)}</b>
}

export function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-hueso-2 px-4 py-6 text-center text-sm text-gris">{children}</p>
}

/** Aviso de modo solo lectura: se muestra en las secciones admin cuando el rol solo tiene VER. */
export function AvisoSoloLectura({ mensaje }: { mensaje?: string }) {
  return (
    <p className="mb-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
      {mensaje ?? 'Vista de solo lectura: tu rol permite consultar esta sección sin modificarla.'}
    </p>
  )
}

export const thCls = 'px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-gris'
export const tdCls = 'px-4 py-3 text-sm border-t border-gris-claro'
