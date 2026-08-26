import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin } from '@/shared/lib/permisos'
import { tieneAdmin } from '@/shared/lib/permisos-admin'
import { AvisoSoloLectura, Card, Chip, Titulo, Vacio } from '@/shared/ui/componentes'
import { FormTransversal, CargarLogro, AccionesTransversal } from '@/features/admin/FormTransversal'
import { periodoVigente, BannerVentana } from '@/features/objetivos/periodo'

export default async function TransversalesPage() {
  const sesion = await requiereAdmin('OBJETIVOS', 'VER')
  const puedeGestionar = tieneAdmin(sesion.permisosAdmin, 'OBJETIVOS', 'GESTIONAR')
  const periodo = await periodoVigente()
  if (!periodo) return (<><Titulo>Objetivos transversales</Titulo><Vacio>Crea y abre primero un período de objetivos (en Ciclos de evaluación → Períodos).</Vacio></>)

  const [transversales, areas, niveles, paises, puestos, ciclosActivos, ciclosCerrados] = await Promise.all([
    prisma.objetivo.findMany({
      where: { periodoId: periodo.id, tipo: 'TRANSVERSAL' },
      include: { logros: { take: 1 } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.area.findMany({ orderBy: { nombre: 'asc' } }),
    prisma.nivelJerarquico.findMany({ orderBy: { orden: 'asc' } }),
    prisma.pais.findMany({ orderBy: { codigo: 'asc' } }),
    prisma.puesto.findMany({ orderBy: { nombre: 'asc' } }),
    prisma.ciclo.count({ where: { periodoId: periodo.id, estado: 'ACTIVO' } }),
    prisma.ciclo.count({ where: { periodoId: periodo.id, estado: 'CERRADO' } }),
  ])
  const areaNombre = (id: string) => areas.find((a) => a.id === id)?.nombre ?? id
  const nivelNombre = (id: string) => niveles.find((n) => n.id === id)?.nombre ?? id
  const paisNombre = (id: string) => paises.find((p) => p.id === id)?.nombre ?? id
  const puestoNombre = (id: string) => puestos.find((p) => p.id === id)?.nombre ?? id

  return (
    <>
      <Titulo
        sub={`Período ${periodo.nombre} · objetivos corporativos focalizables por país, nivel, área o puesto`}
        accion={puedeGestionar ? (
          <FormTransversal
            periodoId={periodo.id}
            areas={areas.map((a) => ({ id: a.id, nombre: a.nombre }))}
            niveles={niveles.map((n) => ({ id: n.id, nombre: n.nombre }))}
            paises={paises.map((p) => ({ id: p.id, nombre: p.nombre }))}
            puestos={puestos.map((p) => ({ id: p.id, nombre: p.nombre }))}
          />
        ) : undefined}
      >Objetivos transversales</Titulo>
      {!puedeGestionar && <AvisoSoloLectura />}
      <BannerVentana periodo={periodo} />
      <div className="space-y-5">
        <Card titulo="Transversales del período" extra="el logro lo carga la Dirección y aplica a todos los alcanzados">
          {transversales.length === 0 ? (
            <Vacio>Aún no hay objetivos transversales en este período.</Vacio>
          ) : (
            <ul className="space-y-2.5">
              {transversales.map((o) => {
                const foco = [
                  ...o.focoPaisIds.map(paisNombre),
                  ...o.focoNivelIds.map(nivelNombre),
                  ...o.focoAreaIds.map(areaNombre),
                  ...o.focoPuestoIds.map(puestoNombre),
                ]
                return (
                  // Móvil: card apilada (peso + chips de alcance arriba, título y descripción a
                  // lo ancho, logro al pie) — la fila de 3 columnas partía el título en una
                  // columna de una palabra. Escritorio: la fila de siempre.
                  <li key={o.id} className="rounded-xl border border-gris-claro px-4 py-3 md:flex md:flex-wrap md:items-center md:gap-4">
                    <span className="flex items-center gap-2 md:hidden">
                      <span className="font-display text-2xl font-extrabold tracking-tight text-hunter">{o.peso}%</span>
                      <span className="ml-auto flex flex-wrap justify-end gap-1">
                        {foco.length === 0 ? <Chip tono="azul">Toda la organización</Chip> : foco.map((f) => <Chip key={f}>{f}</Chip>)}
                      </span>
                    </span>
                    <span className="hidden w-20 shrink-0 self-center text-center font-display text-2xl font-extrabold tracking-tight text-hunter md:block">{o.peso}%</span>
                    <div className="mt-1.5 min-w-0 flex-1 md:mt-0">
                      <p className="text-sm font-semibold">{o.titulo}</p>
                      <p className="text-xs text-gris">{o.descripcion}</p>
                      <p className="mt-1 hidden text-[11px] md:block">
                        Aplica a: {foco.length === 0 ? <Chip tono="azul">Toda la organización</Chip> : foco.map((f) => <Chip key={f}>{f}</Chip>)}
                      </p>
                    </div>
                    <div className="mt-2.5 border-t border-dashed border-hueso-2 pt-2.5 md:contents">
                    <CargarLogro
                      objetivoId={o.id}
                      logroActual={o.logros[0]?.logroFinal ?? null}
                      habilitado={ciclosActivos > 0}
                      puedeGestionar={puedeGestionar}
                      motivoDeshabilitado={ciclosCerrados > 0
                        ? 'El ciclo que evaluó este período ya cerró: el logro quedó congelado con los resultados'
                        : undefined}
                    />
                    </div>
                    {puedeGestionar && (
                    // Editar/eliminar quedan solo en escritorio (criterio de la ronda móvil)
                    <span className="hidden md:contents">
                    <AccionesTransversal
                      objetivo={{
                        id: o.id,
                        titulo: o.titulo,
                        descripcion: o.descripcion,
                        peso: o.peso,
                        metaFecha: o.metaFecha,
                        focoAreaIds: o.focoAreaIds,
                        focoNivelIds: o.focoNivelIds,
                        focoPaisIds: o.focoPaisIds,
                        focoPuestoIds: o.focoPuestoIds,
                      }}
                      areas={areas.map((a) => ({ id: a.id, nombre: a.nombre }))}
                      niveles={niveles.map((n) => ({ id: n.id, nombre: n.nombre }))}
                      paises={paises.map((p) => ({ id: p.id, nombre: p.nombre }))}
                      puestos={puestos.map((p) => ({ id: p.id, nombre: p.nombre }))}
                      tieneLogros={o.logros.length > 0}
                      congelado={ciclosCerrados > 0}
                    />
                    </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
