/**
 * Seed LIMPIO — instalación nueva de WebtiTalent (Webtilia).
 * Solo lo imprescindible para entrar: países y la usuaria de RR.HH. regional.
 * Sin áreas, puestos, competencias, colaboradores, preguntas ni ciclos:
 * todo eso debe poder crearse desde la interfaz (revisión "input first").
 */
import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'
import { exigirBaseLocal } from './_guarda'

exigirBaseLocal('seed-limpio')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

const PASSWORD_DEMO = 'WebtiTalent2026!'

async function main() {
  console.log('🌱 Seed LIMPIO WebtiTalent — instalación nueva')
  const hash = await bcrypt.hash(PASSWORD_DEMO, 10)

  // Niveles jerárquicos del manual (catálogo base, editable en Configuración)
  await Promise.all([
    prisma.nivelJerarquico.create({ data: { nombre: 'Gerencial', orden: 0, compPct: 50 } }),
    prisma.nivelJerarquico.create({ data: { nombre: 'Mando Medio', orden: 1, compPct: 60 } }),
    prisma.nivelJerarquico.create({ data: { nombre: 'Especialista', orden: 2, compPct: 50 } }),
    prisma.nivelJerarquico.create({ data: { nombre: 'Apoyo', orden: 3, compPct: 70 } }),
  ])

  const pe = await prisma.pais.create({ data: { codigo: 'PE', nombre: 'Perú' } })

  const admin = await prisma.colaborador.create({
    data: {
      nombres: 'Christian',
      apellidos: 'Calmet',
      documento: 'PE · 00000000',
      paisId: pe.id,
    },
  })
  await prisma.usuario.create({
    data: {
      email: 'ccalmet@webtilia.com',
      passwordHash: hash,
      rol: 'RRHH',
      alcanceRrhh: 'REGIONAL',
      colaboradorId: admin.id,
    },
  })

  // Preguntas de potencial (5, solo las responde el jefe → eje Y del 9-Box)
  const potTextos = [
    'Tiene capacidad para asumir responsabilidades de mayor alcance en 1–2 años.',
    'Aprende con rapidez y aplica lo aprendido a nuevos contextos.',
    'Muestra interés y aspiración de crecer dentro de la organización.',
    'Influye positivamente y moviliza a otros más allá de su rol.',
    'Mantiene el desempeño bajo presión y ante el cambio.',
  ]
  for (let i = 0; i < potTextos.length; i++) {
    await prisma.preguntaPotencial.create({ data: { texto: potTextos[i], orden: i + 1 } })
  }

  console.log(`🔑 ccalmet@webtilia.com / ${PASSWORD_DEMO} (RRHH regional, sin puesto ni área)`)
}

main().finally(() => prisma.$disconnect())
