import Link from 'next/link'
import { Download } from 'lucide-react'
import { prisma } from '@/shared/lib/prisma'
import { etiquetaNota } from '@/domain/calculo'
import { Card, Chip, Nota, Vacio } from '@/shared/ui/componentes'
import { RadarDimensiones, LeyendaRadar, colorDim } from '@/shared/ui/RadarDimensiones'
import { configDelCiclo, objetivosAplicables, type DimensionResultado } from '@/features/resultados/servicio'
import { badgeNota, cardNota } from '@/shared/ui/desempeno'
import type { Prisma } from '@/generated/prisma/client'
import { perfilDeEvaluado } from '@/features/ciclos/perfil-evaluado'

/** Botón de descarga del informe PDF, para el slot `accion` del Titulo de la página.
 * Se oculta si el colaborador no tiene resultado publicado (en el ciclo pedido o en ninguno). */
export async function BotonDescargarPdf({ colaboradorId, cicloId }: { colaboradorId: string; cicloId?: string }) {
  const yo = await prisma.colaborador.findUnique({ where: { id: colaboradorId }, select: { paisId: true } })
  if (!yo) return null
  const hay = await prisma.resultado.findFirst({
    where: {
      colaboradorId,
      ...(cicloId ? { cicloId } : {}),
      ciclo: { OR: [{ publicado: true }, { cierresPais: { some: { paisId: yo.paisId, publicado: true } } }] },
    },
    select: { id: true },
  })
  if (!hay) return null
  return (
    <a
      href={`/api/resultado-pdf?colaborador=${colaboradorId}${cicloId ? `&ciclo=${cicloId}` : ''}`}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-gris-claro bg-white px-3.5 py-2 text-xs font-bold text-negro transition hover:border-marca/40 hover:text-marca"
    >
      <Download size={13} /> Descargar PDF
    </a>
  )
}

type ResultadoConCiclo = Prisma.ResultadoGetPayload<{ include: { ciclo: true } }>

/** Detalle completo de un resultado: KPIs, desglose del cálculo y radar por dimensión.
 * Lo usan la vista publicada (ResultadoColaborador) y la VISTA PREVIA del ciclo activo
 * (`preview` ajusta las etiquetas: nota preliminar, sujeta a calibración). */
export async function DetalleResultado({ resultado, propio, preview = false }: {
  resultado: ResultadoConCiclo
  propio: boolean
  preview?: boolean
}) {
  const nota = resultado.notaCalibrada ?? resultado.notaFinal

  // Radar: obtenido por dimensión (del desglose del resultado) vs perfil esperado con el que se
  // evaluó a esta persona en ESTE ciclo — el congelado al lanzar, no el del puesto hoy: si no,
  // reperfilar un puesto cambiaría el resultado que ya vio (y aceptó) un colaborador
  const perfil = await perfilDeEvaluado(resultado.cicloId, resultado.colaboradorId)
  const desglose = (resultado.desgloseDimJson as DimensionResultado[] | undefined) ?? []
  const obtenidoDe = new Map(desglose.map((d) => [d.dimensionId, d.ajuste ?? d.nota]))
  // El snapshot guarda ids: los nombres de dimensión salen del catálogo (que no se renombra a
  // mitad de un ciclo; y si se renombrara, el nombre nuevo es el que la gente reconoce)
  const nombreDim = new Map(
    (await prisma.dimension.findMany({
      where: { id: { in: perfil.pesos.map((x) => x.dimensionId) } },
      select: { id: true, nombre: true },
    })).map((d) => [d.id, d.nombre]),
  )
  const dimsRadar = perfil.pesos
    .slice()
    .sort((a, b) => b.peso - a.peso)
    .map((p, i) => ({
      nombre: nombreDim.get(p.dimensionId) ?? '—',
      color: colorDim(i),
      valor: obtenidoDe.get(p.dimensionId) ?? null,
      esperado: p.puntajeEsperado,
    }))

  // Desglose del cálculo: dimensiones y objetivos con sus pesos, y la combinación del nivel.
  // Ciclo sin período (periodoId null) = no evalúa objetivos: nota 100% competencias, sin
  // consultar objetivosAplicables (recibiría null).
  const sinObjetivos = resultado.ciclo.periodoId === null
  const configCiclo = await configDelCiclo(resultado.cicloId)
  const combinacion = sinObjetivos
    ? { comp: 100, obj: 0 }
    : (perfil.nivelId && configCiclo.combinacionPorNivel[perfil.nivelId]) || { comp: 50, obj: 50 }
  const objetivosDetalle = sinObjetivos ? [] : [...await objetivosAplicables(resultado.ciclo.periodoId!, resultado.colaboradorId).then((o) => [...o.transversales, ...o.individuales])]
    .filter((o) => o.estado === 'APROBADO')
    .map((o) => ({
      id: o.id,
      titulo: o.titulo,
      tipo: o.tipo === 'TRANSVERSAL' ? 'Transversal' : o.tipo === 'DESARROLLO' ? 'Desarrollo' : 'Individual',
      peso: o.peso,
      logro: o.logros[0]?.logroFinal ?? null,
    }))
  const notaObjetivos = resultado.cumplimientoObjetivos != null ? Math.min(resultado.cumplimientoObjetivos, 100) / 20 : null

  // Nivel competencia: promedio de las respuestas del ciclo por competencia (referencial),
  // solo de las modalidades que pesan en la nota (la autoevaluación pesa 0)
  const pesosMod = configCiclo.pesosModalidades
  const asignacionesCiclo = await prisma.asignacion.findMany({
    where: { cicloId: resultado.cicloId, evaluadoId: resultado.colaboradorId, estado: 'ENVIADA' },
    include: { respuestas: { include: { pregunta: { include: { competencia: true } } } } },
  })
  const competenciasPorDim = new Map<string, Map<string, { nombre: string; suma: number; n: number }>>()
  for (const a of asignacionesCiclo) {
    if ((pesosMod[a.tipo as keyof typeof pesosMod] ?? 0) === 0) continue
    for (const r of a.respuestas) {
      if (!r.pregunta.modalidades.includes(a.tipo)) continue // respuesta inerte (snapshot sucio)
      const dimId = r.pregunta.competencia.dimensionId
      if (!competenciasPorDim.has(dimId)) competenciasPorDim.set(dimId, new Map())
      const porComp = competenciasPorDim.get(dimId)!
      const acc = porComp.get(r.pregunta.competenciaId) ?? { nombre: r.pregunta.competencia.nombre, suma: 0, n: 0 }
      acc.suma += r.valor
      acc.n += 1
      porComp.set(r.pregunta.competenciaId, acc)
    }
  }

  return (
    <>
      {/* Móvil: la nota final a lo ancho y los dos mini-KPIs lado a lado (apilados ocupaban
          una pantalla entera para dos números); escritorio: las 3 columnas de siempre */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-5">
        <Card className={`col-span-2 text-center md:col-span-1 ${nota !== null ? cardNota(nota) : ''}`}>
          <p className="text-[11px] font-bold uppercase tracking-wide text-gris">
            {preview ? 'Nota preliminar' : 'Nota final'} · {resultado.ciclo.nombre}
          </p>
          <p className="mt-2"><Nota valor={nota} grande /></p>
          {nota !== null && (
            <p className="mt-2">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${badgeNota(nota)}`}>{etiquetaNota(nota)}</span>
            </p>
          )}
        </Card>
        <Card className="text-center">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gris">Competencias</p>
          <p className="mt-2"><Nota valor={resultado.notaCompetencias} grande /></p>
          <p className="mt-2.5 text-xs text-gris">Evaluación 360: jefe, pares y ascendente, ponderada por dimensión.</p>
        </Card>
        <Card className="text-center">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gris">Objetivos</p>
          {sinObjetivos ? (
            <p className="mt-2.5 text-sm text-gris">Sin objetivos en este ciclo</p>
          ) : (
            <>
              <p className="mt-2 font-display text-3xl font-extrabold text-marca">
                {resultado.cumplimientoObjetivos === null ? '—' : `${Math.round(resultado.cumplimientoObjetivos)}%`}
              </p>
              <p className="mt-2.5 text-xs text-gris">Cumplimiento ponderado de {propio ? 'tus objetivos' : 'sus objetivos'} del ciclo.</p>
            </>
          )}
        </Card>
      </div>
      {/* Desglose del cálculo: las dos piezas de la nota, con sus pesos */}
      {(desglose.length > 0 || objetivosDetalle.length > 0) && (
        <Card titulo={propio ? 'Cómo se calcula tu nota final' : 'Cómo se calcula la nota final'} extra={sinObjetivos ? '100% competencias' : `competencias ${combinacion.comp}% + objetivos ${combinacion.obj}%`}>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-gris">
                Competencias <span className="font-semibold normal-case tracking-normal text-gris/70">· {combinacion.comp}% de la nota final</span>
              </p>
              {desglose.length === 0 ? (
                <p className="text-xs text-gris">Sin respuestas de competencias en este ciclo.</p>
              ) : (
                <div className="text-sm">
                  <div className="flex border-b border-gris-claro pb-1.5 text-[10px] font-bold uppercase tracking-wide text-gris">
                    <span className="flex-1">Dimensión</span>
                    <span className="w-14 text-right">Peso</span>
                    <span className="w-14 text-right">Nota</span>
                  </div>
                  {desglose.map((d) => {
                    const comps = [...(competenciasPorDim.get(d.dimensionId)?.values() ?? [])].sort((a, b) => b.suma / b.n - a.suma / a.n)
                    return (
                      <details key={d.dimensionId} className="group border-b border-hueso-2">
                        <summary className="flex cursor-pointer list-none items-center py-2 transition hover:bg-hueso/60 [&::-webkit-details-marker]:hidden">
                          <span className="flex flex-1 items-center gap-1.5 font-semibold">
                            <span className="text-xs text-gris transition group-open:rotate-90">›</span>
                            {d.nombre}
                          </span>
                          <span className="w-14 text-right text-xs text-gris">{Math.round(d.pesoEfectivo * 100)}%</span>
                          <span className="w-14 text-right font-bold">{(d.ajuste ?? d.nota).toFixed(2)}</span>
                        </summary>
                        <ul className="mb-2 ml-4 space-y-1 rounded-lg bg-hueso px-3 py-2">
                          {comps.length === 0 ? (
                            <li className="text-xs text-gris">Sin detalle por competencia.</li>
                          ) : comps.map((cp) => (
                            <li key={cp.nombre} className="flex items-baseline justify-between gap-3 text-xs">
                              <span>{cp.nombre}</span>
                              <b>{(cp.suma / cp.n).toFixed(2)}</b>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )
                  })}
                  <div className="flex items-center py-2">
                    <span className="flex-1 text-[13px] font-bold">Nota de competencias</span>
                    <span className="text-right font-display text-base font-extrabold text-marca">{resultado.notaCompetencias?.toFixed(2) ?? '—'}</span>
                  </div>
                </div>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-gris">
                Objetivos {!sinObjetivos && <span className="font-semibold normal-case tracking-normal text-gris/70">· {combinacion.obj}% de la nota final</span>}
              </p>
              {sinObjetivos ? (
                <p className="text-xs text-gris">Sin objetivos en este ciclo</p>
              ) : objetivosDetalle.length === 0 ? (
                <p className="text-xs text-gris">Sin objetivos configurados en este período.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gris-claro text-left text-[10px] font-bold uppercase tracking-wide text-gris">
                      <th className="py-1.5 pr-3">Objetivo</th>
                      <th className="py-1.5 pr-3 text-right">Peso</th>
                      <th className="py-1.5 text-right">Logro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {objetivosDetalle.map((o) => (
                      <tr key={o.id} className="border-b border-hueso-2">
                        <td className="py-2 pr-3">
                          <p className="font-semibold">{o.titulo}</p>
                          <p className="text-[11px] text-gris">{o.tipo}</p>
                        </td>
                        <td className="py-2 pr-3 text-right text-xs text-gris">{o.peso}%</td>
                        <td className="py-2 text-right font-bold">{o.logro === null ? '—' : `${Math.min(o.logro, 100)}%`}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-2 pr-3 text-[13px] font-bold" colSpan={2}>Cumplimiento ponderado</td>
                      <td className="py-2 text-right font-display text-base font-extrabold text-marca">
                        {resultado.cumplimientoObjetivos === null ? '—' : `${Math.round(resultado.cumplimientoObjetivos)}%`}
                        {notaObjetivos !== null && <span className="ml-1 text-xs font-semibold text-gris">({notaObjetivos.toFixed(2)}/5)</span>}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
          {sinObjetivos && resultado.notaFinal !== null && resultado.notaCompetencias !== null && (
            <p className="mt-4 rounded-xl bg-hueso-2 px-4 py-3 text-center text-sm">
              {resultado.notaCompetencias.toFixed(2)} × 100% <span className="text-gris">(competencias)</span> = <b className="font-display text-base text-marca">{resultado.notaFinal.toFixed(2)}</b>
              {resultado.notaCalibrada !== null && resultado.notaCalibrada !== resultado.notaFinal && (
                <span className="ml-2 text-xs text-gris">· ajustada por calibración a <b className="text-negro">{resultado.notaCalibrada.toFixed(2)}</b></span>
              )}
            </p>
          )}
          {!sinObjetivos && resultado.notaFinal !== null && resultado.notaCompetencias !== null && notaObjetivos !== null && (
            <p className="mt-4 rounded-xl bg-hueso-2 px-4 py-3 text-center text-sm">
              {resultado.notaCompetencias.toFixed(2)} × {combinacion.comp}% <span className="text-gris">(competencias)</span> + {notaObjetivos.toFixed(2)} × {combinacion.obj}% <span className="text-gris">(objetivos)</span> = <b className="font-display text-base text-marca">{resultado.notaFinal.toFixed(2)}</b>
              {resultado.notaCalibrada !== null && resultado.notaCalibrada !== resultado.notaFinal && (
                <span className="ml-2 text-xs text-gris">· ajustada por calibración a <b className="text-negro">{resultado.notaCalibrada.toFixed(2)}</b></span>
              )}
            </p>
          )}
        </Card>
      )}

      {dimsRadar.length >= 3 && desglose.length > 0 && (
        <Card titulo={propio ? 'Tu resultado por dimensión' : 'Resultado por dimensión'} extra={propio ? 'lo obtenido en la evaluación 360 vs el perfil esperado de tu puesto' : 'lo obtenido en la evaluación 360 vs el perfil esperado del puesto'}>
          <RadarDimensiones
            dims={dimsRadar}
            ariaLabel="Resultado por dimensión: obtenido vs esperado del puesto"
          />
          <LeyendaRadar etiquetaObtenido={`Obtenido · ${resultado.ciclo.nombre}`} />
        </Card>
      )}
    </>
  )
}

/** Detalle del resultado publicado de un colaborador en un ciclo (nota, desglose del cálculo,
 * radar por dimensión, feedback/PDI e histórico). Lo usa «Mi resultado» (propio=true) y la
 * consulta del jefe/RR.HH. desde la hoja de vida (propio=false, textos en tercera persona).
 * Los PERMISOS los valida la página que lo monta. */
export async function ResultadoColaborador({ colaboradorId, cicloParam, hrefBase, propio, soloHistorial = false }: {
  colaboradorId: string
  cicloParam?: string
  hrefBase: string // ruta propia para navegar el histórico (?ciclo=)
  propio: boolean
  // Con la VISTA PREVIA del ciclo en curso activa, lo publicado se colapsa a la lista de
  // «Otros ciclos» (la nueva calificación es la que está entrando a ser la vigente)
  soloHistorial?: boolean
}) {
  const conCiclo = (cicloId: string) => `${hrefBase}${hrefBase.includes('?') ? '&' : '?'}ciclo=${cicloId}`
  // Visible si el ciclo publicó globalmente O si publicó el país del colaborador (cierre por país)
  const yo = await prisma.colaborador.findUniqueOrThrow({ where: { id: colaboradorId }, select: { paisId: true } })
  const resultados = await prisma.resultado.findMany({
    where: {
      colaboradorId: colaboradorId,
      ciclo: { OR: [{ publicado: true }, { cierresPais: { some: { paisId: yo.paisId, publicado: true } } }] },
    },
    include: { ciclo: true },
    orderBy: { ciclo: { fechaInicio: 'desc' } },
  })
  const feedbacks = await prisma.feedback.findMany({
    where: { colaboradorId: colaboradorId },
    include: { ciclo: true },
    orderBy: { realizadaEn: 'desc' },
  })

  // ?ciclo=<id> permite revisar un ciclo anterior (histórico); sin parámetro, el más reciente
  const ultimo = resultados.find((r) => r.cicloId === cicloParam) ?? resultados[0]
  const esHistorico = Boolean(ultimo) && ultimo.id !== resultados[0].id

  // Con el preview activo, lo publicado no compite con la nota que está entrando:
  // solo la lista de ciclos anteriores, cada uno navegable a su detalle completo
  if (soloHistorial) {
    if (resultados.length === 0) return null
    return (
      <Card titulo="Otros ciclos" extra="resultados publicados de ciclos anteriores">
        <ul className="space-y-2">
          {resultados.map((r) => (
            <li key={r.id}>
              <Link href={conCiclo(r.cicloId)} className="group flex items-center justify-between rounded-xl bg-hueso px-4 py-2.5 text-sm transition hover:bg-hueso-2">
                <span>{r.ciclo.nombre}</span>
                <span className="flex items-center gap-3">
                  <Nota valor={r.notaCalibrada ?? r.notaFinal} />
                  <span className="text-gris transition group-hover:translate-x-0.5 group-hover:text-negro">→</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    )
  }

  return (
    <>
      {!ultimo ? (
        <Vacio>{propio
          ? 'Aún no hay resultados publicados. Cuando RR.HH. cierre y publique el ciclo, los verás aquí.'
          : 'Sin resultados publicados todavía para este colaborador.'}</Vacio>
      ) : (
        <div className="space-y-5">
          {esHistorico && (
            <div className="rounded-xl bg-hueso-2 px-4 py-2.5 text-sm">
              <p>Estás viendo el histórico de <b>{ultimo.ciclo.nombre}</b>.</p>
              {/* En línea propia: inline se partía a mitad del enlace en móvil */}
              <Link href={hrefBase} className="mt-0.5 inline-block whitespace-nowrap font-bold text-marca hover:underline">Volver al más reciente →</Link>
            </div>
          )}
          <DetalleResultado resultado={ultimo} propio={propio} />

          <Card titulo="Sesión de feedback y acuerdos">
            {feedbacks.length === 0 ? (
              <Vacio>{propio ? 'Tu jefe aún no registra la sesión de feedback de este ciclo.' : 'Su jefe aún no registra la sesión de feedback.'}</Vacio>
            ) : (
              <ul className="space-y-3">
                {feedbacks.map((f) => (
                  <li key={f.id} className="rounded-xl border border-gris-claro p-4">
                    <div className="mb-1.5 flex items-center justify-between">
                      <b className="text-sm">{f.ciclo.nombre}</b>
                      <Chip tono="ok">Registrada · {f.realizadaEn.toLocaleDateString('es-PE')}</Chip>
                    </div>
                    {f.acuerdos
                      ? <p className="whitespace-pre-wrap text-sm">{f.acuerdos}</p>
                      : <p className="text-sm text-gris">Sin acuerdos registrados.</p>}
                    {Array.isArray(f.pdi) && (f.pdi as { titulo?: string; fechaObjetivo?: string }[]).length > 0 && (
                      <div className="mt-3 border-t border-gris-claro pt-3">
                        <p className="mb-1.5 text-[11px] font-bold uppercase text-gris">Plan de desarrollo individual</p>
                        <ul className="space-y-1 text-sm">
                          {(f.pdi as { titulo?: string; fechaObjetivo?: string }[]).map((a, i) => (
                            <li key={i} className="flex justify-between rounded-lg bg-hueso px-3 py-1.5">
                              <span>{a.titulo}</span>
                              {a.fechaObjetivo && <span className="text-xs text-gris">{a.fechaObjetivo}</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {resultados.length > 1 && (
            <Card titulo="Otros ciclos">
              <ul className="space-y-2">
                {resultados.filter((r) => r.id !== ultimo.id).map((r) => (
                  <li key={r.id}>
                    <Link href={conCiclo(r.cicloId)} className="group flex items-center justify-between rounded-xl bg-hueso px-4 py-2.5 text-sm transition hover:bg-hueso-2">
                      <span>{r.ciclo.nombre}</span>
                      <span className="flex items-center gap-3">
                        <Nota valor={r.notaCalibrada ?? r.notaFinal} />
                        <span className="text-gris transition group-hover:translate-x-0.5 group-hover:text-negro">→</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </>
  )
}
