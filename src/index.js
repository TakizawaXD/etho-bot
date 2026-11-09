// Punto de entrada principal de Etho Bot:
// Inicia el Servidor Web (Dashboard + API REST + SSE) y el Gestor Multi-Bot de Baileys.
import path from 'path';
import { config } from './config.js';
import './db.js';
import { botManager } from './manager.js';
import { startServer, app } from './server.js';
import { ffmpegPath } from './lib/utils.js';
import { startMaintenance } from './lib/maintenance.js';
import { alert } from './lib/alerts.js';

export { app };
export default app;

export const startedAt = Date.now();

// Si estamos en Vercel Serverless, NO iniciar loops infinitos ni sockets de Baileys
if (!process.env.VERCEL) {
  // wa-sticker-formatter busca ffmpeg en el PATH
  if (ffmpegPath && typeof ffmpegPath === 'string') {
    try {
      process.env.PATH = `${path.dirname(ffmpegPath)}${path.delimiter}${process.env.PATH}`;
    } catch {}
  }

  console.log(`\n======================================================`);
  console.log(`🚀 INICIANDO SISTEMA MULTI-BOT: ${config.botName.toUpperCase()}`);
  console.log(`======================================================\n`);

  async function main() {
    // 1. Iniciar el servidor web (Dashboard y API)
    await startServer();

    // 2. Mantenimiento automático (vencimiento de planes, limpieza, copias de seguridad)
    startMaintenance({
      onBotsChanged: (ids) => {
        for (const botId of ids) {
          const b = botManager.getBot(botId);
          botManager.emit('bot_update', { botId, payment_status: b?.payment_status, expires_at: b?.expires_at, plan: b?.plan });
        }
      }
    });

    // 3. Iniciar todos los bots configurados y activos
    await botManager.initAllBots();
  }

  main().catch((err) => {
    if (err.code !== 'EADDRINUSE') {
      console.error('Fatal error al iniciar el sistema:', err);
    }
    process.exit(1);
  });

  // Manejo de apagado limpio
  const shutdown = async (signal) => {
    console.log(`\n${signal}: apagando sistema de bots...`);
    for (const bot of botManager.getAllBots()) {
      if (bot.status === 'online' || bot.status === 'connecting') {
        await botManager.stopBot(bot.id).catch(() => {});
      }
    }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Protección contra caídas del proceso por errores asíncronos o cierres de red
  process.on('uncaughtException', (err) => {
    console.error('[Global Safe] Excepción interceptada:', err?.stack || err);
    alert('error', 'Excepción no controlada', err?.message || String(err));
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[Global Safe] Rechazo interceptado:', reason?.stack || reason);
    alert('error', 'Promesa rechazada sin manejar', reason?.message || String(reason));
  });

  process.on('exit', (code) => {
    console.log(`[Process] Servidor Node terminando con código: ${code}`);
  });

  // Heartbeat continuo para mantener el event loop activo permanentemente
  setInterval(() => {}, 60_000);
}
