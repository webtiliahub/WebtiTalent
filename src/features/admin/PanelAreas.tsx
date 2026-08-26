'use client'

import { useState } from 'react'
import { crearArea, editarArea, eliminarArea } from './acciones'
import { useAccion, Aviso, FilaEditable, FormAgregar } from './edicion-inline'

type Area = { id: string; nombre: string; enUso: boolean; puestos: number }

/** Sin tildes y en minúsculas, para que «Auditoria» encuentre «Auditoría». */
function normalizar(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function PanelAreas({ areas, puedeGestionar = true }: { areas: Area[]; puedeGestionar?: boolean }) {
  const { aviso, pendiente, ejecutar } = useAccion()
  const [filtro, setFiltro] = useState('')
  const termino = normalizar(filtro.trim())
  const visibles = termino ? areas.filter((a) => normalizar(a.nombre).includes(termino)) : areas

  return (
    <section className="rounded-2xl border border-gris-claro bg-white p-5">
      <h3 className="font-display text-sm font-bold">Áreas</h3>
      <p className="mb-3 mt-0.5 text-xs text-gris">Agrupan los puestos y colaboradores, y focalizan objetivos transversales.</p>
      {/* Buscador + agregar arriba; la lista en dos columnas para que entren más en pantalla */}
      <div className="mb-3 flex flex-wrap items-start gap-2">
        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder={`Buscar entre ${areas.length} áreas…`}
          className="w-full max-w-md flex-1 rounded-xl border border-gris-claro bg-hueso px-3.5 py-2 text-sm outline-none focus:border-hunter"
        />
        {puedeGestionar && (
          <div className="[&>*]:mt-0">
            <FormAgregar etiqueta="Agregar área" placeholder="Nueva área…" pendiente={pendiente} onCrear={(fd) => ejecutar(() => crearArea(fd))} />
          </div>
        )}
      </div>
      {termino && <p className="mb-2 text-[11px] text-gris">{visibles.length} de {areas.length} áreas</p>}
      <ul className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
        {visibles.map((a) => (
          <li key={a.id} className="border-b border-gris-claro/50 py-1.5">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <FilaEditable
                  nombre={a.nombre}
                  enUso={a.enUso}
                  soloLectura={!puedeGestionar}
                  onGuardar={(fd) => ejecutar(() => editarArea(a.id, fd))}
                  onEliminar={() => ejecutar(() => eliminarArea(a.id))}
                />
              </div>
              <span className="text-[11px] text-gris">{a.puestos} puestos</span>
            </div>
          </li>
        ))}
        {areas.length === 0 && <li className="py-1.5 text-xs text-gris">Sin áreas todavía. Créalas aquí para agrupar los puestos.</li>}
        {areas.length > 0 && visibles.length === 0 && <li className="py-1.5 text-xs text-gris">Ninguna área coincide con «{filtro}».</li>}
      </ul>
      <Aviso texto={aviso} />
    </section>
  )
}
