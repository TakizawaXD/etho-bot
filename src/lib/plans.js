// Planes, límites y cálculo de derechos de uso (puro, sin base de datos: fácil de probar).
// Regla base: cuenta gratuita = 7 días de uso y máximo 3 bots. Todo lo demás requiere pago.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const FREE_PLAN_KEY = 'prueba';

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

export const TRIAL_DAYS = num(process.env.TRIAL_DAYS, 7);
export const FREE_MAX_BOTS = num(process.env.FREE_MAX_BOTS, 3);
export const CURRENCY = String(process.env.PAYMENT_CURRENCY || 'usd').toLowerCase();

const DEFAULT_PLANS = {
  pro: { name: 'Plan Mensual Pro', days: 30, maxBots: 10, priceCents: 2999 },
  vip: { name: 'Plan Negocio VIP Premium', days: 90, maxBots: 30, priceCents: 7999 },
};

/** Planes de pago. Se pueden ajustar con PLANS_JSON, p. ej. {"pro":{"priceCents":1999,"maxBots":5}} */
export function getPlans(env = process.env) {
  let override = {};
  try { override = env.PLANS_JSON ? JSON.parse(env.PLANS_JSON) : {}; } catch { override = {}; }
  const plans = {};
  for (const [key, base] of Object.entries(DEFAULT_PLANS)) {
    const o = override[key] || {};
    plans[key] = {
      key,
      name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 60) : base.name,
      days: Math.round(num(o.days, base.days)),
      maxBots: Math.round(num(o.maxBots, base.maxBots)),
      priceCents: Math.round(num(o.priceCents, base.priceCents)),
      currency: CURRENCY,
    };
  }
  return plans;
}

export const isPaidPlanKey = (key) => Object.prototype.hasOwnProperty.call(getPlans(), key);
export const isManagedPlanKey = (key) => key === FREE_PLAN_KEY || isPaidPlanKey(key);

/**
 * Derechos de uso de un usuario en un instante dado.
 * `user` necesita: role, created_at, trial_ends_at, plan, plan_expires_at.
 */
export function computeEntitlement(user, now = Date.now()) {
  if (!user) return { planKey: null, paid: false, active: false, maxBots: 0, expiresAt: 0, trial: false, expired: true };
  if (user.role === 'admin') {
    return { planKey: 'admin', paid: true, active: true, maxBots: Infinity, expiresAt: 0, trial: false, expired: false };
  }
  const plans = getPlans();
  const plan = plans[user.plan];
  const paidUntil = Number(user.plan_expires_at) || 0;
  if (plan && paidUntil > now) {
    return { planKey: plan.key, paid: true, active: true, maxBots: plan.maxBots, expiresAt: paidUntil, trial: false, expired: false };
  }
  const trialEnds = Number(user.trial_ends_at) || ((Number(user.created_at) || now) + TRIAL_DAYS * DAY_MS);
  const active = trialEnds > now;
  return { planKey: FREE_PLAN_KEY, paid: false, active, maxBots: FREE_MAX_BOTS, expiresAt: trialEnds, trial: true, expired: !active };
}

/** ¿Puede este usuario crear otro bot? Devuelve { ok } o { ok:false, code, message }. */
export function canCreateBot(ent, currentBotCount) {
  if (!ent.active) {
    return {
      ok: false,
      code: 'TRIAL_EXPIRED',
      message: ent.paid
        ? 'Tu plan venció. Renuévalo para crear o encender bots.'
        : `Tu prueba gratuita de ${TRIAL_DAYS} días terminó. Elige un plan para seguir usando tus bots.`,
    };
  }
  if (currentBotCount >= ent.maxBots) {
    return {
      ok: false,
      code: 'BOT_LIMIT',
      message: ent.paid
        ? `Tu plan permite hasta ${ent.maxBots} bots. Mejora a un plan superior para crear más.`
        : `La cuenta gratuita permite hasta ${FREE_MAX_BOTS} bots. Mejora tu plan para crear más.`,
    };
  }
  return { ok: true };
}

/** Datos con los que se crea un bot nuevo según los derechos del dueño. */
export function newBotSubscription(ent) {
  if (ent.planKey === 'admin') return { expires_at: 0, payment_status: 'paid', plan: 'ilimitado' };
  return { expires_at: ent.expiresAt, payment_status: ent.paid ? 'paid' : 'trial', plan: ent.planKey };
}

/** Fecha de fin tras comprar `plan`: si ya tiene ese mismo plan vigente, se suma al tiempo restante. */
export function nextPlanExpiry(user, plan, now = Date.now()) {
  const sameActive = user.plan === plan.key && Number(user.plan_expires_at) > now;
  const base = sameActive ? Number(user.plan_expires_at) : now;
  return base + plan.days * DAY_MS;
}
