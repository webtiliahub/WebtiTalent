import { requiereSesion } from '@/shared/lib/permisos'
import { Titulo, Vacio } from '@/shared/ui/componentes'
import { BotonDescargarPdf, ResultadoColaborador } from '@/features/resultados/ResultadoColaborador'
import { PreviewResultado, ciclosConNotaPreview } from '@/features/resultados/PreviewResultado'

export default async function MiResultadoPage({ searchParams }: { searchParams: Promise<{ ciclo?: string }> }) {
  const sesion = await requiereSesion()
  const { ciclo } = await searchParams

  // Cuenta sin colaborador vinculado (p. ej. tras una purga de carga inicial, antes de
  // re-vincular por correo): no hay resultado propio que mostrar.
  if (!sesion.colaboradorId) {
    return (
      <>
        <Titulo sub="Tus resultados publicados, sesión de feedback y plan de desarrollo">Mi resultado</Titulo>
        <Vacio>Tu cuenta no tiene un colaborador vinculado todavía.</Vacio>
      </>
    )
  }

  // Con nota preliminar del ciclo en curso (y sin navegar un histórico), el preview es LA vista:
  // lo publicado se colapsa a la lista de «Otros ciclos». Al abrir un ciclo anterior (?ciclo=)
  // se muestra su detalle completo, como siempre.
  const cicloIdsPreview = await ciclosConNotaPreview(sesion.colaboradorId)
  const conPreview = cicloIdsPreview.length > 0 && !ciclo

  return (
    <>
      <Titulo
        sub="Tus resultados publicados, sesión de feedback y plan de desarrollo"
        accion={<BotonDescargarPdf colaboradorId={sesion.colaboradorId} cicloId={ciclo} />}
      >
        Mi resultado
      </Titulo>
      {conPreview && <PreviewResultado colaboradorId={sesion.colaboradorId} cicloIds={cicloIdsPreview} />}
      <ResultadoColaborador
        colaboradorId={sesion.colaboradorId}
        cicloParam={ciclo}
        hrefBase="/mi-resultado"
        propio
        soloHistorial={conPreview}
      />
    </>
  )
}
