import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'etho-acc-'));
process.env.DB_PATH = path.join(tmp, 'a.db');
const { db, createPlatformUser, updatePlatformUser, verifyPassword } = await import('../src/db.js');
const A = await import('../src/lib/accounts.js');
const { createTokenTools } = await import('../src/lib/auth.js');
const { alert } = await import('../src/lib/alerts.js');

const { generateToken, verifyToken } = createTokenTools('secreto-de-prueba-largo-123456789012');
const issue = (u) => generateToken({ ...u, token_version: A.tokenVersionOf(u.id) });
const expectErr = (fn, re) => assert.throws(fn, (e) => { assert.match(e.message, re); return true; });

const ana = createPlatformUser({ username: 'ana', email: 'ana@mail.com', password: 'clave-vieja-1', name: 'Ana', role: 'user' });
const t1 = issue(ana);
let s = A.resolveSession(verifyToken(t1));
assert.equal(s.id, ana.id); assert.equal(s.role, 'user');

// Tokens antiguos (sin versión) siguen valiendo mientras la versión sea 0
const legacy = generateToken({ id: ana.id, username: 'ana', role: 'user', name: 'Ana' });
assert.ok(A.resolveSession(verifyToken(legacy)));

// Cambio de rol: aplica de inmediato aunque el token diga otra cosa
updatePlatformUser(ana.id, { role: 'admin' });
assert.equal(A.resolveSession(verifyToken(t1)).role, 'admin');
updatePlatformUser(ana.id, { role: 'user' });

// Suspensión: el token existente deja de servir
updatePlatformUser(ana.id, { status: 'suspended' });
assert.equal(A.resolveSession(verifyToken(t1)), null);
updatePlatformUser(ana.id, { status: 'active' });
assert.ok(A.resolveSession(verifyToken(t1)));

// Cuenta borrada
const tmpUser = createPlatformUser({ username: 'tmp', email: 'tmp@mail.com', password: 'password123', name: 'T', role: 'user' });
const tTmp = issue(tmpUser); db.prepare('DELETE FROM platform_users WHERE id=?').run(tmpUser.id);
assert.equal(A.resolveSession(verifyToken(tTmp)), null);

// Cambio de contraseña: valida, cierra otras sesiones y exige la actual
expectErr(() => A.changePassword(ana.id, 'incorrecta', 'nueva-clave-segura'), /actual no es correcta/);
expectErr(() => A.changePassword(ana.id, 'clave-vieja-1', 'corta'), /al menos 8/);
expectErr(() => A.changePassword(ana.id, 'clave-vieja-1', 'clave-vieja-1'), /distinta/);
const v = A.changePassword(ana.id, 'clave-vieja-1', 'nueva-clave-segura');
assert.equal(v, 1);
assert.equal(A.resolveSession(verifyToken(t1)), null);            // el token anterior murió
assert.equal(A.resolveSession(verifyToken(legacy)), null);
assert.ok(A.resolveSession(verifyToken(issue(ana))));             // uno nuevo sí vale
const hash = db.prepare('SELECT password_hash FROM platform_users WHERE id=?').get(ana.id).password_hash;
assert.equal(verifyPassword('nueva-clave-segura', hash), true); assert.equal(verifyPassword('clave-vieja-1', hash), false);

// Cerrar sesión en todos los dispositivos
const t2 = issue(ana); A.bumpTokenVersion(ana.id);
assert.equal(A.resolveSession(verifyToken(t2)), null);

// Restablecimiento por el admin
const bruno = createPlatformUser({ username: 'bruno', email: 'bruno@mail.com', password: 'password123', name: 'Bruno', role: 'user' });
const tb = issue(bruno);
const temp = A.adminResetPassword(bruno.id);
assert.ok(temp.length >= 10);
assert.equal(verifyPassword(temp, db.prepare('SELECT password_hash FROM platform_users WHERE id=?').get(bruno.id).password_hash), true);
assert.equal(A.resolveSession(verifyToken(tb)), null);
const adminRow = createPlatformUser({ username: 'jefe', email: 'jefe@mail.com', password: 'password123', name: 'Jefe', role: 'admin' });
expectErr(() => A.adminResetPassword(adminRow.id), /administrador/);
expectErr(() => A.adminResetPassword('no-existe'), /no encontrado/);

// Alertas: sin webhook no hace nada y no lanza; con webhook agrupa repeticiones
delete process.env.ALERT_WEBHOOK_URL;
assert.equal(await alert('warn', 'sin-webhook'), false);
let calls = 0; global.fetch = async (url, init) => { calls++; assert.match(JSON.parse(init.body).text, /Etho Hub: \[error\] Pago/); return { ok: true }; };
process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/x';
assert.equal(await alert('error', 'Pago raro', 'orden 1'), true);
assert.equal(await alert('error', 'Pago raro', 'orden 2'), false);   // agrupada
assert.equal(calls, 1);
process.env.ALERT_WEBHOOK_URL = 'http://inseguro.example.com';
assert.equal(await alert('error', 'Otro'), false);                   // solo https
global.fetch = async () => { throw new Error('red caída'); }; process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/y';
assert.equal(await alert('error', 'Falla de red'), false);           // nunca lanza

db.close(); fs.rmSync(tmp, { recursive: true, force: true });
console.log('accounts + alerts OK');
