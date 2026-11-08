import axios from 'axios';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import ffmpegPath from 'ffmpeg-static';

const execFileP = promisify(execFile);
export { ffmpegPath };
export const TMP = path.join(os.tmpdir(), 'etho-bot');
try { fs.mkdirSync(TMP, { recursive: true }); } catch {}

export const jidNorm = (j = '') => j.replace(/:\d+@/, '@');
export const jidNum = (j = '') => j.split('@')[0].split(':')[0];
export const fmt = (n) => Number(n || 0).toLocaleString('es-ES');
export const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const levelOf = (exp) => Math.floor(Math.sqrt(exp / 50)) + 1;
export const expForLevel = (lvl) => 50 * (lvl - 1) ** 2;
export const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
export const slug = () => crypto.randomBytes(3).toString('hex');

/** Milisegundos restantes de un cooldown (0 si ya pasó). */
export const cd = (last, ms) => Math.max(0, (last || 0) + ms - Date.now());

export function timeLeft(ms) {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h && `${h}h`, m && `${m}m`, (sec || (!h && !m)) && `${sec}s`].filter(Boolean).join(' ');
}

export async function getBuffer(url) {
  const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  return Buffer.from(r.data);
}

export async function gifToMp4(buf) {
  const id = crypto.randomUUID();
  const inp = path.join(TMP, `${id}.gif`), out = path.join(TMP, `${id}.mp4`);
  fs.writeFileSync(inp, buf);
  try {
    await execFileP(ffmpegPath, ['-y', '-i', inp, '-movflags', 'faststart', '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', out], { timeout: 60000 });
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(inp, { force: true });
    fs.rmSync(out, { force: true });
  }
}

export async function webpToPng(buf) {
  const id = crypto.randomUUID();
  const inp = path.join(TMP, `${id}.webp`), out = path.join(TMP, `${id}.png`);
  fs.writeFileSync(inp, buf);
  try {
    await execFileP(ffmpegPath, ['-y', '-i', inp, out], { timeout: 30000 });
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(inp, { force: true });
    fs.rmSync(out, { force: true });
  }
}

/** Descarga con yt-dlp (debe estar instalado en el sistema). Devuelve { buffer, name }. */
export async function ytdlp(url, { audio = false, maxMB = 80 } = {}) {
  const id = crypto.randomUUID();
  const args = ['--no-playlist', '--no-warnings', '--max-filesize', `${maxMB}M`,
    '--ffmpeg-location', ffmpegPath, '-o', path.join(TMP, `${id}.%(ext)s`)];
  if (audio) args.push('-x', '--audio-format', 'mp3');
  else args.push('-f', 'bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4]/b', '--merge-output-format', 'mp4');
  args.push('--', url);
  await execFileP('yt-dlp', args, { timeout: 240000 });
  const name = fs.readdirSync(TMP).find((n) => n.startsWith(id));
  if (!name) throw new Error('No se pudo descargar el archivo (¿supera el límite de tamaño?)');
  const file = path.join(TMP, name);
  const buffer = fs.readFileSync(file);
  fs.rmSync(file, { force: true });
  return { buffer, name };
}
