# Guía de despliegue

El bot usa **Baileys (WhatsApp Web)**: necesita un proceso siempre encendido y **disco persistente**
para guardar la sesión de WhatsApp (`data/sessions`) y la base SQLite (`data/bot.db`).
Por eso **no funciona en Vercel/serverless**: usa Render, Railway o un VPS.

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `ADMIN_PASSWORD` | Recomendada | Contraseña del admin inicial. Si falta, se genera una y se muestra en los logs del primer arranque. |
| `ADMIN_USERNAME` | No | Usuario admin (por defecto `admin`). |
| `AUTH_SECRET` | Recomendada | Firma de sesiones (32+ caracteres). Si falta, se genera en `data/.auth_secret`. |
| `OWNER_NUMBERS` | No | Números dueños, sin `+`, separados por coma. |
| `GEMINI_API_KEY` | Para IA | Clave de Google AI Studio. |
| `SUPABASE_URL` / `SUPABASE_KEY` | No | Espejo en la nube (ver `supabase/schema.sql`). |
| `CORS_ORIGIN` | No | Orígenes permitidos, separados por coma. |
| `PUBLIC_URL` | Para pagos con tarjeta | URL pública con https, usada en el retorno de Stripe. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Para pagos con tarjeta | Ver [PAYMENTS.md](PAYMENTS.md). |
| `TRANSFER_INSTRUCTIONS` | Para transferencias | Datos bancarios que verá el cliente. |
| `MAX_ONLINE_BOTS` | No | Tope de bots conectados a la vez (por defecto 30; ~60-100 MB de RAM cada uno). |
| `TRIAL_DAYS` / `FREE_MAX_BOTS` | No | Prueba gratuita (7 días y 3 bots por defecto). |

Todas las variables opcionales están comentadas en `.env.example`.

`PORT`, `HOST`, `DB_PATH` y `SESSION_DIR` ya vienen configurados en el `Dockerfile`.

## Opción A — Render (usa `render.yaml`)
1. Sube el repo a GitHub.
2. En Render: **New → Blueprint** y elige el repo.
3. Completa `ADMIN_PASSWORD` cuando lo pida. `AUTH_SECRET` se genera solo.
4. El disco de 2 GB en `/app/data` requiere un plan de pago (`starter`).
5. Abre la URL pública, inicia sesión y escanea el QR desde el panel.

## Opción B — Railway (usa `railway.json`)
1. **New Project → Deploy from GitHub repo**.
2. Añade un **Volume** montado en `/app/data`.
3. Define las variables de la tabla de arriba.
4. Genera un dominio en **Settings → Networking**.

## Opción C — VPS con Docker
```bash
git clone <tu-repo> etho-bot && cd etho-bot
cp .env.example .env      # edita ADMIN_PASSWORD, AUTH_SECRET, etc.
docker compose up -d --build
docker compose logs -f    # contraseña inicial y estado
```
Los datos quedan en `./data`. Para HTTPS pon Caddy o Nginx delante del puerto 3000.

## Opción D — VPS con PM2 (sin Docker)
Requiere Node 22.13+, `ffmpeg` y `yt-dlp`.
```bash
npm install --omit=dev
pm2 start ecosystem.config.cjs && pm2 save
```

## Escalabilidad y resiliencia

- **Dimensiona por RAM:** cada bot conectado usa ~60-100 MB. Con `MAX_ONLINE_BOTS=30` conviene un servidor de 4 GB.
  Al llegar al tope el servidor rechaza nuevas conexiones con un mensaje claro en vez de caerse.
- **Arranque escalonado** (`BOOT_STAGGER_MS`) y **reconexión con retroceso exponencial**: una caída de red no genera avalanchas.
- **Base de datos:** modo WAL, índices en las tablas grandes, limpieza automática (logs 30 días, chats 60 días) y
  **copia de seguridad diaria** en `data/backups` (se conservan 7). Descárgalas periódicamente fuera del servidor.
- **Seguridad:** límite de peticiones por IP, límite de registros y reportes, cabeceras de seguridad, sesiones firmadas.
- **Salud:** `/health` revisa la base de datos y devuelve 503 si falla; Docker y Render reinician el servicio automáticamente.
- **Un solo servidor por base de datos.** Para repartir bots entre varios servidores hace falta una base compartida (ver `docs/ROADMAP.md`, idea 10).

## Notas importantes
- Mantén **una sola instancia**: dos procesos con la misma sesión de WhatsApp la corrompen.
- Haz copia de seguridad de `data/` (sesiones y base de datos).
- `/health` sirve para el healthcheck de la plataforma.

## Vercel (solo la web) + servidor aparte

Vercel publica únicamente `src/web/public`. El servidor (Baileys + SQLite) necesita un proceso siempre encendido y disco persistente, así que va en Railway, Fly, Render o un VPS con el `Dockerfile` (ver `railway.json` y `render.yaml`).

1. Despliega el servidor y anota su URL pública (por ejemplo `https://etho-api.up.railway.app`).
2. En `vercel.json`, cambia `https://TU-BACKEND.example.com` por esa URL.
3. Publica la web: `npx vercel --prod` desde la raíz del proyecto (o conecta el repositorio en Vercel).
4. En el servidor, define `PUBLIC_URL` con la URL de la web de Vercel (necesaria para los retornos de Stripe).
