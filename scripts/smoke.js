#!/usr/bin/env node
// Prueba de humo contra un servidor YA DESPLEGADO (staging o producción).
//   BASE_URL=https://tu-dominio.com npm run smoke
// Crea una cuenta de prueba "smoke_xxxx" y 3 bots de prueba (que borra al final); no vincula WhatsApp.
// Sale con código 1 si algo falla.
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const EXPECT_FREE_BOTS = Number(process.env.SMOKE_EXPECT_FREE_BOTS) || 3;
const rnd = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`); if (!cond) failed++; return cond; };

async function req(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  let data = {}; try { data = await res.json(); } catch { /* sin JSON */ }
  return { status: res.status, data, headers: res.headers };
}

console.log(`Probando ${BASE}\n`);
try {
  // 1. Salud y cabeceras
  const h = await req('GET', '/health');
  ok('Salud del servidor (/health)', h.status === 200 && h.data.ok === true, `db=${h.data.db} bots=${h.data.bots?.online}/${h.data.bots?.capacity} ram=${h.data.memoryMb}MB`);
  ok('Cabeceras de seguridad', h.headers.get('x-content-type-options') === 'nosniff');

  // 2. Planes
  const pl = await req('GET', '/api/billing/plans');
  ok('Planes públicos', pl.status === 200 && pl.data.free?.maxBots === EXPECT_FREE_BOTS, `gratis: ${pl.data.free?.days} días / ${pl.data.free?.maxBots} bots; pagos: tarjeta=${pl.data.methods?.stripe} transferencia=${pl.data.methods?.transfer}`);
  if (!pl.data.methods?.stripe && !pl.data.methods?.transfer) console.log('⚠️  No hay ningún método de pago configurado (STRIPE_* o TRANSFER_INSTRUCTIONS).');

  // 3. Rutas protegidas sin sesión
  const protectedRoutes = [['GET', '/api/leads'], ['GET', '/api/tickets'], ['POST', '/api/v1/send-message'], ['DELETE', '/api/bots/bot_0000000000'], ['POST', '/api/billing/orders'], ['GET', '/api/admin/billing/orders'], ['PUT', '/api/admin/users/x/plan']];
  for (const [m, p] of protectedRoutes) {
    const r = await req(m, p, { body: m === 'GET' || m === 'DELETE' ? undefined : {} });
    ok(`Sin sesión → 401: ${m} ${p}`, r.status === 401, `recibió ${r.status}`);
  }
  const wh = await req('POST', '/api/payments/stripe/webhook', { body: { id: 'evt_fake' }, headers: { 'Stripe-Signature': 't=1,v1=00' } });
  ok('Webhook rechaza firma falsa', [400, 503].includes(wh.status), `recibió ${wh.status}`);

  // 4. Cuenta nueva: prueba de 7 días y límite de 3 bots
  const user = `smoke_${rnd(6)}`;
  const reg = await req('POST', '/api/auth/register', { body: { username: user, password: `Smoke-${rnd(8)}`, name: 'Prueba Smoke', email: `${user}@example.com` } });
  if (!ok('Registro de cuenta', reg.status === 200 && reg.data.token, reg.data.error || '')) throw new Error('Sin cuenta no se puede seguir');
  const token = reg.data.token;
  const me = await req('GET', '/api/billing/me', { token });
  ok('Prueba gratuita activa', me.data.summary?.trial === true && me.data.summary?.active === true, `quedan ~${Math.round((me.data.summary?.expiresAt - Date.now()) / 86400000)} días`);
  ok(`Límite de ${EXPECT_FREE_BOTS} bots`, me.data.summary?.maxBots === EXPECT_FREE_BOTS);

  const created = [];
  for (let i = 0; i < EXPECT_FREE_BOTS; i++) {
    const phone = `57300${rnd(7)}`;
    const r = await req('POST', '/api/bots', { token, body: { name: `Smoke ${i + 1}`, phone } });
    if (r.status === 200 && r.data.bot?.id) created.push(r.data.bot.id);
    ok(`Crear bot ${i + 1}/${EXPECT_FREE_BOTS}`, r.status === 200 && r.data.ok, r.data.error || '');
  }
  const extra = await req('POST', '/api/bots', { token, body: { name: 'Smoke extra', phone: `57300${rnd(7)}` } });
  ok('Bot extra bloqueado con 402 (requiere plan)', extra.status === 402 && extra.data.code === 'BOT_LIMIT', `recibió ${extra.status}`);

  // 5. Tickets
  const email = `${user}@example.com`;
  const tk = await req('POST', '/api/tickets', { body: { name: 'Smoke', email, category: 'otro', subject: 'Prueba de humo', message: 'Ticket generado por scripts/smoke.js; se puede cerrar.' } });
  ok('Crear ticket (público)', tk.status === 200 && /^TCK-/.test(tk.data.ticket?.id || ''), tk.data.ticket?.id || tk.data.error);
  if (tk.data.ticket?.id) {
    const lk = await req('POST', '/api/tickets/lookup', { body: { code: tk.data.ticket.id, email } });
    ok('Consultar ticket con código + correo', lk.status === 200);
    const bad = await req('POST', '/api/tickets/lookup', { body: { code: tk.data.ticket.id, email: 'otro@example.com' } });
    ok('Consulta con correo ajeno rechazada', bad.status === 404);
  }

  // 6. Limpieza
  for (const id of created) await req('DELETE', `/api/bots/${id}`, { token });
  ok('Limpieza de bots de prueba', true, `${created.length} borrados (la cuenta ${user} queda; bórrala desde el panel de admin)`);
} catch (e) {
  failed++; console.log(`❌ Error inesperado: ${e.message}`);
}
console.log(failed ? `\n${failed} comprobación(es) fallaron.` : '\nTodo en orden ✅');
process.exit(failed ? 1 : 0);
