// Rutas de planes y pagos. Los precios y límites salen siempre del servidor (src/lib/plans.js).
import { getPlans, TRIAL_DAYS, FREE_MAX_BOTS, CURRENCY } from '../lib/plans.js';
import { stripeEnabled, verifyStripeSignature, createCheckoutSession } from '../lib/stripe.js';
import * as B from '../lib/billing.js';
import { db } from '../db.js';
import { alert } from '../lib/alerts.js';

const transferInstructions = () => String(process.env.TRANSFER_INSTRUCTIONS || '').replace(/\\n/g, '\n').trim();
const methods = () => ({ stripe: stripeEnabled() && Boolean(process.env.STRIPE_WEBHOOK_SECRET), transfer: Boolean(transferInstructions()) });

const publicOrder = (o) => o && ({
  id: o.id, plan: o.plan, amount_cents: o.amount_cents, currency: o.currency, method: o.method,
  status: o.status, reference: o.reference, proof_ref: o.proof_ref, payer_name: o.payer_name,
  review_note: o.review_note, created_at: o.created_at, paid_at: o.paid_at,
});

const baseUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

function fail(res, err) {
  if (err instanceof B.BillingError) return res.status(err.status).json({ ok: false, error: err.message });
  console.error('[Billing]', err);
  return res.status(500).json({ ok: false, error: 'Error interno al procesar el pago.' });
}

export function registerBillingRoutes(app, { authRequired, adminRequired, notifyAdmins, onBotsChanged }) {
  // Planes visibles para todos (landing y panel)
  app.get('/api/billing/plans', (req, res) => {
    res.json({
      ok: true,
      currency: CURRENCY,
      free: { days: TRIAL_DAYS, maxBots: FREE_MAX_BOTS },
      plans: Object.values(getPlans()),
      methods: methods(),
    });
  });

  app.get('/api/billing/me', authRequired, (req, res) => {
    const summary = B.billingSummary(req.user.id);
    res.json({
      ok: true,
      summary,
      isAdmin: req.user.role === 'admin',
      orders: B.listUserOrders(req.user.id).map(publicOrder),
      methods: methods(),
      transferInstructions: methods().transfer ? transferInstructions() : '',
    });
  });

  app.post('/api/billing/orders', authRequired, async (req, res) => {
    try {
      const planKey = String(req.body?.plan || '');
      const method = String(req.body?.method || '');
      const avail = methods();
      if (!avail[method]) return res.status(400).json({ ok: false, error: 'Ese método de pago no está disponible.' });

      const order = B.createOrder({ userId: req.user.id, planKey, method });
      if (method === 'transfer') {
        return res.json({ ok: true, order: publicOrder(order), instructions: transferInstructions() });
      }
      const user = B.getBillingUser(req.user.id);
      try {
        const session = await createCheckoutSession({
          order, plan: getPlans()[planKey], user,
          successUrl: `${baseUrl(req)}/?payment=success&order=${order.id}`,
          cancelUrl: `${baseUrl(req)}/?payment=cancelled&order=${order.id}`,
        });
        B.setProviderSession(order.id, session.id);
        return res.json({ ok: true, order: publicOrder(B.getOrder(order.id)), checkoutUrl: session.url });
      } catch (e) {
        B.cancelOrder(order.id, req.user.id);
        console.error('[Billing] Stripe:', e.message);
        return res.status(502).json({ ok: false, error: 'No se pudo iniciar el pago con tarjeta. Intenta de nuevo o usa transferencia.' });
      }
    } catch (err) { return fail(res, err); }
  });

  app.get('/api/billing/orders/:id', authRequired, (req, res) => {
    const o = B.getOrder(req.params.id);
    if (!o || o.user_id !== req.user.id) return res.status(404).json({ ok: false, error: 'Orden no encontrada.' });
    res.json({ ok: true, order: publicOrder(o), summary: B.billingSummary(req.user.id) });
  });

  app.post('/api/billing/orders/:id/proof', authRequired, (req, res) => {
    try {
      const order = B.submitTransferProof(req.params.id, req.user.id, req.body || {});
      notifyAdmins?.('billing', { type: 'proof', orderId: order.id });
      res.json({ ok: true, order: publicOrder(order) });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/billing/orders/:id/cancel', authRequired, (req, res) => {
    try { res.json({ ok: true, order: publicOrder(B.cancelOrder(req.params.id, req.user.id)) }); } catch (err) { fail(res, err); }
  });

  // ---------- Webhook de Stripe (público, protegido por firma) ----------
  app.post('/api/payments/stripe/webhook', (req, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ ok: false, error: 'Webhook no configurado.' });
    if (!verifyStripeSignature(req.rawBody, req.get('stripe-signature'), secret)) {
      return res.status(400).json({ ok: false, error: 'Firma inválida.' });
    }
    const event = req.body || {};
    const obj = event.data?.object;
    const type = String(event.type || '');
    const HANDLED = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired', 'checkout.session.async_payment_failed'];
    if (!event.id || !obj || !HANDLED.includes(type)) return res.json({ received: true });

    const order = B.getOrder(obj.client_reference_id) || B.getOrderBySession(obj.id);
    if (!order || order.method !== 'stripe') return res.json({ received: true });
    if (!B.recordPaymentEvent(event.id, order.id, type)) return res.json({ received: true, duplicate: true });

    try {
      if (type === 'checkout.session.expired' || type === 'checkout.session.async_payment_failed') {
        B.markOrderExpired(order.id);
      } else if (obj.payment_status === 'paid') {
        const sameSession = !order.provider_session_id || order.provider_session_id === obj.id;
        const sameAmount = Number(obj.amount_total) === Number(order.amount_cents) && String(obj.currency || '').toLowerCase() === order.currency;
        if (!sameSession || !sameAmount) {
          // Datos que no coinciden con la orden: NO se activa nada; queda registrado para revisión.
          console.error(`[Billing] ⚠️ Pago inconsistente en orden ${order.id} (sesión/monto no coinciden).`);
          db.prepare('INSERT INTO payment_audit (order_id, actor, action, detail, created_at) VALUES (?,?,?,?,?)')
            .run(order.id, 'stripe', 'mismatch', `session=${obj.id} amount=${obj.amount_total} ${obj.currency}`, Date.now());
          notifyAdmins?.('billing', { type: 'mismatch', orderId: order.id });
          alert('error', 'Pago de Stripe no coincide con su orden', order.id);
        } else {
          const { botIds, already } = B.fulfillOrder(order.id, { actor: 'system', providerPaymentId: obj.payment_intent || null });
          if (!already) { onBotsChanged?.(botIds); notifyAdmins?.('billing', { type: 'paid', orderId: order.id }); }
        }
      }
      return res.json({ received: true });
    } catch (err) {
      B.forgetPaymentEvent(event.id);          // permite que Stripe reintente
      console.error('[Billing] Error procesando webhook:', err);
      alert('error', 'Falló el procesamiento de un webhook de Stripe', err.message);
      return res.status(500).json({ ok: false });
    }
  });

  // ---------- Administración ----------
  app.get('/api/admin/billing/orders', adminRequired, (req, res) => {
    const status = ['pending', 'awaiting_review', 'paid', 'rejected', 'cancelled', 'expired'].includes(req.query.status) ? req.query.status : '';
    const pending = db.prepare("SELECT COUNT(*) AS c FROM payment_orders WHERE status='awaiting_review'").get()?.c || 0;
    const revenue = db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS s FROM payment_orders WHERE status='paid' AND paid_at > ?").get(Date.now() - 30 * 86400000)?.s || 0;
    res.json({ ok: true, orders: B.listOrders({ status }), pendingReview: pending, revenue30dCents: revenue, currency: CURRENCY });
  });

  // Clientes con su plan (para conceder planes desde el panel)
  app.get('/api/admin/billing/users', adminRequired, (req, res) => {
    const users = db.prepare("SELECT id, username, name, email, status, plan, plan_expires_at, trial_ends_at FROM platform_users WHERE role!='admin' ORDER BY created_at DESC LIMIT 500").all();
    res.json({ ok: true, users });
  });

  app.post('/api/admin/billing/orders/:id/approve', adminRequired, (req, res) => {
    try {
      const { order, botIds } = B.approveTransfer(req.params.id, req.user.id, String(req.body?.note || ''));
      onBotsChanged?.(botIds);
      res.json({ ok: true, order: publicOrder(order) });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/admin/billing/orders/:id/reject', adminRequired, (req, res) => {
    try { res.json({ ok: true, order: publicOrder(B.rejectOrder(req.params.id, req.user.id, String(req.body?.note || ''))) }); } catch (err) { fail(res, err); }
  });

  app.put('/api/admin/users/:id/plan', adminRequired, (req, res) => {
    try {
      const { expiresAt, botIds } = B.grantPlan(req.params.id, String(req.body?.plan || ''), req.body?.days, req.user.id);
      onBotsChanged?.(botIds);
      res.json({ ok: true, expiresAt });
    } catch (err) { fail(res, err); }
  });
}
