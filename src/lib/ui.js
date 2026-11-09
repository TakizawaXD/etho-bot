// Formato y presentación de mensajes para WhatsApp con emojis distintivos por categoría y comando.
import { config } from '../config.js';

export const CATEGORY_EMOJIS = {
  Productividad: '⚡',
  Administración: '🛡️',
  Multimedia: '🎨',
  Utilidades: '🧭',
  Control: '👑',
  Descargas: '📥',
  Comunidad: '💰',
  Dinámicas: '🎲',
  Perfiles: '👤',
  Bienvenida: '👋',
  Despedida: '🚪',
  Recordatorio: '⏰',
  Anuncio: '📢'
};

export const COMMAND_EMOJIS = {
  // Menú, Info y Sistema
  menu: '📋', help: '📋', comandos: '📋', ayuda: '📋',
  ping: '📡', status: '📈', botinfo: 'ℹ️', mimo: '👋',
  report: '📩', suggest: '💡', toimg: '🏞️',

  // Productividad & Herramientas
  ia: '🤖', resetia: '🧹', calc: '🧮', clima: '🌤️', wiki: '📚',
  traducir: '🌐', qr: '🔳', acortar: '🔗', hora: '🕒', recordar: '⏰',
  nota: '📝', encuesta: '📊', afk: '💤', pass: '🔐',

  // Administración de Grupos
  activar: '✅', habilitar: '✅', desactivar: '🔒', deshabilitar: '🔒',
  listadmins: '👮', setrules: '📝', rules: '📜', antilink: '🚫',
  antispam: '🛡️', bot: '🤖', economy: '💰', gacha: '🎴',
  goodbye: '🚪', welcome: '👋', nsfw: '🔞', onlyadmin: '🔒',
  close: '🔐', open: '🔓', kick: '🥾', promote: '⬆️', demote: '⬇️',
  groupimage: '🖼️', setwelcome: '👋', setgoodbye: '🚪', setwarnlimit: '⚖️',
  warn: '⚠️', warns: '📋', delwarn: '✅', tag: '📣', tagall: '📣', hidetag: '📢',
  msgcount: '💬', topcount: '🏆', topinactive: '💤',

  // Multimedia & Stickers
  sticker: '🖼️', s: '🖼️', setstickermeta: '🏷️', delstickermeta: '🗑️',
  newpack: '📦', delpack: '🗑️', stickerpacks: '🗂️', stickeradd: '➕',
  stickerdel: '➖', getpack: '📤', setpackpublic: '🌍', setpackprivate: '🔒',
  setstickerpackdesc: '📝', packfavourite: '⭐', packunfavourite: '✖️',

  // Descargas
  play: '🎵', mp4: '🎬', ytsearch: '🔎', tiktok: '📱',
  facebook: '📘', reel: '📸', twitter: '🐦',

  // Economía & Comunidad
  balance: '💰', coinflip: '🪙', crime: '🕵️', daily: '🎁',
  deposit: '🏦', withdraw: '🏧', economyboard: '🏆', economyinfo: '📊',
  givecoins: '💸', roulette: '🎡', steal: '🥷', work: '💼',

  // Juegos & Dinámicas
  slots: '🎰', ppt: '✊', dado: '🎲', '8ball': '🎱',
  ship: '💘', trivia: '🧠', responder: '✍️', suerte: '🍀',

  // RPG
  minar: '⛏️', pescar: '🎣', cazar: '🏹', tienda: '🏪',
  comprar: '🛒', inventario: '🎒', vendertodo: '💵',

  // Gacha
  rollwaifu: '🎴', claim: '✨', harem: '💫', charinfo: '🔍', charimage: '🖼️',

  // Perfiles
  profile: '🪪', level: '⭐', leaderboard: '🏅', setdescription: '✏️',
  setbirth: '🎂', delbirth: '🗑️', birthdays: '🎉', allbirthdays: '📅',
  setgenre: '👤', delgenre: '🗑️', setfavourite: '🌟', delfavourite: '🗑️',
  marry: '💍', divorce: '💔', marryhistory: '📖', group: '👥',

  // Control del Dueño
  ban: '⛔', unban: '✅', broadcast: '📢', backup: '💾',
  addcoins: '💎', piloto: '🎙️', recados: '📬', personalidad: '🎭', palabras: '🔤'
};

export function getCategoryEmoji(category = '') {
  return CATEGORY_EMOJIS[category] || '✨';
}

export function getCommandEmoji(cmdName = '', category = '') {
  const key = String(cmdName || '').toLowerCase();
  return COMMAND_EMOJIS[key] || CATEGORY_EMOJIS[category] || '🔹';
}

/** Utilidad opcional para limpiar emojis solo cuando se solicite explícitamente */
export function noEmoji(str = '') {
  if (!str) return '';
  return String(str)
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0E}\u{FE0F}\u{200D}\u{231A}-\u{231B}\u{23E9}-\u{23EC}\u{23F0}\u{23F3}]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([,.;:!?])/g, '$1')
    .trim();
}

// Separadores compactos: caben en una sola línea en cualquier celular, sin cortarse dentro de la burbuja.
export const SEP_BOLD = '━━━━━━━━━━━━━━';
export const SEP_LINE = '──────────────';
export const SEP_DOT = '┄┄┄┄┄┄┄┄┄┄┄┄┄┄';

export const purr = () => '';

/**
 * Envuelve respuestas de comandos con un encabezado compacto y limpio:
 *   *🎵 #play* · _Multimedia_
 *   ──────────────
 *   contenido
 */
export function skin(text, { label = config.botName, command = null, prefix = '#', icon = null } = {}) {
  if (!text) return '';
  const body = String(text).trim();

  if (command) {
    const cmdEmoji = getCommandEmoji(command, label);
    return `*${cmdEmoji} ${prefix || '#'}${command}* · _${label}_\n${SEP_LINE}\n${body}`;
  }

  const ico = icon || CATEGORY_EMOJIS[label];
  if (label && ico) {
    return `*${ico} ${String(label).toUpperCase()}*\n${SEP_LINE}\n${body}`;
  }

  return body;
}

/**
 * Tarjeta de mensaje limpia y uniforme para avisos del sistema:
 *   *✅ Título*
 *   ──────────────
 *   Texto principal
 *
 *   _Pista opcional_
 */
export function card({ icon = '', title = '', body = '', hint = '' } = {}) {
  const head = `*${icon ? `${icon} ` : ''}${title}*`;
  return [head, SEP_LINE, String(body).trim(), hint ? `\n_${String(hint).trim()}_` : ''].filter((x) => x !== '').join('\n');
}

/** Barra de progreso hecha con caracteres de bloque */
export const bar = (cur, max, n = 10) => {
  const f = Math.max(0, Math.min(n, Math.round((cur / Math.max(1, max)) * n)));
  return '▰'.repeat(f) + '▱'.repeat(n - f);
};
export const row = (k, v) => `${k}: ${v}`;
