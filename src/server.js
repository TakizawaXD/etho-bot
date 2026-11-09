// Servidor Web Express: API REST + SSE en tiempo real + Dashboard Frontend
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'node:crypto';
import { botManager } from './manager.js';
import {
  listBots, getBot, upsertBot, deleteBot,
  listCustomFunctions, getCustomFunction, upsertCustomFunction, deleteCustomFunction,
  getBotLogs, db,
  addLead, listLeads, updateLeadStatus, deleteLead,
  addProduct, listProducts, deleteProduct, getBotAIContext,
  pauseChat, resumeChat, isChatPaused,
  saveChatMessage, getChatHistory, saveUserFact, getUserFacts,
  createPlatformUser, getPlatformUserById, getPlatformUserByUsername, verifyPassword,
  listPlatformUsers, updatePlatformUser, deletePlatformUser, updateBotSubscription,
  penalizeBot, pardonBot, getSystemRules, listModerationLogs, updateSystemRule,
  toggleAutoPilot, listRecados, markRecadosRead,
  getBotPersonality, updateBotPersonality,
  normalizeBotAccessControl, updateBotAccessControl
} from './db.js';
import { testConnection } from './lib/supabase.js';
import { resolveAuthSecret, createTokenTools, createLoginLimiter, createRateLimiter, rateLimitMiddleware } from './lib/auth.js';
import { computeEntitlement, canCreateBot, newBotSubscription, TRIAL_DAYS, FREE_MAX_BOTS } from './lib/plans.js';
import { ensureTrial, getBillingUser, countUserBots } from './lib/billing.js';
import { resolveSession, tokenVersionOf, bumpTokenVersion, changePassword, adminResetPassword, AccountError } from './lib/accounts.js';
import { registerBillingRoutes } from './routes/billing.js';
import { registerSupportRoutes } from './routes/support.js';
import { config } from './config.js';
import { askAI, extractUserFacts } from './lib/ai.js';
import { skin, SEP_BOLD, SEP_LINE, SEP_DOT } from './lib/ui.js';
import { categories, commands } from './commands/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const AUTH_SECRET = resolveAuthSecret(process.env.AUTH_SECRET, path.dirname(path.resolve(config.dbPath)));
const { generateToken: signToken, verifyToken } = createTokenTools(AUTH_SECRET);
// Todo token nuevo lleva la versión de sesión actual del usuario (así se pueden revocar).
const generateToken = (user) => signToken({ ...user, token_version: tokenVersionOf(user.id) });
const loginLimiter = createLoginLimiter();
const registerLimiter = createRateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: Number(process.env.REGISTER_LIMIT_PER_DAY) || 5 });
const apiLimiter = createRateLimiter({ windowMs: 60 * 1000, max: Number(process.env.API_RATE_LIMIT_PER_MIN) || 600 });

/** Máximo de bots que puede tener el usuario (admin: capacidad total del servidor). */
function botCapFor(user) {
  if (!user) return FREE_MAX_BOTS;
  if (user.role === 'admin') return config.maxOnlineBots;
  const row = getBillingUser(user.id);
  return row ? computeEntitlement(row).maxBots : FREE_MAX_BOTS;
}

// CORS_ORIGIN (opcional): lista separada por comas. Sin definir, se mantiene el comportamiento abierto anterior.
const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors(corsOrigins.length ? { origin: corsOrigins } : undefined));
// Cabeceras de seguridad básicas (sin dependencias extra)
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});
// Límite global por IP (el SSE y el webhook de Stripe quedan fuera)
app.use('/api', (req, res, next) => {
  if (req.path === '/events' || req.path === '/payments/stripe/webhook') return next();
  return rateLimitMiddleware(apiLimiter)(req, res, next);
});
// El webhook de Stripe necesita el cuerpo EXACTO para verificar la firma.
app.use(express.json({
  limit: '2mb',
  verify: (req, res, buf) => { if (req.originalUrl.startsWith('/api/payments/stripe/webhook')) req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: true }));

// Endpoint de salud para Docker / Railway / Render / Vercel
const healthHandler = (req, res) => {
  let dbOk = true;
  try { dbOk = Number(db.prepare('SELECT 1 AS ok').get()?.ok) === 1; } catch { dbOk = false; }
  const bots = botManager.getAllBots();
  res.status(dbOk ? 200 : 503).json({
    ok: dbOk,
    db: dbOk ? 'ok' : 'error',
    uptime: Math.floor(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    bots: { total: bots.length, online: bots.filter((b) => b.status === 'online').length, capacity: config.maxOnlineBots },
    vercel: Boolean(process.env.VERCEL)
  });
};
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// ==========================================
// TOKENS & MIDDLEWARE DE AUTENTICACIÓN
// ==========================================

// Middleware opcional: si hay token (header Bearer o query ?token= para SSE), asigna req.user
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = (authHeader && authHeader.startsWith('Bearer '))
    ? authHeader.slice(7)
    : (typeof req.query?.token === 'string' ? req.query.token : '');
  if (token) {
    // Además de la firma, se valida contra la base de datos: cuenta activa, sesión no revocada y rol vigente.
    const decoded = verifyToken(token);
    const session = decoded && resolveSession(decoded);
    if (session) req.user = session;
  }
  next();
});

function authRequired(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: 'No autenticado. Inicia sesión para continuar.' });
  }
  next();
}

function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Acceso denegado. Se requiere rol de Administrador.' });
  }
  next();
}


// ==========================================
// CONTROL DE ACCESO DE LA API
// ==========================================
// Rutas públicas (relativas a /api). Todo lo demás exige sesión iniciada.
const PUBLIC_API = new Set([
  'GET /health', 'GET /status', 'GET /events', 'GET /auth/me',
  'POST /auth/login', 'POST /auth/register',
  'GET /billing/plans', 'POST /payments/stripe/webhook', 'POST /tickets', 'POST /tickets/lookup'
]);
app.use('/api', (req, res, next) => {
  if (req.method === 'OPTIONS' || PUBLIC_API.has(`${req.method} ${req.path}`)) return next();
  return authRequired(req, res, next);
});

const isAdmin = (u) => u?.role === 'admin';
const forbidden = (res, msg = 'No tienes permiso sobre este recurso.') =>
  res.status(403).json({ ok: false, error: msg });

function canAccessBot(user, botId) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (!botId || botId === 'all') return false;
  const bot = getBot(botId);
  return Boolean(bot && bot.owner_id === user.id);
}

function ownedBotIds(user) {
  return new Set(botManager.getAllBots().filter((b) => b.owner_id === user.id).map((b) => b.id));
}

// Todas las rutas /api/bots/:id/... solo para el dueño del bot o un administrador.
app.use('/api/bots/:id', (req, res, next) => {
  if (!canAccessBot(req.user, req.params.id)) return forbidden(res, 'No tienes permiso sobre este bot.');
  next();
});

// Crear recursos (leads, productos, funciones, mensajes): el bot indicado debe ser del usuario.
function scopeWrite(req, res, next) {
  if (isAdmin(req.user)) return next();
  const botId = req.body?.bot_id ?? req.body?.botId;
  if (!canAccessBot(req.user, botId)) return forbidden(res, 'No tienes permiso sobre ese bot.');
  next();
}

// Modificar/eliminar un recurso existente (la tabla es una constante interna, nunca entrada del usuario).
const entityScope = (table) => (req, res, next) => {
  if (isAdmin(req.user)) return next();
  const row = db.prepare(`SELECT bot_id FROM ${table} WHERE id=?`).get(req.params.id);
  if (!row) {
    if (req.method === 'PUT' && table === 'bot_products') return scopeWrite(req, res, next); // upsert
    return res.status(404).json({ ok: false, error: 'No encontrado.' });
  }
  if (!canAccessBot(req.user, row.bot_id)) return forbidden(res);
  if (req.body?.bot_id !== undefined && !canAccessBot(req.user, req.body.bot_id)) return forbidden(res);
  next();
};

// Listados: con ?botId= se valida el bot; sin él, un usuario solo ve filas de sus propios bots.
const scopeList = (key) => (req, res, next) => {
  if (isAdmin(req.user)) return next();
  const requested = req.query.botId;
  if (requested && requested !== 'all') {
    return canAccessBot(req.user, requested) ? next() : forbidden(res, 'No tienes permiso sobre ese bot.');
  }
  const owned = ownedBotIds(req.user);
  const json = res.json.bind(res);
  res.json = (body) => {
    if (body && Array.isArray(body[key])) body = { ...body, [key]: body[key].filter((r) => owned.has(r.bot_id)) };
    return json(body);
  };
  next();
};

const exportScope = (req, res, next) => {
  if (isAdmin(req.user)) return next();
  const { botId } = req.query;
  if (!botId || botId === 'all') return res.status(400).json({ ok: false, error: 'Selecciona un bot para exportar.' });
  return canAccessBot(req.user, botId) ? next() : forbidden(res, 'No tienes permiso sobre ese bot.');
};

// Avisos en vivo solo para administradores (tickets nuevos, pagos por revisar)
function notifyAdmins(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { if (res.sseUser?.role === 'admin') res.write(payload); } catch { sseClients.delete(res); }
  }
}

// Notifica a los paneles que cambió el plan/vencimiento de ciertos bots
function onBotsChanged(botIds = []) {
  for (const botId of botIds) {
    const b = getBot(botId);
    if (b) botManager.emit('bot_update', { botId, payment_status: b.payment_status, expires_at: b.expires_at, plan: b.plan });
  }
}

registerBillingRoutes(app, { authRequired, adminRequired, notifyAdmins, onBotsChanged });
registerSupportRoutes(app, { authRequired, adminRequired, notifyAdmins });

// Servir frontend estático sin cache agresivo para reflejar cambios instantáneamente
const publicDir = path.join(__dirname, 'web', 'public');

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir, {
    etag: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }
  }));
}

// Clientes SSE conectados
const sseClients = new Set();

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const targetBot = (data && data.botId) ? getBot(data.botId) : null;

  for (const res of sseClients) {
    try {
      if (event === 'bot_update' || event === 'qr' || event === 'bot_delete') {
        const u = res.sseUser;
        if (!u) continue;
        if (u.role === 'user' && targetBot && targetBot.owner_id !== u.id) {
          continue;
        }
      }
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

// Escuchar eventos del BotManager para retransmitirlos por SSE
botManager.on('bot_update', (data) => broadcastSSE('bot_update', data));
botManager.on('qr', (data) => broadcastSSE('qr', data));
botManager.on('bot_delete', (data) => broadcastSSE('bot_delete', data));

// ==========================================
// RUTAS API: SSE (Eventos en Tiempo Real)
// ==========================================
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.sseUser = req.user || null;
  sseClients.add(res);

  const allBots = botManager.getAllBots();
  let visibleBots = [];
  if (req.user) {
    visibleBots = req.user.role === 'user'
      ? allBots.filter(b => b.owner_id === req.user.id)
      : allBots;
  }

  // Enviar estado inicial filtrado según sesión
  const initialPayload = {
    bots: visibleBots,
    maxBots: botCapFor(req.user),
    timestamp: Date.now()
  };
  res.write(`event: init\ndata: ${JSON.stringify(initialPayload)}\n\n`);

  // Mantener viva la conexión con ping cada 20s
  const pingInterval = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(pingInterval); }
  }, 20_000);

  req.on('close', () => {
    clearInterval(pingInterval);
    sseClients.delete(res);
  });
});

// ==========================================
// RUTAS API: ESTADO GENERAL Y SUPABASE
// ==========================================
app.get('/api/health', (req, res) => {
  res.json({ ok: true, status: 'online', uptime: Math.floor(process.uptime()), time: Date.now() });
});

app.get('/api/status', async (req, res) => {
  const bots = botManager.getAllBots();
  const onlineBots = bots.filter(b => b.status === 'online').length;
  const supaStatus = await testConnection();

  let totalLogs = 0;
  try {
    totalLogs = db.prepare('SELECT COUNT(*) as c FROM bot_logs').get()?.c || 0;
  } catch { /* tabla vacía */ }

  res.json({
    ok: true,
    server: 'running',
    uptime: Math.floor(process.uptime()),
    stats: {
      totalBots: bots.length,
      onlineBots,
      maxBots: botCapFor(req.user),
      totalLogs
    },
    supabase: supaStatus
  });
});

app.post('/api/supabase/test', adminRequired, async (req, res) => {
  const result = await testConnection();
  res.json(result);
});

// ==========================================
// RUTAS API: AUTENTICACIÓN (LOGIN & REGISTRO)
// ==========================================

app.post('/api/auth/register', (req, res) => {
  try {
    const { username, password, name, email, whatsapp } = req.body;
    if (!username || !password || !name) {
      return res.status(400).json({ ok: false, error: 'Usuario, contraseña y nombre son obligatorios.' });
    }
    if (username.length < 3) {
      return res.status(400).json({ ok: false, error: 'El nombre de usuario debe tener al menos 3 caracteres.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' });
    }

    const existing = getPlatformUserByUsername(username);
    if (existing) {
      return res.status(400).json({ ok: false, error: 'El nombre de usuario ya está registrado.' });
    }

    const botPurpose = req.body.botPurpose?.trim();

    // Anti-abuso de pruebas gratuitas: máximo de cuentas nuevas por IP al día
    const waitReg = registerLimiter.hit(`reg|${req.ip}`);
    if (waitReg) {
      return res.status(429).json({ ok: false, error: 'Se alcanzó el límite de cuentas nuevas desde esta red. Intenta mañana o contacta a soporte.' });
    }

    const created = createPlatformUser({
      username,
      password,
      name,
      email: email || '',
      whatsapp: whatsapp || '',
      role: 'user'
    });
    const user = ensureTrial(created.id) || created;   // fija los 7 días de prueba una sola vez
    const trialEnt = computeEntitlement(getBillingUser(user.id));

    let initialBot = null;
    if (botPurpose) {
      const botName = req.body.botName?.trim() || `Bot de ${name.split(' ')[0]}`;
      const cleanPhone = (whatsapp || '').replace(/\D/g, '');
      const botId = `bot_${cleanPhone || Date.now()}`;
      const sub = newBotSubscription(trialEnt);
      const personality = req.body.botPersonality || 'advisor';

      initialBot = upsertBot({
        id: botId,
        name: botName,
        phone: cleanPhone,
        prefix: '#',
        status: 'offline',
        is_active: 1,
        personality,
        system_prompt: `Eres el asistente oficial de ${botPurpose}. Atiende de forma amable, clara y ayuda al cliente en todo lo que necesite.`,
        ai_auto_reply: 1,
        owner_id: user.id,
        purpose: botPurpose,
        expires_at: sub.expires_at,
        payment_status: sub.payment_status,
        plan: sub.plan,
        settings: {
          currency: 'coins',
          welcomeEnabled: true,
          antiSpamEnabled: true,
          welcomeMessage: `¡Hola! Bienvenido/a. Soy el asistente de ${botPurpose}. ¿En qué te puedo colaborar hoy?`,
          accessControl: {
            allowPrivateChats: true,
            groupMode: 'whitelist',
            allowedGroups: []
          }
        }
      });

      botManager.startBot(botId).catch(err => console.error(`Error auto-iniciando bot ${botId}:`, err.message));
    }

    const token = generateToken(user);
    res.json({
      ok: true,
      user,
      token,
      bot: initialBot,
      message: initialBot ? `¡Cuenta y Bot creados con éxito! Tienes ${TRIAL_DAYS} días de prueba gratis.` : '¡Registro exitoso!'
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Ingresa usuario y contraseña.' });
    }

    const limitKey = `${req.ip}|${String(username).toLowerCase().trim()}`;
    const wait = loginLimiter.isBlocked(limitKey);
    if (wait) {
      return res.status(429).json({ ok: false, error: `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(wait / 60)} min.` });
    }

    const user = getPlatformUserByUsername(username);
    if (!user) {
      loginLimiter.fail(limitKey);
      return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos.' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ ok: false, error: 'Tu cuenta ha sido suspendida. Contacta al administrador.' });
    }

    const isValid = verifyPassword(password, user.password_hash);
    if (!isValid) {
      loginLimiter.fail(limitKey);
      return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos.' });
    }
    loginLimiter.reset(limitKey);

    const safeUser = getPlatformUserById(user.id);
    const token = generateToken(safeUser);
    res.json({ ok: true, user: safeUser, token, message: `¡Bienvenido ${safeUser.name}!` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Cambiar la contraseña propia: cierra las demás sesiones y devuelve un token nuevo para este dispositivo
app.post('/api/auth/change-password', authRequired, (req, res) => {
  try {
    changePassword(req.user.id, req.body?.current, req.body?.next);
    const user = getPlatformUserById(req.user.id);
    res.json({ ok: true, token: generateToken(user), message: 'Contraseña actualizada. Se cerró la sesión en tus otros dispositivos.' });
  } catch (err) {
    if (err instanceof AccountError) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[Auth]', err);
    res.status(500).json({ ok: false, error: 'No se pudo cambiar la contraseña.' });
  }
});

// Cerrar sesión en TODOS los dispositivos (incluido este: el cliente debe volver a iniciar sesión)
app.post('/api/auth/logout-all', authRequired, (req, res) => {
  bumpTokenVersion(req.user.id);
  res.json({ ok: true, message: 'Se cerró la sesión en todos tus dispositivos.' });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) {
    return res.json({ ok: false, user: null });
  }
  const user = getPlatformUserById(req.user.id);
  res.json({ ok: true, user });
});

// ==========================================
// RUTAS API: ADMINISTRACIÓN MASTER (SOLO ADMIN)
// ==========================================

app.get('/api/admin/users', adminRequired, (req, res) => {
  const users = listPlatformUsers();
  res.json({ ok: true, users });
});

// El admin restablece la contraseña de un cliente (se devuelve una temporal una sola vez)
app.post('/api/admin/users/:id/reset-password', adminRequired, (req, res) => {
  try {
    const temp = adminResetPassword(req.params.id);
    res.json({ ok: true, temporaryPassword: temp, message: 'Contraseña restablecida. Compártela de forma segura; el cliente debe cambiarla al entrar.' });
  } catch (err) {
    if (err instanceof AccountError) return res.status(err.status).json({ ok: false, error: err.message });
    res.status(500).json({ ok: false, error: 'No se pudo restablecer la contraseña.' });
  }
});

app.put('/api/admin/users/:id', adminRequired, (req, res) => {
  try {
    const updated = updatePlatformUser(req.params.id, req.body);
    if (!updated) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    res.json({ ok: true, user: updated, message: 'Usuario actualizado correctamente' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/admin/users/:id', adminRequired, (req, res) => {
  try {
    deletePlatformUser(req.params.id);
    res.json({ ok: true, message: 'Usuario y sus bots eliminados correctamente' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/admin/bots', adminRequired, (req, res) => {
  const allBots = botManager.getAllBots();
  const users = listPlatformUsers();
  const userMap = new Map(users.map(u => [u.id, u]));

  const enriched = allBots.map(b => {
    const owner = userMap.get(b.owner_id) || { name: 'Admin Master', username: 'admin', whatsapp: '' };
    return {
      ...b,
      owner_name: owner.name,
      owner_username: owner.username,
      owner_whatsapp: owner.whatsapp
    };
  });
  res.json({ ok: true, bots: enriched });
});

app.put('/api/admin/bots/:id/subscription', adminRequired, async (req, res) => {
  try {
    const { daysToAdd, payment_status, plan, purpose } = req.body;
    const updated = updateBotSubscription(req.params.id, {
      daysToAdd,
      payment_status,
      plan,
      purpose
    });
    if (!updated) return res.status(404).json({ ok: false, error: 'Bot no encontrado' });

    if (updated.payment_status === 'suspended' || updated.payment_status === 'expired') {
      await botManager.stopBot(req.params.id).catch(() => {});
    }

    broadcastSSE('bot_update', { botId: updated.id, ...updated });
    res.json({ ok: true, bot: updated, message: 'Tiempo de servicio y estado actualizados correctamente' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/admin/stats', adminRequired, (req, res) => {
  const users = listPlatformUsers();
  const bots = botManager.getAllBots();
  const trial = bots.filter(b => b.payment_status === 'trial').length;
  const paid = bots.filter(b => b.payment_status === 'paid').length;
  const expired = bots.filter(b => b.payment_status === 'expired' || b.payment_status === 'suspended').length;
  res.json({
    ok: true,
    stats: {
      totalUsers: users.length,
      totalBots: bots.length,
      trialBots: trial,
      paidBots: paid,
      expiredBots: expired
    }
  });
});

// ==========================================
// RUTAS API: REGLAS Y MODERACIÓN (ANTI-ABUSO)
// ==========================================

app.get('/api/moderation/rules', (req, res) => {
  const rules = getSystemRules();
  res.json({ ok: true, rules });
});

app.get('/api/moderation/logs', adminRequired, (req, res) => {
  const { botId, limit } = req.query;
  const logs = listModerationLogs({ botId, limit: Number(limit) || 50 });
  res.json({ ok: true, logs });
});

app.post('/api/moderation/penalize', adminRequired, async (req, res) => {
  try {
    const { botId, days, reason, deductDays } = req.body;
    if (!botId) return res.status(400).json({ ok: false, error: 'Debes especificar el bot a penalizar.' });

    // Apagar la instancia socket inmediatamente
    await botManager.stopBot(botId).catch(() => {});

    // Aplicar la penalización en BD
    const updated = penalizeBot(botId, Number(days) || 2, reason || 'Infracción a las reglas de moderación', deductDays !== false);
    if (!updated) return res.status(404).json({ ok: false, error: 'Bot no encontrado.' });

    res.json({
      ok: true,
      bot: updated,
      message: `El bot "${updated.name}" ha sido penalizado con ${updated.penalty_days} días de suspensión.`
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/moderation/pardon', adminRequired, async (req, res) => {
  try {
    const { botId } = req.body;
    if (!botId) return res.status(400).json({ ok: false, error: 'Debes especificar el bot a indultar.' });

    const updated = pardonBot(botId);
    if (!updated) return res.status(404).json({ ok: false, error: 'Bot no encontrado.' });

    res.json({
      ok: true,
      bot: updated,
      message: `Se ha levantado la penalización para el bot "${updated.name}". Ya puede encenderse.`
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/api/moderation/rules/:id', adminRequired, (req, res) => {
  try {
    const updated = updateSystemRule(req.params.id, req.body);
    if (!updated) return res.status(404).json({ ok: false, error: 'Regla no encontrada.' });
    res.json({ ok: true, rule: updated, message: 'Regla actualizada correctamente.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==========================================
// RUTAS API: GESTIÓN DE BOTS (MULTI-BOT)
// ==========================================
app.get('/api/bots', (req, res) => {
  if (!req.user) {
    return res.json({ ok: true, bots: [], maxBots: FREE_MAX_BOTS });
  }
  const all = botManager.getAllBots();
  const maxBots = botCapFor(req.user);
  if (req.user.role === 'user') {
    const myBots = all.filter(b => b.owner_id === req.user.id);
    return res.json({ ok: true, bots: myBots, maxBots });
  }
  res.json({ ok: true, bots: all, maxBots });
});

app.post('/api/bots', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: 'Debes iniciar sesión para registrar un bot en el panel.' });
    }

    const { name, phone, prefix, personality, system_prompt, ai_auto_reply, purpose } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ ok: false, error: 'El nombre del bot es obligatorio.' });
    }

    const cleanPhone = (phone || '').replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 8) {
      return res.status(400).json({
        ok: false,
        error: 'El número de teléfono de WhatsApp es obligatorio para conectar el bot (código de país + número, ej: 573171736519).'
      });
    }

    const id = `bot_${cleanPhone}`;
    const isUserRole = req.user.role === 'user';
    const ownerId = req.user.id;
    const allBots = botManager.getAllBots();
    const existingBot = getBot(id);

    if (existingBot) {
      if (isUserRole && existingBot.owner_id !== ownerId) {
        return res.status(400).json({
          ok: false,
          error: 'Ese número de WhatsApp ya está vinculado en otra instancia activa.'
        });
      }
      if (existingBot.status === 'online') {
        return res.status(400).json({
          ok: false,
          error: `Ya tienes el bot "${existingBot.name}" conectado con el número +${cleanPhone}. Usa otro número o edita el bot existente.`
        });
      }
    } else {
      if (allBots.length >= config.maxOnlineBots * 3) {
        return res.status(503).json({ ok: false, code: 'SERVER_FULL', error: 'El servidor alcanzó su capacidad. Intenta más tarde.' });
      }
    }

    // Límites por plan: cuenta gratuita = 7 días y 3 bots; más requiere un plan de pago.
    const ownerRow = getBillingUser(ownerId);
    const ent = computeEntitlement(ownerRow || { role: req.user.role });
    if (!existingBot && isUserRole) {
      const verdict = canCreateBot(ent, countUserBots(ownerId));
      if (!verdict.ok) {
        return res.status(402).json({ ok: false, code: verdict.code, error: verdict.message, upgrade: true });
      }
    }
    const sub = newBotSubscription(ent);
    const expiresAt = existingBot?.expires_at !== undefined ? existingBot.expires_at : sub.expires_at;
    const paymentStatus = existingBot?.payment_status || sub.payment_status;
    const plan = existingBot?.plan || sub.plan;

    const created = upsertBot({
      id,
      name: name.trim(),
      phone: cleanPhone,
      prefix: (prefix || '#').trim(),
      status: existingBot?.status || 'offline',
      is_active: 1,
      personality: personality || 'recreational',
      system_prompt: system_prompt?.trim() || null,
      ai_auto_reply: (ai_auto_reply === undefined || ai_auto_reply === null || ai_auto_reply) ? 1 : 0,
      owner_id: existingBot?.owner_id || ownerId,
      purpose: purpose?.trim() || '',
      expires_at: expiresAt,
      payment_status: paymentStatus,
      plan,
      settings: {
        currency: 'coins',
        welcomeEnabled: true,
        antiSpamEnabled: true,
        accessControl: {
          allowPrivateChats: true,
          groupMode: 'whitelist',
          allowedGroups: []
        },
        ...(existingBot?.settings || {}),
        ...(req.body.settings || {})
      }
    });

    broadcastSSE('bot_update', { botId: id, ...created });

    // Iniciar el bot de inmediato para generar su QR o vincular
    botManager.startBot(id).catch(err => console.error(`Error auto-iniciando ${id}:`, err.message));

    res.json({ ok: true, bot: created, maxBots: botCapFor(req.user) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/api/bots/:id', (req, res) => {
  try {
    const existing = getBot(req.params.id);
    if (!existing) return res.status(404).json({ ok: false, error: 'Bot no encontrado' });

    const mergedSettings = req.body.settings && typeof req.body.settings === 'object'
      ? {
          ...(existing.settings || {}),
          ...req.body.settings,
          accessControl: req.body.settings.accessControl
            ? { ...(existing.settings?.accessControl || {}), ...req.body.settings.accessControl }
            : (existing.settings?.accessControl || normalizeBotAccessControl(existing))
        }
      : existing.settings;

    const updated = upsertBot({
      id: req.params.id,
      ...existing,
      ...req.body,
      settings: mergedSettings
    });

    broadcastSSE('bot_update', { botId: updated.id, ...updated });
    res.json({ ok: true, bot: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==========================================
// CONTROL DE ACCESO POR GRUPOS Y CHATS (DÓNDE ACTIVAR EL BOT)
// ==========================================
function canManageBot(req, bot) {
  if (!req.user || !bot) return false;
  if (req.user.role === 'admin') return true;
  return bot.owner_id === req.user.id;
}

app.get('/api/bots/:id/access', authRequired, async (req, res) => {
  try {
    const bot = getBot(req.params.id);
    if (!bot) return res.status(404).json({ ok: false, error: 'Bot no encontrado' });
    if (!canManageBot(req, bot)) {
      return res.status(403).json({ ok: false, error: 'No tienes permiso para configurar este bot.' });
    }

    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = await botManager.getBotGroups(bot.id, forceRefresh);
    res.json({
      ok: true,
      botId: bot.id,
      botName: bot.name,
      prefix: bot.prefix || '#',
      ...data
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/api/bots/:id/access', authRequired, async (req, res) => {
  try {
    const bot = getBot(req.params.id);
    if (!bot) return res.status(404).json({ ok: false, error: 'Bot no encontrado' });
    if (!canManageBot(req, bot)) {
      return res.status(403).json({ ok: false, error: 'No tienes permiso para configurar este bot.' });
    }

    const {
      allowPrivateChats,
      groupMode,
      allowedGroups,
      toggleGroupJid,
      enabled,
      groupSubject,
      groupSize,
      groupMeta
    } = req.body || {};

    let metaToSave = (groupMeta && typeof groupMeta === 'object') ? { ...groupMeta } : undefined;
    if (toggleGroupJid && groupSubject) {
      metaToSave = {
        ...(metaToSave || {}),
        [toggleGroupJid]: {
          subject: String(groupSubject),
          size: Number(groupSize || 0)
        }
      };
    }

    const updated = updateBotAccessControl(bot.id, {
      allowPrivateChats,
      groupMode,
      allowedGroups,
      toggleGroupJid,
      enabled,
      groupMeta: metaToSave
    });

    if (!updated) return res.status(404).json({ ok: false, error: 'Bot no encontrado' });

    const liveBot = botManager.getBot(bot.id) || updated.bot;
    broadcastSSE('bot_update', { botId: bot.id, ...liveBot });

    res.json({
      ok: true,
      bot: liveBot,
      accessControl: updated.accessControl,
      message: 'Permisos de activación actualizados correctamente'
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/bots/:id', (req, res) => {
  const bot = botManager.getBot(req.params.id);
  if (!bot) return res.status(404).json({ ok: false, error: 'Bot no encontrado' });
  res.json({ ok: true, bot });
});

// Configuración o alternar Modo Hablar por Mí (Piloto Automático)
app.post('/api/bots/:id/pilot', (req, res) => {
  try {
    const updated = toggleAutoPilot(req.params.id, req.body);
    if (!updated) return res.status(404).json({ ok: false, error: 'Bot no encontrado' });
    broadcastSSE('bot_update', { botId: updated.id, ...updated });
    res.json({
      ok: true,
      bot: updated,
      message: updated.auto_pilot
        ? 'Modo "Hablar por Mí" (Piloto Automático) activado. La IA responderá por ti.'
        : 'Modo "Hablar por Mí" desactivado.'
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Listar recados y mensajes atendidos por la IA en modo piloto
app.get('/api/bots/:id/recados', (req, res) => {
  const list = listRecados(req.params.id, Number(req.query.limit) || 50);
  res.json({ ok: true, recados: list });
});

// Marcar recados como leídos
app.post('/api/bots/:id/recados/read', (req, res) => {
  markRecadosRead(req.params.id);
  res.json({ ok: true, message: 'Recados marcados como leídos' });
});

// Obtener configuración de personalidad y palabras
app.get('/api/bots/:id/personality', (req, res) => {
  const data = getBotPersonality(req.params.id);
  if (!data) return res.status(404).json({ ok: false, error: 'Bot no encontrado' });
  res.json({ ok: true, personality: data });
});

// Actualizar personalidad, tono, palabras prohibidas y preferidas
app.put('/api/bots/:id/personality', (req, res) => {
  try {
    const updated = updateBotPersonality(req.params.id, req.body);
    if (!updated) return res.status(404).json({ ok: false, error: 'Bot no encontrado' });
    const fullBot = getBot(req.params.id);
    broadcastSSE('bot_update', { botId: req.params.id, ...fullBot });
    res.json({ ok: true, message: 'Personalidad y vocabulario actualizados', personality: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/bots/:id/start', async (req, res) => {
  try {
    const bot = await botManager.startBot(req.params.id);
    res.json({ ok: true, message: 'Bot encendido', bot });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/bots/:id/stop', async (req, res) => {
  try {
    const bot = await botManager.stopBot(req.params.id);
    res.json({ ok: true, message: 'Bot apagado', bot });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/bots/:id/restart', async (req, res) => {
  try {
    const bot = await botManager.restartBot(req.params.id);
    res.json({ ok: true, message: 'Bot reiniciado', bot });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/bots/:id/reset-session', async (req, res) => {
  try {
    const bot = await botManager.resetBotSession(req.params.id);
    res.json({ ok: true, message: 'Sesión reiniciada y nuevo código QR generado', bot });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/bots/:id', async (req, res) => {
  try {
    await botManager.deleteBot(req.params.id);
    res.json({ ok: true, message: 'Bot eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/bots/:id/qr', (req, res) => {
  const bot = botManager.getBot(req.params.id);
  if (!bot) return res.status(404).json({ ok: false, error: 'Bot no encontrado' });
  res.json({
    ok: true,
    status: bot.status,
    qr_code: bot.qr_code,
    pairing_code: bot.pairing_code
  });
});

app.post('/api/bots/:id/pairing-code', async (req, res) => {
  try {
    const { phone } = req.body || {};
    const result = await botManager.requestPairingCodeDirectly(req.params.id, phone);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==========================================
// RUTAS API: FUNCIONES Y REGLAS (CRUD)
// ==========================================
app.get('/api/functions', scopeList('functions'), (req, res) => {
  const { botId } = req.query;
  const list = listCustomFunctions(botId);
  res.json({ ok: true, functions: list });
});

app.post('/api/functions', scopeWrite, (req, res) => {
  try {
    const { name, description, trigger_type, trigger_value, response_text, response_type, bot_id, is_enabled } = req.body;
    if (!name || !trigger_value || !response_text) {
      return res.status(400).json({ ok: false, error: 'Nombre, disparador y texto de respuesta son obligatorios.' });
    }

    const created = upsertCustomFunction({
      name: name.trim(),
      description: description?.trim() || '',
      trigger_type: trigger_type || 'command',
      trigger_value: trigger_value.trim(),
      response_text: response_text.trim(),
      response_type: response_type || 'text',
      bot_id: bot_id || 'all',
      is_enabled: is_enabled !== undefined ? is_enabled : true
    });

    res.json({ ok: true, function: created });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/api/functions/:id', entityScope('bot_custom_functions'), (req, res) => {
  try {
    const existing = getCustomFunction(req.params.id);
    if (!existing) return res.status(404).json({ ok: false, error: 'Función no encontrada' });

    const updated = upsertCustomFunction({
      id: req.params.id,
      ...existing,
      ...req.body
    });

    res.json({ ok: true, function: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/functions/:id', entityScope('bot_custom_functions'), (req, res) => {
  try {
    deleteCustomFunction(req.params.id);
    res.json({ ok: true, message: 'Función eliminada correctamente' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==========================================
// RUTAS API: CATÁLOGO DE COMANDOS DEL BOT
// ==========================================
app.get('/api/commands', (req, res) => {
  const result = [];
  for (const [catName, list] of categories.entries()) {
    result.push({
      category: catName,
      commands: list.map(c => ({
        name: c.name,
        aliases: c.aliases || [],
        description: c.description || '',
        usage: c.usage || '',
        adminOnly: Boolean(c.adminOnly),
        ownerOnly: Boolean(c.ownerOnly),
        groupOnly: Boolean(c.groupOnly)
      }))
    });
  }
  res.json({ ok: true, categories: result, totalCommands: commands.size });
});

// ==========================================
// RUTAS API: REGISTRO DE ACTIVIDAD (LOGS)
// ==========================================
app.get('/api/logs', scopeList('logs'), (req, res) => {
  const { limit = 80, botId, type, search } = req.query;
  const logs = getBotLogs({
    limit: parseInt(limit, 10) || 80,
    botId,
    type,
    search
  });
  res.json({ ok: true, logs });
});

// ==========================================
// RUTAS API: CRM LEADS & CONTACTOS
// ==========================================
app.get('/api/leads', scopeList('leads'), (req, res) => {
  const { botId, status, search } = req.query;
  const leads = listLeads({ botId, status, search });
  res.json({ ok: true, leads });
});

app.post('/api/leads', scopeWrite, (req, res) => {
  try {
    const lead = addLead(req.body);
    res.json({ ok: true, lead });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/api/leads/:id', entityScope('bot_leads'), (req, res) => {
  try {
    const { status, notes } = req.body;
    const lead = updateLeadStatus(req.params.id, status, notes);
    res.json({ ok: true, lead });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/leads/:id', entityScope('bot_leads'), (req, res) => {
  try {
    deleteLead(req.params.id);
    res.json({ ok: true, message: 'Lead eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/leads/export', exportScope, (req, res) => {
  try {
    const { botId } = req.query;
    const leads = listLeads({ botId });

    let csv = 'ID,Bot,Nombre,Telefono,Email,Interes,Estado,Fecha\n';
    leads.forEach(l => {
      const date = new Date(l.created_at).toISOString();
      const clean = (str) => `"${String(str || '').replace(/"/g, '""')}"`;
      csv += `${clean(l.id)},${clean(l.bot_id)},${clean(l.name)},${clean(l.phone)},${clean(l.email)},${clean(l.interest)},${clean(l.status)},${clean(date)}\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leads_export.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).send('Error exportando leads');
  }
});

// ==========================================
// RUTAS API: CATÁLOGO DE PRODUCTOS / SERVICIOS
// ==========================================
app.get('/api/products', scopeList('products'), (req, res) => {
  const { botId } = req.query;
  const products = listProducts(botId);
  res.json({ ok: true, products });
});

app.post('/api/products', scopeWrite, (req, res) => {
  try {
    const product = addProduct(req.body);
    res.json({ ok: true, product });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/api/products/:id', entityScope('bot_products'), (req, res) => {
  try {
    const product = addProduct({ ...req.body, id: req.params.id });
    res.json({ ok: true, product });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/products/:id', entityScope('bot_products'), (req, res) => {
  try {
    deleteProduct(req.params.id);
    res.json({ ok: true, message: 'Producto eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==========================================
// RUTAS API: AJUSTES AVANZADOS DEL BOT
// ==========================================
app.put('/api/bots/:id/settings', (req, res) => {
  try {
    const bot = getBot(req.params.id);
    if (!bot) return res.status(404).json({ ok: false, error: 'Bot no encontrado' });

    const newSettings = {
      ...(bot.settings || {}),
      ...(req.body || {})
    };

    const updated = upsertBot({
      ...bot,
      settings: newSettings
    });

    res.json({ ok: true, bot: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==========================================
// RUTAS API: PAUSA DE CHAT (HUMAN HANDOFF)
// ==========================================
app.post('/api/bots/:id/chat-pause', (req, res) => {
  try {
    const { chatJid, minutes, reason } = req.body;
    pauseChat(req.params.id, chatJid, minutes || 60, reason || 'Pausa manual');
    res.json({ ok: true, message: `Chat pausado por ${minutes || 60} minutos` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/bots/:id/chat-resume', (req, res) => {
  try {
    const { chatJid } = req.body;
    resumeChat(req.params.id, chatJid);
    res.json({ ok: true, message: 'Chat reanudado para el bot' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==========================================
// RUTAS API: SIMULADOR / PLAYGROUND DE CHAT (#8)
// ==========================================
app.post('/api/bots/:id/simulate', async (req, res) => {
  try {
    const { text, sender = 'simulado@s.whatsapp.net', isGroup = false } = req.body;
    const bot = getBot(req.params.id);
    if (!bot) return res.status(404).json({ ok: false, error: 'Bot no encontrado' });

    // 1. Probar reglas personalizadas
    const fns = listCustomFunctions(bot.id);
    const textLower = (text || '').toLowerCase().trim();
    const prefix = bot.prefix || '#';
    const ownerDisplay = bot.owner_display_name || bot.owner_name || 'el titular';

    // Simulación de /enable (contacto pausa al asesor en privado) y #reactivar
    if (!isGroup && (textLower === `${prefix}reactivar` || textLower === `${prefix}asistente`)) {
      resumeChat(bot.id, sender);
      return res.json({
        ok: true,
        type: 'command',
        reply: `${SEP_BOLD}\n✅ *🤖 ASESOR REACTIVADO*\n${SEP_LINE}\nEl ayudante automático volverá a responder en este chat privado hasta que el contacto use */enable*.\n${SEP_BOLD}`
      });
    }

    if (!isGroup && (textLower === '/enable' || textLower.startsWith('/enable '))) {
      pauseChat(bot.id, sender, 0, 'Simulación de /enable');
      return res.json({
        ok: true,
        type: 'handoff',
        reply: [
          SEP_BOLD,
          `🤝 *ATENCIÓN DIRECTA HABILITADA · /enable*`,
          SEP_LINE,
          `Perfecto. He pausado mi asistencia automática en este chat para que puedas comunicarte directamente con *${ownerDisplay}*.`,
          SEP_DOT,
          `💬 Escribe tu mensaje con confianza; te responderá personalmente en cuanto esté disponible.`,
          SEP_BOLD
        ].join('\n')
      });
    }

    if (!isGroup && isChatPaused(bot.id, sender)) {
      return res.json({
        ok: true,
        type: 'paused',
        reply: `🔇 *[Asesor en silencio en este chat tras /enable — En WhatsApp real no envía nada para que hables tú. En este simulador escribe ${prefix}reactivar para volver a encender al asesor]*`
      });
    }

    let matchedRule = null;

    for (const fn of fns) {
      if (!fn.is_enabled) continue;
      const t = fn.trigger_value.toLowerCase().trim();
      if ((fn.trigger_type === 'command' && (textLower === `#${t}` || textLower.startsWith(`#${t} `))) ||
          (fn.trigger_type === 'exact' && textLower === t) ||
          (fn.trigger_type === 'contains' && textLower.includes(t))) {
        matchedRule = fn;
        break;
      }
    }

    if (matchedRule) {
      return res.json({
        ok: true,
        type: 'custom_rule',
        ruleName: matchedRule.name,
        reply: matchedRule.response_text.replace('{user}', '@usuario').replace('{name}', 'Usuario Simulado')
      });
    }

    // 2. Ejecutar comandos si inicia con el prefijo
    const afterPrefix = text.startsWith(prefix) ? text.slice(prefix.length).trim() : '';
    const isPrefixedAttempt = Boolean(afterPrefix && /^[a-zA-ZÁÉÍÓÚáéíóúñÑ0-9]{2,}/.test(afterPrefix));
    let unknownCommand = '';

    if (isPrefixedAttempt) {
      const parts = afterPrefix.split(/\s+/);
      const cmdName = (parts[0] || '').toLowerCase();
      const cmd = commands.get(cmdName);
      if (cmd) {
        let replyOutput = '';
        const simContext = {
          botId: bot.id,
          botName: bot.name,
          prefix,
          sender,
          chat: isGroup ? '12345-6789@g.us' : sender,
          isGroup,
          isOwner: true,
          text: parts.slice(1).join(' '),
          args: parts.slice(1),
          command: cmdName,
          user: { exp: 50, coins: 100 },
          group: {},
          reply: async (txt) => {
            replyOutput = skin(txt, { label: cmd.category || bot.name, command: cmd.name, prefix });
            return { key: { id: 'sim_' + Date.now(), fromMe: true } };
          },
          raw: async (txt) => {
            replyOutput = txt;
            return { key: { id: 'sim_' + Date.now(), fromMe: true } };
          },
          sock: {
            sendMessage: async (jid, content) => {
              replyOutput = content.text || content.caption || '[Mensaje generado]';
            }
          }
        };
        await cmd.run(simContext);
        if (replyOutput) {
          return res.json({
            ok: true,
            type: 'command',
            reply: replyOutput
          });
        }
      } else {
        unknownCommand = cmdName;
      }
    }

    // 3. Atención directa por IA preparada (sin recomendaciones de comandos)
    const aiCtx = getBotAIContext(bot.id);
    const simChatJid = isGroup ? '12345-6789@g.us' : sender;
    const learned = extractUserFacts(text || '');
    for (const f of learned) saveUserFact(bot.id, sender, f.key, f.value);
    const history = getChatHistory(bot.id, simChatJid, 10);
    const userFacts = getUserFacts(bot.id, sender);
    saveChatMessage(bot.id, simChatJid, sender, 'user', text || '');

    const isAdvisorDM = !isGroup && Boolean(aiCtx.autoPilot !== false) && !unknownCommand;

    const aiReply = await askAI(text, aiCtx.systemPrompt, aiCtx.personality || 'assistant', {
      history,
      userFacts,
      botName: aiCtx.botName || 'Etho',
      purpose: aiCtx.purpose,
      isAutoPilot: isAdvisorDM,
      pilotPersona: aiCtx.pilotPersona || 'as_assistant',
      ownerName: aiCtx.ownerName || ownerDisplay,
      pilotContext: aiCtx.pilotContext || '',
      tone: aiCtx.tone,
      forbiddenWords: aiCtx.forbiddenWords,
      preferredWords: aiCtx.preferredWords,
      products: aiCtx.products,
      knowledge: aiCtx.knowledge,
      businessHours: aiCtx.businessHours,
      prefix,
      unknownCommand
    });
    if (aiReply) {
      saveChatMessage(bot.id, simChatJid, bot.id, 'assistant', aiReply);
    }
    res.json({
      ok: true,
      type: isAdvisorDM ? 'advisor_dm' : 'ai_response',
      reply: aiReply
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==========================================
// RUTAS API: ENVÍO EXTERNO DE MENSAJES (#43)
// ==========================================
app.post('/api/v1/send-message', scopeWrite, async (req, res) => {
  try {
    const { botId, to, text } = req.body;
    if (!botId || !to || !text) {
      return res.status(400).json({ ok: false, error: 'Faltan parámetros: botId, to, text' });
    }

    const inst = botManager.instances.get(botId);
    if (!inst || inst.status !== 'online' || !inst.sock) {
      return res.status(503).json({ ok: false, error: `El bot ${botId} no está conectado a WhatsApp` });
    }

    const cleanNum = to.replace(/\D/g, '');
    const jid = to.includes('@') ? to : `${cleanNum}@s.whatsapp.net`;

    await inst.sock.sendMessage(jid, { text });
    res.json({ ok: true, message: 'Mensaje enviado exitosamente' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Servir la aplicación SPA para cualquier ruta no-API
app.get('*', (req, res) => {
  const possiblePaths = [
    path.join(publicDir, 'index.html'),
    path.join(process.cwd(), 'src', 'web', 'public', 'index.html')
  ];
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        return res.sendFile(p);
      }
    } catch {}
  }
  res.status(200).send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etho Multi-Bot Hub</title></head><body style="background:#0b0f19;color:#fff;font-family:sans-serif;padding:2rem;"><h1>Etho Multi-Bot Hub</h1><p>Panel en línea. Recarga en unos segundos.</p></body></html>');
});

// Captura de errores global de Express para evitar fallos de función en Vercel
app.use((err, req, res, next) => {
  console.error('[Global Express Error]:', err?.message || err);
  if (!res.headersSent) {
    res.status(500).json({
      ok: false,
      error: err?.message || 'Error interno',
      vercel: Boolean(process.env.VERCEL)
    });
  }
});

export function startServer(customPort = null) {
  const p = Number(customPort || process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  return new Promise((resolve, reject) => {
    const server = app.listen(p, host, () => {
      console.log(`\n======================================================`);
      console.log(`[SERVIDOR] PANEL DE CONTROL DISPONIBLE: http://${host}:${p}`);
      console.log(`======================================================\n`);
      resolve(server);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n[ERROR] El puerto ${p} ya está ocupado por otra instancia del servidor.`);
        console.error(`Cierra la consola anterior antes de iniciar una nueva instancia o configura otro puerto en .env.\n`);
      }
      reject(err);
    });
  });
}

