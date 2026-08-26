'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, Download } from 'lucide-react'
import { importarMaestro } from './acciones'
import type { PlanMaestro } from './plan'
import { hojasPlantillaMaestra } from './plantilla'
import { descargarXlsx } from '@/shared/ui/xlsx-descarga'
import { toast } from '@/shared/ui/Toast'
import { confirmar } from '@/shared/ui/Confirmacion'
import { Card, Vacio, AvisoSoloLectura, thCls, tdCls } from '@/shared/ui/componentes'
import { AvisoSoloEscritorio } from '@/shared/ui/AvisoSoloEscritorio'

export type CatalogosMaestra = { niveles: string[]; dimensiones: string[]; competencias: string[]; paises: string[]; areas: string[] }

/** `filas.length` cuenta toda fila del padrón, incluso las que no cambian nada en BD (ya
 * existían idénticas) — infla el total. Cuando el motor ya corrió (dry-run o aplicado) y llenó
 * `nuevos`/`actualizados`, se usa esa suma real; si no corrió (archivo con errores estructurales),
 * se cae a `filas.length` como aproximación. */
function totalCambios(plan: PlanMaestro): number {
  const padron = plan.padron.nuevos !== undefined && plan.padron.actualizados !== undefined
    ? plan.padron.nuevos + plan.padron.actualizados
    : plan.padron.filas.length
  return (
    plan.niveles.length +
    plan.puestosNuevos.length +
    plan.puestosRehomologados.length +
    plan.competenciasCambian.length +
    plan.competenciasPuestosNuevos.length +
    plan.pesosPersonalizados.length +
    padron
  )
}

/** Igual espíritu que el helper `acotar` de `importador.ts`, pero para render de listas: el caso
 * real llegó a 8.504 avisos y renderizar todos ahogaba la pantalla. */
function acotarRender(lista: string[], max = 40): string[] {
  return lista.length <= max ? lista : [...lista.slice(0, max), `… y ${lista.length - max} más`]
}

function stat(valor: number, etiqueta: string, tono = '') {
  return (
    <div className="rounded-xl bg-hueso px-4 py-3 text-center">
      <p className={`font-display text-2xl font-extrabold ${tono}`}>{valor}</p>
      <p className="text-[11px] text-gris">{etiqueta}</p>
    </div>
  )
}

/** Lista colapsable: evita que el plan (potencialmente cientos de filas) abrume la pantalla. */
function Expandible({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="flex items-center gap-1 text-xs font-bold text-marca hover:text-marca-dark"
      >
        {abierto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {etiqueta}
      </button>
      {abierto && <div className="mt-2.5">{children}</div>}
    </div>
  )
}

function SeccionNiveles({ plan }: { plan: PlanMaestro }) {
  return (
    <Card titulo="Niveles jerárquicos" extra={`${plan.niveles.length} cambio(s)`}>
      {plan.niveles.length === 0 ? (
        <Vacio>Sin cambios en el % de competencias/objetivos por nivel.</Vacio>
      ) : (
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[420px]">
            <thead>
              <tr>
                <th className={thCls}>Nivel</th>
                <th className={thCls}>% competencias antes</th>
                <th className={thCls}>% competencias después</th>
              </tr>
            </thead>
            <tbody>
              {plan.niveles.map((n) => (
                <tr key={n.nombre}>
                  <td className={`${tdCls} font-semibold`}>{n.nombre}</td>
                  <td className={tdCls}>{n.compPctAntes}%</td>
                  <td className={`${tdCls} font-bold text-marca`}>{n.compPctDespues}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function SeccionPuestos({ plan }: { plan: PlanMaestro }) {
  return (
    <Card titulo="Puestos" extra={`${plan.puestosNuevos.length + plan.puestosRehomologados.length} cambio(s)`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
        {stat(plan.puestosNuevos.length, 'puestos nuevos', 'text-emerald-700')}
        {stat(plan.puestosRehomologados.length, 're-homologados')}
      </div>
      {plan.puestosNuevos.length > 0 && (
        <Expandible etiqueta={`Ver puestos nuevos (${plan.puestosNuevos.length})`}>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
            {plan.puestosNuevos.map((p) => (
              <li key={p.nombre} className="rounded-lg bg-hueso px-3 py-1.5">
                <b>{p.nombre}</b> <span className="text-gris">— {p.nivel}</span>
              </li>
            ))}
          </ul>
        </Expandible>
      )}
      {plan.puestosRehomologados.length > 0 && (
        <Expandible etiqueta={`Ver re-homologados (${plan.puestosRehomologados.length})`}>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
            {plan.puestosRehomologados.map((p) => (
              <li key={p.nombre} className="rounded-lg bg-hueso px-3 py-1.5">
                <b>{p.nombre}</b> <span className="text-gris">— {p.nivelAntes} → </span>
                <span className="font-bold text-marca">{p.nivelDespues}</span>
              </li>
            ))}
          </ul>
        </Expandible>
      )}
    </Card>
  )
}

function SeccionCompetencias({ plan }: { plan: PlanMaestro }) {
  const primeros20 = plan.competenciasCambian.slice(0, 20)
  return (
    <Card
      titulo="Competencias"
      extra={`${plan.competenciasCambian.length} set(s) cambian · ${plan.competenciasPuestosNuevos.length} en puestos nuevos`}
    >
      {plan.competenciasCambian.length === 0 ? (
        <Vacio>Sin cambios en las competencias de puestos existentes.</Vacio>
      ) : (
        <>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
            {primeros20.map((c) => (
              <li key={c.puesto} className="rounded-lg bg-hueso px-3 py-1.5">
                <b>{c.puesto}</b> <span className="text-gris">— {c.antes} → </span>
                <span className="font-bold text-marca">{c.despues}</span> competencia(s)
              </li>
            ))}
          </ul>
          {plan.competenciasCambian.length > 20 && (
            <p className="mt-2 text-[11px] text-gris">… y {plan.competenciasCambian.length - 20} más</p>
          )}
        </>
      )}
    </Card>
  )
}

function SeccionPesos({ plan }: { plan: PlanMaestro }) {
  return (
    <Card
      titulo="Pesos por dimensión"
      extra={`${plan.pesosDerivados} derivado(s) · ${plan.pesosPersonalizados.length} personalizado(s)`}
    >
      {plan.pesosPersonalizados.length === 0 ? (
        <Vacio>Ningún puesto tiene pesos personalizados: todos derivan del peso de su nivel.</Vacio>
      ) : (
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[480px]">
            <thead>
              <tr>
                <th className={thCls}>Puesto</th>
                <th className={thCls}>Nivel</th>
                <th className={thCls}>Pesos (D1..D5)</th>
              </tr>
            </thead>
            <tbody>
              {plan.pesosPersonalizados.map((p) => (
                <tr key={p.puesto}>
                  <td className={`${tdCls} font-semibold`}>{p.puesto}</td>
                  <td className={tdCls}>{p.nivel}</td>
                  <td className={tdCls}>{p.pesos.join(' / ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function SeccionPadron({ plan }: { plan: PlanMaestro }) {
  const conConteo = plan.padron.nuevos !== undefined && plan.padron.actualizados !== undefined
  return (
    <Card titulo="Padrón de colaboradores" extra={`${plan.padron.filas.length} fila(s)`}>
      <div className={`grid grid-cols-2 gap-3 ${conConteo ? 'sm:grid-cols-4' : 'sm:grid-cols-2'}`}>
        {stat(plan.padron.filas.length, 'filas en el archivo')}
        {stat(plan.padron.nivelesIgnorados, 'niveles del padrón ignorados (se usa el de Hoja 4)')}
        {conConteo && stat(plan.padron.nuevos!, 'nuevos', 'text-emerald-700')}
        {conConteo && stat(plan.padron.actualizados!, 'actualizados')}
      </div>
    </Card>
  )
}

export function CargaMaestra({ puedeGestionar, catalogos }: { puedeGestionar: boolean; catalogos: CatalogosMaestra }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [plan, setPlan] = useState<PlanMaestro | null>(null)
  const [aplicado, setAplicado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  if (!puedeGestionar) {
    return (
      <>
        <AvisoSoloLectura mensaje="Vista de solo lectura: la carga maestra es exclusiva de RR.HH. Regional (cruza países)." />
        <Vacio>Solo RR.HH. Regional puede subir y aplicar el archivo maestro.</Vacio>
      </>
    )
  }

  const correr = (aplicarAhora: boolean) => {
    if (!archivo) return
    startTransition(async () => {
      setError(null)
      const fd = new FormData()
      fd.set('archivo', archivo)
      const res = await importarMaestro(fd, aplicarAhora)
      if (!res.ok) { setError(res.error); return }
      setPlan(res.plan)
      setAplicado(res.aplicado)
      if (res.aplicado) {
        toast(`Carga maestra aplicada: ${totalCambios(res.plan)} cambio(s)`)
        router.refresh()
      }
    })
  }

  const aplicar = async () => {
    if (!plan) return
    const ok = await confirmar(
      `Se aplicarán ${totalCambios(plan)} cambio(s) de estructura y padrón. Esta acción no se puede deshacer.`,
      { titulo: 'Aplicar carga maestra', textoAceptar: 'Aplicar carga' },
    )
    if (!ok) return
    correr(true)
  }

  const puedeAplicar = !!plan && !aplicado && plan.errores.length === 0 && !plan.bloqueadoPorCiclo

  return (
    <div className="space-y-4">
      <AvisoSoloEscritorio />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => descargarXlsx('plantilla-carga-maestra.xlsx', hojasPlantillaMaestra(catalogos))}
          className="flex items-center gap-1.5 rounded-xl border border-gris-claro bg-white px-4 py-2 text-[13px] font-bold transition hover:bg-hueso"
        >
          <Download size={14} />
          Descargar plantilla
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          onChange={(e) => {
            setArchivo(e.target.files?.[0] ?? null)
            setPlan(null)
            setAplicado(false)
            setError(null)
          }}
          className="text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-hueso-2 file:px-4 file:py-2.5 file:text-[13px] file:font-bold file:text-negro hover:file:bg-gris-claro"
        />
        <button
          disabled={!archivo || pendiente}
          onClick={() => correr(false)}
          className="rounded-xl border border-gris-claro bg-white px-4 py-2 text-[13px] font-bold transition hover:bg-hueso disabled:opacity-50"
        >
          {pendiente ? 'Analizando…' : 'Analizar archivo'}
        </button>
        {plan && !aplicado && (
          <button
            disabled={!puedeAplicar || pendiente}
            onClick={aplicar}
            title={plan.bloqueadoPorCiclo ? 'Hay un ciclo ACTIVO: la aplicación queda bloqueada hasta que cierre' : undefined}
            className="rounded-xl bg-marca px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark disabled:opacity-50"
          >
            {pendiente ? 'Aplicando…' : `Aplicar carga (${totalCambios(plan)} cambio(s)) →`}
          </button>
        )}
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-alerta-dark">{error}</p>}

      {plan && (
        <div className="space-y-4">
          {aplicado && (
            <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">Aplicado ✓</p>
          )}

          {plan.bloqueadoPorCiclo && !aplicado && (
            <p className="rounded-xl border border-red-200 bg-red-50/60 px-4 py-3 text-sm font-bold text-alerta-dark">
              Hay un ciclo activo: puedes revisar el análisis pero no aplicar.
            </p>
          )}

          {plan.errores.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50/60 px-4 py-3">
              <p className="mb-1.5 text-[13px] font-bold text-marca-dark">✕ {plan.errores.length} error(es) — corrígelos en el archivo y vuelve a analizar</p>
              <ul className="max-h-64 space-y-0.5 overflow-y-auto text-xs text-negro/80">
                {acotarRender(plan.errores).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          {plan.avisos.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
              <p className="mb-1.5 text-[13px] font-bold text-amber-800">⚠ {plan.avisos.length} aviso(s) — no bloquean, revísalos antes de aplicar</p>
              <ul className="max-h-64 space-y-0.5 overflow-y-auto text-xs text-negro/80">
                {acotarRender(plan.avisos).map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}

          <SeccionNiveles plan={plan} />
          <SeccionPuestos plan={plan} />
          <SeccionCompetencias plan={plan} />
          <SeccionPesos plan={plan} />
          <SeccionPadron plan={plan} />
        </div>
      )}
    </div>
  )
}
