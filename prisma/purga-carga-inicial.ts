// Purga para la carga inicial: borra DATOS DE PERSONAS Y PROCESO, conserva estructura y cuentas.
// Doble seguro: exige CONFIRMAR_PURGA=SI y muestra la BD objetivo antes de tocar nada.
// Uso: DATABASE_URL=... CONFIRMAR_PURGA=SI npx tsx prisma/purga-carga-inicial.ts
//
// Orden respetando FKs (lo que no cascadea desde Ciclo/PeriodoObjetivos se borra explícito):
//   1. Ciclo.deleteMany() — cascade: CicloEvaluacion, CicloPregunta, CicloPreguntaPotencial,
//      Asignacion (+ Respuesta, RespuestaPotencial), Resultado (+ Calibracion), Feedback,
//      CicloPaisCierre. Debe correr ANTES de PeriodoObjetivos: Ciclo.periodoId es FK requerida
//      sin onDelete (RESTRICT) — un período con ciclos vivos no se puede borrar.
//   2. PeriodoObjetivos.deleteMany() — cascade: Objetivo (+ ObjetivoLogro), ExtensionPlazoObjetivos.
//   3. Usuario.updateMany({ colaboradorId: null }) — desvincular ANTES de borrar colaboradores:
//      Usuario.colaboradorId es FK única sin onDelete (RESTRICT). Las CUENTAS se conservan.
//   4. Colaborador.deleteMany() — incluye la autorreferencia jefeId: al ser un único DELETE de
//      TODAS las filas, Postgres solo verifica la FK al final del statement (tabla ya vacía), así
//      que la jerarquía completa se borra sin necesidad de ordenar por profundidad.
//
// CONSERVA: Usuario, RolAdmin, Evaluacion + banco de preguntas (Pregunta, PreguntaPotencial),
// Dimension, Competencia, NivelJerarquico, Pais, Area, Puesto (+ pesos/competencias), Config,
// AuditLog, RateLimit.
import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// host:puerto/basededatos, sin credenciales (todo lo anterior al primer "@" se descarta) ni
// parámetros de conexión (todo lo posterior al "?" se descarta) — lo que importa ver antes de
// confirmar es CUÁL base de datos, no solo el host.
const dbObjetivo = process.env.DATABASE_URL?.split('@')[1]?.split('?')[0] ?? '(desconocida)'

// Seguro 1: exige la variable explícita.
if (process.env.CONFIRMAR_PURGA !== 'SI') {
  console.log('Seguro activado: define CONFIRMAR_PURGA=SI para ejecutar. BD objetivo:', dbObjetivo)
  process.exit(1)
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

async function conteos() {
  const [colaboradores, ciclos, periodos, objetivos, usuarios, usuariosConColaborador, puestos, preguntas, niveles, config, rolesAdmin, auditLogs] =
    await Promise.all([
      prisma.colaborador.count(),
      prisma.ciclo.count(),
      prisma.periodoObjetivos.count(),
      prisma.objetivo.count(),
      prisma.usuario.count(),
      prisma.usuario.count({ where: { colaboradorId: { not: null } } }),
      prisma.puesto.count(),
      prisma.pregunta.count(),
      prisma.nivelJerarquico.count(),
      prisma.config.count(),
      prisma.rolAdmin.count(),
      prisma.auditLog.count(),
    ])
  return { colaboradores, ciclos, periodos, objetivos, usuarios, usuariosConColaborador, puestos, preguntas, niveles, config, rolesAdmin, auditLogs }
}

async function main() {
  console.log('═══ PURGA DE CARGA INICIAL ═══')
  console.log('BD objetivo:', dbObjetivo)

  const antes = await conteos()
  console.log('\nConteos ANTES:', antes)

  const ciclosBorrados = await prisma.ciclo.deleteMany()
  console.log(`\nCiclo: ${ciclosBorrados.count} borrados (cascade: asignaciones, respuestas, resultados, calibraciones, feedbacks, cierres por país, snapshots de preguntas)`)

  const periodosBorrados = await prisma.periodoObjetivos.deleteMany()
  console.log(`PeriodoObjetivos: ${periodosBorrados.count} borrados (cascade: objetivos, logros, extensiones de plazo)`)

  const cuentasDesvinculadas = await prisma.usuario.updateMany({
    where: { colaboradorId: { not: null } },
    data: { colaboradorId: null },
  })
  console.log(`Usuario: ${cuentasDesvinculadas.count} cuenta(s) desvinculada(s) (colaboradorId → null; las cuentas se CONSERVAN)`)

  const colaboradoresBorrados = await prisma.colaborador.deleteMany()
  console.log(`Colaborador: ${colaboradoresBorrados.count} borrados`)

  const despues = await conteos()
  console.log('\nConteos DESPUÉS:', despues)

  let ok = true
  if (despues.colaboradores !== 0) { console.error('⚠ Quedan colaboradores sin borrar.'); ok = false }
  if (despues.ciclos !== 0) { console.error('⚠ Quedan ciclos sin borrar.'); ok = false }
  if (despues.periodos !== 0) { console.error('⚠ Quedan períodos de objetivos sin borrar.'); ok = false }
  if (despues.objetivos !== 0) { console.error('⚠ Quedan objetivos sin borrar.'); ok = false }
  if (despues.usuariosConColaborador !== 0) { console.error('⚠ Quedan cuentas con colaboradorId no nulo.'); ok = false }
  if (despues.usuarios !== antes.usuarios) { console.error('⚠ El número de cuentas de usuario cambió — la purga NO debe borrar cuentas.'); ok = false }
  if (despues.puestos !== antes.puestos || despues.preguntas !== antes.preguntas || despues.niveles !== antes.niveles
    || despues.config !== antes.config || despues.rolesAdmin !== antes.rolesAdmin) {
    console.error('⚠ La estructura (puestos/preguntas/niveles/config/roles admin) cambió — la purga NO debe tocarla.')
    ok = false
  }

  await prisma.auditLog.create({
    data: {
      accion: 'PURGA_CARGA_INICIAL',
      detalle: {
        colaboradoresBorrados: colaboradoresBorrados.count,
        ciclosBorrados: ciclosBorrados.count,
        periodosBorrados: periodosBorrados.count,
        cuentasDesvinculadas: cuentasDesvinculadas.count,
      },
    },
  })

  console.log(ok ? '\n✓ Purga completa. Estructura y cuentas conservadas.' : '\n✗ La purga terminó con inconsistencias — revisar antes de continuar con la carga.')
  if (!ok) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
