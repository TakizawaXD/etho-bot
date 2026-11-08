// Verifica que todos los comandos carguen y no haya nombres duplicados.
import '../src/db.js';
import { commands, categories } from '../src/commands/index.js';

const seen = new Map(); let dup = 0;
for (const list of categories.values()) for (const cmd of list)
  for (const n of [cmd.name, ...(cmd.aliases || [])]) {
    if (seen.has(n) && seen.get(n) !== cmd) { console.error(`Duplicado: ${n}`); dup++; }
    seen.set(n, cmd);
  }
console.log(`Comandos únicos: ${new Set(commands.values()).size} | nombres/alias: ${commands.size} | duplicados: ${dup}`);
process.exit(dup ? 1 : 0);
