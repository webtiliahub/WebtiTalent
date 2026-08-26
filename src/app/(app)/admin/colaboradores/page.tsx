import Link from 'next/link'
import { cookies } from 'next/headers'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin, alcancePaisWhere } from '@/shared/lib/permisos'
import { tieneAdmin } from '@/shared/lib/permisos-admin'
import { ArrowRight } from 'lucide-react'
import { Avatar, AvisoSoloLectura, Card, Chip, NivelChip, Titulo, Vacio, thCls, tdCls } from '@/shared/ui/componentes'
import { FilaEnlace } from '@/shared/ui/FilaEnlace'
import { FiltrosColaboradores } from '@/features/admin/FiltrosColaboradores'
import { FormNuevoColaborador } from '@/features/admin/FormNuevoColaborador'

export default async function ColaboradoresPage({ searchParams }: {
  searchParams: Promise<{ q?: string; area?: string; nivel?: string }>
}) {
  const sesion = await requiereAdmin('COLABORADORES', 'VER')
  const puedeGestionar = tieneAdmin(sesion.permisosAdmin, 'COLABORADORES', 'GESTIONAR')
  const { q, area, nivel } = await searchParams
  const jar = await cookies()
  const paisCookie = jar.get('pais')?.value ?? null

  const where = {
    activo: true,
    ...alcancePaisWhere(sesion, paisCookie),
    ...(area ? { areaId: area } : {}),
    ...(nivel ? { puesto: { nivelId: nivel } } : {}),
  }

  const [candidatos, areas, niveles, paises, puestos, jefes, inactivos, totalAlcance] = await Promise.all([
    prisma.colaborador.findMany({
      where,
      include: { puesto: { include: { nivel: true } }, area: true, pais: true, jefe: true },
      orderBy: [{ apellidos: 'asc' }],
      take: 1200,
    }),
    prisma.area.findMany({ orderBy: { nombre: 'asc' } }),
    prisma.nivelJerarquico.findMany({ orderBy: { orden: 'asc' } }),
    prisma.pais.findMany({ where: sesion.alcanceRrhh === 'PAIS' && sesion.alcancePaisId ? { id: sesion.alcancePaisId } : {}, orderBy: { nombre: 'asc' } }),
    prisma.puesto.findMany({ orderBy: { nombre: 'asc' } }),
    prisma.colaborador.findMany({ where: { activo: true, ...alcancePaisWhere(sesion, paisCookie) }, orderBy: [{ apellidos: 'asc' }], take: 1200 }),
    prisma.colaborador.count({ where: { activo: false, ...alcancePaisWhere(sesion, paisCookie) } }),
    prisma.colaborador.count({ where: { activo: true, ...alcancePaisWhere(sesion, paisCookie) } }),
  ])
  const hayFiltros = Boolean(q || area || nivel)

  // Búsqueda SIN TILDES (el SQL `contains` no las ignora y «Sofia» no encontraba a «Sofía»):
  // se filtra en memoria sobre el alcance ya acotado (tope 1200, mismo criterio del Combobox)
  const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const termino = q ? normalizar(q) : ''
  const filtrados = termino
    ? candidatos.filter((c) =>
        normalizar(`${c.nombres} ${c.apellidos}`).includes(termino) ||
        c.documento.toLowerCase().includes(termino) ||
        (c.codigo ?? '').toLowerCase().includes(termino))
    : candidatos
  const total = filtrados.length
  const colaboradores = filtrados.slice(0, 100)

  return (
    <>
      <Titulo sub={hayFiltros ? `${total} resultado${total === 1 ? '' : 's'} del filtro · ${totalAlcance} colaboradores activos en tu alcance` : `${total} colaboradores activos en tu alcance`} accion={puedeGestionar ? (
        // La importación masiva es exclusiva de la web: en móvil no se ofrece
        <Link href="/admin/colaboradores/importar" className="hidden rounded-xl border border-gris-claro bg-white px-4 py-2.5 text-[13px] font-bold transition hover:bg-hueso md:inline-block">
          ⇪ Importar padrón
        </Link>
      ) : undefined}>Colaboradores</Titulo>

      {!puedeGestionar && <AvisoSoloLectura />}

      {/* Una sola fila: filtros (aplican solos al elegir) a la izquierda, agregar a la
          derecha; el formulario expandido cae a su propia fila completa */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FiltrosColaboradores
          areas={areas.map((a) => ({ id: a.id, nombre: a.nombre }))}
          niveles={niveles.map((n) => ({ id: n.id, nombre: n.nombre }))}
          q={q}
          area={area}
          nivel={nivel}
        />
        {puedeGestionar && (
          <FormNuevoColaborador
            paises={paises.map((p) => ({ id: p.id, nombre: p.nombre }))}
            areas={areas.map((a) => ({ id: a.id, nombre: a.nombre }))}
            puestos={puestos.map((p) => ({ id: p.id, nombre: p.nombre, areaId: p.areaId }))}
            jefes={jefes.map((j) => ({ id: j.id, nombre: `${j.nombres} ${j.apellidos}` }))}
          />
        )}
      </div>

      <Card>
        {colaboradores.length === 0 ? (
          <Vacio>No hay colaboradores con esos filtros.</Vacio>
        ) : (
          <>
          {/* Móvil: cards tocables (abren la ficha) — la tabla de 7 columnas desbordaba
              818px en 390 de pantalla. Escritorio: la tabla de siempre. */}
          <ul className="space-y-2.5 md:hidden">
            {colaboradores.map((c) => (
              <li key={c.id} className="relative rounded-xl border border-gris-claro px-3.5 py-3 transition hover:border-gris/60">
                <Link href={`/admin/colaboradores/${c.id}`} aria-label={`${c.nombres} ${c.apellidos}: abrir ficha`} className="absolute inset-0 z-10 rounded-xl" />
                <div className="flex items-center gap-2">
                  <Avatar nombre={`${c.nombres} ${c.apellidos}`} size="sm" />
                  {c.puesto && <NivelChip nivel={c.puesto.nivel.nombre} />}
                  <span className="ml-auto rounded-full bg-hueso-2 px-2.5 py-0.5 text-[10.5px] font-bold text-gris">{c.pais.codigo}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-[14px] font-bold leading-snug">{c.nombres} {c.apellidos}</p>
                  <span className="shrink-0 text-xl font-bold text-gris-claro">›</span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-gris">{c.puesto?.nombre ?? 'Sin puesto'} · {c.area?.nombre ?? 'Sin área'}</p>
                <p className="mt-1.5 border-t border-dashed border-hueso-2 pt-1.5 text-[11px] text-gris/80">
                  {c.codigo ? `${c.codigo} · ` : ''}{c.documento} · {c.jefe ? `jefe: ${c.jefe.nombres} ${c.jefe.apellidos}` : 'sin jefe directo'}
                </p>
              </li>
            ))}
          </ul>

          <div className="-m-5 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px]">
              <thead><tr>
                <th className={thCls}>Colaborador</th>
                <th className={thCls}>Puesto</th>
                <th className={thCls}>Nivel</th>
                <th className={thCls}>Área</th>
                <th className={thCls}>País</th>
                <th className={thCls}>Jefe directo</th>
                <th className={thCls}></th>
              </tr></thead>
              <tbody>
                {colaboradores.map((c) => (
                  <FilaEnlace key={c.id} href={`/admin/colaboradores/${c.id}`} className="hover:bg-hueso/60">
                    <td className={tdCls}>
                      <span className="flex items-center gap-2.5">
                        <Avatar nombre={`${c.nombres} ${c.apellidos}`} size="sm" />
                        <span><b>{c.nombres} {c.apellidos}</b><br /><span className="text-xs text-gris">{c.codigo ? `${c.codigo} · ` : ''}{c.documento}</span></span>
                      </span>
                    </td>
                    <td className={tdCls}>{c.puesto?.nombre ?? '—'}</td>
                    <td className={tdCls}>{c.puesto ? <NivelChip nivel={c.puesto.nivel.nombre} /> : '—'}</td>
                    <td className={tdCls}>{c.area?.nombre ?? '—'}</td>
                    <td className={tdCls}><Chip>{c.pais.codigo}</Chip></td>
                    <td className={tdCls}>{c.jefe ? `${c.jefe.nombres} ${c.jefe.apellidos}` : '—'}</td>
                    <td className={`${tdCls} text-right`}>
                      <Link
                        href={`/admin/colaboradores/${c.id}`}
                        title="Abrir hoja de vida"
                        className="inline-grid h-7 w-7 place-items-center rounded-lg text-gris transition hover:bg-hueso-2 hover:text-marca"
                      ><ArrowRight size={16} /></Link>
                    </td>
                  </FilaEnlace>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
      {total > 100 && <p className="mt-3 text-xs text-gris">Mostrando los primeros 100 de {total}. Usa los filtros para acotar.</p>}

      {/* Archivo de bajas: separado de la tabla de activos, acceso discreto al pie */}
      <div className="mt-5 flex justify-end">
        <Link
          href="/admin/colaboradores/inactivos"
          className="inline-flex items-center gap-1.5 rounded-xl border border-gris-claro bg-hueso-2 px-3.5 py-2 text-xs font-bold text-gris transition hover:bg-hueso hover:text-negro"
        >
          Archivo de colaboradores desactivados{inactivos > 0 ? ` (${inactivos})` : ''} →
        </Link>
      </div>
    </>
  )
}
