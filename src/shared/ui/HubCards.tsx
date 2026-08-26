import Link from 'next/link'
import { Icono } from './iconos'
import type { ItemNav } from '../lib/navegacion'

/** Grid de cards de los hubs móviles: icono en chip de color + categoría + acción.
 * Paleta rotativa determinista (mismo criterio visual del mock aprobado). */
const TONOS = ['bg-red-50 text-hunter', 'bg-sky-50 text-sky-700', 'bg-emerald-50 text-emerald-700', 'bg-amber-50 text-amber-700', 'bg-purple-50 text-purple-700', 'bg-teal-50 text-teal-700']

export function HubCards({ items }: { items: ItemNav[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item, i) => (
        <Link key={item.href} href={item.href}
          className="flex min-h-[104px] flex-col justify-between gap-2.5 rounded-2xl border border-gris-claro bg-white p-3.5 transition active:scale-[0.98]">
          <span className={`grid h-9 w-9 place-items-center rounded-xl ${TONOS[i % TONOS.length]}`}>
            <Icono slug={item.icono} />
          </span>
          <span>
            {item.cat && <span className="block text-[9px] font-bold uppercase tracking-[0.08em] text-gris">{item.cat}</span>}
            <span className="block font-display text-[13.5px] font-bold leading-tight">{item.label}</span>
          </span>
        </Link>
      ))}
    </div>
  )
}
