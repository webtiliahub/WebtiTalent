import { Scale } from 'lucide-react'
import { prisma } from '@/shared/lib/prisma'
import { requiereSesion } from '@/shared/lib/permisos'
import { objetivosAplicables } from '@/features/resultados/servicio'
import { FormProponer } from '@/features/objetivos/FormProponer'
import { RecomendadosPdi, type AccionPdi } from '@/features/objetivos/RecomendadosPdi'
import { BotonEliminarObjetivo } from '@/features/objetivos/AccionesObjetivo'
import { BotonEditarObjetivo } from '@/features/objetivos/FormEditarObjetivo'
import { periodoVigenteParaColaborador, BannerVentana, ventanaVencida } from '@/features/objetivos/periodo'
import { mesLegible } from '@/features/objetivos/periodo-ui'
import { extensionVigente } from '@/features/objetivos/acciones-periodo'
import { Card, Chip, Titulo, Vacio } from '@/shared/ui/componentes'

const TIPO_LABEL = { TRANSVERSAL: 'Transversal', INDIVIDUAL: 'Individual', DESARROLLO: 'Desarrollo' } as const

export default async function MisObjetivosPage() {
  const sesion = await requiereSesion()

  // Cuenta sin colaborador vinculado (p. ej. tras una purga de carga inicial, antes de
  // re-vincular por correo): no hay objetivos propios que mostrar.
  if (!sesion.colaboradorId) {
    return (
      <>
        <Titulo>Mis objetivos</Titulo>
        <Vacio>Tu cuenta no tiene un colaborador vinculado todavía.</Vacio>
      </>
    )
  }

  const periodo = await periodoVigenteParaColaborador(sesion.colaboradorId)
  if (!periodo) {
    return (
      <>
        <Titulo sub="Objetivos del período vigente">Mis objetivos</Titulo>
        <Vacio>No hay un período de objetivos activo para ti.</Vacio>
      </>
    )
  }

  const extension = await extensionVigente(periodo.id, sesion.colaboradorId)
  const fechaEfectiva = extension && extension.hasta > periodo.fechaLimiteCarga ? extension.hasta : periodo.fechaLimiteCarga
  const { transversales, individuales } = await objetivosAplicables(periodo.id, sesion.colaboradorId)
  const pesoTransversales = transversales.reduce((a, t) => a + t.peso, 0)
  const pesoAprobado = individuales.filter((o) => o.estado === 'APROBADO').reduce((a, o) => a + o.peso, 0)
  const pesoPropuesto = individuales.filter((o) => o.estado === 'PROPUESTO').reduce((a, o) => a + o.peso, 0)
  const disponible = 100 - pesoTransversales - pesoAprobado - pesoPropuesto
  const ventanaAbierta = periodo.estado === 'CARGA_ABIERTA' && !ventanaVencida(fechaEfectiva)

  // Recomendados: el PDI de la ÚLTIMA sesión de feedback, menos los desafíos que ya
  // existen como objetivo de este período (los rechazados no bloquean re-proponer)
  let recomendados: AccionPdi[] = []
  let origenPdi = ''
  if (ventanaAbierta) {
    const ultimoFeedback = await prisma.feedback.findFirst({
      where: { colaboradorId: sesion.colaboradorId },
      include: { ciclo: { select: { nombre: true } } },
      orderBy: { realizadaEn: 'desc' },
    })
    const pdi = Array.isArray(ultimoFeedback?.pdi) ? (ultimoFeedback.pdi as AccionPdi[]) : []
    const titulosExistentes = new Set(
      individuales.filter((o) => o.estado !== 'RECHAZADO').map((o) => o.titulo.trim().toLowerCase()),
    )
    recomendados = pdi.filter((a) => a?.titulo && !titulosExistentes.has(a.titulo.trim().toLowerCase()))
    origenPdi = ultimoFeedback?.ciclo.nombre ?? ''
  }

  return (
    <>
      <Titulo
        sub={`Período ${periodo.nombre} · el total de tus objetivos debe sumar 100%`}
        accion={ventanaAbierta
          ? <FormProponer periodoId={periodo.id} disponible={Math.max(disponible, 0)} />
          : undefined}
      >Mis objetivos</Titulo>
      <BannerVentana periodo={{ ...periodo, fechaLimiteCarga: fechaEfectiva }} extensionIndividual={!!extension} />
      <div className="space-y-5">
        {recomendados.length > 0 && (
          <RecomendadosPdi periodoId={periodo.id} disponible={Math.max(disponible, 0)} origen={origenPdi} acciones={recomendados} />
        )}
        <Card titulo="Objetivos del período" extra={`${transversales.length + individuales.length} objetivos`}>
          <ul className="space-y-2.5">
            {/* Móvil: peso y estado en la fila superior, título a lo ancho (el % en columna
                aplastaba el título a 3-4 líneas); escritorio: la fila de siempre vía order */}
            {transversales.map((o) => (
              <li key={o.id} className="flex flex-wrap items-start gap-x-4 gap-y-1.5 rounded-xl border border-gris-claro px-4 py-3 md:flex-nowrap">
                <span className="order-1 self-center font-display text-2xl font-extrabold tracking-tight text-hunter md:w-20 md:shrink-0 md:text-center">{o.peso}%</span>
                <span className="order-2 ml-auto self-center md:order-3 md:ml-0"><Chip tono="ok">Activo</Chip></span>
                <div className="order-3 w-full min-w-0 md:order-2 md:w-auto md:flex-1">
                  <p className="text-sm font-semibold">{o.titulo} <Chip tono="azul">{TIPO_LABEL[o.tipo]}</Chip></p>
                  {o.descripcion && <p className="mt-0.5 text-xs text-gris">{o.descripcion}</p>}
                  <p className="mt-0.5 text-[11px] text-gris">Definido por la Dirección{o.metaFecha ? ` · meta ${o.metaFecha}` : ''}</p>
                </div>
              </li>
            ))}
            {individuales.map((o) => (
              <li key={o.id} className="flex flex-wrap items-start gap-x-4 gap-y-1.5 rounded-xl border border-gris-claro px-4 py-3 md:flex-nowrap">
                <span className="order-1 self-center font-display text-2xl font-extrabold tracking-tight text-hunter md:w-20 md:shrink-0 md:text-center">{o.peso}%</span>
                <div className="order-3 w-full min-w-0 md:order-2 md:w-auto md:flex-1">
                  <p className="text-sm font-semibold">{o.titulo} <Chip>{TIPO_LABEL[o.tipo]}</Chip></p>
                  {o.descripcion && <p className="mt-0.5 text-xs text-gris">{o.descripcion}</p>}
                  <p className="mt-0.5 text-[11px] text-gris">
                    {o.metrica ? `${o.metrica} · ` : ''}{o.metaFecha ? `meta ${mesLegible(o.metaFecha)}` : ''}
                    {o.estado === 'PROPUESTO' ? ' · peso propuesto, por aprobar' : ''}
                  </p>
                </div>
                {o.estado === 'APROBADO' && <span className="order-2 ml-auto self-center md:order-3 md:ml-0"><Chip tono="ok">Aprobado</Chip></span>}
                {o.estado === 'PROPUESTO' && <span className="order-2 ml-auto self-center md:order-3 md:ml-0"><Chip tono="pendiente">Propuesto</Chip></span>}
                {o.estado === 'RECHAZADO' && (
                  <span className="order-2 ml-auto flex flex-col items-end gap-0.5 self-center md:order-3 md:ml-0">
                    <Chip tono="rojo">Rechazado</Chip>
                    <span className="text-[10px] text-gris" title="Los objetivos rechazados quedan visibles como registro del proceso">queda como registro</span>
                  </span>
                )}
                {ventanaAbierta && o.estado === 'PROPUESTO' && (
                  <span className="order-4 ml-auto flex items-center gap-1.5 md:ml-0 md:self-center">
                    <BotonEditarObjetivo
                      objetivo={{
                        id: o.id,
                        titulo: o.titulo,
                        descripcion: o.descripcion ?? '',
                        tipo: o.tipo,
                        peso: o.peso,
                        metaFecha: o.metaFecha,
                        metrica: o.metrica,
                      }}
                      maxPeso={Math.max(disponible + o.peso, 5)}
                      nota="Sigue como propuesta: tu jefe la revisará con los cambios que guardes."
                    />
                    <BotonEliminarObjetivo objetivoId={o.id} titulo={o.titulo} />
                  </span>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-4 rounded-xl bg-hueso-2 px-4 py-3 text-sm">
            <Scale size={13} className="mr-1 inline -translate-y-px" /><b>Transversales que te aplican: {pesoTransversales}%</b> · Individuales aprobados: {pesoAprobado}%
            {pesoPropuesto > 0 ? ` · propuestos: ${pesoPropuesto}%` : ''} · <b>Disponible: {Math.max(disponible, 0)}%</b>.
            El total debe sumar <b>100%</b>; tu <b>jefe</b> aprueba el peso final y el sistema lo valida antes del cierre.
          </div>
        </Card>


      </div>
    </>
  )
}
