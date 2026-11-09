import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'etho-maint-'));
process.env.DB_PATH = path.join(tmp, 'data', 'bot.db');
process.env.BACKUP_KEEP = '3';
process.env.LOG_RETENTION_DAYS = '30';

const { db, upsertBot } = await import('../src/db.js');
await import('../src/lib/billing.js');
const M = await import('../src/lib/maintenance.js');

M.tuneDatabase();
const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name);
for (const n of ['idx_bot_logs_bot_created', 'idx_bot_logs_created', 'idx_bot_conv_created', 'idx_bots_owner', 'idx_bot_leads_bot', 'idx_bot_products_bot', 'idx_bot_user_facts_lookup']) {
  assert.ok(idx.includes(n), `falta el índice ${n}`);
}

// Limpieza por lotes: 12.000 logs viejos + 3 recientes
const DAY = 86400000; const now = Date.now();
const ins = db.prepare('INSERT INTO bot_logs (bot_id, type, content, created_at) VALUES (?,?,?,?)');
db.exec('BEGIN');
for (let i = 0; i < 12000; i++) ins.run('b1', 'msg', 'viejo', now - 45 * DAY);
for (let i = 0; i < 3; i++) ins.run('b1', 'msg', 'nuevo', now - DAY);
db.exec('COMMIT');
const removed = await M.pruneOldData({ now });
assert.equal(removed.bot_logs, 12000);
assert.equal(db.prepare('SELECT COUNT(*) AS c FROM bot_logs').get().c, 3);

// Copias de seguridad: crea, no duplica si es reciente, rota y es restaurable
upsertBot({ id: 'bot_x', name: 'X', owner_id: 'u', expires_at: 0, payment_status: 'paid', plan: 'pro' });
const f1 = M.backupDatabase({ now: new Date(Date.UTC(2026, 0, 1, 10, 0)) });
assert.ok(f1 && fs.existsSync(f1));
assert.equal(M.backupDatabase({ now: new Date(Date.UTC(2026, 0, 1, 12, 0)) }), null);          // hay una de hace 2 h... (mtime real = ahora)
for (let d = 2; d <= 6; d++) assert.ok(M.backupDatabase({ now: new Date(Date.UTC(2026, 0, d, 10, 0)), force: true }));
const kept = fs.readdirSync(path.dirname(f1)).filter((f) => f.endsWith('.db')).sort();
assert.equal(kept.length, 3);                                                                     // solo conserva las 3 más recientes
assert.equal(kept[kept.length - 1], 'bot-20260106-1000.db');
const { DatabaseSync } = await import('node:sqlite');
const copy = new DatabaseSync(path.join(path.dirname(f1), kept[kept.length - 1]));
assert.equal(copy.prepare("SELECT id FROM bots WHERE id='bot_x'").get().id, 'bot_x');             // la copia contiene los datos
copy.close();
assert.equal((fs.statSync(path.join(path.dirname(f1), kept[0])).mode & 0o077), 0);                // permisos privados

db.close(); fs.rmSync(tmp, { recursive: true, force: true });
console.log('maintenance OK');
