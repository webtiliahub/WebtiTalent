import Link from 'next/link'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin } from '@/shared/lib/permisos'
import { Card, Titulo } from '@/shared/ui/componentes'
import { AvisoSoloEscritorio } from '@/shared/ui/AvisoSoloEscritorio'
import { ImportadorBancoPreguntas } from '@/features/admin/preguntas-import/ImportadorBancoPreguntas'

export default async function ImportarBancoPreguntasPage() {
  await requiereAdmin('EVALUACIONES', 'GESTIONAR')
  const dimensiones = await prisma.dimension.findMany({
    include: { competencias: { orderBy: { nombre: 'asc' }, select: { nombre: true } } },
    orderBy: { orden: 'asc' },
  })
  return (
    <>
      <Link href="/admin/preguntas" className="mb-3 inline-block text-sm text-gris hover:text-negro">← Volver a Diseñar evaluación</Link>
      <Titulo sub="Carga masiva del banco desde la plantilla Excel: primero simula (no escribe nada), revisa el plan y recién aplica">
        Importar preguntas
      </Titulo>
      <AvisoSoloEscritorio />
      <div className="space-y-5">
        <Card titulo="Cómo funciona" extra="solo agrega preguntas nuevas; las repetidas se saltan">
          <ul className="list-disc space-y-1 pl-5 text-sm text-negro/80">
            <li>Dos hojas: <b>Competencias</b> (Dimensión · Competencia · Texto · JEFE/PAR/ASC/AUTO con X) y <b>Potencial</b> (Orden · Texto).</li>
            <li>Descarga la plantilla: trae los catálogos reales (dimensiones y competencias) en la hoja «Catálogos».</li>
            <li>Una pregunta ya existente (misma competencia y texto) se salta con aviso; nunca se duplica.</li>
          </ul>
        </Card>
        <Card titulo="Archivo y simulación">
          <ImportadorBancoPreguntas catalogos={{ dimensiones }} />
        </Card>
      </div>
    </>
  )
}
