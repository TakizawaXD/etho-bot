import { formatForWhatsApp as f, splitMessage as sp, typingDelay } from '../src/lib/format.js';
import assert from 'node:assert/strict';
const t=(a,b)=>assert.equal(f(a),b);
t('## Planes\n**Pro**: $25\n__Básico__: $10','*Planes*\n*Pro*: $25\n*Básico*: $10');
t('* uno\n* dos\n  - sub\n- tres','• uno\n• dos\n  ◦ sub\n• tres');
t('*ya es negrita* y _cursiva_','*ya es negrita* y _cursiva_');           // no tocar formato nativo
t('Mira [nuestra web](https://x.com) ya','Mira nuestra web: https://x.com ya');
t('[https://x.com](https://x.com)','https://x.com');
t('a\n\n---\n\nb','a\n\nb');
t('| Plan | Precio |\n|---|---|\n| Pro | $25 |','Plan · Precio\nPro · $25');
t('a\n\n\n\n\nb   \n','a\n\nb');
t('~~viejo~~ nuevo','~viejo~ nuevo');
t('```\n* no tocar **esto**\n```\n**sí**','```\n* no tocar **esto**\n```\n*sí*');
t('1. Primero\n2. Segundo','1. Primero\n2. Segundo');
t('  ','') ; t(null,''); t('5 * 3 = 15 y 2 - 1','5 * 3 = 15 y 2 - 1');
// split
assert.deepEqual(sp('hola'),['hola']); assert.deepEqual(sp(''),[]);
const long=Array.from({length:40},(_,i)=>`Párrafo ${i} `+'x'.repeat(100)).join('\n\n');
const parts=sp(long,1000); assert.ok(parts.length>3 && parts.every(p=>p.length<=1000)); assert.equal(parts.join('\n\n').replace(/\s/g,''),long.replace(/\s/g,''));
const giant='palabra '.repeat(600); const g=sp(giant,1000); assert.ok(g.every(p=>p.length<=1000)); assert.equal(g.join(' ').replace(/\s/g,''),giant.replace(/\s/g,''));
assert.equal(typingDelay('a'.repeat(1000)),3000);

console.log('format.js OK');
