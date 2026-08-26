import Link from 'next/link'
import { prisma } from '@/shared/lib/prisma'
import { requiereJefe } from '@/shared/lib/permisos'
import { Avatar, Card, Chip, NivelChip, Titulo, Vacio } from '@/shared/ui/componentes'

export default async function MiEquipoPage() {
  const sesion = await requiereJefe()
  const equipo = await prisma.colaborador.findMany({
    where: { jefeId: sesion.colaboradorId, activo: true },
    include: { puesto: { include: { nivel: true } }, area: true, pais: true },
    orderBy: { apellidos: 'asc' },
  })

  return (
    <>
      <Titulo sub="Tu equipo directo: revisa su información y acompaña su desarrollo">Mi equipo</Titulo>
      <Card titulo="Equipo directo" extra={`${equipo.length} colaboradores`}>
        {equipo.length === 0 ? (
          <Vacio>No tienes colaboradores a cargo.</Vacio>
        ) : (
          <ul className="space-y-2.5">
            {equipo.map((c) => (
              // Móvil: card completa tocable (navega a la hoja de vida) — la fila única con
              // chips + botón no cabía en 390px y desbordaba la página. Escritorio: la fila de siempre.
              <li key={c.id} className="relative rounded-xl border border-gris-claro px-4 py-3 transition hover:border-gris/60">
                <Link href={`/equipo/${c.id}`} aria-label={`${c.nombres} ${c.apellidos}: ver hoja de vida`} className="absolute inset-0 z-10 rounded-xl md:hidden" />

                {/* Móvil */}
                <div className="flex items-center gap-2 md:hidden">
                  <Avatar nombre={`${c.nombres} ${c.apellidos}`} />
                  {c.puesto && <NivelChip nivel={c.puesto.nivel.nombre} />}
                  <span className="ml-auto rounded-full bg-hueso-2 px-2.5 py-0.5 text-[10.5px] font-bold text-gris">{c.pais.codigo}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 md:hidden">
                  <p className="text-[14.5px] font-bold leading-snug">{c.nombres} {c.apellidos}</p>
                  <span className="shrink-0 text-xl font-bold text-gris-claro">›</span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-gris md:hidden">{c.puesto?.nombre ?? 'Sin puesto'} · {c.area?.nombre ?? 'Sin área'}</p>

                {/* Escritorio */}
                <div className="hidden items-center gap-4 md:flex">
                  <Avatar nombre={`${c.nombres} ${c.apellidos}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">{c.nombres} {c.apellidos}</p>
                    <p className="text-xs text-gris">{c.puesto?.nombre ?? 'Sin puesto'} · {c.area?.nombre ?? 'Sin área'}</p>
                  </div>
                  {c.puesto && <NivelChip nivel={c.puesto.nivel.nombre} />}
                  <Chip>{c.pais.codigo}</Chip>
                  <Link href={`/equipo/${c.id}`} className="rounded-xl border border-gris-claro px-4 py-2 text-xs font-bold transition hover:bg-hueso">
                    Hoja de vida →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
