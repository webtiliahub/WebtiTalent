'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, MessageSquareWarning, ShieldCheck, CircleDashed } from 'lucide-react'
import { eximirConformidad, quitarExencionConformidad } from './acciones'
import { btnMiniCls } from './edicion-inline'
import { Avatar } from '@/shared/ui/componentes'
import type { FilaConformidad } from '@/features/ciclos/preflight'

/** Área → equipos (jefe) → filas; "Sin área"/"Sin jefe" al final de cada nivel. */
function agruparAreas(filas: FilaConformidad[]) {
  const alFinal = (s: string) => (s.startsWith('—') ? `zz${s}` : s)
  const porArea = new Map<string, FilaConformidad[]>()
  for (const f of filas) porArea.set(f.area, [...(porArea.get(f.area) ?? []), f])
  return [...porArea.entries()]
    .sort((a, b) => alFinal(a[0]).localeCompare(alFinal(b[0])))
    .map(([area, filasArea]) => {
      const porJefe = new Map<string, FilaConformidad[]>()
      for (const f of filasArea) porJefe.set(f.jefe, [...(porJefe.get(f.jefe) ?? []), f])
      return {
        area,
        filas: filasArea,
        jefes: [...porJefe.entries()]
          .sort((a, b) => alFinal(a[0]).localeCompare(alFinal(b[0])))
          .map(([jefe, filasJefe]) => ({ jefe, filas: filasJefe })),
      }
    })
}

const CHIPS: Record<FilaConformidad['estado'], { label: string; cls: string }> = {
  CONFORME: { label: 'Conforme ✓', cls: 'bg-emerald-50 text-emerald-700' },
  OBSERVADO: { label: 'Con observación', cls: 'bg-sky-50 text-sky-700' },
  EXIMIDO: { label: 'Eximido', cls: 'bg-violet-50 text-violet-700' },
  PENDIENTE: { label: '○ Pendiente', cls: 'bg-amber-50 text-amber-800' },
}

/** Fila con acción de exención: solo pendientes, solo RR.HH. Regional, motivo obligatorio. */
function AccionExencion({ fila, esRegional, cicloActivo }: { fila: FilaConformidad; esRegional: boolean; cicloActivo: boolean }) {
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  if (!cicloActivo) return null

  if (fila.estado === 'EXIMIDO') {
    if (!esRegional) return null
    return (
      <button
        disabled={pendiente}
        onClick={() => startTransition(async () => {
          const res = await quitarExencionConformidad(fila.resultadoId)
          if (!res.ok) setError(res.error)
        })}
        className={`${btnMiniCls} border border-gris-claro`}
        title="El colaborador volvió y puede confirmar: su conformidad vuelve a ser requisito del cierre"
      >
        {pendiente ? 'Retirando…' : 'Retirar exención'}
      </button>
    )
  }

  if (fila.estado !== 'PENDIENTE') return null
  if (!esRegional) return <span className="text-[11px] text-gris">Exime RR.HH. Regional</span>

  if (!abierto) {
    return <button onClick={() => setAbierto(true)} className={`${btnMiniCls} border border-gris-claro`}>Eximir…</button>
  }
  return (
    // Móvil: el ancho de la tarjeta (con w-72 fijo el formulario se salía de la pantalla)
    <div className="w-full space-y-2 md:w-72">
      <textarea
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        rows={2}
        placeholder="Motivo de la exención (queda en auditoría): vacaciones, licencia médica, sin cuenta…"
        className="w-full rounded-lg border border-gris-claro bg-white px-3 py-2 text-xs outline-none focus:border-marca"
      />
      <p className="text-[10px] text-gris">
        Motivo obligatorio (mínimo 10 caracteres) · queda en el log de auditoría
        {motivo.trim().length > 0 && motivo.trim().length < 10 && <b className="text-amber-800"> · faltan {10 - motivo.trim().length}</b>}
      </p>
      <div className="flex items-center gap-2">
        <button
          disabled={pendiente || motivo.trim().length < 10}
          onClick={() => startTransition(async () => {
            setError(null)
            const res = await eximirConformidad(fila.resultadoId, motivo)
            if (!res.ok) setError(res.error)
          })}
          className="flex-1 rounded-lg bg-marca px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-marca-dark disabled:opacity-50 md:flex-none"
        >
          {pendiente ? 'Eximiendo…' : 'Confirmar exención'}
        </button>
        <button onClick={() => { setAbierto(false); setMotivo(''); setError(null) }} className={`${btnMiniCls} flex-1 md:flex-none`}>Cancelar</button>
      </div>
      {error && <p className="text-[11px] text-marca-dark">{error}</p>}
    </div>
  )
}

/** Pestaña «Conformidad» del detalle del ciclo: quién confirmó su nota, quién falta y las
 * exenciones. El cierre del país/ciclo se bloquea mientras haya PENDIENTES sin eximir. */
export function TablaConformidad({ filas, esRegional, cicloActivo, puedeGestionar = true }: {
  filas: FilaConformidad[]
  esRegional: boolean
  cicloActivo: boolean
  puedeGestionar?: boolean // modo VER: sin acción de exención
}) {
  const conformes = filas.filter((f) => f.estado === 'CONFORME').length
  const observados = filas.filter((f) => f.estado === 'OBSERVADO').length
  const eximidos = filas.filter((f) => f.estado === 'EXIMIDO').length
  const pendientes = filas.filter((f) => f.estado === 'PENDIENTE').length
  const areas = agruparAreas(filas)

  const textoAviso = (
    <>Cada colaborador <b>confirma su nota</b> (conforme o con observación) desde <b>Mi resultado</b> cuando su vista previa está completa. El país <b>no puede cerrarse</b> mientras haya pendientes: si alguien no puede confirmar (vacaciones, licencia, sin cuenta), <b>RR.HH. Regional</b> lo exime por persona, con motivo que queda en el log de auditoría.</>
  )

  /* Tarjeta móvil: el chip de ESTADO junto al nombre (es lo que se busca de un barrido), país
     y fecha en su línea, el detalle legible y la acción a lo ancho. La tabla de 5 columnas
     medía ~640 px y había que arrastrarla de lado para ver estado y acción. */
  const tarjeta = (f: FilaConformidad) => (
    <li key={f.resultadoId} className={`rounded-xl border px-3 py-3 ${f.estado === 'PENDIENTE' ? 'border-amber-300 bg-amber-50/40' : f.estado === 'OBSERVADO' ? 'border-sky-200 bg-sky-50/30' : 'border-gris-claro bg-white'}`}>
      <div className="flex items-start gap-2.5">
        <Avatar nombre={f.nombre} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-bold leading-tight">{f.nombre}</p>
          <p className="text-xs text-gris">{f.puesto}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${CHIPS[f.estado].cls}`}>{CHIPS[f.estado].label}</span>
      </div>
      <div className="mt-2.5 flex flex-col gap-2 border-t border-hueso-2 pt-2.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-gris">
          <span>{f.pais}{f.fecha ? ` · ${f.fecha}` : ''}</span>
          {/* «Sin cuenta» como chip: es el dato que explica por qué hay que eximir, no un
              sufijo del puesto */}
          {f.sinCuenta && <span className="rounded-full bg-hueso-2 px-2 py-0.5 text-[10.5px] font-bold text-gris" title="No tiene cuenta: no puede confirmar su nota">sin cuenta</span>}
        </p>
        {/* Observación y motivo en dos líneas: en el teléfono no hay hover que revele el title */}
        {f.estado === 'OBSERVADO' && f.observacion && <p className="line-clamp-2 rounded-lg bg-hueso px-2.5 py-1.5 text-xs">“{f.observacion}”</p>}
        {f.estado === 'EXIMIDO' && f.motivoExencion && <p className="line-clamp-2 rounded-lg bg-hueso px-2.5 py-1.5 text-xs">Motivo: {f.motivoExencion}</p>}
        {puedeGestionar && (
          <div className="[&>button]:w-full">
            <AccionExencion fila={f} esRegional={esRegional} cicloActivo={cicloActivo} />
          </div>
        )}
      </div>
    </li>
  )

  /* Pendientes primero: son los que bloquean el cierre del país. Solo en móvil — el
     escritorio conserva el orden con el que llegan las filas. */
  const listaMovil = (filasLista: FilaConformidad[]) => (
    <ul className="space-y-2.5">
      {[...filasLista.filter((f) => f.estado === 'PENDIENTE'), ...filasLista.filter((f) => f.estado !== 'PENDIENTE')].map((f) => tarjeta(f))}
    </ul>
  )

  return (
    <div className="rounded-2xl border border-gris-claro bg-white p-5">
      {/* Móvil: plegado; escritorio: el párrafo completo */}
      <details className="group/av mb-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 md:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-bold [&::-webkit-details-marker]:hidden">
          <span className="transition group-open/av:rotate-90">›</span>
          Cómo se confirma la nota
        </summary>
        <p className="mt-2 leading-relaxed">{textoAviso}</p>
      </details>
      <p className="mb-4 hidden rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 md:block">{textoAviso}</p>

      {/* Móvil: rejilla 2×2 con los pendientes primero (se envolvían en filas dispares);
          escritorio: la fila de siempre */}
      <div className="mb-4 grid grid-cols-2 gap-2 text-[11px] font-bold md:flex md:flex-wrap">
        <span className="flex items-center justify-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700 md:justify-start md:py-1"><CheckCircle2 size={13} className="shrink-0" />{conformes} conforme{conformes === 1 ? '' : 's'}</span>
        <span className="flex items-center justify-center gap-1.5 rounded-full bg-sky-50 px-3 py-1.5 text-sky-700 md:justify-start md:py-1"><MessageSquareWarning size={13} className="shrink-0" />{observados} con observación</span>
        <span className="flex items-center justify-center gap-1.5 rounded-full bg-violet-50 px-3 py-1.5 text-violet-700 md:justify-start md:py-1"><ShieldCheck size={13} className="shrink-0" />{eximidos} eximido{eximidos === 1 ? '' : 's'}</span>
        <span className="order-first flex items-center justify-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-amber-800 md:order-none md:justify-start md:py-1"><CircleDashed size={13} className="shrink-0" />{pendientes} pendiente{pendientes === 1 ? '' : 's'}</span>
      </div>

      {filas.length === 0 ? (
        <p className="rounded-xl bg-hueso px-4 py-3 text-sm text-gris">Aún no hay colaboradores con nota: la conformidad se pide cuando la vista previa de cada uno está completa.</p>
      ) : (
        <div className="space-y-3">
          {areas.map((a) => {
            const resueltasArea = a.filas.filter((f) => f.estado !== 'PENDIENTE').length
            return (
              <details key={a.area} open={areas.length === 1 ? true : undefined} className="group/area rounded-xl border-2 border-gris-claro">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl bg-hueso/60 px-4 py-3 transition hover:bg-hueso [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-center gap-2 font-display text-[13px] font-bold">
                    <span className="shrink-0 text-gris transition group-open/area:rotate-90">›</span>
                    <span className="min-w-0">
                      <span className="block truncate md:inline">{a.area}</span>
                      {/* Con un solo equipo el jefe vive aquí y en móvil el equipo no lleva rótulo aparte */}
                      <span className="block truncate text-[11px] font-semibold text-gris md:inline md:ps-1.5">
                        {a.jefes.length === 1 ? `${a.jefes[0].jefe} · ` : ''}{a.filas.length} con nota
                      </span>
                    </span>
                  </span>
                  {resueltasArea === a.filas.length
                    ? <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">{resueltasArea}/{a.filas.length} ✓</span>
                    : <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">{resueltasArea}/{a.filas.length}</span>}
                </summary>

                {/* Cobertura del área de un barrido, sin abrirla (solo móvil) */}
                <div className="mx-4 mb-2 h-[3px] overflow-hidden rounded-full bg-hueso-2 md:hidden">
                  <i className={`block h-full rounded-full ${resueltasArea === a.filas.length ? 'bg-emerald-600' : 'bg-amber-500'}`} style={{ width: `${Math.round((resueltasArea / a.filas.length) * 100)}%` }} />
                </div>

                {/* ── Móvil: tarjetas ── */}
                <div className="space-y-2.5 p-3 pt-0 md:hidden">
                  {a.jefes.length === 1
                    ? listaMovil(a.jefes[0].filas)
                    : a.jefes.map((j) => {
                        const resueltas = j.filas.filter((f) => f.estado !== 'PENDIENTE').length
                        return (
                          <details key={j.jefe} className="group rounded-xl border border-gris-claro">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                              <span className="flex min-w-0 items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-gris">
                                <span className="shrink-0 transition group-open:rotate-90">›</span>
                                <span className="truncate">Equipo de {j.jefe}</span>
                              </span>
                              {resueltas === j.filas.length
                                ? <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">{resueltas}/{j.filas.length} ✓</span>
                                : <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">{resueltas}/{j.filas.length}</span>}
                            </summary>
                            <div className="px-3 pb-3">{listaMovil(j.filas)}</div>
                          </details>
                        )
                      })}
                </div>

                {/* ── Escritorio: la tabla de siempre, intacta ── */}
                <div className="hidden space-y-3 p-3 md:block">
                  {a.jefes.map((j) => (
                    <div key={j.jefe}>
                      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-gris">Equipo de {j.jefe}</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gris-claro text-left text-[11px] font-bold uppercase tracking-wide text-gris">
                              <th className="py-2 pr-3">Colaborador</th>
                              <th className="py-2 pr-3">País</th>
                              <th className="py-2 pr-3">Estado</th>
                              <th className="py-2 pr-3">Detalle</th>
                              <th className="py-2 pr-3"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {j.filas.map((f) => (
                              <tr key={f.resultadoId} className="border-b border-hueso-2 align-middle">
                                <td className="py-2.5 pr-3">
                                  <p className="font-bold">{f.nombre}</p>
                                  <p className="text-xs text-gris">{f.puesto}{f.sinCuenta ? ' · sin cuenta (no puede confirmar)' : ''}</p>
                                </td>
                                <td className="py-2.5 pr-3 text-xs">{f.pais}</td>
                                <td className="py-2.5 pr-3">
                                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${CHIPS[f.estado].cls}`}>{CHIPS[f.estado].label}</span>
                                  {f.fecha && <span className="ml-2 text-[11px] text-gris">{f.fecha}</span>}
                                </td>
                                <td className="max-w-xs py-2.5 pr-3">
                                  {f.estado === 'OBSERVADO' && f.observacion && <p className="truncate text-xs text-gris" title={f.observacion}>“{f.observacion}”</p>}
                                  {f.estado === 'EXIMIDO' && f.motivoExencion && <p className="truncate text-xs text-gris" title={f.motivoExencion}>Motivo: {f.motivoExencion}</p>}
                                </td>
                                <td className="py-2.5 pr-3 text-right">
                                  {puedeGestionar && <AccionExencion fila={f} esRegional={esRegional} cicloActivo={cicloActivo} />}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )
          })}
        </div>
      )}
    </div>
  )
}
