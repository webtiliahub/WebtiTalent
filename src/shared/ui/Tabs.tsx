'use client'

import { useState } from 'react'
import { Icono } from './iconos'

/**
 * Tabs internas de una página. El contenido llega ya renderizado (server components
 * como props); todas las secciones quedan montadas y solo se muestra la activa,
 * así los formularios no pierden estado al cambiar de tab.
 */
export function Tabs({ tabs, inicial, full = false, rejillaMovil = false }: {
  tabs: { id: string; label: string; icono?: string; contenido: React.ReactNode; accion?: React.ReactNode; soloEscritorio?: boolean }[]
  inicial?: string
  // `full`: en móvil los tabs se reparten a ancho uniforme (flex-1) y la acción cae a lo ancho
  // debajo; en escritorio, comportamiento normal (ancho natural + acción a la derecha)
  full?: boolean
  // `rejillaMovil`: en móvil los tabs van en rejilla de 2 columnas que cubre el ancho (con
  // etiquetas largas el flex-wrap dejaba filas de anchos dispares y huecos a la derecha);
  // el último ocupa la fila entera si el total es impar. En escritorio, sin cambios.
  rejillaMovil?: boolean
}) {
  const [activa, setActiva] = useState(inicial ?? tabs[0]?.id)
  const accion = tabs.find((t) => t.id === activa)?.accion
  // Pestañas que no se muestran en móvil (p. ej. importadores, exclusivos de Web): la última
  // VISIBLE en móvil es la que ocupa la fila entera si quedan impares
  const idsMovil = tabs.filter((t) => !t.soloEscritorio).map((t) => t.id)
  const ultimaMovil = idsMovil.length % 2 === 1 ? idsMovil[idsMovil.length - 1] : null

  return (
    <div>
      <div className={`mb-5 gap-2 border-b border-gris-claro pb-3 ${rejillaMovil ? 'grid grid-cols-2 md:flex md:flex-wrap md:items-center' : 'flex flex-wrap items-center'}`}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiva(t.id)}
            className={`flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 font-display text-[13px] font-bold transition ${full ? 'flex-1 md:flex-none' : ''} ${
              // Etiqueta a dos líneas centradas en la celda si no cabe (en escritorio, una línea)
              rejillaMovil ? 'min-w-0 whitespace-normal leading-tight md:whitespace-nowrap' : ''
            } ${t.soloEscritorio ? 'hidden md:flex' : ''} ${rejillaMovil && t.id === ultimaMovil ? 'col-span-2 md:col-span-1' : ''} ${
              activa === t.id
                ? 'bg-hunter text-white shadow-md shadow-hunter/30'
                : 'border border-gris-claro bg-white text-gris hover:bg-hueso hover:text-negro'
            }`}
          >
            {t.icono && <Icono slug={t.icono} size={15} className="shrink-0" />}
            {t.label}
          </button>
        ))}
        {/* Sin acción no se renderiza el contenedor: en rejilla ocuparía una celda vacía */}
        {accion && (
          <div className={
            full
              ? 'w-full md:ml-auto md:w-auto [&>*]:flex [&>*]:w-full [&>*]:justify-center md:[&>*]:inline-flex md:[&>*]:w-auto'
              : rejillaMovil
                ? 'col-span-2 md:col-span-1 md:ml-auto [&>*]:flex [&>*]:w-full [&>*]:justify-center md:[&>*]:inline-flex md:[&>*]:w-auto'
                : 'ml-auto'
          }>{accion}</div>
        )}
      </div>
      {tabs.map((t) => (
        <div key={t.id} hidden={activa !== t.id}>
          {t.contenido}
        </div>
      ))}
    </div>
  )
}
