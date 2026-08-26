'use client'

import { useState, useTransition } from 'react'
import { guardarFeedback } from './acciones'

type Accion = { titulo: string; fechaObjetivo?: string }

export function FormFeedback({ cicloId, colaboradorId, nombre, acuerdosIniciales, pdiInicial }: {
  cicloId: string
  colaboradorId: string
  nombre: string
  acuerdosIniciales: string
  pdiInicial: Accion[]
}) {
  const [abierto, setAbierto] = useState(false)
  const [acuerdos, setAcuerdos] = useState(acuerdosIniciales)
  const [pdi, setPdi] = useState<Accion[]>(pdiInicial.length > 0 ? pdiInicial : [{ titulo: '' }])
  const [aviso, setAviso] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  function guardar() {
    setAviso(null)
    startTransition(async () => {
      const res = await guardarFeedback({ cicloId, colaboradorId, acuerdos, pdi })
      setAviso(res.ok ? 'Feedback y PDI registrados ✓' : res.error)
    })
  }

  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)} className="w-full rounded-xl border border-gris-claro px-4 py-2.5 text-xs font-bold transition hover:bg-hueso md:w-auto md:py-2">
        {acuerdosIniciales || pdiInicial.length > 0 ? 'Editar feedback / PDI' : 'Registrar feedback / PDI'}
      </button>
    )
  }

  return (
    <div className="mt-3 w-full rounded-xl border border-gris-claro bg-hueso p-4">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gris">Sesión de feedback · {nombre}</p>
      <label className="mb-1 block text-xs font-semibold">Acuerdos de la sesión <span className="font-normal text-gris">· los pueden editar el jefe y el colaborador</span></label>
      {/* 16px en móvil: con fuente <16px iOS hace zoom automático al enfocar */}
      <textarea
        value={acuerdos} onChange={(e) => setAcuerdos(e.target.value)} rows={3}
        placeholder="Lo conversado y acordado en la sesión 1:1…"
        className="w-full rounded-xl border border-gris-claro bg-white px-3.5 py-2.5 text-base outline-none focus:border-marca md:text-sm"
      />
      <p className="mb-1 mt-3 text-xs font-semibold">Plan de desarrollo individual (PDI)</p>
      <div className="space-y-2">
        {/* Móvil: cada acción es una mini-tarjeta con la acción a lo ancho y debajo mes +
            quitar — la fila única (acción + mes + ✕) desbordaba 208px en 390px de pantalla.
            Escritorio (md:contents): la fila original. */}
        {pdi.map((a, i) => (
          <div key={i} className="rounded-xl border border-gris-claro bg-white p-3 md:flex md:gap-2 md:border-0 md:bg-transparent md:p-0">
            <input
              value={a.titulo}
              onChange={(e) => setPdi((s) => s.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)))}
              placeholder="Acción de desarrollo…"
              className="w-full border-b border-dashed border-hueso-2 bg-transparent pb-2 text-base outline-none focus:border-marca md:flex-1 md:rounded-xl md:border md:border-solid md:border-gris-claro md:bg-white md:px-3.5 md:py-2 md:pb-2 md:text-sm"
            />
            <div className="mt-2 flex items-center gap-2 md:contents">
              {/* Ancho fijo en móvil: el input month tiene un mínimo intrínseco en Chromium
                  que ignora min-width y desbordaba la página aunque la fila usara flex */}
              <input
                type="month" value={a.fechaObjetivo ?? ''}
                onChange={(e) => setPdi((s) => s.map((x, j) => (j === i ? { ...x, fechaObjetivo: e.target.value } : x)))}
                className="w-[140px] flex-none rounded-lg border border-gris-claro bg-white px-3 py-2 text-base outline-none md:w-auto md:rounded-xl md:text-sm"
              />
              <button type="button" onClick={() => setPdi((s) => s.filter((_, j) => j !== i))} className="ml-auto shrink-0 rounded-lg border border-gris-claro px-3 py-2 text-xs font-bold text-gris hover:bg-white md:ml-0 md:rounded-xl md:py-0 md:self-stretch">
                <span className="md:hidden">Quitar</span><span className="hidden md:inline">✕</span>
              </button>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setPdi((s) => [...s, { titulo: '' }])} className="text-xs font-bold text-marca hover:underline">+ Agregar acción</button>
      </div>
      {aviso && <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${aviso.includes('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-alerta-dark'}`}>{aviso}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2 md:flex md:justify-end">
        <button type="button" onClick={() => setAbierto(false)} className="rounded-xl border border-gris-claro bg-white px-4 py-2.5 text-xs font-bold hover:bg-hueso md:py-2">Cerrar</button>
        <button type="button" disabled={pendiente} onClick={guardar} className="rounded-xl bg-marca px-4 py-2.5 text-xs font-bold text-white transition hover:bg-marca-dark disabled:opacity-60 md:py-2">
          {pendiente ? 'Guardando…' : 'Guardar ✓'}
        </button>
      </div>
    </div>
  )
}
