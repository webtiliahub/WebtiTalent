import { Lock } from 'lucide-react'
import { cookies } from 'next/headers'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin, alcancePaisWhere } from '@/shared/lib/permisos'
import { Avatar, Card, Nota, Titulo, Vacio, thCls, tdCls } from '@/shared/ui/componentes'
import { SwitcherResultados } from '@/features/resultados/AnalisisUI'
import { FiltrosResultados } from '@/features/resultados/FiltrosResultados'

const TONO_CUADRANTE: Record<string, string> = {
  Estrella: 'bg-emerald-50 border-emerald-200', Crecimiento: 'bg-emerald-50/60 border-emerald-100', Enigma: 'bg-amber-50 border-amber-200',
  'Alto desempeño': 'bg-emerald-50/60 border-emerald-100', 'Colaborador clave': 'bg-amber-50/60 border-amber-100', 'En riesgo': 'bg-red-50 border-red-200',
  Sólido: 'bg-amber-50/60 border-amber-100', Eficaz: 'bg-red-50/60 border-red-100', 'Bajo desempeño': 'bg-red-50 border-red-200',
}

export default async function Resultados9BoxPage({ searchParams }: {
  searchParams: Promise<{ ciclo?: string; areas?: string; cuadrante?: string }>
}) {
  const sesion = await requiereAdmin('RESULTADOS', 'VER')
  const { ciclo: cicloParam, areas: areasParam, cuadrante } = await searchParams
  const jar = await cookies()

  const ciclos = await prisma.ciclo.findMany({ where: { estado: { in: ['ACTIVO', 'CERRADO'] } }, orderBy: { fechaInicio: 'desc' } })
  const ciclo = ciclos.find((c) => c.id === cicloParam) ?? ciclos[0]
  if (!ciclo) return (<><Titulo>Resultados</Titulo><SwitcherResultados activo="9box" /><Vacio>No hay ciclos con resultados.</Vacio></>)

  const areasSel = (areasParam ?? '').split(',').filter(Boolean)
  const wherePais = alcancePaisWhere(sesion, jar.get('pais')?.value ?? null)

  const resultados = await prisma.resultado.findMany({
    where: {
      cicloId: ciclo.id,
      box: { not: null },
      colaborador: { ...wherePais, ...(areasSel.length > 0 ? { areaId: { in: areasSel } } : {}) },
    },
    include: { colaborador: { include: { puesto: true, area: true, pais: true } } },
  })
  const areas = await prisma.area.findMany({ orderBy: { nombre: 'asc' } })

  const porCuadrante = new Map<string, typeof resultados>()
  for (const r of resultados) {
    if (!porCuadrante.has(r.box!)) porCuadrante.set(r.box!, [])
    porCuadrante.get(r.box!)!.push(r)
  }
  const seleccion = cuadrante ? resultados.filter((r) => r.box === cuadrante) : []

  const filtrosBase = `ciclo=${ciclo.id}${areasSel.length ? `&areas=${areasSel.join(',')}` : ''}`

  return (
    <>
      <Titulo sub={`${ciclo.nombre} · ${resultados.length} colaboradores con resultado · acceso exclusivo RR.HH. y Dirección`}>
        Resultados
      </Titulo>
      <SwitcherResultados activo="9box" query={`?ciclo=${ciclo.id}`} />

      <FiltrosResultados
        ciclos={ciclos.map((c) => ({ id: c.id, nombre: c.nombre }))}
        areas={areas.map((a) => ({ id: a.id, nombre: a.nombre }))}
        cicloSel={ciclo.id}
        areasSel={areasSel}
      />

      {/* Matriz */}
      <Card titulo="Matriz 9-Box" extra="toca un cuadrante para ver quiénes están">
        {/* Móvil: los ejes en horizontal arriba (el rótulo rotado se comía 32 px de 364) */}
        <div className="mb-2 flex items-center justify-between md:hidden">
          <span className="text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-gris">↑ Potencial</span>
          <span className="text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-gris">Desempeño →</span>
        </div>
        <div className="flex gap-3">
          <div className="hidden w-8 shrink-0 items-center justify-center md:flex">
            <span className="-rotate-90 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.2em] text-gris">Potencial ↑</span>
          </div>
          <div className="grid flex-1 grid-cols-3 gap-2 md:gap-2.5">
            {[['Enigma', 'Crecimiento', 'Estrella'], ['En riesgo', 'Colaborador clave', 'Alto desempeño'], ['Bajo desempeño', 'Eficaz', 'Sólido']].flat().map((nombre) => {
              const lista = porCuadrante.get(nombre) ?? []
              const pct = resultados.length > 0 ? Math.round((lista.length / resultados.length) * 100) : 0
              return (
                <a
                  key={nombre}
                  href={`?${filtrosBase}&cuadrante=${encodeURIComponent(nombre)}`}
                  // Móvil: cuadrado con la cifra al centro. `border` sin color propio hereda el
                  // pastel de TONO_CUADRANTE (no usar el atajo con color: lo pisaría).
                  className={`flex aspect-square flex-col rounded-xl border p-2 transition hover:shadow-md md:aspect-auto md:min-h-24 md:block md:p-3 ${TONO_CUADRANTE[nombre]} ${cuadrante === nombre ? 'ring-2 ring-marca' : ''}`}
                >
                  {/* Alto fijo de dos líneas: los nueve números quedan alineados en su reja */}
                  <p className="line-clamp-2 h-[2.3em] text-[10.5px] font-bold leading-tight md:h-auto md:text-xs">{nombre}</p>
                  <span className="grid flex-1 place-content-center text-center md:mt-2 md:block md:text-left">
                    <span className="block font-display text-3xl font-extrabold leading-none md:text-2xl">{lista.length}</span>
                    <span className="mt-1 block text-[15px] leading-none text-gris md:mt-0 md:text-[10px]">{pct}%</span>
                  </span>
                </a>
              )
            })}
          </div>
        </div>
        <p className="mt-3 hidden text-center text-[10px] font-bold uppercase tracking-[0.2em] text-gris md:block">Desempeño →</p>

        {/* Móvil: la lectura de la matriz, plegada (empujaba el detalle del cuadrante fuera de
            pantalla); escritorio: la nota de los ejes como siempre */}
        <details className="group/ley mt-3 md:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-dashed border-gris-claro bg-hueso px-3 py-2.5 text-xs font-bold text-gris [&::-webkit-details-marker]:hidden">
            <span className="transition group-open/ley:rotate-90">›</span>
            Cómo leer la matriz
          </summary>
          <div className="mt-1.5 flex flex-col gap-1.5 text-[11.5px]">
            <p className="rounded-lg bg-emerald-50 px-2.5 py-1.5"><b>Talento a potenciar</b> — sucesión y desarrollo.</p>
            <p className="rounded-lg bg-amber-50 px-2.5 py-1.5"><b>Sólidos / clave</b> — fidelizar.</p>
            <p className="rounded-lg bg-red-50 px-2.5 py-1.5"><b>Zona de atención</b> — plan de acción.</p>
            <p className="text-[11px] text-gris">Eje X = desempeño (competencias + objetivos, calibrado) · Eje Y = potencial (5 preguntas del jefe).</p>
          </div>
        </details>
        <p className="mt-2 hidden text-xs text-gris md:block">Eje X = desempeño (competencias + objetivos, calibrado). Eje Y = potencial (5 preguntas del jefe).</p>
      </Card>

      {/* Detalle del cuadrante */}
      {cuadrante && (
        <Card titulo={<span>Colaboradores · <span className="text-marca">{cuadrante}</span></span>} extra={`${seleccion.length} en el cuadrante`} className="mt-5">
          {seleccion.length === 0 ? (
            <Vacio>No hay colaboradores en este cuadrante con los filtros aplicados.</Vacio>
          ) : (
            <>
            {/* Móvil: tarjeta por colaborador, con desempeño y potencial —las dos coordenadas
                que lo ubican en la matriz— como par de cifras a la derecha */}
            <ul className="flex flex-col gap-2 md:hidden">
              {seleccion
                .slice()
                .sort((a, b) => (b.notaCalibrada ?? b.notaFinal ?? 0) - (a.notaCalibrada ?? a.notaFinal ?? 0))
                .map((r) => (
                  <li key={r.id} className="flex items-start gap-2.5 rounded-xl border border-gris-claro px-3 py-2.5">
                    <Avatar nombre={`${r.colaborador.nombres} ${r.colaborador.apellidos}`} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-bold leading-tight">{r.colaborador.nombres} {r.colaborador.apellidos}</p>
                      <p className="text-[11px] text-gris">
                        {r.colaborador.puesto?.nombre ?? '—'} · {r.colaborador.area?.nombre ?? '—'} · {r.colaborador.pais.codigo}
                      </p>
                    </div>
                    {/* Centradas en vertical: con el puesto y el área en tres líneas, el par
                        de cifras quedaba pegado al borde de arriba */}
                    <div className="flex shrink-0 gap-3 self-center text-right">
                      <p className="leading-none">
                        <span className="font-display text-[15px] font-extrabold text-marca">{(r.notaCalibrada ?? r.notaFinal)?.toFixed(1) ?? '—'}</span>
                        <span className="mt-0.5 block text-[8.5px] font-bold uppercase tracking-wide text-gris">desem.</span>
                      </p>
                      <p className="leading-none">
                        <span className="font-display text-[15px] font-extrabold">{r.potencial?.toFixed(1) ?? '—'}</span>
                        <span className="mt-0.5 block text-[8.5px] font-bold uppercase tracking-wide text-gris">potenc.</span>
                      </p>
                    </div>
                  </li>
                ))}
            </ul>

            {/* Escritorio: la tabla de siempre */}
            <div className="-m-5 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[680px]">
                <thead><tr>
                  <th className={thCls}>Colaborador</th>
                  <th className={thCls}>Puesto</th>
                  <th className={thCls}>Área</th>
                  <th className={thCls}>País</th>
                  <th className={thCls}>Desempeño</th>
                  <th className={thCls}>Potencial</th>
                </tr></thead>
                <tbody>
                  {seleccion.sort((a, b) => (b.notaCalibrada ?? b.notaFinal ?? 0) - (a.notaCalibrada ?? a.notaFinal ?? 0)).map((r) => (
                    <tr key={r.id} className="hover:bg-hueso/60">
                      <td className={tdCls}><b>{r.colaborador.nombres} {r.colaborador.apellidos}</b></td>
                      <td className={tdCls}>{r.colaborador.puesto?.nombre ?? '—'}</td>
                      <td className={tdCls}>{r.colaborador.area?.nombre ?? '—'}</td>
                      <td className={tdCls}>{r.colaborador.pais.codigo}</td>
                      <td className={tdCls}><Nota valor={r.notaCalibrada ?? r.notaFinal} /></td>
                      <td className={tdCls}><Nota valor={r.potencial} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </Card>
      )}

      {/* Lectura */}
      <div className="mt-5 hidden gap-3 text-xs md:grid md:grid-cols-3">
        <p className="rounded-xl bg-emerald-50 px-4 py-2.5"><b>Talento a potenciar</b> — sucesión y desarrollo.</p>
        <p className="rounded-xl bg-amber-50 px-4 py-2.5"><b>Sólidos / clave</b> — fidelizar.</p>
        <p className="rounded-xl bg-red-50 px-4 py-2.5"><b>Zona de atención</b> — plan de acción.</p>
      </div>
      <p className="mt-3 text-xs text-gris"><Lock size={12} className="mr-1 inline -translate-y-px" />El ajuste de notas (calibración auditada) se realiza en Ciclos › Calibración. Aquí se lee el resultado ya calibrado.</p>
    </>
  )
}
