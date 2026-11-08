import { db, getUser, setUser } from '../db.js';
import { config } from '../config.js';
import { fmt, rand, cd, timeLeft, jidNum } from '../lib/utils.js';

const cur = config.currency;
const amountOf = (s, max) => {
 if (!s) return 0;
 if (['all', 'todo'].includes(s.toLowerCase())) return max;
 const n = parseInt(s.replace(/[.,]/g, ''), 10);
 return Number.isFinite(n) && n > 0 ? n : 0;
};
const wait = (c, left) => c.reply(` Debes esperar *${timeLeft(left)}* para usar *${c.prefix}${c.command}* otra vez.`);

export default [
 { name: 'balance', aliases: ['bal', 'coins'], desc: 'Ver cuántas coins tienes.', usage: '<@mención>',
 run: async (c) => {
 const jid = c.target || c.sender, u = getUser(jid);
 await c.reply(`👤 *@${jidNum(jid)}*\n• 👛 Cartera: ${fmt(u.coins)} ${cur}\n• 🏦 Banco: ${fmt(u.bank)} ${cur}\n• 💎 Total: ${fmt(u.coins + u.bank)} ${cur}`, [jid]);
 } },
 { name: 'coinflip', aliases: ['flip', 'cf'], desc: 'Apostar coins en cara o cruz.', usage: '[cantidad] <cara/cruz>',
 run: async (c) => {
 const amount = amountOf(c.args[0], c.user.coins), side = (c.args[1] || '').toLowerCase();
 if (!amount || !['cara', 'cruz'].includes(side)) return c.reply(`Uso: ${c.prefix}cf [cantidad] <cara/cruz>`);
 if (amount > c.user.coins) return c.reply(' No tienes tantas coins en la cartera.');
 const result = Math.random() < 0.5 ? 'cara' : 'cruz', win = result === side;
 setUser(c.sender, { coins: c.user.coins + (win ? amount : -amount) });
 await c.reply(` Salió *${result}*. ${win ? `¡Ganaste ${fmt(amount)} ${cur}!` : `Perdiste ${fmt(amount)} ${cur}.`}`);
 } },
 { name: 'crime', desc: 'Ganar coins cometiendo crímenes.',
 run: async (c) => {
 const left = cd(c.user.last_crime, 10 * 60e3); if (left) return wait(c, left);
 if (Math.random() < 0.55) { const g = rand(200, 600); setUser(c.sender, { coins: c.user.coins + g, last_crime: Date.now() }); return c.reply(`️ Crimen exitoso: ganaste *${fmt(g)} ${cur}*.`); }
 const l = Math.min(c.user.coins, rand(100, 300)); setUser(c.sender, { coins: c.user.coins - l, last_crime: Date.now() });
 await c.reply(` Te atraparon y perdiste *${fmt(l)} ${cur}*.`);
 } },
 { name: 'daily', desc: 'Reclamar tu recompensa diaria.',
 run: async (c) => {
 const left = cd(c.user.last_daily, 24 * 3600e3); if (left) return wait(c, left);
 const streak = Date.now() - c.user.last_daily < 48 * 3600e3 ? c.user.streak + 1 : 1;
 const reward = 500 + Math.min(streak, 30) * 50;
 setUser(c.sender, { coins: c.user.coins + reward, streak, last_daily: Date.now() });
 await c.reply(` Recompensa diaria: *${fmt(reward)} ${cur}*\n Racha: ${streak} día(s)`);
 } },
 { name: 'deposit', aliases: ['dep', 'depositar', 'd'], desc: 'Depositar tus coins en el banco.', usage: '[cantidad | all]',
 run: async (c) => {
 const n = amountOf(c.args[0], c.user.coins);
 if (!n || n > c.user.coins) return c.reply(' Cantidad inválida o insuficiente.');
 setUser(c.sender, { coins: c.user.coins - n, bank: c.user.bank + n });
 await c.reply(` Depositaste *${fmt(n)} ${cur}*.`);
 } },
 { name: 'withdraw', aliases: ['with', 'retirar'], desc: 'Retirar tus coins del banco.', usage: '[cantidad | all]',
 run: async (c) => {
 const n = amountOf(c.args[0], c.user.bank);
 if (!n || n > c.user.bank) return c.reply(' Cantidad inválida o insuficiente.');
 setUser(c.sender, { coins: c.user.coins + n, bank: c.user.bank - n });
 await c.reply(` Retiraste *${fmt(n)} ${cur}*.`);
 } },
 { name: 'economyboard', aliases: ['eboard', 'baltop'], desc: 'Ranking de usuarios con más coins.', usage: '<página>',
 run: async (c) => {
 const page = Math.max(1, parseInt(c.args[0]) || 1);
 const rows = db.prepare('SELECT jid, coins+bank AS total FROM users ORDER BY total DESC LIMIT 10 OFFSET ?').all((page - 1) * 10);
 if (!rows.length) return c.reply('No hay datos en esta página.');
 await c.reply(` *Top economía* (pág. ${page})\n` + rows.map((r, i) => `${(page - 1) * 10 + i + 1}. @${jidNum(r.jid)} — ${fmt(r.total)}`).join('\n'), rows.map((r) => r.jid));
 } },
 { name: 'economyinfo', aliases: ['einfo'], desc: 'Ver tu información de economía.',
 run: async (c) => {
 const u = c.user;
 await c.reply(` *Tu economía*\n• Cartera: ${fmt(u.coins)}\n• Banco: ${fmt(u.bank)}\n• Racha diaria: ${u.streak}\n• Daily: ${cd(u.last_daily, 864e5) ? 'en espera' : 'disponible'}\n• Work: ${cd(u.last_work, 3e5) ? 'en espera' : 'disponible'}`);
 } },
 { name: 'givecoins', aliases: ['pay', 'coinsgive'], desc: 'Regalar coins a un usuario.', usage: '[@mención] [cantidad]',
 run: async (c) => {
 const n = amountOf(c.args.find((a) => /^\d|all/i.test(a)), c.user.coins);
 if (!c.target || c.target === c.sender || !n) return c.reply(`Uso: ${c.prefix}pay @usuario [cantidad]`);
 if (n > c.user.coins) return c.reply(' No tienes tantas coins en la cartera.');
 const t = getUser(c.target);
 setUser(c.sender, { coins: c.user.coins - n }); setUser(c.target, { coins: t.coins + n });
 await c.reply(` Enviaste *${fmt(n)} ${cur}* a @${jidNum(c.target)}.`, [c.target]);
 } },
 { name: 'roulette', aliases: ['rt'], desc: 'Apostar coins en una ruleta.', usage: '[red/black] [cantidad]',
 run: async (c) => {
 const map = { red: 'red', rojo: 'red', black: 'black', negro: 'black' };
 const color = map[(c.args[0] || '').toLowerCase()], n = amountOf(c.args[1], c.user.coins);
 if (!color || !n) return c.reply(`Uso: ${c.prefix}rt [red/black] [cantidad]`);
 if (n > c.user.coins) return c.reply(' No tienes tantas coins en la cartera.');
 const r = rand(0, 36), res = r === 0 ? 'green' : r % 2 ? 'red' : 'black', win = res === color;
 setUser(c.sender, { coins: c.user.coins + (win ? n : -n) });
 await c.reply(` Salió *${r} (${res})*. ${win ? `¡Ganaste ${fmt(n)} ${cur}!` : `Perdiste ${fmt(n)} ${cur}.`}`);
 } },
 { name: 'steal', aliases: ['robar', 'rob'], desc: 'Intentar robar coins a un usuario.', usage: '[@mención]',
 run: async (c) => {
 if (!c.target || c.target === c.sender) return c.reply(`Uso: ${c.prefix}rob @usuario`);
 const left = cd(c.user.last_steal, 30 * 60e3); if (left) return wait(c, left);
 const t = getUser(c.target);
 if (t.coins < 100) return c.reply(' Esa persona no tiene suficiente en la cartera.');
 if (Math.random() < 0.4) {
 const g = Math.min(t.coins, rand(50, Math.max(60, Math.floor(t.coins * 0.2))));
 setUser(c.target, { coins: t.coins - g }); setUser(c.sender, { coins: c.user.coins + g, last_steal: Date.now() });
 return c.reply(` Le robaste *${fmt(g)} ${cur}* a @${jidNum(c.target)}.`, [c.target]);
 }
 const l = Math.min(c.user.coins, 100); setUser(c.sender, { coins: c.user.coins - l, last_steal: Date.now() });
 await c.reply(` Te descubrieron y pagaste *${fmt(l)} ${cur}* de multa.`);
 } },
 { name: 'work', aliases: ['w'], desc: 'Ganar coins trabajando.',
 run: async (c) => {
 const left = cd(c.user.last_work, 5 * 60e3); if (left) return wait(c, left);
 const g = rand(100, 300), jobs = ['programador', 'repartidor', 'barista', 'diseñador', 'mecánico', 'streamer'];
 setUser(c.sender, { coins: c.user.coins + g, last_work: Date.now() });
 await c.reply(` Trabajaste como ${jobs[rand(0, jobs.length - 1)]} y ganaste *${fmt(g)} ${cur}*.`);
 } },
];
