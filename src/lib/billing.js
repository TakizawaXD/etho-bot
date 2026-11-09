// Facturación: órdenes de pago, activación de planes y vencimientos.
// Principios de seguridad:
//  - El precio SIEMPRE sale del servidor (plans.js); el cliente solo elige plan y método.
//  - Activar una orden es idempotente y atómico (no se puede cobrar dos veces el mismo pago).
//  - Las transferencias solo se activan por aprobación manual de un administrador.
//  - Cada cambio queda en payment_audit.
import crypto from 'node:crypto';
import { db, getBot, upsertBot } from '../db.js';
import {
  DAY_MS, FREE_PLAN_KEY, TRIAL_DAYS, CURRENCY,
  getPlans, isManagedPlanKey, computeEntitlement, nextPlanExpiry,
} from './plans.js';

db.exec(`
CREATE TABLE IF NOT EXISTS payment_orders(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reference TEXT UNIQUE NOT NULL,
  provider_session_id TEXT,
  provider_payment_id TEXT,
  proof_ref TEXT,
  payer_name TEXT,
  proof_note TEXT,
  reviewed_by TEXT,
  review_note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_orders_user ON payment_orders(user_id, created_at DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_orders_status ON payment_orders(status, created_at DESC)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_proof ON payment_orders(proof_ref) WHERE proof_ref IS NOT NULL');
db.exec('CREATE TABLE IF NOT EXISTS payment_events(id TEXT PRIMARY KEY, order_id TEXT, type TEXT, created_at INTEGER)');
db.exec(`CREATE TABLE IF NOT EXISTS payment_audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT, actor TEXT, action TEXT, detail TEXT, created_at INTEGER)`);
db.exec('ALTER TABLE platform_users ADD COLUMN trial_ends_at INTEGER');
db.exec("ALTER TABLE platform_users ADD COLUMN plan TEXT DEFAULT 'prueba'");
db.exec('ALTER TABLE platform_users ADD COLUMN plan_expires_at INTEGER DEFAULT 0');

export class BillingError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomCode = (n) => Array.from({ length: n }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const audit = (orderId, actor, action, detail = '') =>
  db.prepare('INSERT INTO payment_audit (order_id, actor, action, detail, created_at) VALUES (?,?,?,?,?)')
    .run(orderId, actor, action, String(detail).slice(0, 500), Date.now());

export function getBillingUser(userId) {
  return db.prepare(
    'SELECT id, username, email, name, role, status, created_at, trial_ends_at, plan, plan_expires_at FROM platform_users WHERE id=?'
  ).get(userId) || null;
}

export const countUserBots = (userId) => db.prepare('SELECT COUNT(*) AS c FROM bots WHERE owner_id=?').get(userId)?.c || 0;

/** Fija el fin de la prueba gratuita (solo la primera vez: borrar y recrear bots no la reinicia). */
export function ensureTrial(userId, now = Date.now()) {
  db.prepare('UPDATE platform_users SET trial_ends_at=? WHERE id=? AND trial_ends_at IS NULL').run(now + TRIAL_DAYS * DAY_MS, userId);
  return getBillingUser(userId);
}

export function getEntitlement(userId, now = Date.now()) {
  const user = getBillingUser(userId);
  return user ? computeEntitlement(user, now) : null;
}

// ---------- Órdenes ----------

export const getOrder = (id) => db.prepare('SELECT * FROM payment_orders WHERE id=?').get(id) || null;
export const getOrderBySession = (sessionId) =>
  db.prepare('SELECT * FROM payment_orders WHERE provider_session_id=?').get(sessionId) || null;

export function createOrder({ userId, planKey, method }) {
  const plan = getPlans()[planKey];
  if (!plan) throw new BillingError('Plan no válido.');
  if (!['stripe', 'transfer'].includes(method)) throw new BillingError('Método de pago no válido.');
  const user = getBillingUser(userId);
  if (!user || user.role === 'admin') throw new BillingError('Cuenta no válida para comprar planes.', 403);

  const now = Date.now();
  // Las órdenes sin pagar de más de 48 h caducan; no se acumulan.
  db.prepare("UPDATE payment_orders SET status='expired', updated_at=? WHERE status IN ('pending') AND created_at < ?")
    .run(now, now - 2 * DAY_MS);
  const open = db.prepare("SELECT COUNT(*) AS c FROM payment_orders WHERE user_id=? AND status IN ('pending','awaiting_review')").get(userId)?.c || 0;
  if (open >= 5) throw new BillingError('Tienes demasiadas órdenes abiertas. Cancela o completa alguna primero.', 429);

  const order = {
    id: `ord_${crypto.randomBytes(9).toString('hex')}`,
    user_id: userId, plan: plan.key, amount_cents: plan.priceCents, currency: CURRENCY,
    method, status: 'pending', reference: `ETHO-${randomCode(8)}`, created_at: now, updated_at: now,
  };
  db.prepare(`INSERT INTO payment_orders (id, user_id, plan, amount_cents, currency, method, status, reference, created_at, updated_at)
    VALUES (@id,@user_id,@plan,@amount_cents,@currency,@method,@status,@reference,@created_at,@updated_at)`).run(order);
  audit(order.id, userId, 'create', `${method} ${plan.key} ${plan.priceCents}${CURRENCY}`);
  return getOrder(order.id);
}

export function setProviderSession(orderId, sessionId) {
  db.prepare('UPDATE payment_orders SET provider_session_id=?, updated_at=? WHERE id=?').run(sessionId, Date.now(), orderId);
}

export function listUserOrders(userId, limit = 20) {
  return db.prepare('SELECT * FROM payment_orders WHERE user_id=? ORDER BY created_at DESC LIMIT ?').all(userId, limit);
}

export function listOrders({ status = '', limit = 100 } = {}) {
  const base = `SELECT o.*, u.username, u.name AS user_name, u.email AS user_email
    FROM payment_orders o LEFT JOIN platform_users u ON u.id=o.user_id`;
  return status
    ? db.prepare(`${base} WHERE o.status=? ORDER BY o.created_at DESC LIMIT ?`).all(status, limit)
    : db.prepare(`${base} ORDER BY o.created_at DESC LIMIT ?`).all(limit);
}

export function cancelOrder(orderId, userId) {
  const order = getOrder(orderId);
  if (!order || order.user_id !== userId) throw new BillingError('Orden no encontrada.', 404);
  if (order.status !== 'pending') throw new BillingError('Solo se pueden cancelar órdenes pendientes.');
  db.prepare("UPDATE payment_orders SET status='cancelled', updated_at=? WHERE id=? AND status='pending'").run(Date.now(), orderId);
  audit(orderId, userId, 'cancel');
  return getOrder(orderId);
}

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** El usuario informa su transferencia (referencia bancaria). Queda en revisión manual. */
export function submitTransferProof(orderId, userId, { proofRef, payerName, note }) {
  const order = getOrder(orderId);
  if (!order || order.user_id !== userId) throw new BillingError('Orden no encontrada.', 404);
  if (order.method !== 'transfer') throw new BillingError('Esta orden no es por transferencia.');
  if (!['pending', 'awaiting_review'].includes(order.status)) throw new BillingError('Esta orden ya no admite cambios.');

  const ref = clean(proofRef, 40).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9\-_.\/ ]{4,39}$/.test(ref)) throw new BillingError('Escribe el número de referencia o comprobante de la transferencia (5 a 40 caracteres).');
  const payer = clean(payerName, 80);
  if (payer.length < 3) throw new BillingError('Indica el nombre del titular que hizo la transferencia.');
  try {
    db.prepare("UPDATE payment_orders SET status='awaiting_review', proof_ref=?, payer_name=?, proof_note=?, updated_at=? WHERE id=?")
      .run(ref, payer, clean(note, 300), Date.now(), orderId);
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) throw new BillingError('Ese número de comprobante ya fue registrado en otra orden.');
    throw e;
  }
  audit(orderId, userId, 'proof', ref);
  return getOrder(orderId);
}

export function rejectOrder(orderId, adminId, note = '') {
  const order = getOrder(orderId);
  if (!order) throw new BillingError('Orden no encontrada.', 404);
  if (order.status === 'paid') throw new BillingError('La orden ya está pagada.');
  db.prepare("UPDATE payment_orders SET status='rejected', reviewed_by=?, review_note=?, updated_at=? WHERE id=?")
    .run(adminId, clean(note, 300), Date.now(), orderId);
  audit(orderId, adminId, 'reject', note);
  return getOrder(orderId);
}

export function markOrderExpired(orderId) {
  db.prepare("UPDATE payment_orders SET status='expired', updated_at=? WHERE id=? AND status IN ('pending','awaiting_review')").run(Date.now(), orderId);
}

/** Registra un evento del proveedor; devuelve false si ya se había procesado (idempotencia). */
export function recordPaymentEvent(eventId, orderId, type) {
  try {
    db.prepare('INSERT INTO payment_events (id, order_id, type, created_at) VALUES (?,?,?,?)').run(eventId, orderId || null, type, Date.now());
    return true;
  } catch { return false; }
}
export function forgetPaymentEvent(eventId) {
  db.prepare('DELETE FROM payment_events WHERE id=?').run(eventId);
}

// ---------- Activación de planes ----------

/** Aplica el plan del usuario a sus bots gestionados. Devuelve los ids modificados. */
function applyPlanToBots(userId, planKey, expiresAt, paid) {
  const changed = [];
  for (const row of db.prepare('SELECT id FROM bots WHERE owner_id=?').all(userId)) {
    const bot = getBot(row.id);
    if (!bot || bot.payment_status === 'suspended') continue;                  // suspendido por el admin
    if (Number(bot.expires_at) === 0 && bot.payment_status === 'paid') continue; // ilimitado concedido a mano
    if (!isManagedPlanKey(bot.plan || FREE_PLAN_KEY)) continue;                  // plan personalizado del admin
    upsertBot({ id: bot.id, expires_at: expiresAt, payment_status: paid ? 'paid' : 'expired', plan: planKey });
    changed.push(bot.id);
  }
  return changed;
}

function activatePlan(userId, plan, expiresAt) {
  db.prepare('UPDATE platform_users SET plan=?, plan_expires_at=? WHERE id=?').run(plan.key, expiresAt, userId);
  return applyPlanToBots(userId, plan.key, expiresAt, true);
}

/**
 * Marca una orden como pagada y activa el plan. Idempotente.
 * Devuelve { order, already, botIds }.
 */
export function fulfillOrder(orderId, { actor = 'system', providerPaymentId = null, note = '' } = {}) {
  let botIds = [];
  let already = false;
  const run = db.transaction(() => {
    const order = getOrder(orderId);
    if (!order) throw new BillingError('Orden no encontrada.', 404);
    if (order.status === 'paid') { already = true; return; }
    if (order.status === 'rejected' || order.status === 'cancelled') {
      throw new BillingError(`La orden está ${order.status}; no se puede activar.`);
    }
    const plan = getPlans()[order.plan];
    const user = getBillingUser(order.user_id);
    if (!plan || !user) throw new BillingError('Plan o usuario inexistente.', 404);

    const now = Date.now();
    const expiresAt = nextPlanExpiry(user, plan, now);
    db.prepare("UPDATE payment_orders SET status='paid', paid_at=?, updated_at=?, provider_payment_id=COALESCE(?, provider_payment_id), reviewed_by=COALESCE(?, reviewed_by), review_note=COALESCE(?, review_note) WHERE id=? AND status!='paid'")
      .run(now, now, providerPaymentId, actor === 'system' ? null : actor, note || null, orderId);
    botIds = activatePlan(order.user_id, plan, expiresAt);
    audit(orderId, actor, 'paid', `${plan.key} hasta ${new Date(expiresAt).toISOString()}`);
  });
  run();
  return { order: getOrder(orderId), already, botIds };
}

export function approveTransfer(orderId, adminId, note = '') {
  const order = getOrder(orderId);
  if (!order) throw new BillingError('Orden no encontrada.', 404);
  if (order.method !== 'transfer') throw new BillingError('Solo se aprueban manualmente órdenes por transferencia.');
  if (order.status !== 'awaiting_review') throw new BillingError('La orden aún no tiene comprobante en revisión.');
  return fulfillOrder(orderId, { actor: adminId, note });
}

/** Concesión manual del admin (cortesía, soporte, acuerdos fuera de la plataforma). */
export function grantPlan(userId, planKey, days, adminId) {
  const plan = getPlans()[planKey];
  const user = getBillingUser(userId);
  if (!plan || !user || user.role === 'admin') throw new BillingError('Plan o usuario no válido.');
  const d = Math.min(Math.max(Math.round(Number(days) || plan.days), 1), 3650);
  const expiresAt = nextPlanExpiry(user, { ...plan, days: d });
  const botIds = activatePlan(userId, plan, expiresAt);
  audit(`grant:${userId}`, adminId, 'grant', `${plan.key} ${d}d`);
  return { expiresAt, botIds };
}

/**
 * Tarea periódica: baja a "prueba" a quien venció su plan y marca sus bots como vencidos
 * (el BotManager los apaga solo). Devuelve los ids de bots afectados.
 */
export function reconcileSubscriptions(now = Date.now()) {
  const changed = [];
  const lapsed = db.prepare(
    "SELECT id FROM platform_users WHERE role!='admin' AND plan IS NOT NULL AND plan!=? AND plan_expires_at>0 AND plan_expires_at<=?"
  ).all(FREE_PLAN_KEY, now);
  for (const { id } of lapsed) {
    db.prepare('UPDATE platform_users SET plan=? WHERE id=?').run(FREE_PLAN_KEY, id);
    changed.push(...applyPlanToBots(id, FREE_PLAN_KEY, now, false));
  }
  return changed;
}

export function billingSummary(userId) {
  const user = getBillingUser(userId);
  if (!user) return null;
  const ent = computeEntitlement(user);
  return {
    plan: ent.planKey, paid: ent.paid, active: ent.active, trial: ent.trial,
    expiresAt: ent.expiresAt, maxBots: Number.isFinite(ent.maxBots) ? ent.maxBots : null,
    botCount: countUserBots(userId),
  };
}
