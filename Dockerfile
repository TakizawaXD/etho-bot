FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    git \
    ca-certificates \
  && pip install --no-cache-dir --break-system-packages yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DB_PATH=/app/data/bot.db \
    SESSION_DIR=/app/data/sessions

COPY package.json package-lock.json* ./
# Baileys depende de libsignal vía GitHub: forzar HTTPS (no hay llaves SSH en el build)
RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/ \
 && npm install --omit=dev --no-audit --no-fund

COPY . .
RUN mkdir -p /app/data/sessions

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD curl -fsS http://localhost:${PORT:-3000}/health || exit 1

CMD ["npm", "start"]
