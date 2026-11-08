import { db, setGroup } from '../db.js';
import { jidNum } from '../lib/utils.js';

const toggle = (name, aliases, field, label, extra = {}) => ({
 name, aliases, desc: `Activar/desactivar ${label}.`, usage: '[on/off]', group: true, admin: true, ...extra,
 run: async (c) => {
 const a = (c.args[0] || '').toLowerCase();
 if (!['on', 'off'].includes(a)) return c.reply(`${label}: ${c.group[field] ? '✅ activado' : '❌ desactivado'}\nUso: ${c.prefix}${name} on/off`);
 setGroup(c.chat, { [field]: a === 'on' ? 1 : 0 });
 await c.reply(`${a === 'on' ? '✅' : '🔒'} ${label} ${a === 'on' ? 'activado' : 'desactivado'}.`);
 },
});
const needTarget = (c) => { if (!c.target) { c.reply(`Menciona o responde a un usuario. Ej: ${c.prefix}${c.command} @usuario`); return true; } };
const participantAction = (name, aliases, desc, action, okText) => ({
 name, aliases, desc, usage: '[@mención | {mensaje}]', group: true, admin: true, botAdmin: true,
 run: async (c) => {
 if (needTarget(c)) return;
 await c.sock.groupParticipantsUpdate(c.chat, [c.target], action);
 c.refreshMeta();
 await c.reply(`${okText} @${jidNum(c.target)}`, [c.target]);
 },
});
const gDays = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);

export default [
 { name: 'listadmins', aliases: ['admins'], desc: 'Listar los administradores del grupo.', group: true,
 run: async (c) => {
 const a = c.meta.participants.filter((p) => p.admin).map((p) => p.id);
 await c.reply(`️ *Admins (${a.length})*\n` + a.map((j, i) => `${i + 1}. @${jidNum(j)}`).join('\n'), a);
 } },
 { name: 'setrules', desc: 'Establecer las reglas del grupo.', usage: '[texto]', group: true, admin: true,
 run: async (c) => { if (!c.text) return c.reply('Uso: #setrules 1. Respeto 2. Sin spam'); setGroup(c.chat, { rules: c.text.slice(0, 1500) }); await c.reply(' Reglas guardadas. Se ven con #rules.'); } },
 { name: 'rules', aliases: ['reglas'], desc: 'Ver las reglas del grupo.', group: true,
 run: async (c) => c.reply(c.group.rules ? ` *Reglas de ${c.meta.subject}*\n${c.group.rules}` : 'Este grupo aún no tiene reglas. Un admin puede usar #setrules.') },
 toggle('antilink', ['antienlace'], 'antilink', 'el antilink'),
 toggle('antispam', [], 'antispam', 'el antispam (flood)'),
 { ...toggle('bot', [], 'bot_on', 'el bot') },
 toggle('economy', ['economia'], 'economy', 'los comandos de economía'),
 toggle('gacha', [], 'gacha', 'los comandos de Gacha'),
 toggle('goodbye', ['despedida'], 'goodbye', 'el mensaje de despedida'),
 toggle('welcome', ['bienvenida'], 'welcome', 'el mensaje de bienvenida'),
 toggle('nsfw', [], 'nsfw', 'los comandos NSFW'),
 toggle('onlyadmin', ['onlyadmins'], 'onlyadmin', 'el modo solo administradores'),
 { name: 'close', desc: 'Cerrar el grupo.', group: true, admin: true, botAdmin: true,
 run: async (c) => { await c.sock.groupSettingUpdate(c.chat, 'announcement'); await c.reply(' Grupo cerrado: solo admins pueden escribir.'); } },
 { name: 'open', desc: 'Abrir el grupo.', group: true, admin: true, botAdmin: true,
 run: async (c) => { await c.sock.groupSettingUpdate(c.chat, 'not_announcement'); await c.reply(' Grupo abierto.'); } },
 participantAction('kick', [], 'Expulsar a un usuario.', 'remove', ' Expulsado:'),
 participantAction('promote', [], 'Promover a administrador.', 'promote', '️ Ahora es admin:'),
 participantAction('demote', [], 'Degradar a un administrador.', 'demote', '️ Ya no es admin:'),
 { name: 'groupimage', aliases: ['groupimg', 'gpimg', 'setgroupimage'], desc: 'Cambiar la imagen del grupo.', usage: '{imagen}', group: true, admin: true, botAdmin: true,
 run: async (c) => {
 const m = await c.media();
 if (!m || m.type !== 'imageMessage') return c.reply('Envía o responde a una imagen.');
 await c.sock.updateProfilePicture(c.chat, m.buffer); await c.reply('️ Imagen del grupo actualizada.');
 } },
 { name: 'setwelcome', desc: 'Mensaje de bienvenida personalizado. Variables: {user} {group}.', usage: '[texto]', group: true, admin: true,
 run: async (c) => { if (!c.text) return c.reply('Uso: #setwelcome Hola {user}, bienvenido a {group}'); setGroup(c.chat, { welcome_msg: c.text.slice(0, 500) }); await c.reply(' Mensaje de bienvenida guardado.'); } },
 { name: 'setgoodbye', desc: 'Mensaje de despedida personalizado.', usage: '[texto]', group: true, admin: true,
 run: async (c) => { if (!c.text) return c.reply('Uso: #setgoodbye Adiós {user}'); setGroup(c.chat, { goodbye_msg: c.text.slice(0, 500) }); await c.reply(' Mensaje de despedida guardado.'); } },
 { name: 'setwarnlimit', desc: 'Límite de advertencias antes de expulsar.', usage: '<cantidad>', group: true, admin: true,
 run: async (c) => {
 const n = parseInt(c.args[0]);
 if (!(n >= 1 && n <= 20)) return c.reply('Indica un número entre 1 y 20.');
 setGroup(c.chat, { warn_limit: n }); await c.reply(` Límite de warns: ${n}.`);
 } },
 { name: 'warn', desc: 'Dar una advertencia.', usage: '[@mención | {mensaje}] <razón>', group: true, admin: true,
 run: async (c) => {
 if (needTarget(c)) return;
 const reason = c.args.filter((a) => !a.startsWith('@')).join(' ').slice(0, 120) || 'Sin razón';
 db.prepare('INSERT INTO warns(group_jid,jid,reason,ts) VALUES(?,?,?,?)').run(c.chat, c.target, reason, Date.now());
 const n = db.prepare('SELECT COUNT(*) n FROM warns WHERE group_jid=? AND jid=?').get(c.chat, c.target).n;
 await c.reply(`️ @${jidNum(c.target)} recibió una advertencia (${n}/${c.group.warn_limit}).\nRazón: ${reason}`, [c.target]);
 if (n >= c.group.warn_limit && c.isBotAdmin) {
 await c.sock.groupParticipantsUpdate(c.chat, [c.target], 'remove');
 db.prepare('DELETE FROM warns WHERE group_jid=? AND jid=?').run(c.chat, c.target);
 await c.reply(` @${jidNum(c.target)} fue expulsado por alcanzar el límite.`, [c.target]);
 }
 } },
 { name: 'warns', desc: 'Ver advertencias de un usuario.', usage: '[@mención | {mensaje}]', group: true, admin: true,
 run: async (c) => {
 if (needTarget(c)) return;
 const rows = db.prepare('SELECT * FROM warns WHERE group_jid=? AND jid=? ORDER BY id').all(c.chat, c.target);
 await c.reply(rows.length ? `️ *Warns de @${jidNum(c.target)}*\n` + rows.map((r, i) => `${i + 1}. ${r.reason}`).join('\n') : 'Sin advertencias.', [c.target]);
 } },
 { name: 'delwarn', desc: 'Eliminar una advertencia.', usage: '[@mención] [número]', group: true, admin: true,
 run: async (c) => {
 if (needTarget(c)) return;
 const rows = db.prepare('SELECT id FROM warns WHERE group_jid=? AND jid=? ORDER BY id').all(c.chat, c.target);
 const idx = parseInt(c.args.find((a) => /^\d{1,3}$/.test(a))) || rows.length;
 const row = rows[idx - 1];
 if (!row) return c.reply('No hay esa advertencia.');
 db.prepare('DELETE FROM warns WHERE id=?').run(row.id); await c.reply(' Advertencia eliminada.');
 } },
 { name: 'tag', aliases: ['hidetag', 'tagsay', 'tagall'], desc: 'Mencionar a todos los usuarios.', usage: '[texto | {mensaje}]', group: true, admin: true,
 run: async (c) => {
 const ids = c.meta.participants.map((p) => p.id);
 const text = c.text || c.quoted?.message?.conversation || c.quoted?.message?.extendedTextMessage?.text || ' Atención';
 const visible = c.command === 'tagall' ? '\n' + ids.map((i) => `@${jidNum(i)}`).join(' ') : '';
 await c.sock.sendMessage(c.chat, { text: text + visible, mentions: ids });
 } },
 { name: 'msgcount', aliases: ['count', 'messages', 'mensajes'], desc: 'Conteo de mensajes de un usuario.', usage: '<@mención> <días>', group: true, admin: true,
 run: async (c) => {
 const jid = c.target || c.sender, days = parseInt(c.args.find((a) => /^\d{1,3}$/.test(a))) || 7;
 const n = db.prepare('SELECT COALESCE(SUM(count),0) n FROM msg_daily WHERE group_jid=? AND jid=? AND day>=?').get(c.chat, jid, gDays(days)).n;
 await c.reply(` @${jidNum(jid)} envió *${n}* mensajes en los últimos ${days} día(s).`, [jid]);
 } },
 { name: 'topcount', aliases: ['topmessages', 'topmsgcount', 'topmensajes'], desc: 'Top de usuarios con más mensajes.', usage: '<días>', group: true, admin: true,
 run: async (c) => {
 const days = parseInt(c.args[0]) || 7;
 const rows = db.prepare('SELECT jid, SUM(count) n FROM msg_daily WHERE group_jid=? AND day>=? GROUP BY jid ORDER BY n DESC LIMIT 10').all(c.chat, gDays(days));
 if (!rows.length) return c.reply('Sin datos todavía.');
 await c.reply(` *Top mensajes (${days} días)*\n` + rows.map((r, i) => `${i + 1}. @${jidNum(r.jid)} — ${r.n}`).join('\n'), rows.map((r) => r.jid));
 } },
 { name: 'topinactive', aliases: ['topinactivos', 'topinactiveusers'], desc: 'Top de usuarios más inactivos.', usage: '<página> <días>', group: true, admin: true,
 run: async (c) => {
 const page = Math.max(1, parseInt(c.args[0]) || 1), days = parseInt(c.args[1]) || 30;
 const active = new Set(db.prepare('SELECT DISTINCT jid FROM msg_daily WHERE group_jid=? AND day>=?').all(c.chat, gDays(days)).map((r) => r.jid));
 const idle = c.meta.participants.map((p) => p.id).filter((id) => !active.has(id.replace(/:\d+@/, '@')));
 const slice = idle.slice((page - 1) * 15, page * 15);
 if (!slice.length) return c.reply(' Sin usuarios inactivos en esta página.');
 await c.reply(` *Inactivos (${days} días)* — ${idle.length} en total\n` + slice.map((j, i) => `${(page - 1) * 15 + i + 1}. @${jidNum(j)}`).join('\n'), slice);
 } },
];
