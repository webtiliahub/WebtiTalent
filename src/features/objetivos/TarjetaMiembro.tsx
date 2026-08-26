'use client'

import { useState } from 'react'
import { Modal } from '@/shared/ui/Modal'
import { Chip } from '@/shared/ui/componentes'
import { BotonDesaprobar, BotonEliminarObjetivo } from './AccionesObjetivo'
import { BotonEditarObjetivo, type ObjetivoEditable } from './FormEditarObjetivo'
import { DetalleObjetivo } from './DetalleObjetivo'

type ObjetivoMiembro = ObjetivoEditable & { estado: string }

/** Tarjeta de un miembro en "Estado por colaborador": clic para abrir el popup con sus objetivos. */
export function TarjetaMiembro({ nombre, transversales, usado, objetivos, ventanaAbierta }: {
  nombre: string
  transversales: number
  usado: number
  objetivos: ObjetivoMiembro[]
  ventanaAbierta: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const [detalleId, setDetalleId] = useState<string | null>(null)
  // Los botones de edición aparecen solo al acercar el cursor al borde derecho de la fila
  const [bordeId, setBordeId] = useState<string | null>(null)
  const aprobados = objetivos.filter((o) => o.estado === 'APROBADO').length

  return (
    <li>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="w-full rounded-xl border border-gris-claro p-4 text-left transition hover:border-hunter/50 hover:shadow-md"
      >
        <p className="text-sm font-bold">{nombre}</p>
        <p className="mt-0.5 text-xs text-gris">{transversales} transversales · {aprobados} individuales aprobados</p>
        <div className="mt-2 h-2 rounded-full bg-hueso-2">
          <div className={`h-2 rounded-full ${usado === 100 ? 'bg-emerald-500' : 'bg-hunter'}`} style={{ width: `${Math.min(usado, 100)}%` }} />
        </div>
        <p className="mt-1 flex items-center justify-between text-[11px]">
          <span className="font-semibold text-gris">Ver objetivos →</span>
          {usado === 100 ? <Chip tono="ok">100% ✓</Chip> : <Chip tono="pendiente">{usado}% asignado</Chip>}
        </p>
      </button>

      <Modal titulo={`Objetivos de ${nombre}`} abierto={abierto} onCerrar={() => setAbierto(false)}>
        <p className="mb-4 rounded-xl bg-hueso-2 px-4 py-2.5 text-xs text-gris">
          {transversales} transversales · {aprobados} individuales aprobados · <b className="text-negro">{usado}% asignado</b> de 100%.
        </p>
        {objetivos.length === 0 ? (
          <p className="rounded-xl bg-hueso-2 px-4 py-5 text-center text-sm text-gris">Aún no tiene objetivos individuales.</p>
        ) : (
          <ul className="space-y-2.5">
            {objetivos.map((o) => (
              <li
                key={o.id}
                onClick={() => setDetalleId(o.id)}
                onMouseMove={(e) => {
                  if (e.clientX > e.currentTarget.getBoundingClientRect().right - 90) setBordeId(o.id)
                }}
                onMouseLeave={() => setBordeId((actual) => (actual === o.id ? null : actual))}
                title="Ver el detalle completo del objetivo (con su descripción)"
                className="flex cursor-pointer items-center gap-4 rounded-xl border border-gris-claro px-4 py-3 transition hover:bg-hueso"
              >
                <span className="w-14 shrink-0 text-center font-display text-xl font-extrabold tracking-tight text-hunter">{o.peso}%</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{o.titulo}</p>
                </div>
                {o.estado === 'APROBADO' && <Chip tono="ok">Aprobado</Chip>}
                {o.estado === 'PROPUESTO' && <Chip tono="pendiente">Propuesto</Chip>}
                {o.estado === 'RECHAZADO' && <Chip tono="rojo">Rechazado</Chip>}
                {ventanaAbierta && o.estado === 'APROBADO' && (
                  <span
                    className={`flex shrink-0 items-center gap-1.5 overflow-hidden transition-all duration-200 ${bordeId === o.id ? 'ml-0 max-w-64 opacity-100' : '-ml-4 max-w-0 opacity-0'} focus-within:ml-0 focus-within:max-w-64 focus-within:opacity-100`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <BotonEditarObjetivo
                      objetivo={o}
                      maxPeso={Math.min(100, 100 - usado + o.peso)}
                      nota="Estás editando un objetivo ya aprobado de tu colaborador: seguirá aprobado con los cambios que guardes."
                    />
                    <BotonEliminarObjetivo objetivoId={o.id} titulo={o.titulo} />
                    <BotonDesaprobar objetivoId={o.id} titulo={o.titulo} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {ventanaAbierta && objetivos.some((o) => o.estado === 'PROPUESTO') && (
          <p className="mt-4 rounded-lg bg-hueso-2 px-3 py-2 text-xs text-gris">
            Los objetivos propuestos se aprueban o rechazan en la sección <b className="text-negro">Propuestas por aprobar</b>.
          </p>
        )}
        {(() => {
          const o = objetivos.find((x) => x.id === detalleId)
          return o ? <DetalleObjetivo objetivo={o} estado={o.estado} abierto onCerrar={() => setDetalleId(null)} /> : null
        })()}
      </Modal>
    </li>
  )
}
