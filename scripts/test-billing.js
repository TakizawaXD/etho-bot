// Pruebas de facturación, Stripe y tickets sobre una base SQLite temporal real.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'etho-test-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.PLANS_JSON = '';

const { db, createPlatformUser, upsertBot, getBot } = await import('../src/db.js');
const B = await import('../src/lib/billing.js');
const T = await import('../src/lib/tickets.js');
const { verifyStripeSignature } = await import('../src/lib/stripe.js');
const { getPlans, DAY_MS } = await import('../src/lib/plans.js');

const mkUser = (u) => createPlatformUser({ username: u, password: 'password123', name: `Usuario ${u}`, email: `${u}@mail.com`, role: 'user' });
const mkBot = (id, owner, status = 'trial', plan = 'prueba', exp = Date.now() + 7 * DAY_MS) =>
  upsertBot({ id, name: id, owner_id: owner, expires_at: exp, payment_status: status, plan });
const expectErr = (fn, re) => assert.throws(fn, (e) => { assert.match(e.message, re); return true; });

// ---------- Prueba gratuita ----------
const ana = mkUser('ana'); B.ensureTrial(ana.id);
let ent = B.getEntitlement(ana.id);
assert.equal(ent.paid, false); assert.equal(ent.maxBots, 3);
assert.ok(Math.abs(ent.expiresAt - (Date.now() + 7 * DAY_MS)) < 5000);
const t0 = B.getBillingUser(ana.id).trial_ends_at;
B.ensureTrial(ana.id);                                   // no se reinicia
assert.equal(B.getBillingUser(ana.id).trial_ends_at, t0);
mkBot('bot_a1', ana.id); mkBot('bot_a2', ana.id);

// ---------- Órdenes: el precio lo decide el servidor ----------
const o1 = B.createOrder({ userId: ana.id, planKey: 'pro', method: 'stripe' });
assert.equal(o1.amount_cents, getPlans().pro.priceCents); assert.match(o1.reference, /^ETHO-[A-Z0-9]{8}$/);
expectErr(() => B.createOrder({ userId: ana.id, planKey: 'gratis', method: 'stripe' }), /Plan no válido/);
expectErr(() => B.createOrder({ userId: ana.id, planKey: 'pro', method: 'bitcoin' }), /Método/);
for (let i = 0; i < 4; i++) B.createOrder({ userId: ana.id, planKey: 'pro', method: 'transfer' });
expectErr(() => B.createOrder({ userId: ana.id, planKey: 'pro', method: 'transfer' }), /demasiadas/);

// ---------- Activación idempotente (webhook de Stripe) ----------
let r = B.fulfillOrder(o1.id, { providerPaymentId: 'pi_1' });
assert.equal(r.already, false); assert.equal(r.order.status, 'paid');
const exp1 = B.getBillingUser(ana.id).plan_expires_at;
assert.ok(Math.abs(exp1 - (Date.now() + 30 * DAY_MS)) < 5000);
assert.deepEqual(r.botIds.sort(), ['bot_a1', 'bot_a2']);
assert.equal(getBot('bot_a1').payment_status, 'paid'); assert.equal(getBot('bot_a1').plan, 'pro');
assert.equal(getBot('bot_a1').expires_at, exp1);
r = B.fulfillOrder(o1.id);                                // segunda entrega del mismo pago
assert.equal(r.already, true); assert.equal(B.getBillingUser(ana.id).plan_expires_at, exp1);
assert.equal(B.getEntitlement(ana.id).maxBots, 10);
// Eventos duplicados
assert.equal(B.recordPaymentEvent('evt_1', o1.id, 'checkout.session.completed'), true);
assert.equal(B.recordPaymentEvent('evt_1', o1.id, 'checkout.session.completed'), false);

// ---------- Transferencias ----------
const bruno = mkUser('bruno'); B.ensureTrial(bruno.id); mkBot('bot_b1', bruno.id);
const ot = B.createOrder({ userId: bruno.id, planKey: 'vip', method: 'transfer' });
expectErr(() => B.approveTransfer(ot.id, 'admin'), /comprobante/);                 // sin comprobante no se aprueba
expectErr(() => B.submitTransferProof(ot.id, ana.id, { proofRef: 'ABC12345', payerName: 'Alguien' }), /no encontrada/); // orden ajena
expectErr(() => B.submitTransferProof(ot.id, bruno.id, { proofRef: '12', payerName: 'Bruno Díaz' }), /referencia/);
expectErr(() => B.submitTransferProof(ot.id, bruno.id, { proofRef: 'REF-998877', payerName: 'x' }), /titular/);
let p = B.submitTransferProof(ot.id, bruno.id, { proofRef: 'ref-998877', payerName: 'Bruno Díaz', note: 'Banco X' });
assert.equal(p.status, 'awaiting_review'); assert.equal(p.proof_ref, 'REF-998877');
const ot2 = B.createOrder({ userId: bruno.id, planKey: 'pro', method: 'transfer' });
expectErr(() => B.submitTransferProof(ot2.id, bruno.id, { proofRef: 'REF-998877', payerName: 'Bruno Díaz' }), /ya fue registrado/); // comprobante reutilizado
expectErr(() => B.approveTransfer(o1.id, 'admin'), /manualmente/);                   // una orden de Stripe no se aprueba a mano
r = B.approveTransfer(ot.id, 'usr_admin');
assert.equal(r.order.status, 'paid'); assert.equal(r.order.reviewed_by, 'usr_admin');
assert.equal(B.getEntitlement(bruno.id).maxBots, 30);
assert.ok(Math.abs(B.getBillingUser(bruno.id).plan_expires_at - (Date.now() + 90 * DAY_MS)) < 5000);
// Rechazo y cancelación
B.rejectOrder(ot2.id, 'usr_admin', 'No aparece en el banco');
expectErr(() => B.fulfillOrder(ot2.id), /rejected/);
const oc = B.createOrder({ userId: bruno.id, planKey: 'pro', method: 'transfer' });
expectErr(() => B.cancelOrder(oc.id, ana.id), /no encontrada/);
assert.equal(B.cancelOrder(oc.id, bruno.id).status, 'cancelled');
// Renovación del mismo plan suma tiempo
const before = B.getBillingUser(bruno.id).plan_expires_at;
const ov = B.createOrder({ userId: bruno.id, planKey: 'vip', method: 'transfer' });
B.fulfillOrder(ov.id, { actor: 'usr_admin' });
assert.equal(B.getBillingUser(bruno.id).plan_expires_at, before + 90 * DAY_MS);
// El admin no compra planes
expectErr(() => B.createOrder({ userId: 'usr_admin_master', planKey: 'pro', method: 'stripe' }), /no válida/);

// ---------- Vencimiento: se baja a prueba y los bots quedan vencidos ----------
upsertBot({ id: 'bot_vip', name: 'vip', owner_id: ana.id, expires_at: 0, payment_status: 'paid', plan: 'ilimitado' }); // concedido a mano
const changed = B.reconcileSubscriptions(exp1 + DAY_MS);
assert.ok(changed.includes('bot_a1') && changed.includes('bot_a2'));
assert.equal(getBot('bot_a1').payment_status, 'expired'); assert.equal(getBot('bot_a1').plan, 'prueba');
assert.equal(getBot('bot_vip').payment_status, 'paid');                         // no se toca lo concedido a mano
assert.equal(B.getBillingUser(ana.id).plan, 'prueba');
assert.equal(B.getBillingUser(bruno.id).plan, 'vip');                           // el de Bruno sigue vigente
assert.deepEqual(B.reconcileSubscriptions(exp1 + DAY_MS), []);                  // idempotente

// ---------- Concesión manual del admin ----------
const g = B.grantPlan(ana.id, 'pro', 15, 'usr_admin');
assert.ok(Math.abs(g.expiresAt - (Date.now() + 15 * DAY_MS)) < 5000);
expectErr(() => B.grantPlan(ana.id, 'nada', 5, 'usr_admin'), /no válido/);
assert.ok(db.prepare('SELECT COUNT(*) AS c FROM payment_audit').get().c >= 10);

// ---------- Firma de webhook de Stripe ----------
const secret = 'whsec_test_123'; const body = JSON.stringify({ id: 'evt_x', type: 'checkout.session.completed' });
const sign = (ts, b = body, s = secret) => `t=${ts},v1=${crypto.createHmac('sha256', s).update(`${ts}.${b}`).digest('hex')}`;
const ts = Math.floor(Date.now() / 1000);
assert.equal(verifyStripeSignature(Buffer.from(body), sign(ts), secret), true);
assert.equal(verifyStripeSignature(Buffer.from(body + ' '), sign(ts), secret), false);          // cuerpo alterado
assert.equal(verifyStripeSignature(Buffer.from(body), sign(ts, body, 'otro'), secret), false);  // otro secreto
assert.equal(verifyStripeSignature(Buffer.from(body), sign(ts - 3600), secret), false);         // repetición antigua
assert.equal(verifyStripeSignature(Buffer.from(body), 'basura', secret), false);
assert.equal(verifyStripeSignature(Buffer.from(body), sign(ts) + ',v1=00', secret), true);      // varias firmas v1
assert.equal(verifyStripeSignature(Buffer.from(body), sign(ts), ''), false);

// ---------- Tickets ----------
const guestIn = { name: 'Visitante', email: 'Visita@Mail.com', category: 'error', subject: 'No carga el QR', message: 'Al crear el bot el código QR nunca aparece.', ip: '1.2.3.4' };
const tk = T.createTicket(guestIn);
assert.match(tk.id, /^TCK-[A-Z0-9]{6}$/); assert.equal(tk.email, 'visita@mail.com'); assert.equal(tk.status, 'open');
expectErr(() => T.createTicket({ ...guestIn, email: 'nope' }), /correo/);
expectErr(() => T.createTicket({ ...guestIn, subject: 'ab' }), /asunto/);
expectErr(() => T.createTicket({ ...guestIn, message: 'corto' }), /10 caracteres/);
assert.equal(T.createTicket({ ...guestIn, category: 'hack', priority: 'x' }).category, 'error');
const long = T.createTicket({ ...guestIn, message: 'x'.repeat(9000) }); assert.equal(long.message.length, 4000);
assert.ok(!T.createTicket({ ...guestIn, message: 'hola\u0000\u202emundo largo' }).message.includes('\u0000'));
// Consulta pública: requiere código y correo
assert.equal(T.lookupGuestTicket(tk.id.toLowerCase(), 'VISITA@mail.com').ticket.id, tk.id);
expectErr(() => T.lookupGuestTicket(tk.id, 'otro@mail.com'), /No encontramos/);
expectErr(() => T.lookupGuestTicket('TCK-ZZZZZZ', 'visita@mail.com'), /No encontramos/);
// Cliente con cuenta
const aUser = { id: ana.id, name: 'Ana', email: 'ana@mail.com', role: 'user' };
const bUser = { id: bruno.id, name: 'Bruno', email: 'bruno@mail.com', role: 'user' };
const admin = { id: 'usr_admin_master', name: 'Admin', role: 'admin' };
const mine = T.createTicket({ user: aUser, category: 'pago', subject: 'Pago no reflejado', message: 'Pagué con Stripe y sigue vencido.' });
assert.equal(mine.user_id, ana.id); assert.equal(mine.email, 'ana@mail.com');
expectErr(() => T.getTicket(mine.id, bUser), /no encontrado/);        // otro cliente no lo ve
assert.equal(T.listTickets(bUser).tickets.length, 0);
assert.equal(T.listTickets(aUser).tickets.length, 1);
assert.ok(T.listTickets(admin).tickets.length >= 5);
// Respuestas: nota interna oculta al cliente
let th = T.addMessage(mine.id, admin, 'Revisando tu pago.');
assert.equal(th.ticket.status, 'waiting_user');
T.addMessage(mine.id, admin, 'nota interna: verificar Stripe', { internal: true });
assert.equal(T.getTicket(mine.id, aUser).messages.length, 2);          // original + respuesta pública
assert.equal(T.getTicket(mine.id, admin).messages.length, 3);
th = T.addMessage(mine.id, aUser, 'Gracias, quedo atenta.');
assert.equal(th.ticket.status, 'open');
// Permisos de estado
expectErr(() => T.setStatus(mine.id, aUser, 'resolved'), /permiso/);
assert.equal(T.setStatus(mine.id, admin, 'resolved').ticket.status, 'resolved');
assert.equal(T.setStatus(mine.id, aUser, 'closed').ticket.status, 'closed');
expectErr(() => T.addMessage(mine.id, aUser, 'otra cosa'), /cerrado/);
assert.equal(JSON.stringify(T.getTicket(mine.id, admin)).includes('ip_hash'), false);

db.close(); fs.rmSync(tmp, { recursive: true, force: true });
console.log('billing + stripe + tickets OK');
