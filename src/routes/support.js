// Rutas del sistema de tickets (reporte de errores desde la landing y el panel).
import { createRateLimiter, rateLimitMiddleware } from '../lib/auth.js';
import * as T from '../lib/tickets.js';
import { getBillingUser } from '../lib/billing.js';

const createLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: Number(process.env.TICKETS_PER_HOUR) || 5 });
const lookupLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 30 });

function fail(res, err) {
  if (err instanceof T.TicketError) return res.status(err.status).json({ ok: false, error: err.message });
  console.error('[Tickets]', err);
  return res.status(500).json({ ok: false, error: 'Error interno.' });
}

export function registerSupportRoutes(app, { authRequired, adminRequired, notifyAdmins }) {
  // Crear ticket: público (visitantes) o con sesión. Protegido con límite por IP y campo trampa.
  app.post('/api/tickets', rateLimitMiddleware(createLimiter, { message: 'Has enviado muchos reportes. Intenta de nuevo en una hora.' }), (req, res) => {
    try {
      const b = req.body || {};
      if (b.website) return res.json({ ok: true, ticket: { id: 'TCK-OK' } });    // honeypot: los bots lo rellenan
      let user = null;
      if (req.user) {
        const row = getBillingUser(req.user.id);
        if (row) user = { id: row.id, name: row.name, email: row.email, role: row.role };
      }
      const ticket = T.createTicket({
        user, name: b.name, email: b.email, category: b.category, priority: b.priority,
        subject: b.subject, message: b.message, botId: b.botId,
        pageUrl: b.pageUrl, userAgent: req.get('user-agent'), ip: req.ip,
      });
      notifyAdmins?.('ticket', { type: 'new', id: ticket.id, subject: ticket.subject, category: ticket.category });
      res.json({ ok: true, ticket: { id: ticket.id, status: ticket.status, created_at: ticket.created_at } });
    } catch (err) { fail(res, err); }
  });

  // Consulta pública de un ticket (código + correo). POST para no dejar el correo en logs de URL.
  app.post('/api/tickets/lookup', rateLimitMiddleware(lookupLimiter), (req, res) => {
    try { res.json({ ok: true, ...T.lookupGuestTicket(req.body?.code, req.body?.email) }); } catch (err) { fail(res, err); }
  });

  app.get('/api/tickets', authRequired, (req, res) => {
    try { res.json({ ok: true, ...T.listTickets(req.user, { status: String(req.query.status || '') }) }); } catch (err) { fail(res, err); }
  });

  app.get('/api/tickets/:id', authRequired, (req, res) => {
    try { res.json({ ok: true, ...T.getTicket(req.params.id, req.user) }); } catch (err) { fail(res, err); }
  });

  app.post('/api/tickets/:id/messages', authRequired, rateLimitMiddleware(createRateLimiter({ windowMs: 60 * 1000, max: 15 }), { key: (r) => r.user.id }), (req, res) => {
    try {
      const internal = req.user.role === 'admin' && Boolean(req.body?.internal);
      const data = T.addMessage(req.params.id, req.user, req.body?.body, { internal });
      if (req.user.role !== 'admin') notifyAdmins?.('ticket', { type: 'reply', id: data.ticket.id });
      res.json({ ok: true, ...data });
    } catch (err) { fail(res, err); }
  });

  app.put('/api/tickets/:id/status', authRequired, (req, res) => {
    try { res.json({ ok: true, ...T.setStatus(req.params.id, req.user, String(req.body?.status || '')) }); } catch (err) { fail(res, err); }
  });
}
