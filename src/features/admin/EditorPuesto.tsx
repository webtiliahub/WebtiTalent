'use client'

import { useMemo, useState, useTransition } from 'react'
import { guardarPesosPuesto, alternarCompetenciaPuesto } from './acciones'
import { Desplegable, btnMiniCls } from './edicion-inline'
import { RadarDimensiones, colorDim } from '@/shared/ui/RadarDimensiones'

const inputPctCls = 'w-16 rounded-lg border border-gris-claro bg-white px-2 py-1 text-right text-sm font-bold outline-none focus:border-hunter'

// ───────────── Perfil por dimensión: pesos + puntaje esperado ─────────────

type DimPerfil = { id: string; nombre: string; peso: number; puntajeEsperado: number }

export function PerfilDimensiones({ puestoId, dimensiones, puedeGestionar = true }: { puestoId: string; dimensiones: DimPerfil[]; puedeGestionar?: boolean }) {
  const [guardados, setGuardados] = useState(dimensiones)
  const [borrador, setBorrador] = useState(dimensiones)
  const [editando, setEditando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  const visibles = editando ? borrador : guardados
  const total = useMemo(() => borrador.reduce((a, d) => a + d.peso, 0), [borrador])

  function cambiar(id: string, campo: 'peso' | 'puntajeEsperado', valor: number) {
    setBorrador((s) => s.map((d) => (d.id === id ? { ...d, [campo]: valor } : d)))
  }

  function abrir() {
    setBorrador(guardados)
    setAviso(null)
    setEditando(true)
  }

  function guardar() {
    setAviso(null)
    startTransition(async () => {
      const res = await guardarPesosPuesto(puestoId, borrador.map((d) => ({ dimensionId: d.id, peso: d.peso, puntajeEsperado: d.puntajeEsperado })))
      if (res.ok) {
        setGuardados(borrador)
        setEditando(false)
      } else setAviso(res.error)
    })
  }

  return (
    <div className="grid items-center gap-8 lg:grid-cols-[1.15fr_1fr]">
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gris">Perfil esperado del puesto (1–5)</p>
        <RadarDimensiones dims={visibles.map((d, i) => ({ nombre: d.nombre, valor: d.puntajeEsperado, color: colorDim(i) }))} />
      </div>
      <div>
      <Desplegable abierto={!editando}>
        {/* Cabecera y filas comparten la MISMA grilla (la 4ª columna de las filas es un
            fantasma invisible del botón Editar, para que Peso/Esperado alineen exacto) */}
        <div className="mb-2 grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 text-[10px] font-bold uppercase tracking-wide text-gris">
          <span>Dimensión</span><span className="w-16 text-right">Peso</span><span className="w-20 text-right">Esperado</span>
          {puedeGestionar
            ? <button onClick={abrir} className={`${btnMiniCls} shrink-0 border border-gris-claro normal-case tracking-normal`}>✎ Editar</button>
            : <span aria-hidden className={`${btnMiniCls} invisible shrink-0 border border-transparent`}>✎ Editar</span>}
        </div>
        <ul className="space-y-2.5">
          {guardados.map((d, i) => (
            <li key={d.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorDim(i) }} />{d.nombre}
              </span>
              <span className="w-16 text-right text-sm font-bold">{d.peso}%</span>
              <span className="w-20 text-right text-sm"><b>{d.puntajeEsperado}</b> <span className="text-xs text-gris">/ 5</span></span>
              {/* Fantasma: reserva en la fila el ancho del botón de la cabecera, o las columnas
                  Peso y Esperado dejan de alinearse con sus rótulos */}
              <span aria-hidden className={`${btnMiniCls} invisible shrink-0 border border-transparent`}>✎ Editar</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-hueso-2">
          {guardados.map((d, i) => (
            <div key={d.id} className="transition-[width] duration-300" style={{ width: `${d.peso}%`, background: colorDim(i) }} />
          ))}
        </div>
      </Desplegable>

      <Desplegable abierto={editando}>
        <div className="mb-2 grid grid-cols-[1fr_auto_auto] items-center gap-x-4 text-[10px] font-bold uppercase tracking-wide text-gris">
          <span>Dimensión</span><span className="w-20 text-right">Peso</span><span className="w-20 text-right">Esperado</span>
        </div>
        <ul className="space-y-2.5">
          {borrador.map((d, i) => (
            <li key={d.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorDim(i) }} />{d.nombre}
              </span>
              <span className="flex w-20 items-center justify-end gap-1">
                <input
                  type="number" min={0} max={100} step={5}
                  value={d.peso === 0 ? '' : d.peso} placeholder="0"
                  onChange={(e) => cambiar(d.id, 'peso', Math.max(0, Math.min(100, Number(e.target.value))))}
                  className={`${inputPctCls} placeholder:text-gris-claro`}
                />
                <span className="text-xs font-bold text-gris">%</span>
              </span>
              <input
                type="number" min={1} max={5} step={0.5}
                value={d.puntajeEsperado === 0 ? '' : d.puntajeEsperado} placeholder="3"
                onChange={(e) => cambiar(d.id, 'puntajeEsperado', Math.max(0, Math.min(5, Number(e.target.value))))}
                className={`${inputPctCls} w-20 placeholder:text-gris-claro`}
              />
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-hueso-2">
            {borrador.map((d, i) => (
              <div key={d.id} className="transition-[width] duration-300" style={{ width: `${d.peso}%`, background: colorDim(i) }} />
            ))}
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${total === 100 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-hunter-dark'}`}>
            {total}%{total !== 100 && ' · debe sumar 100'}
          </span>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button onClick={() => setEditando(false)} className={btnMiniCls}>Cancelar</button>
          <button disabled={pendiente || total !== 100} onClick={guardar} className="rounded-xl bg-hunter px-5 py-2 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:opacity-50">
            {pendiente ? 'Guardando…' : 'Guardar perfil'}
          </button>
        </div>
      </Desplegable>

      {aviso && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-hunter-dark">{aviso}</p>}
      </div>
    </div>
  )
}

// ───────────── Competencias agrupadas por dimensión ─────────────

type CompetenciaItem = { id: string; nombre: string; activa: boolean }
type GrupoDimension = { nombre: string; competencias: CompetenciaItem[] }

export function SelectorCompetencias({ puestoId, grupos, puedeGestionar = true }: { puestoId: string; grupos: GrupoDimension[]; puedeGestionar?: boolean }) {
  const [estado, setEstado] = useState<Record<string, boolean>>(
    Object.fromEntries(grupos.flatMap((g) => g.competencias.map((c) => [c.id, c.activa]))),
  )
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>(Object.fromEntries(grupos.map((g) => [g.nombre, true])))
  const [aviso, setAviso] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function alternar(id: string) {
    const nuevo = !estado[id]
    setEstado((s) => ({ ...s, [id]: nuevo }))
    setAviso(null)
    startTransition(async () => {
      // La marca se pinta antes de confirmarse. Si el guardado no llega a completarse (red, sesión
      // caída, error del servidor) hay que DESHACERLA: si no, la casilla queda marcada en pantalla
      // y el puesto sigue como estaba, que es la peor de las dos mentiras posibles.
      try {
        await alternarCompetenciaPuesto(puestoId, id, nuevo)
      } catch {
        setEstado((s) => ({ ...s, [id]: !nuevo }))
        setAviso('No se pudo guardar el cambio. Revisa tu conexión y vuelve a intentarlo.')
      }
    })
  }

  return (
    <div className="space-y-3">
      {aviso && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-hunter-dark">{aviso}</p>}
      {grupos.map((g, gi) => {
        const abierto = abiertos[g.nombre]
        const seleccionadas = g.competencias.filter((c) => estado[c.id]).length
        return (
          <div key={g.nombre}>
            <button
              onClick={() => setAbiertos((s) => ({ ...s, [g.nombre]: !s[g.nombre] }))}
              className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition hover:bg-hueso"
            >
              <span className={`text-gris transition-transform ${abierto ? 'rotate-90' : ''}`}>▸</span>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorDim(gi) }} />
              <span className="text-xs font-bold uppercase tracking-wide">{g.nombre}</span>
              <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${seleccionadas > 0 ? 'bg-hueso-2 text-negro' : 'bg-hueso-2 text-gris'}`}>
                {seleccionadas}/{g.competencias.length}
              </span>
            </button>
            <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${abierto ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
              <div className={`overflow-hidden transition-opacity duration-300 ${abierto ? 'opacity-100' : 'opacity-0'}`}>
                <ul className="mt-1.5 space-y-1.5 pl-5">
                  {g.competencias.map((c) => (
                    <li key={c.id}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-gris-claro px-3.5 py-2 text-sm transition hover:bg-hueso">
                        <input type="checkbox" checked={estado[c.id]} disabled={!puedeGestionar} onChange={() => alternar(c.id)} className="h-4 w-4 accent-[#f0163e] disabled:cursor-not-allowed" />
                        <span className="font-medium">{c.nombre}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
