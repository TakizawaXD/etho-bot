// Punto de entrada principal de Etho Bot:
// Inicia el Servidor Web (Dashboard + API REST + SSE) y el Gestor Multi-Bot de Baileys.
import path from 'path';
import { config } from './config.js';
import './db.js';
import { botManager } from './manager.js';
import { startServer, app } from './server.js';
import { ffmpegPath } from './lib/utils.js';

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

    // 2. Iniciar todos los bots configurados y activos
    await botManager.initAllBots();
  }

  main().catch((err) => {
    if (err.code !== 'EADDRINUSE') {
      console.error('Fatal error al iniciar el sistema:', err);
    }
    process.exit(1);
  });

  // Manejo de apagado limpio
  process.on('SIGINT', async () => {
    console.log('\nApagando sistema de bots...');
    for (const bot of botManager.getAllBots()) {
      if (bot.status === 'online' || bot.status === 'connecting') {
        await botManager.stopBot(bot.id).catch(() => {});
      }
    }
    process.exit(0);
  });

  // Protección contra caídas del proceso por errores asíncronos o cierres de red
  process.on('uncaughtException', (err) => {
    console.warn('[Global Safe] Excepción interceptada:', err?.message || err);
  });

  process.on('unhandledRejection', (reason) => {
    console.warn('[Global Safe] Rechazo interceptado:', reason?.message || reason);
  });

  process.on('exit', (code) => {
    console.log(`[Process] Servidor Node terminando con código: ${code}`);
  });

  // Heartbeat continuo para mantener el event loop activo permanentemente
  setInterval(() => {}, 60_000);
}
