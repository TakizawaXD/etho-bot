// Utilidades de autenticación: secreto persistente, tokens firmados y límite de intentos de login.
// Solo usa módulos nativos de Node.js (sin dependencias externas).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Valores públicos conocidos (de .env.example o de versiones anteriores): nunca son secretos válidos.
const INSECURE_SECRETS = new Set([
  'cambia_esta_clave_secreta_en_produccion_2026',
  'etho_master_auth_secret_key_2026',
]);

/**
 * Devuelve el secreto para firmar tokens.
 * 1) AUTH_SECRET del entorno (si no es un valor público conocido).
 * 2) Un secreto aleatorio guardado en <dataDir>/.auth_secret (se crea en el primer arranque).
 */
export function resolveAuthSecret(envSecret, dataDir) {
  const fromEnv = (envSecret || '').trim();
  if (fromEnv && !INSECURE_SECRETS.has(fromEnv)) return fromEnv;
  if (fromEnv) console.warn('[Auth] ⚠️ AUTH_SECRET usa un valor público conocido; se ignora y se usa un secreto aleatorio.');

  const file = path.join(dataDir, '.auth_secret');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved.length >= 32) return saved;
  } catch { /* aún no existe */ }

  const generated = crypto.randomBytes(48).toString('hex');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, generated, { mode: 0o600 });
    console.warn(`[Auth] AUTH_SECRET no definido: se generó un secreto aleatorio en ${file}`);
  } catch (e) {
    console.warn('[Auth] No se pudo guardar el secreto; las sesiones se cerrarán al reiniciar:', e.message);
  }
  return generated;
}

export function createTokenTools(secret, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  const sign = (payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

  function generateToken(user) {
    const payload = Buffer.from(JSON.stringify({
      id: user.id, username: user.username, role: user.role, name: user.name,
      v: Number(user.token_version) || 0,   // versión de sesión: subirla en la DB revoca este token
      exp: Date.now() + ttlMs,
    })).toString('base64url');
    return `${payload}.${sign(payload)}`;
  }

  function verifyToken(token) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadStr, signature] = parts;
    const a = Buffer.from(signature);
    const b = Buffer.from(sign(payloadStr));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      const payload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString('utf8'));
      if (!payload.exp || Date.now() > payload.exp) return null;
      return payload;
    } catch {
      return null;
    }
  }

  return { generateToken, verifyToken };
}

/** Limitador simple en memoria: bloquea tras `max` fallos dentro de `windowMs`. */
export function createLoginLimiter({ max = 8, windowMs = 15 * 60 * 1000 } = {}) {
  const hits = new Map(); // key -> { count, first }
  const prune = () => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.first > windowMs) hits.delete(k);
  };
  setInterval(prune, windowMs).unref?.();
  return {
    isBlocked(key) {
      const v = hits.get(key);
      if (!v) return 0;
      if (Date.now() - v.first > windowMs) { hits.delete(key); return 0; }
      return v.count >= max ? Math.ceil((v.first + windowMs - Date.now()) / 1000) : 0;
    },
    fail(key) {
      const v = hits.get(key);
      if (!v || Date.now() - v.first > windowMs) hits.set(key, { count: 1, first: Date.now() });
      else v.count++;
    },
    reset(key) { hits.delete(key); },
  };
}

/** Limitador de ventana fija por clave (IP, usuario...). `hit` devuelve 0 si pasa o los segundos de espera. */
export function createRateLimiter({ windowMs = 60 * 1000, max = 300 } = {}) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs).unref?.();
  return {
    hit(key) {
      const now = Date.now();
      let v = hits.get(key);
      if (!v || now - v.start > windowMs) { v = { start: now, count: 0 }; hits.set(key, v); }
      v.count++;
      return v.count <= max ? 0 : Math.ceil((v.start + windowMs - now) / 1000);
    },
  };
}

export const rateLimitMiddleware = (limiter, { key = (req) => req.ip, message = 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' } = {}) =>
  (req, res, next) => {
    const wait = limiter.hit(key(req));
    if (!wait) return next();
    res.set('Retry-After', String(wait));
    return res.status(429).json({ ok: false, error: message });
  };
