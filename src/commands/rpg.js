import { db, getUser, setUser, getCd, setCd, getItem, addItem } from '../db.js';
import { config } from '../config.js';
import { fmt, rand, pick, cd, timeLeft } from '../lib/utils.js';

const cur = config.currency;
const TOOLS = {
 pico: { price: 1500, emoji: '⛏️', desc: 'Duplica lo que obtienes al minar.' },
 cana: { price: 1200, emoji: '🎣', desc: 'Duplica lo que obtienes al pescar.' },
 arco: { price: 1800, emoji: '🏹', desc: 'Duplica lo que obtienes al cazar.' },
};
const LOOT = {
 mineral: { emoji: '🪨', value: 40 }, gema: { emoji: '💎', value: 150 },
 pez: { emoji: '🐟', value: 30 }, pez_raro: { emoji: '🐡', value: 120 },
 presa: { emoji: '🦌', value: 50 }, trofeo: { emoji: '🏆', value: 140 },
};
const wait = (c, left) => c.reply(` Descansa *${timeLeft(left)}* antes de usar *${c.prefix}${c.command}* otra vez.`);
const label = (k) => `${LOOT[k]?.emoji || TOOLS[k]?.emoji || ''} ${k.replace('_', ' ')}`;

const gather = (name, aliases, tool, ms, verb, table) => ({
 name, aliases, desc: `${verb} para conseguir recursos y coins.`,
 run: async (c) => {
 const left = cd(getCd(c.sender, name), ms); if (left) return wait(c, left);
 const boost = getItem(c.sender, tool) > 0 ? 2 : 1;
 const roll = Math.random() * 100;
 let acc = 0, found = table[table.length - 1];
 for (const t of table) { acc += t[1]; if (roll < acc) { found = t; break; } }
 const [item, , min, max] = found, qty = rand(min, max) * boost, coins = rand(40, 120) * boost;
 addItem(c.sender, item, qty);
 setUser(c.sender, { coins: c.user.coins + coins });
 setCd(c.sender, name);
 await c.reply(`${TOOLS[tool].emoji} ${verb}...\nConseguiste *${qty}× ${label(item)}* y *${fmt(coins)} ${cur}*.${boost > 1 ? `\n Bonus x2 por tu ${tool}.` : `\n Compra un ${tool} en ${c.prefix}tienda para x2.`}`);
 },
});

export default [
 gather('minar', ['mine'], 'pico', 8 * 60e3, 'Minando', [['mineral', 70, 1, 3], ['gema', 30, 1, 1]]),
 gather('pescar', ['fish'], 'cana', 6 * 60e3, 'Pescando', [['pez', 75, 1, 3], ['pez_raro', 25, 1, 1]]),
 gather('cazar', ['hunt'], 'arco', 10 * 60e3, 'Cazando', [['presa', 80, 1, 2], ['trofeo', 20, 1, 1]]),
 { name: 'tienda', aliases: ['shop'], desc: 'Ver las herramientas a la venta.',
 run: async (c) => c.reply(' *Tienda*\n' + Object.entries(TOOLS).map(([k, v]) => `${v.emoji} *${k}* — ${fmt(v.price)} ${cur}\n ${v.desc}`).join('\n') + `\n\nCompra con *${c.prefix}comprar [herramienta]*`) },
 { name: 'comprar', aliases: ['buy'], desc: 'Comprar una herramienta.', usage: '[pico|cana|arco]',
 run: async (c) => {
 const k = (c.args[0] || '').toLowerCase(), t = TOOLS[k];
 if (!t) return c.reply(`Uso: ${c.prefix}comprar pico|cana|arco`);
 if (getItem(c.sender, k) > 0) return c.reply('Ya tienes esa herramienta.');
 if (c.user.coins < t.price) return c.reply(` Necesitas ${fmt(t.price)} ${cur} en la cartera.`);
 setUser(c.sender, { coins: c.user.coins - t.price }); addItem(c.sender, k, 1);
 await c.reply(` Compraste ${t.emoji} *${k}* por ${fmt(t.price)} ${cur}.`);
 } },
 { name: 'inventario', aliases: ['inv', 'mochila'], desc: 'Ver tu inventario.', usage: '<@mención>',
 run: async (c) => {
 const jid = c.target || c.sender;
 const rows = db.prepare('SELECT item, qty FROM inventory WHERE jid=? ORDER BY item').all(jid);
 if (!rows.length) return c.reply(' Inventario vacío. Prueba #minar, #pescar o #cazar.');
 const worth = rows.reduce((s, r) => s + (LOOT[r.item]?.value || 0) * r.qty, 0);
 await c.reply(` *Inventario de @${jid.split('@')[0].split(':')[0]}*\n${rows.map((r) => `• ${label(r.item)} ×${r.qty}`).join('\n')}\n\n Valor del loot: ${fmt(worth)} ${cur}`, [jid]);
 } },
 { name: 'vendertodo', aliases: ['sellall', 'venderloot'], desc: 'Vender todo el loot de tu inventario.',
 run: async (c) => {
 const rows = db.prepare('SELECT item, qty FROM inventory WHERE jid=?').all(c.sender).filter((r) => LOOT[r.item]);
 const total = rows.reduce((s, r) => s + LOOT[r.item].value * r.qty, 0);
 if (!total) return c.reply('No tienes loot para vender.');
 db.transaction(() => { rows.forEach((r) => addItem(c.sender, r.item, -r.qty)); setUser(c.sender, { coins: getUser(c.sender).coins + total }); })();
 await c.reply(` Vendiste ${rows.length} tipo(s) de loot por *${fmt(total)} ${cur}*.`);
 } },
];
