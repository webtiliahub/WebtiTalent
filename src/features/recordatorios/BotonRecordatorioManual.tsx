'use client'

import { useRouter } from 'next/navigation'
import { enviarRecordatorioEvaluacionesManual } from './acciones'
import { useAccion, Aviso } from '@/features/admin/edicion-inline'
import { confirmar } from '@/shared/ui/Confirmacion'
import { toast } from '@/shared/ui/Toast'

/** Envío manual del recordatorio de evaluaciones (children de CardRecordatorios): complementa
 * a los automáticos cuando RR.HH. necesita empujar fuera de los hitos. Mismo patrón que
 * BotonEnviarRecordatoriosPeriodo en objetivos. */
export function BotonRecordatorioManual({ cicloId }: { cicloId: string }) {
  const router = useRouter()
  const { aviso, pendiente, ejecutar } = useAccion()

  return (
    <div className="relative inline-block">
      <button
        onClick={async () => {
          if (!(await confirmar('Se enviará un recordatorio por correo y push a todos los evaluadores con evaluaciones pendientes del ciclo. ¿Continuar?', { titulo: 'Enviar recordatorio', textoAceptar: 'Enviar' }))) return
          ejecutar(async () => {
            const res = await enviarRecordatorioEvaluacionesManual(cicloId)
            if (res.ok) toast(`${res.enviados} recordatorio${res.enviados === 1 ? '' : 's'} enviado${res.enviados === 1 ? '' : 's'}${res.fallidos ? ` · ${res.fallidos} fallaron (revisar con soporte)` : ''}${res.sinCuenta ? ` · ${res.sinCuenta} pendientes sin cuenta de acceso` : ''}`)
            return res.ok ? { ok: true } : res
          }, () => router.refresh())
        }}
        disabled={pendiente}
        className="rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:opacity-50"
      >
        {pendiente ? 'Enviando…' : 'Enviar recordatorio ahora'}
      </button>
      {aviso && (
        <div className="absolute left-0 top-full z-20 mt-2 w-max max-w-sm">
          <Aviso texto={aviso} />
        </div>
      )}
    </div>
  )
}
