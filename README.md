# WebtiTalent

Plataforma interna de gestión de desempeño y talento de **Webtilia Marketing Solutions S.A.C.**: ciclos de evaluación 360, objetivos, 9-Box, analítica y feedback/PDI. PWA con notificaciones push.

## Stack

- **Next.js 16** (App Router, server components + server actions) · TypeScript
- **Prisma 7** + `@prisma/adapter-pg` · PostgreSQL en Neon
- **NextAuth v4** (credentials) con **2FA por correo** (código 6 dígitos, 10 min, un solo uso)
- **bcrypt** para contraseñas · SHA-256 para tokens
- **TailwindCSS 4** · marca Webtilia (azul `#0067FF`; rojo `#F0163E` reservado para alertas)
- **Vitest** — tests del motor de cálculo
- Correo transaccional por **Resend** (`RESEND_API_KEY` + `RESEND_FROM`); en desarrollo sin transporte, los correos se imprimen en consola
- Deploy: **Vercel** (proyecto `webtitalent`, equipo `webtilia-produ`), conectado al repo — push a `main` = deploy a producción

## Arranque local

```bash
npm install
cp .env.example .env             # y completar valores
npx prisma db push
npx tsx prisma/seed-limpio.ts    # instalación mínima: Perú + usuario RR.HH. + preguntas de potencial
npx tsx prisma/seed-roles-admin.ts
npm run dev                      # http://localhost:3000
```

El código 2FA se imprime en la consola del server en desarrollo.

Seeds adicionales: `prisma/seed.ts` (org simulada completa para demo, contraseña `Demo2026!`) y `prisma/simular-ciclo.ts` (responde todas las evaluaciones del ciclo activo con perfiles realistas). Todos los scripts de `prisma/` exigen base local o `CONFIRMAR_PROD=SI` explícito.

## Funcionalidad

- **Motor 360:** ciclos tipo campaña con wizard (datos → alcance → cuestionarios por nivel → revisión); el lanzamiento genera auto/jefe/ascendente y los pares se asignan manualmente. Modalidades ponderadas configurables. Los ciclos congelan su perfil de evaluación al lanzarse (resultados reproducibles).
- **Objetivos:** transversales focalizables (país/nivel/área) + individuales propuestos por el colaborador y aprobados por el jefe (él define el peso final); la suma por persona debe ser 100% (validado en servidor).
- **Cálculo:** nota de competencias ponderada por dimensión y modalidad → combinada con objetivos según nivel jerárquico.
- **Calibración auditada:** ajuste con motivo obligatorio; registro inmutable.
- **9-Box:** potencial (5 preguntas del jefe) × desempeño. Confidencial: el colaborador nunca ve su box.
- **Cierre y publicación**, **feedback/PDI**, **recordatorios automáticos** (cron diario), **analítica** (heatmap, radar, comparativa), **importadores** (padrón CSV, banco de preguntas XLSX), **roles admin configurables** y **AuditLog** de acciones sensibles.

## Variables de entorno

Ver `.env.example`. En producción además: `APP_URL` (URL base explícita de los correos — sin ella los botones apuntan a localhost), `CRON_SECRET`, llaves `VAPID_*` (push) y credenciales Resend.
