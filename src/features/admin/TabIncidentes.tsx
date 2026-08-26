'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserX, Replace, Ban, ShieldAlert, RotateCcw } from 'lucide-react'
import { toast } from '@/shared/ui/Toast'
import { Combobox } from '@/shared/ui/Combobox'
import { retirarDelCiclo, reasignarEvaluador, cancelarAsignacion, invalidarEvaluacion, revertirInvalidacion } from '@/features/ciclos/acciones-rotacion'
import { buscarCandidatosParRrhh } from '@/features/admin/acciones'
import { btnMiniCls } from './edicion-inline'
import type { IncidenteEvaluado, InsumoPerdido } from '@/features/ciclos/incidentes'

export type BajaCiclo = {
  colaboradorId: string
  nombre: string
  puesto: string
  enviadasSobreEl: number
  pendientesSobreEl: number
  pendientesSuyas: number
  tieneResultado: boolean
  logrosFaltantes: number
  resuelta: boolean
}

const ETIQUETA: Record<string, string> = { AUTO: 'Autoevaluación', JEFE: 'Jefe directo', PAR: 'Par', ASCENDENTE: 'Ascendente' }

/** Resolución de UN insumo perdido: reasignar / no aplica (motivo) / además invalidar la
 * evaluación ya enviada del otro par (sesgo). Cada acción refresca y el incidente desaparece. */
function ResolverInsumo({ insumo, cicloId, evaluadoId, ejecutar, pendiente }: {
  insumo: InsumoPerdido
  cicloId: string
  evaluadoId: string
  ejecutar: (fn: () => Promise<{ ok: boolean; error?: string }>, exito: string) => void
  pendiente: boolean
}) {
  const [modo, setModo] = useState<'menu' | 'reasignar' | 'noaplica' | 'invalidar'>('menu')
  const [nuevoId, setNuevoId] = useState('')
  const [motivo, setMotivo] = useState('')
  const [confirmo, setConfirmo] = useState(false) // solo invalidar: acepta que afecta una evaluación ya respondida

  function cambiarModo(m: typeof modo) {
    setModo(m)
    setMotivo('')
    setNuevoId('')
    setConfirmo(false)
  }

  if (modo === 'menu') {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => cambiarModo('reasignar')} className={`${btnMiniCls} border border-gris-claro`}><Replace size={12} className="mr-1 inline -translate-y-px" />Reasignar</button>
        <button onClick={() => cambiarModo('noaplica')} className={`${btnMiniCls} border border-gris-claro`}><Ban size={12} className="mr-1 inline -translate-y-px" />No aplica…</button>
        {insumo.hermanaEnviada && (
          <button onClick={() => cambiarModo('invalidar')} className={`${btnMiniCls} border border-amber-300 text-amber-800`} title="Con este par de baja queda una sola voz de par: puedes invalidar también la del otro par por sesgo">
            <ShieldAlert size={12} className="mr-1 inline -translate-y-px" />Invalidar la de {insumo.hermanaEnviada.evaluador}…
          </button>
        )}
      </div>
    )
  }
  if (modo === 'reasignar') {
    /* Buscador SERVER-SIDE (mismo patrón que la asignación de pares en TablaParesRrhh): el padrón
       ya no viaja al cliente (el pool anterior materializaba hasta 1200 filas), y el universo es
       el MISMO que reasignarEvaluador acepta — cualquier país y con la antigüedad mínima. El pool
       acotado al país del RR.HH. escondía al reemplazo natural transfronterizo (el otro par
       ecuatoriano de un evaluado peruano) y el slot quedaba huérfano. */
    const buscar = async (q: string) => {
      const r = await buscarCandidatosParRrhh(cicloId, q)
      return r.filter((c) => c.id !== evaluadoId).map((c) => ({ id: c.id, nombre: c.nombre, detalle: c.pais }))
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-56">
          <Combobox name={`reasignar-${insumo.asignacionId}`} buscar={buscar} textoVacio="Nuevo evaluador — buscar…" onChange={(id) => setNuevoId(id)} />
        </div>
        <button disabled={pendiente || !nuevoId}
          onClick={() => ejecutar(() => reasignarEvaluador(insumo.asignacionId, nuevoId), 'Evaluación reasignada ✓')}
          className="rounded-lg bg-hunter px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-hunter-dark disabled:opacity-50">
          {pendiente ? 'Reasignando…' : 'Reasignar ✓'}
        </button>
        <button onClick={() => cambiarModo('menu')} className={btnMiniCls}>Cancelar</button>
      </div>
    )
  }
  // noaplica e invalidar comparten el formulario de motivo
  const esInvalidar = modo === 'invalidar'
  return (
    <div className="w-full max-w-md space-y-2">
      {esInvalidar && insumo.hermanaEnviada && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          Se cancela la pendiente de <b>{insumo.evaluador}</b> y se INVALIDA la evaluación ya respondida de <b>{insumo.hermanaEnviada.evaluador}</b> (queda como registro, fuera de la nota). Después puedes nominar pares de reemplazo.
        </p>
      )}
      <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} disabled={pendiente}
        placeholder={esInvalidar ? 'Motivo de la invalidación (auditado): sesgo por par único…' : 'Motivo (auditado): evaluador dado de baja, modalidad no aplica…'}
        className="w-full rounded-lg border border-gris-claro bg-white px-3 py-2 text-xs outline-none focus:border-hunter" />
      <p className="text-[10px] text-gris">
        Motivo obligatorio (mínimo 10 caracteres) · queda en el log de auditoría
        {motivo.trim().length > 0 && motivo.trim().length < 10 && <b className="text-amber-800"> · faltan {10 - motivo.trim().length}</b>}
      </p>
      {esInvalidar && insumo.hermanaEnviada && (
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-900">
          <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} disabled={pendiente} className="mt-0.5 accent-hunter" />
          <span>Entiendo que se <b>invalida la evaluación ya respondida</b> de {insumo.hermanaEnviada.evaluador}. Podré revertirlo desde esta pestaña <b>solo mientras el ciclo siga activo</b>; tras el cierre del país queda definitivo.</span>
        </label>
      )}
      <div className="flex items-center gap-2">
        <button disabled={pendiente || motivo.trim().length < 10 || (esInvalidar && !confirmo)}
          onClick={() => {
            if (esInvalidar && insumo.hermanaEnviada) {
              const hermanaId = insumo.hermanaEnviada.asignacionId
              ejecutar(async () => {
                // Primero la hermana: si falla, nada cambió y se puede reintentar completo.
                // Si la cancelación posterior falla, el incidente SIGUE visible (la pendiente existe)
                // y se resuelve con «No aplica» o reasignando — sin estados sin salida.
                const r1 = await invalidarEvaluacion(hermanaId, motivo)
                if (!r1.ok) return r1
                const r2 = await cancelarAsignacion(insumo.asignacionId, motivo)
                if (!r2.ok) return { ok: false, error: `La evaluación del otro par quedó invalidada, pero la pendiente no se pudo cancelar: ${r2.error ?? ''} Resuélvela con «No aplica» o reasignándola.` }
                return r2
              }, 'Par pendiente cancelado e invalidada la del otro par ✓')
            } else {
              ejecutar(() => cancelarAsignacion(insumo.asignacionId, motivo), 'Evaluación cancelada: no aplica ✓')
            }
          }}
          className="rounded-lg bg-hunter px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-hunter-dark disabled:opacity-50">
          {pendiente ? 'Aplicando…' : esInvalidar ? 'Cancelar pendiente + invalidar ✓' : 'Confirmar: no aplica ✓'}
        </button>
        <button onClick={() => cambiarModo('menu')} className={btnMiniCls}>Volver</button>
      </div>
    </div>
  )
}

/** Pestaña «Incidentes»: cambios del padrón que impactan el ciclo. Sección 1: evaluados
 * dados de baja (retiro con/sin nota). Sección 2: insumos perdidos por evaluado (el
 * evaluador se dio de baja con la evaluación sin enviar) — RR.HH. resuelve cada uno. */
export type EvaluacionInvalidada = { asignacionId: string; tipo: string; evaluado: string; evaluador: string }

export function TabIncidentes({ cicloId, bajas, incidentes, invalidadas, puedeGestionar = true }: {
  cicloId: string
  bajas: BajaCiclo[]
  incidentes: IncidenteEvaluado[]
  invalidadas: EvaluacionInvalidada[]
  puedeGestionar?: boolean // modo VER: muestra los incidentes sin acciones de resolución
}) {
  const router = useRouter()
  const [retiro, setRetiro] = useState<BajaCiclo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  function ejecutar(fn: () => Promise<{ ok: boolean; error?: string }>, exito: string) {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fn()
        if (!res.ok) {
          setError(res.error ?? 'No se pudo completar')
          router.refresh() // el flujo compuesto puede haber aplicado su primer paso
          return
        }
        setRetiro(null)
        toast(exito)
        router.refresh()
      } catch {
        setError('No se pudo completar la acción: intenta de nuevo')
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-5 rounded-2xl border border-gris-claro bg-white p-5">
      <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
        El padrón cambió desde el lanzamiento y el ciclo quedó impactado. Resuelve cada incidente: al <b>reasignar</b>, <b>marcar que no aplica</b> (con motivo auditado) o <b>retirar</b>, el incidente desaparece. El cambio de jefe con el anterior activo no es un incidente: él responde la evaluación de este ciclo.
      </p>
      {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-hunter-dark">{error}</p>}
      {pendiente && <p className="rounded-lg bg-sky-50 px-4 py-2.5 text-xs font-bold text-sky-700">Aplicando cambios y actualizando la lista…</p>}

      <div className={pendiente ? 'pointer-events-none space-y-5 opacity-60 transition-opacity' : 'space-y-5 transition-opacity'}>
      {bajas.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gris"><UserX size={12} className="mr-1 inline -translate-y-px" />Evaluados dados de baja · {bajas.length}</p>
          <ul className="space-y-2">
            {bajas.map((b) => (
              <li key={b.colaboradorId} className="rounded-xl border border-gris-claro px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold">{b.nombre}</p>
                    <p className="text-xs text-gris">{b.puesto} · {b.enviadasSobreEl} recibidas · {b.pendientesSobreEl} pendientes sobre él · {b.pendientesSuyas} pendientes suyas{b.tieneResultado ? ' · ya tiene nota conservada' : ''}</p>
                  </div>
                  {b.resuelta ? (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">Nota de salida conservada ✓</span>
                  ) : puedeGestionar && retiro?.colaboradorId !== b.colaboradorId && (
                    <button onClick={() => setRetiro(b)} className={`${btnMiniCls} border border-gris-claro`}>Retirar del ciclo…</button>
                  )}
                </div>
                {puedeGestionar && !b.resuelta && retiro?.colaboradorId === b.colaboradorId && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hueso-2 pt-3">
                    <button disabled={pendiente} onClick={() => ejecutar(() => retirarDelCiclo(cicloId, b.colaboradorId, false), 'Retirado del ciclo sin nota')}
                      className="rounded-lg border border-gris-claro px-3 py-1.5 text-[11px] font-bold transition hover:bg-hueso disabled:opacity-50">
                      Retirar SIN nota (borra su resultado)
                    </button>
                    <button disabled={pendiente || b.enviadasSobreEl === 0} title={b.enviadasSobreEl === 0 ? 'Sin evaluaciones recibidas no hay insumos para una nota' : undefined}
                      onClick={() => ejecutar(() => retirarDelCiclo(cicloId, b.colaboradorId, true), 'Retirado con nota de salida')}
                      className="rounded-lg bg-hunter px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-hunter-dark disabled:opacity-50">
                      Retirar CON nota de salida{b.logrosFaltantes > 0 ? ` (⚠ ${b.logrosFaltantes} logros sin cargar)` : ''}
                    </button>
                    <button onClick={() => setRetiro(null)} className={btnMiniCls}>Cancelar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {incidentes.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gris">Insumos impactados por evaluado · {incidentes.length}</p>
          <ul className="space-y-2">
            {incidentes.map((inc) => (
              <li key={inc.colaboradorId} className="rounded-xl border border-gris-claro px-4 py-3">
                <p className="text-sm font-bold">{inc.nombre} <span className="text-xs font-semibold text-gris">· {inc.puesto} · {inc.pais} · perdió {inc.insumos.length} insumo{inc.insumos.length === 1 ? '' : 's'}</span></p>
                <ul className="mt-2 space-y-2.5">
                  {inc.insumos.map((i) => (
                    <li key={i.asignacionId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-hueso px-3.5 py-2.5">
                      <span className="text-[13px]">
                        <b>{ETIQUETA[i.tipo]}</b> · {i.evaluador} <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-gris">dado de baja · {i.estado.toLowerCase()}</span>
                      </span>
                      {puedeGestionar
                        ? <ResolverInsumo insumo={i} cicloId={cicloId} evaluadoId={inc.colaboradorId} ejecutar={ejecutar} pendiente={pendiente} />
                        : <span className="text-[11px] text-gris">Insumo perdido</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      {invalidadas.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gris"><RotateCcw size={12} className="mr-1 inline -translate-y-px" />Evaluaciones invalidadas · {invalidadas.length}</p>
          <p className="mb-2 text-xs text-gris">Fuera de la nota y de los slots, conservadas como registro. Se pueden <b>rehabilitar mientras el ciclo siga activo</b> y el país del evaluado no haya cerrado; después quedan definitivas.</p>
          <ul className="space-y-1.5">
            {invalidadas.map((v) => (
              <li key={v.asignacionId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-hueso px-3.5 py-2.5">
                <span className="text-[13px]">
                  <b>{ETIQUETA[v.tipo] ?? v.tipo}</b> · {v.evaluador} sobre <b>{v.evaluado}</b> <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700">invalidada</span>
                </span>
                {puedeGestionar && (
                  <button disabled={pendiente}
                    onClick={() => ejecutar(() => revertirInvalidacion(v.asignacionId), 'Evaluación rehabilitada: vuelve a contar en la nota ✓')}
                    className={`${btnMiniCls} border border-gris-claro`}
                    title="Vuelve a ENVIADA: cuenta de nuevo en la nota, los contadores y el slot del par">
                    <RotateCcw size={12} className="mr-1 inline -translate-y-px" />{pendiente ? 'Rehabilitando…' : 'Rehabilitar'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>
    </div>
  )
}
