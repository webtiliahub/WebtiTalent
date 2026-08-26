// Seed de roles del módulo de administración. Idempotente (upsert por nombre):
// se corre en local y en cada entorno al deployar este feature.
//   npx tsx prisma/seed-roles-admin.ts
import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'
import { SECCIONES_ADMIN } from '../src/shared/lib/permisos-admin'
import { PrismaPg } from '@prisma/adapter-pg'
import { exigirBaseLocal } from './_guarda'

exigirBaseLocal('seed-roles-admin')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

async function main() {
  const todoGestionar = Object.fromEntries(SECCIONES_ADMIN.map((s) => [s, 'GESTIONAR']))
  const todoVer = Object.fromEntries(SECCIONES_ADMIN.map((s) => [s, 'VER']))
  const roles = [
    { nombre: 'RR.HH.', descripcion: 'Rol de sistema: administración completa y poderes de proceso', esSistema: true, permisos: todoGestionar },
    { nombre: 'Auditor', descripcion: 'Observa toda la administración sin poder modificar nada', esSistema: false, permisos: todoVer },
    { nombre: 'Gerencial', descripcion: 'Revisa resultados/analítica y el directorio de colaboradores', esSistema: false, permisos: { RESULTADOS: 'VER', COLABORADORES: 'VER' } },
  ]
  for (const r of roles) {
    // Roles de sistema (RR.HH.) se fuerzan al estado canónico; roles editables (Auditor/Gerencial)
    // solo se crean una vez — en re-runs, el seed no pisa sus personalizaciones de permisos.
    await prisma.rolAdmin.upsert({
      where: { nombre: r.nombre },
      create: r,
      update: r.esSistema
        ? { descripcion: r.descripcion, esSistema: r.esSistema, permisos: r.permisos }
        : { esSistema: false }
    })
    console.log(`rol «${r.nombre}» ✓`)
  }
}

main().finally(() => prisma.$disconnect())
