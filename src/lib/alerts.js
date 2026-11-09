// Alertas operativas opcionales: si defines ALERT_WEBHOOK_URL (Slack, Discord, Make, n8n...) se envía un aviso
// cuando ocurre algo grave. Nunca lanza errores y agrupa repeticiones (máx. 1 igual cada 5 minutos).
const recent = new Map();
const COOLDOWN_MS = 5 * 60 * 1000;

export async function alert(level, title, detail = '') {
  const line = `[${level}] ${title}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`;
  (level === 'error' ? console.error : console.warn)(`[Alerta] ${line}`);

  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url || !/^https:\/\//i.test(url)) return false;
  const now = Date.now();
  const last = recent.get(title) || 0;
  if (now - last < COOLDOWN_MS) return false;
  recent.set(title, now);
  if (recent.size > 200) for (const [k, t] of recent) if (now - t > COOLDOWN_MS) recent.delete(k);

  const label = `${process.env.ALERT_SERVICE_NAME || 'Etho Hub'}: ${line}`;
  try {
    // "text" lo entiende Slack/Make/n8n y "content" Discord.
    await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: label, content: label }), signal: AbortSignal.timeout(5000),
    });
    return true;
  } catch { return false; }
}
