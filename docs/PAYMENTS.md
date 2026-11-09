# Planes y pagos

## Reglas de uso

| Cuenta | Duración | Bots |
|---|---|---|
| **Gratuita** | 7 días desde el registro (una sola vez) | hasta 3 |
| **Pro** (por defecto $29.99) | 30 días | hasta 10 |
| **VIP** (por defecto $79.99) | 90 días | hasta 30 |

- La prueba de 7 días es **por cuenta**: borrar y volver a crear bots no la reinicia.
- Al terminar la prueba o el plan, los bots se apagan solos (cada minuto se revisa) y no se pueden crear nuevos hasta pagar.
- Renovar el mismo plan **suma** tiempo al que queda. Cambiar de plan empieza desde hoy.
- Precios, días y límites se cambian con `PLANS_JSON`, `TRIAL_DAYS` y `FREE_MAX_BOTS` (ver `.env.example`).
- El administrador no tiene límites. Los bots con tiempo ilimitado concedido a mano no se tocan.

## Cómo funciona de forma segura

- **El precio lo decide el servidor.** El navegador solo envía "plan" y "método"; nunca el monto.
- **Tarjeta (Stripe Checkout):** los datos de la tarjeta los maneja Stripe; este servidor nunca los ve.
  El plan se activa **solo** cuando llega el webhook firmado de Stripe (firma HMAC-SHA256 con comparación en tiempo
  constante y tolerancia de 5 minutos). Se comprueba además que la sesión, el monto y la moneda coincidan con la orden.
  Volver a la página de "éxito" no activa nada por sí solo.
- **Idempotencia:** cada evento de Stripe se registra una vez y activar una orden es atómico: un reintento no cobra ni suma dos veces.
- **Transferencia:** el cliente transfiere con una referencia única (`ETHO-XXXXXXXX`), informa el número de comprobante y su titular,
  y un administrador lo **aprueba manualmente** tras verlo en el banco. Un mismo comprobante no puede usarse en dos órdenes.
- **Auditoría:** cada creación, comprobante, aprobación o rechazo queda en la tabla `payment_audit`.
- Límite de 5 órdenes abiertas por usuario; las pendientes caducan a las 48 h.

## Configurar Stripe

1. Crea la cuenta en stripe.com y copia la clave secreta (`sk_live_...` o `sk_test_...` para pruebas) en `STRIPE_SECRET_KEY`.
2. Define `PUBLIC_URL` con tu dominio (https).
3. En *Developers → Webhooks* crea un endpoint `PUBLIC_URL/api/payments/stripe/webhook` con los eventos
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`
   y `checkout.session.expired`. Copia el *Signing secret* (`whsec_...`) en `STRIPE_WEBHOOK_SECRET`.
4. Prueba primero con claves de test y la tarjeta `4242 4242 4242 4242`.

El botón de tarjeta solo aparece si existen `STRIPE_SECRET_KEY` **y** `STRIPE_WEBHOOK_SECRET`.

## Configurar transferencias

Escribe tus datos bancarios en `TRANSFER_INSTRUCTIONS` (usa `\n` para saltos de línea), por ejemplo:

```
TRANSFER_INSTRUCTIONS=Banco: Mi Banco\nCuenta de ahorros: 000-000000-00\nTitular: Mi Negocio SAS\nNIT: 900.000.000-0
```

Las transferencias por revisar aparecen en **Planes & Pagos → Administración de pagos** (con un aviso en el menú).

## Tickets de soporte

- Botón **Reportar error** en la landing (sin necesidad de cuenta), con límite de 5 reportes por hora por IP y campo trampa anti-bots.
- El visitante recibe un código `TCK-XXXXXX` y puede consultar el estado con ese código + su correo.
- Los clientes ven y responden sus tickets en **Soporte & Tickets**; el administrador ve todos, responde, deja notas internas y cambia el estado.

## Herramientas del administrador

En **Planes & Pagos → Administración de pagos** puedes, para cualquier cliente:
- **Conceder un plan** por los días que indiques (cortesías, acuerdos fuera de la plataforma).
- **Restablecer su contraseña**: se genera una temporal que se muestra una sola vez y se cierran sus sesiones.
