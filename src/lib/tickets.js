// Sistema de tickets de soporte: los visitantes (sin cuenta) y los clientes reportan errores,
// y el administrador responde desde el panel. Todo el texto se valida, se limpia y se limita.
import crypto from 'node:crypto';
import { db } from '../db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS support_tickets(
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'error',
  priority TEXT NOT NULL DEFAULT 'normal',
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  bot_id TEXT,
  page_url TEXT,
  user_agent TEXT,
  ip_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status, updated_at DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets(user_id, created_at DESC)');
db.exec(`
CREATE TABLE IF NOT EXISTS ticket_messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL,
  author_type TEXT NOT NULL,
  author_id TEXT,
  author_name TEXT,
  body TEXT NOT NULL,
  internal INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_ticket_msgs ON ticket_messages(ticket_id, created_at)');

export const CATEGORIES = ['error', 'pago', 'bot', 'cuenta', 'sugerencia', 'otro'];
export const PRIORITIES = ['low', 'normal', 'high'];
export const STATUSES = ['open', 'in_progress', 'waiting_user', 'resolved', 'closed'];

export class TicketError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => `TCK-${Array.from({ length: 6 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('')}`;
// Quita caracteres de control y de dirección de texto; conserva saltos de línea si se piden.
const clean = (s, max, { multiline = false } = {}) => {
  let t = String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '');
  t = multiline ? t.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : t.replace(/\s+/g, ' ');
  return t.trim().slice(0, max);
};
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$/;
const hashIp = (ip) => crypto.createHash('sha256').update(`${ip || ''}|${process.env.AUTH_SECRET || 'etho'}`).digest('hex').slice(0, 24);
const now = () => Date.now();

export function createTicket({ user = null, name, email, category, priority, subject, message, botId, pageUrl, userAgent, ip }) {
  const n = clean(user?.name || name, 80);
  const e = clean(user?.email || email, 254).toLowerCase();
  const s = clean(subject, 120);
  const m = clean(message, 4000, { multiline: true });
  if (n.length < 2) throw new TicketError('Escribe tu nombre.');
  if (!EMAIL.test(e)) throw new TicketError('Escribe un correo válido para poder responderte.');
  if (s.length < 4) throw new TicketError('El asunto debe tener al menos 4 caracteres.');
  if (m.length < 10) throw new TicketError('Describe el problema con al menos 10 caracteres (qué hiciste y qué pasó).');
  const cat = CATEGORIES.includes(category) ? category : 'error';
  const pri = PRIORITIES.includes(priority) ? priority : 'normal';

  const t = now();
  let id = newCode();
  for (let i = 0; i < 5 && db.prepare('SELECT 1 AS x FROM support_tickets WHERE id=?').get(id); i++) id = newCode();
  db.prepare(`INSERT INTO support_tickets
    (id, user_id, name, email, category, priority, subject, message, status, bot_id, page_url, user_agent, ip_hash, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?, 'open', ?,?,?,?,?,?)`)
    .run(id, user?.id || null, n, e, cat, pri, s, m, clean(botId, 60) || null, clean(pageUrl, 200) || null, clean(userAgent, 200) || null, hashIp(ip), t, t);
  db.prepare("INSERT INTO ticket_messages (ticket_id, author_type, author_id, author_name, body, internal, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)")
    .run(id, user ? 'user' : 'guest', user?.id || null, n, m, t);
  return getTicketRow(id);
}

const getTicketRow = (id) => db.prepare('SELECT * FROM support_tickets WHERE id=?').get(String(id || '').toUpperCase()) || null;
// Campos que se devuelven al cliente (nunca ip_hash ni user_agent).
const publicTicket = (t) => t && ({
  id: t.id, name: t.name, email: t.email, category: t.category, priority: t.priority, subject: t.subject,
  message: t.message, status: t.status, bot_id: t.bot_id, page_url: t.page_url, user_id: t.user_id,
  created_at: t.created_at, updated_at: t.updated_at, closed_at: t.closed_at,
});

const canView = (t, user) => Boolean(user && (user.role === 'admin' || (t.user_id && t.user_id === user.id)));

export function listTickets(user, { status = '', limit = 100 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 300);
  const where = []; const args = [];
  if (user.role !== 'admin') { where.push('user_id=?'); args.push(user.id); }
  if (STATUSES.includes(status)) { where.push('status=?'); args.push(status); }
  const rows = db.prepare(`SELECT * FROM support_tickets ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT ?`).all(...args, lim);
  const counts = {};
  const cq = user.role === 'admin'
    ? db.prepare('SELECT status, COUNT(*) AS c FROM support_tickets GROUP BY status').all()
    : db.prepare('SELECT status, COUNT(*) AS c FROM support_tickets WHERE user_id=? GROUP BY status').all(user.id);
  for (const r of cq) counts[r.status] = r.c;
  return { tickets: rows.map(publicTicket), counts };
}

function messagesOf(id, { includeInternal }) {
  return db.prepare(`SELECT id, author_type, author_name, body, internal, created_at FROM ticket_messages
    WHERE ticket_id=? ${includeInternal ? '' : 'AND internal=0'} ORDER BY created_at ASC, id ASC`).all(id);
}

export function getTicket(id, user) {
  const t = getTicketRow(id);
  if (!t || !canView(t, user)) throw new TicketError('Ticket no encontrado.', 404);
  return { ticket: publicTicket(t), messages: messagesOf(t.id, { includeInternal: user.role === 'admin' }) };
}

export function addMessage(id, user, body, { internal = false } = {}) {
  const t = getTicketRow(id);
  if (!t || !canView(t, user)) throw new TicketError('Ticket no encontrado.', 404);
  if (t.status === 'closed') throw new TicketError('El ticket está cerrado. Abre uno nuevo si el problema continúa.');
  const text = clean(body, 4000, { multiline: true });
  if (text.length < 2) throw new TicketError('Escribe un mensaje.');
  const isAdmin = user.role === 'admin';
  const ts = now();
  db.prepare('INSERT INTO ticket_messages (ticket_id, author_type, author_id, author_name, body, internal, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(t.id, isAdmin ? 'admin' : 'user', user.id, clean(user.name, 80), text, isAdmin && internal ? 1 : 0, ts);
  // Una respuesta del admin espera al cliente; una del cliente reabre/pone en curso.
  const next = isAdmin ? (internal ? t.status : 'waiting_user') : (['resolved', 'waiting_user'].includes(t.status) ? 'open' : t.status);
  db.prepare('UPDATE support_tickets SET status=?, updated_at=? WHERE id=?').run(next, ts, t.id);
  return getTicket(t.id, user);
}

export function setStatus(id, user, status) {
  const t = getTicketRow(id);
  if (!t || !canView(t, user)) throw new TicketError('Ticket no encontrado.', 404);
  if (!STATUSES.includes(status)) throw new TicketError('Estado no válido.');
  // Un cliente solo puede cerrar su propio ticket; el resto de cambios son del admin.
  if (user.role !== 'admin' && status !== 'closed') throw new TicketError('No tienes permiso para ese cambio.', 403);
  const ts = now();
  db.prepare('UPDATE support_tickets SET status=?, updated_at=?, closed_at=? WHERE id=?')
    .run(status, ts, ['resolved', 'closed'].includes(status) ? ts : null, t.id);
  return getTicket(t.id, user);
}

/** Consulta pública: exige código + correo del ticket (comparación en tiempo constante). */
export function lookupGuestTicket(code, email) {
  const t = getTicketRow(code);
  const given = Buffer.from(clean(email, 254).toLowerCase());
  const real = Buffer.from(t ? t.email : '');
  const ok = t && given.length === real.length && crypto.timingSafeEqual(given, real);
  if (!ok) throw new TicketError('No encontramos un ticket con esos datos.', 404);
  return { ticket: publicTicket(t), messages: messagesOf(t.id, { includeInternal: false }) };
}
