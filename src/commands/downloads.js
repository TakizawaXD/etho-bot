import yts from 'yt-search';
import { ytdlp } from '../lib/utils.js';

const isUrl = (s) => /^https?:\/\/\S+$/i.test(s || '');
const YT = /(youtube\.com|youtu\.be)/i;

async function resolveYT(q) {
 if (isUrl(q)) return { url: q, title: q };
 const r = await yts(q); const v = r.videos?.[0];
 if (!v) throw new Error('Sin resultados');
 return { url: v.url, title: v.title, duration: v.timestamp };
}
const social = (name, aliases, label, test) => ({
 name, aliases, desc: `Descargar contenido de ${label}.`, usage: '[enlace]',
 run: async (c) => {
 const url = c.args[0];
 if (!isUrl(url) || (test && !test.test(url))) return c.reply(`Uso: ${c.prefix}${name} [enlace de ${label}]`);
 await c.reply(' Descargando...');
 const { buffer } = await ytdlp(url);
 await c.sock.sendMessage(c.chat, { video: buffer, caption: ` ${label}` }, { quoted: c.msg });
 },
});

export default [
 { name: 'play', aliases: ['yt', 'ytaudio', 'playaudio', 'ethoplay'], desc: 'Descargar el audio de YouTube (ytaudio = nota de voz).', usage: '[búsqueda | enlace]',
 run: async (c) => {
 if (!c.text) return c.reply(`Uso: ${c.prefix}play [búsqueda | enlace]`);
 const v = await resolveYT(c.text);
 await c.reply(` Descargando *${v.title}*${v.duration ? ` (${v.duration})` : ''}...`);
 const { buffer } = await ytdlp(v.url, { audio: true, maxMB: 40 });
 await c.sock.sendMessage(c.chat, { audio: buffer, mimetype: 'audio/mpeg', ptt: c.command === 'ytaudio' }, { quoted: c.msg });
 } },
 { name: 'mp4', aliases: ['ytmp4', 'mp4doc'], desc: 'Descargar un video de YouTube (mp4doc = documento).', usage: '[búsqueda | enlace]',
 run: async (c) => {
 if (!c.text) return c.reply(`Uso: ${c.prefix}mp4 [búsqueda | enlace]`);
 const v = await resolveYT(c.text);
 await c.reply(` Descargando *${v.title}*...`);
 const { buffer } = await ytdlp(v.url);
 const msg = c.command === 'mp4doc'
 ? { document: buffer, mimetype: 'video/mp4', fileName: `${v.title.slice(0, 60)}.mp4` }
 : { video: buffer, caption: v.title };
 await c.sock.sendMessage(c.chat, msg, { quoted: c.msg });
 } },
 { name: 'ytsearch', aliases: ['search'], desc: 'Buscar videos en YouTube.', usage: '[búsqueda]',
 run: async (c) => {
 if (!c.text) return c.reply(`Uso: ${c.prefix}ytsearch [búsqueda]`);
 const r = await yts(c.text);
 if (!r.videos.length) return c.reply('Sin resultados.');
 await c.reply(' *Resultados*\n' + r.videos.slice(0, 6).map((v, i) => `${i + 1}. ${v.title} (${v.timestamp})\n ${v.url}`).join('\n'));
 } },
 social('tiktok', ['tt'], 'TikTok', /tiktok\.com/i),
 social('facebook', ['fb'], 'Facebook', /(facebook\.com|fb\.watch)/i),
 social('reel', ['ig', 'instagram'], 'Instagram', /instagram\.com/i),
 social('twitter', ['x'], 'Twitter/X', /(twitter\.com|x\.com)/i),
];
