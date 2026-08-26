# Roles y permisos del módulo de Administración — Diseño

**Fecha:** 2026-08-03 · **Aprobado por:** Christian (brainstorming 03/08)

## Contexto y motivación

La propuesta comercial (parte del acuerdo íntegro del contrato) remite al mockup navegable,
que mostraba en Configuración una pestaña «🔐 Roles y permisos» con matriz configurable y
«+ Crear rol». Hoy los permisos existen como comportamiento (guards por rol RRHH/Colaborador
+ jefe derivado + alcance país) pero no hay matriz visible ni roles configurables.

Decisión de Christian (03/08): entregar el módulo configurable, **acotado al módulo de
Administración**. Los roles con papel en el proceso de evaluación (Jefe, Colaborador) NO son
configurables. Casos objetivo: **Auditor** (solo observa la administración), **Gerencial**
(ve analítica y colaboradores), y roles ad-hoc tipo **Asistente de RR.HH.** (p. ej. gestiona
colaboradores pero no puede lanzar un ciclo).

## Reglas de negocio

1. Los roles configurables solo otorgan permisos sobre **secciones del módulo de
   Administración**, con tres niveles por sección: **— (sin acceso) · VER · GESTIONAR**
   (GESTIONAR incluye VER).
2. **Jefe y Colaborador quedan fuera del modelo**: su comportamiento es parte del proceso
   (aprobaciones, ascendentes, feedback, gates) y no se toca.
3. El **alcance por país vive en el usuario** (`alcancePaisId`), independiente del rol, y
   acota lo que cualquier rol ve o gestiona.
4. **RR.HH. es un rol de sistema**: fila visible en la matriz con todo en GESTIONAR, no
   editable ni eliminable. Además conserva los **poderes de proceso** fuera del catálogo:
   aprobar objetivos de personal sin jefe, exención de conformidad (Regional), y todo lo
   que hoy exige `requiereRrhh` fuera del admin.
5. **Anti-escalada**: la sección «Usuarios y roles» solo admite VER para roles creados; su
   GESTIÓN queda reservada al rol de sistema RR.HH. Nadie edita su propio rol.
6. Un usuario con rol admin configurable **sigue siendo colaborador normal** (Lo mío, sus
   evaluaciones, Mi equipo si es jefe); el rol solo SUMA vistas/gestión del admin.
7. Los usuarios con rol Auditor ven información sensible (notas, calibraciones,
   observaciones) dentro de su alcance país — es el propósito del rol; comunicarlo a Hunter.

## Catálogo de secciones (`SeccionAdmin`)

| Sección | VER | GESTIONAR | Notas |
|---|---|---|---|
| `COLABORADORES` | directorio + hojas de vida | crear/editar/baja/reactivar, importador CSV | |
| `PUESTOS` | puestos y niveles | CRUD puestos, competencias×puesto, pesos×puesto | |
| `EVALUACIONES` | banco y diseños | CRUD banco, evaluaciones con nombre | /admin/preguntas |
| `OBJETIVOS` | transversales + períodos | CRUD transversales, logro transversal, períodos, extensiones | aprobar sin-jefe queda en `requiereRrhh` (proceso) |
| `CICLOS` | detalle completo del ciclo (monitoreo, pares, feedback, conformidad, calibración, incidentes, avance país) en lectura | crear/editar/lanzar/cerrar/publicar (ciclo y país), calibrar, pares RR.HH., incidentes (reasignar/cancelar/invalidar/rehabilitar/retirar) | exención de conformidad queda en `requiereRrhh` REGIONAL |
| `RESULTADOS` | 9-Box + análisis del ciclo + export | — (solo VER; exportar cuenta como VER) | |
| `CONFIGURACION` | modelo, ponderaciones, niveles | guardar pesos, CRUD niveles/dimensiones/competencias | |
| `USUARIOS_ROLES` | pestañas Usuarios y Roles en lectura | — para roles creados (regla 5); gestiona solo RR.HH. sistema | |
| `AUDITORIA` | log de auditoría | — (solo VER) | |

**Regla fail-closed:** toda página o server action del admin no mapeada explícitamente a una
sección conserva `requiereRrhh` (rol de sistema).

## Modelo de datos

```prisma
model RolAdmin {
  id          String    @id @default(cuid())
  nombre      String    @unique
  descripcion String?
  esSistema   Boolean   @default(false)
  permisos    Json      // Record<SeccionAdmin, 'VER' | 'GESTIONAR'>; sección ausente = sin acceso
  usuarios    Usuario[]
}
// Usuario: + rolAdminId String?  + rolAdmin RolAdmin? (relación opcional)
```

- `Usuario.rol` (enum `RRHH | COLABORADOR`) se conserva con su semántica actual. RRHH ≡ rol
  de sistema (todo GESTIONAR + poderes de proceso). Un COLABORADOR puede tener `rolAdminId`.
- Cambio de schema aditivo (tabla nueva + columna nullable): `db push` seguro; orden de
  deploy = schema a Neon → seed → código.

## Sesión y guards

- `SesionUsuario` gana `permisosAdmin: Partial<Record<SeccionAdmin, 'VER' | 'GESTIONAR'>>`:
  RRHH → todas las secciones en GESTIONAR; con `rolAdminId` → el JSON del rol; si no → `{}`.
- Nuevos helpers en `src/shared/lib/permisos.ts`:
  - `tieneAdmin(sesion, seccion, nivel)` — puro, para nav y UI (GESTIONAR satisface VER).
  - `requiereAdmin(seccion, nivel)` — guard de páginas (redirect a /hoja-de-vida) y de
    server actions (las actions devuelven `{ ok: false, error: 'Tu rol no permite gestionar
    esta sección' }` en lugar de redirect).
- `requiereRrhh` NO desaparece: poderes de proceso + gestión de usuarios/roles + fail-closed.
- `alcancePaisWhere` / `fueraDeAlcancePais` se generalizan: aplican a cualquier usuario con
  acceso admin cuyo alcance sea PAIS (hoy keyean `alcanceRrhh`; el campo de alcance del
  usuario pasa a aplicar también a roles configurables). Barrer TODAS las queries admin en
  la revisión final para confirmar que ninguna evade el alcance.

## Pestaña «Roles» (Configuración)

- **Matriz**: filas = roles (RR.HH. sistema con candado, luego los creados), columnas = 9
  secciones, celda = selector — / 👁 Ver / ✎ Gestionar. Las columnas RESULTADOS, AUDITORIA y
  USUARIOS_ROLES solo ofrecen —/Ver para roles creados.
- **+ Crear rol**: nombre (único), descripción, permisos (mínimo 1 sección). Editar en línea
  por celda o formulario. **Eliminar** bloqueado si `esSistema` o si tiene usuarios asignados.
- Validación server con Zod contra el catálogo. AuditLog: `ROL_CREADO`, `ROL_ACTUALIZADO`
  (con diff de permisos), `ROL_ELIMINADO`.
- **Usuarios y acceso**: el selector de rol ofrece «RR.HH. (sistema)» / «Colaborador» /
  roles creados; el alcance país sigue como campo aparte del usuario. Cambio de rol →
  AuditLog (`USUARIO_ROL_ADMIN`).

## Seeds (filas normales, editables)

- **Auditor**: las 9 secciones en VER.
- **Gerencial**: `RESULTADOS: VER` + `COLABORADORES: VER`.

Seed idempotente (upsert por nombre) que además crea la fila sistema «RR.HH.» con todo en
GESTIONAR. No migra usuarios (los RRHH existentes siguen por enum).

## Navegación y modo VER

- El grupo «Administración» del menú se filtra por `permisosAdmin` (cada ítem exige VER de
  su sección; el grupo aparece si hay ≥1). La pestaña Configuración muestra solo los tabs
  permitidos (modelo/ponderaciones = CONFIGURACION; usuarios y roles = USUARIOS_ROLES;
  auditoría = AUDITORIA).
- Cada página admin pasa `puedeGestionar` (= `tieneAdmin(sesion, seccion, 'GESTIONAR')`) a
  sus paneles; estos ocultan la UI de mutación (botones crear/editar/lanzar/calibrar/
  resolver/importar, selects de asignación). Se reusa el patrón `soloLectura` existente
  (TablaParesRrhh, ciclos cerrados) donde ya está.
- Backstop de seguridad: aunque un control quede visible, la server action rechaza.

## Errores y candados

- Rol sistema: no editable, no eliminable. Rol con usuarios: no eliminable (mensaje con el
  conteo). Nombre duplicado → error claro. Un usuario no puede cambiar su propio rol.
- Mensajes en español neutro, mismo tono del resto («Tu rol no permite gestionar esta
  sección», «Ese rol tiene N usuarios asignados: reasígnalos antes de eliminarlo»).

## Validación

1. Tests unitarios del resolutor (`tieneAdmin`): GESTIONAR⊃VER, sección ausente = sin
   acceso, RRHH todo, `{}` nada.
2. `tsc` + build + suite completa.
3. E2E en el clone: crear rol «Asistente RRHH» (COLABORADORES Gestionar + CICLOS Ver),
   asignarlo a un usuario de prueba, login: el menú muestra solo Colaboradores y Ciclos;
   crea un colaborador ✓; abre un ciclo y NO ve botones de gestión; invoca lanzar/calibrar
   → rechazado por el server. Rol Auditor: navega las 9 secciones sin un solo control de
   mutación. Gerencial con alcance país: no ve colaboradores/resultados de otro país.
4. QA de Charly con el rol Auditor (mirada de usuario).

## Fuera de alcance

- Permisos de escritura sobre el proceso de evaluación (aprobar objetivos de equipos,
  responder evaluaciones por otros, exención de conformidad) — siguen en los roles de
  proceso y RR.HH. de sistema.
- Usuarios sin colaborador vinculado (auditor externo) — hoy toda cuenta requiere
  colaborador; si Hunter lo pide, es cambio aparte.
- Multi-rol por usuario (un usuario tiene a lo sumo UN rol admin).
- Traducción del catálogo o permisos por país distintos al alcance.
