// Gestor Multi-Bot de WhatsApp para Etho Bot
// Permite inicializar, monitorear, apagar, encender y gestionar múltiples números en simultáneo.
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import * as baileys from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { config } from './config.js';
import {
  db, listBots, getBot, upsertBot, setBotStatus, deleteBot as dbDeleteBot,
  getGroup, addBotLog, isChatAllowedForBot, normalizeBotAccessControl
} from './db.js';
import { handle } from './handler.js';
import { getMeta, clearMeta } from './lib/group.js';
import { skin } from './lib/ui.js';
import { ffmpegPath, jidNum, jidNorm } from './lib/utils.js';

// wa-sticker-formatter busca ffmpeg en el PATH
process.env.PATH = `${path.dirname(ffmpegPath)}${path.delimiter}${process.env.PATH}`;

const makeWASocket = baileys.default || baileys.makeWASocket;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = baileys;

class BotManager extends EventEmitter {
  constructor() {
    super();
    this.instances = new Map(); // botId -> { sock, status, qr, qrRaw, pairingCode, reconnectTimer, remindersTimer }
    this.sessionsBaseDir = path.resolve(process.cwd(), config.sessionDir || './data/sessions');
    try {
      fs.mkdirSync(this.sessionsBaseDir, { recursive: true });
    } catch (e) {
      if (config.isVercel || e.code === 'EROFS') {
        this.sessionsBaseDir = path.resolve('/tmp', 'sessions');
        try { fs.mkdirSync(this.sessionsBaseDir, { recursive: true }); } catch {}
      }
    }
  }

  getSessionPath(botId) {
    return path.join(this.sessionsBaseDir, botId);
  }

  /** Obtiene todos los bots combinando su información en BD y su estado en memoria */
  getAllBots() {
    const list = listBots();
    return list.map(b => {
      const inst = this.instances.get(b.id);
      return {
        ...b,
        status: inst ? inst.status : (b.is_active ? 'offline' : 'stopped'),
        qr_code: inst?.qr || null,
        pairing_code: inst?.pairingCode || null,
        connected_at: inst?.connectedAt || null
      };
    });
  }

  /** Obtiene estado en vivo de un bot específico */
  getBot(botId) {
    const bot = getBot(botId);
    if (!bot) return null;
    const inst = this.instances.get(botId);
    return {
      ...bot,
      status: inst ? inst.status : (bot.is_active ? 'offline' : 'stopped'),
      qr_code: inst?.qr || null,
      pairing_code: inst?.pairingCode || null,
      connected_at: inst?.connectedAt || null
    };
  }

  /** Enciende / Inicia un bot */
  async startBot(botId, force = false, options = {}) {
    let bot = getBot(botId);
    if (!bot) {
      throw new Error(`Bot ${botId} no encontrado en la base de datos.`);
    }

    // Verificar si el bot está penalizado por infracción a las reglas
    if (bot.penalty_until && bot.penalty_until > Date.now()) {
      const remainingHours = Math.ceil((bot.penalty_until - Date.now()) / (3600 * 1000));
      const remainingDays = Math.ceil(remainingHours / 24);
      throw new Error(`⛔ Este bot ha sido penalizado y suspendido por infracción a las reglas ("${bot.penalty_reason || 'Abuso detectado'}"). Bloqueado por ${remainingDays} día(s) restante(s). Contacta al Administrador.`);
    } else if (bot.penalty_until && bot.penalty_until <= Date.now()) {
      // Si la penalización ya expiró, levantarla automáticamente
      upsertBot({ id: botId, penalty_until: 0, penalty_reason: '', penalty_days: 0, strikes: 0 });
      bot = getBot(botId);
    }

    // Verificar si el bot está expirado o suspendido por el admin
    if (bot.payment_status === 'suspended') {
      throw new Error(`Este bot ha sido suspendido por el Administrador. Contacta al soporte para reactivarlo.`);
    }

    if (bot.expires_at > 0 && Date.now() > bot.expires_at && bot.payment_status !== 'paid') {
      upsertBot({ ...bot, payment_status: 'expired' });
      throw new Error(`El tiempo de servicio de este bot ha expirado. Contacta al Administrador para renovar tu suscripción.`);
    }

    // Asegurar que quede marcado como activo
    upsertBot({ ...bot, is_active: 1 });

    let inst = this.instances.get(botId);
    // Sin "force", nunca destruir un socket vivo: si ya está en línea o mostrando un QR/código,
    // crear otro invalidaría el código que el usuario está escaneando.
    const liveStates = ['online', 'connecting', 'qr_ready', 'pairing_code_ready'];
    if (!force && inst && inst.sock && !inst.manualStop && liveStates.includes(inst.status)) {
      return this.getBot(botId);
    }

    // Si existía un socket previo, limpiar sus listeners
    if (inst && inst.sock) {
      try {
        inst.sock.isObsolete = true;
        inst.sock.ev?.removeAllListeners();
        inst.sock.ws?.close();
      } catch {}
      inst.sock = null;
    }

    const sessionDir = this.getSessionPath(botId);
    fs.mkdirSync(sessionDir, { recursive: true });

    // Verificar el archivo de credenciales:
    // - Si está dañado, se limpia.
    // - Si nunca llegó a vincularse (sin creds.me), es un intento de vinculación abandonado:
    //   WhatsApp lo rechaza con 401, así que se limpia para generar un QR nuevo.
    // - Si ya tiene creds.me (QR escaneado o sesión activa), se conserva SIEMPRE, porque
    //   tras escanear WhatsApp exige un reinicio (515) que debe reutilizar esas claves.
    const credsFile = path.join(sessionDir, 'creds.json');
    if (fs.existsSync(credsFile)) {
      let stale = false;
      try {
        const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
        stale = !creds?.me?.id;
      } catch {
        stale = true;
      }
      if (stale) {
        try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
        fs.mkdirSync(sessionDir, { recursive: true });
      }
    }

    inst = {
      sock: null,
      status: 'connecting',
      qr: null,
      qrRaw: null,
      pairingCode: null,
      pendingPairingPhone: options.pairingPhone || null,
      reconnectTimer: null,
      remindersTimer: null,
      connectedAt: null,
      manualStop: false
    };
    this.instances.set(botId, inst);

    setBotStatus(botId, 'connecting', null);
    this.emit('bot_update', { botId, status: 'connecting' });

    try {
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1043857760] }));

      const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop'),
        markOnlineOnConnect: true,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 60_000,
        defaultQueryTimeoutMs: 60_000,
        keepAliveIntervalMs: 25_000,
        emitOwnEvents: false,
        getMessage: async () => undefined
      });

      inst.sock = sock;
      sock.botId = botId;

      sock.ev.on('creds.update', async () => {
        try {
          fs.mkdirSync(sessionDir, { recursive: true });
          await saveCreds();
        } catch (err) {
          console.warn(`[${botId}] Error guardando credenciales:`, err.message);
        }
      });

      sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (sock.isObsolete || inst.sock !== sock) return;
        if (inst.manualStop) return;

        if (connection === 'connecting') {
          if (inst.status === 'qr_ready') {
            inst.status = 'connecting';
            setBotStatus(botId, 'connecting', null);
            this.emit('bot_update', {
              botId,
              status: 'connecting',
              message: '¡Código QR detectado! Vinculando dispositivo con WhatsApp...'
            });
            addBotLog({
              botId,
              type: 'connection',
              content: 'Escaneo de QR detectado en el celular. Vinculando sesión...'
            });
          }
        }

        if (qr) {
          const firstQr = !inst.qrRaw;
          inst.qrRaw = qr;

          // Vinculación por código: se solicita una sola vez, cuando el socket ya está listo.
          if (inst.pendingPairingPhone && !inst.pairingCode) {
            const phone = inst.pendingPairingPhone;
            inst.pendingPairingPhone = null;
            try {
              const code = await sock.requestPairingCode(phone);
              inst.pairingCode = code;
              setBotStatus(botId, 'pairing_code_ready', null, code);
              this.emit('bot_update', { botId, status: 'pairing_code_ready', pairingCode: code });
              addBotLog({ botId, type: 'connection', content: `Código de vinculación generado para +${phone}.` });
            } catch (e) {
              inst.pairingError = e.message;
              console.warn(`[${botId}] No se pudo generar el código de vinculación: ${e.message}`);
            }
          }

          try {
            inst.qr = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
          } catch {
            inst.qr = null;
          }
          if (!inst.pairingCode) {
            inst.status = 'qr_ready';
            setBotStatus(botId, 'qr_ready', inst.qr);
          }
          this.emit('qr', { botId, qr: inst.qr });
          this.emit('bot_update', { botId, status: inst.status, qr: inst.qr });

          if (firstQr) {
            addBotLog({
              botId,
              type: 'connection',
              content: 'Código QR generado. Listo para escanear en WhatsApp.'
            });
          }
        }

        if (connection === 'open') {
          inst.status = 'online';
          inst.qr = null;
          inst.qrRaw = null;
          inst.pairingCode = null;
          inst.connectedAt = Date.now();

          const connectedPhone = jidNum(sock.user?.id || '');
          upsertBot({
            id: botId,
            phone: connectedPhone || bot.phone,
            status: 'online',
            qr_code: null,
            pairing_code: null,
            is_active: 1
          });

          this.startReminders(botId, sock);

          this.emit('bot_update', { botId, status: 'online', phone: connectedPhone });
          addBotLog({
            botId,
            type: 'connection',
            content: `Bot conectado exitosamente como ${connectedPhone || bot.name}`
          });
        }

        if (connection === 'close') {
          if (sock.isObsolete || inst.sock !== sock) return;
          clearInterval(inst.remindersTimer);
          const code = lastDisconnect?.error?.output?.statusCode;
          console.log(`[${botId}] Connection close: code=${code}, msg=${lastDisconnect?.error?.message}`);
          const isLoggedOut = code === DisconnectReason.loggedOut;
          const isBadSession = code === DisconnectReason.badSession;
          const isRestart = code === DisconnectReason.restartRequired || code === 515;
          const isQrExpired = code === 408 || lastDisconnect?.error?.message?.includes('QR refs');

          if (isQrExpired) {
            inst.status = 'stopped';
            setBotStatus(botId, 'stopped', null);
            this.emit('bot_update', {
              botId,
              status: 'stopped',
              message: 'El código QR expiró por inactividad. Presiona "Regenerar Sesión" para obtener uno nuevo.'
            });
            addBotLog({
              botId,
              type: 'connection',
              content: 'Código QR expiró por tiempo límite. Haz clic en "Regenerar Sesión" cuando estés listo para escanear.'
            });
            return;
          }

          if (isLoggedOut || isBadSession) {
            // 401: la sesión fue cerrada desde el celular o WhatsApp rechazó la vinculación.
            // Las claves ya no sirven: se limpian para que el próximo intento genere un QR nuevo.
            inst.status = 'logged_out';
            inst.qr = null;
            inst.pairingCode = null;
            setBotStatus(botId, 'logged_out', null);
            this.emit('bot_update', { botId, status: 'logged_out' });
            addBotLog({
              botId,
              type: 'connection',
              content: `Sesión de WhatsApp cerrada o rechazada (código ${code}). Genera un código nuevo para volver a vincular.`
            });
            try {
              fs.rmSync(sessionDir, { recursive: true, force: true });
            } catch {}
            return;
          }

          if (code === DisconnectReason.connectionReplaced) {
            // 440: otra instancia del servidor está usando la misma sesión. No reconectar en bucle.
            inst.status = 'stopped';
            setBotStatus(botId, 'stopped', null);
            this.emit('bot_update', { botId, status: 'stopped' });
            addBotLog({
              botId,
              type: 'connection',
              content: 'La sesión se abrió en otra instancia del servidor. Cierra las consolas duplicadas y vuelve a encender el bot.'
            });
            return;
          }

          if (inst.manualStop) {
            inst.status = 'stopped';
            setBotStatus(botId, 'stopped', null);
            this.emit('bot_update', { botId, status: 'stopped' });
            return;
          }

          // 515 = WhatsApp aceptó el escaneo y exige reiniciar el socket con las claves nuevas.
          inst.status = 'connecting';
          setBotStatus(botId, 'connecting', null);
          this.emit('bot_update', {
            botId,
            status: 'connecting',
            message: isRestart ? 'Código aceptado. Terminando la vinculación...' : 'Reconectando con WhatsApp...'
          });

          addBotLog({
            botId,
            type: 'connection',
            content: isRestart ? 'Código aceptado por WhatsApp. Completando la vinculación...' : `Conexión perdida (código ${code ?? 'desconocido'}). Reconectando...`
          });

          clearTimeout(inst.reconnectTimer);
          inst.reconnectTimer = setTimeout(() => {
            const current = getBot(botId);
            if (current && current.is_active && !inst.manualStop) {
              this.startBot(botId, true).catch(console.error);
            }
          }, isRestart ? 300 : 1500);
        }
      });

      sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const m of messages) {
          handle(sock, m, { botId, manager: this }).catch((e) => console.error(`[${botId}] handler error:`, e));
        }
      });

      // Bienvenida / despedida de grupos (solo en grupos explícitamente habilitados para este bot)
      sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
        clearMeta(id);
        if (!['add', 'remove'].includes(action)) return;
        if (!isChatAllowedForBot(botId, id)) return;
        const g = getGroup(id);
        const on = action === 'add' ? g.welcome : g.goodbye;
        if (!on) return;
        const meta = await getMeta(sock, id).catch(() => null);
        const tpl = (action === 'add' ? g.welcome_msg : g.goodbye_msg) ||
          (action === 'add' ? '¡Bienvenido/a {user} a *{group}*!\nUsa #help para ver lo que puedo hacer.' : '{user} salió de *{group}*. Hasta pronto.');
        for (const p of participants) {
          const jid = jidNorm(typeof p === 'string' ? p : p.id);
          await sock.sendMessage(id, {
            text: skin(tpl.replaceAll('{user}', `@${jidNum(jid)}`).replaceAll('{group}', meta?.subject || 'el grupo'), { label: action === 'add' ? 'Bienvenida' : 'Despedida' }),
            mentions: [jid],
          }).catch(() => {});
        }
      });

      return this.getBot(botId);
    } catch (err) {
      console.error(`[${botId}] Error iniciando bot:`, err);
      inst.status = 'error';
      setBotStatus(botId, 'error', null);
      this.emit('bot_update', { botId, status: 'error', error: err.message });
      addBotLog({
        botId,
        type: 'error',
        content: `Error al iniciar: ${err.message}`
      });
      throw err;
    }
  }

  /** Apaga un bot (desconecta el socket sin borrar credenciales) */
  async stopBot(botId) {
    const inst = this.instances.get(botId);
    if (inst) {
      inst.manualStop = true;
      clearTimeout(inst.reconnectTimer);
      clearInterval(inst.remindersTimer);

      if (inst.sock) {
        try {
          inst.sock.end(undefined);
        } catch { /* ignorar */ }
      }
      inst.status = 'stopped';
      inst.qr = null;
      inst.qrRaw = null;
      inst.pairingCode = null;
    }

    upsertBot({ id: botId, is_active: 0, status: 'stopped', qr_code: null });
    this.emit('bot_update', { botId, status: 'stopped' });

    addBotLog({
      botId,
      type: 'connection',
      content: `Bot apagado manualmente desde el panel de control.`
    });

    return this.getBot(botId);
  }

  /** Reinicia un bot */
  async restartBot(botId) {
    await this.stopBot(botId);
    await new Promise(r => setTimeout(r, 1000));
    return this.startBot(botId);
  }

  /** Limpia completamente la sesión en disco de un bot y genera un nuevo QR fresco */
  async resetBotSession(botId) {
    await this.stopBot(botId).catch(() => {});
    const sessionDir = this.getSessionPath(botId);
    try {
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn(`[${botId}] Error limpiando carpeta de sesión:`, e.message);
    }
    await new Promise(r => setTimeout(r, 500));
    return this.startBot(botId);
  }

  /** Genera un código de vinculación de 8 caracteres sobre una sesión limpia */
  async requestPairingCodeDirectly(botId, overridePhone = null) {
    const bot = getBot(botId);
    if (!bot) throw new Error('Bot no encontrado');
    const targetPhone = overridePhone || bot.phone;
    if (!targetPhone) throw new Error('Se requiere un número de WhatsApp para generar el código');
    const cleanPhone = String(targetPhone).replace(/\D/g, '');
    if (cleanPhone.length < 8) throw new Error('El número debe incluir el código de país (ej. 573001234567)');

    const current = this.instances.get(botId);
    if (current?.status === 'online') {
      return { ok: true, status: 'online', message: 'El bot ya está conectado' };
    }

    if (cleanPhone !== bot.phone) upsertBot({ id: botId, phone: cleanPhone });

    // Un código solo funciona sobre claves nuevas: cerrar el socket actual y limpiar la sesión.
    if (current?.sock) {
      current.manualStop = true;
      clearTimeout(current.reconnectTimer);
      try { current.sock.isObsolete = true; current.sock.end(undefined); } catch {}
    }
    try { fs.rmSync(this.getSessionPath(botId), { recursive: true, force: true }); } catch {}

    await this.startBot(botId, true, { pairingPhone: cleanPhone });

    // Esperar a que WhatsApp entregue el código (normalmente 2-4 s).
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      const inst = this.instances.get(botId);
      if (inst?.pairingCode) return { ok: true, pairingCode: inst.pairingCode };
      if (inst?.status === 'online') return { ok: true, status: 'online' };
      if (inst?.pairingError) return { ok: false, error: `WhatsApp no entregó el código: ${inst.pairingError}` };
      if (inst?.status === 'logged_out') return { ok: false, error: 'WhatsApp rechazó la solicitud. Verifica el número e inténtalo de nuevo.' };
    }
    return { ok: false, error: 'WhatsApp tardó demasiado en responder. Inténtalo de nuevo.' };
  }

  /** Elimina un bot de la base de datos y borra su sesión en disco */
  async deleteBot(botId) {
    await this.stopBot(botId).catch(() => {});
    this.instances.delete(botId);

    // Borrar directorio de sesión
    const sessionDir = this.getSessionPath(botId);
    try {
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn(`[${botId}] No se pudo borrar la carpeta de sesión:`, e.message);
    }

    dbDeleteBot(botId);
    this.emit('bot_delete', { botId });
    return { ok: true, id: botId };
  }

  /**
   * Obtiene todos los grupos de WhatsApp en los que participa la línea del bot,
   * combinados con los grupos previamente guardados en el control de acceso.
   */
  async getBotGroups(botId, forceRefresh = false) {
    const bot = getBot(botId);
    if (!bot) return null;

    const ac = normalizeBotAccessControl(bot);
    const inst = this.instances.get(botId);
    const botStatus = inst ? inst.status : (bot.is_active ? 'offline' : 'stopped');

    let liveGroups = [];
    if (inst && inst.status === 'online' && inst.sock) {
      const cacheValid = !forceRefresh && inst.groupsCache && (Date.now() - inst.groupsCache.ts < 20000);
      if (cacheValid) {
        liveGroups = inst.groupsCache.list;
      } else {
        try {
          const fetchPromise = inst.sock.groupFetchAllParticipating();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Tiempo de espera agotado al consultar grupos')), 8000)
          );
          const groupsObj = await Promise.race([fetchPromise, timeoutPromise]);
          liveGroups = Object.values(groupsObj || {})
            .filter(g => g && g.id && String(g.id).endsWith('@g.us'))
            .map(g => ({
              jid: g.id,
              subject: String(g.subject || 'Grupo sin nombre').trim(),
              size: Number(g.size || g.participants?.length || 0),
              announce: Boolean(g.announce),
              offlineCached: false
            }));
          inst.groupsCache = { ts: Date.now(), list: liveGroups };
        } catch (err) {
          console.warn(`[${botId}] Aviso obteniendo grupos activos:`, err.message);
          liveGroups = inst.groupsCache?.list || [];
        }
      }
    }

    const mergedMap = new Map();
    for (const g of liveGroups) {
      const isEnabled = ac.groupMode === 'all'
        ? true
        : (ac.groupMode === 'none' ? false : ac.allowedGroups.includes(g.jid));
      mergedMap.set(g.jid, { ...g, enabled: isEnabled });
    }

    // Incluir grupos autorizados o recordados en caché aunque el bot esté apagado temporalmente
    const cachedJids = new Set([
      ...ac.allowedGroups,
      ...Object.keys(ac.groupMetaCache || {})
    ]);
    for (const jid of cachedJids) {
      if (!jid || !jid.endsWith('@g.us') || mergedMap.has(jid)) continue;
      const meta = ac.groupMetaCache?.[jid] || {};
      const isEnabled = ac.groupMode === 'all'
        ? true
        : (ac.groupMode === 'none' ? false : ac.allowedGroups.includes(jid));
      mergedMap.set(jid, {
        jid,
        subject: meta.subject || `Grupo Autorizado (${jid.slice(0, 10)}...)`,
        size: Number(meta.size || 0),
        announce: false,
        offlineCached: true,
        enabled: isEnabled
      });
    }

    const groups = Array.from(mergedMap.values()).sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return a.subject.localeCompare(b.subject, 'es', { sensitivity: 'base' });
    });

    return {
      botStatus,
      accessControl: ac,
      groups
    };
  }

  /** Recordatorios automáticos para el bot */
  startReminders(botId, sock) {
    const inst = this.instances.get(botId);
    if (!inst) return;
    clearInterval(inst.remindersTimer);
    inst.remindersTimer = setInterval(async () => {
      try {
        const due = db.prepare('SELECT * FROM reminders WHERE at<=? ORDER BY at LIMIT 20').all(Date.now());
        for (const r of due) {
          db.prepare('DELETE FROM reminders WHERE id=?').run(r.id);
          if (!isChatAllowedForBot(botId, r.chat)) continue;
          await sock.sendMessage(r.chat, { text: skin(`@${jidNum(r.jid)} recordatorio:\n${r.text}`, { label: 'Recordatorio' }), mentions: [r.jid] }).catch(() => {});
        }
      } catch { /* ignorar errores periódicos */ }
    }, 15_000);
  }

  /** Inicializa todos los bots activos al arrancar el servidor */
  async initAllBots() {
    let bots = listBots();

    // Si la BD está vacía, registrar el bot inicial a partir del .env
    if (bots.length === 0) {
      const defaultId = 'bot_principal';
      const created = upsertBot({
        id: defaultId,
        name: config.botName || 'Etho Bot Principal',
        phone: config.pairingNumber || '',
        prefix: config.prefix || '#',
        status: 'offline',
        is_active: 1,
        settings: {
          currency: config.currency || 'coins',
          welcomeEnabled: true,
          antiSpamEnabled: true
        }
      });
      bots = [created];
    }

    console.log(`[BotManager] Cargando ${bots.length} bot(s) registrados...`);
    for (const b of bots) {
      if (b.is_active) {
        if (b.penalty_until && b.penalty_until > Date.now()) {
          console.log(`[BotManager] ⛔ Bot ${b.name} (${b.id}) está penalizado por infracción hasta ${new Date(b.penalty_until).toLocaleString()}.`);
          continue;
        }
        if (b.payment_status === 'suspended' || (b.expires_at > 0 && Date.now() > b.expires_at && b.payment_status !== 'paid')) {
          console.log(`[BotManager] ⏳ Bot ${b.name} (${b.id}) está vencido o suspendido. No se encenderá automáticamente.`);
          continue;
        }
        console.log(`[BotManager] Encendiendo bot: ${b.name} (${b.id})...`);
        this.startBot(b.id).catch((e) => console.error(`[BotManager] Error iniciando ${b.id}:`, e.message));
      }
    }

    // Monitoreo periódico de expiración de bots (cada 2 minutos)
    this.startExpirationMonitor();
  }

  /** Chequea si algún bot activo superó su tiempo límite de servicio */
  startExpirationMonitor() {
    if (this._expInterval) clearInterval(this._expInterval);
    this._expInterval = setInterval(async () => {
      for (const [botId, inst] of this.instances.entries()) {
        const bot = getBot(botId);
        if (!bot) continue;
        if (bot.payment_status === 'suspended' || (bot.expires_at > 0 && Date.now() > bot.expires_at && bot.payment_status !== 'paid')) {
          console.log(`[BotManager] ⚠️ El tiempo del bot ${bot.name} (${botId}) ha vencido. Apagando automáticamente...`);
          await this.stopBot(botId).catch(() => {});
          upsertBot({ ...bot, payment_status: 'expired' });
          addBotLog({
            botId,
            type: 'connection',
            content: `El tiempo de servicio ha vencido (${bot.payment_status}). El bot fue suspendido automáticamente hasta que se renueve el pago.`
          });
          this.emit('bot_update', { botId, status: 'stopped', payment_status: 'expired' });
        }
      }
    }, 120000);
  }
}

export const botManager = new BotManager();

