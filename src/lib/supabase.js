// Conexión y sincronización en la nube con Supabase (PostgreSQL).
// Registra usuarios, grupos, bots, logs de actividad y funciones configurables.
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;

export const supabase = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;

const SYNCED_USER_FIELDS = ['coins', 'bank', 'exp', 'description', 'genre', 'partner'];
const SYNCED_GROUP_FIELDS = ['welcome', 'goodbye', 'antilink', 'economy', 'gacha', 'nsfw', 'bot_on'];

export async function testConnection() {
  if (!supabase) {
    return { ok: false, message: 'SUPABASE_URL o SUPABASE_KEY no están configurados en el archivo .env' };
  }
  try {
    const { data, error } = await supabase.from('bots').select('id').limit(1);
    if (error) {
      if (error.code === 'PGRST205' || error.message?.includes('schema cache') || error.message?.includes('relation')) {
        return {
          ok: true,
          configured: true,
          tablesReady: false,
          message: 'Conectado a Supabase, pero falta ejecutar el script SQL de creación de tablas (ver supabase/schema.sql)'
        };
      }
      return { ok: false, configured: true, error: error.message };
    }
    return { ok: true, configured: true, tablesReady: true, message: 'Conexión a Supabase activa y tablas verificadas' };
  } catch (err) {
    return { ok: false, configured: true, error: err.message };
  }
}

export function syncUser(jid, fields) {
  if (!supabase) return;
  const row = {};
  for (const k of SYNCED_USER_FIELDS) if (k in fields) row[k] = fields[k];
  if (!Object.keys(row).length) return;
  supabase.from('bot_users').upsert({ jid, ...row, updated_at: new Date().toISOString() })
    .then(({ error }) => { if (error && error.code !== 'PGRST205') console.warn('[supabase] users:', error.message); })
    .catch(() => {});
}

export function syncGroup(jid, fields) {
  if (!supabase) return;
  const row = {};
  for (const k of SYNCED_GROUP_FIELDS) if (k in fields) row[k] = fields[k];
  if (!Object.keys(row).length) return;
  supabase.from('bot_groups').upsert({ jid, ...row, updated_at: new Date().toISOString() })
    .then(({ error }) => { if (error && error.code !== 'PGRST205') console.warn('[supabase] groups:', error.message); })
    .catch(() => {});
}

export function syncBot(bot) {
  if (!supabase || !bot) return;
  const row = {
    id: bot.id,
    name: bot.name,
    phone: bot.phone || '',
    prefix: bot.prefix || '#',
    status: bot.status || 'offline',
    qr_code: bot.qr_code || null,
    is_active: Boolean(bot.is_active),
    personality: bot.personality || 'recreational',
    system_prompt: bot.system_prompt || null,
    ai_auto_reply: Boolean(bot.ai_auto_reply),
    settings: bot.settings || {},
    updated_at: new Date().toISOString()
  };
  supabase.from('bots').upsert(row)
    .then(({ error }) => { if (error && error.code !== 'PGRST205') console.warn('[supabase] bot sync:', error.message); })
    .catch(() => {});
}

export function logActivity({ botId = 'default', type = 'info', chatJid = '', senderJid = '', senderName = '', content = '', details = {} }) {
  if (!supabase) return;
  const row = {
    bot_id: botId,
    type,
    chat_jid: chatJid,
    sender_jid: senderJid,
    sender_name: senderName,
    content: String(content).slice(0, 500),
    details: details || {},
    created_at: new Date().toISOString()
  };
  supabase.from('bot_logs').insert(row)
    .then(({ error }) => { if (error && error.code !== 'PGRST205') console.warn('[supabase] logActivity:', error.message); })
    .catch(() => {});
}

export function syncCustomFunction(fn) {
  if (!supabase || !fn) return;
  const row = {
    id: fn.id,
    bot_id: fn.bot_id || 'all',
    name: fn.name,
    description: fn.description || '',
    trigger_type: fn.trigger_type || 'command',
    trigger_value: fn.trigger_value || '',
    response_text: fn.response_text || '',
    response_type: fn.response_type || 'text',
    is_enabled: Boolean(fn.is_enabled),
    updated_at: new Date().toISOString()
  };
  supabase.from('bot_custom_functions').upsert(row)
    .then(({ error }) => { if (error && error.code !== 'PGRST205') console.warn('[supabase] custom fn sync:', error.message); })
    .catch(() => {});
}

export function deleteCustomFunction(id) {
  if (!supabase || !id) return;
  supabase.from('bot_custom_functions').delete().eq('id', id)
    .then(({ error }) => { if (error && error.code !== 'PGRST205') console.warn('[supabase] custom fn del:', error.message); })
    .catch(() => {});
}


export function syncLead(lead) {
  if (!supabase || !lead) return;
  const row = {
    id: lead.id,
    bot_id: lead.bot_id || 'all',
    name: lead.name || '',
    phone: lead.phone || '',
    email: lead.email || '',
    interest: lead.interest || '',
    notes: lead.notes || '',
    status: lead.status || 'nuevo',
    created_at: new Date(lead.created_at || Date.now()).toISOString()
  };
  supabase.from('bot_leads').upsert(row)
    .then(({ error }) => { if (error && error.code !== 'PGRST205') console.warn('[supabase] lead sync:', error.message); })
    .catch(() => {});
}

export function deleteLead(id) {
  if (!supabase || !id) return;
  supabase.from('bot_leads').delete().eq('id', id)
    .then(({ error }) => { if (error && error.code !== 'PGRST205') console.warn('[supabase] lead del:', error.message); })
    .catch(() => {});
}

export function syncProduct(prod) {
  if (!supabase || !prod) return;
  const row = {
    id: prod.id,
    bot_id: prod.bot_id || 'all',
    name: prod.name,
    description: prod.description || '',
    price: Number(prod.price) || 0,
    currency: prod.currency || 'USD',
    image_url: prod.image_url || '',
    category: prod.category || 'General',
    is_active: Boolean(prod.is_active),
    updated_at: new Date().toISOString()
  };
  supabase.from('bot_products').upsert(row)
    .then(({ error }) => { if (error && error.code !== 'PGRST205') console.warn('[supabase] prod sync:', error.message); })
    .catch(() => {});
}

export function deleteProduct(id) {
  if (!supabase || !id) return;
  supabase.from('bot_products').delete().eq('id', id)
    .then(({ error }) => { if (error && error.code !== 'PGRST205') console.warn('[supabase] prod del:', error.message); })
    .catch(() => {});
}

export function syncPlatformUser(user) {
  if (!supabase || !user) return;
  const row = {
    id: user.id,
    username: user.username,
    email: user.email || null,
    password_hash: user.password_hash,
    name: user.name,
    role: user.role || 'user',
    whatsapp: user.whatsapp || '',
    status: user.status || 'active',
    created_at: new Date(user.created_at || Date.now()).toISOString()
  };
  supabase.from('platform_users').upsert(row)
    .then(({ error }) => { if (error && error.code !== 'PGRST205') console.warn('[supabase] user sync:', error.message); })
    .catch(() => {});
}

export function deletePlatformUserFromSupabase(id) {
  if (!supabase || !id) return;
  supabase.from('platform_users').delete().eq('id', id)
    .then(({ error }) => { if (error && error.code !== 'PGRST205') console.warn('[supabase] user del:', error.message); })
    .catch(() => {});
}

export async function triggerWebhook(webhookUrl, eventName, data) {
  if (!webhookUrl || !webhookUrl.startsWith('http')) return;
  try {
    const payload = {
      event: eventName,
      timestamp: new Date().toISOString(),
      data
    };
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Etho-Bot-Webhook/2.0' },
      body: JSON.stringify(payload)
    }).catch(() => {});
  } catch (err) {
    console.warn(`[webhook] Error enviando a ${webhookUrl}:`, err.message);
  }
}
