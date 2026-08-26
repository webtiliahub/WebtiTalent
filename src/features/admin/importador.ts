'use server'

import { requiereAdmin } from '@/shared/lib/permisos'
import { filasDesdeXlsx } from './importador-xlsx'
import { procesarPadron, type FilaPadron } from './importador-motor'

// Re-export de solo-tipos: no genera endpoint (los tipos desaparecen al compilar) y evita que
// los consumidores tengan que saber que el motor vive en otro archivo
export type { ResumenImportacion, FilaPadron } from './importador-motor'


/**
 * Importador del padrón de colaboradores (CSV UTF-8, plantilla propia depurada).
 * Dos modos: simulación (valida todo y arma el plan, sin escribir) y aplicación.
 * Idempotente: el upsert es por `codigo` (PER-001…), re-subir un padrón actualizado
 * solo cambia lo que difiere. No crea cuentas de acceso ni lanza nada: deja los
 * datos listos para el flujo normal de la plataforma.
 *
 * El motor (`procesarPadron`) es reutilizable: lo consume también el importador
 * maestro (Excel), que ya resolvió estructura (niveles/puestos/competencias) antes
 * de llegar aquí — por eso el parámetro `origen` distingue avisos que solo aplican
 * al camino CSV (ver el aviso de "puestos caparazón" más abajo).
 */


const ENCABEZADO = ['codigo', 'documento', 'nombres', 'apellidos', 'email', 'telefono', 'pais', 'area', 'cargo', 'nivel_jerarquico', 'codigo_jefe', 'nivel_liderazgo', 'fecha_ingreso'] as const

function parseCsv(texto: string): string[][] {
  const filas: string[][] = []
  let fila: string[] = []
  let campo = ''
  let enComillas = false
  const t = texto.replace(/^﻿/, '') // BOM
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (enComillas) {
      if (ch === '"' && t[i + 1] === '"') { campo += '"'; i++ }
      else if (ch === '"') enComillas = false
      else campo += ch
    } else if (ch === '"') enComillas = true
    else if (ch === ',') { fila.push(campo); campo = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++
      fila.push(campo); campo = ''
      if (fila.some((c) => c.trim() !== '')) filas.push(fila)
      fila = []
    } else campo += ch
  }
  if (campo !== '' || fila.length > 0) {
    fila.push(campo)
    if (fila.some((c) => c.trim() !== '')) filas.push(fila)
  }
  return filas
}

export async function importarPadron(formData: FormData, aplicar: boolean) {
  const sesion = await requiereAdmin('COLABORADORES', 'GESTIONAR')
  // El padrón cruza países: solo RR.HH. Regional puede importarlo
  if (sesion.alcanceRrhh !== 'REGIONAL') {
    return { ok: false as const, error: 'Solo RR.HH. Regional puede importar el padrón (cruza países)' }
  }

  const archivo = formData.get('archivo')
  if (!(archivo instanceof File) || archivo.size === 0) return { ok: false as const, error: 'Adjunta el archivo de la plantilla (.csv o .xlsx)' }
  if (archivo.size > 5 * 1024 * 1024) return { ok: false as const, error: 'El archivo supera los 5 MB' }

  const esXlsx = archivo.name.toLowerCase().endsWith('.xlsx')
  const crudo = esXlsx
    ? filasDesdeXlsx(await archivo.arrayBuffer())
    : parseCsv(await archivo.text())
  if (crudo.length < 2) return { ok: false as const, error: 'El archivo no tiene filas de datos' }

  const cabecera = crudo[0].map((c) => c.trim().toLowerCase())
  if (JSON.stringify(cabecera) !== JSON.stringify([...ENCABEZADO])) {
    return { ok: false as const, error: `Encabezado inesperado. Se esperan las columnas: ${ENCABEZADO.join(', ')}` }
  }

  const filas: FilaPadron[] = crudo.slice(1).map((f, i) => ({
    linea: i + 2,
    codigo: (f[0] ?? '').trim(),
    documento: (f[1] ?? '').trim(),
    nombres: (f[2] ?? '').trim(),
    apellidos: (f[3] ?? '').trim(),
    email: (f[4] ?? '').trim().toLowerCase(),
    telefono: (f[5] ?? '').trim(),
    pais: (f[6] ?? '').trim(),
    area: (f[7] ?? '').trim(),
    cargo: (f[8] ?? '').trim(),
    nivel: (f[9] ?? '').trim(),
    codigoJefe: (f[10] ?? '').trim(),
    liderazgo: (f[11] ?? '').trim().toUpperCase(),
    fechaIngreso: (f[12] ?? '').trim(),
  }))

  const { resumen } = await procesarPadron(filas, { sesionId: sesion.id, aplicar, origen: 'CSV', archivoNombre: archivo.name })
  return { ok: true as const, resumen }
}
