// Procesa cada mensaje: actividad, AFK, antispam, antilink, permisos, funciones personalizadas y despacho de comandos.
import * as baileys from '@whiskeysockets/baileys';
import pino from 'pino';
import { config } from './config.js';
import {
  db, getUser, setUser, getGroup, setGroup, getBot, listCustomFunctions, addBotLog,
  getCd, setCd, isChatPaused, pauseChat, resumeChat, addLead, listProducts, getBotAIContext,
  addModerationStrike, penalizeBot,
  saveChatMessage, getChatHistory, saveUserFact, getUserFacts,
  addRecado, listRecados, toggleAutoPilot, filterForbiddenWords,
  isChatAllowedForBot, updateBotAccessControl
} from './db.js';
import { triggerWebhook } from './lib/supabase.js';
import { commands } from './commands/index.js';
import { jidNorm, jidNum, rand, sleep, timeLeft } from './lib/utils.js';
import { getMeta, clearMeta, isAdminOf, botIsAdmin } from './lib/group.js';
import { skin, card, noEmoji, SEP_BOLD, SEP_LINE, SEP_DOT } from './lib/ui.js';
import { splitMessage, typingDelay } from './lib/format.js';
import { askAI, extractUserFacts } from './lib/ai.js';
import { processIncomingAudio } from './lib/audio.js';

const { downloadMediaMessage } = baileys;
const logger = pino({ level: 'silent' });
const LINK_RE = /chat\.whatsapp\.com\/[A-Za-z0-9]{10,}/i;
const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'stickerMessage', 'documentMessage', 'audioMessage'];
const flood = new Map();
const cmdCooldown = new Map(); // control de spam: 3 s entre comandos por persona
const sentByBotIds = new Set(); // evita auto-respuesta a mensajes emitidos por el propio bot

function unwrap(m) {
  let c = m;
  while (c) {
    const w = c.ephemeralMessage || c.viewOnceMessage || c.viewOnceMessageV2 || c.documentWithCaptionMessage;
    if (!w) break;
    c = w.message;
  }
  return c;
}

function isFlooding(key) {
  const now = Date.now(), a = (flood.get(key) || []).filter((t) => now - t < 8000);
  a.push(now); flood.set(key, a);
  return a.length;
}
setInterval(() => { const now = Date.now(); for (const [k, a] of flood) if (!a.some((t) => now - t < 8000)) flood.delete(k); }, 60_000).unref();

/** Envuelve el socket para filtrar palabras prohibidas manteniendo emojis en WhatsApp */
function wrapSock(sock, botId = null) {
  return new Proxy(sock, {
    get(target, prop) {
      if (prop === 'sendMessage') {
        return (jid, content, opts) => {
          if (content && typeof content === 'object') {
            const c2 = { ...content };
            if (typeof c2.text === 'string') {
              let t = c2.text;
              if (botId) t = filterForbiddenWords(botId, t);
              c2.text = t;
            }
            if (typeof c2.caption === 'string') {
              let t = c2.caption;
              if (botId) t = filterForbiddenWords(botId, t);
              c2.caption = t;
            }
            content = c2;
          }
          const sentPromise = target.sendMessage(jid, content, opts);
          Promise.resolve(sentPromise).then((sent) => {
            const id = sent?.key?.id;
            if (id) {
              sentByBotIds.add(id);
              if (sentByBotIds.size > 400) {
                const oldest = sentByBotIds.values().next().value;
                sentByBotIds.delete(oldest);
              }
            }
          }).catch(() => {});
          return sentPromise;
        };
      }
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

function replaceDynamicTags(template, ctx) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  return template
    .replaceAll('{user}', `@${jidNum(ctx.sender)}`)
    .replaceAll('{name}', ctx.name || jidNum(ctx.sender))
    .replaceAll('{number}', jidNum(ctx.sender))
    .replaceAll('{date}', dateStr)
    .replaceAll('{time}', timeStr)
    .replaceAll('{bot}', ctx.botName || 'Etho')
    .replaceAll('{group}', ctx.meta?.subject || 'este chat');
}

export async function handle(rawSock, msg, botContext = {}) {
  if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
  if (msg.key?.id && sentByBotIds.has(msg.key.id)) return;
  const content = unwrap(msg.message);
  if (!content) return;
  const botId = botContext.botId || rawSock.botId || 'default';
  const botRecord = getBot(botId);
  const sock = wrapSock(rawSock, botId);

  // Si el bot fue apagado desde el frontend o está penalizado por moderación, no responde a nada
  if (botRecord && (botRecord.is_active === false || (botRecord.penalty_until && botRecord.penalty_until > Date.now()))) {
    return;
  }

  const botPrefix = botRecord?.prefix || config.prefix;
  const botName = botRecord?.name || config.botName;
  const botSettings = botRecord?.settings || {};

  const chat = msg.key.remoteJid;
  const isGroup = chat.endsWith('@g.us');
  const sender = jidNorm(msg.key.fromMe ? sock.user.id : isGroup ? msg.key.participant : chat);
  if (!sender) return;
  const isOwner = !!msg.key.fromMe ||
    (botRecord?.phone && jidNum(sender) === String(botRecord.phone).replace(/\D/g, '')) ||
    config.owners.includes(jidNum(sender));

  const type = Object.keys(content)[0];
  const info = content[type]?.contextInfo;
  let text = (content.conversation || content.extendedTextMessage?.text ||
    content.imageMessage?.caption || content.videoMessage?.caption || '').trim();

  // Control rápido del dueño dentro de grupos (#activar / #desactivar) sincronizado con el panel
  const ctrlPrefix = botPrefix || '#';
  const lowerCtrlText = text.toLowerCase();
  if (isGroup && isOwner && (
    lowerCtrlText === `${ctrlPrefix}activar` ||
    lowerCtrlText === `${ctrlPrefix}habilitar` ||
    lowerCtrlText === `${ctrlPrefix}desactivar` ||
    lowerCtrlText === `${ctrlPrefix}deshabilitar`
  )) {
    const enableGroup = lowerCtrlText === `${ctrlPrefix}activar` || lowerCtrlText === `${ctrlPrefix}habilitar`;
    const meta = await getMeta(sock, chat).catch(() => null);
    const groupMeta = meta?.subject
      ? { [chat]: { subject: meta.subject, size: meta.participants?.length || 0 } }
      : undefined;
    const accessUpdate = updateBotAccessControl(botId, {
      toggleGroupJid: chat,
      enabled: enableGroup,
      groupMeta
    });
    if (enableGroup) setGroup(chat, { bot_on: 1 });
    if (accessUpdate?.bot && botContext.manager) {
      botContext.manager.emit('bot_update', { botId, ...accessUpdate.bot });
    }
    await sock.sendMessage(chat, {
      text: enableGroup
        ? card({ icon: '✅', title: 'Bot activado en este grupo', body: `Ya respondo en *${meta?.subject || 'este grupo'}*.`, hint: `Para bloquearlo usa ${ctrlPrefix}desactivar o el panel web.` })
        : card({ icon: '🔒', title: 'Bot desactivado en este grupo', body: `Me quedo en silencio en *${meta?.subject || 'este grupo'}* hasta que escribas *${ctrlPrefix}activar* o lo habilites en el panel.` })
    }, { quoted: msg });
    return;
  }

  // Si el dueño escribe #reactivar o #asistente en un chat privado pausado, vuelve a encender al asesor en ese chat
  if (!isGroup && msg.key.fromMe && (
    lowerCtrlText === `${ctrlPrefix}reactivar` ||
    lowerCtrlText === `${ctrlPrefix}asistente`
  )) {
    resumeChat(botId, chat);
    await sock.sendMessage(chat, {
      text: card({ icon: '✅', title: 'Asistente reactivado', body: 'Volveré a responder en este chat hasta que el contacto escriba */enable*.' })
    }, { quoted: msg });
    return;
  }

  // Si el mensaje es del propio dueño/teléfono (fromMe) y no es un comando con prefijo, no auto-responder
  // (No pausa al asesor: el asesor sigue atendiendo al contacto hasta que el contacto use /enable)
  if (msg.key.fromMe && (!text || !text.startsWith(ctrlPrefix))) {
    return;
  }

  // COMPUERTA ESTRICTA DE ACCESO:
  // Bloquea al 100% cualquier grupo no autorizado en la lista blanca o chats privados desactivados
  // antes de procesar audios, IA, catálogo, reglas o comandos.
  if (!isChatAllowedForBot(botRecord, chat)) {
    return;
  }

  const pushName = msg.pushName || jidNum(sender);
  const ownerDisplay = botRecord?.owner_display_name || botRecord?.owner_name || 'el titular';

  // COMANDO EXCLUSIVO DEL CONTACTO EN PRIVADO: /enable
  // Pausa indefinidamente al asesor/ayudante en este chat privado para que el contacto hable directo con el dueño
  const isContactEnableCmd = !isGroup && !msg.key.fromMe && (
    lowerCtrlText === '/enable' || lowerCtrlText.startsWith('/enable ')
  );
  if (isContactEnableCmd) {
    pauseChat(botId, chat, 0, 'Contacto usó /enable (atención directa con el titular)');
    const directMsg = card({
      icon: '🤝',
      title: 'Atención directa activada',
      body: `Dejé en pausa mi asistencia automática para que hables directamente con *${ownerDisplay}*.`,
      hint: 'Escribe tu mensaje; te responderá personalmente en cuanto esté disponible.'
    });
    await sock.sendMessage(chat, { text: directMsg }, { quoted: msg });

    addRecado({
      botId,
      chatJid: chat,
      senderName: pushName,
      senderPhone: jidNum(sender),
      message: text,
      aiReply: '[Contacto usó /enable — Asistente pausado para atención directa]'
    });

    if (botSettings.webhookUrl) {
      triggerWebhook(botSettings.webhookUrl, 'human_handoff_requested', {
        botId, chat, sender, name: pushName, text: '/enable'
      });
    }

    addBotLog({
      botId,
      type: 'connection',
      chatJid: chat,
      senderJid: sender,
      senderName: pushName,
      content: 'Contacto usó /enable: asistente pausado para atención directa',
      details: { command: '/enable', pausedIndefinitely: true }
    });
    return;
  }

  // Si el chat está en pausa (porque el contacto ya usó /enable o pidió #asesor), el bot guarda silencio absoluto
  if (isChatPaused(botId, chat) && !msg.key.fromMe) {
    return;
  }

  let isAudioMsg = false;
  let audioSeconds = 0;

  // Procesamiento VIP de notas de voz y audios (solo si el módulo de audio está activo y el chat no está pausado)
  if (content.audioMessage && botSettings?.modules?.audio !== false) {
    isAudioMsg = true;
    audioSeconds = content.audioMessage.seconds || 0;
    try {
      const audioResult = await processIncomingAudio(msg, content);
      if (audioResult && audioResult.text) {
        text = audioResult.text.trim();
        addBotLog({
          botId,
          type: 'chat',
          chatJid: chat,
          senderJid: sender,
          senderName: pushName,
          content: `Nota de voz transcrita (${audioSeconds}s): "${text}"`
        });
      } else {
        const audioFallback = '🎙️ *Nota de voz recibida*' + (audioSeconds ? ` (${audioSeconds}s)` : '') +
          '\n✍️ Para atenderte con total precisión, ¿podrías escribirme tu consulta o reenviar el audio más claro?';
        await sock.sendMessage(chat, { text: audioFallback }, { quoted: msg });
        addBotLog({
          botId,
          type: 'chat',
          chatJid: chat,
          senderJid: sender,
          senderName: pushName,
          content: `Nota de voz recibida (${audioSeconds}s, inaudible/sin texto)`
        });
        return;
      }
    } catch (err) {
      console.warn('[Handler] Error en audio:', err.message);
    }
  }

  // Si no hay texto, ignorar
  if (!text) return;

  // Si el mensaje es del propio dueño (fromMe) sin prefijo de comando, ignorar sin pausar al asesor
  if (msg.key.fromMe && !text.startsWith(botPrefix)) {
    return;
  }

  const group = isGroup ? getGroup(chat) : null;
  const user = getUser(sender);
  if (user.banned && !isOwner) return;

  // 2. Transferencia a asesor humano alternativa (#asesor / #humano / #soporte)
  const lowerTrimmed = text.toLowerCase().trim();
  const isHandoffReq = [
    `${botPrefix}asesor`, `${botPrefix}humano`, `${botPrefix}soporte`,
    '#asesor', '#humano', '#soporte'
  ].includes(lowerTrimmed);
  if (isHandoffReq && !msg.key.fromMe) {
    const pauseMin = !isGroup ? 0 : (Number(botSettings.humanHandoffMinutes) || 60);
    pauseChat(botId, chat, pauseMin, 'Solicitud de cliente');
    const handoffMsg = botSettings.humanHandoffMsg ||
      card({ icon: '🤝', title: 'Te paso con una persona', body: `Pausé mi asistencia automática para que *${ownerDisplay}* te atienda personalmente.` });
    await sock.sendMessage(chat, { text: handoffMsg }, { quoted: msg });

    if (botSettings.webhookUrl) {
      triggerWebhook(botSettings.webhookUrl, 'human_handoff_requested', {
        botId, chat, sender, name: pushName, text
      });
    }

    addBotLog({
      botId,
      type: 'connection',
      chatJid: chat,
      senderJid: sender,
      senderName: pushName,
      content: 'Atención transferida a asesor humano',
      details: { minutes: pauseMin }
    });
    return;
  }

  // 3. Verificación de Horario Comercial (#11)
  if (!isGroup && botSettings.businessHours?.enabled && !isOwner && !msg.key.fromMe) {
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();
    const min = now.getMinutes();
    const currentTimeStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    const bh = botSettings.businessHours;

    const daysAllowed = Array.isArray(bh.days) ? bh.days : [1, 2, 3, 4, 5];
    const startTime = bh.startTime || '09:00';
    const endTime = bh.endTime || '18:00';

    const isDayAllowed = daysAllowed.includes(day);
    const isTimeAllowed = currentTimeStr >= startTime && currentTimeStr <= endTime;

    if (!isDayAllowed || !isTimeAllowed) {
      const cdKey = `off_hours_${chat}`;
      const lastSent = getCd(sender, cdKey);
      if (Date.now() - lastSent > 3600_000) {
        setCd(sender, cdKey);
        const offMsg = bh.offHoursMsg ||
          '🌙 Gracias por escribirnos. En este momento estamos fuera de nuestro horario de atención.\nTu mensaje ha sido recibido y te responderemos tan pronto abramos.';
        await sock.sendMessage(chat, { text: offMsg }, { quoted: msg });
        return;
      }
    }
  }

  // 4. Catálogo de Productos (#9)
  const isExplicitPrefixedCatalog = lowerTrimmed === `${botPrefix}catalogo` || lowerTrimmed === `${botPrefix}catálogo`;
  const isCatalogReq = isExplicitPrefixedCatalog || lowerTrimmed === 'catalogo' || lowerTrimmed === 'catálogo';
  if (isCatalogReq) {
    const products = listProducts(botId);
    const activeProducts = products.filter(p => p.is_active);
    if (activeProducts.length > 0) {
      const items = activeProducts.map((p, idx) => {
        let block = `*${idx + 1}. ${p.name}* · ${p.price} ${p.currency}`;
        if (p.description) block += `\n_${p.description}_`;
        return block;
      });
      const catText = card({
        icon: '📦',
        title: `Catálogo de ${botName}`,
        body: items.join('\n\n'),
        hint: `¿Quieres pedir algo? Escribe ${botPrefix}asesor y te atiende una persona.`
      });
      await sock.sendMessage(chat, { text: catText }, { quoted: msg });

      addBotLog({
        botId,
        type: 'command',
        chatJid: chat,
        senderJid: sender,
        senderName: pushName,
        content: 'Catálogo de productos enviado'
      });
      return;
    } else if (isExplicitPrefixedCatalog) {
      await sock.sendMessage(chat, {
        text: card({ icon: '📦', title: `Catálogo de ${botName}`, body: 'Todavía no hay productos cargados.', hint: `Escribe ${botPrefix}asesor para hablar con una persona o ${botPrefix}menu para ver los comandos.` })
      }, { quoted: msg });
      return;
    }
  }

  // 5. Captura Automática de Lead / Correo (#10)
  const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
  if (emailMatch && !isGroup) {
    const lead = addLead({
      bot_id: botId,
      name: pushName,
      phone: jidNum(sender),
      email: emailMatch[0],
      interest: text.slice(0, 200),
      status: 'nuevo'
    });
    if (botSettings.webhookUrl) {
      triggerWebhook(botSettings.webhookUrl, 'lead_captured', lead);
    }
    addBotLog({
      botId,
      type: 'command',
      chatJid: chat,
      senderJid: sender,
      senderName: pushName,
      content: `Lead capturado automáticamente: ${emailMatch[0]}`
    });
  }

  // Registrar mensaje entrante en base de datos local y Supabase
  if (text) {
    addBotLog({
      botId,
      type: 'message',
      chatJid: chat,
      senderJid: sender,
      senderName: pushName,
      content: text.slice(0, 300),
      details: { isGroup, isOwner }
    });
  }

  // MODERACIÓN ACTIVA Y PROTECCIÓN ANTI-ABUSO (#Reglas y Penalizaciones)
  if (!isOwner && text.startsWith(botPrefix)) {
    const floodKey = `cmd_bot_flood_${botId}_${sender}`;
    const floodAttempts = isFlooding(floodKey);
    if (floodAttempts >= 6) {
      const updated = addModerationStrike(botId, 'Exceso de flood y saturación de comandos', `Remitente ${jidNum(sender)} superó ${floodAttempts} comandos continuos.`);
      if (updated?.isPenalized) {
        if (botContext.manager) {
          botContext.manager.stopBot(botId).catch(() => {});
        }
        await sock.sendMessage(chat, {
          text: card({ icon: '⛔', title: 'Bot suspendido', body: `Se cerró por ${updated.penalty_days} días por exceso de mensajes repetidos (spam).`, hint: 'Contacta al administrador si crees que fue un error.' })
        }).catch(() => {});
        return;
      } else {
        await sock.sendMessage(chat, {
          text: card({ icon: '⚠️', title: `Advertencia ${updated?.strikes || 1}/3`, body: `@${jidNum(sender)}, estás enviando comandos repetidos muy rápido. Con 3 advertencias el bot se suspende por varios días.` }),
          mentions: [sender]
        }, { quoted: msg }).catch(() => {});
        return;
      }
    }
  }

  // Experiencia y conteo de mensajes
  if (Date.now() - user.last_exp > 30_000) {
    user.exp += rand(5, 15);
    setUser(sender, { exp: user.exp, last_exp: Date.now() });
  }
  if (isGroup) {
    db.prepare(`INSERT INTO msg_daily(group_jid,jid,day,count) VALUES(?,?,?,1)
      ON CONFLICT(group_jid,jid,day) DO UPDATE SET count=count+1`)
      .run(chat, sender, new Date().toISOString().slice(0, 10));
  }

  let meta = null, isAdmin = false, isBotAdmin = false;
  if (isGroup) {
    try {
      meta = await getMeta(sock, chat);
      isAdmin = isAdminOf(meta, sender);
      isBotAdmin = botIsAdmin(sock, meta);
    } catch { /* sin metadata */ }
  }

  const send = (t, mentions = [], opts = {}) => sock.sendMessage(chat, { text: t, mentions }, { quoted: msg, ...opts });
  // Respuestas de IA: "escribiendo..." con pausa proporcional al largo y mensajes largos partidos por párrafos.
  const sendHuman = async (t) => {
    const parts = splitMessage(t);
    for (let i = 0; i < parts.length; i++) {
      await sock.sendPresenceUpdate('composing', chat).catch(() => {});
      await sleep(typingDelay(parts[i]));
      await send(parts[i], [], i === 0 ? {} : { quoted: undefined });
    }
    await sock.sendPresenceUpdate('paused', chat).catch(() => {});
  };

  // AFK: quitar estado al volver y avisar si mencionan a alguien AFK
  if (user.afk_since) {
    setUser(sender, { afk_since: null, afk_reason: null });
    await sock.sendMessage(chat, { text: skin(`👋 @${jidNum(sender)} volvió. Estuvo AFK ${timeLeft(Date.now() - user.afk_since)}.`, { icon: '💤', label: 'AFK' }), mentions: [sender] });
  }
  for (const j of (info?.mentionedJid || []).map(jidNorm)) {
    const u = getUser(j);
    if (u.afk_since) await sock.sendMessage(chat, { text: skin(`💤 @${jidNum(j)} está AFK desde hace ${timeLeft(Date.now() - u.afk_since)}.\nMotivo: ${u.afk_reason || 'sin motivo'}`, { icon: '💤', label: 'AFK' }), mentions: [j] });
  }

  // Antispam
  if (isGroup && group.antispam && !isAdmin && !isOwner) {
    const n = isFlooding(`${chat}|${sender}`);
    if (n === 8) {
      db.prepare('INSERT INTO warns(group_jid,jid,reason,ts) VALUES(?,?,?,?)').run(chat, sender, 'Spam / flood', Date.now());
      const w = db.prepare('SELECT COUNT(*) n FROM warns WHERE group_jid=? AND jid=?').get(chat, sender).n;
      await sock.sendMessage(chat, { text: skin(`🚨 @${jidNum(sender)} deja de hacer spam. Advertencia ${w}/${group.warn_limit}.`, { icon: '🛡️', label: 'Antispam' }), mentions: [sender] });
      if (w >= group.warn_limit && isBotAdmin) {
        await sock.groupParticipantsUpdate(chat, [sender], 'remove').catch(() => {});
        db.prepare('DELETE FROM warns WHERE group_jid=? AND jid=?').run(chat, sender);
      }
    }
    if (n >= 8) return;
  }

  // Antilink
  if (isGroup && group.antilink && LINK_RE.test(text) && !isAdmin && !isOwner && isBotAdmin) {
    await sock.sendMessage(chat, { delete: msg.key }).catch(() => {});
    await sock.groupParticipantsUpdate(chat, [sender], 'remove').catch(() => {});
    return sock.sendMessage(chat, { text: skin(`🚫 @${jidNum(sender)} fue expulsado por enviar enlaces de grupos.`, { icon: '🛡️', label: 'Antilink' }), mentions: [sender] });
  }

  // ========================================================
  // REGLAS Y FUNCIONES PERSONALIZADAS (Creadas desde Frontend)
  // ========================================================
  if (text) {
    const customFns = listCustomFunctions(botId);
    const textLower = text.toLowerCase().trim();

    for (const fn of customFns) {
      if (!fn.is_enabled) continue;
      let matched = false;

      const trigger = fn.trigger_value.toLowerCase().trim();
      if (fn.trigger_type === 'command') {
        const cmdTrigger = trigger.startsWith(botPrefix) ? trigger : `${botPrefix}${trigger}`;
        matched = textLower === cmdTrigger || textLower.startsWith(`${cmdTrigger} `);
      } else if (fn.trigger_type === 'exact') {
        matched = textLower === trigger;
      } else if (fn.trigger_type === 'contains') {
        matched = textLower.includes(trigger);
      } else if (fn.trigger_type === 'regex') {
        try {
          matched = new RegExp(fn.trigger_value, 'i').test(text);
        } catch { /* regex invalido */ }
      }

      if (matched) {
        const rendered = replaceDynamicTags(fn.response_text, {
          sender, name: pushName, botName, meta
        });
        const mentions = rendered.includes(`@${jidNum(sender)}`) ? [sender] : [];
        await send(rendered, mentions);

        addBotLog({
          botId,
          type: 'custom_rule',
          chatJid: chat,
          senderJid: sender,
          senderName: pushName,
          content: `Regla activada: ${fn.name}`,
          details: { trigger: fn.trigger_value, type: fn.trigger_type }
        });
        return; // Detener flujo para no evaluar más si coincidió una regla personalizada
      }
    }
  }

  // ========================================================
  // COMANDOS DEL BOT Y RESPALDO CON INTELIGENCIA ARTIFICIAL
  // ========================================================
  const afterPrefix = botPrefix && text.startsWith(botPrefix)
    ? text.slice(botPrefix.length).trim()
    : '';
  const isPrefixedAttempt = Boolean(afterPrefix && /^[a-zA-ZÁÉÍÓÚáéíóúñÑ0-9]{2,}/.test(afterPrefix));
  const cmdName = isPrefixedAttempt ? afterPrefix.split(/\s+/)[0]?.toLowerCase() : '';
  const cmd = cmdName ? commands.get(cmdName) : null;
  if (!cmd) {
    const isUnknownCmd = isPrefixedAttempt;
    // Si es mensaje saliente manual sin prefijo de comando, no auto-responder
    if (msg.key.fromMe && !isUnknownCmd) return;
    if (text.length < 2) return;

    // Cooldown breve por chat (2s para conversación, 1s para comandos no encontrados)
    const aiCdKey = isUnknownCmd ? `ai_unk_${chat}_${sender}` : `ai_cd_${chat}`;
    const cdWindowMs = isUnknownCmd ? 1000 : 2200;
    if (Date.now() - getCd(chat, aiCdKey) < cdWindowMs) return;

    // Detección contextual: ¿El usuario busca un comando o se dirige al bot?
    const isDM = !isGroup;
    const botJid = jidNorm(sock.user?.id || '');
    const isBotTagged = (info?.mentionedJid || []).map(jidNorm).includes(botJid);
    const isReplyToBot = info?.quotedMessage && (jidNorm(info.participant) === botJid || info.remoteJid === botJid);

    // Mención por nombre: e.g. "etho hola como estas", "hola sofia", "oye bot"
    const botNameClean = (botName || 'Etho').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameRegex = new RegExp(`(^|\\s|¿|¡)(${botNameClean}|etho|bot)($|\\s|[.,!?])`, 'i');
    const isNameMentioned = nameRegex.test(text);

    // En chat privado (DM), el bot actúa de forma continua como Asesor/Ayudante del dueño
    // hasta que el contacto escriba /enable (que pausa el chat arriba).
    const isAutoPilotActive = Boolean(botRecord?.auto_pilot !== undefined ? botRecord.auto_pilot : true);

    const shouldEngage = isUnknownCmd || (
      (isDM && (isAutoPilotActive || botRecord?.ai_auto_reply !== false)) ||
      isNameMentioned ||
      isBotTagged ||
      isReplyToBot ||
      botRecord?.personality === 'ai_autonomous'
    );

    if (shouldEngage) {
      setCd(chat, aiCdKey);
      try {
        const aiCtx = getBotAIContext(botId);

        // 1. Extraer y persistir hechos clave del usuario ("me llamo X", "mi negocio es Y", correo, interés)
        const learnedFacts = extractUserFacts(text);
        for (const fact of learnedFacts) {
          saveUserFact(botId, sender, fact.key, fact.value);
        }

        // 2. Recuperar perfil recordado del remitente y los últimos 12 turnos de conversación
        const userFacts = getUserFacts(botId, sender);
        const history = getChatHistory(botId, chat, 12);

        // 3. Guardar el mensaje entrante del usuario en la memoria del chat
        saveChatMessage(botId, chat, sender, 'user', text);

        // 4. Mostrar indicador de 'escribiendo...' en WhatsApp
        await sock.sendPresenceUpdate('composing', chat).catch(() => {});

        // 5. Respuesta directa y experta de la IA (CERO recomendaciones de comandos)
        const isAdvisorDM = isDM && isAutoPilotActive && !isUnknownCmd;
        const aiResponse = await askAI(text, aiCtx.systemPrompt, aiCtx.personality || 'assistant', {
          history,
          userFacts,
          botName: aiCtx.botName || botName,
          purpose: aiCtx.purpose,
          isAutoPilot: isAdvisorDM,
          pilotPersona: aiCtx.pilotPersona || 'as_assistant',
          ownerName: aiCtx.ownerName || ownerDisplay,
          pilotContext: aiCtx.pilotContext || '',
          tone: aiCtx.tone,
          forbiddenWords: aiCtx.forbiddenWords,
          preferredWords: aiCtx.preferredWords,
          products: aiCtx.products,
          knowledge: aiCtx.knowledge,
          businessHours: aiCtx.businessHours,
          prefix: botPrefix,
          unknownCommand: isUnknownCmd ? cmdName : ''
        });

        if (aiResponse) {
          // 6. Guardar la respuesta del bot en la memoria conversacional
          saveChatMessage(botId, chat, botId, 'assistant', aiResponse);

          // 7. Enviar respuesta limpia y directa
          await sendHuman(aiResponse);

          // 8. Si fue atención de Asesor/Ayudante en DM, guardar el recado para el dueño
          if (isAdvisorDM && !msg.key.fromMe) {
            addRecado({
              botId,
              chatJid: chat,
              senderName: pushName,
              senderPhone: jidNum(sender),
              message: text,
              aiReply: aiResponse
            });
          }

          addBotLog({
            botId,
            type: isAdvisorDM ? 'pilot_response' : 'ai_response',
            chatJid: chat,
            senderJid: sender,
            senderName: pushName,
            content: aiResponse.slice(0, 300),
            details: {
              prompt: text,
              personality: aiCtx.personality,
              isAutoPilot: isAdvisorDM,
              factsLearned: learnedFacts.length
            }
          });
        }
      } catch (err) {
        console.error(`[${botId}] Error en atención IA:`, err);
      }
      return;
    }
    return;
  }

  const reply = (t, mentions = []) =>
    send(skin(t, { label: cmd?.category || botName, command: cmd?.name, prefix: botPrefix }), mentions);

  // Anti-spam de comandos: máximo un comando cada 3 segundos por persona (el dueño queda exento).
  if (!isOwner) {
    const last = cmdCooldown.get(sender) || 0;
    if (Date.now() - last < 3000) return;
    cmdCooldown.set(sender, Date.now());
  }

  const args = text.slice(botPrefix.length).trim().split(/\s+/).slice(1);

  if (isGroup && !group.bot_on && cmd.name !== 'bot') return;
  if (isGroup && group.onlyadmin && !isAdmin && !isOwner) return;

  // Verificación de módulos desactivados en grupo o en botSettings
  if (cmd.feature && isGroup && group[cmd.feature] === 0) return reply(`Los comandos de *${cmd.category}* están desactivados en este grupo.`);
  if (botSettings.disabledCategories?.includes(cmd.category)) return reply(`La categoría *${cmd.category}* está desactivada en este bot.`);

  if (cmd.group && !isGroup) return reply('⚠️ Este comando solo funciona en grupos.');
  if (cmd.owner && !isOwner) return reply('⛔ Solo el dueño del bot puede usar este comando.');
  if (cmd.admin && !isAdmin && !isOwner) return reply('⛔ Solo los administradores pueden usar este comando.');
  if (cmd.botAdmin && !isBotAdmin) return reply('⚠️ Necesito ser administrador del grupo para hacer eso.');

  const quoted = info?.quotedMessage
    ? {
        key: { remoteJid: chat, id: info.stanzaId, participant: info.participant },
        message: info.quotedMessage,
        sender: info.participant ? jidNorm(info.participant) : null,
      }
    : null;
  const target = jidNorm(info?.mentionedJid?.[0] || quoted?.sender || '') || null;

  const ctx = {
    sock, msg, chat, sender, isGroup, isAdmin, isBotAdmin, isOwner, meta, group, user,
    name: pushName,
    botId,
    botName,
    args, text: args.join(' '), prefix: botPrefix, command: cmdName, quoted, target,
    mentions: (info?.mentionedJid || []).map(jidNorm),
    reply,
    raw: send,
    refreshMeta: () => clearMeta(chat),
    async media() {
      const sources = [{ key: msg.key, message: content }];
      if (quoted) sources.push({ key: quoted.key, message: unwrap(quoted.message) });
      for (const s of sources) {
        const t = MEDIA_TYPES.find((k) => s.message?.[k]);
        if (!t) continue;
        const buffer = await downloadMediaMessage(s, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
        return { buffer, type: t, mimetype: s.message[t].mimetype };
      }
      return null;
    },
  };

  try {
    addBotLog({
      botId,
      type: 'command',
      chatJid: chat,
      senderJid: sender,
      senderName: pushName,
      content: `${botPrefix}${cmdName} ${ctx.text}`.trim(),
      details: { category: cmd.category }
    });

    await cmd.run(ctx);
  } catch (err) {
    console.error(`[${cmd.name}]`, err);
    addBotLog({
      botId,
      type: 'error',
      chatJid: chat,
      senderJid: sender,
      senderName: pushName,
      content: `Error en ${botPrefix}${cmd.name}: ${err.message}`,
      details: { stack: err.stack }
    });
    console.error(`[Handler] Error en ${botPrefix}${cmd.name}:`, err);
    await reply(`No pude completar *${botPrefix}${cmd.name}* por un problema técnico. Inténtalo de nuevo en un momento.`).catch(() => {});
  }
}
