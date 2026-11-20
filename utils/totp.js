// 2FA TOTP (RFC 6238) con node:crypto, sin dependencias: HMAC-SHA1, 6 dígitos, paso de 30 s, ventana ±1.
// El secreto se guarda CIFRADO (AES-256-GCM, subclaves derivadas de SESSION_SECRET con HKDF, una por uso); nunca en claro.
const crypto = require('crypto');

const STEP = 30;
const DIGITS = 6;
const WINDOW = 1;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('base32 inválido');
    value = ((value << 5) | i) & 0xffff; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// Secreto nuevo de 160 bits (lo habitual en Google Authenticator / Authy / 1Password), en base32
const generateSecret = () => base32Encode(crypto.randomBytes(20));
// Para teclearlo a mano: grupos de 4
const groupSecret = (s) => String(s).replace(/(.{4})(?=.)/g, '$1 ');

function hotp(secretBuf, counter, digits = DIGITS) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secretBuf).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP);
const totpAt = (secretBase32, ms = Date.now(), digits = DIGITS) => hotp(base32Decode(secretBase32), stepAt(ms), digits);

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Devuelve el paso (entero) en que coincide el código, o null. Si se pasa lastStep, solo valen pasos MAYORES
// (un mismo código, o uno anterior, no se puede reutilizar). Recorre toda la ventana sin cortar al encontrar.
function verifyTotp(secretBase32, code, { now = Date.now(), lastStep = null, window = WINDOW } = {}) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  let key;
  try { key = base32Decode(secretBase32); } catch { return null; }
  const cur = stepAt(now);
  let found = null;
  for (let s = cur - window; s <= cur + window; s++) {
    const match = safeEqual(hotp(key, s), c);
    if (match && found === null && !(lastStep != null && s <= lastStep)) found = s;
  }
  return found;
}

const otpauthUrl = (secretBase32, account, issuer = 'Vendo Bote RD') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`;

// ── Cifrado del secreto en reposo ──
// Una subclave distinta por uso (HKDF con 'info' propio): cifrado del secreto ('enc'), reto del paso 2 ('chal') y códigos de recuperación ('rec').
// 'enc' conserva la etiqueta original, así los secretos ya guardados siguen legibles.
const INFO = { enc: 'vbr-totp-enc-v1', chal: 'vbr-totp-challenge-v2', rec: 'vbr-totp-recovery-v2' };
function masterKey(secret, use = 'enc') {
  // En producción SESSION_SECRET es obligatoria (session.js no arranca sin ella); solo en desarrollo hay una clave fija de pruebas.
  const s = secret || process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? null : 'vbr-solo-desarrollo');
  if (!s) throw new Error('Falta SESSION_SECRET para cifrar el secreto 2FA');
  return Buffer.from(crypto.hkdfSync('sha256', s, 'vbr-totp-salt-v1', INFO[use], 32));
}
function encryptSecret(plain, secret) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', masterKey(secret, 'enc'), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}
function decryptSecret(enc, secret) {
  const [v, iv, tag, ct] = String(enc || '').split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('secreto 2FA con formato inválido');
  const d = crypto.createDecipheriv('aes-256-gcm', masterKey(secret, 'enc'), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

// ── Códigos de recuperación: 10 de un solo uso, en la base solo su HMAC ──
function newRecoveryCodes(n = 10) {
  return Array.from({ length: n }, () => { const r = base32Encode(crypto.randomBytes(7)).slice(0, 10); return r.slice(0, 5) + '-' + r.slice(5); });
}
const normRecovery = (c) => String(c || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
const hashRecovery = (code, secret) => crypto.createHmac('sha256', masterKey(secret, 'rec')).update('rec:' + normRecovery(code)).digest('hex');
const looksLikeRecovery = (c) => normRecovery(c).length === 10;

// ── Reto del paso 2 del login (sin estado): firmado, vale 5 minutos, ligado a la versión de la contraseña ──
function signChallenge(uid, ver, secret, ttlMs = 5 * 60 * 1000) {
  const p = Buffer.from(JSON.stringify({ u: uid, v: ver, e: Date.now() + ttlMs })).toString('base64url');
  return p + '.' + crypto.createHmac('sha256', masterKey(secret, 'chal')).update('ch:' + p).digest('base64url');
}
function readChallenge(tok, secret) {
  const [p, sig] = String(tok || '').split('.');
  if (!p || !sig) return null;
  const exp = crypto.createHmac('sha256', masterKey(secret, 'chal')).update('ch:' + p).digest('base64url');
  if (!safeEqual(sig, exp)) return null;
  try { const d = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); return d.e > Date.now() ? { uid: d.u, v: d.v } : null; } catch { return null; }
}

module.exports = { STEP, base32Encode, base32Decode, generateSecret, groupSecret, hotp, totpAt, stepAt, verifyTotp, otpauthUrl,
  encryptSecret, decryptSecret, newRecoveryCodes, hashRecovery, looksLikeRecovery, signChallenge, readChallenge, masterKey };
