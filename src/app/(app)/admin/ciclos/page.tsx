import Link from 'next/link'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin } from '@/shared/lib/permisos'
import { tieneAdmin } from '@/shared/lib/permisos-admin'
import { AvisoSoloLectura, BotonLink, Card, Chip, Titulo } from '@/shared/ui/componentes'
import { Tabs } from '@/shared/ui/Tabs'
import { PanelPeriodos, BotonCrearPeriodo } from '@/features/objetivos/PanelPeriodos'
import { coberturaPeriodo } from '@/features/objetivos/acciones-periodo'
import { diasRestantes, ventanaVencida } from '@/features/objetivos/periodo'

const ESTADO_CICLO = {
  BORRADOR: { label: 'Borrador', tono: 'pendiente' as const, dot: '#b9b3ac' },
  ACTIVO: { label: 'Activo', tono: 'ok' as const, dot: '#10b981' },
  CERRADO: { label: 'Cerrado', tono: 'neutro' as const, dot: '#8a857f' },
}

export default async function CiclosPage() {
  const sesion = await requiereAdmin('CICLOS', 'VER')
  const puedeGestionarCiclos = tieneAdmin(sesion.permisosAdmin, 'CICLOS', 'GESTIONAR')
  const puedeGestionarObjetivos = tieneAdmin(sesion.permisosAdmin, 'OBJETIVOS', 'GESTIONAR')
  const [ciclos, periodos, enviadasPorCiclo, totalesPorCiclo] = await Promise.all([
    prisma.ciclo.findMany({
      include: { pais: true, periodo: true },
      orderBy: { fechaInicio: 'desc' },
    }),
    prisma.periodoObjetivos.findMany({
      include: { _count: { select: { objetivos: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.asignacion.groupBy({ by: ['cicloId'], where: { estado: 'ENVIADA' }, _count: true }),
    // Denominador del avance: evaluaciones reales del ciclo (una PROPUESTA de par aún no
    // es evaluación y una INVALIDADA salió de la nota) — mismo criterio que el detalle
    prisma.asignacion.groupBy({ by: ['cicloId'], where: { estado: { notIn: ['PROPUESTA', 'INVALIDADA'] } }, _count: true }),
  ])
  const enviadas = new Map(enviadasPorCiclo.map((e) => [e.cicloId, e._count]))
  const totales = new Map(totalesPorCiclo.map((e) => [e.cicloId, e._count]))

  const coberturas = new Map<string, { completos: number; total: number }>()
  for (const p of periodos.filter((p) => p.estado !== 'BORRADOR')) {
    const c = await coberturaPeriodo(p.id)
    coberturas.set(p.id, { completos: c.completos, total: c.total })
  }

  const tabCiclos = (
    <Card titulo="Ciclos de evaluación" extra="cada ciclo agrupa su propio proceso, participantes y resultados">
      {!puedeGestionarCiclos && <AvisoSoloLectura />}
      {ciclos.length === 0 ? (
        <p className="rounded-xl bg-hueso-2 px-4 py-6 text-center text-sm text-gris">
          Aún no hay ciclos. Los objetivos se definen en su período; cuando estén listos, crea el ciclo con el asistente.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {ciclos.map((c) => {
            const estado = ESTADO_CICLO[c.estado]
            const total = totales.get(c.id) ?? 0
            const env = enviadas.get(c.id) ?? 0
            const pct = total > 0 ? Math.round((env / total) * 100) : 0
            const dias = diasRestantes(c.fechaFin)
            const derecha = c.estado === 'CERRADO' ? 'archivado' : c.estado === 'BORRADOR' ? 'sin lanzar' : dias >= 0 ? `${dias} día${dias === 1 ? '' : 's'}` : 'en curso'
            const barra = (
              <>
                <div className="h-2 rounded-full bg-hueso-2">
                  <div className={`h-2 rounded-full ${c.estado === 'CERRADO' ? 'bg-gris' : 'bg-hunter'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
                <div className="mt-0.5 flex justify-between text-[11px] text-gris">
                  <span>{pct}%</span><span>{derecha}</span>
                </div>
              </>
            )
            const meta = `${c.descripcion ? `${c.descripcion} · ` : ''}${c.pais ? c.pais.nombre : 'Todos los países'} · ${c.periodo ? `período ${c.periodo.nombre}` : 'sin objetivos'}`
            return (
              // Móvil: card apilada (chips arriba, nombre a lo ancho, barra al pie) — la fila de
              // una sola línea desbordaba 451px. Escritorio: la fila de siempre.
              <li key={c.id}>
                <Link href={`/admin/ciclos/${c.id}`} className="block rounded-xl border border-gris-claro px-4 py-3.5 transition hover:bg-hueso/60 md:flex md:items-center md:gap-4">
                  {/* Móvil: dot + título (se corta con … si es largo) + chip de estado en una
                      sola fila; meta y barra debajo */}
                  <div className="md:hidden">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: estado.dot }} />
                      <p className="min-w-0 flex-1 truncate text-sm font-bold">{c.nombre}</p>
                      {c.publicado && <Chip tono="azul">Publicado</Chip>}
                      <Chip tono={estado.tono}>{estado.label}</Chip>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-gris">{meta}</p>
                    <div className="mt-2.5">{barra}</div>
                  </div>

                  {/* Escritorio */}
                  <span className="hidden h-2.5 w-2.5 shrink-0 rounded-full md:block" style={{ background: estado.dot }} />
                  <div className="hidden min-w-0 flex-1 md:block">
                    <p className="text-sm font-bold">{c.nombre}</p>
                    <p className="text-xs text-gris">{meta}</p>
                  </div>
                  {c.publicado && <span className="hidden md:inline"><Chip tono="azul">Publicado</Chip></span>}
                  <span className="hidden md:inline"><Chip tono={estado.tono}>{estado.label}</Chip></span>
                  <div className="hidden w-36 shrink-0 md:block">{barra}</div>
                  <span className="hidden text-gris md:inline">→</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )

  const tabPeriodos = (
    <PanelPeriodos
      puedeGestionar={puedeGestionarObjetivos}
      periodos={periodos.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        tipo: p.tipo,
        estado: p.estado,
        fechaLimiteCarga: p.fechaLimiteCarga.toISOString().slice(0, 10),
        fechaLimiteLabel: p.fechaLimiteCarga.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' }),
        dias: diasRestantes(p.fechaLimiteCarga),
        vencido: ventanaVencida(p.fechaLimiteCarga),
        objetivos: p._count.objetivos,
        cobertura: coberturas.get(p.id) ?? null,
      }))}
    />
  )

  return (
    <>
      <Titulo sub="Períodos de objetivos y ciclos tipo campaña: crea, lanza, calibra y cierra">
        Ciclos de evaluación
      </Titulo>
      <Tabs
        full
        tabs={[
          { id: 'ciclos', label: 'Evaluaciones', icono: 'ciclos', contenido: tabCiclos, accion: puedeGestionarCiclos ? <BotonLink href="/admin/ciclos/nuevo">＋ Crear ciclo</BotonLink> : undefined },
          { id: 'periodos', label: 'Objetivos', icono: 'periodos', contenido: tabPeriodos, accion: puedeGestionarObjetivos ? <BotonCrearPeriodo /> : undefined },
        ]}
      />
    </>
  )
}
