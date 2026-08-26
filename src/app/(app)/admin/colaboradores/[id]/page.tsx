import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/shared/lib/prisma'
import { requiereAdmin, alcancePaisWhere, fueraDeAlcancePais } from '@/shared/lib/permisos'
import { tieneAdmin } from '@/shared/lib/permisos-admin'
import { HojaDeVida } from '@/features/colaboradores/HojaDeVida'
import { FormEditarColaborador } from '@/features/admin/FormEditarColaborador'
import { ZonaBajaColaborador, BotonReactivar } from '@/features/admin/AccionesBajaColaborador'
import { Titulo } from '@/shared/ui/componentes'

export default async function HojaDeVidaAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await requiereAdmin('COLABORADORES', 'VER')
  const puedeGestionar = tieneAdmin(sesion.permisosAdmin, 'COLABORADORES', 'GESTIONAR')
  const { id } = await params
  const colaborador = await prisma.colaborador.findUnique({
    where: { id },
    include: { usuario: { select: { id: true } }, _count: { select: { equipo: { where: { activo: true } } } } },
  })
  if (!colaborador) notFound()
  // RR.HH. de país no puede abrir la hoja de vida de otro país (mismo scope que la lista)
  if (fueraDeAlcancePais(sesion, colaborador.paisId)) notFound()

  // Aviso de rotación en la baja: ¿participa en un ciclo ACTIVO?
  const enCicloActivo = colaborador.activo
    ? await prisma.asignacion.findFirst({
        where: { evaluadoId: id, ciclo: { estado: 'ACTIVO' } },
        select: { ciclo: { select: { nombre: true } } },
      })
    : null

  const [paises, areas, puestos, jefes] = await Promise.all([
    prisma.pais.findMany({ where: sesion.alcanceRrhh === 'PAIS' && sesion.alcancePaisId ? { id: sesion.alcancePaisId } : {}, orderBy: { nombre: 'asc' } }),
    prisma.area.findMany({ orderBy: { nombre: 'asc' } }),
    prisma.puesto.findMany({ orderBy: { nombre: 'asc' } }),
    prisma.colaborador.findMany({ where: { activo: true, ...alcancePaisWhere(sesion, null) }, orderBy: [{ apellidos: 'asc' }], take: 1200 }),
  ])

  return (
    <>
      <Link href="/admin/colaboradores" className="mb-3 inline-block text-sm text-gris hover:text-negro">← Volver a Colaboradores</Link>
      <Titulo>Hoja de vida</Titulo>
      {!colaborador.activo && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-900">
            <b>Dado de baja</b>{colaborador.bajaEn ? ` el ${colaborador.bajaEn.toLocaleDateString('es-PE')}` : ''} · fuera del padrón activo; su historial se conserva.
          </p>
          {puedeGestionar && <BotonReactivar colaboradorId={colaborador.id} nombre={`${colaborador.nombres} ${colaborador.apellidos}`} />}
        </div>
      )}
      {puedeGestionar && (
      <FormEditarColaborador
        colaborador={{
          id: colaborador.id,
          codigo: colaborador.codigo,
          telefono: colaborador.telefono,
          nivelLiderazgo: colaborador.nivelLiderazgo,
          nombres: colaborador.nombres,
          apellidos: colaborador.apellidos,
          documento: colaborador.documento,
          email: colaborador.email,
          paisId: colaborador.paisId,
          areaId: colaborador.areaId,
          puestoId: colaborador.puestoId,
          jefeId: colaborador.jefeId,
          tieneCuenta: !!colaborador.usuario,
        }}
        paises={paises.map((p) => ({ id: p.id, nombre: p.nombre }))}
        areas={areas.map((a) => ({ id: a.id, nombre: a.nombre }))}
        puestos={puestos.map((p) => ({ id: p.id, nombre: p.nombre, areaId: p.areaId }))}
        jefes={jefes.map((j) => ({ id: j.id, nombre: `${j.nombres} ${j.apellidos}` }))}
        cicloActivo={enCicloActivo?.ciclo.nombre ?? null}
      />
      )}
      <HojaDeVida colaboradorId={id} verComoGestor origenGestor="admin" />
      {colaborador.activo && puedeGestionar && (
        <ZonaBajaColaborador
          colaboradorId={colaborador.id}
          nombre={`${colaborador.nombres} ${colaborador.apellidos}`}
          equipo={colaborador._count.equipo}
          cicloActivo={enCicloActivo?.ciclo.nombre ?? null}
        />
      )}
    </>
  )
}
