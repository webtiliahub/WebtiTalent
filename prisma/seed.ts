/**
 * Seed de la Plataforma 360 Hunter — DATOS SIMULADOS (cumple SGSI: nunca datos reales en dev).
 * Org canónica del demo + universo simulado por país, banco de preguntas, ciclo 2026 activo.
 * Credenciales demo: <email> / Hunter2026!
 */
import 'dotenv/config'
import { PrismaClient, RolSistema, AlcanceRrhh, TipoEvaluacion, TipoObjetivo, EstadoObjetivo, EstadoCiclo } from '../src/generated/prisma/client'
type Nivel = 'GERENCIAL' | 'MANDO_MEDIO' | 'ESPECIALISTA' | 'APOYO'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'
import { exigirBaseLocal } from './_guarda'

exigirBaseLocal('seed')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

const PASSWORD_DEMO = 'Hunter2026!'

async function main() {
  console.log('🌱 Seed Hunter 360 — datos simulados')
  const hash = await bcrypt.hash(PASSWORD_DEMO, 10)

  // ── Países ──
  const [pe, ec, co, cl] = await Promise.all([
    prisma.pais.create({ data: { codigo: 'PE', nombre: 'Perú' } }),
    prisma.pais.create({ data: { codigo: 'EC', nombre: 'Ecuador' } }),
    prisma.pais.create({ data: { codigo: 'CO', nombre: 'Colombia' } }),
    prisma.pais.create({ data: { codigo: 'CL', nombre: 'Chile' } }),
  ])

  // ── Áreas ──
  const areaNames = ['Operaciones', 'Comercial', 'Gestión Humana', 'Tecnología', 'Finanzas', 'Rastreo', 'Administración']
  const areas: Record<string, { id: string }> = {}
  for (const nombre of areaNames) areas[nombre] = await prisma.area.create({ data: { nombre } })

  // ── Dimensiones ──
  const dimNames = ['Analítica', 'Operativa', 'Liderazgo', 'Digital', 'Interpersonal']
  const dims: Record<string, { id: string }> = {}
  let dOrden = 0
  for (const nombre of dimNames) dims[nombre] = await prisma.dimension.create({ data: { nombre, orden: dOrden++ } })

  // ── Competencias (por dimensión) ──
  const compDefs: [string, string][] = [
    ['Análisis de datos y KPIs', 'Analítica'],
    ['Resolución de problemas', 'Analítica'],
    ['Proyección de escenarios', 'Analítica'],
    ['Orientación a resultados', 'Operativa'],
    ['Calidad y estándares', 'Operativa'],
    ['Dominio técnico', 'Operativa'],
    ['Liderazgo', 'Liderazgo'],
    ['Desarrollo de personas', 'Liderazgo'],
    ['Influencia', 'Liderazgo'],
    ['Adopción digital', 'Digital'],
    ['Comunicación', 'Interpersonal'],
    ['Trabajo en equipo', 'Interpersonal'],
  ]
  const comps: Record<string, { id: string }> = {}
  for (const [nombre, dim] of compDefs)
    comps[nombre] = await prisma.competencia.create({ data: { nombre, dimensionId: dims[dim].id } })

  // ── Puestos (con pesos por dimensión que suman 100) ──
  // ── Niveles jerárquicos (catálogo) ──
  const nivelDefs: { clave: Nivel; nombre: string; orden: number; compPct: number }[] = [
    { clave: 'GERENCIAL', nombre: 'Gerencial', orden: 0, compPct: 50 },
    { clave: 'MANDO_MEDIO', nombre: 'Mando Medio', orden: 1, compPct: 60 },
    { clave: 'ESPECIALISTA', nombre: 'Especialista', orden: 2, compPct: 50 },
    { clave: 'APOYO', nombre: 'Apoyo', orden: 3, compPct: 70 },
  ]
  const niveles: Record<Nivel, { id: string; compPct: number }> = {} as never
  for (const n of nivelDefs) {
    const creado = await prisma.nivelJerarquico.create({ data: { nombre: n.nombre, orden: n.orden, compPct: n.compPct } })
    niveles[n.clave] = { id: creado.id, compPct: n.compPct }
  }

  type PuestoDef = { nombre: string; nivel: Nivel; area: string; pesos: Record<string, number>; comps: string[] }
  const puestoDefs: PuestoDef[] = [
    { nombre: 'Gerente de País', nivel: 'GERENCIAL', area: 'Administración', pesos: { Analítica: 25, Operativa: 15, Liderazgo: 35, Digital: 10, Interpersonal: 15 }, comps: ['Liderazgo', 'Influencia', 'Proyección de escenarios'] },
    { nombre: 'Gerente de Operaciones', nivel: 'GERENCIAL', area: 'Operaciones', pesos: { Analítica: 25, Operativa: 20, Liderazgo: 30, Digital: 10, Interpersonal: 15 }, comps: ['Liderazgo', 'Orientación a resultados', 'Proyección de escenarios'] },
    { nombre: 'Gerente de Gestión Humana', nivel: 'GERENCIAL', area: 'Gestión Humana', pesos: { Analítica: 20, Operativa: 15, Liderazgo: 35, Digital: 10, Interpersonal: 20 }, comps: ['Liderazgo', 'Desarrollo de personas', 'Comunicación'] },
    { nombre: 'Jefa de Operaciones', nivel: 'MANDO_MEDIO', area: 'Operaciones', pesos: { Analítica: 20, Operativa: 30, Liderazgo: 25, Digital: 10, Interpersonal: 15 }, comps: ['Comunicación', 'Desarrollo de personas', 'Orientación a resultados'] },
    { nombre: 'Jefa Comercial', nivel: 'MANDO_MEDIO', area: 'Comercial', pesos: { Analítica: 20, Operativa: 25, Liderazgo: 25, Digital: 10, Interpersonal: 20 }, comps: ['Orientación a resultados', 'Influencia', 'Comunicación'] },
    { nombre: 'Jefe de Rastreo', nivel: 'MANDO_MEDIO', area: 'Rastreo', pesos: { Analítica: 25, Operativa: 30, Liderazgo: 20, Digital: 15, Interpersonal: 10 }, comps: ['Dominio técnico', 'Orientación a resultados', 'Liderazgo'] },
    { nombre: 'Jefe de Tecnología', nivel: 'MANDO_MEDIO', area: 'Tecnología', pesos: { Analítica: 25, Operativa: 20, Liderazgo: 20, Digital: 25, Interpersonal: 10 }, comps: ['Dominio técnico', 'Adopción digital', 'Liderazgo'] },
    { nombre: 'Jefa de Finanzas', nivel: 'MANDO_MEDIO', area: 'Finanzas', pesos: { Analítica: 35, Operativa: 20, Liderazgo: 20, Digital: 10, Interpersonal: 15 }, comps: ['Análisis de datos y KPIs', 'Proyección de escenarios', 'Comunicación'] },
    { nombre: 'Supervisor de Operaciones', nivel: 'ESPECIALISTA', area: 'Operaciones', pesos: { Analítica: 20, Operativa: 35, Liderazgo: 20, Digital: 10, Interpersonal: 15 }, comps: ['Orientación a resultados', 'Calidad y estándares', 'Trabajo en equipo'] },
    { nombre: 'Analista Senior de Operaciones', nivel: 'ESPECIALISTA', area: 'Operaciones', pesos: { Analítica: 30, Operativa: 30, Liderazgo: 10, Digital: 15, Interpersonal: 15 }, comps: ['Análisis de datos y KPIs', 'Resolución de problemas', 'Calidad y estándares'] },
    { nombre: 'Analista de Operaciones', nivel: 'APOYO', area: 'Operaciones', pesos: { Analítica: 25, Operativa: 35, Liderazgo: 5, Digital: 15, Interpersonal: 20 }, comps: ['Resolución de problemas', 'Calidad y estándares', 'Trabajo en equipo'] },
    { nombre: 'Analista de RR.HH.', nivel: 'ESPECIALISTA', area: 'Gestión Humana', pesos: { Analítica: 25, Operativa: 20, Liderazgo: 10, Digital: 15, Interpersonal: 30 }, comps: ['Comunicación', 'Trabajo en equipo', 'Análisis de datos y KPIs'] },
    { nombre: 'Analista de Monitoreo', nivel: 'ESPECIALISTA', area: 'Rastreo', pesos: { Analítica: 30, Operativa: 30, Liderazgo: 5, Digital: 20, Interpersonal: 15 }, comps: ['Análisis de datos y KPIs', 'Resolución de problemas'] },
    { nombre: 'Técnico Instalador', nivel: 'APOYO', area: 'Operaciones', pesos: { Analítica: 10, Operativa: 45, Liderazgo: 5, Digital: 20, Interpersonal: 20 }, comps: ['Dominio técnico', 'Calidad y estándares'] },
    { nombre: 'Asistente Administrativa', nivel: 'APOYO', area: 'Administración', pesos: { Analítica: 15, Operativa: 35, Liderazgo: 5, Digital: 20, Interpersonal: 25 }, comps: ['Calidad y estándares', 'Trabajo en equipo'] },
  ]
  const puestos: Record<string, { id: string; nivel: Nivel }> = {}
  for (const p of puestoDefs) {
    const creado = await prisma.puesto.create({
      data: {
        nombre: p.nombre,
        nivelId: niveles[p.nivel].id,
        areaId: areas[p.area].id,
        pesos: { create: Object.entries(p.pesos).map(([dim, peso]) => ({ dimensionId: dims[dim].id, peso })) },
        competencias: { create: p.comps.map((c) => ({ competenciaId: comps[c].id })) },
      },
    })
    puestos[p.nombre] = { id: creado.id, nivel: p.nivel }
  }

  // ── Org canónica del demo ──
  type ColabDef = {
    key: string; nombres: string; apellidos: string; doc: string; pais: typeof pe
    area: string; puesto: string; jefeKey?: string
    email?: string; rol?: RolSistema; alcance?: AlcanceRrhh
  }
  const colabDefs: ColabDef[] = [
    { key: 'marcos', nombres: 'Marcos', apellidos: 'Velarde', doc: 'PE · 09182733', pais: pe, area: 'Operaciones', puesto: 'Gerente de Operaciones', email: 'mvelarde@hunter.com.pe' },
    { key: 'gerenteGH', nombres: 'Patricia', apellidos: 'Salas', doc: 'PE · 10293847', pais: pe, area: 'Gestión Humana', puesto: 'Gerente de Gestión Humana', email: 'psalas@hunter.com.pe' },
    { key: 'maria', nombres: 'María', apellidos: 'Perez', doc: 'PE · 41122033', pais: pe, area: 'Gestión Humana', puesto: 'Analista de RR.HH.', jefeKey: 'gerenteGH', email: 'mperez@hunter.com.pe', rol: 'RRHH', alcance: 'REGIONAL' },
    { key: 'ana', nombres: 'Ana', apellidos: 'Torres', doc: 'PE · 40291855', pais: pe, area: 'Operaciones', puesto: 'Jefa de Operaciones', jefeKey: 'marcos', email: 'atorres@hunter.com.pe' },
    { key: 'rosa', nombres: 'Rosa', apellidos: 'Quispe', doc: 'PE · 42558811', pais: pe, area: 'Comercial', puesto: 'Jefa Comercial', jefeKey: 'marcos', email: 'rquispe@hunter.com.pe' },
    { key: 'luis', nombres: 'Luis', apellidos: 'Ríos', doc: 'PE · 43771122', pais: pe, area: 'Rastreo', puesto: 'Jefe de Rastreo', jefeKey: 'marcos', email: 'lrios@hunter.com.pe' },
    { key: 'jorge', nombres: 'Jorge', apellidos: 'Medina', doc: 'PE · 41887700', pais: pe, area: 'Tecnología', puesto: 'Jefe de Tecnología', jefeKey: 'marcos', email: 'jmedina@hunter.com.pe' },
    { key: 'paola', nombres: 'Paola', apellidos: 'Ríos', doc: 'PE · 44012233', pais: pe, area: 'Finanzas', puesto: 'Jefa de Finanzas', jefeKey: 'marcos', email: 'prios@hunter.com.pe' },
    { key: 'carlos', nombres: 'Carlos', apellidos: 'Méndez', doc: 'PE · 45992011', pais: pe, area: 'Operaciones', puesto: 'Supervisor de Operaciones', jefeKey: 'ana', email: 'cmendez@hunter.com.pe' },
    { key: 'lucia', nombres: 'Lucía', apellidos: 'Paredes', doc: 'PE · 44820199', pais: pe, area: 'Operaciones', puesto: 'Analista Senior de Operaciones', jefeKey: 'ana', email: 'lparedes@hunter.com.pe' },
    { key: 'diego', nombres: 'Diego', apellidos: 'Salas', doc: 'PE · 46110288', pais: pe, area: 'Operaciones', puesto: 'Analista de Operaciones', jefeKey: 'ana', email: 'dsalas@hunter.com.pe' },
  ]

  const colabs: Record<string, { id: string }> = {}
  for (const c of colabDefs) {
    const creado = await prisma.colaborador.create({
      data: {
        nombres: c.nombres,
        apellidos: c.apellidos,
        documento: c.doc,
        paisId: c.pais.id,
        areaId: areas[c.area].id,
        puestoId: puestos[c.puesto].id,
        jefeId: c.jefeKey ? colabs[c.jefeKey].id : null,
        fechaIngreso: new Date('2022-03-01'),
      },
    })
    colabs[c.key] = { id: creado.id }
    if (c.email) {
      await prisma.usuario.create({
        data: {
          email: c.email,
          passwordHash: hash,
          rol: c.rol ?? 'COLABORADOR',
          alcanceRrhh: c.alcance ?? null,
          colaboradorId: creado.id,
        },
      })
    }
  }

  // ── Universo simulado adicional (volumen para listas y 9-Box) ──
  const nombresPool = ['Sofía', 'Bruno', 'Renzo', 'Marta', 'Pedro', 'Valeria', 'Hugo', 'Camila', 'Iván', 'Elena', 'Óscar', 'Diana', 'Raúl', 'Karla', 'Mauro', 'Brenda', 'Felipe', 'Norma', 'Sergio', 'Tania']
  const apellidosPool = ['Lazo', 'Cano', 'Aliaga', 'Ñahui', 'Yataco', 'Campos', 'Soto', 'Vega', 'Ramos', 'Cruz', 'Ponce', 'Ibarra', 'Mori', 'Acosta', 'Bravo', 'Luna', 'Paz', 'Roca', 'Silva', 'Toledo']
  const puestosPool = ['Analista de Operaciones', 'Analista Senior de Operaciones', 'Supervisor de Operaciones', 'Analista de Monitoreo', 'Técnico Instalador', 'Asistente Administrativa']
  const areaDePuesto: Record<string, string> = {
    'Analista de Operaciones': 'Operaciones', 'Analista Senior de Operaciones': 'Operaciones', 'Supervisor de Operaciones': 'Operaciones',
    'Analista de Monitoreo': 'Rastreo', 'Técnico Instalador': 'Operaciones', 'Asistente Administrativa': 'Administración',
  }
  const paisesSim = [{ p: pe, n: 24, pref: 'PE' }, { p: ec, n: 8, pref: 'EC' }, { p: co, n: 8, pref: 'CO' }, { p: cl, n: 5, pref: 'CL' }]
  const jefesPe = ['ana', 'rosa', 'luis', 'jorge', 'paola']
  let docSeq = 50000000
  for (const { p, n, pref } of paisesSim) {
    for (let i = 0; i < n; i++) {
      const nom = nombresPool[(i * 7 + n) % nombresPool.length]
      const ape = apellidosPool[(i * 11 + n * 3) % apellidosPool.length]
      const puestoNombre = puestosPool[i % puestosPool.length]
      const jefeId = p.id === pe.id ? colabs[jefesPe[i % jefesPe.length]].id : null
      await prisma.colaborador.create({
        data: {
          nombres: nom,
          apellidos: `${ape} ${apellidosPool[(i * 5) % apellidosPool.length]}`,
          documento: `${pref} · ${docSeq++}`,
          paisId: p.id,
          areaId: areas[areaDePuesto[puestoNombre]].id,
          puestoId: puestos[puestoNombre].id,
          jefeId,
          fechaIngreso: new Date(2020 + (i % 5), i % 12, 1 + (i % 27)),
        },
      })
    }
  }

  // ── Banco de preguntas (escala 1–5, sin cualitativos) ──
  const pregDefs: [string, string, Nivel[]][] = [
    ['Analiza los problemas antes de actuar y llega a conclusiones lógicas.', 'Resolución de problemas', ['GERENCIAL', 'MANDO_MEDIO', 'ESPECIALISTA', 'APOYO']],
    ['Usa datos e indicadores para sustentar sus decisiones.', 'Análisis de datos y KPIs', ['GERENCIAL', 'MANDO_MEDIO', 'ESPECIALISTA']],
    ['Anticipa escenarios y propone planes de contingencia.', 'Proyección de escenarios', ['GERENCIAL', 'MANDO_MEDIO']],
    ['Cumple sus compromisos en los plazos acordados.', 'Orientación a resultados', ['GERENCIAL', 'MANDO_MEDIO', 'ESPECIALISTA', 'APOYO']],
    ['Entrega trabajos con la calidad y el estándar esperados.', 'Calidad y estándares', ['MANDO_MEDIO', 'ESPECIALISTA', 'APOYO']],
    ['Domina las herramientas y procesos técnicos de su función.', 'Dominio técnico', ['ESPECIALISTA', 'APOYO']],
    ['Orienta y da dirección clara a su equipo.', 'Liderazgo', ['GERENCIAL', 'MANDO_MEDIO']],
    ['Desarrolla a las personas de su equipo y delega con criterio.', 'Desarrollo de personas', ['GERENCIAL', 'MANDO_MEDIO']],
    ['Influye positivamente y construye acuerdos entre áreas.', 'Influencia', ['GERENCIAL', 'MANDO_MEDIO']],
    ['Adopta nuevas herramientas digitales con fluidez.', 'Adopción digital', ['GERENCIAL', 'MANDO_MEDIO', 'ESPECIALISTA', 'APOYO']],
    ['Comunica sus ideas con claridad, de forma oportuna.', 'Comunicación', ['GERENCIAL', 'MANDO_MEDIO', 'ESPECIALISTA', 'APOYO']],
    ['Colabora activamente y suma al objetivo común.', 'Trabajo en equipo', ['MANDO_MEDIO', 'ESPECIALISTA', 'APOYO']],
    ['Mantiene la operación estable bajo presión.', 'Orientación a resultados', ['MANDO_MEDIO', 'ESPECIALISTA', 'APOYO']],
    ['Identifica causas raíz y evita que los problemas se repitan.', 'Resolución de problemas', ['MANDO_MEDIO', 'ESPECIALISTA']],
    ['Da seguimiento a los indicadores de su área y reacciona a los desvíos.', 'Análisis de datos y KPIs', ['MANDO_MEDIO', 'ESPECIALISTA']],
  ]
  const preguntas: { id: string; niveles: Nivel[] }[] = []
  for (const [texto, comp, niveles] of pregDefs) {
    const pr = await prisma.pregunta.create({ data: { texto, competenciaId: comps[comp].id } })
    preguntas.push({ id: pr.id, niveles })
  }

  // ── Preguntas de potencial (5, solo jefe → eje Y del 9-Box) ──
  const potTextos = [
    'Tiene capacidad para asumir responsabilidades de mayor alcance en 1–2 años.',
    'Aprende con rapidez y aplica lo aprendido a nuevos contextos.',
    'Muestra interés y aspiración de crecer dentro de la organización.',
    'Influye positivamente y moviliza a otros más allá de su rol.',
    'Mantiene el desempeño bajo presión y ante el cambio.',
  ]
  const pregPot: { id: string }[] = []
  for (let i = 0; i < potTextos.length; i++) pregPot.push(await prisma.preguntaPotencial.create({ data: { texto: potTextos[i], orden: i + 1 } }))

  // ── Configuración global ──
  await prisma.config.create({ data: { clave: 'pesosModalidades', valor: { JEFE: 60, PAR: 25, ASCENDENTE: 15, AUTO: 0 } } })

  // ── Período de objetivos 2026 (cerrado: objetivos ya definidos) ──
  const periodo = await prisma.periodoObjetivos.create({
    data: { nombre: '2026', tipo: 'ANUAL', estado: 'CERRADO', fechaLimiteCarga: new Date('2026-03-31T23:59:59') },
  })

  // ── Ciclo 2026 activo (Perú) ──
  const ciclo = await prisma.ciclo.create({
    data: {
      nombre: 'Ciclo Anual 2026',
      descripcion: 'Anual · competencias + objetivos',
      periodoId: periodo.id,
      paisId: pe.id,
      fechaInicio: new Date('2026-06-01'),
      fechaFin: new Date('2026-06-30'),
      estado: 'ACTIVO' as EstadoCiclo,
      configJson: {
        pesosModalidades: { JEFE: 60, PAR: 25, ASCENDENTE: 15, AUTO: 0 },
        combinacionPorNivel: Object.fromEntries(Object.values(niveles).map((n) => [n.id, { comp: n.compPct, obj: 100 - n.compPct }])),
      },
      preguntas: {
        // Snapshot por nivel y modalidad (demo: mismas preguntas para jefe, pares y auto)
        create: preguntas.flatMap((p) => p.niveles.flatMap((nivel) =>
          (['JEFE', 'PAR', 'AUTO'] as TipoEvaluacion[]).map((m) => ({ preguntaId: p.id, nivelId: niveles[nivel].id, modalidad: m })),
        )),
      },
    },
  })

  // ── Asignaciones del ciclo (org canónica) ──
  const asignar = (evaluadorKey: string, evaluadoKey: string, tipo: TipoEvaluacion) =>
    prisma.asignacion.create({
      data: { cicloId: ciclo.id, evaluadorId: colabs[evaluadorKey].id, evaluadoId: colabs[evaluadoKey].id, tipo },
    })

  // Autoevaluaciones
  for (const k of ['ana', 'carlos', 'lucia', 'diego', 'rosa', 'luis', 'maria']) await asignar(k, k, 'AUTO')
  // Jefe evalúa a su equipo
  for (const k of ['carlos', 'lucia', 'diego']) await asignar('ana', k, 'JEFE')
  await asignar('marcos', 'ana', 'JEFE')
  await asignar('gerenteGH', 'maria', 'JEFE')
  // Pares de Ana
  await asignar('rosa', 'ana', 'PAR')
  await asignar('luis', 'ana', 'PAR')
  // Ascendentes (el equipo evalúa a Ana; Ana evalúa a Marcos)
  for (const k of ['carlos', 'lucia', 'diego']) await asignar(k, 'ana', 'ASCENDENTE')
  await asignar('ana', 'marcos', 'ASCENDENTE')

  // ── Objetivos ──
  // Transversal corporativo (toda la organización)
  const transversal = await prisma.objetivo.create({
    data: {
      periodoId: periodo.id, tipo: 'TRANSVERSAL' as TipoObjetivo, titulo: 'EBITDA región dentro de meta 2026',
      descripcion: 'Resultado financiero regional dentro del presupuesto aprobado por el Directorio.',
      peso: 30, estado: 'APROBADO' as EstadoObjetivo, metaFecha: 'dic-2026',
    },
  })
  // Individuales de la org canónica
  const objsInd: [string, string, string, number, EstadoObjetivo, string][] = [
    ['carlos', 'Reducir incidencias de instalación en 20%', 'Plan de calidad sobre el proceso de instalación.', 40, 'APROBADO', 'dic-2026'],
    ['carlos', 'Certificación en liderazgo de equipos', 'Completar la certificación del instituto acordado.', 30, 'APROBADO', 'set-2026'],
    ['lucia', 'Automatizar el reporte semanal de operaciones', 'Reducir 6 horas de trabajo manual por semana.', 40, 'APROBADO', 'oct-2026'],
    ['lucia', 'Plan de mejora del indicador de atención', 'Subir el indicador de atención a 95%.', 30, 'APROBADO', 'dic-2026'],
    ['diego', 'Cerrar tickets de monitoreo en menos de 24 h', 'Reducir el tiempo medio de cierre de tickets.', 40, 'APROBADO', 'dic-2026'],
    ['diego', 'Documentar los 10 procedimientos críticos', 'Manual operativo del puesto.', 30, 'APROBADO', 'nov-2026'],
    ['ana', 'Reducir el costo operativo del área en 8%', 'Optimización de rutas y turnos.', 40, 'APROBADO', 'dic-2026'],
    ['ana', 'Implementar el tablero de control del área', 'KPIs de operación en tiempo real.', 30, 'APROBADO', 'set-2026'],
    ['maria', 'Implementar la nueva plataforma de evaluación 360', 'Despliegue de los 4 países.', 40, 'APROBADO', 'dic-2026'],
    ['maria', 'Capacitar al 100% de jefes en el nuevo modelo', 'Talleres por país.', 30, 'APROBADO', 'oct-2026'],
  ]
  for (const [key, titulo, descripcion, peso, estado, metaFecha] of objsInd) {
    await prisma.objetivo.create({
      data: { periodoId: periodo.id, tipo: 'INDIVIDUAL' as TipoObjetivo, titulo, descripcion, peso, estado, metaFecha, colaboradorId: colabs[key].id },
    })
  }
  // Logro del transversal cargado por Dirección (85%)
  for (const k of ['ana', 'carlos', 'lucia', 'diego', 'maria']) {
    await prisma.objetivoLogro.create({ data: { objetivoId: transversal.id, colaboradorId: colabs[k].id, logroFinal: 85 } })
  }

  await prisma.auditLog.create({ data: { accion: 'SEED', detalle: { mensaje: 'Seed inicial con datos simulados' } } })

  const totales = {
    colaboradores: await prisma.colaborador.count(),
    usuarios: await prisma.usuario.count(),
    preguntas: await prisma.pregunta.count(),
    asignaciones: await prisma.asignacion.count(),
    objetivos: await prisma.objetivo.count(),
  }
  console.log('✅ Seed completo:', totales)
  console.log(`🔑 Credenciales demo: mperez@hunter.com.pe / atorres@... / lparedes@... — contraseña: ${PASSWORD_DEMO}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
