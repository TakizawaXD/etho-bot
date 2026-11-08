import { jidNorm } from './utils.js';

const cache = new Map();

export async function getMeta(sock, chat, force = false) {
  const hit = cache.get(chat);
  if (!force && hit && Date.now() - hit.ts < 60_000) return hit.meta;
  const meta = await sock.groupMetadata(chat);
  cache.set(chat, { meta, ts: Date.now() });
  return meta;
}
export const clearMeta = (chat) => cache.delete(chat);

/** Compara un participante con un jid (soporta formatos @s.whatsapp.net y @lid). */
export const same = (p, jid) => {
  if (!jid) return false;
  const n = jidNorm(jid);
  return [p.id, p.lid, p.jid, p.phoneNumber].filter(Boolean).some((x) => jidNorm(x) === n);
};
export const isAdminOf = (meta, jid) => meta.participants.some((p) => p.admin && same(p, jid));
export const botIsAdmin = (sock, meta) =>
  meta.participants.some((p) => p.admin && (same(p, sock.user.id) || same(p, sock.user.lid)));
