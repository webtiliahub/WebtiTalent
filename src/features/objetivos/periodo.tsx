import { CalendarClock } from 'lucide-react'
import { prisma } from '@/shared/lib/prisma'
import { estaEnAlcancePeriodo } from './alcance-periodo'

/** Período relevante para trabajar objetivos: el de carga abierta más reciente; si no hay, el último no-borrador (solo lectura).
 * Global, sin filtrar por alcance — solo para vistas admin que ya no quedan callers de colaborador/jefe (verificado con grep). */
export async function periodoVigente() {
  return (
    (await prisma.periodoObjetivos.findFirst({ where: { estado: 'CARGA_ABIERTA' }, orderBy: { createdAt: 'desc' } })) ??
    (await prisma.periodoObjetivos.findFirst({ where: { estado: 'CERRADO' }, orderBy: { createdAt: 'desc' } }))
  )
}

/** Período vigente PARA UN COLABORADOR: mismo orden de candidatos que `periodoVigente`
 * (CARGA_ABIERTA más reciente primero, luego CERRADO más reciente), pero se queda con el
 * primero cuyo alcance lo incluye. null si el colaborador no existe o ningún período (abierto
 * o cerrado) lo incluye — las vistas muestran su estado vacío. */
export async function periodoVigenteParaColaborador(colaboradorId: string) {
  const dueno = await prisma.colaborador.findUnique({
    where: { id: colaboradorId },
    select: { id: true, activo: true, paisId: true, areaId: true, puesto: { select: { nivelId: true } } },
  })
  if (!dueno) return null
  const c = { ...dueno, nivelId: dueno.puesto?.nivelId ?? null }

  const abiertos = await prisma.periodoObjetivos.findMany({ where: { estado: 'CARGA_ABIERTA' }, orderBy: { createdAt: 'desc' } })
  const vigenteAbierto = abiertos.find((p) => estaEnAlcancePeriodo(p, c))
  if (vigenteAbierto) return vigenteAbierto

  const cerrados = await prisma.periodoObjetivos.findMany({ where: { estado: 'CERRADO' }, orderBy: { createdAt: 'desc' } })
  return cerrados.find((p) => estaEnAlcancePeriodo(p, c)) ?? null
}

export function diasRestantes(fecha: Date) {
  return Math.ceil((fecha.getTime() - Date.now()) / 86_400_000)
}

/** Vencimiento real de la ventana (misma comparación que el servidor).
 * Ojo: diasRestantes redondea hacia arriba (vencido hace <24 h da 0), no sirve para decidir. */
export function ventanaVencida(fecha: Date) {
  return fecha.getTime() < Date.now()
}

/** Banner de estado de la ventana de carga (server component). */
export function BannerVentana({ periodo, extensionIndividual = false }: { periodo: { nombre: string; tipo: string; estado: string; fechaLimiteCarga: Date }; extensionIndividual?: boolean }) {
  const fecha = periodo.fechaLimiteCarga.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })
  if (periodo.estado === 'CERRADO') {
    return (
      <p className="mb-4 rounded-xl bg-hueso-2 px-4 py-2.5 text-sm text-gris">
        <CalendarClock size={14} className="mr-1.5 inline -translate-y-px" />
        Período <b className="text-negro">{periodo.nombre}</b> cerrado: los objetivos quedaron congelados para su evaluación.
      </p>
    )
  }
  const dias = diasRestantes(periodo.fechaLimiteCarga)
  if (ventanaVencida(periodo.fechaLimiteCarga)) {
    return (
      <p className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-hunter-dark">
        <CalendarClock size={14} className="mr-1.5 inline -translate-y-px" />
        El plazo de carga del período <b>{periodo.nombre}</b> venció el {fecha}. Si necesitas cargar un objetivo, coordina con RR.HH.
      </p>
    )
  }
  return (
    <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
      <CalendarClock size={14} className="mr-1.5 inline -translate-y-px" />
      Carga de objetivos del período <b>{periodo.nombre}</b> ({periodo.tipo === 'ANUAL' ? 'anual' : 'semestral'}) abierta
      hasta el <b>{fecha}</b>{extensionIndividual ? <> (plazo extendido para ti)</> : ''}{dias <= 14 ? <> · quedan <b>{dias === 0 ? 'horas' : `${dias} día${dias === 1 ? '' : 's'}`}</b></> : ''}.
    </p>
  )
}
