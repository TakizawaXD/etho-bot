// Capa de datos (SQLite nativo Node.js sin dependencias nativas). Todas las consultas usan parámetros preparados.
let DatabaseSync = null;
try {
  const sqliteMod = await import('node:sqlite');
  DatabaseSync = sqliteMod.DatabaseSync;
} catch (e) {
  console.warn('[db] node:sqlite no está disponible en este entorno de Node.js:', e?.message || e);
}

import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import {
  syncUser as supaSyncUser, syncGroup as supaSyncGroup, syncBot as supaSyncBot,
  logActivity as supaLogActivity, syncCustomFunction as supaSyncCustomFn,
  deleteCustomFunction as supaDeleteCustomFn, syncLead as supaSyncLead,
  deleteLead as supaDeleteLead, syncProduct as supaSyncProduct,
  deleteProduct as supaDeleteProduct, syncPlatformUser as supaSyncPlatformUser,
  deletePlatformUserFromSupabase as supaDeletePlatformUser
} from './lib/supabase.js';

class SQLiteWrapper {
  constructor(filePath) {
    if (DatabaseSync) {
      try {
        this._db = new DatabaseSync(filePath);
        return;
      } catch (err) {
        console.warn('[db] No se pudo abrir SQLite en', filePath, err.message);
        try {
          this._db = new DatabaseSync('/tmp/bot.db');
          return;
        } catch {
          try {
            this._db = new DatabaseSync(':memory:');
            return;
          } catch {}
        }
      }
    }
    // Fallback seguro en memoria si node:sqlite no existe en el runtime (ej: serverless)
    this._db = null;
  }
  pragma(sql) {
    if (!this._db) return null;
    try { return this._db.exec(`PRAGMA ${sql}`); } catch { return null; }
  }
  exec(sql) {
    if (!this._db) return null;
    try { return this._db.exec(sql); } catch { return null; }
  }
  prepare(sql) {
    if (!this._db) {
      const safeRow = new Proxy({}, {
        get: (t, p) => (p === 'c' ? 0 : (p === 'qty' ? 0 : null))
      });
      return {
        run: () => ({ changes: 0, lastInsertRowid: 0 }),
        get: () => safeRow,
        all: () => []
      };
    }
    const stmt = this._db.prepare(sql);
    return {
      run(...args) {
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
          return stmt.run(args[0]);
        }
        return stmt.run(...args);
      },
      get(...args) {
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
          return stmt.get(args[0]);
        }
        return stmt.get(...args);
      },
      all(...args) {
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
          return stmt.all(args[0]);
        }
        return stmt.all(...args);
      }
    };
  }
  transaction(fn) {
    return (...args) => {
      if (this._db) {
        try { this._db.exec('BEGIN'); } catch {}
      }
      try {
        const result = fn(...args);
        if (this._db) {
          try { this._db.exec('COMMIT'); } catch {}
        }
        return result;
      } catch (err) {
        if (this._db) {
          try { this._db.exec('ROLLBACK'); } catch {}
        }
        throw err;
      }
    };
  }
  close() {
    if (this._db) return this._db.close();
  }
}

try {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
} catch (e) {
  config.dbPath = '/tmp/bot.db';
  try { fs.mkdirSync('/tmp', { recursive: true }); } catch {}
}

export const db = new SQLiteWrapper(config.dbPath);
try {
  db.pragma('journal_mode = WAL');
} catch (e) {
  // En algunos entornos serverless WAL no está soportado en memoria/tmp
  try { db.pragma('journal_mode = DELETE'); } catch {}
}

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  jid TEXT PRIMARY KEY,
  coins INTEGER DEFAULT 0, bank INTEGER DEFAULT 0,
  exp INTEGER DEFAULT 0, last_exp INTEGER DEFAULT 0,
  description TEXT, birth TEXT, genre TEXT, partner TEXT, fav INTEGER,
  claim_msg TEXT, sticker_pack TEXT, sticker_author TEXT,
  streak INTEGER DEFAULT 0,
  last_daily INTEGER DEFAULT 0, last_work INTEGER DEFAULT 0,
  last_crime INTEGER DEFAULT 0, last_steal INTEGER DEFAULT 0, last_vote INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS groups(
  jid TEXT PRIMARY KEY,
  welcome INTEGER DEFAULT 0, goodbye INTEGER DEFAULT 0,
  welcome_msg TEXT, goodbye_msg TEXT,
  antilink INTEGER DEFAULT 0, economy INTEGER DEFAULT 1, gacha INTEGER DEFAULT 1,
  nsfw INTEGER DEFAULT 0, onlyadmin INTEGER DEFAULT 0, bot_on INTEGER DEFAULT 1,
  warn_limit INTEGER DEFAULT 3
);
CREATE TABLE IF NOT EXISTS warns(
  id INTEGER PRIMARY KEY AUTOINCREMENT, group_jid TEXT, jid TEXT, reason TEXT, ts INTEGER
);
CREATE TABLE IF NOT EXISTS msg_daily(
  group_jid TEXT, jid TEXT, day TEXT, count INTEGER DEFAULT 0,
  PRIMARY KEY(group_jid, jid, day)
);
CREATE TABLE IF NOT EXISTS marriages(
  id INTEGER PRIMARY KEY AUTOINCREMENT, a TEXT, b TEXT, started INTEGER, ended INTEGER
);
CREATE TABLE IF NOT EXISTS characters(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, series TEXT, gender TEXT,
  value INTEGER DEFAULT 100, image TEXT, votes INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS claims(
  char_id INTEGER, group_jid TEXT, owner TEXT, price INTEGER,
  PRIMARY KEY(char_id, group_jid)
);
CREATE TABLE IF NOT EXISTS packs(
  id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT, name TEXT, description TEXT,
  public INTEGER DEFAULT 0, slug TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS pack_stickers(
  id INTEGER PRIMARY KEY AUTOINCREMENT, pack_id INTEGER, hash TEXT, data BLOB
);
CREATE TABLE IF NOT EXISTS pack_favs(jid TEXT, pack_id INTEGER, PRIMARY KEY(jid, pack_id));
CREATE TABLE IF NOT EXISTS interactions(action TEXT, a TEXT, b TEXT, count INTEGER DEFAULT 0, PRIMARY KEY(action, a, b));
CREATE TABLE IF NOT EXISTS inventory(jid TEXT, item TEXT, qty INTEGER DEFAULT 0, PRIMARY KEY(jid, item));
CREATE TABLE IF NOT EXISTS cooldowns(jid TEXT, key TEXT, ts INTEGER, PRIMARY KEY(jid, key));
CREATE TABLE IF NOT EXISTS reminders(id INTEGER PRIMARY KEY AUTOINCREMENT, jid TEXT, chat TEXT, text TEXT, at INTEGER);
CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY AUTOINCREMENT, jid TEXT, text TEXT, ts INTEGER);

-- Tablas del Sistema Multi-Bot y Panel de Control
CREATE TABLE IF NOT EXISTS bots(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  prefix TEXT DEFAULT '#',
  status TEXT DEFAULT 'offline',
  qr_code TEXT,
  pairing_code TEXT,
  is_active INTEGER DEFAULT 1,
  personality TEXT DEFAULT 'recreational',
  system_prompt TEXT,
  ai_auto_reply INTEGER DEFAULT 0,
  settings TEXT DEFAULT '{}',
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS bot_logs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT,
  type TEXT,
  chat_jid TEXT,
  sender_jid TEXT,
  sender_name TEXT,
  content TEXT,
  details TEXT DEFAULT '{}',
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS bot_custom_functions(
  id TEXT PRIMARY KEY,
  bot_id TEXT DEFAULT 'all',
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT DEFAULT 'command',
  trigger_value TEXT NOT NULL,
  response_text TEXT NOT NULL,
  response_type TEXT DEFAULT 'text',
  is_enabled INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Tablas Avanzadas: CRM Leads, Catálogo, Pausas de Chat (Humano) y Base de Conocimiento
CREATE TABLE IF NOT EXISTS bot_leads(
  id TEXT PRIMARY KEY,
  bot_id TEXT DEFAULT 'all',
  name TEXT,
  phone TEXT,
  email TEXT,
  interest TEXT,
  notes TEXT,
  status TEXT DEFAULT 'nuevo',
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS bot_products(
  id TEXT PRIMARY KEY,
  bot_id TEXT DEFAULT 'all',
  name TEXT NOT NULL,
  description TEXT,
  price REAL DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  image_url TEXT,
  category TEXT DEFAULT 'General',
  is_active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS bot_chat_pauses(
  chat_jid TEXT,
  bot_id TEXT,
  paused_until INTEGER,
  reason TEXT,
  PRIMARY KEY(chat_jid, bot_id)
);

CREATE TABLE IF NOT EXISTS bot_knowledge(
  id TEXT PRIMARY KEY,
  bot_id TEXT DEFAULT 'all',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'FAQ',
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Tablas de Usuarios del Sistema y Roles (Admin / Usuario)
CREATE TABLE IF NOT EXISTS platform_users(
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  whatsapp TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Tablas del Sistema de Reglas y Moderación Activa
CREATE TABLE IF NOT EXISTS system_rules(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  penalty_days INTEGER DEFAULT 2,
  severity TEXT DEFAULT 'alta',
  is_active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS bot_moderation_logs(
  id TEXT PRIMARY KEY,
  bot_id TEXT,
  rule_broken TEXT,
  severity TEXT DEFAULT 'warning',
  details TEXT,
  penalized_days INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Memoria Conversacional Persistente por Chat
CREATE TABLE IF NOT EXISTS bot_conversations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  chat_jid TEXT NOT NULL,
  sender_jid TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_bot_conv_chat ON bot_conversations(bot_id, chat_jid, created_at DESC);

-- Base de Hechos & Aprendizaje Continuo por Usuario (Nombre, Empresa, Preferencias)
CREATE TABLE IF NOT EXISTS bot_user_facts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  user_jid TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  UNIQUE(bot_id, user_jid, fact_key)
);

-- Recados y Mensajes recibidos mientras la IA habla por el dueño (Modo Piloto Automático)
CREATE TABLE IF NOT EXISTS bot_recados(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  chat_jid TEXT NOT NULL,
  sender_name TEXT,
  sender_phone TEXT,
  message TEXT NOT NULL,
  ai_reply TEXT,
  is_read INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);
`);

// Migraciones ligeras (columnas añadidas después de la v1)
for (const [t, col, def] of [
  ['users', 'afk_reason', 'TEXT'], ['users', 'afk_since', 'INTEGER'], ['users', 'banned', 'INTEGER DEFAULT 0'],
  ['groups', 'antispam', 'INTEGER DEFAULT 0'], ['groups', 'rules', 'TEXT'],
  ['bots', 'personality', "TEXT DEFAULT 'recreational'"],
  ['bots', 'system_prompt', 'TEXT'],
  ['bots', 'ai_auto_reply', 'INTEGER DEFAULT 0'],
  ['bots', 'owner_id', "TEXT DEFAULT 'admin'"],
  ['bots', 'purpose', "TEXT DEFAULT ''"],
  ['bots', 'expires_at', "INTEGER DEFAULT 0"],
  ['bots', 'payment_status', "TEXT DEFAULT 'trial'"],
  ['bots', 'plan', "TEXT DEFAULT 'prueba'"],
  ['bots', 'penalty_until', "INTEGER DEFAULT 0"],
  ['bots', 'penalty_reason', "TEXT DEFAULT ''"],
  ['bots', 'penalty_days', "INTEGER DEFAULT 0"],
  ['bots', 'strikes', "INTEGER DEFAULT 0"],
  ['bots', 'last_strike_at', "INTEGER DEFAULT 0"],
  ['bots', 'auto_pilot', "INTEGER DEFAULT 1"],
  ['bots', 'pilot_persona', "TEXT DEFAULT 'as_assistant'"],
  ['bots', 'pilot_context', "TEXT DEFAULT ''"],
  ['bots', 'owner_name', "TEXT DEFAULT ''"],
]) { try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${def}`); } catch { /* ya existe */ } }

// Asegurar que los bots actúen por defecto como asesor/ayudante en privado si tenían el valor antiguo
try {
  db.exec("UPDATE bots SET pilot_persona = 'as_assistant', auto_pilot = 1 WHERE pilot_persona IS NULL OR pilot_persona = '' OR pilot_persona = 'as_me'");
} catch { /* ignorar */ }

// Semilla de Reglas de Moderación (si la tabla está vacía)
try {
  if (db.prepare('SELECT COUNT(*) c FROM system_rules').get().c === 0) {
    const defaultRules = [
      { id: 'rule_antispam', title: 'Cero Flood & Spam Masivo', description: 'Queda estrictamente prohibido programar o saturar grupos y chats con ráfagas continuas de mensajes automáticos o comandos reiterados. Máximo permitido: 6 interacciones por 5 segundos.', penalty_days: 2, severity: 'alta' },
      { id: 'rule_antiscam', title: 'Prohibido Phishing, Fraudes y Enlaces Maliciosos', description: 'Tolerancia cero con el uso de bots para estafas, difusión de esquemas piramidales, captación engañosa de contraseñas, clonación de identidades bancarias o malware.', penalty_days: 7, severity: 'crítica' },
      { id: 'rule_respect', title: 'Prohibido Contenido Ilícito, Acoso u Odio', description: 'No se permite configurar el bot con prompts o respuestas que promuevan violencia, difamación, acoso a personas, material no consentido o actividades fuera del marco legal.', penalty_days: 5, severity: 'crítica' },
      { id: 'rule_commercial_consent', title: 'Consentimiento en Mensajería Comercial', description: 'Los bots comerciales y de ventas deben responder únicamente a usuarios que hayan iniciado contacto previo o solicitado información comercial de forma consentida.', penalty_days: 3, severity: 'media' }
    ];
    const ins = db.prepare('INSERT OR IGNORE INTO system_rules(id, title, description, penalty_days, severity, is_active, created_at) VALUES(?,?,?,?,?,1,?)');
    const now = Date.now();
    for (const r of defaultRules) {
      ins.run(r.id, r.title, r.description, r.penalty_days, r.severity, now);
    }
  }
} catch (e) {
  console.warn('[db] Error sembrando system_rules:', e.message);
}

export const getCd = (jid, key) => db.prepare('SELECT ts FROM cooldowns WHERE jid=? AND key=?').get(jid, key)?.ts || 0;
export const setCd = (jid, key) => db.prepare('INSERT INTO cooldowns(jid,key,ts) VALUES(?,?,?) ON CONFLICT(jid,key) DO UPDATE SET ts=excluded.ts').run(jid, key, Date.now());
export const getItem = (jid, item) => db.prepare('SELECT qty FROM inventory WHERE jid=? AND item=?').get(jid, item)?.qty || 0;
export const addItem = (jid, item, n) => {
  db.prepare('INSERT INTO inventory(jid,item,qty) VALUES(?,?,?) ON CONFLICT(jid,item) DO UPDATE SET qty=qty+excluded.qty').run(jid, item, n);
  db.prepare('DELETE FROM inventory WHERE jid=? AND item=? AND qty<=0').run(jid, item);
};

// Semilla de personajes (solo si la tabla está vacía)
try {
  if (db.prepare('SELECT COUNT(*) c FROM characters').get().c === 0) {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'characters.json');
    if (fs.existsSync(file)) {
      const list = JSON.parse(fs.readFileSync(file, 'utf8'));
      const ins = db.prepare('INSERT OR IGNORE INTO characters(name,series,gender,value,image) VALUES(?,?,?,?,?)');
      db.transaction(() => list.forEach((c) => ins.run(c.name, c.series, c.gender, c.value, c.image)))();
    }
  }
} catch (e) {
  console.warn('[db] No se pudo cargar semilla de personajes:', e.message);
}

export function getUser(jid) {
  db.prepare('INSERT OR IGNORE INTO users(jid) VALUES(?)').run(jid);
  return db.prepare('SELECT * FROM users WHERE jid=?').get(jid);
}

export function setUser(jid, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(`UPDATE users SET ${keys.map((k) => `${k}=@${k}`).join(',')} WHERE jid=@jid`).run({ ...fields, jid });
  supaSyncUser(jid, fields);
}

export function bumpInteraction(action, x, y) {
  const [a, b] = [x, y].sort();
  db.prepare(`INSERT INTO interactions(action,a,b,count) VALUES(?,?,?,1)
    ON CONFLICT(action,a,b) DO UPDATE SET count=count+1`).run(action, a, b);
  return db.prepare('SELECT count FROM interactions WHERE action=? AND a=? AND b=?').get(action, a, b).count;
}

export function getGroup(jid) {
  db.prepare('INSERT OR IGNORE INTO groups(jid) VALUES(?)').run(jid);
  return db.prepare('SELECT * FROM groups WHERE jid=?').get(jid);
}

export function setGroup(jid, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(`UPDATE groups SET ${keys.map((k) => `${k}=@${k}`).join(',')} WHERE jid=@jid`).run({ ...fields, jid });
  supaSyncGroup(jid, fields);
}

// ==========================================
// FUNCIONES PARA MULTI-BOT, LOGS Y REGLAS
// ==========================================

export function formatBotRow(b) {
  if (!b) return null;
  const expiresAt = Number(b.expires_at) || 0;
  const penaltyUntil = Number(b.penalty_until) || 0;
  const now = Date.now();
  let isExpired = false;
  let remainingMs = 0;

  if (expiresAt > 0 && b.payment_status !== 'paid') {
    if (now > expiresAt) {
      isExpired = true;
    } else {
      remainingMs = expiresAt - now;
    }
  }

  const isPenalized = penaltyUntil > now;
  const penaltyRemainingMs = isPenalized ? penaltyUntil - now : 0;
  const penaltyRemainingHours = Math.ceil(penaltyRemainingMs / (3600 * 1000));
  const penaltyRemainingDays = Math.ceil(penaltyRemainingMs / (24 * 3600 * 1000));

  const paymentStatus = b.payment_status || (expiresAt === 0 ? 'paid' : (isExpired ? 'expired' : 'trial'));

  return {
    ...b,
    owner_id: b.owner_id || 'admin',
    purpose: b.purpose || '',
    expires_at: expiresAt,
    payment_status: paymentStatus,
    plan: b.plan || 'prueba',
    is_active: Boolean(b.is_active),
    ai_auto_reply: Boolean(b.ai_auto_reply),
    personality: b.personality || 'recreational',
    settings: safeJsonParse(b.settings, {}),
    isExpired: paymentStatus === 'suspended' || isExpired,
    remainingMs,
    penalty_until: penaltyUntil,
    penalty_reason: b.penalty_reason || '',
    penalty_days: Number(b.penalty_days) || 0,
    strikes: Number(b.strikes) || 0,
    last_strike_at: Number(b.last_strike_at) || 0,
    isPenalized,
    penaltyRemainingMs,
    penaltyRemainingHours,
    penaltyRemainingDays,
    auto_pilot: b.auto_pilot !== undefined ? Boolean(b.auto_pilot) : true,
    pilot_persona: b.pilot_persona || 'as_assistant',
    pilot_context: b.pilot_context || '',
    owner_name: b.owner_name || '',
    owner_display_name: (b.owner_name && b.owner_name.trim())
      || (b.owner_id ? db.prepare('SELECT name FROM platform_users WHERE id=?').get(b.owner_id)?.name : '')
      || ''
  };
}

export function listBots(ownerId = null, role = 'admin') {
  let query = 'SELECT * FROM bots';
  const params = [];
  if (role !== 'admin' && ownerId) {
    query += ' WHERE owner_id=?';
    params.push(ownerId);
  }
  query += ' ORDER BY created_at ASC';
  return db.prepare(query).all(...params).map(b => formatBotRow(b));
}

export function getBot(id) {
  let row = db.prepare('SELECT * FROM bots WHERE id=?').get(id);
  if (!row && typeof id === 'string') {
    const clean = id.replace('bot_', '');
    row = db.prepare('SELECT * FROM bots WHERE phone=? OR id LIKE ?').get(clean, `%${clean}%`);
  }
  if (!row) return null;
  return formatBotRow(row);
}

export function upsertBot(botData) {
  const now = Date.now();
  const existing = getBot(botData.id);
  const data = {
    id: botData.id,
    name: botData.name || (existing ? existing.name : 'Bot WhatsApp'),
    phone: botData.phone !== undefined ? botData.phone : (existing?.phone || ''),
    prefix: botData.prefix || existing?.prefix || '#',
    status: botData.status || existing?.status || 'offline',
    qr_code: botData.qr_code !== undefined ? botData.qr_code : (existing?.qr_code || null),
    pairing_code: botData.pairing_code !== undefined ? botData.pairing_code : (existing?.pairing_code || null),
    is_active: botData.is_active !== undefined ? (botData.is_active ? 1 : 0) : (existing?.is_active ? 1 : 1),
    personality: botData.personality || existing?.personality || 'recreational',
    system_prompt: botData.system_prompt !== undefined ? botData.system_prompt : (existing?.system_prompt || null),
    ai_auto_reply: botData.ai_auto_reply !== undefined ? (botData.ai_auto_reply ? 1 : 0) : (existing?.ai_auto_reply ? 1 : 0),
    owner_id: botData.owner_id || existing?.owner_id || 'admin',
    purpose: botData.purpose !== undefined ? botData.purpose : (existing?.purpose || ''),
    expires_at: botData.expires_at !== undefined ? Number(botData.expires_at) : (existing?.expires_at !== undefined ? Number(existing.expires_at) : 0),
    payment_status: botData.payment_status || existing?.payment_status || 'trial',
    plan: botData.plan || existing?.plan || 'prueba',
    penalty_until: botData.penalty_until !== undefined ? Number(botData.penalty_until) : (existing?.penalty_until || 0),
    penalty_reason: botData.penalty_reason !== undefined ? botData.penalty_reason : (existing?.penalty_reason || ''),
    penalty_days: botData.penalty_days !== undefined ? Number(botData.penalty_days) : (existing?.penalty_days || 0),
    strikes: botData.strikes !== undefined ? Number(botData.strikes) : (existing?.strikes || 0),
    last_strike_at: botData.last_strike_at !== undefined ? Number(botData.last_strike_at) : (existing?.last_strike_at || 0),
    auto_pilot: botData.auto_pilot !== undefined ? (botData.auto_pilot ? 1 : 0) : (existing?.auto_pilot !== undefined ? (existing.auto_pilot ? 1 : 0) : 1),
    pilot_persona: botData.pilot_persona || existing?.pilot_persona || 'as_assistant',
    pilot_context: botData.pilot_context !== undefined ? botData.pilot_context : (existing?.pilot_context || ''),
    owner_name: botData.owner_name !== undefined ? botData.owner_name : (existing?.owner_name || ''),
    settings: typeof botData.settings === 'object' ? JSON.stringify(botData.settings) : (existing?.settings ? JSON.stringify(existing.settings) : '{}'),
    updated_at: now
  };

  if (!existing) {
    data.created_at = now;
    db.prepare(`
      INSERT INTO bots (id, name, phone, prefix, status, qr_code, pairing_code, is_active, personality, system_prompt, ai_auto_reply, owner_id, purpose, expires_at, payment_status, plan, penalty_until, penalty_reason, penalty_days, strikes, last_strike_at, auto_pilot, pilot_persona, pilot_context, owner_name, settings, created_at, updated_at)
      VALUES (@id, @name, @phone, @prefix, @status, @qr_code, @pairing_code, @is_active, @personality, @system_prompt, @ai_auto_reply, @owner_id, @purpose, @expires_at, @payment_status, @plan, @penalty_until, @penalty_reason, @penalty_days, @strikes, @last_strike_at, @auto_pilot, @pilot_persona, @pilot_context, @owner_name, @settings, @created_at, @updated_at)
    `).run(data);
  } else {
    db.prepare(`
      UPDATE bots SET
        name=@name, phone=@phone, prefix=@prefix, status=@status,
        qr_code=@qr_code, pairing_code=@pairing_code, is_active=@is_active,
        personality=@personality, system_prompt=@system_prompt, ai_auto_reply=@ai_auto_reply,
        owner_id=@owner_id, purpose=@purpose, expires_at=@expires_at, payment_status=@payment_status, plan=@plan,
        penalty_until=@penalty_until, penalty_reason=@penalty_reason, penalty_days=@penalty_days, strikes=@strikes, last_strike_at=@last_strike_at,
        auto_pilot=@auto_pilot, pilot_persona=@pilot_persona, pilot_context=@pilot_context, owner_name=@owner_name,
        settings=@settings, updated_at=@updated_at
      WHERE id=@id
    `).run(data);
  }

  const updated = getBot(data.id);
  supaSyncBot(updated);
  return updated;
}

export function setBotStatus(id, status, qr = null, pairingCode = null) {
  const existing = getBot(id);
  if (!existing) return;
  const now = Date.now();
  db.prepare('UPDATE bots SET status=?, qr_code=?, pairing_code=?, updated_at=? WHERE id=?')
    .run(status, qr, pairingCode, now, id);
  const updated = getBot(id);
  supaSyncBot(updated);
}

export function deleteBot(id) {
  db.prepare('DELETE FROM bots WHERE id=?').run(id);
  db.prepare('DELETE FROM bot_logs WHERE bot_id=?').run(id);
  db.prepare('DELETE FROM bot_moderation_logs WHERE bot_id=?').run(id);
}

// ==========================================
// SISTEMA DE REGLAS Y MODERACIÓN ACTIVA
// ==========================================

export function penalizeBot(botId, days = 2, reason = 'Infracción a las reglas de moderación', deductDays = true) {
  const bot = getBot(botId);
  if (!bot) return null;

  const penaltyDaysNum = Math.max(1, Number(days) || 2);
  const penaltyMs = penaltyDaysNum * 24 * 60 * 60 * 1000;
  const penaltyUntil = Date.now() + penaltyMs;
  let newExpiresAt = Number(bot.expires_at) || 0;

  // Si tiene suscripción temporal activa, penalizar descontando esos días de su cuenta
  if (deductDays && newExpiresAt > Date.now()) {
    newExpiresAt = Math.max(Date.now(), newExpiresAt - penaltyMs);
  }

  const now = Date.now();
  db.prepare(`
    UPDATE bots SET
      penalty_until = ?,
      penalty_reason = ?,
      penalty_days = ?,
      strikes = strikes + 1,
      last_strike_at = ?,
      expires_at = ?,
      is_active = 0,
      status = 'stopped',
      updated_at = ?
    WHERE id = ?
  `).run(penaltyUntil, reason, penaltyDaysNum, now, newExpiresAt, now, bot.id);

  addModerationLog({
    botId: bot.id,
    rule_broken: reason,
    severity: 'penalty',
    details: `Bot suspendido y penalizado con ${penaltyDaysNum} día(s). Descuento de suscripción aplicado: ${deductDays ? 'Sí' : 'No'}.`,
    penalized_days: penaltyDaysNum
  });

  addBotLog({
    botId: bot.id,
    type: 'moderation',
    content: `⛔ BOT PENALIZADO: Suspendido por ${penaltyDaysNum} día(s) por "${reason}".`
  });

  return getBot(bot.id);
}

export function pardonBot(botId) {
  const bot = getBot(botId);
  if (!bot) return null;

  const now = Date.now();
  db.prepare(`
    UPDATE bots SET
      penalty_until = 0,
      penalty_reason = '',
      penalty_days = 0,
      strikes = 0,
      updated_at = ?
    WHERE id = ?
  `).run(now, bot.id);

  addModerationLog({
    botId: bot.id,
    rule_broken: 'Indulto otorgado por Administrador',
    severity: 'pardon',
    details: `El administrador levantó la penalización y restauró el bot a estado regular.`,
    penalized_days: 0
  });

  addBotLog({
    botId: bot.id,
    type: 'moderation',
    content: `🕊️ Penalización levantada por el Administrador. El bot ya puede ser encendido.`
  });

  return getBot(bot.id);
}

export function addModerationStrike(botId, rule, details = '') {
  const bot = getBot(botId);
  if (!bot) return null;

  const currentStrikes = (Number(bot.strikes) || 0) + 1;
  const now = Date.now();

  addModerationLog({
    botId: bot.id,
    rule_broken: rule,
    severity: currentStrikes >= 3 ? 'penalty' : 'strike',
    details: details || `Infracción detectada (Strike ${currentStrikes}/3).`,
    penalized_days: currentStrikes >= 3 ? 3 : 0
  });

  if (currentStrikes >= 3) {
    return penalizeBot(bot.id, 3, `Límite de infracciones superado (3/3 strikes): ${rule}`, true);
  }

  db.prepare(`
    UPDATE bots SET strikes = ?, last_strike_at = ?, updated_at = ? WHERE id = ?
  `).run(currentStrikes, now, now, bot.id);

  addBotLog({
    botId: bot.id,
    type: 'moderation',
    content: `⚠️ Advertencia de Moderación (Strike ${currentStrikes}/3): ${rule}`
  });

  return getBot(bot.id);
}

export function addModerationLog({ botId = 'all', rule_broken, severity = 'warning', details = '', penalized_days = 0 }) {
  const id = `mod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO bot_moderation_logs (id, bot_id, rule_broken, severity, details, penalized_days, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, botId, rule_broken, severity, details, penalized_days, now);
  return { id, bot_id: botId, rule_broken, severity, details, penalized_days, created_at: now };
}

export function listModerationLogs({ botId = null, limit = 50 } = {}) {
  let query = 'SELECT * FROM bot_moderation_logs WHERE 1=1';
  const params = [];
  if (botId && botId !== 'all') {
    query += " AND (bot_id=? OR bot_id='all')";
    params.push(botId);
  }
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(query).all(...params);
}

export function getSystemRules() {
  return db.prepare('SELECT * FROM system_rules ORDER BY created_at ASC').all();
}

export function updateSystemRule(id, { title, description, penalty_days, severity, is_active }) {
  const existing = db.prepare('SELECT * FROM system_rules WHERE id=?').get(id);
  if (!existing) return null;
  db.prepare(`
    UPDATE system_rules SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      penalty_days = COALESCE(?, penalty_days),
      severity = COALESCE(?, severity),
      is_active = COALESCE(?, is_active)
    WHERE id = ?
  `).run(title, description, penalty_days, severity, is_active, id);
  return db.prepare('SELECT * FROM system_rules WHERE id=?').get(id);
}

export function addBotLog({ botId, type, chatJid = '', senderJid = '', senderName = '', content = '', details = {} }) {
  const now = Date.now();
  const detStr = typeof details === 'object' ? JSON.stringify(details) : String(details);
  db.prepare(`
    INSERT INTO bot_logs (bot_id, type, chat_jid, sender_jid, sender_name, content, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(botId || 'default', type, chatJid, senderJid, senderName, content, detStr, now);

  supaLogActivity({
    botId: botId || 'default',
    type,
    chatJid,
    senderJid,
    senderName,
    content,
    details
  });
}

export function getBotLogs({ limit = 100, botId = null, type = null, search = '' } = {}) {
  let query = 'SELECT * FROM bot_logs WHERE 1=1';
  const params = [];
  if (botId && botId !== 'all') {
    query += ' AND bot_id=?';
    params.push(botId);
  }
  if (type && type !== 'all') {
    query += ' AND type=?';
    params.push(type);
  }
  if (search) {
    query += ' AND (content LIKE ? OR sender_name LIKE ? OR chat_jid LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY id DESC LIMIT ?';
  params.push(limit);

  return db.prepare(query).all(...params).map(l => ({
    ...l,
    details: safeJsonParse(l.details, {})
  }));
}

export function listCustomFunctions(botId = null) {
  let query = 'SELECT * FROM bot_custom_functions WHERE 1=1';
  const params = [];
  if (botId && botId !== 'all') {
    query += " AND (bot_id=? OR bot_id='all')";
    params.push(botId);
  }
  query += ' ORDER BY created_at DESC';
  return db.prepare(query).all(...params).map(f => ({
    ...f,
    is_enabled: Boolean(f.is_enabled)
  }));
}

export function getCustomFunction(id) {
  const row = db.prepare('SELECT * FROM bot_custom_functions WHERE id=?').get(id);
  if (!row) return null;
  return { ...row, is_enabled: Boolean(row.is_enabled) };
}

export function upsertCustomFunction(fn) {
  const now = Date.now();
  const id = fn.id || `fn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const existing = getCustomFunction(id);
  const data = {
    id,
    bot_id: fn.bot_id || 'all',
    name: fn.name || 'Nueva Función',
    description: fn.description || '',
    trigger_type: fn.trigger_type || 'command',
    trigger_value: (fn.trigger_value || '').toLowerCase().trim(),
    response_text: fn.response_text || '',
    response_type: fn.response_type || 'text',
    is_enabled: fn.is_enabled !== undefined ? (fn.is_enabled ? 1 : 0) : 1,
    created_at: existing ? existing.created_at : now
  };

  if (!existing) {
    db.prepare(`
      INSERT INTO bot_custom_functions (id, bot_id, name, description, trigger_type, trigger_value, response_text, response_type, is_enabled, created_at)
      VALUES (@id, @bot_id, @name, @description, @trigger_type, @trigger_value, @response_text, @response_type, @is_enabled, @created_at)
    `).run(data);
  } else {
    db.prepare(`
      UPDATE bot_custom_functions SET
        bot_id=@bot_id, name=@name, description=@description,
        trigger_type=@trigger_type, trigger_value=@trigger_value,
        response_text=@response_text, response_type=@response_type,
        is_enabled=@is_enabled
      WHERE id=@id
    `).run(data);
  }

  const updated = getCustomFunction(id);
  supaSyncCustomFn(updated);
  return updated;
}

export function deleteCustomFunction(id) {
  db.prepare('DELETE FROM bot_custom_functions WHERE id=?').run(id);
  supaDeleteCustomFn(id);
}

function safeJsonParse(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}


// ==========================================
// CRM LEADS (PROSPECTOS DE CLIENTES)
// ==========================================
export function addLead(lead) {
  const id = lead.id || `lead_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();
  const data = {
    id,
    bot_id: lead.bot_id || 'all',
    name: lead.name || 'Sin nombre',
    phone: lead.phone || '',
    email: lead.email || '',
    interest: lead.interest || '',
    notes: lead.notes || '',
    status: lead.status || 'nuevo',
    created_at: lead.created_at || now
  };
  db.prepare(`
    INSERT INTO bot_leads (id, bot_id, name, phone, email, interest, notes, status, created_at)
    VALUES (@id, @bot_id, @name, @phone, @email, @interest, @notes, @status, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, phone=excluded.phone, email=excluded.email,
      interest=excluded.interest, notes=excluded.notes, status=excluded.status
  `).run(data);
  const updated = db.prepare('SELECT * FROM bot_leads WHERE id=?').get(id);
  supaSyncLead(updated);
  return updated;
}

export function listLeads({ botId = null, status = 'all', search = '' } = {}) {
  let query = 'SELECT * FROM bot_leads WHERE 1=1';
  const params = [];
  if (botId && botId !== 'all') {
    query += " AND (bot_id=? OR bot_id='all')";
    params.push(botId);
  }
  if (status && status !== 'all') {
    query += ' AND status=?';
    params.push(status);
  }
  if (search) {
    query += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ? OR interest LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY created_at DESC';
  return db.prepare(query).all(...params);
}

export function updateLeadStatus(id, status, notes = null) {
  if (notes !== null) {
    db.prepare('UPDATE bot_leads SET status=?, notes=? WHERE id=?').run(status, notes, id);
  } else {
    db.prepare('UPDATE bot_leads SET status=? WHERE id=?').run(status, id);
  }
  const updated = db.prepare('SELECT * FROM bot_leads WHERE id=?').get(id);
  if (updated) supaSyncLead(updated);
  return updated;
}

export function deleteLead(id) {
  db.prepare('DELETE FROM bot_leads WHERE id=?').run(id);
  supaDeleteLead(id);
}

// ==========================================
// CATÁLOGO DE PRODUCTOS / SERVICIOS
// ==========================================
export function addProduct(prod) {
  const id = prod.id || `prod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();
  const data = {
    id,
    bot_id: prod.bot_id || 'all',
    name: prod.name || 'Producto',
    description: prod.description || '',
    price: Number(prod.price) || 0,
    currency: prod.currency || 'USD',
    image_url: prod.image_url || '',
    category: prod.category || 'General',
    is_active: prod.is_active !== undefined ? (prod.is_active ? 1 : 0) : 1,
    created_at: prod.created_at || now
  };
  db.prepare(`
    INSERT INTO bot_products (id, bot_id, name, description, price, currency, image_url, category, is_active, created_at)
    VALUES (@id, @bot_id, @name, @description, @price, @currency, @image_url, @category, @is_active, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, description=excluded.description, price=excluded.price,
      currency=excluded.currency, image_url=excluded.image_url, category=excluded.category,
      is_active=excluded.is_active
  `).run(data);
  const updated = db.prepare('SELECT * FROM bot_products WHERE id=?').get(id);
  supaSyncProduct(updated);
  return { ...updated, is_active: Boolean(updated.is_active) };
}

export function listProducts(botId = null) {
  let query = 'SELECT * FROM bot_products WHERE 1=1';
  const params = [];
  if (botId && botId !== 'all') {
    query += " AND (bot_id=? OR bot_id='all')";
    params.push(botId);
  }
  query += ' ORDER BY category ASC, name ASC';
  return db.prepare(query).all(...params).map(p => ({
    ...p,
    is_active: Boolean(p.is_active)
  }));
}

export function deleteProduct(id) {
  db.prepare('DELETE FROM bot_products WHERE id=?').run(id);
  supaDeleteProduct(id);
}

export function listKnowledge(botId = null) {
  try {
    let query = 'SELECT * FROM bot_knowledge WHERE 1=1';
    const params = [];
    if (botId && botId !== 'all') {
      query += " AND (bot_id=? OR bot_id='all')";
      params.push(botId);
    }
    query += ' ORDER BY created_at DESC LIMIT 30';
    return db.prepare(query).all(...params);
  } catch {
    return [];
  }
}

/**
 * Reúne todo el contexto operativo, comercial y de personalidad de un bot
 * para que la Inteligencia Artificial atienda a los usuarios con máxima preparación.
 */
export function getBotAIContext(botId) {
  const bot = getBot(botId);
  const settings = bot?.settings || {};
  const products = listProducts(botId).filter(p => p.is_active);
  const knowledge = listKnowledge(botId);

  return {
    botId: bot?.id || botId || 'default',
    botName: bot?.name || 'Etho',
    personality: bot?.personality || 'recreational',
    systemPrompt: bot?.system_prompt || null,
    purpose: bot?.purpose || '',
    ownerName: bot?.owner_display_name || bot?.owner_name || 'el titular',
    autoPilot: bot?.auto_pilot !== undefined ? Boolean(bot.auto_pilot) : true,
    pilotPersona: bot?.pilot_persona || 'as_assistant',
    pilotContext: bot?.pilot_context || '',
    tone: settings.tone || 'profesional',
    forbiddenWords: Array.isArray(settings.forbidden_words) ? settings.forbidden_words : [],
    preferredWords: Array.isArray(settings.preferred_words) ? settings.preferred_words : [],
    businessHours: settings.businessHours || null,
    products,
    knowledge
  };
}

// ==========================================
// PAUSAS DE CHAT (TRANSFERENCIA A HUMANO)
// ==========================================
export function isChatPaused(botId, chatJid) {
  const row = db.prepare('SELECT paused_until FROM bot_chat_pauses WHERE chat_jid=? AND bot_id=?').get(chatJid, botId);
  if (!row) return false;
  if (Number(row.paused_until) === 0 || Number(row.paused_until) > Date.now()) return true;
  db.prepare('DELETE FROM bot_chat_pauses WHERE chat_jid=? AND bot_id=?').run(chatJid, botId);
  return false;
}

export function pauseChat(botId, chatJid, minutes = 60, reason = 'Atención humana') {
  const until = (minutes === 0 || minutes === null) ? 0 : (Date.now() + (Number(minutes) * 60 * 1000));
  db.prepare(`
    INSERT INTO bot_chat_pauses (chat_jid, bot_id, paused_until, reason)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(chat_jid, bot_id) DO UPDATE SET paused_until=excluded.paused_until, reason=excluded.reason
  `).run(chatJid, botId, until, reason);
}

export function resumeChat(botId, chatJid) {
  db.prepare('DELETE FROM bot_chat_pauses WHERE chat_jid=? AND bot_id=?').run(chatJid, botId);
}

// ==========================================
// AUTENTICACIÓN & GESTIÓN DE USUARIOS / TENANTS
// ==========================================

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, key] = storedHash.split(':');
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

export function createPlatformUser({ username, password, name, email = '', whatsapp = '', role = 'user' }) {
  const id = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const password_hash = hashPassword(password);
  const now = Date.now();
  db.prepare(`
    INSERT INTO platform_users (id, username, email, password_hash, name, role, whatsapp, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(id, username.toLowerCase().trim(), email.trim(), password_hash, name.trim(), role, whatsapp.trim(), now);
  const user = getPlatformUserById(id);
  if (user) supaSyncPlatformUser({ ...user, password_hash });
  return user;
}

export function getPlatformUserById(id) {
  const user = db.prepare('SELECT id, username, email, name, role, whatsapp, status, created_at FROM platform_users WHERE id=?').get(id);
  return user || null;
}

export function getPlatformUserByUsername(username) {
  const user = db.prepare('SELECT * FROM platform_users WHERE username=?').get(username.toLowerCase().trim());
  return user || null;
}

export function listPlatformUsers() {
  const users = db.prepare('SELECT id, username, email, name, role, whatsapp, status, created_at FROM platform_users ORDER BY created_at DESC').all();
  const allBots = db.prepare('SELECT id, owner_id, status, payment_status FROM bots').all();
  const botsCountMap = new Map();
  for (const b of allBots) {
    const owner = b.owner_id || 'admin';
    botsCountMap.set(owner, (botsCountMap.get(owner) || 0) + 1);
  }
  return users.map(u => ({
    ...u,
    totalBots: botsCountMap.get(u.id) || (u.role === 'admin' ? botsCountMap.get('admin') || 0 : 0)
  }));
}

export function updatePlatformUser(id, fields) {
  const existing = getPlatformUserById(id);
  if (!existing) return null;
  const name = fields.name !== undefined ? fields.name.trim() : existing.name;
  const email = fields.email !== undefined ? fields.email.trim() : existing.email;
  const whatsapp = fields.whatsapp !== undefined ? fields.whatsapp.trim() : existing.whatsapp;
  const status = fields.status !== undefined ? fields.status : existing.status;
  const role = fields.role !== undefined ? fields.role : existing.role;

  db.prepare(`
    UPDATE platform_users SET name=?, email=?, whatsapp=?, status=?, role=? WHERE id=?
  `).run(name, email, whatsapp, status, role, id);
  const updated = getPlatformUserById(id);
  if (updated) supaSyncPlatformUser(updated);
  return updated;
}

export function deletePlatformUser(id) {
  db.prepare('DELETE FROM platform_users WHERE id=?').run(id);
  db.prepare('DELETE FROM bots WHERE owner_id=?').run(id);
  supaDeletePlatformUser(id);
}

export function initDefaultAdmin() {
  const admin = db.prepare("SELECT * FROM platform_users WHERE role='admin'").get();
  if (!admin) {
    const adminId = 'usr_admin_master';
    const adminUser = (process.env.ADMIN_USERNAME || 'admin').toLowerCase().trim();
    // Sin ADMIN_PASSWORD se genera una contraseña aleatoria (se muestra una sola vez en consola).
    const generatedPass = process.env.ADMIN_PASSWORD ? null : crypto.randomBytes(9).toString('base64url');
    const adminPass = process.env.ADMIN_PASSWORD || generatedPass;
    const pwdHash = hashPassword(adminPass);
    db.prepare(`
      INSERT INTO platform_users (id, username, email, password_hash, name, role, whatsapp, status, created_at)
      VALUES (?, ?, 'admin@etho.local', ?, 'Administrador Master', 'admin', '', 'active', ?)
    `).run(adminId, adminUser, pwdHash, Date.now());
    const seeded = getPlatformUserById(adminId);
    if (seeded) supaSyncPlatformUser({ ...seeded, password_hash: pwdHash });
    const passHint = generatedPass ? `${generatedPass}  (generada ahora; cámbiala o define ADMIN_PASSWORD)` : '[definida en ADMIN_PASSWORD]';
    console.log(`[Auth] 👑 Usuario Administrador inicial creado: Usuario = ${adminUser} | Contraseña = ${passHint}`);
  }
}

// Inicializar Administrador por defecto al cargar el módulo
try {
  initDefaultAdmin();
} catch (e) {
  console.error('Error inicializando admin por defecto:', e.message);
}

// ==========================================
// SUSCRIPCIÓN & CONTROL DE TIEMPO DE BOTS
// ==========================================

export function updateBotSubscription(botId, { daysToAdd, payment_status, plan, purpose }) {
  const bot = getBot(botId);
  if (!bot) return null;

  let newExpiresAt = Number(bot.expires_at) || Date.now();
  if (newExpiresAt < Date.now()) {
    newExpiresAt = Date.now();
  }

  if (daysToAdd !== undefined) {
    if (daysToAdd === 0 || daysToAdd === -1) {
      newExpiresAt = 0; // 0 = Ilimitado (VIP / Admin)
    } else {
      newExpiresAt += (Number(daysToAdd) * 24 * 60 * 60 * 1000);
    }
  }

  const newStatus = payment_status || (newExpiresAt === 0 ? 'paid' : (newExpiresAt < Date.now() ? 'expired' : bot.payment_status));
  const newPlan = plan || bot.plan;
  const newPurpose = purpose !== undefined ? purpose : bot.purpose;

  db.prepare(`
    UPDATE bots SET expires_at=?, payment_status=?, plan=?, purpose=?, updated_at=?
    WHERE id=?
  `).run(newExpiresAt, newStatus, newPlan, newPurpose, Date.now(), botId);

  return getBot(botId);
}

export function isBotExpired(botId) {
  const bot = getBot(botId);
  if (!bot) return true;
  if (bot.payment_status === 'suspended') return true;
  if (bot.expires_at > 0 && Date.now() > bot.expires_at && bot.payment_status !== 'paid') {
    return true;
  }
  return false;
}

// ==========================================
// MEMORIA CONVERSACIONAL Y APRENDIZAJE IA
// ==========================================

/** Guarda un mensaje en el historial del chat para mantener memoria continua */
export function saveChatMessage(botId, chatJid, senderJid, role, content) {
  try {
    const text = String(content || '').trim().slice(0, 1000);
    if (!text) return;
    db.prepare(`
      INSERT INTO bot_conversations (bot_id, chat_jid, sender_jid, role, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(botId, chatJid, senderJid || null, role, text, Date.now());

    // Mantener sólo los últimos 30 mensajes por chat para máxima eficiencia
    db.prepare(`
      DELETE FROM bot_conversations
      WHERE bot_id = ? AND chat_jid = ? AND id NOT IN (
        SELECT id FROM bot_conversations
        WHERE bot_id = ? AND chat_jid = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 30
      )
    `).run(botId, chatJid, botId, chatJid);
  } catch (err) {
    console.error('[DB] Error guardando mensaje en memoria conversacional:', err.message);
  }
}

/** Obtiene los últimos mensajes en orden cronológico para alimentar la IA */
export function getChatHistory(botId, chatJid, limit = 8) {
  try {
    const rows = db.prepare(`
      SELECT role, content, created_at
      FROM bot_conversations
      WHERE bot_id = ? AND chat_jid = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(botId, chatJid, limit);

    return rows.reverse().map(r => ({
      role: r.role === 'assistant' ? 'assistant' : 'user',
      content: r.content
    }));
  } catch {
    return [];
  }
}

/** Limpia la memoria de un chat si el usuario lo solicita (ej. #reset) */
export function clearChatHistory(botId, chatJid) {
  try {
    db.prepare('DELETE FROM bot_conversations WHERE bot_id = ? AND chat_jid = ?').run(botId, chatJid);
    return true;
  } catch {
    return false;
  }
}

/** Guarda o actualiza un dato aprendido sobre el usuario (nombre, empresa, gusto, etc.) */
export function saveUserFact(botId, userJid, factKey, factValue) {
  try {
    const cleanKey = String(factKey).trim().toLowerCase().slice(0, 50);
    const cleanVal = String(factValue).trim().slice(0, 300);
    if (!cleanKey || !cleanVal) return;

    db.prepare(`
      INSERT INTO bot_user_facts (bot_id, user_jid, fact_key, fact_value, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(bot_id, user_jid, fact_key) DO UPDATE SET
        fact_value = excluded.fact_value,
        updated_at = excluded.updated_at
    `).run(botId, userJid, cleanKey, cleanVal, Date.now(), Date.now());
  } catch (err) {
    console.error('[DB] Error guardando dato de usuario:', err.message);
  }
}

/** Obtiene todos los hechos conocidos de un usuario */
export function getUserFacts(botId, userJid) {
  try {
    const rows = db.prepare(`
      SELECT fact_key, fact_value
      FROM bot_user_facts
      WHERE bot_id = ? AND user_jid = ?
      ORDER BY updated_at DESC
    `).all(botId, userJid);

    const facts = {};
    for (const r of rows) {
      facts[r.fact_key] = r.fact_value;
    }
    return facts;
  } catch {
    return {};
  }
}

// ==========================================
// RECADOS Y MODO PILOTO AUTOMÁTICO (HABLAR POR MÍ)
// ==========================================

/** Guarda un recado de una persona que escribió mientras la IA atendía */
export function addRecado({ botId, chatJid, senderName, senderPhone, message, aiReply }) {
  try {
    const res = db.prepare(`
      INSERT INTO bot_recados (bot_id, chat_jid, sender_name, sender_phone, message, ai_reply, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(botId, chatJid, senderName || 'Contacto', senderPhone || '', message, aiReply || '', Date.now());
    return res;
  } catch (err) {
    console.error('[DB] Error guardando recado:', err.message);
    return null;
  }
}

/** Obtiene la lista de recados tomados por la IA para este bot */
export function listRecados(botId, limit = 50) {
  try {
    const query = botId && botId !== 'all'
      ? 'SELECT * FROM bot_recados WHERE bot_id=? ORDER BY created_at DESC LIMIT ?'
      : 'SELECT * FROM bot_recados ORDER BY created_at DESC LIMIT ?';
    const params = botId && botId !== 'all' ? [botId, limit] : [limit];
    return db.prepare(query).all(...params);
  } catch {
    return [];
  }
}

/** Marca los recados como leídos */
export function markRecadosRead(botId) {
  try {
    if (botId && botId !== 'all') {
      db.prepare('UPDATE bot_recados SET is_read=1 WHERE bot_id=?').run(botId);
    } else {
      db.prepare('UPDATE bot_recados SET is_read=1').run();
    }
    return true;
  } catch {
    return false;
  }
}

/** Activa o desactiva el modo Hablar por Mí (Piloto Automático) */
export function toggleAutoPilot(botId, { enabled, persona, context, ownerName }) {
  const bot = getBot(botId);
  if (!bot) return null;

  const newEnabled = enabled !== undefined ? (enabled ? 1 : 0) : (bot.auto_pilot ? 0 : 1);
  const newPersona = persona || bot.pilot_persona || 'as_assistant';
  const newContext = context !== undefined ? context : (bot.pilot_context || '');
  const newOwnerName = ownerName !== undefined ? ownerName : (bot.owner_name || '');

  db.prepare(`
    UPDATE bots SET auto_pilot=?, pilot_persona=?, pilot_context=?, owner_name=?, updated_at=?
    WHERE id=?
  `).run(newEnabled, newPersona, newContext, newOwnerName, Date.now(), botId);

  return getBot(botId);
}

// ==========================================
// GESTIÓN DE PERSONALIDAD, TONO Y FILTRO DE PALABRAS
// ==========================================

/** Obtiene la configuración de personalidad y palabras de un bot */
export function getBotPersonality(botId) {
  const bot = getBot(botId);
  if (!bot) return null;
  const settings = bot.settings || {};
  return {
    botId: bot.id,
    name: bot.name,
    personality: bot.personality || 'recreational',
    system_prompt: bot.system_prompt || '',
    tone: settings.tone || 'profesional',
    forbidden_words: Array.isArray(settings.forbidden_words) ? settings.forbidden_words : [],
    preferred_words: Array.isArray(settings.preferred_words) ? settings.preferred_words : [],
    allow_emojis: Boolean(settings.allow_emojis) // default false (sin emojis)
  };
}

/** Actualiza la personalidad, tono, palabras prohibidas y preferidas de un bot */
export function updateBotPersonality(botId, { system_prompt, tone, forbidden_words, preferred_words, allow_emojis, personality }) {
  const bot = getBot(botId);
  if (!bot) return null;

  const settings = bot.settings || {};
  if (tone !== undefined) settings.tone = tone;
  if (forbidden_words !== undefined) {
    settings.forbidden_words = Array.isArray(forbidden_words)
      ? forbidden_words
      : String(forbidden_words).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }
  if (preferred_words !== undefined) {
    settings.preferred_words = Array.isArray(preferred_words)
      ? preferred_words
      : String(preferred_words).split(',').map(s => s.trim()).filter(Boolean);
  }
  if (allow_emojis !== undefined) settings.allow_emojis = Boolean(allow_emojis);

  const newPrompt = system_prompt !== undefined ? system_prompt : bot.system_prompt;
  const newFacet = personality || bot.personality;

  db.prepare(`
    UPDATE bots SET system_prompt=?, personality=?, settings=?, updated_at=?
    WHERE id=?
  `).run(newPrompt, newFacet, JSON.stringify(settings), Date.now(), botId);

  return getBotPersonality(botId);
}

/** Filtra un texto eliminando palabras prohibidas del bot */
export function filterForbiddenWords(botId, text) {
  if (!text) return '';
  const bot = getBot(botId);
  const settings = bot?.settings || {};
  const forbidden = Array.isArray(settings.forbidden_words) ? settings.forbidden_words : [];

  let result = text;
  for (const word of forbidden) {
    if (!word || !word.trim()) continue;
    const re = new RegExp(`\\b${word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    result = result.replace(re, '***');
  }
  return result;
}

// ==========================================
// CONTROL DE ACCESO POR CHATS Y GRUPOS (WHITELIST)
// ==========================================

/**
 * Normaliza las reglas de alcance de un bot.
 * Por defecto: los grupos de WhatsApp están en lista blanca estricta ('whitelist')
 * con 0 grupos autorizados hasta que el dueño habilite explícitamente cada grupo.
 */
export function normalizeBotAccessControl(botOrSettings) {
  const settings = botOrSettings?.settings !== undefined
    ? (botOrSettings.settings || {})
    : (botOrSettings || {});
  const ac = (settings && typeof settings.accessControl === 'object' && settings.accessControl)
    ? settings.accessControl
    : {};

  const validGroupModes = ['whitelist', 'none', 'all'];
  const groupMode = validGroupModes.includes(ac.groupMode) ? ac.groupMode : 'whitelist';
  const allowPrivateChats = ac.allowPrivateChats !== undefined ? Boolean(ac.allowPrivateChats) : true;
  const allowedGroups = Array.isArray(ac.allowedGroups)
    ? [...new Set(ac.allowedGroups.map(j => String(j || '').trim()).filter(j => j.endsWith('@g.us')))]
    : [];
  const groupMetaCache = (ac.groupMetaCache && typeof ac.groupMetaCache === 'object' && !Array.isArray(ac.groupMetaCache))
    ? { ...ac.groupMetaCache }
    : {};

  return {
    allowPrivateChats,
    groupMode,
    allowedGroups,
    groupMetaCache
  };
}

/**
 * Verifica si un chat (privado o grupo @g.us) tiene permiso para interactuar con el bot.
 */
export function isChatAllowedForBot(botOrId, chatJid) {
  if (!chatJid || chatJid === 'status@broadcast') return false;
  const botObj = typeof botOrId === 'string' ? getBot(botOrId) : botOrId;
  const ac = normalizeBotAccessControl(botObj);
  const isGroup = String(chatJid).endsWith('@g.us');

  if (isGroup) {
    if (ac.groupMode === 'all') return true;
    if (ac.groupMode === 'none') return false;
    return ac.allowedGroups.includes(chatJid);
  }

  return ac.allowPrivateChats !== false;
}

/**
 * Actualiza el control de acceso (chats privados, modo de grupos y lista de grupos habilitados) de un bot.
 */
export function updateBotAccessControl(botId, patch = {}) {
  const bot = getBot(botId);
  if (!bot) return null;

  const current = normalizeBotAccessControl(bot);
  const next = {
    allowPrivateChats: patch.allowPrivateChats !== undefined ? Boolean(patch.allowPrivateChats) : current.allowPrivateChats,
    groupMode: ['whitelist', 'none', 'all'].includes(patch.groupMode) ? patch.groupMode : current.groupMode,
    allowedGroups: Array.isArray(patch.allowedGroups)
      ? [...new Set(patch.allowedGroups.map(j => String(j || '').trim()).filter(j => j.endsWith('@g.us')))]
      : [...current.allowedGroups],
    groupMetaCache: { ...current.groupMetaCache }
  };

  if (patch.groupMeta && typeof patch.groupMeta === 'object') {
    for (const [jid, meta] of Object.entries(patch.groupMeta)) {
      if (jid && jid.endsWith('@g.us') && meta && typeof meta === 'object') {
        next.groupMetaCache[jid] = {
          subject: String(meta.subject || next.groupMetaCache[jid]?.subject || 'Grupo de WhatsApp').slice(0, 140),
          size: Number(meta.size ?? next.groupMetaCache[jid]?.size ?? 0)
        };
      }
    }
  }

  if (patch.toggleGroupJid && String(patch.toggleGroupJid).endsWith('@g.us')) {
    const targetJid = String(patch.toggleGroupJid).trim();
    const shouldEnable = Boolean(patch.enabled);
    if (shouldEnable) {
      if (!next.allowedGroups.includes(targetJid)) {
        next.allowedGroups.push(targetJid);
      }
      // Si estaba en 'none' y el usuario activa manualmente un grupo, pasar automáticamente a 'whitelist'
      if (next.groupMode === 'none') {
        next.groupMode = 'whitelist';
      }
    } else {
      next.allowedGroups = next.allowedGroups.filter(j => j !== targetJid);
      // Si estaba en 'all' y el usuario bloquea un grupo específico, pasar a 'whitelist'
      if (next.groupMode === 'all') {
        next.groupMode = 'whitelist';
      }
    }
  }

  const mergedSettings = {
    ...(bot.settings || {}),
    accessControl: next
  };

  const updatedBot = upsertBot({
    id: bot.id,
    settings: mergedSettings
  });

  return {
    bot: updatedBot,
    accessControl: normalizeBotAccessControl(updatedBot)
  };
}
