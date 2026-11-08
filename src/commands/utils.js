import { db, getBotAIContext, getChatHistory, getUserFacts } from '../db.js';
import { config } from '../config.js';
import { commands, categories } from './index.js';
import { fmt, jidNum, levelOf, expForLevel, pick, webpToPng } from '../lib/utils.js';
import { bar, row, getCategoryEmoji, getCommandEmoji, SEP_BOLD, SEP_LINE, SEP_DOT } from '../lib/ui.js';
import { askAI } from '../lib/ai.js';

const joinCmds = (items) => items.join(`\n${SEP_DOT}\n`);

export default [
 { name: 'menu', aliases: ['help', 'comandos', 'commands', 'ayuda', 'etho'], desc: 'Muestra el menú organizado de comandos disponibles.', usage: '[categoría]',
 run: async (c) => {
 const P = c.prefix;
 const botName = c.botName || config.botName || 'Etho';
 const q = (c.text || '').toLowerCase().trim();

 if (!q) {
 let out = [
 `${SEP_BOLD}`,
 `📋 *MENÚ DE COMANDOS — ${botName.toUpperCase()}*`,
 `🔑 *Prefijo:* \`${P}\`  │  👤 *Usuario:* ${c.name || 'Usuario'}`,
 `${SEP_BOLD}`,
 ``,
 `⚡ *1. PRODUCTIVIDAD & ASISTENCIA*`,
 `${SEP_LINE}`,
 joinCmds([
 `🤖 *${P}ia* <mensaje> — Consulta inteligente con IA`,
 `⏰ *${P}recordar* <tiempo> <texto> — Crear recordatorio`,
 `📝 *${P}nota* <add|list|del> — Bloc de notas personal`,
 `🧮 *${P}calc* <operación> — Calculadora rápida`,
 `🌤️ *${P}clima* <ciudad> — Pronóstico del tiempo`,
 `🌐 *${P}traducir* <es|en> <texto> — Traductor`
 ]),
 ``,
 `${SEP_BOLD}`,
 `🛡️ *2. ADMINISTRACIÓN DE GRUPO*`,
 `${SEP_LINE}`,
 joinCmds([
 `📣 *${P}tagall* [motivo] — Mencionar a todos`,
 `📢 *${P}hidetag* [texto] — Aviso masivo limpio`,
 `🚫 *${P}antilink* <on|off> — Bloqueo de enlaces`,
 `🛡️ *${P}antispam* <on|off> — Protección anti-flood`,
 `🥾 *${P}kick* @mención — Expulsar miembro`,
 `⚠️ *${P}warn* @mención — Dar advertencia`
 ]),
 ``,
 `${SEP_BOLD}`,
 `🎨 *3. MULTIMEDIA, TIENDA & UTILIDADES*`,
 `${SEP_LINE}`,
 joinCmds([
 `🖼️ *${P}s* — Convertir foto o video a sticker`,
 `🏞️ *${P}toimg* — Convertir sticker a imagen PNG`,
 `🔳 *${P}qr* <texto> — Generar código QR`,
 `📦 *${P}catalogo* — Ver catálogo de productos`,
 `🤝 *${P}asesor* — Solicitar atención humana`
 ]),
 ``,
 `${SEP_BOLD}`,
 `🧭 *4. COMUNIDAD, JUEGOS & SISTEMA*`,
 `${SEP_LINE}`,
 joinCmds([
 `💰 *${P}balance* │ *${P}daily* — Economía y monedas`,
 `🎲 *${P}dado* │ *${P}trivia* │ *${P}ppt* — Juegos dinámicos`,
 `🪪 *${P}profile* │ *${P}level* — Perfil y nivel`,
 `📡 *${P}ping* │ 📈 *${P}status* │ ℹ️ *${P}botinfo*`
 ])
 ];

 if (c.isOwner) {
 out.push(
 ``,
 `${SEP_BOLD}`,
 `👑 *5. CONTROL EXCLUSIVO DEL DUEÑO*`,
 `${SEP_LINE}`,
 joinCmds([
 `✅ *${P}activar* — Habilitar bot en este grupo`,
 `🔒 *${P}desactivar* — Bloquear bot en este grupo`,
 `🎙️ *${P}piloto* <on|off|modo|ctx> — Hablar por Mí`,
 `📬 *${P}recados* — Mensajes atendidos por la IA`,
 `🎭 *${P}personalidad* — Ajustar tono e instrucciones`,
 `🔤 *${P}palabras* — Gestionar palabras bloqueadas`
 ])
 );
 }

 out.push(
 ``,
 `${SEP_BOLD}`,
 `💡 Escribe *${P}menu <categoría>* para ver todos los comandos de una sección (ej: *${P}menu administracion*, *${P}menu comunidad*, *${P}menu descargas*).`,
 `${SEP_BOLD}`
 );

 return c.raw(out.join('\n'));
 }

 // Búsqueda específica por categoría o comando
 const norm = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
 const catHit = [...categories.entries()].filter(([n]) => norm(n).includes(norm(q)));
 if (catHit.length) {
 const out = catHit.map(([n, list]) => {
 const catEm = getCategoryEmoji(n);
 return [
 `${SEP_BOLD}`,
 `${catEm} *CATEGORÍA: ${n.toUpperCase()}* (${list.length} comandos)`,
 `${SEP_LINE}`,
 joinCmds(list.map((cmd) => `${getCommandEmoji(cmd.name, n)} *${P}${cmd.name}*${cmd.usage ? ` \`${cmd.usage}\`` : ''}\n   ↳ ${cmd.desc}${cmd.aliases?.length ? `\n   _Alias: ${cmd.aliases.map((a) => P + a).join(', ')}_` : ''}`)),
 `${SEP_BOLD}`
 ].join('\n');
 }).join('\n\n');
 return c.raw(out);
 }

 const results = [...new Set(commands.values())].filter((cmd) =>
 norm(cmd.name).includes(norm(q)) || cmd.aliases?.some((a) => norm(a).includes(norm(q))) || norm(cmd.desc).includes(norm(q)));
 if (!results.length) {
 const botId = c.botId || 'default';
 const aiCtx = getBotAIContext(botId);
 const aiDirectAnswer = await askAI(c.text, aiCtx.systemPrompt, aiCtx.personality || 'assistant', {
 history: getChatHistory(botId, c.chat, 8),
 userFacts: getUserFacts(botId, c.sender),
 botName,
 purpose: aiCtx.purpose,
 ownerName: aiCtx.ownerName,
 pilotContext: aiCtx.pilotContext,
 tone: aiCtx.tone,
 forbiddenWords: aiCtx.forbiddenWords,
 preferredWords: aiCtx.preferredWords,
 products: aiCtx.products,
 knowledge: aiCtx.knowledge,
 businessHours: aiCtx.businessHours,
 prefix: P,
 isAutoPilot: false
 });
 return c.raw(aiDirectAnswer);
 }
 await c.raw([
 `${SEP_BOLD}`,
 `🔎 *RESULTADOS PARA "${c.text.toUpperCase()}"* (${results.length})`,
 `${SEP_LINE}`,
 joinCmds(results.map((cmd) => `${getCommandEmoji(cmd.name, cmd.category)} *${P}${cmd.name}*${cmd.usage ? ` \`${cmd.usage}\`` : ''}\n   ↳ ${cmd.desc}`)),
 `${SEP_BOLD}`
 ].join('\n'));
 }
 },
 { name: 'mimo', aliases: ['acariciar', 'pet', 'saludo'], desc: 'Saluda al bot.',
 run: async (c) => {
 const lines = ['👋 ¡Gracias por el saludo!', '😊 ¡Qué amable! Aquí estoy activo.', '🙌 ¡Un gran saludo! Listo para ayudarte.', '✨ ¡A la orden para lo que necesites!'];
 await c.reply(pick(lines));
 } },
 { name: 'ping', aliases: ['p'], desc: 'Medir el tiempo de respuesta.',
 run: async (c) => {
 const t = Date.now();
 const m = await c.reply('⏳ Calculando latencia...');
 await c.sock.sendMessage(c.chat, { text: `${SEP_BOLD}\n📡 *🧭 UTILIDADES · ${c.prefix}ping*\n${SEP_LINE}\n⚡ *Velocidad de respuesta:* ${Date.now() - t} ms\n${SEP_BOLD}`, edit: m.key });
 }
 },
 { name: 'status', desc: 'Ver el estado del bot.',
 run: async (c) => {
 const s = process.uptime(), mem = process.memoryUsage().rss / 1048576;
 await c.reply(
 `🤖 *Asistente:* ${c.botName || config.botName}\n` +
 `⏱️ *Tiempo en línea:* ${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m\n` +
 `💾 *Memoria en uso:* ${mem.toFixed(0)} MB\n` +
 `👥 *Usuarios registrados:* ${fmt(db.prepare('SELECT COUNT(*) n FROM users').get().n)}\n` +
 `💬 *Grupos registrados:* ${fmt(db.prepare('SELECT COUNT(*) n FROM groups').get().n)}\n` +
 `⚡ *Comandos disponibles:* ${new Set(commands.values()).size}`
 );
 }
 },
 { name: 'botinfo', aliases: ['infobot'], desc: 'Información del bot.',
 run: async (c) => c.reply(
 `🤖 *Asistente:* ${c.botName || config.botName}\n` +
 `🔑 *Prefijo de comandos:* \`${c.prefix}\`\n` +
 `🟢 *Estado:* Operativo 24/7`
 )
 },
 { name: 'bots', aliases: ['sockets'], desc: 'Ver el número de bots activos.', run: async (c) => c.reply('Bots activos: 1') },
 { name: 'del', aliases: ['delete'], desc: 'Eliminar un mensaje.', usage: '{mensaje}', admin: true,
 run: async (c) => {
 if (!c.quoted) return c.reply('Responde al mensaje que quieres borrar.');
 await c.sock.sendMessage(c.chat, { delete: c.quoted.key });
 } },
 { name: 'getpic', aliases: ['pfp'], desc: 'Ver la foto de perfil de un usuario.', usage: '[@mención | {mensaje}]',
 run: async (c) => {
 const jid = c.target || c.sender;
 try {
 const url = await c.sock.profilePictureUrl(jid, 'image');
 await c.sock.sendMessage(c.chat, { image: { url }, caption: `️ @${jidNum(jid)}`, mentions: [jid] }, { quoted: c.msg });
 } catch { await c.reply(' No se pudo obtener la foto (privada o inexistente).'); }
 } },
 { name: 'toimage', aliases: ['toimg'], desc: 'Convertir un sticker a imagen.', usage: '{sticker/imagen}',
 run: async (c) => {
 const m = await c.media(); if (!m) return c.reply('Responde a un sticker.');
 const png = await webpToPng(m.buffer);
 await c.sock.sendMessage(c.chat, { image: png }, { quoted: c.msg });
 } },
 { name: 'suggest', aliases: ['addanime', 'report'], desc: 'Solicitar un anime/personaje faltante o reportar un fallo.', usage: '[texto]',
 run: async (c) => {
 if (!c.text) return c.reply(`Uso: ${c.prefix}suggest [texto]`);
 for (const o of config.owners) await c.sock.sendMessage(`${o}@s.whatsapp.net`, { text: ` *${c.command}* de @${jidNum(c.sender)}:\n${c.text}`, mentions: [c.sender] }).catch(() => {});
 await c.reply(' Enviado al dueño del bot.');
 } },
 { name: 'testwelcome', aliases: ['testgoodbye'], desc: 'Probar bienvenida/despedida.', group: true, admin: true,
 run: async (c) => {
 const w = c.command === 'testwelcome';
 const tpl = (w ? c.group.welcome_msg : c.group.goodbye_msg) || (w ? ' ¡Bienvenido/a {user} a *{group}*!' : ' {user} salió de *{group}*.');
 await c.reply(tpl.replaceAll('{user}', `@${jidNum(c.sender)}`).replaceAll('{group}', c.meta.subject), [c.sender]);
 } },
 { name: 'join', desc: 'Unir al bot a un grupo (dueño).', usage: '[enlace]', owner: true,
 run: async (c) => {
 const m = /chat\.whatsapp\.com\/([A-Za-z0-9]{10,})/.exec(c.text); if (!m) return c.reply('Envía un enlace de invitación válido.');
 await c.sock.groupAcceptInvite(m[1]); await c.reply(' Me uní al grupo.');
 } },
 { name: 'invite', desc: 'Obtener el enlace de invitación del grupo.', group: true, admin: true, botAdmin: true,
 run: async (c) => c.reply(` https://chat.whatsapp.com/${await c.sock.groupInviteCode(c.chat)}`) },
 { name: 'leave', aliases: ['salir'], desc: 'Hacer que el bot salga del grupo.', group: true, admin: true,
 run: async (c) => { await c.reply(' ¡Hasta luego!'); await c.sock.groupLeave(c.chat); } },
 { name: 'setname', aliases: ['setbotname'], desc: 'Cambiar el nombre de WhatsApp del bot (dueño).', usage: '[nombre]', owner: true,
 run: async (c) => { if (!c.text) return c.reply('Indica un nombre.'); await c.sock.updateProfileName(c.text.slice(0, 25)); await c.reply(' Nombre actualizado.'); } },
 { name: 'setstatus', desc: 'Cambiar el estado del bot (dueño).', usage: '[estado]', owner: true,
 run: async (c) => { if (!c.text) return c.reply('Indica un estado.'); await c.sock.updateProfileStatus(c.text.slice(0, 139)); await c.reply(' Estado actualizado.'); } },
 { name: 'setpfp', aliases: ['setimage'], desc: 'Cambiar la foto de perfil del bot (dueño).', usage: '{imagen}', owner: true,
 run: async (c) => {
 const m = await c.media(); if (!m || m.type !== 'imageMessage') return c.reply('Envía o responde a una imagen.');
 await c.sock.updateProfilePicture(c.sock.user.id, m.buffer); await c.reply(' Foto actualizada.');
 } },
];
