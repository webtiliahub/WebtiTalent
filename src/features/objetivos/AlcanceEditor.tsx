'use client'

import { useState } from 'react'
import { SelectorMultiple } from '@/shared/ui/SelectorMultiple'
import { Combobox } from '@/shared/ui/Combobox'
import type { PreviewAlcance } from '@/features/ciclos/acciones-alcance'

export type ColaboradorAlcanceUI = { id: string; nombre: string; detalle: string; paisId: string }
export type CatalogoAlcance = { id: string; nombre: string }

/** Editor del foco + ajustes manuales del alcance (selectores, combobox de ajustes y lista
 * previa), calcado del paso "Alcance" de `WizardCiclo`. Ese paso vive inline dentro de
 * WizardCiclo (no está extraído como componente), así que en vez de duplicar su markup una
 * TERCERA vez (wizard de creación de período + edición de alcance en el detalle), se extrae
 * aquí como pieza compartida entre esos dos usos de Task 8 — sin tocar WizardCiclo. */
export function AlcanceEditor({
  encabezado,
  paises, areas, nivelesCatalogo, colaboradores, paisFijo,
  focoPaisIds, setFocoPaisIds,
  focoAreaIds, setFocoAreaIds,
  focoNivelIds, setFocoNivelIds,
  incluirIds, setIncluirIds,
  excluirIds, setExcluirIds,
  preview,
}: {
  encabezado: string
  paises: CatalogoAlcance[]
  areas: CatalogoAlcance[]
  nivelesCatalogo: CatalogoAlcance[]
  colaboradores: ColaboradorAlcanceUI[]
  paisFijo?: CatalogoAlcance
  focoPaisIds: string[]
  setFocoPaisIds: (ids: string[]) => void
  focoAreaIds: string[]
  setFocoAreaIds: (ids: string[]) => void
  focoNivelIds: string[]
  setFocoNivelIds: (ids: string[]) => void
  incluirIds: string[]
  setIncluirIds: React.Dispatch<React.SetStateAction<string[]>>
  excluirIds: string[]
  setExcluirIds: React.Dispatch<React.SetStateAction<string[]>>
  preview: PreviewAlcance | null
}) {
  // Sin ningún filtro, el buscador necesita la INTENCIÓN: ¿solo estas personas (modo
  // lista) o retirarlas del universo completo? Con filtros no aplica (mismo criterio
  // que WizardCiclo).
  const sinFiltros = focoPaisIds.length === 0 && focoAreaIds.length === 0 && focoNivelIds.length === 0
  const [modoSinFiltros, setModoSinFiltros] = useState<'solo' | 'retirar'>(
    () => (excluirIds.length > 0 && incluirIds.length === 0 ? 'retirar' : 'solo'),
  )
  return (
    <div className="space-y-4">
      <p className="text-sm">{encabezado}</p>
      <div className="grid gap-3 md:grid-cols-3">
        {paisFijo ? (
          <div>
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gris">Países</span>
            <p className="rounded-xl border border-gris-claro bg-hueso-2 px-3.5 py-2.5 text-sm text-gris">{paisFijo.nombre} (tu alcance)</p>
          </div>
        ) : (
          <SelectorMultiple etiqueta="Países" opciones={paises} seleccion={focoPaisIds} onCambio={setFocoPaisIds} />
        )}
        <SelectorMultiple etiqueta="Áreas" opciones={areas} seleccion={focoAreaIds} onCambio={setFocoAreaIds} />
        <SelectorMultiple etiqueta="Niveles jerárquicos" opciones={nivelesCatalogo} seleccion={focoNivelIds} onCambio={setFocoNivelIds} />
      </div>

      {/* Ajustes manuales: con filtros, el buscador decide según si la persona ya está en el
          alcance; sin filtros, la intención la marca el mini-toggle */}
      <div className="rounded-xl border border-gris-claro bg-hueso/50 p-3.5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-gris">Ajustes manuales</p>
          {sinFiltros && (
            <span className="flex gap-1 rounded-full bg-hueso-2 p-0.5">
              <button type="button" onClick={() => setModoSinFiltros('solo')}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${modoSinFiltros === 'solo' ? 'bg-white shadow-sm' : 'text-gris'}`}>
                Solo estas personas
              </button>
              <button type="button" onClick={() => setModoSinFiltros('retirar')}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${modoSinFiltros === 'retirar' ? 'bg-white shadow-sm' : 'text-gris'}`}>
                Todos menos estas
              </button>
            </span>
          )}
        </div>
        <Combobox
          key={incluirIds.length + excluirIds.length}
          name="ajuste"
          // El país es el techo del alcance: de otros países ni aparecen — no se pueden
          // agregar ni excluir (mismo comportamiento que en WizardCiclo).
          opciones={colaboradores.filter((c) =>
            !incluirIds.includes(c.id) && !excluirIds.includes(c.id) &&
            (focoPaisIds.length === 0 || focoPaisIds.includes(c.paisId)),
          )}
          textoVacio="Buscar persona para agregar o excluir…"
          onChange={(id) => {
            if (!id) return
            if (sinFiltros) {
              if (modoSinFiltros === 'solo') setIncluirIds((xs) => [...xs, id])
              else setExcluirIds((xs) => [...xs, id])
              return
            }
            const enAlcance = preview?.grupos.some((g) => g.areas.some((a) => a.personas.some((p) => p.id === id)))
            if (enAlcance) setExcluirIds((xs) => [...xs, id])
            else setIncluirIds((xs) => [...xs, id])
          }}
        />
        {(incluirIds.length > 0 || excluirIds.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {incluirIds.map((id) => {
              // Redundante: los filtros ya lo cubren (el preview lo trae con manual=false) — el
              // resolutor lo trata como inocuo, así que el chip se conserva pero atenuado.
              const persona = preview?.grupos.flatMap((g) => g.areas.flatMap((a) => a.personas)).find((p) => p.id === id)
              const redundante = persona !== undefined && persona.manual === false
              return (
                <button key={id} type="button" onClick={() => setIncluirIds((xs) => xs.filter((x) => x !== id))}
                  className={`rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 ${redundante ? 'opacity-60' : ''}`}
                  title={redundante ? 'Ya lo cubren los filtros' : 'Quitar ajuste'}>
                  {colaboradores.find((c) => c.id === id)?.nombre ?? id} · agregado{redundante ? ' (ya lo cubren los filtros)' : ''} ✕
                </button>
              )
            })}
            {excluirIds.map((id) => {
              // Redundante: ya no está en el alcance sin necesidad de excluirlo (no aparece
              // en preview.excluidos porque los filtros ya lo dejaron fuera).
              const redundante = preview !== null && !preview.excluidos.some((e) => e.id === id)
              return (
                <button key={id} type="button" onClick={() => setExcluirIds((xs) => xs.filter((x) => x !== id))}
                  className={`rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-bold text-alerta-dark hover:bg-red-100 ${redundante ? 'opacity-60' : ''}`}
                  title={redundante ? 'Ya no está en el alcance' : 'Quitar ajuste'}>
                  {colaboradores.find((c) => c.id === id)?.nombre ?? id} · excluido{redundante ? ' (ya no está en el alcance)' : ''} ✕
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Lista previa */}
      <div className="rounded-xl border border-gris-claro p-3.5">
        {preview === null ? (
          <p className="text-sm text-gris">Calculando alcance…</p>
        ) : (
          <>
            <p className="text-sm">
              <span className="font-display text-2xl font-bold">{preview.total}</span> evaluado{preview.total === 1 ? '' : 's'}
              {preview.porPais.length > 1 && <span className="text-gris"> · {preview.porPais.map((p) => `${p.pais} ${p.total}`).join(' · ')}</span>}
            </p>
            {preview.total === 0 && <p className="mt-1 text-xs text-marca-dark">Con estos filtros nadie queda dentro del alcance.</p>}
            {preview.rechazados.length > 0 && (
              <p className="mt-1 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                No entrarán aunque los agregaste: {preview.rechazados.map((r) => `${r.nombre} (${r.motivo === 'INACTIVO' ? 'inactivo' : r.motivo === 'FUERA_DE_PAIS' ? 'fuera de los países del alcance' : 'menos de 6 meses de antigüedad'})`).join(' · ')}
              </p>
            )}
            <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
              {preview.grupos.map((g) => (
                <div key={g.pais}>
                  <p className="text-xs font-bold uppercase tracking-wide text-gris">{g.pais}</p>
                  {g.areas.map((a) => (
                    <p key={a.area} className="ml-3 text-[13px]">
                      <span className="font-semibold">{a.area}:</span>{' '}
                      {a.personas.map((p) => p.manual ? <b key={p.id} title="Agregado manualmente"> {p.nombre}*</b> : <span key={p.id}> {p.nombre} ·</span>)}
                    </p>
                  ))}
                </div>
              ))}
            </div>
            {incluirIds.length > 0 && <p className="mt-1 text-[11px] text-gris">* agregado manualmente (fuera de los filtros)</p>}
          </>
        )}
      </div>
    </div>
  )
}
