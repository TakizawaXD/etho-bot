import { db, getUser, setUser } from '../db.js';
import { config } from '../config.js';
import { fmt, jidNum, cd, timeLeft, rand } from '../lib/utils.js';

const cur = config.currency;
const lastRoll = new Map(); // chat -> { id, ts }
const pendingTrades = new Map(); // jid destino -> { from, mine, theirs, ts }

const like = (s) => `%${s.toLowerCase()}%`;
const findChar = (name) => db.prepare('SELECT * FROM characters WHERE lower(name) LIKE ? ORDER BY length(name) LIMIT 1').get(like(name));
const claimOf = (id, g) => db.prepare('SELECT * FROM claims WHERE char_id=? AND group_jid=?').get(id, g);
const mine = (name, g, owner) => db.prepare(`SELECT ch.*, cl.price FROM claims cl JOIN characters ch ON ch.id=cl.char_id
 WHERE cl.group_jid=? AND cl.owner=? AND lower(ch.name) LIKE ? LIMIT 1`).get(g, owner, like(name));

async function show(c, ch, text, mentions = []) {
 if (ch.image) {
 try { return await c.sock.sendMessage(c.chat, { image: { url: ch.image }, caption: text, mentions }, { quoted: c.msg }); } catch { /* texto */ }
 }
 await c.reply(text, mentions);
}
const page = (c, i = 0) => Math.max(1, parseInt(c.args[i]) || 1);

export default [
 { name: 'rollwaifu', aliases: ['rw', 'roll'], desc: 'Waifu o husbando aleatorio.',
 run: async (c) => {
 const ch = db.prepare('SELECT * FROM characters ORDER BY RANDOM() LIMIT 1').get();
 if (!ch) return c.reply('No hay personajes cargados.');
 const cl = claimOf(ch.id, c.chat);
 lastRoll.set(c.chat, { id: ch.id, ts: Date.now() });
 await show(c, ch, ` *${ch.name}*\n ${ch.series}\n Valor: ${fmt(ch.value)}\n${cl ? ` Reclamado por @${jidNum(cl.owner)}` : ` Libre — responde con ${c.prefix}claim`}`, cl ? [cl.owner] : []);
 } },
 { name: 'claim', aliases: ['c', 'reclamar'], desc: 'Reclamar el último personaje obtenido.',
 run: async (c) => {
 const r = lastRoll.get(c.chat);
 if (!r || Date.now() - r.ts > 120_000) return c.reply(`Primero usa ${c.prefix}roll (el personaje expira en 2 min).`);
 if (claimOf(r.id, c.chat)) return c.reply(' Ese personaje ya fue reclamado.');
 db.prepare('INSERT INTO claims(char_id,group_jid,owner) VALUES(?,?,?)').run(r.id, c.chat, c.sender);
 lastRoll.delete(c.chat);
 const ch = db.prepare('SELECT * FROM characters WHERE id=?').get(r.id);
 const msg = (c.user.claim_msg || '@user reclamó a *@char*').replaceAll('@user', `@${jidNum(c.sender)}`).replaceAll('@char', ch.name);
 await c.reply(` ${msg}`, [c.sender]);
 } },
 { name: 'harem', aliases: ['waifus', 'claims'], desc: 'Ver tus personajes reclamados.', usage: '<@mención> <página>',
 run: async (c) => {
 const jid = c.target || c.sender, p = page(c, c.args.length - 1);
 const rows = db.prepare(`SELECT ch.name, ch.value, cl.price FROM claims cl JOIN characters ch ON ch.id=cl.char_id
 WHERE cl.group_jid=? AND cl.owner=? ORDER BY ch.value DESC LIMIT 15 OFFSET ?`).all(c.chat, jid, (p - 1) * 15);
 if (!rows.length) return c.reply(' Sin personajes en esta página.');
 const total = db.prepare('SELECT COUNT(*) n FROM claims WHERE group_jid=? AND owner=?').get(c.chat, jid).n;
 await c.reply(` *Harem de @${jidNum(jid)}* (${total}) — pág. ${p}\n` + rows.map((r, i) => `${(p - 1) * 15 + i + 1}. ${r.name} — ${fmt(r.value)}${r.price ? ` ️${fmt(r.price)}` : ''}`).join('\n'), [jid]);
 } },
 { name: 'charinfo', aliases: ['winfo', 'waifuinfo'], desc: 'Información de un personaje.', usage: '[nombre]',
 run: async (c) => {
 const ch = c.text && findChar(c.text); if (!ch) return c.reply(' Personaje no encontrado.');
 const cl = claimOf(ch.id, c.chat);
 await show(c, ch, ` *${ch.name}*\n ${ch.series}\n ${ch.gender || '—'}\n Valor: ${fmt(ch.value)}\n️ Votos: ${ch.votes}\n Dueño: ${cl ? '@' + jidNum(cl.owner) : 'Libre'}`, cl ? [cl.owner] : []);
 } },
 { name: 'charimage', aliases: ['waifuimage', 'cimage', 'wimage'], desc: 'Ver una imagen del personaje.', usage: '[nombre]',
 run: async (c) => {
 const ch = c.text && findChar(c.text); if (!ch) return c.reply(' Personaje no encontrado.');
 if (!ch.image) return c.reply('️ Este personaje aún no tiene imagen (edita data/characters.json).');
 await show(c, ch, `️ ${ch.name}`);
 } },
 { name: 'charvideo', aliases: ['waifuvideo', 'cvideo', 'wvideo'], desc: 'Ver un video del personaje.', usage: '[nombre]',
 run: async (c) => c.reply('️ Este personaje no tiene videos cargados.') },
 { name: 'sell', aliases: ['vender'], desc: 'Poner un personaje a la venta.', usage: '[precio] [nombre]',
 run: async (c) => {
 const price = parseInt(c.args[0]), name = c.args.slice(1).join(' ');
 if (!(price > 0) || !name) return c.reply(`Uso: ${c.prefix}sell [precio] [nombre]`);
 const ch = mine(name, c.chat, c.sender); if (!ch) return c.reply(' No tienes ese personaje.');
 db.prepare('UPDATE claims SET price=? WHERE char_id=? AND group_jid=?').run(price, ch.id, c.chat);
 await c.reply(`️ *${ch.name}* en venta por ${fmt(price)} ${cur}.`);
 } },
 { name: 'removesale', aliases: ['removerventa'], desc: 'Quitar un personaje de la venta.', usage: '[nombre]',
 run: async (c) => {
 const ch = c.text && mine(c.text, c.chat, c.sender); if (!ch) return c.reply(' No tienes ese personaje.');
 db.prepare('UPDATE claims SET price=NULL WHERE char_id=? AND group_jid=?').run(ch.id, c.chat);
 await c.reply(` *${ch.name}* ya no está en venta.`);
 } },
 { name: 'haremshop', aliases: ['tiendawaifus', 'wshop'], desc: 'Ver los personajes en venta.', usage: '<página>',
 run: async (c) => {
 const p = page(c);
 const rows = db.prepare(`SELECT ch.name, cl.price, cl.owner FROM claims cl JOIN characters ch ON ch.id=cl.char_id
 WHERE cl.group_jid=? AND cl.price IS NOT NULL ORDER BY cl.price LIMIT 10 OFFSET ?`).all(c.chat, (p - 1) * 10);
 if (!rows.length) return c.reply(' No hay personajes en venta.');
 await c.reply(` *Tienda* (pág. ${p})\n` + rows.map((r) => `• ${r.name} — ${fmt(r.price)} ${cur} (@${jidNum(r.owner)})`).join('\n'), rows.map((r) => r.owner));
 } },
 { name: 'buycharacter', aliases: ['buychar', 'buyc'], desc: 'Comprar un personaje en venta.', usage: '[nombre]',
 run: async (c) => {
 const row = c.text && db.prepare(`SELECT cl.*, ch.name FROM claims cl JOIN characters ch ON ch.id=cl.char_id
 WHERE cl.group_jid=? AND cl.price IS NOT NULL AND lower(ch.name) LIKE ? LIMIT 1`).get(c.chat, like(c.text));
 if (!row) return c.reply(' Ese personaje no está en venta.');
 if (row.owner === c.sender) return c.reply('Ya es tuyo.');
 if (c.user.coins < row.price) return c.reply(` Necesitas ${fmt(row.price)} ${cur} en la cartera.`);
 const seller = getUser(row.owner);
 db.transaction(() => {
 setUser(c.sender, { coins: c.user.coins - row.price });
 setUser(row.owner, { coins: seller.coins + row.price });
 db.prepare('UPDATE claims SET owner=?, price=NULL WHERE char_id=? AND group_jid=?').run(c.sender, row.char_id, c.chat);
 })();
 await c.reply(`️ Compraste a *${row.name}* por ${fmt(row.price)} ${cur}.`);
 } },
 { name: 'givechar', aliases: ['givewaifu', 'regalar'], desc: 'Regalar un personaje.', usage: '[@mención] [nombre]',
 run: async (c) => {
 const name = c.args.filter((a) => !a.startsWith('@')).join(' ');
 if (!c.target || c.target === c.sender || !name) return c.reply(`Uso: ${c.prefix}givechar @usuario [nombre]`);
 const ch = mine(name, c.chat, c.sender); if (!ch) return c.reply(' No tienes ese personaje.');
 db.prepare('UPDATE claims SET owner=?, price=NULL WHERE char_id=? AND group_jid=?').run(c.target, ch.id, c.chat);
 await c.reply(` Regalaste a *${ch.name}* a @${jidNum(c.target)}.`, [c.target]);
 } },
 { name: 'giveallharem', desc: 'Regalar todos tus personajes.', usage: '[@mención]',
 run: async (c) => {
 if (!c.target || c.target === c.sender) return c.reply(`Uso: ${c.prefix}giveallharem @usuario`);
 const r = db.prepare('UPDATE claims SET owner=?, price=NULL WHERE group_jid=? AND owner=?').run(c.target, c.chat, c.sender);
 await c.reply(` Transferiste ${r.changes} personaje(s) a @${jidNum(c.target)}.`, [c.target]);
 } },
 { name: 'deletewaifu', aliases: ['delwaifu', 'delchar'], desc: 'Eliminar un personaje reclamado.', usage: '[nombre]',
 run: async (c) => {
 const ch = c.text && mine(c.text, c.chat, c.sender); if (!ch) return c.reply(' No tienes ese personaje.');
 db.prepare('DELETE FROM claims WHERE char_id=? AND group_jid=?').run(ch.id, c.chat);
 await c.reply(`️ *${ch.name}* fue liberado.`);
 } },
 { name: 'trade', aliases: ['intercambiar'], desc: 'Intercambiar un personaje con otro usuario.', usage: '[tu personaje] / [personaje 2] @usuario | accept',
 run: async (c) => {
 if ((c.args[0] || '').toLowerCase() === 'accept') {
 const t = pendingTrades.get(c.sender);
 if (!t || Date.now() - t.ts > 120_000) return c.reply('No tienes intercambios pendientes.');
 pendingTrades.delete(c.sender);
 const a = mine(t.mine, c.chat, t.from), b = mine(t.theirs, c.chat, c.sender);
 if (!a || !b) return c.reply(' Alguno de los personajes ya no está disponible.');
 db.transaction(() => {
 db.prepare('UPDATE claims SET owner=?, price=NULL WHERE char_id=? AND group_jid=?').run(c.sender, a.id, c.chat);
 db.prepare('UPDATE claims SET owner=?, price=NULL WHERE char_id=? AND group_jid=?').run(t.from, b.id, c.chat);
 })();
 return c.reply(` Intercambio hecho: *${a.name}* ⇄ *${b.name}*`);
 }
 const [m, t2] = c.args.filter((a) => !a.startsWith('@')).join(' ').split('/').map((s) => s?.trim());
 if (!c.target || !m || !t2) return c.reply(`Uso: ${c.prefix}trade [tu personaje] / [su personaje] @usuario`);
 if (!mine(m, c.chat, c.sender) || !mine(t2, c.chat, c.target)) return c.reply(' Verifica que ambos personajes existan y sean de cada dueño.');
 pendingTrades.set(c.target, { from: c.sender, mine: m, theirs: t2, ts: Date.now() });
 await c.reply(` @${jidNum(c.target)}, @${jidNum(c.sender)} propone: *${m}* por *${t2}*.\nAcepta con *${c.prefix}trade accept* (2 min).`, [c.target, c.sender]);
 } },
 { name: 'vote', aliases: ['votar'], desc: 'Votar por un personaje para subir su valor.', usage: '[nombre]',
 run: async (c) => {
 const left = cd(c.user.last_vote, 3600e3); if (left) return c.reply(` Podrás votar en ${timeLeft(left)}.`);
 const ch = c.text && findChar(c.text); if (!ch) return c.reply(' Personaje no encontrado.');
 const up = rand(5, 15);
 db.prepare('UPDATE characters SET votes=votes+1, value=value+? WHERE id=?').run(up, ch.id);
 setUser(c.sender, { last_vote: Date.now() });
 await c.reply(`️ Votaste por *${ch.name}* (+${up} de valor).`);
 } },
 { name: 'favoritetop', aliases: ['favtop'], desc: 'Top de personajes favoritos.',
 run: async (c) => {
 const rows = db.prepare('SELECT ch.name, COUNT(*) n FROM users u JOIN characters ch ON ch.id=u.fav GROUP BY ch.id ORDER BY n DESC LIMIT 10').all();
 await c.reply(rows.length ? ' *Favoritos*\n' + rows.map((r, i) => `${i + 1}. ${r.name} — ${r.n}`).join('\n') : 'Nadie ha elegido favoritos todavía.');
 } },
 { name: 'waifusboard', aliases: ['waifustop', 'topwaifus', 'wtop'], desc: 'Top de personajes con mayor valor.', usage: '<página>',
 run: async (c) => {
 const p = page(c);
 const rows = db.prepare('SELECT name, series, value FROM characters ORDER BY value DESC LIMIT 10 OFFSET ?').all((p - 1) * 10);
 await c.reply(rows.length ? ` *Top valor* (pág. ${p})\n` + rows.map((r, i) => `${(p - 1) * 10 + i + 1}. ${r.name} (${r.series}) — ${fmt(r.value)}`).join('\n') : 'Sin datos.');
 } },
 { name: 'gachainfo', aliases: ['ginfo', 'infogacha'], desc: 'Ver tu información de gacha.',
 run: async (c) => {
 const rows = db.prepare('SELECT ch.value, cl.price FROM claims cl JOIN characters ch ON ch.id=cl.char_id WHERE cl.group_jid=? AND cl.owner=?').all(c.chat, c.sender);
 await c.reply(` *Tu gacha*\n• Personajes: ${rows.length}\n• Valor total: ${fmt(rows.reduce((s, r) => s + r.value, 0))}\n• En venta: ${rows.filter((r) => r.price).length}\n• Votar: ${cd(c.user.last_vote, 3600e3) ? 'en espera' : 'disponible'}`);
 } },
 { name: 'serieinfo', aliases: ['ainfo'], desc: 'Información de un anime (catálogo local del gacha).', usage: '[nombre] <page=número>',
 run: async (c) => {
 const q = c.args.filter((a) => !a.startsWith('page=')).join(' '), p = parseInt((c.args.find((a) => a.startsWith('page=')) || '').slice(5)) || 1;
 const rows = q ? db.prepare('SELECT name, value FROM characters WHERE lower(series) LIKE ? ORDER BY value DESC LIMIT 15 OFFSET ?').all(like(q), (p - 1) * 15) : [];
 await c.reply(rows.length ? ` *${q}* (pág. ${p})\n` + rows.map((r) => `• ${r.name} — ${fmt(r.value)}`).join('\n') : ' Serie no encontrada.');
 } },
 { name: 'serielist', aliases: ['slist', 'animelist'], desc: 'Listar series del bot.', usage: '<página>',
 run: async (c) => {
 const p = page(c);
 const rows = db.prepare('SELECT series, COUNT(*) n FROM characters GROUP BY series ORDER BY series LIMIT 20 OFFSET ?').all((p - 1) * 20);
 await c.reply(rows.length ? ` *Series* (pág. ${p})\n` + rows.map((r) => `• ${r.series} (${r.n})`).join('\n') : 'Sin datos.');
 } },
 { name: 'setclaimmsg', aliases: ['setclaim'], desc: 'Mensaje al reclamar. Variables: @user @char.', usage: '[texto]',
 run: async (c) => { if (!c.text) return c.reply('Uso: #setclaimmsg @user reclamó a @char'); setUser(c.sender, { claim_msg: c.text.slice(0, 200) }); await c.reply(' Mensaje guardado.'); } },
 { name: 'delclaimmsg', desc: 'Restablecer el mensaje al reclamar.',
 run: async (c) => { setUser(c.sender, { claim_msg: null }); await c.reply(' Mensaje restablecido.'); } },
];
