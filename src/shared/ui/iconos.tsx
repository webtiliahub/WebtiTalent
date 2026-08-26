'use client'

import {
  UserRound, Gauge, Target, ClipboardList, Users, Pin, ClipboardCheck, ChartColumn,
  BookUser, Puzzle, FilePen, Flag, RefreshCw, LayoutGrid, Settings, LogOut,
  Brain, Scale, UsersRound, Lock, FileText, ListChecks, SlidersHorizontal, Building2, CalendarClock,
  Activity, CircleCheckBig, MessagesSquare, FileSpreadsheet,
  createLucideIcon,
  type LucideIcon,
} from 'lucide-react'

// Grid 2×2 propio (los 2x2 de Lucide no calzan con el lenguaje visual del resto): 4 cuadros
// redondeados independientes, mismo trazo que el resto del catálogo.
const AdminGrid = createLucideIcon('admin-grid', [
  // lucide usa attrs.key para las keys de React de cada nodo — sin ella, warning en consola
  ['rect', { x: '4', y: '4', width: '7', height: '7', rx: '2', key: 'r1' }],
  ['rect', { x: '13', y: '4', width: '7', height: '7', rx: '2', key: 'r2' }],
  ['rect', { x: '4', y: '13', width: '7', height: '7', rx: '2', key: 'r3' }],
  ['rect', { x: '13', y: '13', width: '7', height: '7', rx: '2', key: 'r4' }],
])

/** Iconos de la plataforma (Lucide, mismo lenguaje visual que Webtilia), referidos por slug
 * para poder declararlos en server components y resolverlos en el cliente. */
export const ICONOS: Record<string, LucideIcon> = {
  // Sidebar
  'hoja-de-vida': UserRound,
  'resultado': Gauge,
  'objetivos': Target,
  'evaluaciones': ClipboardList,
  'equipo': Users,
  'equipo-objetivos': Pin,
  'equipo-evaluar': ClipboardCheck,
  'equipo-resultados': ChartColumn,
  'colaboradores': BookUser,
  'puestos': Puzzle,
  'preguntas': FilePen,
  'transversales': Flag,
  'ciclos': RefreshCw,
  'resultados-9box': LayoutGrid,
  'configuracion': Settings,
  'cerrar-sesion': LogOut,
  'admin': AdminGrid,
  // Tabs de Configuración
  'modelo': Brain,
  'ponderaciones': Scale,
  'usuarios': UsersRound,
  'auditoria': Lock,
  'maestra': FileSpreadsheet,
  // Tabs de Puesto
  'perfil-puesto': FileText,
  'competencias': ListChecks,
  'pesos-evaluacion': SlidersHorizontal,
  'areas': Building2,
  'periodos': CalendarClock,
  // Tabs del detalle de ciclo
  'monitoreo': Activity,
  'feedback': MessagesSquare,
  'cierre': CircleCheckBig,
}

export function Icono({ slug, size = 17, className }: { slug: string; size?: number; className?: string }) {
  const Componente = ICONOS[slug]
  return Componente ? <Componente size={size} strokeWidth={1.9} className={className} /> : <>{slug}</>
}
