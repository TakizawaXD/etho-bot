import economy from './economy.js';
import stickers from './stickers.js';
import gacha from './gacha.js';
import downloads from './downloads.js';
import profile from './profile.js';
import utils from './utils.js';
import admin from './admin.js';
import anime from './anime.js';
import games from './games.js';
import rpg from './rpg.js';
import tools from './tools.js';
import owner from './owner.js';

const modules = [
  { category: 'Productividad', list: tools },
  { category: 'Administración', list: admin },
  { category: 'Multimedia', list: stickers },
  { category: 'Utilidades', list: utils },
  { category: 'Control', list: owner },
  { category: 'Descargas', list: downloads },
  { category: 'Comunidad', feature: 'economy', list: economy },
  { category: 'Dinámicas', list: games },
  { category: 'Perfiles', list: profile },
];

export const commands = new Map();
export const categories = new Map(); // categoría -> comandos únicos

for (const m of modules) {
  categories.set(m.category, m.list);
  for (const cmd of m.list) {
    cmd.category = m.category;
    cmd.feature = m.feature || null;
    for (const n of [cmd.name, ...(cmd.aliases || [])]) commands.set(n, cmd);
  }
}
