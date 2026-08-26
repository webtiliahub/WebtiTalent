'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { nominarPar, quitarPar, buscarCandidatosPar } from './acciones'
import { Combobox } from '@/shared/ui/Combobox'
import { toast } from '@/shared/ui/Toast'

type Par = { evaluadorId: string; nombre: string; estado: string }
type Miembro = { id: string; nombre: string; puesto: string; pares: Par[] }

/** El jefe nomina 2 pares por miembro de su equipo (manual Hunter, año 1), en tabla con un
 * dropdown por slot. Pares del propio equipo entran directo; de otros equipos (equipos chicos
 * que trabajan juntos) quedan como propuesta hasta que RR.HH. las apruebe. Anónimo para la
 * persona evaluada. */
export function NominadorPares({ cicloId, equipo }: {
  cicloId: string
  equipo: Miembro[]
}) {
  const router = useRouter()
  const [pendiente, startTransition] = useTransition()

  const nominar = (evaluadoId: string, evaluadorId: string) => {
    startTransition(async () => {
      const res = await nominarPar(cicloId, evaluadoId, evaluadorId)
      if (!res.ok) { toast(res.error); return }
      toast(res.propuesto ? 'Propuesto: espera aprobación de RR.HH.' : 'Par nominado ✓')
      router.refresh()
    })
  }

  const retirar = (evaluadoId: string, evaluadorId: string) => {
    startTransition(async () => {
      const res = await quitarPar(cicloId, evaluadoId, evaluadorId)
      if (!res.ok) { toast(res.error); return }
      toast('Nominación retirada')
      router.refresh()
    })
  }

  const celda = (m: Miembro, slot: number) => {
    const p = m.pares[slot]
    if (p) {
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5 text-[13px]">
          {p.nombre}
          {p.estado === 'PROPUESTA' && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">espera a RR.HH.</span>}
          {p.estado === 'ENVIADA'
            ? <span className="text-[10px] font-bold text-emerald-700">respondió ✓</span>
            : <button type="button" onClick={() => retirar(m.id, p.evaluadorId)} title="Retirar nominación" className="font-bold text-gris transition hover:text-hunter">✕</button>}
        </span>
      )
    }
    // Slot libre: buscador SERVER-SIDE (el padrón ya no viaja al cliente). Descarta al propio
    // evaluado y a los ya asignados sobre los ≤20 que devuelve el servidor por término.
    const yaAsignados = new Set(m.pares.map((x) => x.evaluadorId))
    const buscar = async (q: string) => {
      const r = await buscarCandidatosPar(cicloId, q)
      return r
        .filter((x) => x.id !== m.id && !yaAsignados.has(x.id))
        .sort((a, b) => Number(b.esDeMiEquipo) - Number(a.esDeMiEquipo) || a.nombre.localeCompare(b.nombre))
        .map((x) => ({
          id: x.id,
          nombre: x.nombre,
          detalle: [x.detalle, x.esDeMiEquipo ? 'tu equipo' : 'otro equipo — aprueba RR.HH.'].filter(Boolean).join(' · '),
        }))
    }
    return (
      <div className="w-full md:max-w-[260px]">
        <Combobox
          key={`${m.id}-${slot}-${m.pares.length}`}
          name={`par-${m.id}-${slot}`}
          textoVacio="⚠ Sin asignar — buscar…"
          buscar={buscar}
          onChange={(id) => { if (id && !pendiente) nominar(m.id, id) }}
        />
      </div>
    )
  }

  return (
    <div>
      {/* Móvil: un bloque vertical por colaborador con los dos slots a lo ancho — la tabla de
          3 columnas desbordaba la pantalla y cortaba los buscadores. Escritorio: la tabla. */}
      <ul className="space-y-2.5 md:hidden">
        {equipo.map((m) => (
          <li key={m.id} className="rounded-xl border border-gris-claro px-3.5 py-3">
            <p className="text-[13.5px] font-bold">{m.nombre}</p>
            <p className="mb-2.5 text-xs text-gris">{m.puesto}</p>
            <div className="space-y-2">
              {[0, 1].map((slot) => (
                <div key={slot} className="flex items-center gap-2.5">
                  <span className="w-10 shrink-0 text-[10px] font-extrabold tracking-wide text-gris">PAR {slot + 1}</span>
                  <div className="min-w-0 flex-1">{celda(m, slot)}</div>
                </div>
              ))}
            </div>
            {m.pares.length > 2 && <p className="mt-1.5 text-[11px] text-gris">+{m.pares.length - 2} adicional{m.pares.length - 2 === 1 ? '' : 'es'}</p>}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gris-claro text-left text-[11px] font-bold uppercase tracking-wide text-gris">
              <th className="py-2 pr-3">Colaborador</th>
              <th className="py-2 pr-3">Par evaluador 1</th>
              <th className="py-2 pr-3">Par evaluador 2</th>
            </tr>
          </thead>
          <tbody>
            {equipo.map((m) => (
              <tr key={m.id} className="border-b border-hueso-2 align-middle">
                <td className="py-2.5 pr-3">
                  <p className="font-bold">{m.nombre}</p>
                  <p className="text-xs text-gris">{m.puesto}</p>
                </td>
                <td className="py-2.5 pr-3">{celda(m, 0)}</td>
                <td className="py-2.5 pr-3">
                  {celda(m, 1)}
                  {m.pares.length > 2 && <p className="mt-0.5 text-[11px] text-gris">+{m.pares.length - 2} adicional{m.pares.length - 2 === 1 ? '' : 'es'}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-gris">
        Si tu equipo es chico, puedes proponer a alguien de otro equipo con el que se trabaje directamente: RR.HH. deberá aprobarlo antes de que evalúe.
      </p>
    </div>
  )
}
