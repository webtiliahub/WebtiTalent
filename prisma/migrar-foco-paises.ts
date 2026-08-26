// One-shot idempotente: puebla focoPaisIds desde el paisId legado.
// Uso: DATABASE_URL=... npx tsx prisma/migrar-foco-paises.ts
// (los ciclos existentes ya cumplen la invariante paisId ≡ foco de 1 país)
import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { exigirBaseLocal } from './_guarda'

exigirBaseLocal('migrar-foco-paises')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

async function main() {
  const ciclos = await prisma.ciclo.findMany({
    where: { paisId: { not: null } },
    select: { id: true, nombre: true, paisId: true, focoPaisIds: true },
  })
  let actualizados = 0
  for (const c of ciclos) {
    if (c.focoPaisIds.length > 0) continue // ya migrado
    await prisma.ciclo.update({ where: { id: c.id }, data: { focoPaisIds: [c.paisId!] } })
    actualizados += 1
    console.log(`ciclo «${c.nombre}» → focoPaisIds=[${c.paisId}]`)
  }
  console.log(`${actualizados} ciclo(s) migrado(s), ${ciclos.length - actualizados} ya estaban`)
}

main().finally(() => prisma.$disconnect())
