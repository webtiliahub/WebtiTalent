# PWA + navegación móvil (sub-proyecto A) — Diseño

**Fecha:** 2026-08-10
**Estado:** Aprobado por Christian (estructura y look validados con mockups navegables en el visual companion; isla híbrida elegida sobre mocks comparativos)

## Problema

La plataforma no tiene experiencia móvil: el shell es una sidebar fija de 64px que se expande con *hover* (inservible en touch) y `ml-16` hardcodeado; no existe manifest, service worker ni icono instalable. El contrato incluye la «versión móvil completa»; este sub-proyecto A entrega la base: **PWA instalable + navegación móvil adaptada al rol**. Las notificaciones push son el sub-proyecto B (encima del service worker que deja este).

## Decisiones de producto (validadas con Christian)

1. **La barra inferior lleva las SECCIONES de alto nivel del usuario** y se adapta al rol:
   - Todos tienen «Lo mío»; +«Mi equipo» si `sesion.esJefe`; +«Admin» si tiene algún permiso admin (`permisosAdmin` con al menos una sección VER).
   - **Regla de aplanado**: si el usuario solo tiene UNA sección (colaborador simple), la barra se convierte en los **4 accesos directos** de Lo mío: Mi hoja · Resultado · Objetivos · Evaluaciones (estilo Instagram, sin nivel intermedio).
   - Con 2+ secciones (jefe, admin): la barra lleva las secciones y cada una abre un **hub de grid de cards** (icono de color + categoría + acción) con sus accesos. El hub reemplaza al sidebar en móvil.
2. **Isla flotante híbrida** (elegida sobre mocks A/B/C): barra flotante con margen, esquinas full-round, sombra y blur; **iconos solos, el tab activo se expande en pastilla roja `#fdeaee`/texto `#f0163e` con su nombre**. Respeta `env(safe-area-inset-bottom)`; el contenido reserva padding inferior para no quedar tapado.
3. **Barra superior móvil**: marca (isotipo + «Hunter · 360») + avatar. El avatar abre un menú con: nombre/rol, selector de país (solo RRHH regional — mismo control que hoy) y **Cerrar sesión con popup de confirmación** (componente `Confirmacion` de la casa).
4. **Escritorio no cambia**: la sidebar actual queda intacta en `md+`. Toda la experiencia nueva vive bajo el breakpoint móvil.
5. **PWA instalable**: manifest con identidad Hunter + iconos 192/512 y maskable derivados de `src/app/icon.png` (1024²) + **service worker mínimo** (sin dependencias): precachea el cascarón e intercepta navegaciones fallidas para mostrar una **página de cortesía offline**. NO cachea datos de negocio (nada de notas/evaluaciones desactualizadas).
6. **Banner de instalación propio**, discreto y descartable (persistir el descarte): Android/Chrome dispara el prompt nativo (`beforeinstallprompt`); iOS muestra la guía «Compartir → Añadir a pantalla de inicio». No aparece si ya corre instalada (`display-mode: standalone`).
7. **Páginas internas: se rediseñan UNA POR UNA después** (iterativo, probando la UX partiendo del shell). En este sub-proyecto se ven dentro del nuevo shell tal como son; solo se corrigen roturas evidentes de overflow si las hay.
8. **Funciones exclusivas de escritorio (decisión de Christian)**: los **importadores** (banco de preguntas, padrón, carga maestra) se usan desde computadora. En viewport móvil esas rutas muestran un **aviso de cortesía** («Esta función se usa desde una computadora») sin bloquear el resto de la página. Lista inicial: `/admin/preguntas/importar`, `/admin/colaboradores/importar`, pestaña «Carga maestra» de `/admin/configuracion`.

## Estructura de navegación por rol (contenido exacto)

| Rol | Barra inferior | Contenido |
|---|---|---|
| Colaborador simple | 4 accesos directos | Mi hoja (`/hoja-de-vida`) · Resultado (`/mi-resultado`) · Objetivos (`/objetivos`) · Evaluaciones (`/evaluaciones`) |
| Jefe | Lo mío · Mi equipo | Cada tab abre su hub de cards. Lo mío: 4 cards (las de arriba). Mi equipo: Ver mi equipo (`/equipo`) · Objetivos del equipo (`/equipo/objetivos`) · Evaluar a mi equipo (`/equipo/evaluar`) · Resultados del equipo (`/equipo/resultados`) |
| Admin (RRHH o rol admin) | Lo mío (+ Mi equipo si esJefe) + Admin | Admin: hub con una card por sección habilitada por `tieneAdmin(permisosAdmin, seccion, 'VER')` — mismas secciones e ítems que hoy arma `layout.tsx` para el sidebar |

- Los hubs son **páginas** (`/movil/lo-mio`, `/movil/equipo`, `/movil/admin` o equivalente decidido en el plan) o vistas del shell; el plan define la ruta técnica. El tab activo se deriva del pathname (misma lógica de prefijo del Shell actual).
- Dentro de una página interna (ej. `/equipo/evaluar`), la isla sigue visible con su sección madre activa; se vuelve al hub con el tab o con el «← Volver» propio de cada página.

## Arquitectura

### 1. Shell responsive — `src/shared/ui/Shell.tsx` + nuevos componentes
- La sidebar actual pasa a `hidden md:flex`; el `ml-16` del main pasa a `md:ml-16`.
- Nuevos componentes cliente colocalizados: `IslaNav.tsx` (isla flotante híbrida; recibe los ítems ya resueltos por rol) y `MenuAvatar.tsx` (menú del avatar con país + cerrar sesión con `Confirmacion`). En móvil la topbar actual se reemplaza por la barra superior móvil (marca + avatar); en `md+` queda la topbar actual.
- `layout.tsx` ya conoce `sesion.esJefe` y `permisosAdmin`: arma y pasa al Shell la estructura de navegación móvil (secciones o accesos directos según la regla de aplanado). El Shell no decide permisos, solo pinta.
- Hubs de cards: componente `HubCards.tsx` (grid 2 columnas, card = icono de color + categoría + título, estilo del mock) usado por las páginas hub.

### 2. PWA — manifest, iconos, service worker
- `src/app/manifest.ts` (convención App Router de Next 16): nombre «Hunter 360», `short_name`, `start_url: '/'`, `display: 'standalone'`, `background_color` hueso, `theme_color` según topbar, iconos 192/512 + maskable.
- Iconos generados desde `src/app/icon.png` (1024²) a `public/` (script efímero con sharp o sips de macOS en build-time manual; los PNG generados se commitean).
- `public/sw.js` a mano: precache de cascarón (iconos, `/offline`) en `install`, limpieza en `activate`, y en `fetch` solo maneja **navegaciones** con `fetch` → fallback a `/offline` si falla la red. No intercepta API ni datos.
- Registro del SW en un client component pequeño montado en el layout raíz (solo en producción).
- Página `/offline` estática de cortesía (marca + «Sin conexión — revisa tu red e inténtalo de nuevo»).
- Metadata raíz: `themeColor`, `viewport`, `appleWebApp` (title, statusBarStyle), `icons` — hoy solo hay title/description.

### 3. Banner de instalación — `BannerInstalar.tsx` (cliente)
- Escucha `beforeinstallprompt` (Android/Chrome): guarda el evento y muestra el banner con botón «Instalar» → `prompt()`.
- iOS (detección por UA + `!standalone`): banner con instrucciones «Compartir → Añadir a pantalla de inicio».
- Descartable con «×»; el descarte persiste en `localStorage` (no volver a mostrar por 30 días). Nunca se muestra en `display-mode: standalone` ni en escritorio.

### 4. Aviso «solo escritorio» — `AvisoSoloEscritorio.tsx`
- Componente reusable: en viewport móvil (`md:hidden`) muestra una franja de cortesía arriba del contenido del importador. Se monta en las 3 rutas de importación listadas. No bloquea.

## Errores y bordes
- Colaborador que también es jefe y admin: barra de 3 secciones (Lo mío · Mi equipo · Admin) — el caso más cargado; la isla soporta hasta 4 ítems sin apretarse (validado en mock con 4).
- Rol admin sin `esJefe`: barra Lo mío · Admin (2).
- Cambio de permisos entre sesiones: la barra se arma server-side por request, igual que el sidebar de hoy — sin estado cacheado en cliente.
- SW y despliegues: `sw.js` con versión en el nombre de cache y `skipWaiting`/`clients.claim` para no servir cascarón viejo tras deploy.
- La página `/offline` accesible también online (inofensiva).
- Safe-area: isla con `bottom: max(12px, env(safe-area-inset-bottom))`; topbar con `padding-top` de notch cuando corre standalone.
- Login/2FA quedan fuera del shell (ya son standalone y funcionan en móvil); el banner de instalación no aparece en `/login`.

## Testing
- **Unit** (lógica pura): resolución de la estructura de navegación móvil por rol (aplanado 1-sección → 4 accesos; 2-3 secciones; admin filtrado por permisos) extrayéndola a una función pura testeable.
- **E2E móvil** (Playwright, viewport 390×844) con los 3 roles del clone: isla correcta por rol y regla de aplanado; hub de cards del jefe y del admin; navegación tab activo; menú avatar + logout con confirmación; aviso solo-escritorio en los importadores; banner de instalación (mock de `beforeinstallprompt`).
- **PWA**: Lighthouse instalable (manifest válido + SW + iconos); `curl` de manifest y sw.js; prueba manual en iPhone/Android de Christian contra el deploy (instalación real y página offline).
- Suite existente (169) sigue verde.

## Fuera de alcance
- Notificaciones push (sub-proyecto B: VAPID, suscripciones, canal en el cron de recordatorios).
- Rediseño móvil de páginas internas (iterativo posterior, página por página).
- Cambios a la experiencia de escritorio.
- Modo offline con datos de negocio.
