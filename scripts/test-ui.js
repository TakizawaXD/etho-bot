import assert from 'node:assert/strict';
import { card, skin, SEP_LINE } from '../src/lib/ui.js';

assert.equal(card({ icon: '✅', title: 'Listo', body: 'Todo en orden' }), `*✅ Listo*\n${SEP_LINE}\nTodo en orden`);
assert.equal(card({ title: 'Aviso', body: ' texto ', hint: 'Una pista' }), `*Aviso*\n${SEP_LINE}\ntexto\n\n_Una pista_`);
assert.equal(card({ icon: '📦', title: 'Catálogo', body: 'x' }).startsWith('*📦 Catálogo*'), true);
assert.equal(skin('Hola', { label: 'Descargas', command: 'play', prefix: '#' }).split('\n')[0].includes('#play'), true);
assert.equal(skin('', { label: 'X' }), '');
// Ningún encabezado debe superar el ancho cómodo de una burbuja de WhatsApp
assert.ok(SEP_LINE.length <= 16);
console.log('ui.js OK');
