import axios from 'axios';
import QRCode from 'qrcode';
import crypto from 'crypto';
import { db, setUser, getChatHistory, saveChatMessage, saveUserFact, getUserFacts, clearChatHistory, getBotAIContext } from '../db.js';
import { jidNum, timeLeft } from '../lib/utils.js';
import { askAI, extractUserFacts } from '../lib/ai.js';

const http = axios.create({ timeout: 15000, headers: { 'User-Agent': 'EthoBot/1.0' } });
const UNITS = { s: 1e3, m: 60e3, h: 3600e3, d: 864e5 };

function calc(expr) {
 const e = expr.replace(/,/g, '.').replace(/\^/g, '**').replace(/×/g, '*').replace(/÷/g, '/');
 if (!/^[0-9+\-*/().%\s*]+$/.test(e) || e.length > 80) throw new Error('Expresión no válida');
 const r = Function(`"use strict"; return (${e})`)();
 if (typeof r !== 'number' || !Number.isFinite(r)) throw new Error('Resultado no válido');
 return r;
}

export default [
 { name: 'ia', aliases: ['preguntar', 'chat'], desc: 'Atención inteligente y respuestas directas con IA.', usage: '[mensaje]',
 run: async (c) => {
 if (!c.text) return c.reply(`Escribe tu consulta después del comando. Ejemplo: *${c.prefix}ia cómo optimizar las ventas de mi negocio*`);
 try {
 const botId = c.botId || 'default';
 const aiCtx = getBotAIContext(botId);
 const learned = extractUserFacts(c.text);
 for (const f of learned) saveUserFact(botId, c.sender, f.key, f.value);
 const history = getChatHistory(botId, c.chat, 10);
 const userFacts = getUserFacts(botId, c.sender);
 saveChatMessage(botId, c.chat, c.sender, 'user', c.text);
 const ans = await askAI(c.text, aiCtx.systemPrompt, aiCtx.personality || 'assistant', {
 history,
 userFacts,
 botName: c.botName || aiCtx.botName || 'Etho',
 purpose: aiCtx.purpose,
 ownerName: aiCtx.ownerName,
 pilotContext: aiCtx.pilotContext,
 tone: aiCtx.tone,
 forbiddenWords: aiCtx.forbiddenWords,
 preferredWords: aiCtx.preferredWords,
 products: aiCtx.products,
 knowledge: aiCtx.knowledge,
 businessHours: aiCtx.businessHours,
 isAutoPilot: false
 });
 saveChatMessage(botId, c.chat, botId, 'assistant', ans);
 await c.reply(ans);
 } catch (e) {
 console.error("[tools:ia]", e.message);
 await c.reply("No pude procesar tu solicitud en este momento. Inténtalo de nuevo en unos segundos.");
 }
 } },
 { name: 'resetia', aliases: ['olvidar', 'borrarmemoria'], desc: 'Borrar la memoria de conversación de este chat.',
 run: async (c) => {
 clearChatHistory(c.botId || 'default', c.chat);
 await c.reply('Memoria conversacional de este chat reiniciada. Empecemos de nuevo.');
 } },
 { name: 'calc', aliases: ['calcular'], desc: 'Calculadora.', usage: '[operación]',
 run: async (c) => { if (!c.text) return c.reply(`Uso: ${c.prefix}calc 2*(3+4)^2`); await c.reply(`${c.text}\n= *${+calc(c.text).toFixed(10)}*`); } },
 { name: 'clima', aliases: ['weather', 'tiempo'], desc: 'Clima actual de una ciudad.', usage: '[ciudad]',
 run: async (c) => {
 if (!c.text) return c.reply(`Uso: ${c.prefix}clima Bogotá`);
 const { data } = await http.get(`https://wttr.in/${encodeURIComponent(c.text)}?format=j1&lang=es`);
 const n = data.current_condition?.[0]; if (!n) return c.reply('Ciudad no encontrada.');
 await c.reply(`🌤️ *Clima en ${data.nearest_area?.[0]?.areaName?.[0]?.value || c.text}*\n🌡️ Temperatura: ${n.temp_C}°C (sensación ${n.FeelsLikeC}°C)\n☁️ Condición: ${n.lang_es?.[0]?.value || n.weatherDesc?.[0]?.value}\n💧 Humedad: ${n.humidity}%\n💨 Viento: ${n.windspeedKmph} km/h`);
 } },
 { name: 'wiki', aliases: ['wikipedia'], desc: 'Resumen de Wikipedia.', usage: '[tema]',
 run: async (c) => {
 if (!c.text) return c.reply(`Uso: ${c.prefix}wiki Gabriel García Márquez`);
 const s = await http.get('https://es.wikipedia.org/w/rest.php/v1/search/title', { params: { q: c.text, limit: 1 } });
 const key = s.data.pages?.[0]?.key; if (!key) return c.reply('Sin resultados.');
 const { data } = await http.get(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(key)}`);
 await c.reply(`*${data.title}*\n${(data.extract || '').slice(0, 900)}\n\nFuente: ${data.content_urls?.desktop?.page || ''}`);
 } },
 { name: 'traducir', aliases: ['tr', 'translate'], desc: 'Traducir texto.', usage: '[idioma: en, es, fr...] [texto]',
 run: async (c) => {
 const to = (c.args[0] || '').toLowerCase(), text = c.args.slice(1).join(' ') || c.quoted?.message?.conversation;
 if (!/^[a-z]{2}(-[a-z]{2})?$/.test(to) || !text) return c.reply(`Uso: ${c.prefix}traducir en Hola mundo`);
 const { data } = await http.get('https://api.mymemory.translated.net/get', { params: { q: text.slice(0, 400), langpair: `Autodetect|${to}` } });
 await c.reply(`*TRADUCCIÓN (${to.toUpperCase()})*\n${data.responseData?.translatedText || 'No se pudo traducir.'}`);
 } },
 { name: 'qr', aliases: ['codigoqr'], desc: 'Generar un código QR.', usage: '[texto o enlace]',
 run: async (c) => {
 if (!c.text) return c.reply(`Uso: ${c.prefix}qr https://ejemplo.com`);
 const png = await QRCode.toBuffer(c.text.slice(0, 500), { width: 512, margin: 2 });
 await c.sock.sendMessage(c.chat, { image: png, caption: 'Código QR generado:' }, { quoted: c.msg });
 } },
 { name: 'acortar', aliases: ['short'], desc: 'Acortar un enlace.', usage: '[enlace]',
 run: async (c) => {
 if (!/^https?:\/\/\S+$/i.test(c.args[0] || '')) return c.reply(`Uso: ${c.prefix}acortar https://enlace-largo.com`);
 const { data } = await http.get('https://is.gd/create.php', { params: { format: 'simple', url: c.args[0] } });
 await c.reply(`Enlace acortado: ${data}`);
 } },
 { name: 'hora', aliases: ['time'], desc: 'Hora en una zona horaria.', usage: '<Zona/Ciudad>',
 run: async (c) => {
 const tz = c.args[0] || 'UTC';
 try { await c.reply(`*${tz}*\n${new Intl.DateTimeFormat('es-ES', { dateStyle: 'full', timeStyle: 'medium', timeZone: tz }).format(new Date())}`); }
 catch { await c.reply('Zona horaria inválida. Ejemplo: #hora America/Bogota'); }
 } },
 { name: 'recordar', aliases: ['remind', 'recordatorio'], desc: 'Crear un recordatorio.', usage: '[10m|2h|1d] [texto]',
 run: async (c) => {
 const m = /^(\d{1,3})([smhd])$/.exec((c.args[0] || '').toLowerCase()), text = c.args.slice(1).join(' ');
 if (!m || !text) return c.reply(`Uso: ${c.prefix}recordar 30m sacar la basura`);
 const ms = +m[1] * UNITS[m[2]];
 if (ms < 10e3 || ms > 30 * 864e5) return c.reply('El tiempo debe estar entre 10 s y 30 días.');
 if (db.prepare('SELECT COUNT(*) n FROM reminders WHERE jid=?').get(c.sender).n >= 20) return c.reply('Máximo 20 recordatorios activos.');
 db.prepare('INSERT INTO reminders(jid,chat,text,at) VALUES(?,?,?,?)').run(c.sender, c.chat, text.slice(0, 300), Date.now() + ms);
 await c.reply(`Recordatorio programado para dentro de *${timeLeft(ms)}*:\n${text}`);
 } },
 { name: 'nota', aliases: ['notas', 'note'], desc: 'Notas personales.', usage: '[add texto | list | del número]',
 run: async (c) => {
 const sub = (c.args[0] || 'list').toLowerCase(), rest = c.args.slice(1).join(' ');
 if (sub === 'add') {
 if (!rest) return c.reply(`Uso: ${c.prefix}nota add texto`);
 db.prepare('INSERT INTO notes(jid,text,ts) VALUES(?,?,?)').run(c.sender, rest.slice(0, 500), Date.now());
 return c.reply('Nota guardada correctamente.');
 }
 const rows = db.prepare('SELECT * FROM notes WHERE jid=? ORDER BY id').all(c.sender);
 if (sub === 'del') {
 const r = rows[parseInt(rest) - 1]; if (!r) return c.reply('Esa nota no existe.');
 db.prepare('DELETE FROM notes WHERE id=?').run(r.id); return c.reply('Nota eliminada.');
 }
 await c.reply(rows.length ? '*TUS NOTAS:*\n' + rows.map((r, i) => `${i + 1}. ${r.text}`).join('\n') : `Sin notas guardadas. Usa ${c.prefix}nota add [texto]`);
 } },
 { name: 'encuesta', aliases: ['poll'], desc: 'Crear una encuesta.', usage: '[pregunta] | [op1] | [op2] ...', group: true,
 run: async (c) => {
 const [name, ...values] = c.text.split('|').map((s) => s.trim()).filter(Boolean);
 if (!name || values.length < 2 || values.length > 12) return c.reply(`Uso: ${c.prefix}encuesta ¿Pizza o pasta? | Pizza | Pasta`);
 await c.sock.sendMessage(c.chat, { poll: { name: name.slice(0, 100), values: values.map((v) => v.slice(0, 50)), selectableCount: 1 } });
 } },
 { name: 'afk', desc: 'Marcarte como ausente.', usage: '<motivo>',
 run: async (c) => { setUser(c.sender, { afk_since: Date.now(), afk_reason: c.text.slice(0, 100) || null }); await c.reply(` @${jidNum(c.sender)} ahora está AFK.${c.text ? `\nMotivo: ${c.text}` : ''}`, [c.sender]); } },
 { name: 'pass', aliases: ['password', 'clave'], desc: 'Generar una contraseña segura.', usage: '<longitud>',
 run: async (c) => {
 const n = Math.min(64, Math.max(8, parseInt(c.args[0]) || 16)), set = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?';
 const p = Array.from({ length: n }, () => set[crypto.randomInt(set.length)]).join('');
 await c.reply(` Contraseña (${n}):\n\`${p}\`\n_Guárdala en un gestor; no la compartas._`);
 } },
];
