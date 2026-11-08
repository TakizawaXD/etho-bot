import 'dotenv/config';

const isVercel = Boolean(process.env.VERCEL);
const defaultDbPath = isVercel ? '/tmp/bot.db' : './data/bot.db';
const defaultSessionDir = isVercel ? '/tmp/sessions' : './data/sessions';

const rawSessionDir = process.env.SESSIONS_DIR || process.env.SESSION_DIR || defaultSessionDir;

export const config = {
  isVercel,
  botName: process.env.BOT_NAME || 'Etho',
  prefix: process.env.PREFIX || '#',
  owners: (process.env.OWNER_NUMBERS || '').split(',').map((s) => s.trim()).filter(Boolean),
  currency: process.env.CURRENCY || 'coins',
  dbPath: process.env.DB_PATH || defaultDbPath,
  sessionDir: rawSessionDir === './data/session' ? defaultSessionDir : rawSessionDir,
  pairingNumber: (process.env.PAIRING_NUMBER || '').replace(/\D/g, ''),
};
