import pkg from 'wa-sticker-formatter';
import { db, setUser } from '../db.js';
import { config } from '../config.js';
import { sha1, slug, sleep } from '../lib/utils.js';

const { Sticker } = pkg;
const getPack = (owner, name) => db.prepare('SELECT * FROM packs WHERE owner=? AND lower(name)=?').get(owner, (name || '').toLowerCase());
const bySlug = (s) => db.prepare('SELECT * FROM packs WHERE slug=? AND public=1').get((s || '').toLowerCase());
const needName = (c) => { if (!c.text) { c.reply(`Uso: ${c.prefix}${c.command} [paquete]`); return true; } };

export default [
 { name: 'sticker', aliases: ['s', 'stickers'], desc: 'Convertir imagen/video a sticker.', usage: '{imagen/video} <paquete> | <autor>',
 run: async (c) => {
 const m = await c.media();
 if (!m || !['imageMessage', 'videoMessage'].includes(m.type)) return c.reply('Envía o responde a una imagen/video.');
 const [p, a] = c.text.split('|').map((s) => s.trim());
 const st = new Sticker(m.buffer, { pack: p || c.user.sticker_pack || config.botName, author: a || c.user.sticker_author || '', type: 'full', quality: 60 });
 await c.sock.sendMessage(c.chat, await st.toMessage(), { quoted: c.msg });
 } },
 { name: 'setstickermeta', aliases: ['setmeta'], desc: 'Pack y autor por defecto.', usage: '[paquete] | <autor>',
 run: async (c) => {
 const [p, a] = c.text.split('|').map((s) => s.trim());
 if (!p) return c.reply(`Uso: ${c.prefix}setmeta Mi pack | Autor`);
 setUser(c.sender, { sticker_pack: p.slice(0, 50), sticker_author: (a || '').slice(0, 50) }); await c.reply(' Metadatos guardados.');
 } },
 { name: 'delstickermeta', aliases: ['delmeta'], desc: 'Restablecer pack y autor.',
 run: async (c) => { setUser(c.sender, { sticker_pack: null, sticker_author: null }); await c.reply(' Restablecido.'); } },
 { name: 'newpack', aliases: ['newstickerpack'], desc: 'Crear un paquete de stickers.', usage: '[paquete]',
 run: async (c) => {
 if (needName(c)) return;
 if (getPack(c.sender, c.text)) return c.reply(' Ya tienes un paquete con ese nombre.');
 const s = slug();
 db.prepare('INSERT INTO packs(owner,name,slug) VALUES(?,?,?)').run(c.sender, c.text.slice(0, 40), s);
 await c.reply(` Paquete *${c.text}* creado (privado). Slug: \`${s}\``);
 } },
 { name: 'delpack', desc: 'Eliminar un paquete.', usage: '[paquete]',
 run: async (c) => {
 if (needName(c)) return;
 const p = getPack(c.sender, c.text); if (!p) return c.reply(' Paquete no encontrado.');
 db.transaction(() => { db.prepare('DELETE FROM pack_stickers WHERE pack_id=?').run(p.id); db.prepare('DELETE FROM pack_favs WHERE pack_id=?').run(p.id); db.prepare('DELETE FROM packs WHERE id=?').run(p.id); })();
 await c.reply('️ Paquete eliminado.');
 } },
 { name: 'stickerpacks', aliases: ['packlist'], desc: 'Lista de tus paquetes.',
 run: async (c) => {
 const rows = db.prepare('SELECT p.*, (SELECT COUNT(*) FROM pack_stickers WHERE pack_id=p.id) n FROM packs p WHERE owner=?').all(c.sender);
 await c.reply(rows.length ? ' *Tus paquetes*\n' + rows.map((p) => `• ${p.name} — ${p.n} stickers — ${p.public ? ' ' + p.slug : ''}`).join('\n') : 'No tienes paquetes.');
 } },
 { name: 'stickeradd', aliases: ['addsticker'], desc: 'Agregar un sticker a un paquete.', usage: '{sticker} [paquete]',
 run: async (c) => {
 if (needName(c)) return;
 const p = getPack(c.sender, c.text); if (!p) return c.reply(' Paquete no encontrado.');
 const m = await c.media(); if (!m || m.type !== 'stickerMessage') return c.reply('Responde a un sticker.');
 const h = sha1(m.buffer);
 if (db.prepare('SELECT 1 FROM pack_stickers WHERE pack_id=? AND hash=?').get(p.id, h)) return c.reply('Ese sticker ya está en el paquete.');
 if (db.prepare('SELECT COUNT(*) n FROM pack_stickers WHERE pack_id=?').get(p.id).n >= 60) return c.reply(' Máximo 60 stickers por paquete.');
 db.prepare('INSERT INTO pack_stickers(pack_id,hash,data) VALUES(?,?,?)').run(p.id, h, m.buffer);
 await c.reply(' Sticker agregado.');
 } },
 { name: 'stickerdel', aliases: ['delsticker'], desc: 'Eliminar un sticker de un paquete.', usage: '{sticker} [paquete]',
 run: async (c) => {
 if (needName(c)) return;
 const p = getPack(c.sender, c.text); if (!p) return c.reply(' Paquete no encontrado.');
 const m = await c.media(); if (!m || m.type !== 'stickerMessage') return c.reply('Responde a un sticker.');
 const r = db.prepare('DELETE FROM pack_stickers WHERE pack_id=? AND hash=?').run(p.id, sha1(m.buffer));
 await c.reply(r.changes ? '️ Sticker eliminado.' : 'Ese sticker no está en el paquete.');
 } },
 { name: 'getpack', aliases: ['stickerpack', 'pack'], desc: 'Descargar un paquete de stickers.', usage: '[paquete | public-slug]',
 run: async (c) => {
 if (needName(c)) return;
 const p = getPack(c.sender, c.text) || bySlug(c.text); if (!p) return c.reply(' Paquete no encontrado.');
 const rows = db.prepare('SELECT data FROM pack_stickers WHERE pack_id=? LIMIT 30').all(p.id);
 if (!rows.length) return c.reply('El paquete está vacío.');
 await c.reply(` Enviando *${p.name}* (${rows.length})...`);
 for (const r of rows) { await c.sock.sendMessage(c.chat, { sticker: r.data }); await sleep(600); }
 } },
 { name: 'setpackpublic', aliases: ['setpackpub', 'packpublic'], desc: 'Hacer público un paquete.', usage: '[paquete]',
 run: async (c) => {
 if (needName(c)) return; const p = getPack(c.sender, c.text); if (!p) return c.reply(' Paquete no encontrado.');
 db.prepare('UPDATE packs SET public=1 WHERE id=?').run(p.id); await c.reply(` Público. Slug: \`${p.slug}\``);
 } },
 { name: 'setpackprivate', aliases: ['setpackpriv', 'packprivate'], desc: 'Hacer privado un paquete.', usage: '[paquete]',
 run: async (c) => {
 if (needName(c)) return; const p = getPack(c.sender, c.text); if (!p) return c.reply(' Paquete no encontrado.');
 db.prepare('UPDATE packs SET public=0 WHERE id=?').run(p.id); await c.reply(' Paquete privado.');
 } },
 { name: 'setstickerpackdesc', aliases: ['setpackdesc', 'packdesc'], desc: 'Descripción de un paquete.', usage: '[paquete] | [descripción]',
 run: async (c) => {
 const [n, d] = c.text.split('|').map((s) => s.trim()); const p = n && getPack(c.sender, n);
 if (!p || !d) return c.reply(`Uso: ${c.prefix}packdesc paquete | descripción`);
 db.prepare('UPDATE packs SET description=? WHERE id=?').run(d.slice(0, 200), p.id); await c.reply(' Descripción guardada.');
 } },
 { name: 'packfavourite', aliases: ['setpackfav', 'packfav'], desc: 'Marcar un paquete público como favorito.', usage: '[public-slug]',
 run: async (c) => {
 const p = bySlug(c.args[0]); if (!p) return c.reply(' Slug público no encontrado.');
 db.prepare('INSERT OR IGNORE INTO pack_favs(jid,pack_id) VALUES(?,?)').run(c.sender, p.id); await c.reply(` *${p.name}* agregado a favoritos.`);
 } },
 { name: 'packunfavourite', aliases: ['unsetpackfav', 'packunfav'], desc: 'Quitar un paquete de favoritos.', usage: '[public-slug]',
 run: async (c) => {
 const p = bySlug(c.args[0]); if (!p) return c.reply(' Slug público no encontrado.');
 db.prepare('DELETE FROM pack_favs WHERE jid=? AND pack_id=?').run(c.sender, p.id); await c.reply(' Quitado de favoritos.');
 } },
];
