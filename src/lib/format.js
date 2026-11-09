// Convierte texto Markdown "de chat con IA" al formato nativo de WhatsApp y lo deja limpio y legible.
// WhatsApp: *negrita*  _cursiva_  ~tachado~  ```monoespaciado```  > cita
// Sin dependencias: solo funciones puras (fáciles de probar).

const FENCE = /(```[\s\S]*?```)/g;

function tidyOutsideCode(chunk) {
  return chunk
    // Imágenes y enlaces Markdown -> "texto: url" (o solo la URL si el texto es la misma URL)
    .replace(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t, u) => (t.trim() === u ? u : `${t.trim()}: ${u}`))
    // Títulos (# Título) -> *Título*
    .replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, (_, t) => `*${t.replace(/\*+/g, '').trim()}*`)
    // Negrita Markdown (**x** / __x__) -> *x*
    .replace(/\*\*([^*\n]+?)\*\*/g, '*$1*')
    .replace(/__([^_\n]+?)__/g, '*$1*')
    // Tachado ~~x~~ -> ~x~
    .replace(/~~([^~\n]+?)~~/g, '~$1~')
    // Reglas horizontales: se eliminan (el espaciado ya separa las ideas)
    .replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, '')
    // Tablas: se quita la fila separadora y las filas pasan a "a · b · c"
    .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*(?:\n|$)/gm, '')
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_, row) => row.split('|').map((c) => c.trim()).filter(Boolean).join(' · '))
    // Viñetas (* item, - item, + item) -> •  (los sub-niveles usan ◦)
    .replace(/^([ \t]*)[*+-][ \t]+(?=\S)/gm, (_, ind) => (ind.replace(/\t/g, '  ').length >= 2 ? '  ◦ ' : '• '));
}

/** Limpia y adapta una respuesta de IA para enviarla por WhatsApp. */
export function formatForWhatsApp(input) {
  if (!input || typeof input !== 'string') return '';
  const text = input.replace(/\r\n?/g, '\n');
  const out = text
    .split(FENCE)
    .map((part, i) => (i % 2 === 1 ? part : tidyOutsideCode(part)))
    .join('');
  return out
    .replace(/[ \t]+$/gm, '')          // espacios al final de línea
    .replace(/[ \t]{2,}(?=\S)/g, (m, off, s) => (s[off - 1] === '\n' || off === 0 ? m : ' ')) // dobles espacios internos
    .replace(/\n{3,}/g, '\n\n')       // máximo una línea en blanco
    .trim();
}

/** Parte un texto largo en mensajes cortos respetando párrafos (mejor lectura en el celular). */
export function splitMessage(text, max = 1800) {
  const t = String(text || '').trim();
  if (t.length <= max) return t ? [t] : [];
  const parts = [];
  let cur = '';
  const push = () => { if (cur.trim()) parts.push(cur.trim()); cur = ''; };
  for (const para of t.split(/\n{2,}/)) {
    if (para.length > max) {
      push();
      // párrafo gigante: cortar por líneas y, en último caso, por oraciones/espacios
      for (const line of para.split('\n')) {
        if ((cur + '\n' + line).length > max) push();
        if (line.length > max) {
          let rest = line;
          while (rest.length > max) {
            let cut = Math.max(rest.lastIndexOf('. ', max), rest.lastIndexOf(' ', max));
            if (cut < max * 0.5) cut = max;
            parts.push(rest.slice(0, cut + 1).trim());
            rest = rest.slice(cut + 1);
          }
          cur = rest;
        } else {
          cur = cur ? `${cur}\n${line}` : line;
        }
      }
      continue;
    }
    if ((cur + '\n\n' + para).length > max) push();
    cur = cur ? `${cur}\n\n${para}` : para;
  }
  push();
  return parts;
}

/** Pausa realista de "escribiendo..." según el largo del texto (entre 0.6 s y 3 s). */
export const typingDelay = (text) => Math.min(3000, 600 + String(text || '').length * 15);
