import { Fragment } from 'react'
import Link from 'next/link'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin } from '@/shared/lib/permisos'
import { tieneAdmin } from '@/shared/lib/permisos-admin'
import { ArrowRight } from 'lucide-react'
import { AvisoSoloLectura, Card, NivelChip, Titulo, Vacio, thCls, tdCls } from '@/shared/ui/componentes'
import { FilaEnlace } from '@/shared/ui/FilaEnlace'
import { Tabs } from '@/shared/ui/Tabs'
import { FiltrosPuestos } from '@/features/admin/FiltrosPuestos'
import { FormNuevoPuesto } from '@/features/admin/FormNuevoPuesto'
import { PanelAreas } from '@/features/admin/PanelAreas'
import { BotonEliminarPuesto } from '@/features/admin/BotonEliminarPuesto'

export default async function PuestosPage({ searchParams }: {
  searchParams: Promise<{ area?: string; puesto?: string }>
}) {
  const sesion = await requiereAdmin('PUESTOS', 'VER')
  const puedeGestionar = tieneAdmin(sesion.permisosAdmin, 'PUESTOS', 'GESTIONAR')
  const { area: areaFiltro, puesto: puestoFiltro } = await searchParams
  const [puestos, areas, niveles] = await Promise.all([
    prisma.puesto.findMany({
      include: { area: true, nivel: true, competencias: { include: { competencia: true } }, _count: { select: { colaboradores: true } } },
      orderBy: [{ nivel: { orden: 'asc' } }, { nombre: 'asc' }],
    }),
    prisma.area.findMany({ include: { _count: { select: { colaboradores: true, puestos: true } } }, orderBy: { nombre: 'asc' } }),
    prisma.nivelJerarquico.findMany({ orderBy: { orden: 'asc' } }),
  ])

  // Filtros por combobox (con 329 puestos y 94 áreas la lista plana es inmanejable)
  const visibles = puestos.filter((p) =>
    (!areaFiltro || p.areaId === areaFiltro) && (!puestoFiltro || p.id === puestoFiltro))

  // Puestos agrupados por área (los sin área al final)
  const grupos = [
    ...areas
      .map((a) => ({ nombre: a.nombre, puestos: visibles.filter((p) => p.areaId === a.id) }))
      .filter((g) => g.puestos.length > 0),
    ...(visibles.some((p) => !p.areaId) ? [{ nombre: 'Sin área', puestos: visibles.filter((p) => !p.areaId) }] : []),
  ]

  const tabPuestos = (
    <div className="space-y-5">
      {!puedeGestionar && <AvisoSoloLectura />}
      {/* Una sola fila: filtros a la izquierda, crear a la derecha; el formulario
          expandido de crear cae a su propia fila completa (basis-full) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {puestos.length > 0 ? (
          <FiltrosPuestos
            areas={areas.map((a) => ({ id: a.id, nombre: a.nombre }))}
            puestos={puestos.map((p) => ({ id: p.id, nombre: p.nombre, detalle: p.area?.nombre }))}
            area={areaFiltro}
            puesto={puestoFiltro}
          />
        ) : <span />}
        {puedeGestionar && <FormNuevoPuesto areas={areas.map((a) => ({ id: a.id, nombre: a.nombre }))} niveles={niveles.map((n) => ({ id: n.id, nombre: n.nombre }))} />}
      </div>
      {puestos.length === 0 && (
        <Vacio>
          Aún no hay puestos. Crea el primero con &ldquo;＋ Crear puesto&rdquo;.
          {areas.length === 0 && <> Si necesitas áreas, créalas en la pestaña &ldquo;Áreas&rdquo;.</>}
        </Vacio>
      )}
      {puestos.length > 0 && visibles.length === 0 && <Vacio>No hay puestos con esos filtros.</Vacio>}
      {visibles.length > 0 && (
            <Card>
              {/* Móvil: cards agrupadas por área (la tabla de 6 columnas desbordaba 754px
                  en 390). Eliminar puesto queda solo en escritorio. */}
              <div className="space-y-2.5 md:hidden">
                {grupos.map((g) => (
                  <Fragment key={g.nombre}>
                    <p className="rounded-lg bg-hueso px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-gris">
                      {g.nombre} · {g.puestos.length}
                    </p>
                    {g.puestos.map((p) => (
                      <div key={p.id} className="relative rounded-xl border border-gris-claro px-3.5 py-3 transition hover:border-gris/60">
                        <Link href={`/admin/puestos/${p.id}`} aria-label={`${p.nombre}: abrir descripción del puesto`} className="absolute inset-0 z-10 rounded-xl" />
                        <div className="flex items-center gap-2">
                          <NivelChip nivel={p.nivel.nombre} />
                          <span className="ml-auto rounded-full bg-hueso-2 px-2.5 py-0.5 text-[10.5px] font-bold text-gris">
                            {p._count.colaboradores} persona{p._count.colaboradores === 1 ? '' : 's'}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <p className="text-[14px] font-bold leading-snug">{p.nombre}</p>
                          <span className="shrink-0 text-xl font-bold text-gris-claro">›</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {p.competencias.slice(0, 2).map(({ competencia }) => (
                            <span key={competencia.id} className="rounded-full bg-hueso-2 px-2 py-0.5 text-[10.5px] font-semibold">{competencia.nombre}</span>
                          ))}
                          {p.competencias.length > 2 && <span className="px-1 text-[10.5px] text-gris">+{p.competencias.length - 2}</span>}
                        </div>
                        <p className="mt-1.5 border-t border-dashed border-hueso-2 pt-1.5 text-[11px] text-gris/80">
                          Competencias {p.nivel.compPct}% · Objetivos {100 - p.nivel.compPct}%
                        </p>
                      </div>
                    ))}
                  </Fragment>
                ))}
              </div>

              <div className="-m-5 hidden overflow-x-auto md:block">
                <table className="w-full min-w-[720px]">
                  <thead><tr>
                    <th className={thCls}>Puesto</th>
                    <th className={thCls}>Nivel</th>
                    <th className={thCls}>Competencias</th>
                    <th className={thCls}>Comp. / Obj.</th>
                    <th className={thCls}>Personas</th>
                    <th className={thCls}></th>
                  </tr></thead>
                  <tbody>
                    {grupos.map((g) => (
                      <Fragment key={g.nombre}>
                        <tr>
                          <td colSpan={6} className="bg-hueso px-5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-gris">
                            {g.nombre} · {g.puestos.length}
                          </td>
                        </tr>
                        {g.puestos.map((p) => (
                          <FilaEnlace key={p.id} href={`/admin/puestos/${p.id}`} className="hover:bg-hueso/60">
                            <td className={tdCls}><b>{p.nombre}</b></td>
                            <td className={tdCls}><NivelChip nivel={p.nivel.nombre} /></td>
                            <td className={tdCls}>
                              <span className="flex flex-wrap gap-1">
                                {p.competencias.slice(0, 3).map(({ competencia }) => (
                                  <span key={competencia.id} className="rounded-full bg-hueso-2 px-2 py-0.5 text-[11px] font-semibold">{competencia.nombre}</span>
                                ))}
                                {p.competencias.length > 3 && <span className="text-[11px] text-gris">+{p.competencias.length - 3}</span>}
                              </span>
                            </td>
                            <td className={tdCls}>{`${p.nivel.compPct}% / ${100 - p.nivel.compPct}%`}</td>
                            <td className={tdCls}>{p._count.colaboradores}</td>
                            <td className={`${tdCls} whitespace-nowrap text-right`}>
                              {puedeGestionar && <BotonEliminarPuesto puestoId={p.id} nombre={p.nombre} enUso={p._count.colaboradores > 0} />}
                              <Link
                                href={`/admin/puestos/${p.id}`}
                                title="Abrir descripción del puesto"
                                className="inline-grid h-7 w-7 place-items-center rounded-lg text-gris transition hover:bg-hueso-2 hover:text-hunter"
                              ><ArrowRight size={16} /></Link>
                            </td>
                          </FilaEnlace>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
      )}
    </div>
  )

  const tabAreas = (
    <div className="max-w-5xl">
      <PanelAreas
        puedeGestionar={puedeGestionar}
        areas={areas.map((a) => ({
          id: a.id,
          nombre: a.nombre,
          enUso: a._count.colaboradores > 0 || a._count.puestos > 0,
          puestos: a._count.puestos,
        }))}
      />
    </div>
  )

  return (
    <>
      <Titulo sub="Descriptores de puesto: competencias asociadas y pesos por dimensión">Puestos y niveles</Titulo>
      <Tabs
        tabs={[
          { id: 'puestos', label: 'Puestos', icono: 'puestos', contenido: tabPuestos },
          { id: 'areas', label: 'Áreas', icono: 'areas', contenido: tabAreas },
        ]}
      />
    </>
  )
}
