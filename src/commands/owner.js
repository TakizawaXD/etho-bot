import fs from 'fs';
import {
  db, setUser, getUser, toggleAutoPilot, getBot, listRecados, markRecadosRead,
  getBotPersonality, updateBotPersonality
} from '../db.js';
import { config } from '../config.js';
import { sleep, jidNum } from '../lib/utils.js';
import { skin, noEmoji, SEP_LINE, SEP_DOT } from '../lib/ui.js';

export default [
  { name: 'ban', desc: 'Bloquear a un usuario del bot.', usage: '[@mención]', owner: true,
    run: async (c) => {
      if (!c.target) return c.reply('Menciona a alguien.');
      getUser(c.target);
      setUser(c.target, { banned: 1 });
      await c.reply(`@${jidNum(c.target)} ya no puede usar el bot.`, [c.target]);
    }
  },
  { name: 'unban', desc: 'Desbloquear a un usuario.', usage: '[@mención]', owner: true,
    run: async (c) => {
      if (!c.target) return c.reply('Menciona a alguien.');
      setUser(c.target, { banned: 0 });
      await c.reply(`@${jidNum(c.target)} desbloqueado.`, [c.target]);
    }
  },
  { name: 'broadcast', aliases: ['bc'], desc: 'Enviar un anuncio a todos los grupos.', usage: '[texto]', owner: true,
    run: async (c) => {
      if (!c.text) return c.reply('Escribe el anuncio.');
      const groups = Object.keys(await c.sock.groupFetchAllParticipating());
      for (const g of groups) {
        await c.sock.sendMessage(g, { text: skin(c.text, { label: 'Anuncio' }) }).catch(() => {});
        await sleep(1500);
      }
      await c.reply(`Anuncio enviado a ${groups.length} grupo(s).`);
    }
  },
  { name: 'backup', desc: 'Recibir una copia de la base de datos.', owner: true,
    run: async (c) => {
      db.pragma('wal_checkpoint(TRUNCATE)');
      await c.sock.sendMessage(c.chat, {
        document: fs.readFileSync(config.dbPath),
        mimetype: 'application/octet-stream',
        fileName: `etho-backup-${new Date().toISOString().slice(0, 10)}.db`
      }, { quoted: c.msg });
    }
  },
  { name: 'addcoins', desc: 'Dar coins a un usuario.', usage: '[@mención] [cantidad]', owner: true,
    run: async (c) => {
      const n = parseInt(c.args.find((a) => /^-?\d+$/.test(a)));
      if (!c.target || !n) return c.reply('Uso: #addcoins @usuario 1000');
      const u = getUser(c.target);
      setUser(c.target, { coins: Math.max(0, u.coins + n) });
      await c.reply(`${n > 0 ? '+' : ''}${n} ${config.currency} para @${jidNum(c.target)}.`, [c.target]);
    }
  },
  { name: 'piloto', aliases: ['hablarpormi', 'autopilot'], desc: 'Configurar el modo Hablar por Mí (Piloto Automático).', usage: '[on|off|modo|contexto]', owner: true,
    run: async (c) => {
      const sub = (c.args[0] || '').toLowerCase();
      const botId = c.botId || 'default';

      if (sub === 'on') {
        toggleAutoPilot(botId, { enabled: true });
        return c.reply('Modo *Hablar por Mí (Piloto Automático)* ACTIVADO.\nLa IA responderá automáticamente tus chats privados para que no tengas que hablar.');
      }
      if (sub === 'off') {
        toggleAutoPilot(botId, { enabled: false });
        return c.reply('Modo *Hablar por Mí* DESACTIVADO.\nAhora responderás tus mensajes manualmente.');
      }
      if (sub === 'modo') {
        const m = (c.args[1] || '').toLowerCase();
        if (m === 'yo' || m === 'clon') {
          toggleAutoPilot(botId, { persona: 'as_me' });
          return c.reply('Estilo configurado: *Clon en 1ra persona* (la IA hablará diciendo "yo", como si fueras tú sin emojis).');
        }
        if (m === 'asistente') {
          toggleAutoPilot(botId, { persona: 'as_assistant' });
          return c.reply('Estilo configurado: *Asistente Personal* (la IA dirá que es tu asistente y tomará recados).');
        }
        return c.reply(`Uso: ${c.prefix}piloto modo yo  o  ${c.prefix}piloto modo asistente`);
      }
      if (sub === 'contexto' || sub === 'ctx') {
        const ctx = c.args.slice(1).join(' ');
        if (!ctx) return c.reply(`Uso: ${c.prefix}piloto contexto Estoy en una reunión hasta las 4pm`);
        toggleAutoPilot(botId, { context: ctx });
        return c.reply(`Contexto del piloto actualizado:\n"${ctx}"`);
      }

      const bot = getBot(botId);
      const isAct = bot?.auto_pilot;
      const modoTxt = bot?.pilot_persona === 'as_assistant' ? 'Asistente Personal' : 'Clon en 1ra persona (como yo)';
      await c.reply(
        `🎙️ *MODO HABLAR POR MÍ (PILOTO AUTOMÁTICO)*\n` +
        `• Estado: ${isAct ? '🟢 ACTIVADO (La IA habla por ti)' : '⚪ DESACTIVADO (Manual)'}\n` +
        `• Estilo: *${modoTxt}*\n` +
        `• Contexto actual: _${bot?.pilot_context || 'Ninguno (conversación normal)'}_\n` +
        `${SEP_LINE}\n` +
        `⚡ *Comandos rápidos:*\n` +
        [
          `🟢 *${c.prefix}piloto on* — Encender piloto`,
          `⚪ *${c.prefix}piloto off* — Apagar piloto`,
          `🎭 *${c.prefix}piloto modo* [yo|asistente]`,
          `📝 *${c.prefix}piloto contexto* [instrucciones]`,
          `📬 *${c.prefix}recados* — Ver mensajes que te dejaron`
        ].join(`\n${SEP_DOT}\n`)
      );
    }
  },
  { name: 'recados', aliases: ['mensajesrecibidos'], desc: 'Ver los recados y mensajes atendidos por la IA mientras no estabas.', owner: true,
    run: async (c) => {
      const botId = c.botId || 'default';
      const list = listRecados(botId, 10);
      if (!list.length) {
        return c.reply('📭 No tienes recados nuevos. Nadie ha dejado mensajes mientras el piloto estuvo activo.');
      }
      markRecadosRead(botId);
      const items = list.map((r, idx) => {
        const time = new Date(r.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        let block = `👤 *${idx + 1}. De ${r.sender_name}* (+${r.sender_phone}) [${time}]\n   💬 "${r.message}"`;
        if (r.ai_reply) {
          block += `\n   🤖 _Respuesta: "${r.ai_reply.slice(0, 100)}..."_`;
        }
        return block;
      });
      await c.reply(`📬 *ÚLTIMOS RECADOS RECIBIDOS* (${list.length})\n${SEP_LINE}\n` + items.join(`\n${SEP_DOT}\n`));
    }
  },
  { name: 'personalidad', aliases: ['persona', 'tono'], desc: 'Gestionar el tono e instrucciones de personalidad del bot.', owner: true,
    run: async (c) => {
      const sub = (c.args[0] || '').toLowerCase();
      const botId = c.botId || 'default';
      const cur = getBotPersonality(botId);
      if (!cur) return c.reply('No se encontró la configuración del bot.');

      if (sub === 'tono') {
        const toneVal = (c.args[1] || '').toLowerCase();
        const validTones = ['profesional', 'amigable', 'ejecutivo', 'directo'];
        if (!validTones.includes(toneVal)) {
          return c.reply(`Tonos disponibles: ${validTones.join(', ')}. Ejemplo: ${c.prefix}personalidad tono ejecutivo`);
        }
        updateBotPersonality(botId, { tone: toneVal });
        return c.reply(`✅ Tono de la IA actualizado a: *${toneVal.toUpperCase()}*.`);
      }

      if (sub === 'prompt' || sub === 'instrucciones') {
        const newPrompt = c.args.slice(1).join(' ').trim();
        if (!newPrompt) return c.reply(`Uso: ${c.prefix}personalidad prompt Eres un asesor ejecutivo serio y formal...`);
        updateBotPersonality(botId, { system_prompt: newPrompt });
        return c.reply(`✅ Instrucciones del sistema actualizadas exitosamente:\n"${newPrompt}"`);
      }

      await c.reply(
        `🎭 *GESTIÓN DE PERSONALIDAD*\n` +
        `• Tono actual: *${(cur.tone || 'profesional').toUpperCase()}*\n` +
        `• Faceta: *${(cur.personality || 'autónomo').toUpperCase()}*\n` +
        `• Emojis y separadores: *ACTIVADOS*\n` +
        `• Palabras prohibidas activas: ${cur.forbidden_words.length}\n` +
        `• Palabras preferidas activas: ${cur.preferred_words.length}\n` +
        `• Instrucciones actuales: _"${(cur.system_prompt || 'Por defecto').slice(0, 120)}..."_\n` +
        `${SEP_LINE}\n` +
        `⚡ *Comandos disponibles:*\n` +
        [
          `🎨 *${c.prefix}personalidad tono* [profesional|amigable|ejecutivo|directo]`,
          `📝 *${c.prefix}personalidad prompt* [instrucciones]`,
          `🔤 *${c.prefix}palabras* — Gestionar vocabulario`
        ].join(`\n${SEP_DOT}\n`)
      );
    }
  },
  { name: 'palabras', aliases: ['words', 'filtro'], desc: 'Gestionar palabras prohibidas (censuradas) y palabras preferidas.', owner: true,
    run: async (c) => {
      const sub = (c.args[0] || '').toLowerCase();
      const botId = c.botId || 'default';
      const cur = getBotPersonality(botId);
      if (!cur) return c.reply('No se encontró la configuración del bot.');

      if (sub === 'prohibir' || sub === 'ban') {
        const word = (c.args[1] || '').toLowerCase().trim();
        if (!word) return c.reply(`Uso: ${c.prefix}palabras prohibir [palabra]`);
        const setWords = new Set(cur.forbidden_words);
        setWords.add(word);
        updateBotPersonality(botId, { forbidden_words: Array.from(setWords) });
        return c.reply(`🚫 Palabra prohibida agregada: *${word}*. El bot la censurará automáticamente con ***.`);
      }

      if (sub === 'permitir' || sub === 'unban') {
        const word = (c.args[1] || '').toLowerCase().trim();
        if (!word) return c.reply(`Uso: ${c.prefix}palabras permitir [palabra]`);
        const newForbidden = cur.forbidden_words.filter(w => w !== word);
        updateBotPersonality(botId, { forbidden_words: newForbidden });
        return c.reply(`✅ Palabra eliminada de la lista prohibida: *${word}*.`);
      }

      if (sub === 'preferida' || sub === 'priorizar') {
        const word = c.args.slice(1).join(' ').trim();
        if (!word) return c.reply(`Uso: ${c.prefix}palabras preferida [palabra o frase]`);
        const setWords = new Set(cur.preferred_words);
        setWords.add(word);
        updateBotPersonality(botId, { preferred_words: Array.from(setWords) });
        return c.reply(`⭐ Palabra/frase preferida agregada: *${word}*.`);
      }

      let out = `🔤 *GESTIÓN DE PALABRAS Y VOCABULARIO*\n${SEP_LINE}\n`;
      out += `🚫 *Palabras Prohibidas (Censuradas con ***):*\n`;
      if (cur.forbidden_words.length === 0) {
        out += `_Ninguna palabra prohibida configurada._\n`;
      } else {
        out += cur.forbidden_words.map(w => `• ${w}`).join('\n') + '\n';
      }
      out += `\n⭐ *Palabras y Frases Preferidas:*\n`;
      if (cur.preferred_words.length === 0) {
        out += `_Ninguna palabra preferida configurada._\n`;
      } else {
        out += cur.preferred_words.map(w => `• ${w}`).join('\n') + '\n';
      }
      out += `${SEP_LINE}\n⚡ *Comandos:*\n` + [
        `🚫 *${c.prefix}palabras prohibir* <palabra>`,
        `✅ *${c.prefix}palabras permitir* <palabra>`,
        `⭐ *${c.prefix}palabras preferida* <frase>`
      ].join(`\n${SEP_DOT}\n`);
      return c.reply(out);
    }
  }
];
