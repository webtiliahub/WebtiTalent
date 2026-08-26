# Flujo «¿Olvidaste tu contraseña?» (self-service)

**Fecha:** 2026-08-19 · **Estado:** aprobado por Christian (diseño validado en conversación)

## Objetivo

Recuperación de contraseña self-service desde el login (hoy solo existe el reset administrativo
de RRHH). Afecta la experiencia web y móvil. Con el mailer corporativo (Office365) operativo,
los correos llegan confiablemente incluso a @carsegsa.com.

## Decisiones validadas

1. **UI**: enlace a la derecha del label «Contraseña» del login, gris claro (no satura). Al
   tocarlo, la misma tarjeta cambia a modo recuperación (pide solo el correo).
2. **Anti-enumeración**: la respuesta de solicitar es SIEMPRE la misma («Si la cuenta existe,
   enviamos instrucciones a tu correo»), el envío del correo es asíncrono (latencia constante).
3. **Token de un solo uso**: enlace con token aleatorio de 32 bytes (base64url), almacenado como
   SHA-256 (patrón Codigo2FA/SGSI), expira a los **30 minutos**, se invalidan los previos al
   emitir uno nuevo.
4. **Post-reset SIN auto-login** (decisión explícita): contraseña nueva → volver al login →
   ingreso normal con 2FA. Un correo comprometido no basta para entrar.
5. **Rate limiting** (patrón `RateLimit` existente): solicitar 30/10min por IP + 3/15min por
   cuenta (silencioso, sin delatar existencia); restablecer 20/10min por IP.
6. Al restablecer: se invalidan los demás tokens y los códigos 2FA pendientes, se limpia
   `debeCambiarPassword`, y queda AuditLog `PASSWORD_RESTABLECIDA` (sin datos sensibles).
7. **Política de contraseña**: la misma del reset administrativo (mín. 8, letras y números) —
   extraída a un módulo compartido para que nunca diverjan.

## Piezas

- `prisma/schema.prisma`: `model TokenRestablecimiento` (espejo de Codigo2FA sin `intentos`).
- `src/shared/lib/password.ts` (nuevo): `esquemaPasswordNueva` compartido + test.
- `src/shared/lib/mailer.ts`: `enviarRestablecimiento(email, enlace)` con `botonCta`.
- `src/app/api/auth/solicitar-restablecimiento/route.ts` y `src/app/api/auth/restablecer/route.ts`
  (espejo de `solicitar-codigo`: respuesta genérica, hash señuelo no aplica — no hay password).
- `src/app/restablecer/page.tsx` (+ layout con viewport del login): tarjeta auth con nueva
  contraseña + confirmación; token desde querystring; éxito → CTA al login.
- `src/app/login/page.tsx`: enlace gris + modo recuperación inline.

## Fuera de alcance

Cambiar el flujo 2FA, el reset administrativo de RRHH (sigue existiendo) y cualquier notificación
adicional (p. ej. aviso de «tu contraseña cambió») — candidato futuro.
