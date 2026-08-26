'use client'

import { useRef, useState } from 'react'
import { SelectorMultiple } from '@/shared/ui/SelectorMultiple'

type Opcion = { id: string; nombre: string }

/**
 * Filtros de las vistas de Resultados (9-Box y Análisis). Dos cosas que la versión con
 * `<form method="get">` + botón «Aplicar» no daba:
 *  - Ancho controlado: un `<select>` nativo adopta el ancho de su opción más larga («Operaciones
 *    De Rastreo Y Captura - Centro…» medía 585 px) y arrastraba TODA la página a 601 px en el
 *    teléfono. Con w-full + min-w-0 en móvil el problema desaparece de raíz.
 *  - Un toque menos: al elegir un filtro se navega solo; el botón «Aplicar» ya no hace falta.
 *
 * En móvil los filtros van en rejilla: ciclo y área a lo ancho (sus nombres son los largos),
 * nivel y país a media pantalla.
 */
export function FiltrosResultados({
  ciclos, areas, cicloSel, areasSel,
  niveles, nivelSel, paises, paisSel,
  camposFijos, soloCiclo = false, campoArea = 'areas',
}: {
  ciclos: Opcion[]
  areas: Opcion[]
  cicloSel: string
  areasSel: string[] // varias áreas: el corte puede ser «Comercial + Marketing»
  niveles?: Opcion[]
  nivelSel?: string
  paises?: Opcion[]
  paisSel?: string
  // Valores que deben viajar en la URL sin ser editables aquí (p. ej. los grupos comparados)
  camposFijos?: Record<string, string>
  // Comparación activa: el corte lo definen los grupos, así que solo manda el ciclo
  soloCiclo?: boolean
  // El 9-Box lee el área como `areas`; el análisis, como `area`
  campoArea?: 'area' | 'areas'
}) {
  const form = useRef<HTMLFormElement>(null)
  // Al cambiar de filtro el cuadrante/selección previa deja de tener sentido: no se propaga.
  const enviar = () => form.current?.requestSubmit()

  /* Áreas: selección MÚLTIPLE. A diferencia de los selects simples no se envía en cada toque
     (marcar tres áreas serían tres recargas): aparece «Aplicar» mientras la selección difiera
     de la que está en la URL. */
  const [areasElegidas, setAreasElegidas] = useState<string[]>(areasSel)
  const mismas = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',')
  const hayCambio = !mismas(areasElegidas, areasSel)

  const selectCls = 'w-full min-w-0 rounded-xl border border-gris-claro bg-white px-3 py-2.5 text-sm outline-none transition focus:border-marca sm:w-auto sm:py-2'

  return (
    <form ref={form} method="get" className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
      {Object.entries(camposFijos ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <select name="ciclo" defaultValue={cicloSel} onChange={enviar} aria-label="Ciclo" className={`${selectCls} col-span-2 sm:col-span-1`}>
        {ciclos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </select>
      {!soloCiclo && (
        <>
          <div className="col-span-2 min-w-0 sm:col-span-1 sm:w-64">
            <input type="hidden" name={campoArea} value={areasElegidas.join(',')} />
            <SelectorMultiple
              etiqueta="Áreas"
              etiquetaOculta
              opciones={areas}
              seleccion={areasElegidas}
              onCambio={setAreasElegidas}
              textoVacio="Todas las áreas"
            />
          </div>
          {niveles && (
            <select name="nivel" defaultValue={nivelSel ?? ''} onChange={enviar} aria-label="Nivel" className={selectCls}>
              <option value="">Todos los niveles</option>
              {niveles.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
            </select>
          )}
          {paises && paises.length > 0 && (
            <select name="pais" defaultValue={paisSel ?? ''} onChange={enviar} aria-label="País" className={selectCls}>
              <option value="">Todos los países</option>
              {paises.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          )}
        </>
      )}
      {/* Hueco RESERVADO para «Aplicar»: el botón entra y sale según haya cambios y, sin un sitio
          fijo, su aparición ensanchaba el formulario y empujaba «Vista comparativa» a otra fila.
          En escritorio el hueco existe siempre (ancho fijo, cabe la etiqueta más larga); en móvil
          cada control ocupa su propia fila, así que ahí sí se quita para no dejar un vacío. */}
      {!soloCiclo && (
        <div className={`col-span-2 sm:col-span-1 sm:w-[168px] ${hayCambio ? '' : 'hidden sm:block'}`}>
          {hayCambio && (
            <button className="w-full whitespace-nowrap rounded-xl bg-negro px-4 py-2.5 text-sm font-bold text-white transition hover:bg-negro/85 sm:py-2">
              Aplicar {areasElegidas.length > 0 ? `(${areasElegidas.length} área${areasElegidas.length === 1 ? '' : 's'})` : '(todas)'}
            </button>
          )}
        </div>
      )}
      {/* Sin JS el envío automático no ocurre: el botón queda como respaldo */}
      <noscript>
        <button className="col-span-2 w-full rounded-xl bg-negro px-4 py-2.5 text-sm font-bold text-white sm:w-auto">Aplicar</button>
      </noscript>
      <span className="col-span-2 text-xs text-gris sm:col-span-1">El selector de país de la barra superior también filtra esta vista.</span>
    </form>
  )
}
