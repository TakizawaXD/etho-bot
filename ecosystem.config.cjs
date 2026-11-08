// Configuración oficial PM2 para despliegue en servidores VPS Linux (Ubuntu / Debian)
// IMPORTANTE: Mantener instances: 1 (modo fork) para evitar colisiones de sesión en Baileys WhatsApp.
module.exports = {
  apps: [
    {
      name: 'etho-bot-hub',
      script: 'src/index.js',
      node_args: '--max-old-space-size=1024',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '950M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0'
      }
    }
  ]
};

