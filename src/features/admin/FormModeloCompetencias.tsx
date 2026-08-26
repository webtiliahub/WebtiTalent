'use client'

import { useState } from 'react'
import {
  crearDimension, editarDimension, eliminarDimension,
  crearCompetencia, editarCompetencia, eliminarCompetencia,
} from './acciones'
import { useAccion, Aviso, FilaEditable, FormAgregar } from './edicion-inline'

type Competencia = { id: string; nombre: string; descripcion: string | null; enUso: boolean }
type Dimension = { id: string; nombre: string; descripcion: string | null; competencias: Competencia[] }

export function FormModeloCompetencias({ dimensiones, puedeGestionar = true }: { dimensiones: Dimension[]; puedeGestionar?: boolean }) {
  const { aviso, pendiente, ejecutar } = useAccion()
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())

  function alternar(id: string) {
    setAbiertas((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  return (
    <section className="rounded-2xl border border-gris-claro bg-white p-5">
      <h3 className="font-display text-sm font-bold">Modelo de competencias</h3>
      <p className="mb-4 mt-0.5 text-xs text-gris">
        Dimensiones y competencias que alimentan los descriptores de puesto y el banco de preguntas.
      </p>

      {dimensiones.length === 0 && (
        <p className="rounded-xl bg-hueso px-4 py-3 text-sm text-gris">Aún no hay dimensiones. Crea la primera para empezar a construir el modelo.</p>
      )}

      <div className="space-y-4">
        {dimensiones.map((d) => {
          const abierta = abiertas.has(d.id)
          return (
            <div key={d.id} className="rounded-xl border border-gris-claro/70 p-4">
              <div className="flex items-start gap-2 font-display text-[13px] font-bold uppercase tracking-wide text-marca-dark">
                <button
                  onClick={() => alternar(d.id)}
                  // La flecha medía 7 px de ancho: en móvil se le da un área de 36 px
                  className={`-my-1 grid h-9 w-9 shrink-0 place-items-center text-gris transition-transform md:mt-0.5 md:h-auto md:w-auto ${abierta ? 'rotate-90' : ''}`}
                  title={abierta ? 'Contraer' : 'Desplegar'}
                  aria-label={abierta ? 'Contraer dimensión' : 'Desplegar dimensión'}
                >▸</button>
                <div className="flex-1">
                  <FilaEditable
                    nombre={d.nombre}
                    descripcion={d.descripcion}
                    conDescripcion
                    soloLectura={!puedeGestionar}
                    enUso={d.competencias.length > 0}
                    onClickNombre={() => alternar(d.id)}
                    onGuardar={(fd) => ejecutar(() => editarDimension(d.id, fd))}
                    onEliminar={() => ejecutar(() => eliminarDimension(d.id))}
                  />
                </div>
                {!abierta && (
                  <span className="rounded-full bg-hueso-2 px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-gris">
                    {d.competencias.length} competencias
                  </span>
                )}
              </div>
              <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${abierta ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                <div className={`overflow-hidden pl-5 transition-opacity duration-300 ${abierta ? 'opacity-100' : 'opacity-0'}`}>
                  {d.descripcion && <p className="mb-2 mt-1 text-xs text-gris">{d.descripcion}</p>}
                  <ul className="divide-y divide-gris-claro/50">
                    {d.competencias.map((c) => (
                      <li key={c.id} className="py-1.5">
                        <FilaEditable
                          nombre={c.nombre}
                          descripcion={c.descripcion}
                          conDescripcion
                          mostrarDescripcion
                          soloLectura={!puedeGestionar}
                          enUso={c.enUso}
                          onGuardar={(fd) => ejecutar(() => editarCompetencia(c.id, fd))}
                          onEliminar={() => ejecutar(() => eliminarCompetencia(c.id))}
                        />
                      </li>
                    ))}
                    {d.competencias.length === 0 && <li className="py-1.5 text-xs text-gris">Sin competencias todavía.</li>}
                  </ul>
                  {puedeGestionar && <FormAgregar etiqueta="Agregar competencia" placeholder="Nueva competencia…" conDescripcion pendiente={pendiente} onCrear={(fd) => ejecutar(() => crearCompetencia(d.id, fd))} />}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {puedeGestionar && (
        <div className="mt-4">
          <FormAgregar etiqueta="Agregar dimensión" placeholder="Nombre de la dimensión…" conDescripcion pendiente={pendiente} onCrear={(fd) => ejecutar(() => crearDimension(fd))} />
        </div>
      )}
      <Aviso texto={aviso} />
    </section>
  )
}
