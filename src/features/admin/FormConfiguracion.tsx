'use client'

import { useMemo, useState, useTransition } from 'react'
import { guardarConfiguracion, type ClavePesos } from './acciones'
import { Desplegable, btnMiniCls } from './edicion-inline'

const MODS = [
  ['JEFE', 'Jefe', 'Evaluación descendente del jefe directo'],
  ['PAR', 'Pares', 'Colegas nominados por el jefe'],
  ['ASCENDENTE', 'Ascendente', 'El equipo evalúa a su jefe'],
  ['AUTO', 'Autoevaluación', 'Con 0% es referencial: se responde pero no afecta la nota'],
] as const

const COLORES: Record<string, string> = {
  JEFE: 'var(--color-marca)',
  PAR: 'var(--color-negro)',
  ASCENDENTE: 'var(--color-gris)',
  AUTO: 'var(--color-gris-claro)',
}

const inputPctCls = 'w-20 rounded-lg border border-gris-claro bg-white px-3 py-1.5 text-right text-sm font-bold outline-none focus:border-marca'

function BarraPesos({ pesos }: { pesos: Record<string, number> }) {
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-hueso-2">
      {MODS.map(([clave]) => (
        <div key={clave} className="transition-[width] duration-300" style={{ width: `${pesos[clave] ?? 0}%`, background: COLORES[clave] }} />
      ))}
    </div>
  )
}

function DotModalidad({ clave }: { clave: string }) {
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLORES[clave] }} />
}

/** Un set de pesos editable (base o «sin reportes»): mismo patrón para ambos. */
function SeccionPesos({ titulo, descripcion, inicial, clave, puedeGestionar }: {
  titulo: string
  descripcion: string
  inicial: Record<string, number>
  clave: ClavePesos
  puedeGestionar: boolean
}) {
  const [guardados, setGuardados] = useState({ ...inicial })
  const [mods, setMods] = useState({ ...inicial })
  const [editando, setEditando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  const totalMods = useMemo(() => Object.values(mods).reduce((a, b) => a + b, 0), [mods])

  function abrirEdicion() {
    setMods({ ...guardados })
    setAviso(null)
    setEditando(true)
  }

  function guardar() {
    setAviso(null)
    startTransition(async () => {
      const res = await guardarConfiguracion(mods, clave)
      if (res.ok) {
        setGuardados({ ...mods })
        setEditando(false)
        setAviso('Configuración guardada ✓ Aplica a los próximos ciclos (cada ciclo congela su foto al crearse).')
      } else {
        setAviso(res.error)
      }
    })
  }

  return (
    <section className="rounded-2xl border border-gris-claro bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-bold">{titulo}</h3>
          <p className="mb-4 mt-0.5 text-xs text-gris">{descripcion}</p>
        </div>
        {puedeGestionar && !editando && <button onClick={abrirEdicion} className={`${btnMiniCls} shrink-0 border border-gris-claro`}>✎ Editar</button>}
      </div>

      <Desplegable abierto={!editando}>
        <ul className="space-y-3">
          {MODS.map(([clave2, label, ayuda]) => (
            <li key={clave2} className="flex items-center gap-3">
              <span className="flex w-32 shrink-0 items-center gap-2 text-sm font-semibold"><DotModalidad clave={clave2} />{label}</span>
              <span className="flex-1 text-xs text-gris">{ayuda}</span>
              <span className="text-sm font-bold">{guardados[clave2] ?? 0}%</span>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <BarraPesos pesos={guardados} />
        </div>
      </Desplegable>

      <Desplegable abierto={editando}>
        <ul className="space-y-3">
          {MODS.map(([clave2, label, ayuda]) => (
            <li key={clave2} className="flex items-center gap-3">
              <span className="flex w-32 shrink-0 items-center gap-2 text-sm font-semibold"><DotModalidad clave={clave2} />{label}</span>
              <span className="flex-1 text-xs text-gris">{ayuda}</span>
              <input
                type="number" min={0} max={100} step={5}
                value={(mods[clave2] ?? 0) === 0 ? '' : mods[clave2]} placeholder="0"
                onChange={(e) => setMods((s) => ({ ...s, [clave2]: Math.max(0, Math.min(100, Number(e.target.value))) }))}
                className={`${inputPctCls} placeholder:text-gris-claro`}
              />
              <span className="text-sm font-bold text-gris">%</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center gap-3">
          <BarraPesos pesos={mods} />
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${totalMods === 100 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-alerta-dark'}`}>
            Total: {totalMods}%{totalMods !== 100 && ' · debe sumar 100'}
          </span>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={() => setEditando(false)} className={btnMiniCls}>Cancelar</button>
          <button disabled={pendiente || totalMods !== 100} onClick={guardar} className="rounded-xl bg-marca px-6 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark disabled:opacity-50">
            {pendiente ? 'Guardando…' : 'Guardar configuración ✓'}
          </button>
        </div>
      </Desplegable>

      {aviso && <p className={`mt-3 rounded-lg px-4 py-2.5 text-sm ${aviso.includes('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-alerta-dark'}`}>{aviso}</p>}
    </section>
  )
}

export function FormConfiguracion({ pesosModalidades, pesosSinReportes, puedeGestionar = true }: {
  pesosModalidades: Record<string, number>
  pesosSinReportes: Record<string, number>
  puedeGestionar?: boolean
}) {
  return (
    <div className="space-y-5">
      <SeccionPesos
        titulo="Pesos por modalidad 360"
        descripcion="Cómo pondera cada voz en la nota de competencias (colaboradores CON reportes directos). Debe sumar 100%."
        inicial={pesosModalidades}
        clave="pesosModalidades"
        puedeGestionar={puedeGestionar}
      />
      <SeccionPesos
        titulo="Pesos SIN reportes directos"
        descripcion="Redistribución para quienes no tienen equipo a cargo (no hay evaluación ascendente). Debe sumar 100%."
        inicial={pesosSinReportes}
        clave="pesosModalidadesSinReportes"
        puedeGestionar={puedeGestionar}
      />
    </div>
  )
}
