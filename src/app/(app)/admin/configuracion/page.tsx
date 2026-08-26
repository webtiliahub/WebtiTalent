import { Lock } from 'lucide-react'
import { redirect } from 'next/navigation'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/shared/lib/prisma'
import { requiereSesion, alcancePaisWhere } from '@/shared/lib/permisos'
import { tieneAdmin, type SeccionAdmin } from '@/shared/lib/permisos-admin'
import { AvisoSoloLectura, Card, Titulo, Vacio } from '@/shared/ui/componentes'
import { Tabs } from '@/shared/ui/Tabs'
import { FormConfiguracion } from '@/features/admin/FormConfiguracion'
import { FormModeloCompetencias } from '@/features/admin/FormModeloCompetencias'
import { PanelNiveles } from '@/features/admin/PanelNiveles'
import { PanelUsuarios } from '@/features/admin/PanelUsuarios'
import { TablaRoles, type RolFila } from '@/features/admin/TablaRoles'
import { CargaMaestra } from '@/features/admin/maestro/CargaMaestra'
import { FiltrosAuditoria } from '@/features/admin/FiltrosAuditoria'
import type { PermisosAdmin } from '@/shared/lib/permisos-admin'

export default async function ConfiguracionPage({ searchParams }: {
  searchParams: Promise<{ tab?: string; accion?: string; usuario?: string; desde?: string; hasta?: string }>
}) {
  const { tab, accion: accionParam, usuario: usuarioParam, desde: desdeParam, hasta: hastaParam } = await searchParams
  const sesion = await requiereSesion()
  const ve = (s: SeccionAdmin) => tieneAdmin(sesion.permisosAdmin, s, 'VER')
  const gestiona = (s: SeccionAdmin) => tieneAdmin(sesion.permisosAdmin, s, 'GESTIONAR')
  if (!ve('CONFIGURACION') && !ve('USUARIOS_ROLES') && !ve('AUDITORIA')) redirect('/hoja-de-vida')
  const gestionaConfig = gestiona('CONFIGURACION')
  const gestionaUsuarios = gestiona('USUARIOS_ROLES')

  /* ── Filtros del log de auditoría ──
     Las fechas se interpretan en hora de Lima (UTC-5), que es donde está RR.HH.: con UTC puro,
     «hoy» se cortaría a las 19:00 locales. Sin filtro de año: el rango desde/hasta ya lo cubre. */
  const LIMA = '-05:00'
  // Acción es MULTISELECT: viaja como CSV en la URL y filtra con `in`
  const accionFiltro = accionParam?.trim() || ''
  const accionesFiltro = accionFiltro ? accionFiltro.split(',').map((a) => a.trim()).filter(Boolean) : []
  const usuarioFiltro = usuarioParam?.trim() || ''
  const fecha = (f: string, fin = false) => new Date(`${f}T${fin ? '23:59:59.999' : '00:00:00.000'}${LIMA}`)
  const desdeFiltro = /^\d{4}-\d{2}-\d{2}$/.test(desdeParam ?? '') ? desdeParam! : ''
  const hastaFiltro = /^\d{4}-\d{2}-\d{2}$/.test(hastaParam ?? '') ? hastaParam! : ''
  const hayFiltrosAuditoria = Boolean(accionFiltro || usuarioFiltro || desdeFiltro || hastaFiltro)

  /* Alcance de país en las dos vistas que no lo tenían. Sin esto, un RR.HH. de país veía el
     padrón de cuentas de los cuatro países y, en el log, un `detalle` que su alcance le niega en
     todas las demás pantallas: calibraciones con nota anterior y nueva, quién evaluó a quién con
     su motivo, exenciones de conformidad nominales.
     El log no está modelado por país, así que se acota por AUTOR dentro del alcance: se pierde de
     vista lo que hizo Regional sobre su país, que es el compromiso razonable frente a mostrarlo
     todo. Las MUTACIONES de usuarios ya estaban bien cerradas (`errorDeAlcance`). */
  const alcance = alcancePaisWhere(sesion)
  const whereUsuarios: Prisma.UsuarioWhereInput = alcance.paisId
    // Fail-closed igual que `errorDeAlcance`: una cuenta sin colaborador no es de ningún país
    ? { colaborador: { is: { paisId: alcance.paisId } } }
    : {}
  const whereAutorEnAlcance: Prisma.AuditLogWhereInput = alcance.paisId
    ? { usuario: { is: { colaborador: { is: { paisId: alcance.paisId } } } } }
    : {}

  const whereAuditoria: Prisma.AuditLogWhereInput = {
    ...(accionesFiltro.length > 0 ? { accion: { in: accionesFiltro } } : {}),
    ...(usuarioFiltro ? { usuarioId: usuarioFiltro } : {}),
    ...(desdeFiltro || hastaFiltro
      ? { createdAt: { ...(desdeFiltro ? { gte: fecha(desdeFiltro) } : {}), ...(hastaFiltro ? { lte: fecha(hastaFiltro, true) } : {}) } }
      : {}),
  }

  // Cada consulta solo se ejecuta si el tab que la consume es visible: no filtrar datos
  // (usuarios, auditoría, modelo) a quien no tiene permiso para verlos.
  const [pesosModalidades, pesosSinReportes, niveles, usuarios, auditoria, dimensiones, sinCuenta, paises, roles, areasMaestra, paisesMaestra, cuentasRolSistema] = await Promise.all([
    ve('CONFIGURACION') ? prisma.config.findUnique({ where: { clave: 'pesosModalidades' } }) : Promise.resolve(null),
    ve('CONFIGURACION') ? prisma.config.findUnique({ where: { clave: 'pesosModalidadesSinReportes' } }) : Promise.resolve(null),
    ve('CONFIGURACION')
      ? prisma.nivelJerarquico.findMany({
          include: { _count: { select: { puestos: true } } },
          orderBy: { orden: 'asc' },
        })
      : Promise.resolve([]),
    ve('USUARIOS_ROLES')
      ? prisma.usuario.findMany({ where: whereUsuarios, include: { colaborador: { include: { pais: true } } }, orderBy: { email: 'asc' } })
      : Promise.resolve([]),
    ve('AUDITORIA')
      ? prisma.auditLog.findMany({
          where: { ...whereAuditoria, ...whereAutorEnAlcance },
          include: { usuario: { include: { colaborador: true } } },
          orderBy: { createdAt: 'desc' },
          // Sin filtros, las últimas 30 (la vista de siempre). Con filtros se busca algo
          // concreto: hasta 200, y el total se informa aparte.
          take: hayFiltrosAuditoria ? 200 : 30,
        })
      : Promise.resolve([]),
    ve('CONFIGURACION')
      ? prisma.dimension.findMany({
          include: { competencias: { include: { _count: { select: { preguntas: true, puestos: true } } }, orderBy: { nombre: 'asc' } } },
          orderBy: { orden: 'asc' },
        })
      : Promise.resolve([]),
    ve('USUARIOS_ROLES')
      ? prisma.colaborador.findMany({
          // Mismo alcance que la lista de usuarios: sin esto, el combobox «crear cuenta» filtraba
          // nombre + correo + país de los colaboradores sin cuenta de los cuatro países
          where: { activo: true, usuario: null, ...alcancePaisWhere(sesion) },
          include: { pais: true },
          orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
        })
      : Promise.resolve([]),
    ve('USUARIOS_ROLES') ? prisma.pais.findMany({ orderBy: { nombre: 'asc' } }) : Promise.resolve([]),
    ve('USUARIOS_ROLES')
      ? prisma.rolAdmin.findMany({ include: { _count: { select: { usuarios: true } } }, orderBy: [{ esSistema: 'desc' }, { nombre: 'asc' }] })
      : Promise.resolve([]),
    // Áreas y países para la plantilla de Carga Maestra — gateados por el mismo permiso que su
    // tab ('maestra' solo se muestra con ve('CONFIGURACION')), no por USUARIOS_ROLES (que ya
    // trae `paises` con otro propósito y podría no estar disponible para este usuario).
    ve('CONFIGURACION') ? prisma.area.findMany({ orderBy: { nombre: 'asc' } }) : Promise.resolve([]),
    ve('CONFIGURACION') ? prisma.pais.findMany({ orderBy: { nombre: 'asc' } }) : Promise.resolve([]),
    // El rol de SISTEMA no se asigna por rolAdminId sino por Usuario.rol = 'RRHH': su _count de
    // la relación siempre da 0 y la tabla de roles mostraba «0 usuarios» para RR.HH.
    ve('USUARIOS_ROLES') ? prisma.usuario.count({ where: { rol: 'RRHH' } }) : Promise.resolve(0),
  ])

  // Catálogos de los filtros: solo lo que REALMENTE aparece en el log (ofrecer una acción o un
  // usuario sin registros da resultados vacíos y parece un error)
  // El mismo alcance que la tabla: si no, el filtro de usuarios ofrecería autores de otros países
  // (nombres y correos fuera de alcance) y el contador diría más registros de los que se muestran
  const [accionesLog, autoresLog, totalAuditoria] = await Promise.all([
    ve('AUDITORIA') ? prisma.auditLog.groupBy({ by: ['accion'], where: whereAutorEnAlcance, _count: { accion: true }, orderBy: { accion: 'asc' } }) : Promise.resolve([]),
    ve('AUDITORIA') ? prisma.auditLog.groupBy({ by: ['usuarioId'], where: whereAutorEnAlcance, _count: { usuarioId: true } }) : Promise.resolve([]),
    ve('AUDITORIA') && hayFiltrosAuditoria ? prisma.auditLog.count({ where: { ...whereAuditoria, ...whereAutorEnAlcance } }) : Promise.resolve(0),
  ])
  const idsAutores = autoresLog.map((a) => a.usuarioId).filter((id): id is string => id !== null)
  const usuariosLog = idsAutores.length > 0
    ? await prisma.usuario.findMany({
        where: { id: { in: idsAutores } },
        select: { id: true, email: true, colaborador: { select: { nombres: true, apellidos: true } } },
      })
    : []
  const nombreAutor = (u: (typeof usuariosLog)[number]) =>
    u.colaborador ? `${u.colaborador.nombres} ${u.colaborador.apellidos}` : u.email
  const opcionesUsuario = usuariosLog
    .map((u) => ({ valor: u.id, etiqueta: nombreAutor(u) }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta))


  const paisPorId = new Map(paises.map((p) => [p.id, p.nombre]))
  const rolPorId = new Map(roles.map((r) => [r.id, r.nombre]))

  const rolesFilas: RolFila[] = roles.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    descripcion: r.descripcion,
    esSistema: r.esSistema,
    permisos: r.permisos as PermisosAdmin,
    usuarios: r.esSistema ? cuentasRolSistema : r._count.usuarios,
  }))
  // Roles asignables a un usuario COLABORADOR: nunca el de sistema (RR.HH. ya implica todo).
  const rolesAsignables = roles.filter((r) => !r.esSistema).map((r) => ({ id: r.id, nombre: r.nombre }))

  const tabModelo = (
    <>
      {!gestionaConfig && <AvisoSoloLectura />}
      <FormModeloCompetencias
      puedeGestionar={gestionaConfig}
      dimensiones={dimensiones.map((d) => ({
        id: d.id,
        nombre: d.nombre,
        descripcion: d.descripcion,
        competencias: d.competencias.map((c) => ({
          id: c.id,
          nombre: c.nombre,
          descripcion: c.descripcion,
          enUso: c._count.preguntas > 0 || c._count.puestos > 0,
        })),
      }))}
      />
    </>
  )

  const tabPonderaciones = (
    <>
      {!gestionaConfig && <AvisoSoloLectura />}
      <div className="grid items-start gap-5 lg:grid-cols-2">
      <FormConfiguracion
        puedeGestionar={gestionaConfig}
        pesosModalidades={(pesosModalidades?.valor ?? { JEFE: 50, PAR: 20, ASCENDENTE: 30, AUTO: 0 }) as Record<string, number>}
        pesosSinReportes={(pesosSinReportes?.valor ?? { JEFE: 60, PAR: 40, ASCENDENTE: 0, AUTO: 0 }) as Record<string, number>}
      />
      <PanelNiveles
        puedeGestionar={gestionaConfig}
        niveles={niveles.map((n) => ({
          id: n.id,
          nombre: n.nombre,
          compPct: n.compPct,
          enUso: n._count.puestos > 0,
          puestos: n._count.puestos,
        }))}
      />
      </div>
    </>
  )

  const tabUsuarios = (
    <>
      {!gestionaUsuarios && <AvisoSoloLectura />}
      <PanelUsuarios
      miUsuarioId={sesion.id}
      puedeGestionar={gestionaUsuarios}
      usuarios={usuarios.map((u) => ({
        id: u.id,
        nombre: u.colaborador ? `${u.colaborador.nombres} ${u.colaborador.apellidos}` : u.email,
        email: u.email,
        rol: u.rol,
        alcanceRrhh: u.alcanceRrhh,
        alcancePaisId: u.alcancePaisId,
        rolAdminId: u.rolAdminId,
        rolAdminNombre: u.rolAdminId ? rolPorId.get(u.rolAdminId) ?? null : null,
        // El alcance de un RR.HH. de país es su alcancePaisId, NO el país del colaborador
        // (un RR.HH. puede administrar un país distinto al suyo).
        alcancePaisNombre: u.alcancePaisId ? paisPorId.get(u.alcancePaisId) ?? null : null,
        activo: u.activo,
      }))}
      sinCuenta={sinCuenta.map((c) => ({
        id: c.id,
        nombre: `${c.nombres} ${c.apellidos}`,
        email: c.email,
        paisNombre: c.pais.nombre,
      }))}
      paises={paises.map((p) => ({ id: p.id, nombre: p.nombre }))}
      roles={rolesAsignables}
      />
    </>
  )

  const tabRoles = <TablaRoles roles={rolesFilas} puedeGestionar={sesion.rol === 'RRHH'} />

  const tabMaestra = (
    <CargaMaestra
      puedeGestionar={sesion.rol === 'RRHH' && sesion.alcanceRrhh === 'REGIONAL'}
      catalogos={{
        niveles: niveles.map((n) => n.nombre),
        dimensiones: dimensiones.map((d) => d.nombre),
        competencias: dimensiones.flatMap((d) => d.competencias.map((c) => c.nombre)),
        paises: paisesMaestra.map((p) => p.nombre),
        areas: areasMaestra.map((a) => a.nombre),
      }}
    />
  )

  const tabAuditoria = (
    <Card
      titulo="Log de auditoría"
      extra={hayFiltrosAuditoria
        ? `${auditoria.length} de ${totalAuditoria} coincidencia${totalAuditoria === 1 ? '' : 's'}`
        : 'últimas 30 acciones sensibles'}
    >
      <FiltrosAuditoria
        acciones={accionesLog.map((a) => ({ valor: a.accion, etiqueta: `${a.accion} (${a._count.accion})` }))}
        usuarios={opcionesUsuario}
        accionSel={accionFiltro}
        usuarioSel={usuarioFiltro}
        desdeSel={desdeFiltro}
        hastaSel={hastaFiltro}
        hayFiltros={hayFiltrosAuditoria}
      />
      {hayFiltrosAuditoria && totalAuditoria > auditoria.length && (
        <p className="mb-3 text-[11.5px] text-gris">
          Se muestran las {auditoria.length} más recientes de {totalAuditoria}: acota el rango de fechas para ver el resto.
        </p>
      )}
      {auditoria.length === 0 && (
        <Vacio>{hayFiltrosAuditoria ? 'Ninguna acción coincide con estos filtros.' : 'Sin acciones registradas todavía.'}</Vacio>
      )}
      <ul className="space-y-1.5 text-xs">
        {auditoria.map((a) => (
          <li key={a.id} className="rounded-lg bg-hueso px-3 py-2">
            <b>{a.accion}</b>
            {a.usuario?.colaborador ? ` · ${a.usuario.colaborador.nombres} ${a.usuario.colaborador.apellidos}` : ''}
            <span className="block text-gris md:ml-1 md:inline">{a.createdAt.toLocaleString('es-PE')}</span>
            {/* El JSON crudo ocupaba varias líneas ilegibles en el teléfono: plegado en móvil,
                en línea en escritorio */}
            {a.detalle ? (
              <>
                <details className="mt-1 md:hidden">
                  <summary className="cursor-pointer list-none text-[11px] font-bold text-gris [&::-webkit-details-marker]:hidden">› ver detalle</summary>
                  <p className="mt-1 break-all rounded bg-white/70 px-2 py-1 text-[11px] text-gris">{JSON.stringify(a.detalle)}</p>
                </details>
                <span className="hidden text-gris md:inline"> · {JSON.stringify(a.detalle)}</span>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-gris"><Lock size={12} className="mr-1 inline -translate-y-px" />Toda acción sensible (lanzar, calibrar, cerrar, importar, configurar) queda registrada con usuario, fecha y detalle.</p>
    </Card>
  )

  const tabs: { id: string; label: string; icono?: string; contenido: React.ReactNode; soloEscritorio?: boolean }[] = []
  if (ve('CONFIGURACION')) {
    tabs.push({ id: 'modelo', label: 'Modelo de competencias', icono: 'modelo', contenido: tabModelo })
    tabs.push({ id: 'ponderaciones', label: 'Ponderaciones', icono: 'ponderaciones', contenido: tabPonderaciones })
  }
  if (ve('USUARIOS_ROLES')) {
    tabs.push({ id: 'usuarios', label: 'Usuarios y acceso', icono: 'usuarios', contenido: tabUsuarios })
    tabs.push({ id: 'roles', label: 'Roles y permisos', icono: 'usuarios', contenido: tabRoles })
  }
  // Carga maestra: los importadores son exclusivos de Web (igual que el padrón, el banco de
  // preguntas y las plantillas). La pestaña se oculta por CSS en móvil — así el contenido sigue
  // server-rendered para escritorio sin duplicar la página.
  if (ve('CONFIGURACION')) tabs.push({ id: 'maestra', label: 'Carga maestra', icono: 'maestra', contenido: tabMaestra, soloEscritorio: true })
  if (ve('AUDITORIA')) tabs.push({ id: 'auditoria', label: 'Auditoría', icono: 'auditoria', contenido: tabAuditoria })

  return (
    <>
      <Titulo sub="Modelo de competencias, ponderaciones, usuarios con acceso y registro de auditoría">Configuración</Titulo>
      {/* `inicial`: al aplicar un filtro de auditoría la URL trae ?tab=auditoria, y sin esto
          la página volvería a abrir «Modelo de competencias» */}
      <Tabs tabs={tabs} rejillaMovil inicial={tabs.some((t) => t.id === tab) ? tab : undefined} />
    </>
  )
}
