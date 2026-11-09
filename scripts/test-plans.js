import assert from 'node:assert/strict';
import { computeEntitlement as ent, canCreateBot, getPlans, nextPlanExpiry, newBotSubscription, DAY_MS, FREE_MAX_BOTS, TRIAL_DAYS } from '../src/lib/plans.js';

const NOW = 1_800_000_000_000;
assert.equal(TRIAL_DAYS, 7); assert.equal(FREE_MAX_BOTS, 3);

// Cuenta nueva: 7 días y 3 bots
const fresh = { role: 'user', created_at: NOW, trial_ends_at: NOW + 7 * DAY_MS };
let e = ent(fresh, NOW + DAY_MS);
assert.deepEqual([e.paid, e.active, e.maxBots, e.trial], [false, true, 3, true]);
assert.equal(canCreateBot(e, 2).ok, true);
assert.equal(canCreateBot(e, 3).code, 'BOT_LIMIT');
// Sin trial_ends_at (usuario antiguo) se calcula desde created_at
assert.equal(ent({ role: 'user', created_at: NOW }, NOW + 6 * DAY_MS).active, true);
assert.equal(ent({ role: 'user', created_at: NOW }, NOW + 8 * DAY_MS).active, false);
// Prueba vencida: no puede crear nada
e = ent(fresh, NOW + 8 * DAY_MS);
assert.equal(e.expired, true); assert.equal(canCreateBot(e, 0).code, 'TRIAL_EXPIRED');
// Plan pagado vigente: más bots
const paid = { ...fresh, plan: 'pro', plan_expires_at: NOW + 20 * DAY_MS };
e = ent(paid, NOW + 8 * DAY_MS);
assert.deepEqual([e.paid, e.active, e.maxBots, e.planKey], [true, true, 10, 'pro']);
assert.equal(canCreateBot(e, 9).ok, true); assert.equal(canCreateBot(e, 10).code, 'BOT_LIMIT');
// Plan pagado vencido + prueba vencida: bloqueado (no vuelve a tener 7 días)
e = ent({ ...paid, plan_expires_at: NOW + 9 * DAY_MS }, NOW + 10 * DAY_MS);
assert.equal(e.active, false); assert.equal(e.planKey, 'prueba');
// Plan desconocido en la DB no otorga nada
assert.equal(ent({ ...fresh, plan: 'hack', plan_expires_at: NOW + 99 * DAY_MS }, NOW + 8 * DAY_MS).active, false);
// Admin sin límites
assert.equal(canCreateBot(ent({ role: 'admin' }, NOW), 999).ok, true);
assert.deepEqual(newBotSubscription(ent({ role: 'admin' })), { expires_at: 0, payment_status: 'paid', plan: 'ilimitado' });
assert.deepEqual(newBotSubscription(ent(fresh, NOW)), { expires_at: NOW + 7 * DAY_MS, payment_status: 'trial', plan: 'prueba' });
// Renovación suma tiempo si el plan es el mismo; si no, empieza hoy
const pro = getPlans().pro;
assert.equal(nextPlanExpiry(paid, pro, NOW), NOW + 20 * DAY_MS + 30 * DAY_MS);
assert.equal(nextPlanExpiry({ ...paid, plan: 'vip' }, pro, NOW), NOW + 30 * DAY_MS);
assert.equal(nextPlanExpiry(fresh, pro, NOW), NOW + 30 * DAY_MS);
// PLANS_JSON ajusta precios pero ignora basura
const p2 = getPlans({ PLANS_JSON: '{"pro":{"priceCents":1999,"maxBots":"x","days":-5}}' });
assert.equal(p2.pro.priceCents, 1999); assert.equal(p2.pro.maxBots, 10); assert.equal(p2.pro.days, 30);
assert.equal(getPlans({ PLANS_JSON: '{rota' }).pro.priceCents, 2999);
console.log('plans.js OK');
