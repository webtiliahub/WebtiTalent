# Plataforma de Evaluación de Desempeño 360 — Hunter (Fase 1)

Sistema de gestión de desempeño y talento a la medida de Hunter (Autosafe S.A.C.).
Desarrollado por **Webtilia Marketing Solutions S.A.C.**

## Stack

- **Next.js 16** (App Router, server components + server actions) · TypeScript
- **Prisma 7** + `@prisma/adapter-pg` · PostgreSQL (local: Homebrew · prod: Neon)
- **NextAuth v4** (credentials) con **2FA por correo** (código 6 dígitos, 10 min, un solo uso)
- **bcrypt** para contraseñas (autorizado por TI Hunter el 2026-06-12) · SHA-256 para tokens
- **TailwindCSS 4** · branding Hunter (rojo `#F0163E`, negro `#2A2623`, Raleway + Roboto)
- **Vitest** — 18 tests del motor de cálculo

## Arranque local

```bash
createdb hunter360
npm install
npx prisma db push
npx tsx prisma/seed.ts          # datos SIMULADOS (cumple SGSI — nunca el padrón real en dev)
npm run dev                      # http://localhost:3000
```

**Credenciales demo** (contraseña `Hunter2026!`):
| Rol | Email |
|---|---|
| RR.HH. Regional | `mperez@hunter.com.pe` |
| Jefa (Operaciones) | `atorres@hunter.com.pe` |
| Colaboradora | `lparedes@hunter.com.pe` |

El código 2FA se imprime en la consola del server en desarrollo.

`npx tsx prisma/simular-ciclo.ts` responde todas las evaluaciones del ciclo activo con perfiles realistas (para demo).

## Alcance Fase 1 (Anexo A del contrato)

- **Motor 360:** ciclos tipo campaña con wizard (datos → alcance → cuestionarios por nivel → revisión); el lanzamiento genera auto/jefe/ascendente y los pares se asignan manualmente. Modalidades ponderadas (Jefe 60 / Pares 25 / Ascendente 15 / Auto 0, configurable). Pares solo evalúan Operativa y Liderazgo, anónimo para el evaluado.
- **Objetivos:** transversales focalizables (país/nivel/área) definidos por RR.HH./Dirección + individuales propuestos por el colaborador y **aprobados por el jefe (él define el peso final)**; la suma por persona debe ser 100% (validado en servidor). Sin comentarios cualitativos (decisión RR.HH.).
- **Cálculo:** nota de competencias ponderada por dimensión (pesos del puesto) y modalidad → combinada con objetivos según nivel (Ger 50/50 · MM 60/40 · Esp 50/50 · Apoyo 70/30). Cada ciclo congela su configuración al crearse.
- **Calibración auditada:** ajuste con motivo obligatorio; registro inmutable (quién, cuándo, antes → después). El box se recalcula con la nota calibrada.
- **9-Box:** potencial = 5 preguntas del jefe (eje Y) × desempeño (eje X). Vista RR.HH. con filtros ciclo/área/país y detalle por cuadrante. **Confidencial**: el colaborador nunca ve su box.
- **Cierre y publicación:** recalcula resultados (política de incompletos: renormaliza pesos de modalidades recibidas) y publica a colaboradores.
- **Feedback/PDI:** acuerdos editables por jefe y colaborador + plan de desarrollo.
- **Multipaís por permisos:** RR.HH. Regional ve todo con selector que **solo filtra datos** (no cambia el rol); RR.HH. de país queda acotado.
- **Importación CSV** del padrón (`nombres,apellidos,documento,email,pais,area,puesto,jefe_documento`).
- **Auditoría:** AuditLog de acciones sensibles (lanzar, calibrar, cerrar, importar, configurar).

## Seguridad (SGSI Hunter)

Checklist completo en `~/Desktop/Hunter/Desarrollo/README - Seguridad y entorno.md`.
Aplicado en código: bcrypt (contraseñas), SHA-256 (códigos 2FA), 2FA obligatorio, guards server-side fail-closed por rol, datos simulados en dev, validaciones server-side en todas las actions, sin secretos en el repo.

## Pendientes para producción

- [ ] Proveedor SMTP aprobado por TI (SPF/DKIM) para el correo 2FA — `src/shared/lib/mailer.ts`
- [ ] Neon + Vercel (ambientes preview/producción separados) y rotación de `NEXTAUTH_SECRET`
- [ ] Pentest + aprobación legal de Hunter (condición de go-live, cláusula 11ª)
- [ ] Carga del padrón real SOLO en producción
