'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { importarPadron, type ResumenImportacion } from './importador'
import { toast } from '@/shared/ui/Toast'
import { descargarXlsx, type HojaXlsx } from '@/shared/ui/xlsx-descarga'

type CatalogosPadron = { paises: string[]; niveles: string[]; areas: string[] }

const COLUMNAS = ['codigo', 'documento', 'nombres', 'apellidos', 'email', 'telefono', 'pais', 'area', 'cargo', 'nivel_jerarquico', 'codigo_jefe', 'nivel_liderazgo', 'fecha_ingreso']

/** Plantilla descargable del padrón: hoja de datos con una fila de ejemplo + hoja de
 * catálogos válidos (referencia; SheetJS Community no escribe listas desplegables). */
export function hojasPlantillaPadron(catalogos: CatalogosPadron): HojaXlsx[] {
  const datos: HojaXlsx = {
    nombre: 'Padrón',
    filas: [COLUMNAS, ['PER-001', '40967470', 'Nombre', 'Apellido', 'correo@hunter.com', '+51 999 999 999', catalogos.paises[0] ?? 'Perú', catalogos.areas[0] ?? 'Área', 'Cargo', catalogos.niveles[0] ?? 'Apoyo', '', '', '2024-01-15']],
  }
  const cat: (string | number)[][] = [['Países válidos', ...catalogos.paises], ['Niveles válidos', ...catalogos.niveles]]
  return [datos, { nombre: 'Catálogos', filas: cat }]
}

/** Importación del padrón en dos pasos: SIMULAR (valida y muestra el plan, sin escribir)
 * y APLICAR (solo habilitado con la simulación limpia de errores). */
export function ImportadorPadron({ catalogos }: { catalogos: CatalogosPadron }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [resumen, setResumen] = useState<ResumenImportacion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  const correr = (aplicar: boolean) => {
    if (!archivo) return
    startTransition(async () => {
      setError(null)
      const fd = new FormData()
      fd.set('archivo', archivo)
      const res = await importarPadron(fd, aplicar)
      if (!res.ok) { setError(res.error); return }
      setResumen(res.resumen)
      if (res.resumen.aplicado) {
        toast(`Padrón importado: ${res.resumen.nuevos} nuevos · ${res.resumen.actualizados} actualizados`)
        router.refresh()
      }
    })
  }

  const stat = (valor: number, etiqueta: string, tono = '') => (
    <div className="rounded-xl bg-hueso px-4 py-3 text-center">
      <p className={`font-display text-2xl font-extrabold ${tono}`}>{valor}</p>
      <p className="text-[11px] text-gris">{etiqueta}</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => descargarXlsx('plantilla-padron.xlsx', hojasPlantillaPadron(catalogos))}
          className="rounded-xl border border-gris-claro bg-white px-4 py-2 text-[13px] font-bold transition hover:bg-hueso"
        >
          ↓ Descargar plantilla
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,text/csv"
          onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setResumen(null); setError(null) }}
          className="text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-hueso-2 file:px-4 file:py-2.5 file:text-[13px] file:font-bold file:text-negro hover:file:bg-gris-claro"
        />
        <button
          disabled={!archivo || pendiente}
          onClick={() => correr(false)}
          className="rounded-xl border border-gris-claro bg-white px-4 py-2 text-[13px] font-bold transition hover:bg-hueso disabled:opacity-50"
        >
          {pendiente ? 'Procesando…' : 'Simular importación'}
        </button>
        {resumen && !resumen.aplicado && resumen.errores.length === 0 && (
          <button
            disabled={pendiente}
            onClick={() => correr(true)}
            className="rounded-xl bg-hunter px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-hunter/30 transition hover:bg-hunter-dark disabled:opacity-50"
          >
            {pendiente ? 'Importando…' : `Aplicar importación (${resumen.filas} filas) →`}
          </button>
        )}
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-hunter-dark">{error}</p>}

      {resumen && (
        <div className="space-y-4">
          {resumen.aplicado && (
            <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">✓ Importación aplicada</p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {stat(resumen.filas, 'filas en el archivo')}
            {stat(resumen.nuevos, 'colaboradores nuevos', 'text-emerald-700')}
            {stat(resumen.actualizados, 'se actualizan')}
            {stat(resumen.areasNuevas, 'áreas nuevas')}
            {stat(resumen.puestosNuevos, 'puestos nuevos')}
          </div>

          {resumen.errores.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50/60 px-4 py-3">
              <p className="mb-1.5 text-[13px] font-bold text-hunter-dark">✕ {resumen.errores.length} error(es) — corrígelos en el archivo y vuelve a simular</p>
              <ul className="max-h-64 space-y-0.5 overflow-y-auto text-xs text-negro/80">
                {resumen.errores.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          {resumen.avisos.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
              <p className="mb-1.5 text-[13px] font-bold text-amber-800">⚠ {resumen.avisos.length} aviso(s) — no bloquean, revísalos antes de aplicar</p>
              <ul className="max-h-64 space-y-0.5 overflow-y-auto text-xs text-negro/80">
                {resumen.avisos.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
