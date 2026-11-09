// Mantenimiento automático: afinado de SQLite, índices, limpieza de datos viejos, copias de seguridad
// y vencimiento de planes. Todo es tolerante a fallos: un error aquí nunca tumba el servidor.
import fs from 'fs';
import path from 'path';
import { db } from '../db.js';
import { config } from '../config.js';
import { reconcileSubscriptions } from './billing.js';
import { alert } from './alerts.js';

const HOUR = 3600 * 1000;
const intEnv = (name, d) => (Number.isFinite(Number(process.env[name])) && process.env[name] !== '' ? Number(process.env[name]) : d);

export const LOG_RETENTION_DAYS = () => intEnv('LOG_RETENTION_DAYS', 30);
export const CHAT_RETENTION_DAYS = () => intEnv('CHAT_RETENTION_DAYS', 60);
export const BACKUP_KEEP = () => Math.max(1, intEnv('BACKUP_KEEP', 7));

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_bot_logs_bot_created ON bot_logs(bot_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_bot_logs_created ON bot_logs(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_bot_conv_created ON bot_conversations(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_bots_owner ON bots(owner_id)',
  'CREATE INDEX IF NOT EXISTS idx_bot_leads_bot ON bot_leads(bot_id)',
  'CREATE INDEX IF NOT EXISTS idx_bot_products_bot ON bot_products(bot_id)',
  'CREATE INDEX IF NOT EXISTS idx_bot_user_facts_lookup ON bot_user_facts(bot_id, user_jid)',
];

/** Pragmas de rendimiento/robustez e índices de las tablas que más crecen. */
export function tuneDatabase() {
  db.pragma('synchronous = NORMAL');   // seguro con WAL y bastante más rápido
  db.pragma('busy_timeout = 5000');    // espera en vez de fallar si la DB está ocupada
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = -20000');    // ~20 MB de caché
  for (const sql of INDEXES) db.exec(sql);
}

/** Borra registros antiguos por lotes (sin bloquear el servidor mucho tiempo). */
export async function pruneOldData({ now = Date.now() } = {}) {
  const jobs = [
    ['bot_logs', now - LOG_RETENTION_DAYS() * 24 * HOUR],
    ['bot_conversations', now - CHAT_RETENTION_DAYS() * 24 * HOUR],
  ];
  const removed = {};
  for (const [table, cutoff] of jobs) {
    removed[table] = 0;
    for (let i = 0; i < 200; i++) {
      const r = db.prepare(`DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE created_at < ? LIMIT 5000)`).run(cutoff);
      removed[table] += Number(r?.changes) || 0;
      if (!r || Number(r.changes) < 5000) break;
      await new Promise((res) => setImmediate(res));   // cede el turno al resto del servidor
    }
  }
  db.pragma('wal_checkpoint(TRUNCATE)');
  return removed;
}

const backupDir = () => path.join(path.dirname(path.resolve(config.dbPath)), 'backups');

/** Copia consistente de la base de datos (VACUUM INTO). Omite si ya hay una reciente. */
export function backupDatabase({ now = new Date(), force = false } = {}) {
  if (process.env.VERCEL || !db._db) return null;
  const dir = backupDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const existing = fs.readdirSync(dir).filter((f) => /^bot-\d{8}-\d{4}\.db$/.test(f)).sort();
    if (!force && existing.length) {
      const last = fs.statSync(path.join(dir, existing[existing.length - 1])).mtimeMs;
      if (now.getTime() - last < 20 * HOUR) return null;
    }
    const p2 = (n) => String(n).padStart(2, '0');
    const name = `bot-${now.getUTCFullYear()}${p2(now.getUTCMonth() + 1)}${p2(now.getUTCDate())}-${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}.db`;
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return null;
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    if (!fs.existsSync(file)) return null;
    try { fs.chmodSync(file, 0o600); } catch { /* en Windows puede no aplicar */ }

    const all = fs.readdirSync(dir).filter((f) => /^bot-\d{8}-\d{4}\.db$/.test(f)).sort();
    for (const old of all.slice(0, Math.max(0, all.length - BACKUP_KEEP()))) {
      try { fs.rmSync(path.join(dir, old)); } catch { /* ya no existe */ }
    }
    return file;
  } catch (e) {
    console.error('[Mantenimiento] Falló la copia de seguridad:', e.message);
    alert('error', 'Falló la copia de seguridad de la base de datos', e.message);
    return null;
  }
}

/** Inicia todas las tareas periódicas. `onBotsChanged(ids)` avisa a los paneles de cambios de plan. */
export function startMaintenance({ onBotsChanged } = {}) {
  const timers = [];
  const every = (ms, fn, firstDelay = ms) => {
    const safe = async () => { try { await fn(); } catch (e) { console.error('[Mantenimiento]', e.message); } };
    const first = setTimeout(() => { safe(); timers.push(setInterval(safe, ms).unref?.() ?? 0); }, firstDelay);
    first.unref?.();
    timers.push(first);
  };

  try { tuneDatabase(); } catch (e) { console.error('[Mantenimiento] Afinado de DB:', e.message); }

  const reconcile = () => {
    const ids = reconcileSubscriptions();
    if (ids.length) { console.log(`[Facturación] ${ids.length} bot(s) pasaron a vencidos por fin de plan.`); onBotsChanged?.(ids); }
  };
  reconcile();                                        // al arrancar: ponerse al día tras un reinicio
  every(60 * 1000, reconcile);                        // y cada minuto
  every(6 * HOUR, () => pruneOldData(), 2 * 60 * 1000);
  every(6 * HOUR, () => { const f = backupDatabase(); if (f) console.log(`[Mantenimiento] Copia de seguridad creada: ${f}`); }, 5 * 60 * 1000);

  return () => timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
}
