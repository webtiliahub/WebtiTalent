import Link from 'next/link'
import { cookies } from 'next/headers'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin, alcancePaisWhere } from '@/shared/lib/permisos'
import { tieneAdmin } from '@/shared/lib/permisos-admin'
import { Avatar, Card, Chip, Titulo, Vacio, thCls, tdCls } from '@/shared/ui/componentes'
import { FilaEnlace } from '@/shared/ui/FilaEnlace'
import { BotonReactivar } from '@/features/admin/AccionesBajaColaborador'

/** Archivo de colaboradores DESACTIVADOS (personas que salieron): separados de la tabla
 * de activos. Su historial se conserva completo y se pueden reactivar (reingresos). */
export default async function ColaboradoresInactivosPage() {
  const sesion = await requiereAdmin('COLABORADORES', 'VER')
  const puedeGestionar = tieneAdmin(sesion.permisosAdmin, 'COLABORADORES', 'GESTIONAR')
  const jar = await cookies()
  const paisCookie = jar.get('pais')?.value ?? null

  const inactivos = await prisma.colaborador.findMany({
    where: { activo: false, ...alcancePaisWhere(sesion, paisCookie) },
    include: { puesto: true, area: true, pais: true },
    orderBy: [{ bajaEn: 'desc' }, { apellidos: 'asc' }],
    take: 300,
  })

  return (
    <>
      <Link href="/admin/colaboradores" className="mb-3 inline-block text-sm text-gris hover:text-negro">← Volver a Colaboradores</Link>
      <Titulo sub={`${inactivos.length} en el archivo · su historial de evaluaciones y objetivos se conserva completo`}>
        Colaboradores desactivados
      </Titulo>

      <Card>
        {inactivos.length === 0 ? (
          <Vacio>Sin bajas registradas en tu alcance.</Vacio>
        ) : (
          <>
          {/* Móvil: cards (mismo patrón que el listado de activos) — la tabla de 6 columnas
              desbordaba la pantalla. Escritorio: la tabla de siempre. */}
          <ul className="space-y-2.5 md:hidden">
            {inactivos.map((c) => (
              <li key={c.id} className="relative rounded-xl border border-gris-claro px-3.5 py-3">
                <Link href={`/admin/colaboradores/${c.id}`} aria-label={`${c.nombres} ${c.apellidos}: abrir ficha`} className="absolute inset-0 z-10 rounded-xl" />
                <div className="flex items-center gap-2 opacity-70">
                  <Avatar nombre={`${c.nombres} ${c.apellidos}`} size="sm" />
                  <span className="ml-auto rounded-full bg-hueso-2 px-2.5 py-0.5 text-[10.5px] font-bold text-gris">{c.pais.codigo}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-[14px] font-bold leading-snug opacity-70">{c.nombres} {c.apellidos}</p>
                  <span className="shrink-0 text-xl font-bold text-gris-claro">›</span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-gris">{c.puesto?.nombre ?? 'Sin puesto'} · {c.area?.nombre ?? 'Sin área'}</p>
                <p className="mt-1.5 border-t border-dashed border-hueso-2 pt-1.5 text-[11px] text-gris/80">
                  {c.documento} · baja: {c.bajaEn ? c.bajaEn.toLocaleDateString('es-PE') : '—'}
                </p>
                {puedeGestionar && (
                  <div className="relative z-20 mt-2">
                    <BotonReactivar colaboradorId={c.id} nombre={`${c.nombres} ${c.apellidos}`} />
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div className="-m-5 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[720px]">
              <thead><tr>
                <th className={thCls}>Colaborador</th>
                <th className={thCls}>Puesto</th>
                <th className={thCls}>Área</th>
                <th className={thCls}>País</th>
                <th className={thCls}>Fecha de baja</th>
                <th className={thCls}></th>
              </tr></thead>
              <tbody>
                {inactivos.map((c) => (
                  <FilaEnlace key={c.id} href={`/admin/colaboradores/${c.id}`} className="hover:bg-hueso/60">
                    <td className={tdCls}>
                      <span className="flex items-center gap-2.5 opacity-70">
                        <Avatar nombre={`${c.nombres} ${c.apellidos}`} size="sm" />
                        <span><b>{c.nombres} {c.apellidos}</b><br /><span className="text-xs text-gris">{c.documento}</span></span>
                      </span>
                    </td>
                    <td className={tdCls}>{c.puesto?.nombre ?? '—'}</td>
                    <td className={tdCls}>{c.area?.nombre ?? '—'}</td>
                    <td className={tdCls}><Chip>{c.pais.codigo}</Chip></td>
                    <td className={tdCls}>{c.bajaEn ? c.bajaEn.toLocaleDateString('es-PE') : '—'}</td>
                    <td className={`${tdCls} text-right`}>
                      {puedeGestionar && <BotonReactivar colaboradorId={c.id} nombre={`${c.nombres} ${c.apellidos}`} />}
                    </td>
                  </FilaEnlace>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
    </>
  )
}
