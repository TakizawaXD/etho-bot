import { getUser, setUser } from '../db.js';
import { config } from '../config.js';
import { fmt, rand, pick, jidNum, sha1 } from '../lib/utils.js';
import { bar } from '../lib/ui.js';

const cur = config.currency;
const trivia = new Map(); // chat -> { idx, opts, ts }

const QUESTIONS = [
 ['¿Cuál es el planeta más grande del sistema solar?', ['Marte', 'Júpiter', 'Saturno', 'Neptuno'], 1],
 ['¿Cuántos huesos tiene un adulto humano?', ['186', '206', '226', '256'], 1],
 ['¿Cuál es la capital de Australia?', ['Sídney', 'Melbourne', 'Canberra', 'Perth'], 2],
 ['¿Quién pintó la Mona Lisa?', ['Van Gogh', 'Picasso', 'Da Vinci', 'Dalí'], 2],
 ['¿Cuál es el océano más grande?', ['Atlántico', 'Índico', 'Ártico', 'Pacífico'], 3],
 ['¿Qué gas respiramos principalmente?', ['Oxígeno', 'Nitrógeno', 'Hidrógeno', 'Helio'], 1],
 ['¿En qué año llegó el hombre a la Luna?', ['1965', '1969', '1972', '1975'], 1],
 ['¿Cuántos lados tiene un hexágono?', ['5', '6', '7', '8'], 1],
 ['¿Cuál es el río más largo de Sudamérica?', ['Orinoco', 'Paraná', 'Amazonas', 'Magdalena'], 2],
 ['¿Qué lenguaje usa etiquetas como <div>?', ['Python', 'HTML', 'SQL', 'Rust'], 1],
 ['¿Cuál es el metal líquido a temperatura ambiente?', ['Mercurio', 'Plomo', 'Hierro', 'Cobre'], 0],
 ['¿Quién escribió "Don Quijote de la Mancha"?', ['Lope de Vega', 'Cervantes', 'Quevedo', 'Borges'], 1],
 ['¿Cuántos jugadores hay por equipo en el fútbol?', ['9', '10', '11', '12'], 2],
 ['¿Cuál es el animal terrestre más rápido?', ['León', 'Guepardo', 'Caballo', 'Leopardo'], 1],
 ['¿Cuál es el símbolo químico del oro?', ['Ag', 'Go', 'Au', 'Or'], 2],
 ['¿Cuál es el país más grande del mundo?', ['China', 'Canadá', 'Rusia', 'EE. UU.'], 2],
 ['¿Cuántos continentes hay?', ['5', '6', '7', '8'], 2],
 ['¿Qué órgano bombea la sangre?', ['Hígado', 'Pulmón', 'Riñón', 'Corazón'], 3],
 ['¿Cuál es el resultado de 12 × 12?', ['124', '144', '154', '164'], 1],
 ['¿Qué significa "CPU"?', ['Unidad Central de Proceso', 'Control de Pantalla Universal', 'Centro de Programas Útiles', 'Computadora Personal Unida'], 0],
 ['¿Qué planeta es conocido como el planeta rojo?', ['Venus', 'Marte', 'Mercurio', 'Urano'], 1],
 ['¿En qué continente está Egipto?', ['Asia', 'Europa', 'África', 'Oceanía'], 2],
];
const BALL = ['Sí, sin duda.', 'Todo apunta a que sí.', 'Probablemente.', 'No lo veo claro.', 'Pregunta más tarde.', 'Mejor no te lo digo ahora.', 'No cuentes con ello.', 'Mis fuentes dicen que no.', 'Definitivamente no.'];
const amount = (s, max) => (['all', 'todo'].includes((s || '').toLowerCase()) ? max : parseInt((s || '').replace(/[.,]/g, ''), 10) || 0);

export default [
 { name: 'slots', aliases: ['tragamonedas', 'slot'], desc: 'Jugar a la tragamonedas.', usage: '[apuesta | all]',
 run: async (c) => {
 const bet = amount(c.args[0], c.user.coins);
 if (!(bet > 0)) return c.reply(`Uso: ${c.prefix}slots [apuesta]`);
 if (bet > c.user.coins) return c.reply(' No tienes tantas coins en la cartera.');
 const S = ['🍒', '🍋', '🔔', '💎', '7️⃣'], r = [pick(S), pick(S), pick(S)];
 let mult = 0;
 if (r[0] === r[1] && r[1] === r[2]) mult = r[0] === '7️⃣' ? 10 : r[0] === '💎' ? 8 : 5;
 else if (r[0] === r[1] || r[1] === r[2] || r[0] === r[2]) mult = 0.3;
 const net = mult ? Math.floor(bet * mult) : -bet;
 setUser(c.sender, { coins: c.user.coins + net });
 await c.reply(`🎰 [ ${r.join(' | ')} ]\n${net > 0 ? `🏆 ¡Ganaste *${fmt(net)} ${cur}*!` : `💸 Perdiste *${fmt(bet)} ${cur}*.`}`);
 } },
 { name: 'ppt', aliases: ['rps'], desc: 'Piedra, papel o tijera contra Etho.', usage: '[piedra|papel|tijera]',
 run: async (c) => {
 const E = { piedra: '🪨', papel: '📄', tijera: '✂️' }, me = (c.args[0] || '').toLowerCase();
 if (!E[me]) return c.reply(`Uso: ${c.prefix}ppt piedra|papel|tijera`);
 const bot = pick(Object.keys(E)), win = { piedra: 'tijera', papel: 'piedra', tijera: 'papel' };
 let res = '🤝 Empate';
 if (win[me] === bot) { res = `🏆 ¡Ganaste! +30 ${cur}`; setUser(c.sender, { coins: c.user.coins + 30 }); }
 else if (win[bot] === me) res = '❌ Perdiste';
 await c.reply(`Tú: ${E[me]} vs Etho: ${E[bot]}\n${res}`);
 } },
 { name: 'dado', aliases: ['dice', 'roll6'], desc: 'Lanzar un dado.', usage: '<caras>',
 run: async (c) => { const n = Math.min(1000, Math.max(2, parseInt(c.args[0]) || 6)); await c.reply(`🎲 Dado de ${n} caras: *${rand(1, n)}*`); } },
 { name: '8ball', aliases: ['bola8', 'pregunta'], desc: 'Hazle una pregunta a la bola mágica.', usage: '[pregunta]',
 run: async (c) => { if (!c.text) return c.reply(`Uso: ${c.prefix}8ball ¿pregunta?`); await c.reply(`❓ ${c.text}\n🎱 *${pick(BALL)}*`); } },
 { name: 'ship', desc: 'Calcular la compatibilidad entre dos personas.', usage: '[@a] [@b]',
 run: async (c) => {
 const [a, b] = c.mentions.length >= 2 ? c.mentions : [c.sender, c.target];
 if (!b) return c.reply(`Uso: ${c.prefix}ship @usuario1 @usuario2`);
 const pct = parseInt(sha1([a, b].sort().join('|')).slice(0, 4), 16) % 101;
 await c.reply(`@${jidNum(a)} + @${jidNum(b)}\n${bar(pct, 100)} *${pct}%*\n${pct > 80 ? 'Pareja perfecta.' : pct > 50 ? 'Hay química.' : pct > 25 ? 'Quizá como amigos.' : 'Mejor déjenlo así.'}`, [a, b]);
 } },
 { name: 'trivia', desc: 'Pregunta de trivia: acierta y gana coins.',
 run: async (c) => {
 const cur0 = trivia.get(c.chat);
 if (cur0 && Date.now() - cur0.ts < 60_000) return c.reply('Ya hay una trivia activa. Responde con #r a/b/c/d.');
 const [q, opts, idx] = pick(QUESTIONS);
 trivia.set(c.chat, { idx, opts, ts: Date.now() });
 await c.reply(` *Trivia*\n${q}\n\n${opts.map((o, i) => `${'abcd'[i]}) ${o}`).join('\n')}\n\nResponde con *${c.prefix}r a|b|c|d* (60 s). Premio: 150 ${cur}.`);
 } },
 { name: 'responder', aliases: ['r'], desc: 'Responder a la trivia activa.', usage: '[a|b|c|d]',
 run: async (c) => {
 const t = trivia.get(c.chat), a = 'abcd'.indexOf((c.args[0] || '').toLowerCase());
 if (!t || Date.now() - t.ts > 60_000) return c.reply('No hay trivia activa. Usa #trivia.');
 if (a < 0) return c.reply('Responde con a, b, c o d.');
 if (a === t.idx) {
 trivia.delete(c.chat);
 setUser(c.sender, { coins: c.user.coins + 150 });
 return c.reply(` ¡Correcto, @${jidNum(c.sender)}! +150 ${cur}`, [c.sender]);
 }
 await c.reply(' Incorrecto, ¡inténtalo de nuevo!');
 } },
 { name: 'suerte', aliases: ['luck'], desc: 'Tu suerte del día.',
 run: async (c) => {
 const day = new Date().toISOString().slice(0, 10);
 const n = parseInt(sha1(c.sender + day).slice(0, 4), 16) % 101;
 await c.reply(`Tu suerte de hoy: *${n}%*\n${bar(n, 100)}\n${n > 75 ? 'Día para apostar.' : n > 40 ? 'Un día normal.' : 'Mejor guarda tus coins hoy.'}`);
 } },
];
