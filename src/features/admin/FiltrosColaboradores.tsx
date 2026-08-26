'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Combobox } from '@/shared/ui/Combobox'

type Opcion = { id: string; nombre: string }

/** Barra de filtros del listado de colaboradores: los combobox/select aplican SOLOS al elegir
 * (sin botón «Filtrar»); el texto aplica con Enter o al perder el foco. El botón quita todo. */
export function FiltrosColaboradores({ areas, niveles, q, area, nivel }: {
  areas: Opcion[]
  niveles: Opcion[]
  q?: string
  area?: string
  nivel?: string
}) {
  const router = useRouter()
  const [texto, setTexto] = useState(q ?? '')
  const hayFiltros = Boolean(q || area || nivel)

  function aplicar(cambios: { q?: string; area?: string; nivel?: string }) {
    const valores = { q: texto, area: area ?? '', nivel: nivel ?? '', ...cambios }
    const params = new URLSearchParams()
    if (valores.q.trim()) params.set('q', valores.q.trim())
    if (valores.area) params.set('area', valores.area)
    if (valores.nivel) params.set('nivel', valores.nivel)
    router.push(`/admin/colaboradores${params.size ? `?${params}` : ''}`)
  }

  return (
    // Móvil: buscador a lo ancho y área/nivel en fila de dos (la fila única desbordaba la
    // pantalla). Escritorio (md:contents): la fila original. 16px en móvil evita el zoom iOS.
    <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') aplicar({ q: (e.target as HTMLInputElement).value }) }}
        onBlur={(e) => { if (e.target.value.trim() !== (q ?? '')) aplicar({ q: e.target.value }) }}
        placeholder="Buscar por nombre, documento o código…"
        className="w-full rounded-xl border border-gris-claro bg-white px-3.5 py-2 text-base outline-none focus:border-hunter md:w-72 md:text-sm"
      />
      <div className="grid w-full grid-cols-2 items-center gap-2 md:contents">
        <div className="md:w-80">
          <Combobox name="area" opciones={areas} valorInicial={area ?? ''} textoVacio="Todas las áreas" onChange={(id) => aplicar({ area: id })} />
        </div>
        <select
          value={nivel ?? ''}
          onChange={(e) => aplicar({ nivel: e.target.value })}
          className="w-full rounded-xl border border-gris-claro bg-white px-3 py-2 text-base outline-none md:w-auto md:text-sm"
        >
          <option value="">Todos los niveles</option>
          {niveles.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
        </select>
      </div>
      {hayFiltros && (
        <button
          type="button"
          onClick={() => { setTexto(''); router.push('/admin/colaboradores') }}
          className="w-full rounded-xl bg-negro px-4 py-2 text-sm font-bold text-white md:w-auto"
        >
          Quitar filtros
        </button>
      )}
    </div>
  )
}
