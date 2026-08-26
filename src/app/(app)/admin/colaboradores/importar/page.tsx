import Link from 'next/link'
import { requiereAdmin } from '@/shared/lib/permisos'
import { prisma } from '@/shared/lib/prisma'
import { Card, Titulo } from '@/shared/ui/componentes'
import { AvisoSoloEscritorio } from '@/shared/ui/AvisoSoloEscritorio'
import { ImportadorPadron } from '@/features/admin/ImportadorPadron'

export default async function ImportarPadronPage() {
  await requiereAdmin('COLABORADORES', 'GESTIONAR')
  const [paises, niveles, areas] = await Promise.all([
    prisma.pais.findMany({ orderBy: { nombre: 'asc' }, select: { nombre: true } }),
    prisma.nivelJerarquico.findMany({ orderBy: { orden: 'asc' }, select: { nombre: true } }),
    prisma.area.findMany({ orderBy: { nombre: 'asc' }, select: { nombre: true } }),
  ])
  return (
    <>
      <Link href="/admin/colaboradores" className="mb-3 inline-block text-sm text-gris hover:text-negro">← Volver a Colaboradores</Link>
      <Titulo sub="Carga masiva desde la plantilla Excel (también acepta CSV): primero simula (no escribe nada), revisa el plan y recién aplica">
        Importar padrón
      </Titulo>
      <AvisoSoloEscritorio />
      <div className="space-y-5">
        <Card titulo="Cómo funciona" extra="idempotente: re-subir un padrón actualizado solo cambia lo que difiere">
          <ul className="list-disc space-y-1 pl-5 text-sm text-negro/80">
            <li>Columnas de la plantilla: <code className="rounded bg-hueso px-1.5 py-0.5 text-xs">codigo, documento, nombres, apellidos, email, telefono, pais, area, cargo, nivel_jerarquico, codigo_jefe, nivel_liderazgo, fecha_ingreso</code></li>
            <li>El <b>código</b> (ej. PER-001) es la clave: si ya existe se actualizan sus datos, si no se crea.</li>
            <li>Las <b>áreas y puestos</b> que no existan se crean solos; cada puesto nuevo nace con los pesos por dimensión de su nivel y todas las competencias asociadas.</li>
            <li>No crea cuentas de acceso ni lanza ciclos: eso sigue siendo parte del flujo normal.</li>
          </ul>
        </Card>
        <Card titulo="Archivo y simulación">
          <ImportadorPadron catalogos={{ paises: paises.map((p) => p.nombre), niveles: niveles.map((n) => n.nombre), areas: areas.map((a) => a.nombre) }} />
        </Card>
      </div>
    </>
  )
}
