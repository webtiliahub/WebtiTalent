'use client'

import { Rocket, Trash2 } from 'lucide-react'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { lanzarCiclo, eliminarCiclo, asignarPar, aprobarPar, rechazarPar, quitarParRrhh, calibrarDetallado, cerrarCiclo, publicarResultados, cerrarPaisCiclo, publicarPaisCiclo, exportarResultadosCiclo, buscarCandidatosParRrhh } from './acciones'
import { descargarCsv } from '@/shared/ui/csv'
import { toast } from '@/shared/ui/Toast'
import { Combobox } from '@/shared/ui/Combobox'
import { Modal } from '@/shared/ui/Modal'
import { notaCompetenciasDesdeDesglose, cumplimientoObjetivos, notaFinal } from '@/domain/calculo'
import { Avatar, Nota } from '@/shared/ui/componentes'
import type { Preflight } from '@/features/ciclos/preflight'

/** Verificación de pre-vuelo: el último gate antes del lanzamiento (irreversible).
 * Bloqueantes en rojo impiden lanzar; avisos en ámbar exigen mirada consciente.
 * Confirmación proporcional al riesgo: hay que escribir el nombre del ciclo. */
export function PreflightLanzamiento({ cicloId, cicloNombre, preflight }: {
  cicloId: string
  cicloNombre: string
  preflight: Preflight
}) {
  const router = useRouter()
  const [confirmacion, setConfirmacion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()
  const pf = preflight

  const check = (ok: boolean, esAviso: boolean, titulo: string, detalle?: React.ReactNode) => (
    <li className={`rounded-xl border px-3.5 py-2.5 text-[13px] ${ok ? 'border-emerald-200 bg-emerald-50/50' : esAviso ? 'border-amber-200 bg-amber-50/60' : 'border-red-200 bg-red-50/60'}`}>
      <p className={`font-bold ${ok ? 'text-emerald-700' : esAviso ? 'text-amber-800' : 'text-alerta-dark'}`}>
        {ok ? '✓' : esAviso ? '⚠' : '✕'} {titulo}
      </p>
      {!ok && detalle && <div className="mt-1 text-[12px] text-negro/70">{detalle}</div>}
    </li>
  )

  const nombres = (xs: string[]) => xs.slice(0, 5).join(', ') + (xs.length > 5 ? ` y ${xs.length - 5} más` : '')
  const puedeLanzar = pf.listo && confirmacion.trim() === cicloNombre

  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-display text-sm font-bold">Verificación de lanzamiento</h4>
        <p className="text-xs text-gris">Lanzar es irreversible: genera las evaluaciones de todo el alcance. Revisa cada punto antes de confirmar.</p>
      </div>

      <ul className="space-y-2">
        {check(
          pf.bloqueantes.periodoYaEvaluado === null, false,
          pf.bloqueantes.periodoYaEvaluado === null
            ? 'El período no fue evaluado por otro ciclo'
            : `El período ya es evaluado por «${pf.bloqueantes.periodoYaEvaluado.ciclo}» (${pf.bloqueantes.periodoYaEvaluado.estado === 'ACTIVO' ? 'activo' : 'cerrado'})`,
          <p>Los logros de objetivos son únicos por período: un segundo ciclo pisaría el detalle de resultados ya calculados o publicados. Crea un período de objetivos nuevo para este ciclo.</p>,
        )}
        {/* Sin período no hay objetivos que evaluar: el aviso ámbar sinObjetivos ya lo explica */}
        {!pf.avisos.sinObjetivos && check(
          pf.bloqueantes.objetivosIncompletos.length === 0, false,
          pf.bloqueantes.objetivosIncompletos.length === 0
            ? `Objetivos al 100% aprobados (${pf.colaboradores} colaboradores)`
            : `${pf.bloqueantes.objetivosIncompletos.length} colaborador${pf.bloqueantes.objetivosIncompletos.length === 1 ? '' : 'es'} sin objetivos completos`,
          <p>{pf.bloqueantes.objetivosIncompletos.slice(0, 5).map((x) => `${x.nombre} (${x.pct}%)`).join(', ')}{pf.bloqueantes.objetivosIncompletos.length > 5 ? ` y ${pf.bloqueantes.objetivosIncompletos.length - 5} más` : ''} — complétalos o extiéndeles el plazo desde el período de objetivos (Ciclos de evaluación → Períodos).</p>,
        )}
        {check(
          pf.bloqueantes.cuestionariosVacios.length === 0, false,
          pf.bloqueantes.cuestionariosVacios.length === 0
            ? 'Todos los colaboradores con puesto tienen cuestionario'
            : `${pf.bloqueantes.cuestionariosVacios.length} colaborador${pf.bloqueantes.cuestionariosVacios.length === 1 ? '' : 'es'} quedarían con cuestionario VACÍO`,
          <ul className="list-disc pl-4">{pf.bloqueantes.cuestionariosVacios.slice(0, 5).map((x) => <li key={x.nombre}><b>{x.nombre}</b>: {x.causa}</li>)}</ul>,
        )}
        {check(
          !pf.bloqueantes.sinEvaluados, false,
          !pf.bloqueantes.sinEvaluados
            ? 'El alcance incluye al menos un evaluado'
            : 'El alcance no incluye a ningún evaluado: edita el ciclo y ajusta filtros o ajustes manuales.',
        )}
        {check(pf.avisos.sinPuesto.length === 0, true,
          pf.avisos.sinPuesto.length === 0 ? 'Todos los colaboradores tienen puesto' : `${pf.avisos.sinPuesto.length} sin puesto (no recibirán cuestionario de competencias)`,
          <p>{nombres(pf.avisos.sinPuesto)} — si corresponde, asígnales puesto antes de lanzar.</p>,
        )}
        {check(pf.avisos.sinJefe.length === 0, true,
          pf.avisos.sinJefe.length === 0 ? 'Todos tienen jefe directo que puede evaluarlos' : `${pf.avisos.sinJefe.length} sin jefe que pueda evaluarlos (no tendrán evaluación descendente)`,
          <p>{nombres(pf.avisos.sinJefe)} — sin jefe registrado, o su jefe está inactivo o excluido por antigüedad. El jefe evalúa aunque sea de otro país o no participe del ciclo.</p>,
        )}
        {check(pf.avisos.evaluadoresExternos.filter((x) => x.sinCuenta).length === 0, true,
          pf.avisos.evaluadoresExternos.length === 0
            ? 'Sin evaluadores externos al ciclo'
            : `${pf.avisos.evaluadoresExternos.length} evaluador${pf.avisos.evaluadoresExternos.length === 1 ? '' : 'es'} externo${pf.avisos.evaluadoresExternos.length === 1 ? '' : 's'} al ciclo (jefes o reportes de participantes)${pf.avisos.evaluadoresExternos.filter((x) => x.sinCuenta).length > 0 ? ` · ${pf.avisos.evaluadoresExternos.filter((x) => x.sinCuenta).length} SIN CUENTA` : ''}`,
          <ul className="list-disc space-y-0.5 pl-4">
            {pf.avisos.evaluadoresExternos.slice(0, 6).map((x) => (
              <li key={x.nombre}>
                <b>{x.nombre}</b> ({x.pais}): {x.relacion}{x.sinCuenta ? ' — ⚠ sin cuenta: no podrá responder' : ''}
              </li>
            ))}
            {pf.avisos.evaluadoresExternos.length > 6 && <li>y {pf.avisos.evaluadoresExternos.length - 6} más</li>}
          </ul>,
        )}
        {check(pf.avisos.sinCuenta.length === 0, true,
          pf.avisos.sinCuenta.length === 0 ? 'Todos tienen cuenta para entrar a responder' : `${pf.avisos.sinCuenta.length} sin cuenta de usuario (no podrán entrar a responder)`,
          <p>{nombres(pf.avisos.sinCuenta)} — créales cuenta en Configuración → Usuarios.</p>,
        )}
        {check(pf.avisos.nivelesSinEvaluacion.length === 0, true,
          pf.avisos.nivelesSinEvaluacion.length === 0 ? 'Todos los niveles del alcance tienen evaluación' : 'Niveles sin evaluación en este ciclo',
          <p>{pf.avisos.nivelesSinEvaluacion.map((x) => `${x.nivel} (${x.afectados} colaborador${x.afectados === 1 ? '' : 'es'})`).join(', ')}</p>,
        )}
        {check(pf.avisos.coberturaParcial.length === 0, true,
          pf.avisos.coberturaParcial.length === 0
            ? 'Los formularios cubren todas las competencias de cada puesto'
            : `${pf.avisos.coberturaParcial.length} colaborador${pf.avisos.coberturaParcial.length === 1 ? '' : 'es'} con formulario que NO evalúa todas sus competencias`,
          <ul className="list-disc space-y-0.5 pl-4">
            {pf.avisos.coberturaParcial.map((x) => (
              <li key={x.nombre}>
                <b>{x.nombre}</b> ({x.puesto}): quedan sin evaluar {x.faltan.join(', ')}
              </li>
            ))}
          </ul>,
        )}
        {/* Sin período no aplica «abierto/cerrado»: el aviso ámbar sinObjetivos ya lo explica */}
        {!pf.avisos.sinObjetivos && check(!pf.avisos.periodoAbierto, true,
          !pf.avisos.periodoAbierto ? 'El período de objetivos está cerrado (objetivos congelados)' : 'La carga de objetivos sigue abierta',
          <p>Idealmente ciérrala antes de lanzar, para que los objetivos no cambien durante la evaluación.</p>,
        )}
        {check(pf.avisos.excluidosAntiguedad.length === 0, true,
          pf.avisos.excluidosAntiguedad.length === 0
            ? 'Todos cumplen la antigüedad mínima (6 meses al inicio del ciclo)'
            : `${pf.avisos.excluidosAntiguedad.length} queda${pf.avisos.excluidosAntiguedad.length === 1 ? '' : 'n'} FUERA del ciclo por antigüedad menor a 6 meses`,
          <p>
            {pf.avisos.excluidosAntiguedad.slice(0, 5).map((x) => `${x.nombre} (ingresó ${x.ingreso})`).join(', ')}
            {pf.avisos.excluidosAntiguedad.length > 5 ? ` y ${pf.avisos.excluidosAntiguedad.length - 5} más` : ''} — no serán evaluados ni evaluadores en este ciclo. Su carga de objetivos del período sigue activa y entrarán automáticamente al siguiente ciclo.
          </p>,
        )}
        {check(pf.avisos.incluidosRechazados.length === 0, true,
          pf.avisos.incluidosRechazados.length === 0
            ? 'Sin agregados manuales rechazados'
            : `${pf.avisos.incluidosRechazados.length} agregado${pf.avisos.incluidosRechazados.length === 1 ? '' : 's'} manualmente que NO entrará${pf.avisos.incluidosRechazados.length === 1 ? '' : 'n'} al ciclo`,
          <p>
            Agregados manualmente que NO entrarán: {pf.avisos.incluidosRechazados
              .map((x) => `${x.nombre} (${x.motivo === 'INACTIVO' ? 'inactivo' : x.motivo === 'FUERA_DE_PAIS' ? 'fuera de los países del alcance' : 'menos de 6 meses de antigüedad al inicio'})`)
              .join(' · ')}
          </p>,
        )}
        {check(pf.avisos.sinFechaIngreso.length === 0, true,
          pf.avisos.sinFechaIngreso.length === 0
            ? 'Todos tienen fecha de ingreso registrada'
            : `${pf.avisos.sinFechaIngreso.length} sin fecha de ingreso (se INCLUYEN en el ciclo)`,
          <p>{nombres(pf.avisos.sinFechaIngreso)} — sin el dato no se aplica la regla de antigüedad; complétala en su ficha si corresponde excluirlos.</p>,
        )}
        {check(!pf.avisos.sinObjetivos, true,
          pf.avisos.sinObjetivos
            ? 'Este ciclo no evalúa objetivos: la nota final será 100% competencias'
            : 'Este ciclo evalúa objetivos del período elegido',
        )}
        {/* Sin período no hay alcance de período que verificar: la fila solo aplica a ciclos con objetivos */}
        {!pf.avisos.sinObjetivos && check(pf.avisos.fueraDelPeriodo.length === 0, true,
          pf.avisos.fueraDelPeriodo.length === 0
            ? 'Todos los participantes están dentro del alcance del período elegido'
            : `${pf.avisos.fueraDelPeriodo.length} participante${pf.avisos.fueraDelPeriodo.length === 1 ? '' : 's'} ${pf.avisos.fueraDelPeriodo.length === 1 ? 'está' : 'están'} fuera del alcance del período elegido: ajusta el alcance del período o exclúyelos del ciclo`,
          <p>{nombres(pf.avisos.fueraDelPeriodo)}</p>,
        )}
      </ul>

      <div className="rounded-xl bg-hueso-2 px-4 py-3 text-[13px]">
        Se generarán <b>{pf.impacto.total} evaluaciones</b> ({pf.impacto.auto} autoevaluaciones · {pf.impacto.jefe} de jefe · {pf.impacto.ascendente} ascendentes) para <b>{pf.colaboradores} colaboradores</b>.
        Los pares se asignan después del lanzamiento. Los colaboradores verán sus evaluaciones al iniciar sesión.
      </div>

      <div className="rounded-2xl border border-marca/30 bg-blue-50/40 p-4">
        <p className="text-[13px] font-bold">Confirmación final</p>
        <p className="mt-0.5 text-xs text-gris">Escribe el nombre del ciclo (<b className="text-negro">{cicloNombre}</b>) para habilitar el lanzamiento.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            value={confirmacion}
            onChange={(e) => setConfirmacion(e.target.value)}
            placeholder={cicloNombre}
            disabled={!pf.listo}
            className="min-w-0 flex-1 rounded-xl border border-gris-claro bg-white px-3.5 py-2.5 text-sm outline-none focus:border-marca disabled:opacity-50"
          />
          <button
            disabled={!puedeLanzar || pendiente}
            onClick={() => startTransition(async () => {
              setError(null)
              const res = await lanzarCiclo(cicloId)
              if (!res.ok) setError(res.error)
              else {
                toast(`Ciclo lanzado: ${res.total} evaluaciones generadas`)
                router.refresh()
              }
            })}
            className="rounded-xl bg-marca px-5 py-2.5 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark disabled:opacity-40"
          >
            <Rocket size={14} className="mr-1 inline -translate-y-px" />{pendiente ? 'Lanzando…' : 'Lanzar ciclo'}
          </button>
        </div>
        {!pf.listo && <p className="mt-2 text-xs font-bold text-marca-dark">Resuelve los puntos en rojo para habilitar el lanzamiento.</p>}
        {error && <p className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-sm text-alerta-dark">{error}</p>}
      </div>

      <div className="flex justify-end border-t border-gris-claro pt-3">
        <EliminarBorradorCiclo cicloId={cicloId} cicloNombre={cicloNombre} />
      </div>
    </div>
  )
}

/** Eliminar un ciclo en borrador: nadie fue notificado ni respondió, así que se descarta
 * completo (snapshot incluido). Un ciclo lanzado nunca se elimina — es historial. */
function EliminarBorradorCiclo({ cicloId, cicloNombre }: { cicloId: string; cicloNombre: string }) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  const eliminar = () => {
    startTransition(async () => {
      setError(null)
      const res = await eliminarCiclo(cicloId)
      if (!res.ok) { setError(res.error); return }
      toast('Borrador de ciclo eliminado')
      router.push('/admin/ciclos')
    })
  }

  return (
    <>
      <button
        onClick={() => { setError(null); setAbierto(true) }}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-gris transition hover:text-marca"
      >
        <Trash2 size={13} /> Eliminar este borrador
      </button>
      <Modal titulo="Eliminar borrador" abierto={abierto} onCerrar={() => setAbierto(false)}>
        <p className="text-sm">
          Se descartará el ciclo <b>{cicloNombre}</b> con su configuración y el snapshot de preguntas.
          Nadie fue notificado ni respondió nada, así que no se pierde información de evaluaciones.
        </p>
        <p className="mt-1.5 text-xs text-gris">Esta acción no se puede deshacer.</p>
        {error && <p className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-sm text-alerta-dark">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setAbierto(false)} className="rounded-xl border border-gris-claro px-4 py-2 text-[13px] font-bold transition hover:bg-hueso">Cancelar</button>
          <button
            disabled={pendiente}
            onClick={eliminar}
            className="rounded-xl bg-marca px-4 py-2 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark disabled:opacity-40"
          >
            {pendiente ? 'Eliminando…' : 'Eliminar borrador'}
          </button>
        </div>
      </Modal>
    </>
  )
}

type ParSlot = { asignacionId: string; evaluadorId: string; nombre: string; estado: string }
type MiembroPares = { id: string; nombre: string; puesto: string; jefeId: string | null; pares: ParSlot[] }
type GrupoEquipo = { jefeId: string | null; jefe: string; miembros: MiembroPares[] }

/** Vista de RR.HH.: los colaboradores del alcance agrupados por jefe directo, con sus 2 slots
 * de pares. La nominación es de los jefes; aquí se VALIDA la cobertura y se interviene solo
 * como último recurso (slots vacíos, retirar mal asignados, resolver propuestas externas). */
export function TablaParesRrhh({ cicloId, grupos, soloLectura = false }: {
  cicloId: string
  grupos: GrupoEquipo[]
  soloLectura?: boolean // ciclo cerrado: la tabla queda como registro histórico de nominaciones
}) {
  const router = useRouter()
  const [pendiente, startTransition] = useTransition()

  const correr = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => {
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) { toast(res.error ?? 'No se pudo completar'); return }
      toast(okMsg)
      router.refresh()
    })
  }

  const celda = (m: MiembroPares, slot: number) => {
    const p = m.pares[slot]
    if (p) {
      if (p.estado === 'PROPUESTA') {
        return (
          <span className="inline-flex flex-wrap items-center gap-1.5 text-[13px]">
            {p.nombre}
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">{soloLectura ? 'propuesta sin resolver' : 'propuesta del jefe'}</span>
            {!soloLectura && <>
              <button type="button" disabled={pendiente} onClick={() => correr(() => aprobarPar(p.asignacionId), 'Propuesta aprobada: el par ya puede evaluar')} title="Aprobar propuesta" className="rounded-md bg-emerald-600 px-1.5 py-0.5 text-[11px] font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50">✓</button>
              <button type="button" disabled={pendiente} onClick={() => correr(() => rechazarPar(p.asignacionId), 'Propuesta rechazada')} title="Rechazar propuesta" className="rounded-md border border-gris-claro px-1.5 py-0.5 text-[11px] font-bold text-gris transition hover:bg-red-50 hover:text-alerta disabled:opacity-50">✕</button>
            </>}
          </span>
        )
      }
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5 text-[13px]">
          {p.nombre}
          {p.estado === 'ENVIADA'
            ? <span className="text-[10px] font-bold text-emerald-700">respondió ✓</span>
            : soloLectura
              ? <span className="text-[10px] font-bold text-gris">no respondió</span>
              : <button type="button" disabled={pendiente} onClick={() => correr(() => quitarParRrhh(p.asignacionId), 'Par retirado')} title="Retirar par" className="font-bold text-gris transition hover:text-marca">✕</button>}
        </span>
      )
    }
    if (soloLectura) return <span className="text-xs text-gris">— sin asignar</span>
    // Slot libre: RR.HH. asigna directo (último recurso)
    // Buscador SERVER-SIDE (el padrón ya no viaja al cliente, ni se duplicaba por área): ≤20 por
    // término, acotado al alcance de país del RR.HH. Los del mismo equipo van primero.
    const yaAsignados = new Set(m.pares.map((x) => x.evaluadorId))
    const buscar = async (q: string) => {
      const r = await buscarCandidatosParRrhh(cicloId, q)
      const libres = r.filter((x) => x.id !== m.id && x.id !== m.jefeId && !yaAsignados.has(x.id))
      return [
        ...libres.filter((x) => x.jefeId === m.jefeId).map((x) => ({ id: x.id, nombre: x.nombre, detalle: 'su equipo' })),
        ...libres.filter((x) => x.jefeId !== m.jefeId).map((x) => ({ id: x.id, nombre: x.nombre, detalle: 'otro equipo' })),
      ]
    }
    return (
      <div className="w-full md:max-w-[230px]">
        <Combobox
          name={`par-${m.id}-${slot}`}
          buscar={buscar}
          textoVacio="⚠ Sin asignar — buscar…"
          onChange={(id) => { if (id && !pendiente) correr(() => asignarPar(cicloId, id, m.id), 'Par asignado ✓') }}
        />
      </div>
    )
  }

  /* ───────── Móvil ─────────
     La tabla de 3 columnas partía el nombre en tres líneas y recortaba el buscador a «⚠ Si…».
     Mismo patrón que ya usa el jefe en «Evaluar a mi equipo» (NominadorPares): una tarjeta por
     colaborador con los dos pares a lo ancho, y las acciones como botones tocables. */
  const celdaMovil = (m: MiembroPares, slot: number) => {
    const p = m.pares[slot]
    if (!p) {
      if (soloLectura) return <span className="text-xs text-gris">— sin asignar</span>
      return celda(m, slot) // el Combobox ya ocupa el ancho de la fila
    }
    if (p.estado === 'PROPUESTA') {
      return (
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-1.5 text-[13px]">
            <span className="min-w-0 truncate">{p.nombre}</span>
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">{soloLectura ? 'propuesta sin resolver' : 'propuesta del jefe'}</span>
          </p>
          {!soloLectura && (
            // Botones con texto: el ✓/✕ de 11 px del escritorio es imposible de acertar con el dedo
            <div className="flex gap-2">
              <button type="button" disabled={pendiente} onClick={() => correr(() => aprobarPar(p.asignacionId), 'Propuesta aprobada: el par ya puede evaluar')} className="flex-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50">Aprobar</button>
              <button type="button" disabled={pendiente} onClick={() => correr(() => rechazarPar(p.asignacionId), 'Propuesta rechazada')} className="flex-1 rounded-xl border border-gris-claro bg-white px-3 py-2 text-xs font-bold text-gris transition hover:border-marca hover:text-marca disabled:opacity-50">Rechazar</button>
            </div>
          )}
        </div>
      )
    }
    return (
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px]">{p.nombre}</span>
        {p.estado === 'ENVIADA'
          ? <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">respondió ✓</span>
          : soloLectura
            ? <span className="shrink-0 text-[10px] font-bold text-gris">no respondió</span>
            : <button type="button" disabled={pendiente} onClick={() => correr(() => quitarParRrhh(p.asignacionId), 'Par retirado')} title="Retirar par" aria-label={`Retirar a ${p.nombre}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-gris-claro text-sm font-bold text-gris transition hover:border-marca hover:text-marca disabled:opacity-50">✕</button>}
      </div>
    )
  }

  const listaMovil = (g: GrupoEquipo, conBorde: boolean) => (
    <ul className={`space-y-2.5 ${conBorde ? 'px-3 pb-3' : ''}`}>
      {g.miembros.map((m) => (
        <li key={m.id} className="rounded-xl border border-gris-claro bg-white px-3 py-3">
          <div className="flex items-start gap-2.5">
            <Avatar nombre={m.nombre} size="sm" />
            <div className="min-w-0">
              <p className="text-[13.5px] font-bold leading-tight">{m.nombre}</p>
              <p className="text-xs text-gris">{m.puesto}</p>
            </div>
          </div>
          <div className="mt-2.5 space-y-2">
            {[0, 1].map((slot) => (
              <div key={slot} className="flex items-start gap-2.5">
                <span className="mt-1.5 w-10 shrink-0 text-[10px] font-extrabold tracking-wide text-gris">PAR {slot + 1}</span>
                <div className="min-w-0 flex-1">{celdaMovil(m, slot)}</div>
              </div>
            ))}
          </div>
          {m.pares.length > 2 && <p className="mt-1.5 text-[11px] text-gris">+{m.pares.length - 2} adicional{m.pares.length - 2 === 1 ? '' : 'es'}</p>}
        </li>
      ))}
    </ul>
  )

  return (
    <div className="space-y-2">
      {/* Móvil: con un solo equipo en el área NO se dibuja la caja del equipo (caja dentro de
          caja parecía un grupo vacío); el jefe pasa a la cabecera del área. Con dos o más,
          cabecera compacta de una línea. */}
      <div className="space-y-2 md:hidden">
        {grupos.length === 1
          ? listaMovil(grupos[0], false)
          : grupos.map((g) => {
              const cubiertos = g.miembros.filter((m) => m.pares.filter((p) => p.estado !== 'PROPUESTA').length >= 2).length
              return (
                <details key={g.jefeId ?? '__sin_jefe__'} className="group rounded-xl border border-gris-claro">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                    <span className="flex min-w-0 items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-gris">
                      <span className="shrink-0 transition group-open:rotate-90">›</span>
                      <span className="truncate">{g.jefeId ? `Equipo de ${g.jefe}` : 'Sin jefe directo'}</span>
                    </span>
                    {cubiertos === g.miembros.length
                      ? <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">{cubiertos}/{g.miembros.length} ✓</span>
                      : <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">{cubiertos}/{g.miembros.length}</span>}
                  </summary>
                  {listaMovil(g, true)}
                </details>
              )
            })}
      </div>

      {/* Escritorio: la tabla de siempre, intacta */}
      <div className="hidden space-y-2 md:block">
      {grupos.map((g) => {
        const cubiertos = g.miembros.filter((m) => m.pares.filter((p) => p.estado !== 'PROPUESTA').length >= 2).length
        return (
          // Un área con un solo equipo se abre sola: el doble anidado colapsado parecía un grupo vacío
          <details key={g.jefeId ?? '__sin_jefe__'} open={grupos.length === 1 ? true : undefined} className="group rounded-xl border border-gris-claro">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 transition hover:bg-hueso [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-gris">
                <span className="transition group-open:rotate-90">›</span>
                {g.jefeId ? `Equipo de ${g.jefe}` : 'Sin jefe directo (los asigna RR.HH.)'}
                <span className="font-semibold normal-case tracking-normal text-gris/70">· {g.miembros.length} colaborador{g.miembros.length === 1 ? '' : 'es'}</span>
              </span>
              {cubiertos === g.miembros.length
                ? <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">{cubiertos}/{g.miembros.length} ✓</span>
                : <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">{cubiertos}/{g.miembros.length}</span>}
            </summary>
            <div className="overflow-x-auto px-4 pb-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gris-claro text-left text-[11px] font-bold uppercase tracking-wide text-gris">
                    <th className="py-2 pr-3">Colaborador</th>
                    <th className="py-2 pr-3">Par evaluador 1</th>
                    <th className="py-2 pr-3">Par evaluador 2</th>
                  </tr>
                </thead>
                <tbody>
                  {g.miembros.map((m) => (
                    <tr key={m.id} className="border-b border-hueso-2 align-middle">
                      <td className="py-2.5 pr-3">
                        <p className="font-bold">{m.nombre}</p>
                        <p className="text-xs text-gris">{m.puesto}</p>
                      </td>
                      <td className="py-2.5 pr-3">{celda(m, 0)}</td>
                      <td className="py-2.5 pr-3">
                        {celda(m, 1)}
                        {m.pares.length > 2 && <p className="mt-0.5 text-[11px] text-gris">+{m.pares.length - 2} adicional{m.pares.length - 2 === 1 ? '' : 'es'}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )
      })}
      </div>
    </div>
  )
}

type DimCalibrable = { dimensionId: string; nombre: string; nota: number; pesoEfectivo: number; ajuste: number | null }
type ObjetivoCalibrable = { id: string; titulo: string; tipo: string; peso: number; logro: number | null }

export type MiembroCalibracion = {
  resultadoId: string
  nombre: string
  puesto: string
  notaVigente: number
  notaOriginal: number | null // solo si hay ajuste directo legado (chip "Calibrada")
  fueCalibrado: boolean // tiene ajustes de dimensión u objetivo registrados
  dims: DimCalibrable[]
  objetivos: ObjetivoCalibrable[]
  combinacion: { comp: number; obj: number }
  // Decisión del colaborador sobre su nota preliminar (insumo de calibración)
  conformidad: 'CONFORME' | 'OBSERVADO' | null
  conformidadFecha: string | null
  observacion: string | null
  notaAceptada: number | null
}

/** Lista de calibración: colaboradores con nota agrupados por ÁREA → jefe directo (mismo
 * patrón que Pares y Feedback), con buscador por nombre, puesto, jefe o área. Al buscar,
 * las áreas y equipos con coincidencias se abren solos. */
export function ListaCalibracion({ grupos, puedeGestionar = true }: {
  grupos: { area: string; jefeId: string | null; jefe: string; miembros: MiembroCalibracion[] }[]
  puedeGestionar?: boolean
}) {
  const [q, setQ] = useState('')
  // Sin tildes: «Sofia» debe encontrar a «Sofía» (mismo criterio que el Combobox)
  const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const term = sinTildes(q.trim())
  // Si el término coincide con el JEFE o el ÁREA, se muestra el grupo completo; si no, filtra por miembro
  const filtrados = grupos
    .map((g) => (sinTildes(g.jefe).includes(term) || sinTildes(g.area).includes(term)
      ? g
      : { ...g, miembros: g.miembros.filter((m) => !term || sinTildes(m.nombre).includes(term) || sinTildes(m.puesto).includes(term)) }))
    .filter((g) => g.miembros.length > 0)
  // Primer nivel: áreas (el orden ya viene del server)
  const areas = [...filtrados.reduce((m, g) => m.set(g.area, [...(m.get(g.area) ?? []), g]), new Map<string, typeof filtrados>()).entries()]

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar colaborador, puesto, jefe o área…"
        className="mb-3 w-full rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none transition focus:border-marca"
      />
      {filtrados.length === 0 && <p className="rounded-xl bg-hueso px-4 py-6 text-center text-sm text-gris">Sin coincidencias para “{q}”.</p>}
      <div className="space-y-3">
        {areas.map(([area, gruposArea]) => (
          <details key={`${area}${term ? '-abierto' : ''}`} open={term || areas.length === 1 ? true : undefined} className="group/area rounded-xl border-2 border-gris-claro">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl bg-hueso/60 px-4 py-3 transition hover:bg-hueso [&::-webkit-details-marker]:hidden">
              <span className="flex min-w-0 items-center gap-2 font-display text-[13px] font-bold">
                <span className="shrink-0 text-gris transition group-open/area:rotate-90">›</span>
                <span className="min-w-0">
                  <span className="block truncate md:inline">{area}</span>
                  {/* Con un solo equipo el jefe vive aquí (en móvil el equipo no dibuja su caja) */}
                  <span className="block truncate text-[11px] font-semibold text-gris md:inline md:ps-1.5">
                    {gruposArea.length === 1 ? `${gruposArea[0].jefeId ? gruposArea[0].jefe : 'Sin jefe directo'} · ` : ''}
                    {gruposArea.reduce((n, g) => n + g.miembros.length, 0)} con nota
                  </span>
                </span>
              </span>
            </summary>
            <div className="space-y-2 p-3">
        {gruposArea.map((g) => {
          const calibrados = g.miembros.filter((m) => m.fueCalibrado).length
          const observados = g.miembros.filter((m) => m.conformidad === 'OBSERVADO').length
          return (
            // key con el término: al buscar se remonta abierto; al limpiar vuelve cerrado
            <details key={`${g.jefeId ?? '__sin_jefe__'}${term ? '-abierto' : ''}`} open={term || gruposArea.length === 1 ? true : undefined} className={`group rounded-xl md:border md:border-gris-claro ${gruposArea.length === 1 ? '' : 'border border-gris-claro'}`}>
              <summary className={`cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 transition hover:bg-hueso [&::-webkit-details-marker]:hidden md:flex ${gruposArea.length === 1 ? 'hidden' : 'flex'}`}>
                <span className="flex min-w-0 items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-gris">
                  <span className="shrink-0 transition group-open:rotate-90">›</span>
                  <span className="truncate">{g.jefeId ? `Equipo de ${g.jefe}` : 'Sin jefe directo'}</span>
                  <span className="hidden font-semibold normal-case tracking-normal text-gris/70 md:inline">· {g.miembros.length} con nota</span>
                </span>
                <span className="flex items-center gap-1.5">
                  {observados > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-900">{observados} observada{observados === 1 ? '' : 's'}</span>}
                  {calibrados > 0 && <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-bold text-sky-700">{calibrados} calibrado{calibrados === 1 ? '' : 's'}</span>}
                </span>
              </summary>
              {/* ── Móvil: la fila se desapila. Con dos chips y la nota compitiendo por el
                     ancho, al nombre le quedaban ~90 px y «Calibrar» se comprimía al borde.
                     Las OBSERVADAS primero: son las que reclaman calibración. ── */}
              <ul className={`space-y-2.5 pb-3 md:hidden ${gruposArea.length === 1 ? '' : 'px-3'}`}>
                {[...g.miembros.filter((m) => m.conformidad === 'OBSERVADO'), ...g.miembros.filter((m) => m.conformidad !== 'OBSERVADO')].map((m) => {
                  const cambioPorCalibracion = m.notaAceptada !== null && Math.abs(m.notaVigente - m.notaAceptada) > 0.005
                  return (
                    <li key={m.resultadoId} className={`rounded-xl border px-3 py-3 ${m.conformidad === 'OBSERVADO' ? 'border-amber-300 bg-amber-50/40' : 'border-gris-claro bg-white'}`}>
                      <div className="flex items-start gap-2.5">
                        <Avatar nombre={m.nombre} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13.5px] font-bold leading-tight">{m.nombre}</p>
                          <p className="text-xs text-gris">{m.puesto}</p>
                        </div>
                        {/* Con calibración conviven dos notas: la grande se rotula «vigente» */}
                        <p className="shrink-0 text-right leading-none">
                          <span className="font-display text-xl font-extrabold text-marca">{m.notaVigente.toFixed(2)}</span>
                          <span className="mt-1 block text-[9.5px] font-bold uppercase tracking-wide text-gris">{m.fueCalibrado || m.notaOriginal !== null ? 'vigente' : 'nota'}</span>
                        </p>
                      </div>
                      <div className="mt-2.5 flex flex-col gap-2 border-t border-hueso-2 pt-2.5">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-gris">
                          {m.conformidad === 'CONFORME' && (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700">Conforme ✓{cambioPorCalibracion ? ` ${m.notaAceptada!.toFixed(2)}` : ''}</span>
                          )}
                          {m.conformidad === 'OBSERVADO' && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-bold text-amber-900">Observada</span>
                          )}
                          {(m.fueCalibrado || m.notaOriginal !== null) && (
                            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10.5px] font-bold text-sky-700">Calibrada</span>
                          )}
                          {m.conformidadFecha && <span>{m.conformidadFecha}</span>}
                        </p>
                        {/* Lo que el title escondía: en el teléfono no hay hover */}
                        {m.notaOriginal !== null && <p className="text-[11.5px] text-gris">original {m.notaOriginal.toFixed(2)}</p>}
                        {cambioPorCalibracion && <p className="text-[11.5px] text-gris">dio conformidad con {m.notaAceptada!.toFixed(2)} · la vigente cambió por calibración</p>}
                        {m.conformidad === 'OBSERVADO' && m.observacion && (
                          <p className="line-clamp-2 rounded-lg bg-hueso px-2.5 py-1.5 text-xs">“{m.observacion}”</p>
                        )}
                        {puedeGestionar && (
                          <div className="[&>button]:w-full">
                            <Calibrador
                              resultadoId={m.resultadoId}
                              nombre={m.nombre}
                              notaActual={m.notaVigente}
                              dims={m.dims}
                              objetivos={m.objetivos}
                              combinacion={m.combinacion}
                            />
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>

              {/* ── Escritorio: la fila horizontal de siempre, intacta ── */}
              <ul className="hidden space-y-2 px-4 pb-3 md:block">
                {g.miembros.map((m) => (
                  <li key={m.resultadoId} className={`flex items-center gap-4 rounded-xl border px-4 py-2.5 ${m.conformidad === 'OBSERVADO' ? 'border-amber-300 bg-amber-50/40' : 'border-gris-claro'}`}>
                    <Avatar nombre={m.nombre} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">{m.nombre}</p>
                      <p className="text-xs text-gris">{m.puesto}</p>
                      {m.conformidad === 'OBSERVADO' && m.observacion && (
                        <p className="mt-1 text-xs text-amber-900" title={m.observacion}>“{m.observacion}”</p>
                      )}
                    </div>
                    {m.conformidad === 'CONFORME' && (
                      <span title={`Dio conformidad con la nota ${m.notaAceptada?.toFixed(2) ?? '—'}${m.conformidadFecha ? ` el ${m.conformidadFecha}` : ''}${m.notaAceptada !== null && Math.abs(m.notaVigente - m.notaAceptada) > 0.005 ? ` (la vigente cambió a ${m.notaVigente.toFixed(2)} por calibración)` : ''}`} className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">Conforme ✓{m.notaAceptada !== null && Math.abs(m.notaVigente - m.notaAceptada) > 0.005 ? ` ${m.notaAceptada.toFixed(2)}` : ''}</span>
                    )}
                    {m.conformidad === 'OBSERVADO' && (
                      <span title={`Observó la nota ${m.notaAceptada?.toFixed(2) ?? '—'}${m.conformidadFecha ? ` el ${m.conformidadFecha}` : ''}`} className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-900">Observada</span>
                    )}
                    {(m.fueCalibrado || m.notaOriginal !== null) && <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-bold text-sky-700">Calibrada</span>}
                    <div className="text-right">
                      <Nota valor={m.notaVigente} />
                      {m.notaOriginal !== null && <p className="text-[10px] text-gris">original {m.notaOriginal.toFixed(2)}</p>}
                    </div>
                    {puedeGestionar && (
                      <Calibrador
                        resultadoId={m.resultadoId}
                        nombre={m.nombre}
                        notaActual={m.notaVigente}
                        dims={m.dims}
                        objetivos={m.objetivos}
                        combinacion={m.combinacion}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )
        })}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}

/** Calibración por componentes: el popup muestra el resultado POR DIMENSIÓN y POR OBJETIVO,
 * RR.HH. ajusta el componente que corresponde y la nota final se recalcula con la fórmula
 * real — el desglose que ve el evaluado siempre explica su nota. */
export function Calibrador({ resultadoId, nombre, notaActual, dims, objetivos, combinacion }: {
  resultadoId: string
  nombre: string
  notaActual: number
  dims: DimCalibrable[]
  objetivos: ObjetivoCalibrable[]
  combinacion: { comp: number; obj: number }
}) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  // Inputs como texto: '' = sin ajuste (la dimensión usa su nota calculada; el objetivo su logro actual)
  const [ajDim, setAjDim] = useState<Record<string, string>>({})
  const [ajObj, setAjObj] = useState<Record<string, string>>({})
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  const abrir = () => {
    setAjDim(Object.fromEntries(dims.filter((d) => d.ajuste !== null).map((d) => [d.dimensionId, String(d.ajuste)])))
    setAjObj({})
    setMotivo(''); setError(null); setAbierto(true)
  }

  // Preview en vivo con las MISMAS funciones puras del motor
  const num = (s: string | undefined) => (s === undefined || s.trim() === '' || isNaN(Number(s)) ? null : Number(s))
  const ajustesPreview = Object.fromEntries(Object.entries(ajDim).map(([k, v]) => [k, num(v)]).filter((e): e is [string, number] => e[1] !== null))
  const compPreview = notaCompetenciasDesdeDesglose(dims, ajustesPreview)
  const logrosPreview = objetivos.map((o) => num(ajObj[o.id]) ?? o.logro)
  const faltanLogros = objetivos.length > 0 && logrosPreview.some((l) => l === null)
  const cumplimientoPreview = faltanLogros ? null : cumplimientoObjetivos(objetivos.map((o, i) => ({ peso: o.peso, logro: logrosPreview[i]! })))
  const finalPreview = faltanLogros ? null : notaFinal(compPreview, cumplimientoPreview, combinacion)

  const guardar = () => {
    startTransition(async () => {
      setError(null)
      const dimensiones = dims
        .map((d) => ({ dimensionId: d.dimensionId, valor: num(ajDim[d.dimensionId]) }))
        .filter((a) => a.valor !== (dims.find((d) => d.dimensionId === a.dimensionId)?.ajuste ?? null))
      const objs = objetivos
        .map((o) => ({ objetivoId: o.id, logro: num(ajObj[o.id]) }))
        .filter((a): a is { objetivoId: string; logro: number } => a.logro !== null)
        .filter((a) => a.logro !== objetivos.find((o) => o.id === a.objetivoId)?.logro)
      const res = await calibrarDetallado(resultadoId, { dimensiones, objetivos: objs }, motivo)
      if (!res.ok) { setError(res.error); return }
      toast(`Calibración registrada · nota final ${res.notaFinal?.toFixed(2) ?? 'pendiente'}`)
      setAbierto(false)
      router.refresh()
    })
  }

  const inputCls = 'w-20 rounded-lg border border-gris-claro px-2 py-1 text-center text-sm font-bold outline-none focus:border-marca placeholder:font-normal placeholder:text-gris/50'

  return (
    <>
      <button onClick={abrir} className="rounded-xl border border-gris-claro px-3 py-1.5 text-xs font-bold transition hover:bg-hueso">Calibrar</button>
      <Modal titulo={`Calibrar resultado · ${nombre}`} abierto={abierto} onCerrar={() => setAbierto(false)}>
        <p className="text-xs text-gris">
          Ajusta la <b>dimensión</b> u <b>objetivo</b> que corresponde y la nota final se recalcula con la fórmula real, para que el detalle siempre explique la nota. Cada ajuste queda en el registro de auditoría inmutable.
        </p>

        <p className="mb-1.5 mt-4 text-[11px] font-bold uppercase tracking-wide text-gris">Competencias por dimensión <span className="font-semibold normal-case tracking-normal text-gris/70">· pondera {combinacion.comp}% de la nota final</span></p>

        {/* Móvil: una tarjeta por dimensión con su campo — la tabla de 4 columnas dejaba el
            nombre de la dimensión en dos letras y el input pegado al borde */}
        <div className="flex flex-col gap-2 md:hidden">
          {dims.map((d) => (
            <div key={d.dimensionId} className="rounded-xl border border-gris-claro px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 text-[12.5px] font-bold">{d.nombre}</p>
                <p className="shrink-0 text-[10.5px] text-gris">peso {Math.round(d.pesoEfectivo * 100)}%</p>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <p className="text-[11.5px] text-gris">calculada <b className="font-display text-[13px] text-negro">{d.nota.toFixed(2)}</b></p>
                <input
                  type="number" min={1} max={5} step={0.1}
                  value={ajDim[d.dimensionId] ?? ''}
                  placeholder={d.nota.toFixed(2)}
                  onChange={(e) => setAjDim({ ...ajDim, [d.dimensionId]: e.target.value })}
                  aria-label={`Nota calibrada de ${d.nombre}`}
                  className="ml-auto w-24 rounded-lg border border-gris-claro bg-hueso px-2.5 py-2 text-right text-sm font-bold outline-none focus:border-marca placeholder:font-normal placeholder:text-gris/50"
                />
              </div>
            </div>
          ))}
        </div>

        <table className="hidden w-full text-sm md:table">
          <thead>
            <tr className="border-b border-gris-claro text-left text-[10px] font-bold uppercase tracking-wide text-gris">
              <th className="py-1.5 pr-3">Dimensión</th>
              <th className="py-1.5 pr-3 text-right">Peso efectivo</th>
              <th className="py-1.5 pr-3 text-right">Calculada</th>
              <th className="py-1.5 text-right">Calibrada</th>
            </tr>
          </thead>
          <tbody>
            {dims.map((d) => (
              <tr key={d.dimensionId} className="border-b border-hueso-2">
                <td className="py-2 pr-3 font-semibold">{d.nombre}</td>
                <td className="py-2 pr-3 text-right text-xs text-gris">{Math.round(d.pesoEfectivo * 100)}%</td>
                <td className="py-2 pr-3 text-right font-bold">{d.nota.toFixed(2)}</td>
                <td className="py-2 text-right">
                  <input
                    type="number" min={1} max={5} step={0.1}
                    value={ajDim[d.dimensionId] ?? ''}
                    placeholder={d.nota.toFixed(2)}
                    onChange={(e) => setAjDim({ ...ajDim, [d.dimensionId]: e.target.value })}
                    className={inputCls}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {objetivos.length > 0 && (
          <>
            <p className="mb-1.5 mt-4 text-[11px] font-bold uppercase tracking-wide text-gris">Objetivos <span className="font-semibold normal-case tracking-normal text-gris/70">· ponderan {combinacion.obj}% de la nota final</span></p>

            {/* Móvil: una tarjeta por objetivo */}
            <div className="flex flex-col gap-2 md:hidden">
              {objetivos.map((o) => (
                <div key={o.id} className="rounded-xl border border-gris-claro px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="min-w-0 text-[12.5px] font-bold">{o.titulo}</p>
                    <p className="shrink-0 text-[10.5px] text-gris">peso {o.peso}%</p>
                  </div>
                  <p className="text-[10.5px] text-gris">{o.tipo}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <p className="text-[11.5px] text-gris">logro <b className="font-display text-[13px] text-negro">{o.logro === null ? '—' : `${o.logro}%`}</b></p>
                    {o.tipo === 'Transversal' ? (
                      <span className="ml-auto text-right text-[11px] leading-snug text-gris">lo carga la Dirección · aplica a todos por igual</span>
                    ) : (
                      <input
                        type="number" min={0} max={100}
                        value={ajObj[o.id] ?? ''}
                        placeholder={o.logro === null ? '—' : `${o.logro}%`}
                        onChange={(e) => setAjObj({ ...ajObj, [o.id]: e.target.value })}
                        aria-label={`Logro calibrado de ${o.titulo}`}
                        className="ml-auto w-24 rounded-lg border border-gris-claro bg-hueso px-2.5 py-2 text-right text-sm font-bold outline-none focus:border-marca placeholder:font-normal placeholder:text-gris/50"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>

            <table className="hidden w-full text-sm md:table">
              <thead>
                <tr className="border-b border-gris-claro text-left text-[10px] font-bold uppercase tracking-wide text-gris">
                  <th className="py-1.5 pr-3">Objetivo</th>
                  <th className="py-1.5 pr-3 text-right">Peso</th>
                  <th className="py-1.5 pr-3 text-right">Logro</th>
                  <th className="py-1.5 text-right">Calibrado</th>
                </tr>
              </thead>
              <tbody>
                {objetivos.map((o) => (
                  <tr key={o.id} className="border-b border-hueso-2">
                    <td className="py-2 pr-3">
                      <p className="font-semibold">{o.titulo}</p>
                      <p className="text-[11px] text-gris">{o.tipo}</p>
                    </td>
                    <td className="py-2 pr-3 text-right text-xs text-gris">{o.peso}%</td>
                    <td className="py-2 pr-3 text-right font-bold">{o.logro === null ? '—' : `${o.logro}%`}</td>
                    <td className="py-2 text-right">
                      {o.tipo === 'Transversal' ? (
                        <span className="text-[11px] leading-snug text-gris" title="Su logro lo carga la Dirección en Objetivos transversales y aplica a todos por igual">aplica a todos por igual</span>
                      ) : (
                        <input
                          type="number" min={0} max={100}
                          value={ajObj[o.id] ?? ''}
                          placeholder={o.logro === null ? '—' : `${o.logro}%`}
                          onChange={(e) => setAjObj({ ...ajObj, [o.id]: e.target.value })}
                          className={inputCls}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl bg-hueso-2 px-4 py-3 text-sm">
          <span>Nota final: <b>{notaActual.toFixed(2)}</b></span>
          <span className="text-gris">→</span>
          <span className="font-display text-lg font-extrabold text-marca">{finalPreview === null ? 'pendiente' : finalPreview.toFixed(2)}</span>
          <span className="text-xs text-gris">competencias {compPreview?.toFixed(2) ?? '—'} · objetivos {cumplimientoPreview === null ? '—' : `${Math.round(cumplimientoPreview)}%`}</span>
        </div>

        <textarea
          value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
          placeholder="Motivo del ajuste (obligatorio)…"
          className="mt-3 w-full rounded-xl border border-gris-claro bg-hueso px-3.5 py-2.5 text-sm outline-none focus:border-marca"
        />
        {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-alerta-dark">{error}</p>}
        {/* Móvil: los dos botones a lo ancho (al pie de la hoja); escritorio: alineados a la derecha */}
        <div className="mt-4 flex gap-2 md:justify-end">
          <button onClick={() => setAbierto(false)} className="flex-1 rounded-xl border border-gris-claro px-4 py-2.5 text-xs font-bold hover:bg-hueso md:flex-none md:py-2">Cancelar</button>
          <button
            disabled={pendiente}
            onClick={guardar}
            className="flex-1 rounded-xl bg-marca px-4 py-2.5 text-xs font-bold text-white transition hover:bg-marca-dark disabled:opacity-60 md:flex-none md:py-2"
          >
            {pendiente ? 'Guardando…' : 'Calibrar ✓'}
          </button>
        </div>
      </Modal>
    </>
  )
}

export function PanelCierre({ cicloId, pendientes, estado, publicado, feedbackRequeridos = 0, feedbackFaltantes = [], puedeGestionar = true }: {
  cicloId: string
  pendientes: number
  estado: string
  publicado: boolean
  feedbackRequeridos?: number
  feedbackFaltantes?: string[]
  puedeGestionar?: boolean
}) {
  const router = useRouter()
  const [publicar, setPublicar] = useState(true)
  const [confirmando, setConfirmando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  const fila = (titulo: string, descripcion: React.ReactNode, accion: React.ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{titulo}</p>
        <p className="mt-0.5 text-xs text-gris">{descripcion}</p>
      </div>
      <div className="shrink-0">{accion}</div>
    </div>
  )

  if (estado === 'CERRADO') {
    return (
      <div className="divide-y divide-hueso-2">
        {fila('Ciclo cerrado', 'Los resultados quedaron congelados con la información recibida.',
          <span className="rounded-full bg-hueso-2 px-3 py-1.5 text-xs font-bold">Cerrado ✓</span>)}
        {fila('Publicación a colaboradores', publicado
          ? 'Cada colaborador ya puede ver su resultado en "Mi resultado".'
          : 'Los resultados solo son visibles para RR.HH. hasta que los publiques.',
          publicado
            ? <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">Publicados ✓</span>
            : puedeGestionar
              ? <button onClick={() => { setError(null); setConfirmando(true) }} className="rounded-xl bg-marca px-4 py-2 text-xs font-bold text-white transition hover:bg-marca-dark">Publicar resultados…</button>
              : <span className="rounded-full bg-hueso-2 px-3 py-1.5 text-xs font-bold text-gris">Sin publicar</span>)}
        <Modal titulo="Publicar resultados" abierto={confirmando} onCerrar={() => setConfirmando(false)}>
          <p className="text-sm">Cada colaborador podrá ver su resultado en <b>“Mi resultado”</b>.</p>
          <p className="mt-2.5 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
            📧 Se enviará un <b>correo a cada participante</b> avisando que sus resultados ya están disponibles, con acceso directo para revisarlos en la plataforma.
          </p>
          {error && <p className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-sm text-alerta-dark">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setConfirmando(false)} className="rounded-xl border border-gris-claro bg-white px-4 py-2 text-[13px] font-bold transition hover:bg-hueso">Cancelar</button>
            <button
              disabled={pendiente}
              onClick={() => startTransition(async () => {
                const res = await publicarResultados(cicloId)
                if (!res.ok) { setError(res.error); return }
                toast('Resultados publicados y participantes notificados')
                setConfirmando(false)
                router.refresh()
              })}
              className="rounded-xl bg-marca px-4 py-2 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark disabled:opacity-60"
            >
              {pendiente ? 'Publicando…' : 'Publicar y notificar ✓'}
            </button>
          </div>
        </Modal>
      </div>
    )
  }

  return (
    <div className="divide-y divide-hueso-2">
      {/* Los resultados se calculan SOLOS: al enviarse cada evaluación, al cargar logros,
          al calibrar y al cerrar. El botón «Recalcular» se quitó: recalculaba todo el ciclo
          sin auditoría y podía materializar cambios de insumos sin explicación. */}
      {fila('Evaluaciones del ciclo',
        <>Las notas se calculan solas conforme llegan las evaluaciones · <b className={pendientes > 0 ? 'text-amber-700' : 'text-emerald-700'}>{pendientes === 0 ? 'todas enviadas ✓' : `${pendientes} evaluaci${pendientes === 1 ? 'ón' : 'ones'} aún sin enviar`}</b></>,
        null)}
      {fila('Sesiones de feedback',
        feedbackRequeridos === 0
          ? 'Se habilitan cuando haya resultados calculados: cada jefe conversa el resultado con su colaborador y registra acuerdos y PDI en "Resultados del equipo".'
          : feedbackFaltantes.length === 0
            ? <>Las <b className="text-emerald-700">{feedbackRequeridos} sesiones están registradas ✓</b> — el ciclo ya puede cerrarse.</>
            : <>Cada jefe conversa el resultado con su colaborador y lo registra en <b>Resultados del equipo</b>. Faltan: <b className="text-amber-700">{feedbackFaltantes.slice(0, 5).join(', ')}{feedbackFaltantes.length > 5 ? ` y ${feedbackFaltantes.length - 5} más` : ''}</b></>,
        feedbackRequeridos > 0 && (feedbackFaltantes.length === 0
          ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">{feedbackRequeridos}/{feedbackRequeridos} ✓</span>
          : <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">{feedbackRequeridos - feedbackFaltantes.length}/{feedbackRequeridos}</span>))}
      {fila('Cerrar el ciclo',
        'Congela los resultados y termina la etapa de respuestas. Requiere las sesiones de feedback registradas; las evaluaciones no enviadas quedan fuera (la nota se calcula con las modalidades recibidas, renormalizando pesos).',
        puedeGestionar
          ? <button onClick={() => { setError(null); setConfirmando(true) }} className="rounded-xl bg-negro px-5 py-2.5 font-display text-[13px] font-bold text-white transition hover:bg-negro/80">Cerrar ciclo…</button>
          : <span className="rounded-full bg-hueso-2 px-2.5 py-1 text-[11px] font-bold text-gris">Solo un rol con gestión de ciclos puede cerrarlo</span>)}
      <Modal titulo="Cerrar el ciclo" abierto={confirmando} onCerrar={() => setConfirmando(false)}>
        <p className="text-sm">
          Se congelan los resultados y termina la etapa de respuestas.
          {pendientes > 0 && <> Hay <b>{pendientes} evaluaci{pendientes === 1 ? 'ón' : 'ones'} sin enviar</b> que quedarán fuera del cálculo.</>}
        </p>
        {feedbackFaltantes.length > 0 && (
          <p className="mt-2.5 rounded-xl bg-red-50 px-3.5 py-2.5 text-xs text-alerta-dark">
            ✕ Falta{feedbackFaltantes.length === 1 ? '' : 'n'} <b>{feedbackFaltantes.length} sesi{feedbackFaltantes.length === 1 ? 'ón' : 'ones'} de feedback</b> por registrar ({feedbackFaltantes.slice(0, 4).join(', ')}{feedbackFaltantes.length > 4 ? ` y ${feedbackFaltantes.length - 4} más` : ''}).
            Los jefes las registran en <b>Resultados del equipo</b>; no se puede cerrar antes.
          </p>
        )}
        <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={publicar} onChange={(e) => setPublicar(e.target.checked)} className="h-4 w-4 accent-[#0067ff]" />
          Publicar resultados a los colaboradores al cerrar
        </label>
        {publicar ? (
          <p className="mt-2.5 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
            📧 Se enviará un <b>correo a cada participante</b> avisando que sus resultados ya están disponibles, con acceso directo para revisarlos en la plataforma.
          </p>
        ) : (
          <p className="mt-2.5 rounded-xl bg-hueso px-3.5 py-2.5 text-xs text-gris">
            Sin publicar, los resultados solo los ve RR.HH. y <b>no se envía ningún correo</b>. Podrás publicarlos después desde esta pestaña.
          </p>
        )}
        {error && <p className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-sm text-alerta-dark">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setConfirmando(false)} className="rounded-xl border border-gris-claro bg-white px-4 py-2 text-[13px] font-bold transition hover:bg-hueso">Cancelar</button>
          <button
            disabled={pendiente || feedbackFaltantes.length > 0}
            onClick={() => startTransition(async () => {
              const res = await cerrarCiclo(cicloId, publicar)
              if (!res.ok) { setError(res.error); return }
              toast(publicar ? 'Ciclo cerrado: resultados publicados y participantes notificados' : 'Ciclo cerrado')
              setConfirmando(false)
              router.refresh()
            })}
            className="rounded-xl bg-marca px-4 py-2 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark disabled:opacity-60"
          >
            {pendiente ? 'Cerrando…' : 'Sí, cerrar ciclo ✓'}
          </button>
        </div>
      </Modal>
    </div>
  )
}


/** Fila del avance por país en un ciclo regional (para la pestaña "Avance por país"
 * del Regional, y para que el RR.HH. de país cierre el suyo desde Cierre y publicación). */
export type FilaAvancePais = {
  paisId: string
  pais: string
  participantes: number
  total: number // asignaciones del país
  enviadas: number
  feedbackRequeridos: number
  feedbackRegistrados: number
  cerrado: boolean
  publicado: boolean
  cerradoEn: string | null
  puedeCerrar: boolean // Regional cualquiera; RR.HH. de país solo el suyo
}

/** Cumplimiento y cierre POR PAÍS de un ciclo regional: cada país corta, recalcula y
 * publica de forma independiente; al cerrar el último, el ciclo se cierra solo. */
export function PanelAvancePais({ cicloId, cicloEstado, filas, puedeGestionar = true }: {
  cicloId: string
  cicloEstado: string
  filas: FilaAvancePais[]
  puedeGestionar?: boolean
}) {
  const router = useRouter()
  const [cerrando, setCerrando] = useState<FilaAvancePais | null>(null)
  const [publicando, setPublicando] = useState<FilaAvancePais | null>(null)
  const [publicar, setPublicar] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  const chipEstado = (f: FilaAvancePais) =>
    !f.cerrado
      ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">Abierto</span>
      : f.publicado
        ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">Publicado ✓</span>
        : <span className="rounded-full bg-hueso-2 px-2.5 py-1 text-[11px] font-bold">Cerrado · sin publicar</span>

  return (
    <div className="space-y-2.5">
      {filas.map((f) => {
        const pct = f.total === 0 ? 0 : Math.round((f.enviadas / f.total) * 100)
        const feedbackOk = f.feedbackRequeridos > 0 && f.feedbackRegistrados === f.feedbackRequeridos
        return (
          <div key={f.paisId} className="rounded-xl border border-gris-claro px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <p className="text-sm font-bold">{f.pais}</p>
                  {chipEstado(f)}
                  {f.cerrado && f.cerradoEn && <span className="text-[11px] text-gris">cerrado el {f.cerradoEn}</span>}
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-2 w-40 overflow-hidden rounded-full bg-hueso-2">
                    <div className="h-full rounded-full bg-marca/70" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gris">{f.enviadas} de {f.total} evaluaciones · {pct}% · {f.participantes} participante{f.participantes === 1 ? '' : 's'}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {f.feedbackRequeridos > 0 && (
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${feedbackOk ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`} title="Sesiones de feedback registradas">
                    feedback {f.feedbackRegistrados}/{f.feedbackRequeridos}
                  </span>
                )}
                {puedeGestionar && cicloEstado === 'ACTIVO' && !f.cerrado && f.puedeCerrar && (
                  <button onClick={() => { setError(null); setPublicar(true); setCerrando(f) }} className="rounded-xl bg-negro px-3.5 py-2 text-xs font-bold text-white transition hover:bg-negro/80">Cerrar país…</button>
                )}
                {puedeGestionar && f.cerrado && !f.publicado && f.puedeCerrar && (
                  <button onClick={() => { setError(null); setPublicando(f) }} className="rounded-xl bg-marca px-3.5 py-2 text-xs font-bold text-white transition hover:bg-marca-dark">Publicar…</button>
                )}
              </div>
            </div>
          </div>
        )
      })}

      <Modal titulo={`Cerrar ${cerrando?.pais ?? ''}`} abierto={cerrando !== null} onCerrar={() => setCerrando(null)}>
        {cerrando && (
          <>
            <p className="text-sm">
              Se congelan y recalculan los resultados de <b>{cerrando.pais}</b>; los demás países continúan su ciclo con normalidad.
              {cerrando.total - cerrando.enviadas > 0 && <> Hay <b>{cerrando.total - cerrando.enviadas} evaluaci{cerrando.total - cerrando.enviadas === 1 ? 'ón' : 'ones'} sin enviar</b> de este país que quedarán fuera del cálculo.</>}
            </p>
            {cerrando.feedbackRegistrados < cerrando.feedbackRequeridos && (
              <p className="mt-2.5 rounded-xl bg-red-50 px-3.5 py-2.5 text-xs text-alerta-dark">
                ✕ Faltan <b>{cerrando.feedbackRequeridos - cerrando.feedbackRegistrados} sesiones de feedback</b> de {cerrando.pais} por registrar. Los jefes las registran en <b>Resultados del equipo</b>; no se puede cerrar el país antes.
              </p>
            )}
            <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={publicar} onChange={(e) => setPublicar(e.target.checked)} className="h-4 w-4 accent-[#0067ff]" />
              Publicar los resultados de {cerrando.pais} al cerrar
            </label>
            {publicar
              ? <p className="mt-2.5 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">📧 Se enviará un <b>correo a los participantes de {cerrando.pais}</b> avisando que sus resultados ya están disponibles.</p>
              : <p className="mt-2.5 rounded-xl bg-hueso px-3.5 py-2.5 text-xs text-gris">Sin publicar, los resultados de {cerrando.pais} solo los ve RR.HH. y <b>no se envía ningún correo</b>. Podrás publicarlos después desde aquí.</p>}
            <p className="mt-2.5 text-xs text-gris">Si este es el último país pendiente, el ciclo pasará a <b>Cerrado</b> automáticamente.</p>
            {error && <p className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-sm text-alerta-dark">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setCerrando(null)} className="rounded-xl border border-gris-claro bg-white px-4 py-2 text-[13px] font-bold transition hover:bg-hueso">Cancelar</button>
              <button
                disabled={pendiente || cerrando.feedbackRegistrados < cerrando.feedbackRequeridos}
                onClick={() => startTransition(async () => {
                  const res = await cerrarPaisCiclo(cicloId, cerrando.paisId, publicar)
                  if (!res.ok) { setError(res.error); return }
                  toast(res.cicloCerrado
                    ? `${cerrando.pais} cerrado — era el último país: el ciclo quedó cerrado`
                    : publicar ? `${cerrando.pais} cerrado y resultados publicados` : `${cerrando.pais} cerrado`)
                  setCerrando(null)
                  router.refresh()
                })}
                className="rounded-xl bg-marca px-4 py-2 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark disabled:opacity-60"
              >
                {pendiente ? 'Cerrando…' : `Sí, cerrar ${cerrando.pais} ✓`}
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal titulo={`Publicar resultados de ${publicando?.pais ?? ''}`} abierto={publicando !== null} onCerrar={() => setPublicando(null)}>
        {publicando && (
          <>
            <p className="text-sm">Los colaboradores de <b>{publicando.pais}</b> podrán ver su resultado en <b>“Mi resultado”</b>.</p>
            <p className="mt-2.5 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">📧 Se enviará un <b>correo a los participantes de {publicando.pais}</b> con acceso directo a sus resultados.</p>
            {error && <p className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-sm text-alerta-dark">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPublicando(null)} className="rounded-xl border border-gris-claro bg-white px-4 py-2 text-[13px] font-bold transition hover:bg-hueso">Cancelar</button>
              <button
                disabled={pendiente}
                onClick={() => startTransition(async () => {
                  const res = await publicarPaisCiclo(cicloId, publicando.paisId)
                  if (!res.ok) { setError(res.error); return }
                  toast(`Resultados de ${publicando.pais} publicados y participantes notificados`)
                  setPublicando(null)
                  router.refresh()
                })}
                className="rounded-xl bg-marca px-4 py-2 font-display text-[13px] font-bold text-white shadow-md shadow-marca/30 transition hover:bg-marca-dark disabled:opacity-60"
              >
                {pendiente ? 'Publicando…' : 'Publicar y notificar ✓'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}

/** Descarga los resultados del ciclo en Excel (CSV con BOM): solo países cerrados
 * (resultados congelados) y dentro del alcance del RR.HH. */
export function ExportarResultadosBtn({ cicloId }: { cicloId: string }) {
  const [pendiente, setPendiente] = useState(false)
  return (
    <button
      disabled={pendiente}
      onClick={async () => {
        setPendiente(true)
        try {
          const res = await exportarResultadosCiclo(cicloId)
          if (!res.ok) { toast(res.error); return }
          if (res.filas.length <= 1) { toast('El ciclo no tiene resultados dentro de tu alcance'); return }
          descargarCsv(`resultados-${res.ciclo.replaceAll(' ', '-')}-${new Date().toISOString().slice(0, 10)}.csv`, res.filas)
          toast(`Excel descargado: ${res.filas.length - 1} resultado${res.filas.length - 1 === 1 ? '' : 's'}`)
        } finally { setPendiente(false) }
      }}
      className="rounded-xl border border-gris-claro bg-white px-3.5 py-1.5 text-xs font-bold transition hover:bg-hueso disabled:opacity-60"
      title="Descarga los resultados del ciclo (países cerrados, solo tu alcance) en un Excel"
    >
      {pendiente ? 'Generando…' : '⬇ Exportar resultados (CSV para Excel)'}
    </button>
  )
}
