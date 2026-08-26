'use client'

import { useState } from 'react'
import { crearNivel, editarNivel, eliminarNivel } from './acciones'
import { Desplegable, useAccion, Aviso, btnMiniCls, inputCls } from './edicion-inline'

type Nivel = { id: string; nombre: string; compPct: number; enUso: boolean; puestos: number }

const thumbCls =
  '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:ring-1 [&::-webkit-slider-thumb]:ring-gris-claro ' +
  '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow [&::-moz-range-thumb]:ring-1 [&::-moz-range-thumb]:ring-gris-claro'

function SliderCombinacion({ inicial }: { inicial: number }) {
  const [pct, setPct] = useState(inicial)
  return (
    <div className="w-full">
      <div className="mb-1 flex items-baseline justify-between text-xs font-bold">
        <span className="text-hunter">Competencias {pct}%</span>
        <span className="text-negro/60">Objetivos {100 - pct}%</span>
      </div>
      <input
        name="compPct"
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        onChange={(e) => setPct(Number(e.target.value))}
        aria-label="Peso de competencias en la nota final"
        className={`h-2 w-full cursor-pointer appearance-none rounded-full ${thumbCls}`}
        style={{ background: `linear-gradient(to right, var(--color-hunter) ${pct}%, var(--color-negro) ${pct}%)` }}
      />
    </div>
  )
}

function FilaNivel({ nivel, onGuardar, onEliminar, puedeGestionar }: {
  nivel: Nivel
  onGuardar: (fd: FormData) => void
  onEliminar: () => void
  puedeGestionar: boolean
}) {
  const [editando, setEditando] = useState(false)

  if (!puedeGestionar) {
    return (
      <div className="flex items-center gap-3">
        <span className="flex-1">
          <span className="block text-sm font-semibold">{nivel.nombre}</span>
          <span className="block text-xs text-gris">{nivel.puestos} puestos asociados</span>
        </span>
        <span className="text-sm"><b>{nivel.compPct}%</b> <span className="text-gris">/ {100 - nivel.compPct}%</span></span>
      </div>
    )
  }

  return (
    <>
      <Desplegable abierto={editando}>
        <form className="space-y-2.5" action={(fd) => { onGuardar(fd); setEditando(false) }}>
          <div className="flex items-center gap-2">
            <input name="nombre" defaultValue={nivel.nombre} className={`${inputCls} flex-1 min-w-36`} autoFocus />
            <button type="submit" className="rounded-lg bg-hunter px-3 py-1.5 text-xs font-bold text-white hover:bg-hunter-dark">Guardar</button>
            <button type="button" onClick={() => setEditando(false)} className={btnMiniCls}>Cancelar</button>
          </div>
          <SliderCombinacion inicial={nivel.compPct} />
        </form>
      </Desplegable>
      <Desplegable abierto={!editando}>
        <div className="group flex items-center gap-3">
          <span className="flex-1">
            <span className="block text-sm font-semibold">{nivel.nombre}</span>
            <span className="block text-xs text-gris">{nivel.puestos} puestos asociados</span>
          </span>
          <span className="text-sm"><b>{nivel.compPct}%</b> <span className="text-gris">/ {100 - nivel.compPct}%</span></span>
          <button onClick={() => setEditando(true)} className={`${btnMiniCls} opacity-0 group-hover:opacity-100`} title="Editar">✎</button>
          <button
            onClick={onEliminar}
            disabled={nivel.enUso}
            className={`${btnMiniCls} opacity-0 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30`}
            title={nivel.enUso ? 'En uso: no se puede eliminar' : 'Eliminar'}
          >✕</button>
        </div>
      </Desplegable>
    </>
  )
}

export function PanelNiveles({ niveles, puedeGestionar = true }: { niveles: Nivel[]; puedeGestionar?: boolean }) {
  const { aviso, pendiente, ejecutar } = useAccion()
  const [agregando, setAgregando] = useState(false)

  return (
    <section className="rounded-2xl border border-gris-claro bg-white p-5">
      <h3 className="font-display text-sm font-bold">Niveles jerárquicos y nota combinada</h3>
      <p className="mb-4 mt-0.5 text-xs text-gris">
        Cada nivel define cuánto pesan las <b>competencias</b> frente a los <b>objetivos</b> en la nota final (izquierda / derecha).
        El nivel se asigna a cada puesto en <b>Puestos y niveles</b>.
      </p>
      <ul className="divide-y divide-gris-claro/50">
        {niveles.map((n) => (
          <li key={n.id} className="py-2">
            <FilaNivel
              nivel={n}
              puedeGestionar={puedeGestionar}
              onGuardar={(fd) => ejecutar(() => editarNivel(n.id, fd))}
              onEliminar={() => ejecutar(() => eliminarNivel(n.id))}
            />
          </li>
        ))}
        {niveles.length === 0 && <li className="py-2 text-xs text-gris">Sin niveles todavía. Crea el primero para poder crear puestos.</li>}
      </ul>

      {puedeGestionar && (
        <>
          <Desplegable abierto={!agregando}>
            <button onClick={() => setAgregando(true)} className="mt-2 rounded-lg border border-dashed border-gris-claro px-3 py-1.5 text-xs font-bold text-gris transition hover:border-hunter hover:text-hunter">
              ＋ Agregar nivel
            </button>
          </Desplegable>
          <Desplegable abierto={agregando}>
            <form className="mt-2 space-y-2.5" action={(fd) => ejecutar(() => crearNivel(fd))}>
              <div className="flex items-center gap-2">
                <input name="nombre" placeholder="Nombre del nivel…" className={`${inputCls} flex-1 min-w-36`} required minLength={2} autoFocus />
                <button type="submit" disabled={pendiente} className="rounded-lg border border-hunter px-3 py-1.5 text-xs font-bold text-hunter transition hover:bg-hunter hover:text-white disabled:opacity-50">
                  ＋ Agregar
                </button>
                <button type="button" onClick={() => setAgregando(false)} className={btnMiniCls}>Cancelar</button>
              </div>
              <SliderCombinacion inicial={50} />
            </form>
          </Desplegable>
        </>
      )}
      <Aviso texto={aviso} />
      <p className="mt-3 text-[11px] text-gris">Los cambios aplican a los próximos ciclos: cada ciclo congela su configuración al crearse.</p>
    </section>
  )
}
