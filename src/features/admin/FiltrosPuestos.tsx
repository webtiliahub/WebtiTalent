'use client'

import { useRouter } from 'next/navigation'
import { Combobox } from '@/shared/ui/Combobox'

type Opcion = { id: string; nombre: string; detalle?: string }

/** Filtros de la pestaña Puestos: aplican SOLOS al elegir en cada combobox; el botón quita todo. */
export function FiltrosPuestos({ areas, puestos, area, puesto }: {
  areas: Opcion[]
  puestos: Opcion[]
  area?: string
  puesto?: string
}) {
  const router = useRouter()
  const hayFiltros = Boolean(area || puesto)

  function aplicar(cambios: { area?: string; puesto?: string }) {
    const valores = { area: area ?? '', puesto: puesto ?? '', ...cambios }
    const params = new URLSearchParams()
    if (valores.area) params.set('area', valores.area)
    if (valores.puesto) params.set('puesto', valores.puesto)
    router.push(`/admin/puestos${params.size ? `?${params}` : ''}`)
  }

  return (
    // Móvil: los dos buscadores en fila de dos (a 320px cada uno desbordaban la pantalla).
    // Escritorio (md:contents): la fila original.
    <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
      <div className="grid w-full grid-cols-2 items-center gap-2 md:contents">
        <div className="md:w-80">
          <Combobox name="area" opciones={areas} valorInicial={area ?? ''} textoVacio="Todas las áreas" onChange={(id) => aplicar({ area: id })} />
        </div>
        <div className="md:w-80">
          <Combobox name="puesto" opciones={puestos} valorInicial={puesto ?? ''} textoVacio="Todos los puestos" onChange={(id) => aplicar({ puesto: id })} />
        </div>
      </div>
      {hayFiltros && (
        <button
          type="button"
          onClick={() => router.push('/admin/puestos')}
          className="w-full rounded-xl bg-negro px-4 py-2 text-sm font-bold text-white md:w-auto"
        >
          Quitar filtros
        </button>
      )}
    </div>
  )
}
