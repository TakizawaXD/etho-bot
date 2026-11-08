import { db, getUser, setUser } from '../db.js';
import { fmt, jidNum, levelOf, expForLevel } from '../lib/utils.js';

const proposals = new Map(); // jid destinatario -> { from, ts }

function daysUntil(birth) {
 const [d, m] = birth.split('/').map(Number);
 const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
 let next = new Date(now.getFullYear(), m - 1, d);
 if (next < today) next = new Date(now.getFullYear() + 1, m - 1, d);
 return Math.round((next - today) / 864e5);
}
const validBirth = (s) => {
 const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(s || '');
 if (!m) return false;
 const d = +m[1], mo = +m[2];
 return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(2024, mo, 0).getDate();
};
async function birthdayList(c, onlyNear) {
 let rows = db.prepare('SELECT jid, birth FROM users WHERE birth IS NOT NULL').all();
 if (c.isGroup && c.meta) {
 const ids = new Set(c.meta.participants.flatMap((p) => [p.id, p.lid, p.jid, p.phoneNumber].filter(Boolean).map((x) => x.replace(/:\d+@/, '@'))));
 rows = rows.filter((r) => ids.has(r.jid));
 }
 rows = rows.map((r) => ({ ...r, days: daysUntil(r.birth) })).sort((a, b) => a.days - b.days);
 if (onlyNear) rows = rows.filter((r) => r.days <= 30);
 if (!rows.length) return c.reply(' No hay cumpleaños para mostrar.');
 await c.reply(' *Cumpleaños*\n' + rows.slice(0, 20).map((r) => `• @${jidNum(r.jid)} — ${r.birth.slice(0, 5)} (${r.days === 0 ? '¡hoy!' : `en ${r.days} días`})`).join('\n'), rows.map((r) => r.jid));
}

export default [
 { name: 'profile', desc: 'Ver tu perfil.', usage: '<@mención>',
 run: async (c) => {
 const jid = c.target || c.sender, u = getUser(jid);
 const fav = u.fav ? db.prepare('SELECT name FROM characters WHERE id=?').get(u.fav)?.name : null;
 const chars = db.prepare('SELECT COUNT(*) n FROM claims WHERE owner=?').get(jid).n;
 await c.reply(`🪪 *Perfil de @${jidNum(jid)}*\n📝 ${u.description || 'Sin descripción'}\n👤 Género: ${u.genre || '—'}\n🎂 Cumpleaños: ${u.birth || '—'}\n💍 Pareja: ${u.partner ? '@' + jidNum(u.partner) : 'Soltero/a'}\n🌟 Favorito: ${fav || '—'}\n🎴 Personajes: ${chars}\n⭐ Nivel: ${levelOf(u.exp)} (${fmt(u.exp)} XP)\n💰 Total: ${fmt(u.coins + u.bank)}`, [jid, ...(u.partner ? [u.partner] : [])]);
 } },
 { name: 'level', aliases: ['lvl'], desc: 'Ver tu nivel y experiencia.', usage: '<@mención>',
 run: async (c) => {
 const jid = c.target || c.sender, u = getUser(jid), l = levelOf(u.exp);
 const cur = u.exp - expForLevel(l), need = expForLevel(l + 1) - expForLevel(l), pct = Math.min(10, Math.floor((cur / need) * 10));
 await c.reply(` *@${jidNum(jid)}* — Nivel ${l}\n[${'█'.repeat(pct)}${'░'.repeat(10 - pct)}] ${fmt(cur)}/${fmt(need)} XP`, [jid]);
 } },
 { name: 'leaderboard', aliases: ['lboard', 'top'], desc: 'Top de usuarios con más experiencia.', usage: '<página>',
 run: async (c) => {
 const p = Math.max(1, parseInt(c.args[0]) || 1);
 const rows = db.prepare('SELECT jid, exp FROM users ORDER BY exp DESC LIMIT 10 OFFSET ?').all((p - 1) * 10);
 if (!rows.length) return c.reply('No hay datos.');
 await c.reply(` *Top XP* (pág. ${p})\n` + rows.map((r, i) => `${(p - 1) * 10 + i + 1}. @${jidNum(r.jid)} — Nv ${levelOf(r.exp)} (${fmt(r.exp)} XP)`).join('\n'), rows.map((r) => r.jid));
 } },
 { name: 'setdescription', aliases: ['setdesc'], desc: 'Establecer tu descripción.', usage: '<descripción>',
 run: async (c) => {
 if (!c.text) return c.reply(`Uso: ${c.prefix}setdesc <texto>`);
 setUser(c.sender, { description: c.text.slice(0, 200) }); await c.reply(' Descripción actualizada.');
 } },
 { name: 'setbirth', desc: 'Establecer tu fecha de cumpleaños.', usage: '[DD/MM/AAAA]',
 run: async (c) => {
 if (!validBirth(c.args[0])) return c.reply(`Uso: ${c.prefix}setbirth 25/12/2000 (o 25/12)`);
 setUser(c.sender, { birth: c.args[0] }); await c.reply(' Cumpleaños guardado.');
 } },
 { name: 'delbirth', desc: 'Borrar tu fecha de cumpleaños.', run: async (c) => { setUser(c.sender, { birth: null }); await c.reply('️ Cumpleaños eliminado.'); } },
 { name: 'birthdays', aliases: ['cumpleaños', 'births'], desc: 'Ver cumpleaños cercanos.', run: (c) => birthdayList(c, true) },
 { name: 'allbirthdays', aliases: ['allbirths'], desc: 'Ver todos los cumpleaños.', run: (c) => birthdayList(c, false) },
 { name: 'setgenre', desc: 'Establecer tu género.', usage: '[hombre | mujer | otro]',
 run: async (c) => {
 const g = (c.args[0] || '').toLowerCase();
 if (!['hombre', 'mujer', 'otro'].includes(g)) return c.reply(`Uso: ${c.prefix}setgenre hombre|mujer|otro`);
 setUser(c.sender, { genre: g }); await c.reply(' Género actualizado.');
 } },
 { name: 'delgenre', desc: 'Eliminar tu género.', run: async (c) => { setUser(c.sender, { genre: null }); await c.reply('️ Género eliminado.'); } },
 { name: 'setfavourite', aliases: ['setfav'], desc: 'Establecer tu personaje reclamado favorito.', usage: '[nombre]',
 run: async (c) => {
 const ch = db.prepare('SELECT ch.* FROM claims cl JOIN characters ch ON ch.id=cl.char_id WHERE cl.owner=? AND lower(ch.name) LIKE ? LIMIT 1').get(c.sender, `%${c.text.toLowerCase()}%`);
 if (!c.text || !ch) return c.reply(' No tienes ese personaje.');
 setUser(c.sender, { fav: ch.id }); await c.reply(` *${ch.name}* es ahora tu favorito.`);
 } },
 { name: 'delfavourite', aliases: ['delfav'], desc: 'Eliminar tu personaje favorito.', run: async (c) => { setUser(c.sender, { fav: null }); await c.reply('️ Favorito eliminado.'); } },
 { name: 'marry', aliases: ['casarse'], desc: 'Casarte con alguien.', usage: '[@mención]',
 run: async (c) => {
 if (!c.target || c.target === c.sender) return c.reply(`Uso: ${c.prefix}marry @usuario`);
 const t = getUser(c.target);
 if (c.user.partner) return c.reply(' Ya estás casado/a. Usa #divorce primero.');
 if (t.partner) return c.reply(' Esa persona ya está casada.');
 const p = proposals.get(c.sender);
 if (p && p.from === c.target && Date.now() - p.ts < 120_000) {
 proposals.delete(c.sender);
 setUser(c.sender, { partner: c.target }); setUser(c.target, { partner: c.sender });
 db.prepare('INSERT INTO marriages(a,b,started) VALUES(?,?,?)').run(c.sender, c.target, Date.now());
 return c.reply(` ¡@${jidNum(c.sender)} y @${jidNum(c.target)} ahora están casados!`, [c.sender, c.target]);
 }
 proposals.set(c.target, { from: c.sender, ts: Date.now() });
 await c.reply(` @${jidNum(c.target)}, @${jidNum(c.sender)} te propone matrimonio.\nResponde con *${c.prefix}marry @${jidNum(c.sender)}* en 2 minutos para aceptar.`, [c.target, c.sender]);
 } },
 { name: 'divorce', desc: 'Divorciarte de tu pareja.',
 run: async (c) => {
 const p = c.user.partner; if (!p) return c.reply('No estás casado/a.');
 setUser(c.sender, { partner: null }); setUser(p, { partner: null });
 db.prepare('UPDATE marriages SET ended=? WHERE ended IS NULL AND ((a=? AND b=?) OR (a=? AND b=?))').run(Date.now(), c.sender, p, p, c.sender);
 await c.reply(` Te divorciaste de @${jidNum(p)}.`, [p]);
 } },
 { name: 'marryhistory', aliases: ['marriagehistory', 'historialmatrimonio'], desc: 'Historial de matrimonios.', usage: '<@mención>',
 run: async (c) => {
 const jid = c.target || c.sender;
 const rows = db.prepare('SELECT * FROM marriages WHERE a=? OR b=? ORDER BY started DESC LIMIT 15').all(jid, jid);
 if (!rows.length) return c.reply(' Sin matrimonios registrados.');
 const m = [];
 await c.reply(` *Historial de @${jidNum(jid)}*\n` + rows.map((r) => { const o = r.a === jid ? r.b : r.a; m.push(o); return `• @${jidNum(o)} — ${new Date(r.started).toLocaleDateString('es-ES')} ${r.ended ? '→ ' + new Date(r.ended).toLocaleDateString('es-ES') : '(actual)'}`; }).join('\n'), [jid, ...m]);
 } },
 { name: 'group', aliases: ['gp', 'groupinfo'], desc: 'Información del grupo.', group: true,
 run: async (c) => {
 const g = c.group, m = c.meta, on = (v) => (v ? '✅' : '❌');
 await c.reply(`👥 *${m.subject}*\n• 👤 Miembros: ${m.participants.length}\n• 🛡️ Admins: ${m.participants.filter((p) => p.admin).length}\n• 🤖 Bot: ${on(g.bot_on)} | 🚫 Antilink: ${on(g.antilink)}\n• 👋 Bienvenida: ${on(g.welcome)} | 🚪 Despedida: ${on(g.goodbye)}\n• 💰 Economía: ${on(g.economy)} | 🎴 Gacha: ${on(g.gacha)}\n• 🔒 Solo admins: ${on(g.onlyadmin)}\n• ⚠️ Límite de warns: ${g.warn_limit}`);
 } },
];
