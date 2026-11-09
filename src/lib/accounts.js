// Seguridad de cuentas: sesiones revocables, cambio de contraseña y restablecimiento por el administrador.
// Cada usuario tiene un "token_version"; los tokens llevan esa versión (v). Al cambiar la contraseña,
// cerrar sesión en todos los dispositivos o restablecerla, la versión sube y los tokens anteriores dejan de valer.
import crypto from 'node:crypto';
import { db, hashPassword, verifyPassword } from '../db.js';

db.exec('ALTER TABLE platform_users ADD COLUMN token_version INTEGER DEFAULT 0');

export class AccountError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const rowOf = (id) => db.prepare('SELECT id, role, status, token_version FROM platform_users WHERE id=?').get(id) || null;
export const tokenVersionOf = (userId) => Number(rowOf(userId)?.token_version) || 0;

/**
 * Valida un token ya verificado (firma y expiración) contra la base de datos:
 * la cuenta debe existir, no estar suspendida y la versión del token debe coincidir.
 * Devuelve el usuario de sesión con el rol ACTUAL (un cambio de rol aplica de inmediato) o null.
 */
export function resolveSession(payload) {
  if (!payload?.id) return null;
  const row = rowOf(payload.id);
  if (!row || row.status === 'suspended') return null;
  if ((Number(payload.v) || 0) !== (Number(row.token_version) || 0)) return null;
  return { ...payload, role: row.role };
}

export function bumpTokenVersion(userId) {
  db.prepare('UPDATE platform_users SET token_version = COALESCE(token_version, 0) + 1 WHERE id=?').run(userId);
  return tokenVersionOf(userId);
}

function validateNewPassword(pw) {
  const s = String(pw ?? '');
  if (s.length < 8) throw new AccountError('La contraseña nueva debe tener al menos 8 caracteres.');
  if (s.length > 200) throw new AccountError('La contraseña nueva es demasiado larga.');
  return s;
}

/** Cambia la contraseña verificando la actual. Cierra las demás sesiones y devuelve la nueva versión. */
export function changePassword(userId, current, next) {
  const row = db.prepare('SELECT password_hash FROM platform_users WHERE id=?').get(userId);
  if (!row) throw new AccountError('Cuenta no encontrada.', 404);
  if (!verifyPassword(String(current ?? ''), row.password_hash)) throw new AccountError('La contraseña actual no es correcta.', 403);
  const pw = validateNewPassword(next);
  if (pw === String(current)) throw new AccountError('La contraseña nueva debe ser distinta de la actual.');
  db.prepare('UPDATE platform_users SET password_hash=? WHERE id=?').run(hashPassword(pw), userId);
  return bumpTokenVersion(userId);
}

/** El admin restablece la contraseña de un cliente: se genera una temporal (se muestra una sola vez). */
export function adminResetPassword(targetId) {
  const row = rowOf(targetId);
  if (!row) throw new AccountError('Usuario no encontrado.', 404);
  if (row.role === 'admin') throw new AccountError('La contraseña de un administrador solo se cambia desde su propia cuenta.', 403);
  const temp = crypto.randomBytes(9).toString('base64url');
  db.prepare('UPDATE platform_users SET password_hash=? WHERE id=?').run(hashPassword(temp), targetId);
  bumpTokenVersion(targetId);
  return temp;
}
