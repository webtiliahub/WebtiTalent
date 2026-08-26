import { prisma } from '@/shared/lib/prisma'
import { etiquetaNota } from '@/domain/calculo'
import { configDelCiclo, objetivosAplicables, type DimensionResultado } from '@/features/resultados/servicio'
import { perfilDeEvaluado } from '@/features/ciclos/perfil-evaluado'

export type DatosInforme = {
  generadoEl: string
  colaborador: { nombre: string; puesto: string; nivel: string; areaPais: string; documento: string; jefe: string }
  // periodo null = ciclo sin objetivos (100% competencias); la sección de objetivos se omite
  ciclo: { nombre: string; ventana: string; periodo: string | null; combinacion: { comp: number; obj: number } }
  notas: {
    final: number | null
    etiqueta: string | null
    competencias: number | null
    objetivosPct: number | null
    notaObjetivos: number | null // objetivos llevados a escala 1–5
    calibrada: number | null
  }
  dimensiones: { nombre: string; pesoPct: number; nota: number; competencias: { nombre: string; nota: number }[] }[]
  objetivos: { titulo: string; tipo: string; peso: number; logro: number | null }[]
  radar: { nombre: string; valor: number | null; esperado: number }[]
  feedback: { fecha: string; acuerdos: string | null; pdi: { titulo: string; fechaObjetivo?: string }[] } | null
}

const fecha = (d: Date) => d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })

/** Reúne todo lo que el informe PDF necesita. Devuelve null si el colaborador no tiene
 * resultado PUBLICADO en el ciclo pedido (o en ninguno, sin parámetro). Los permisos de
 * QUIÉN puede pedirlo los valida el route handler; aquí solo rige la publicación. */
export async function datosInformePdf(colaboradorId: string, cicloParam?: string): Promise<DatosInforme | null> {
  const c = await prisma.colaborador.findUnique({
    where: { id: colaboradorId },
    include: {
      pais: true, area: true, jefe: true,
      puesto: { include: { nivel: true, pesos: { include: { dimension: true } } } },
    },
  })
  if (!c) return null

  const resultados = await prisma.resultado.findMany({
    where: {
      colaboradorId,
      ciclo: { OR: [{ publicado: true }, { cierresPais: { some: { paisId: c.paisId, publicado: true } } }] },
    },
    include: { ciclo: { include: { periodo: true } } },
    orderBy: { ciclo: { fechaInicio: 'desc' } },
  })
  const r = resultados.find((x) => x.cicloId === cicloParam) ?? (cicloParam ? undefined : resultados[0])
  if (!r) return null

  const sinObjetivos = r.ciclo.periodoId === null
  const configCiclo = await configDelCiclo(r.cicloId)
  // Perfil con el que se evaluó a esta persona en ESE ciclo (nivel y pesos por dimensión), no el
  // del puesto hoy: el informe de un ciclo cerrado tiene que salir igual dentro de dos años
  const perfil = await perfilDeEvaluado(r.cicloId, colaboradorId)
  const combinacion = sinObjetivos
    ? { comp: 100, obj: 0 }
    : (perfil.nivelId && configCiclo.combinacionPorNivel[perfil.nivelId]) || { comp: 50, obj: 50 }

  // Nota referencial por competencia: promedio de las respuestas que pesan en la nota (AUTO pesa 0)
  const pesosMod = configCiclo.pesosModalidades
  const asignaciones = await prisma.asignacion.findMany({
    where: { cicloId: r.cicloId, evaluadoId: colaboradorId, estado: 'ENVIADA' },
    include: { respuestas: { include: { pregunta: { include: { competencia: true } } } } },
  })
  const compPorDim = new Map<string, Map<string, { nombre: string; suma: number; n: number }>>()
  for (const a of asignaciones) {
    if ((pesosMod[a.tipo as keyof typeof pesosMod] ?? 0) === 0) continue
    for (const resp of a.respuestas) {
      if (!resp.pregunta.modalidades.includes(a.tipo)) continue // respuesta inerte (snapshot sucio)
      const dimId = resp.pregunta.competencia.dimensionId
      if (!compPorDim.has(dimId)) compPorDim.set(dimId, new Map())
      const porComp = compPorDim.get(dimId)!
      const acc = porComp.get(resp.pregunta.competenciaId) ?? { nombre: resp.pregunta.competencia.nombre, suma: 0, n: 0 }
      acc.suma += resp.valor
      acc.n += 1
      porComp.set(resp.pregunta.competenciaId, acc)
    }
  }
  const desglose = (r.desgloseDimJson as DimensionResultado[] | undefined) ?? []
  const dimensiones = desglose.map((d) => ({
    nombre: d.nombre,
    pesoPct: Math.round(d.pesoEfectivo * 100),
    nota: d.ajuste ?? d.nota,
    competencias: [...(compPorDim.get(d.dimensionId)?.values() ?? [])]
      .map((x) => ({ nombre: x.nombre, nota: x.suma / x.n }))
      .sort((a, b) => b.nota - a.nota),
  }))

  const { transversales, individuales } = sinObjetivos
    ? { transversales: [], individuales: [] }
    : await objetivosAplicables(r.ciclo.periodoId!, colaboradorId)
  const objetivos = [...transversales, ...individuales]
    .filter((o) => o.estado === 'APROBADO')
    .map((o) => ({
      titulo: o.titulo,
      tipo: o.tipo === 'TRANSVERSAL' ? 'Transversal' : o.tipo === 'DESARROLLO' ? 'Desarrollo' : 'Individual',
      peso: o.peso,
      logro: o.logros[0]?.logroFinal != null ? Math.min(o.logros[0].logroFinal, 100) : null,
    }))

  // Radar: perfil esperado vs obtenido, ordenado por peso (igual que en la web). Los nombres de
  // dimensión se resuelven aparte porque el snapshot guarda ids, no textos
  const obtenidoDe = new Map(desglose.map((d) => [d.dimensionId, d.ajuste ?? d.nota]))
  const nombreDim = new Map(
    (await prisma.dimension.findMany({
      where: { id: { in: perfil.pesos.map((x) => x.dimensionId) } },
      select: { id: true, nombre: true },
    })).map((d) => [d.id, d.nombre]),
  )
  const radar = perfil.pesos
    .slice()
    .sort((a, b) => b.peso - a.peso)
    .map((p) => ({ nombre: nombreDim.get(p.dimensionId) ?? '—', valor: obtenidoDe.get(p.dimensionId) ?? null, esperado: p.puntajeEsperado }))

  const feedback = await prisma.feedback.findFirst({ where: { cicloId: r.cicloId, colaboradorId } })
  const nota = r.notaCalibrada ?? r.notaFinal

  return {
    generadoEl: fecha(new Date()),
    colaborador: {
      nombre: `${c.nombres} ${c.apellidos}`,
      puesto: c.puesto ? `${c.puesto.nombre} · ${c.puesto.nivel.nombre}` : 'Sin puesto asignado',
      nivel: c.puesto?.nivel.nombre ?? '—',
      areaPais: `${c.area?.nombre ?? 'Sin área'} · ${c.pais.nombre}`,
      documento: c.documento,
      jefe: c.jefe ? `${c.jefe.nombres} ${c.jefe.apellidos}` : '—',
    },
    ciclo: {
      nombre: r.ciclo.nombre,
      ventana: `${fecha(r.ciclo.fechaInicio)} – ${fecha(r.ciclo.fechaFin)}`,
      periodo: r.ciclo.periodo?.nombre ?? null,
      combinacion,
    },
    notas: {
      final: nota,
      etiqueta: nota !== null ? etiquetaNota(nota) : null,
      competencias: r.notaCompetencias,
      objetivosPct: r.cumplimientoObjetivos !== null ? Math.round(r.cumplimientoObjetivos) : null,
      notaObjetivos: r.cumplimientoObjetivos !== null ? Math.min(r.cumplimientoObjetivos, 100) / 20 : null,
      calibrada: r.notaCalibrada !== null && r.notaCalibrada !== r.notaFinal ? r.notaCalibrada : null,
    },
    dimensiones,
    objetivos,
    radar,
    feedback: feedback
      ? {
          fecha: fecha(feedback.realizadaEn),
          acuerdos: feedback.acuerdos,
          pdi: Array.isArray(feedback.pdi) ? (feedback.pdi as { titulo: string; fechaObjetivo?: string }[]) : [],
        }
      : null,
  }
}
