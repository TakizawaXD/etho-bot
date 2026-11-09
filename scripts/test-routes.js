// Prueba las rutas de pagos y tickets con un "app" falso (sin levantar Express) y la base de datos real.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'etho-routes-'));
process.env.DB_PATH = path.join(tmp, 'r.db');
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_route_test';
process.env.TRANSFER_INSTRUCTIONS = 'Banco X\\nCuenta 123';
process.env.PUBLIC_URL = 'https://demo.example.com';

const { db, createPlatformUser, upsertBot, getBot } = await import('../src/db.js');
const B = await import('../src/lib/billing.js');
const { registerBillingRoutes } = await import('../src/routes/billing.js');
const { registerSupportRoutes } = await import('../src/routes/support.js');

// ---- mini router ----
const routes = [];
const app = Object.fromEntries(['get', 'post', 'put', 'delete'].map((m) => [m, (p, ...h) => routes.push({ m: m.toUpperCase(), p, h })]));
const authRequired = (req, res, next) => (req.user ? next() : res.status(401).json({ ok: false }));
const adminRequired = (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ ok: false }));
const events = []; const changed = [];
const ctx = { authRequired, adminRequired, notifyAdmins: (e, d) => events.push([e, d]), onBotsChanged: (ids) => changed.push(...ids) };
registerBillingRoutes(app, ctx); registerSupportRoutes(app, ctx);

async function call(method, url, { user = null, body = {}, headers = {}, rawBody, ip = '9.9.9.9' } = {}) {
  const [pathname, qs] = url.split('?');
  for (const r of routes) {
    if (r.m !== method) continue;
    const names = []; const re = new RegExp('^' + r.p.replace(/:([A-Za-z]+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
    const m = pathname.match(re); if (!m) continue;
    const req = { user, body, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])), query: Object.fromEntries(new URLSearchParams(qs || '')),
      get: (h) => headers[h.toLowerCase()], ip, rawBody, protocol: 'https' };
    let out = { status: 200, body: null, headers: {} };
    const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; }, set(k, v) { out.headers[k] = v; return this; } };
    let i = 0;
    const next = async () => { const h = r.h[i++]; if (h) await h(req, res, next); };
    await next();
    return out;
  }
  throw new Error(`sin ruta ${method} ${pathname}`);
}

const mk = (u) => createPlatformUser({ username: u, password: 'password123', name: `Cliente ${u}`, email: `${u}@mail.com`, role: 'user' });
const ana = mk('ana'); B.ensureTrial(ana.id);
const bruno = mk('bruno'); B.ensureTrial(bruno.id);
const A = { id: ana.id, role: 'user', name: 'Ana' }; const Bu = { id: bruno.id, role: 'user', name: 'Bruno' };
const ADMIN = { id: 'usr_admin_master', role: 'admin', name: 'Admin' };
upsertBot({ id: 'bot_r1', name: 'R1', owner_id: ana.id, expires_at: Date.now() + 5 * 86400000, payment_status: 'trial', plan: 'prueba' });

// ---- planes públicos ----
let r = await call('GET', '/api/billing/plans');
assert.equal(r.body.free.maxBots, 3); assert.equal(r.body.free.days, 7);
assert.deepEqual(r.body.methods, { stripe: true, transfer: true });
assert.equal(r.body.plans.length, 2);

// ---- crear orden: el monto del cliente se ignora; Stripe simulado ----
global.fetch = async (url, init) => {
  assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(init.headers.Authorization, 'Bearer sk_test_x');
  const p = init.body;                                          // URLSearchParams
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), '2999');   // precio del servidor
  assert.equal(p.get('success_url').startsWith('https://demo.example.com/?payment=success'), true);
  return { ok: true, json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) };
};
r = await call('POST', '/api/billing/orders', { user: A, body: { plan: 'pro', method: 'stripe', amount_cents: 1 } });
assert.equal(r.status, 200); assert.match(r.body.checkoutUrl, /^https:\/\/checkout\.stripe\.com\//);
const order = r.body.order; assert.equal(order.amount_cents, 2999);
assert.equal(JSON.stringify(r.body).includes('provider_session_id'), false);   // no se filtran campos internos
r = await call('POST', '/api/billing/orders', { user: A, body: { plan: 'oro', method: 'stripe' } });
assert.equal(r.status, 400);
r = await call('GET', `/api/billing/orders/${order.id}`, { user: Bu });         // orden ajena
assert.equal(r.status, 404);
// Si Stripe falla, la orden se cancela y no se filtra el detalle
global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'secreto interno' } }) });
r = await call('POST', '/api/billing/orders', { user: A, body: { plan: 'vip', method: 'stripe' } });
assert.equal(r.status, 502); assert.equal(r.body.error.includes('secreto'), false);

// ---- webhook ----
const secret = process.env.STRIPE_WEBHOOK_SECRET;
const hook = (event, { ts = Math.floor(Date.now() / 1000), sec = secret } = {}) => {
  const raw = Buffer.from(JSON.stringify(event));
  const sig = `t=${ts},v1=${crypto.createHmac('sha256', sec).update(`${ts}.${raw}`).digest('hex')}`;
  return call('POST', '/api/payments/stripe/webhook', { body: event, rawBody: raw, headers: { 'stripe-signature': sig }, user: null });
};
const session = (over = {}) => ({ id: 'cs_test_1', client_reference_id: order.id, payment_status: 'paid', amount_total: 2999, currency: 'usd', payment_intent: 'pi_9', ...over });
const evt = (id, obj, type = 'checkout.session.completed') => ({ id, type, data: { object: obj } });

assert.equal((await hook(evt('evt_a', session()), { sec: 'otro' })).status, 400);              // firma falsa
assert.equal((await hook(evt('evt_a', session()), { ts: 1000 })).status, 400);                 // firma vieja
assert.equal((await call('POST', '/api/payments/stripe/webhook', { body: {}, headers: {} })).status, 400); // sin firma
assert.equal(B.getOrder(order.id).status, 'pending');                                          // nada cambió
// Monto distinto: NO se activa
assert.equal((await hook(evt('evt_m', session({ amount_total: 100 })))).status, 200);
assert.equal(B.getOrder(order.id).status, 'pending');
assert.ok(db.prepare("SELECT 1 AS x FROM payment_audit WHERE action='mismatch'").get());
assert.ok(events.some(([e, d]) => e === 'billing' && d.type === 'mismatch'));
// Sesión distinta: NO se activa
assert.equal((await hook(evt('evt_s', session({ id: 'cs_otra' })))).status, 200);
assert.equal(B.getOrder(order.id).status, 'pending');
// Pago asíncrono aún no pagado: no activa
await hook(evt('evt_u', session({ payment_status: 'unpaid' })));
assert.equal(B.getOrder(order.id).status, 'pending');
// Pago correcto
r = await hook(evt('evt_ok', session()));
assert.equal(r.status, 200); assert.equal(B.getOrder(order.id).status, 'paid');
assert.equal(getBot('bot_r1').payment_status, 'paid'); assert.deepEqual(changed, ['bot_r1']);
const exp = B.getBillingUser(ana.id).plan_expires_at;
// Reentrega del mismo evento y evento distinto del mismo pago: no suma tiempo
assert.equal((await hook(evt('evt_ok', session()))).body.duplicate, true);
await hook(evt('evt_ok2', session(), 'checkout.session.async_payment_succeeded'));
assert.equal(B.getBillingUser(ana.id).plan_expires_at, exp);
// Evento de otro tipo se ignora
assert.equal((await hook(evt('evt_x', session(), 'charge.refunded'))).body.received, true);

// ---- transferencia + revisión del admin ----
r = await call('POST', '/api/billing/orders', { user: Bu, body: { plan: 'vip', method: 'transfer' } });
assert.equal(r.body.instructions, 'Banco X\nCuenta 123');
const tord = r.body.order;
assert.equal((await call('POST', `/api/admin/billing/orders/${tord.id}/approve`, { user: Bu })).status, 403);      // un cliente no aprueba
assert.equal((await call('POST', `/api/admin/billing/orders/${tord.id}/approve`, { user: ADMIN })).status, 400);   // sin comprobante
r = await call('POST', `/api/billing/orders/${tord.id}/proof`, { user: Bu, body: { proofRef: 'TRX-5566778', payerName: 'Bruno Díaz' } });
assert.equal(r.body.order.status, 'awaiting_review'); assert.ok(events.some(([e, d]) => e === 'billing' && d.type === 'proof'));
r = await call('GET', '/api/admin/billing/orders?status=awaiting_review', { user: ADMIN });
assert.equal(r.body.pendingReview, 1); assert.equal(r.body.orders[0].user_name, 'Cliente bruno');
assert.equal((await call('GET', '/api/admin/billing/orders', { user: A })).status, 403);
r = await call('POST', `/api/admin/billing/orders/${tord.id}/approve`, { user: ADMIN });
assert.equal(r.body.order.status, 'paid');
r = await call('GET', '/api/billing/me', { user: Bu });
assert.equal(r.body.summary.plan, 'vip'); assert.equal(r.body.summary.maxBots, 30); assert.equal(r.body.summary.paid, true);
r = await call('GET', '/api/billing/me', { user: ADMIN });
assert.equal(r.body.isAdmin, true);
r = await call('GET', '/api/admin/billing/users', { user: ADMIN });
assert.ok(r.body.users.some((u) => u.username === 'bruno' && u.plan === 'vip'));
assert.equal(JSON.stringify(r.body).includes('password'), false);
assert.equal((await call('GET', '/api/admin/billing/users', { user: A })).status, 403);
// Concesión manual
r = await call('PUT', `/api/admin/users/${ana.id}/plan`, { user: ADMIN, body: { plan: 'pro', days: 10 } });
assert.equal(r.status, 200);

// ---- tickets ----
const tk = { name: 'Visita', email: 'v@mail.com', subject: 'No carga el panel', message: 'Entro y la pantalla queda en blanco.' };
r = await call('POST', '/api/tickets', { body: tk, ip: '1.1.1.1' });
assert.equal(r.status, 200); assert.match(r.body.ticket.id, /^TCK-/); const code = r.body.ticket.id;
assert.ok(events.some(([e, d]) => e === 'ticket' && d.type === 'new'));
assert.equal((await call('POST', '/api/tickets', { body: { ...tk, email: 'malo' }, ip: '2.2.2.2' })).status, 400);
r = await call('POST', '/api/tickets', { body: { ...tk, website: 'http://spam' }, ip: '3.3.3.3' });          // honeypot
assert.equal(r.body.ticket.id, 'TCK-OK'); assert.equal(db.prepare('SELECT COUNT(*) AS c FROM support_tickets').get().c, 1);
for (let i = 0; i < 4; i++) await call('POST', '/api/tickets', { body: tk, ip: '4.4.4.4' });
assert.equal((await call('POST', '/api/tickets', { body: tk, ip: '4.4.4.4' })).status, 200);                  // 5.º permitido
r = await call('POST', '/api/tickets', { body: tk, ip: '4.4.4.4' });                                          // 6.º bloqueado
assert.equal(r.status, 429); assert.ok(r.headers['Retry-After']);
r = await call('POST', '/api/tickets/lookup', { body: { code, email: 'V@mail.com' } });
assert.equal(r.body.ticket.id, code); assert.equal(r.body.messages.length, 1);
assert.equal((await call('POST', '/api/tickets/lookup', { body: { code, email: 'otro@mail.com' } })).status, 404);
// con sesión: usa su cuenta y solo ve lo suyo
r = await call('POST', '/api/tickets', { user: A, body: { subject: 'Pago pendiente', message: 'Mi pago no se refleja aún.', category: 'pago' }, ip: '5.5.5.5' });
const mine = r.body.ticket.id;
assert.equal((await call('GET', `/api/tickets/${mine}`, { user: Bu })).status, 404);
assert.equal((await call('GET', '/api/tickets', { user: A })).body.tickets.length, 1);
assert.ok((await call('GET', '/api/tickets', { user: ADMIN })).body.tickets.length >= 7);
assert.equal((await call('GET', '/api/tickets')).status, 401);
r = await call('POST', `/api/tickets/${mine}/messages`, { user: ADMIN, body: { body: 'Ya lo revisamos', internal: false } });
assert.equal(r.body.ticket.status, 'waiting_user');
r = await call('PUT', `/api/tickets/${mine}/status`, { user: A, body: { status: 'resolved' } });
assert.equal(r.status, 403);
r = await call('PUT', `/api/tickets/${mine}/status`, { user: ADMIN, body: { status: 'in_progress' } });
assert.equal(r.body.ticket.status, 'in_progress');

db.close(); fs.rmSync(tmp, { recursive: true, force: true });
console.log('routes OK');
