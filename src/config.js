import 'dotenv/config';

const rawSessionDir = process.env.SESSIONS_DIR || process.env.SESSION_DIR || './data/sessions';

export const config = {
  botName: process.env.BOT_NAME || 'Etho',
  prefix: process.env.PREFIX || '#',
  owners: (process.env.OWNER_NUMBERS || '').split(',').map((s) => s.trim()).filter(Boolean),
  currency: process.env.CURRENCY || 'coins',
  dbPath: process.env.DB_PATH || './data/bot.db',
  sessionDir: rawSessionDir === './data/session' ? './data/sessions' : rawSessionDir,
  pairingNumber: (process.env.PAIRING_NUMBER || '').replace(/\D/g, ''),
};
