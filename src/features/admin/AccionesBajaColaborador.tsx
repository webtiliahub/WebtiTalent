'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserX, UserCheck } from 'lucide-react'
import { darDeBajaColaborador, reactivarColaborador } from './acciones-baja'
import { Modal } from '@/shared/ui/Modal'
import { toast } from '@/shared/ui/Toast'

/** Zona de baja al pie de la hoja de vida admin: soft-delete con confirmación explícita. */
export function ZonaBajaColaborador({ colaboradorId, nombre, equipo, cicloActivo }: {
  colaboradorId: string
  nombre: string
  equipo: number // reportes directos activos (quedarán «sin jefe directo»)
  cicloActivo: string | null // nombre del ciclo activo en el que participa (aviso de rotación)
}) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  function confirmar() {
    setError(null)
    startTransition(async () => {
      const res = await darDeBajaColaborador(colaboradorId)
      if (!res.ok) setError(res.error)
      else {
        setAbierto(false)
        toast('Colaborador dado de baja: pasó al archivo de desactivados')
        router.push('/admin/colaboradores')
      }
    })
  }

  return (
    <div className="mt-5 flex justify-end">
      <button
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1.5 rounded-xl border border-gris-claro px-3.5 py-2 text-xs font-bold text-gris transition hover:border-marca/40 hover:text-marca"
      >
        <UserX size={13} /> Dar de baja
      </button>

      <Modal titulo={`Dar de baja · ${nombre}`} abierto={abierto} onCerrar={() => { setAbierto(false); setError(null) }}>
        <p className="text-sm">Vas a dar de baja a <b>{nombre}</b>. Esto hará lo siguiente:</p>
        <ul className="mt-3 space-y-1.5 text-sm">
          <li className="rounded-lg bg-hueso px-3 py-2">Sale del padrón activo (cobertura de objetivos, ciclos nuevos y listas) y pasa al <b>archivo de desactivados</b>, desde donde se puede reactivar.</li>
          <li className="rounded-lg bg-hueso px-3 py-2">Su cuenta de acceso se desactiva: ya no puede iniciar sesión.</li>
          {equipo > 0 && (
            <li className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">Su equipo ({equipo} colaborador{equipo === 1 ? '' : 'es'}) queda <b>sin jefe directo</b>: RR.HH. cubre aprobaciones y feedback hasta reasignarles jefe.</li>
          )}
          {cicloActivo && (
            <li className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">Participa en el ciclo activo <b>«{cicloActivo}»</b>: sus evaluaciones NO se tocan aquí — resuélvelas en el bloque <b>Rotación</b> del ciclo (retirar con o sin nota).</li>
          )}
        </ul>
        <p className="mt-3 rounded-lg bg-hueso-2 px-3 py-2 text-xs text-gris">Su historial (evaluaciones, resultados, objetivos) se conserva completo. La baja queda auditada.</p>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-alerta-dark">{error}</p>}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={() => { setAbierto(false); setError(null) }} className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">Cancelar</button>
          <button
            onClick={confirmar}
            disabled={pendiente}
            className="rounded-xl bg-marca px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark disabled:opacity-60"
          >
            {pendiente ? 'Dando de baja…' : 'Confirmar baja'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

/** Reactivación desde el archivo de desactivados (mismo patrón de modal que la baja). */
export function BotonReactivar({ colaboradorId, nombre }: { colaboradorId: string; nombre: string }) {
  const [abierto, setAbierto] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  function confirmar() {
    setError(null)
    startTransition(async () => {
      const res = await reactivarColaborador(colaboradorId)
      if (!res.ok) setError(res.error)
      else {
        setAbierto(false)
        toast(`${nombre} vuelve al padrón activo`)
      }
    })
  }

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setAbierto(true) }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gris-claro bg-white px-3 py-1.5 text-xs font-bold transition hover:border-emerald-500/50 hover:text-emerald-700"
      >
        <UserCheck size={13} /> Reactivar
      </button>
      <Modal titulo={`Reactivar · ${nombre}`} abierto={abierto} onCerrar={() => { setAbierto(false); setError(null) }}>
        <p className="text-sm">Vas a reactivar a <b>{nombre}</b> (reingreso o baja por error). Ten en cuenta:</p>
        <ul className="mt-3 space-y-1.5 text-sm">
          <li className="rounded-lg bg-hueso px-3 py-2">Vuelve al padrón activo: cobertura de objetivos, listas y los <b>próximos</b> ciclos (a los ciclos ya lanzados no re-entra: son una foto del lanzamiento).</li>
          <li className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">Su equipo anterior <b>NO vuelve a colgar de esta persona</b>: si vuelve a ser jefe, reasigna a su gente editándola (quedaron «sin jefe directo» con la baja).</li>
          <li className="rounded-lg bg-hueso px-3 py-2">Su cuenta de acceso sigue desactivada: se reactiva en <b>Configuración → Usuarios con acceso</b>.</li>
        </ul>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-alerta-dark">{error}</p>}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={() => { setAbierto(false); setError(null) }} className="rounded-lg px-3 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro">Cancelar</button>
          <button
            onClick={confirmar}
            disabled={pendiente}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {pendiente ? 'Reactivando…' : 'Confirmar reactivación'}
          </button>
        </div>
      </Modal>
    </>
  )
}
