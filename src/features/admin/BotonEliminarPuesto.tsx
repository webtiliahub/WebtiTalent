'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { eliminarPuesto } from './acciones'
import { confirmar } from '@/shared/ui/Confirmacion'

/** Botón ✕ para filas de la tabla de puestos (detiene la navegación de la fila clickeable). */
export function BotonEliminarPuesto({ puestoId, nombre, enUso }: { puestoId: string; nombre: string; enUso: boolean }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  async function onClick(e: React.MouseEvent) {
    e.stopPropagation()
    setError(null)
    if (!(await confirmar(`¿Eliminar el puesto "${nombre}"? Se pierde su descriptor (perfil, competencias y requisitos).`, { titulo: 'Eliminar puesto', textoAceptar: 'Eliminar' }))) return
    startTransition(async () => {
      const res = await eliminarPuesto(puestoId)
      if (!res.ok) setError(res.error)
      else router.refresh()
    })
  }

  return (
    <>
      <button
        onClick={onClick}
        disabled={pendiente || enUso}
        title={enUso ? 'Tiene colaboradores asignados: reasígnalos primero' : 'Eliminar puesto'}
        className="inline-grid h-7 w-7 place-items-center rounded-lg text-gris transition hover:bg-red-50 hover:text-hunter disabled:cursor-not-allowed disabled:opacity-30"
      >✕</button>
      {error && <span onClick={(e) => e.stopPropagation()} className="ml-1 text-[10px] text-hunter-dark">{error}</span>}
    </>
  )
}
