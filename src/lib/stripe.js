// Integración mínima con Stripe Checkout (sin SDK): los datos de la tarjeta NUNCA pasan por este servidor.
// - createCheckoutSession: crea la sesión de pago alojada por Stripe.
// - verifyStripeSignature: valida el webhook (HMAC-SHA256, comparación en tiempo constante, tolerancia de 5 min).
import crypto from 'node:crypto';

export const stripeEnabled = () => Boolean(process.env.STRIPE_SECRET_KEY);
export const webhookConfigured = () => Boolean(process.env.STRIPE_WEBHOOK_SECRET);

export function verifyStripeSignature(rawBody, header, secret, { toleranceSec = 300, now = Date.now() } = {}) {
  if (!rawBody || !header || !secret) return false;
  const parts = String(header).split(',').map((p) => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v).filter(Boolean);
  if (!t || sigs.length === 0 || !/^\d+$/.test(t)) return false;
  if (Math.abs(now / 1000 - Number(t)) > toleranceSec) return false;

  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const exp = Buffer.from(expected);
  return sigs.some((s) => {
    const got = Buffer.from(s);
    return got.length === exp.length && crypto.timingSafeEqual(got, exp);
  });
}

export async function createCheckoutSession({ order, plan, user, successUrl, cancelUrl, fetchImpl = fetch }) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe no está configurado.');
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('success_url', successUrl);
  body.set('cancel_url', cancelUrl);
  body.set('client_reference_id', order.id);
  body.set('metadata[order_id]', order.id);
  body.set('metadata[reference]', order.reference);
  body.set('line_items[0][quantity]', '1');
  body.set('line_items[0][price_data][currency]', order.currency);
  body.set('line_items[0][price_data][unit_amount]', String(order.amount_cents));
  body.set('line_items[0][price_data][product_data][name]', `${plan.name} (${plan.days} días)`);
  if (user?.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user.email)) body.set('customer_email', user.email);

  const res = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `checkout_${order.id}`,
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id || !data.url) {
    // Nunca se registra la clave ni el cuerpo completo; solo el mensaje de Stripe.
    throw new Error(`Stripe rechazó la solicitud: ${data?.error?.message || res.status}`);
  }
  return { id: data.id, url: data.url };
}
