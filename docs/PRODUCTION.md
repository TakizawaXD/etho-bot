# Lista de verificación para producción

Marca cada punto antes de abrir el servicio a clientes reales.

## 1. Verificación técnica (obligatoria)
- [ ] `npm install` y subir el `package-lock.json` regenerado (el original estaba desactualizado).
- [ ] `npm test` en verde (valida formato, IA, planes, pagos, rutas y mantenimiento).
- [ ] `npm audit --omit=dev`: revisar vulnerabilidades. Algunas dependencias indirectas (por ejemplo las de `wa-sticker-formatter`) traían versiones antiguas de `axios` y `sharp`.
- [ ] Desplegar en un entorno de **staging** y ejecutar `BASE_URL=https://staging.tu-dominio.com npm run smoke`.
- [ ] Vincular un WhatsApp real (QR), enviar y recibir mensajes, probar el simulador y un comando.
- [ ] Pago de prueba con Stripe en modo test (tarjeta `4242 4242 4242 4242`) y verificar que el plan se activa solo por el webhook.
- [ ] Probar una transferencia completa: orden, comprobante, aprobación del admin y activación.
- [ ] Probar que al vencer el plan los bots se apagan (puedes acortar `TRIAL_DAYS` en staging).

## 2. Configuración (obligatoria)
- [ ] `ADMIN_PASSWORD` y `AUTH_SECRET` definidos con valores largos y únicos; cambiar la contraseña inicial.
- [ ] `PUBLIC_URL` con **https**; HTTPS activo en la plataforma o en el proxy.
- [ ] `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` de producción (no de test) y el webhook creado con los 4 eventos.
- [ ] `TRANSFER_INSTRUCTIONS` con los datos bancarios correctos.
- [ ] Disco persistente montado en `data/` (sesiones de WhatsApp y base de datos).
- [ ] `MAX_ONLINE_BOTS` ajustado a la RAM disponible (≈ 60-100 MB por bot).
- [ ] Una sola instancia por base de datos (nunca dos procesos con las mismas sesiones).

## 3. Operación
- [ ] Copias de `data/backups` descargadas fuera del servidor (el disco puede fallar con las copias dentro).
- [ ] Define `ALERT_WEBHOOK_URL` para recibir avisos de errores graves y pagos inconsistentes.
- [ ] Alerta de caída: monitor externo (UptimeRobot, Better Stack, etc.) sobre `/health`.
- [ ] Alguien revisa los tickets y las transferencias por aprobar a diario.
- [ ] Plan de actualización: probar en staging antes de cada cambio.

## 4. Legal y de negocio (fuera del código)
- [ ] **Términos de servicio y política de privacidad** publicados. El sistema guarda mensajes y datos de los contactos de tus clientes.
- [ ] Política de reembolsos y de facturación.
- [ ] **Riesgo de WhatsApp:** Baileys es una conexión no oficial. WhatsApp puede bloquear números, sobre todo con envíos masivos o spam. Informa esto a tus clientes. Para volumen alto o uso crítico, evalúa la API oficial (WhatsApp Business Platform).
- [ ] Cumplimiento de la ley de protección de datos de tu país.

## 5. Limitaciones conocidas
- No hay recuperación de contraseña por correo ni verificación de correo (no hay servicio de correo configurado). Hoy el administrador restablece contraseñas desde *Planes & Pagos*.
- Las sesiones duran 7 días, pero ya se pueden revocar: cambiar la contraseña, "cerrar sesión en todos los dispositivos", suspender o borrar una cuenta las invalida al instante.
- No hay autenticación de dos factores para el administrador: usa una contraseña larga y única.
- Escala en vertical (un servidor). Para cientos de bots se necesita PostgreSQL y repartir sesiones (ver `docs/ROADMAP.md`).
- Los errores van a la consola. Con `ALERT_WEBHOOK_URL` los graves llegan además a Slack/Discord; no hay un servicio completo de seguimiento de errores (Sentry u otro).
- No se ha hecho una prueba de carga.
