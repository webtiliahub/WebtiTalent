/** Card informativa de recordatorios automáticos: último envío (cron) + próximo hito, para el
 * detalle de un período de objetivos o de un ciclo. Server component — sin acciones nuevas,
 * solo lectura de `RecordatorioEnvio` + el cálculo puro de `proximoHito`. El botón manual
 * existente (si lo hay para ese proceso) se pasa como `children` y se renderiza al pie. */
import { BellRing } from 'lucide-react'
import { prisma } from '@/shared/lib/prisma'
import { proximoHito, type Hito } from '@/features/recordatorios/hitos'
import { Card, Chip } from '@/shared/ui/componentes'

/** Todos los procesos del motor de recordatorios (cron `/api/cron/recordatorios`), con su
 * etiqueta legible. Se mapean todos aquí aunque esta card solo se instancia hoy para algunos. */
const ETIQUETAS_PROCESO: Record<string, string> = {
  OBJETIVOS: 'Objetivos',
  APROBACIONES_JEFE: 'Aprobaciones del jefe',
  EVALUACIONES: 'Evaluaciones',
  NOTA_PRELIMINAR: 'Nota preliminar',
  DIGEST_RRHH: 'Resumen RR.HH.',
}

const ETIQUETAS_HITO: Record<Hito | 'UNICO' | 'SEMANAL' | 'MANUAL', string> = {
  D30: 'D-30', D15: 'D-15', D7: 'D-7', DIARIO: 'diario', ULTIMO_DIA: 'último día', UNICO: 'único', SEMANAL: 'semanal', MANUAL: 'manual',
}
const etiquetaHito = (hito: string) => ETIQUETAS_HITO[hito as keyof typeof ETIQUETAS_HITO] ?? hito

const formatoFecha = (f: Date) => f.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })

export async function CardRecordatorios({ proceso, referencia, deadline, children }: {
  proceso: string
  referencia: string
  deadline: Date
  children?: React.ReactNode
}) {
  const ultimo = await prisma.recordatorioEnvio.findFirst({
    where: { proceso, referencia },
    orderBy: { creadoEn: 'desc' },
  })
  const proximo = proximoHito(deadline, new Date())
  const etiqueta = ETIQUETAS_PROCESO[proceso] ?? proceso

  return (
    <Card
      titulo={
        <span className="flex items-center gap-1.5">
          <BellRing className="h-3.5 w-3.5 text-gris" /> Recordatorios · {etiqueta}
        </span>
      }
    >
      <div className="space-y-2.5 text-sm">
        {ultimo ? (
          <p>
            <span className="font-semibold">{ultimo.hito === 'MANUAL' ? 'Último manual:' : 'Último automático:'}</span>{' '}
            {formatoFecha(ultimo.fecha)} · hito <Chip tono="azul">{etiquetaHito(ultimo.hito)}</Chip> · {ultimo.enviados} enviado{ultimo.enviados === 1 ? '' : 's'}
            {ultimo.fallidos > 0 && <span className="text-marca-dark">, {ultimo.fallidos} fallido{ultimo.fallidos === 1 ? '' : 's'}</span>}
          </p>
        ) : (
          <p className="text-gris">Aún sin envíos automáticos.</p>
        )}
        <p>
          {proximo ? (
            <>
              <span className="font-semibold">Próximo hito:</span> <Chip tono="neutro">{etiquetaHito(proximo.hito)}</Chip> · {formatoFecha(proximo.fecha)}
            </>
          ) : (
            <span className="text-gris">Sin próximo hito (fuera de ventana de recordatorios).</span>
          )}
        </p>
        {children && <div className="pt-1.5">{children}</div>}
      </div>
    </Card>
  )
}
