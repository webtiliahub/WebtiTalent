/**
 * Simula el avance del ciclo activo: responde las evaluaciones del seed con perfiles
 * realistas por persona, registra avances de objetivos y recalcula resultados.
 * Uso: npx tsx prisma/simular-ciclo.ts
 */
import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { calcularResultadosCiclo } from '../src/features/resultados/servicio'
import { exigirBaseLocal } from './_guarda'

exigirBaseLocal('simular-ciclo')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

// Perfil de desempeño por documento (base 1–5); la variación por pregunta es determinística
const PERFILES: Record<string, number> = {
  'PE · 40291855': 4.3, // Ana — destacada
  'PE · 45992011': 3.9, // Carlos — clave
  'PE · 44820199': 3.6, // Lucía — sólida
  'PE · 46110288': 2.9, // Diego — a reforzar
  'PE · 41122033': 4.1, // María
  'PE · 09182733': 4.2, // Marcos
}
const POTENCIAL: Record<string, number> = {
  'PE · 40291855': 4.4,
  'PE · 45992011': 3.4,
  'PE · 44820199': 3.5,
  'PE · 46110288': 2.8,
  'PE · 41122033': 4.2,
}

function valor(base: number, semilla: number): number {
  const v = Math.round(base + ((semilla % 3) - 1) * 0.7)
  return Math.max(1, Math.min(5, v))
}

async function main() {
  const ciclo = await prisma.ciclo.findFirstOrThrow({ where: { estado: 'ACTIVO' } })
  console.log(`🎬 Simulando ciclo: ${ciclo.nombre}`)

  const asignaciones = await prisma.asignacion.findMany({
    where: { cicloId: ciclo.id, estado: { not: 'ENVIADA' } },
    include: { evaluado: { include: { puesto: { include: { competencias: true } } } } },
  })
  const preguntasPot = await prisma.preguntaPotencial.findMany({ orderBy: { orden: 'asc' } })

  let respondidas = 0
  for (const a of asignaciones) {
    const puesto = a.evaluado.puesto
    if (!puesto) continue
    const compIds = puesto.competencias.map((c) => c.competenciaId)
    // Precedencia de alcance: excepción por puesto reemplaza al nivel; ascendente no filtra por competencias
    const tieneExcepcion = (await prisma.cicloPregunta.count({ where: { cicloId: ciclo.id, puestoId: puesto.id } })) > 0
    const alcance = tieneExcepcion ? { puestoId: puesto.id } : { nivelId: puesto.nivelId }
    if (a.tipo !== 'ASCENDENTE' && compIds.length === 0) continue
    const aplicables = await prisma.cicloPregunta.findMany({
      where: {
        cicloId: ciclo.id,
        modalidad: a.tipo,
        ...alcance,
        ...(a.tipo === 'ASCENDENTE' ? {} : { pregunta: { competenciaId: { in: compIds } } }),
      },
      include: { pregunta: { include: { competencia: { include: { dimension: true } } } } },
    })

    const base = PERFILES[a.evaluado.documento] ?? 3.5
    let i = 0
    for (const cp of aplicables) {
      await prisma.respuesta.upsert({
        where: { asignacionId_preguntaId: { asignacionId: a.id, preguntaId: cp.preguntaId } },
        create: { asignacionId: a.id, preguntaId: cp.preguntaId, valor: valor(base, i + a.id.length) },
        update: {},
      })
      i++
    }
    if (a.tipo === 'JEFE') {
      const basePot = POTENCIAL[a.evaluado.documento] ?? 3.3
      let j = 0
      for (const p of preguntasPot) {
        await prisma.respuestaPotencial.upsert({
          where: { asignacionId_preguntaId: { asignacionId: a.id, preguntaId: p.id } },
          create: { asignacionId: a.id, preguntaId: p.id, valor: valor(basePot, j + 1) },
          update: {},
        })
        j++
      }
    }
    await prisma.asignacion.update({ where: { id: a.id }, data: { estado: 'ENVIADA', enviadaEn: new Date() } })
    respondidas++
  }

  // Logros de objetivos individuales (confirmados por el jefe)
  // periodoId puede ser null desde que los ciclos sin objetivos existen; este script simula un ciclo CON período
  const objetivos = ciclo.periodoId
    ? await prisma.objetivo.findMany({ where: { periodoId: ciclo.periodoId, tipo: { not: 'TRANSVERSAL' }, estado: 'APROBADO' } })
    : []
  const LOGROS: Record<string, number> = { 'PE · 45992011': 92, 'PE · 44820199': 88, 'PE · 46110288': 78, 'PE · 40291855': 92, 'PE · 41122033': 95 }
  for (const o of objetivos) {
    if (!o.colaboradorId) continue
    const col = await prisma.colaborador.findUnique({ where: { id: o.colaboradorId } })
    const logro = LOGROS[col?.documento ?? ''] ?? 85
    await prisma.objetivoLogro.upsert({
      where: { objetivoId_colaboradorId: { objetivoId: o.id, colaboradorId: o.colaboradorId } },
      create: { objetivoId: o.id, colaboradorId: o.colaboradorId, logroFinal: logro, avanceColaborador: logro },
      update: { logroFinal: logro },
    })
  }

  const total = await calcularResultadosCiclo(ciclo.id)
  console.log(`✅ ${respondidas} evaluaciones enviadas · ${total} resultados calculados`)

  const resultados = await prisma.resultado.findMany({
    where: { cicloId: ciclo.id, notaFinal: { not: null } },
    include: { colaborador: true },
    orderBy: { notaFinal: 'desc' },
  })
  for (const r of resultados) {
    console.log(`  ${r.colaborador.nombres} ${r.colaborador.apellidos}: comp ${r.notaCompetencias?.toFixed(2)} · obj ${r.cumplimientoObjetivos?.toFixed(0)}% · final ${r.notaFinal?.toFixed(2)} · pot ${r.potencial?.toFixed(2) ?? '—'} · ${r.box ?? 'sin box'}`)
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
