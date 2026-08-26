'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Columns2 } from 'lucide-react'
import { Combobox } from '@/shared/ui/Combobox'
import { COLOR_A, COLOR_B } from './colores'

type Opcion = { id: string; nombre: string }

/** Botón «Vista comparativa» + panel para elegir Grupo A (país + área) vs Grupo B.
 * Emite un GET con comparar=1&aPais&aArea&bPais&bArea (+ ciclo): la página valida
 * los grupos en el servidor y renderiza el modo comparación. Sin área = país completo.
 * RRHH-país: el país queda fijo al suyo (solo elige áreas). */
export function SelectorComparacion({ cicloId, esRegional, paisFijo, paises, areasPorPais, activa, inicial }: {
  cicloId: string
  esRegional: boolean
  paisFijo: Opcion | null // país del observador cuando NO es Regional
  paises: Opcion[] // países del alcance CON evaluados en el ciclo
  areasPorPais: Record<string, Opcion[]> // áreas CON evaluados en el ciclo, por país
  activa: boolean
  inicial: { aPais: string; aArea: string; bPais: string; bArea: string }
}) {
  const [abierto, setAbierto] = useState(false)
  const [aPais, setAPais] = useState(inicial.aPais || paisFijo?.id || '')
  const [bPais, setBPais] = useState(inicial.bPais || paisFijo?.id || '')

  const ladoUI = (rotulo: string, color: string, pais: string, setPais: (v: string) => void, namePais: string, nameArea: string, areaInicial: string) => (
    <div className="min-w-0 flex-1 space-y-2">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-gris">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} /> {rotulo}
      </p>
      {esRegional ? (
        <Combobox name={namePais} opciones={paises} valorInicial={pais} textoVacio="Elige un país" onChange={setPais} />
      ) : (
        <>
          <input type="hidden" name={namePais} value={paisFijo?.id ?? ''} />
          <p className="rounded-lg border border-gris-claro bg-hueso px-3 py-1.5 text-sm text-negro/70">{paisFijo?.nombre}</p>
        </>
      )}
      <Combobox name={nameArea} opciones={areasPorPais[pais] ?? []} valorInicial={areaInicial} textoVacio="Todas las áreas" />
    </div>
  )

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 font-display text-[13px] font-bold transition md:w-auto md:py-2 ${activa ? 'bg-negro text-white' : 'border border-gris-claro bg-white hover:bg-hueso'}`}
      >
        <Columns2 size={15} /> Vista comparativa
      </button>

      {abierto && (
        <form method="get" className="absolute inset-x-0 top-full z-40 mt-2 rounded-2xl border border-gris-claro bg-white p-4 shadow-xl md:left-auto md:right-0 md:w-[540px] md:max-w-[92vw]">
          <input type="hidden" name="ciclo" value={cicloId} />
          <input type="hidden" name="comparar" value="1" />
          {/* Móvil: un grupo debajo del otro, con los buscadores a ancho completo */}
          <div className="flex flex-col gap-4 md:flex-row md:flex-wrap">
            {ladoUI('Grupo A', COLOR_A, aPais, setAPais, 'aPais', 'aArea', inicial.aArea)}
            {ladoUI('Grupo B', COLOR_B, bPais, setBPais, 'bPais', 'bArea', inicial.bArea)}
          </div>
          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <p className="text-[11px] text-gris">Sin área = el país completo. Solo aparecen áreas con evaluados en el ciclo.</p>
            <div className="flex items-center gap-2">
              <button className="flex-1 rounded-xl bg-hunter px-4 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark md:flex-none md:py-2">Comparar</button>
              {activa && (
                <Link href={`/admin/resultados/analisis?ciclo=${cicloId}`} className="flex-1 rounded-xl border border-gris-claro px-3.5 py-2.5 text-center text-[13px] font-bold transition hover:bg-hueso md:flex-none md:py-2">
                  Salir
                </Link>
              )}
            </div>
          </div>
        </form>
      )}
    </div>
  )
}
