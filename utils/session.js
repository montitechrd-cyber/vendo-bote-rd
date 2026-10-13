// Sesiones propias (sin servicios externos): cookie HttpOnly firmada con HMAC-SHA256.
// Contraseñas con scrypt (módulo crypto de Node, sin dependencias extra).
const crypto = require('crypto');

const COOKIE = 'vbr_session';
const SESSION_DAYS = 30;
const isProd = process.env.NODE_ENV === 'production';

let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  // Sin SESSION_SECRET las sesiones se invalidan en cada reinicio: sirve en desarrollo, pero en
  // producción hay que definir la variable.
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[auth] SESSION_SECRET no definido: se usa una clave temporal (las sesiones se pierden al reiniciar).');
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

function createToken(userId) {
  const payload = b64(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_DAYS * 864e5 }));
  return payload + '.' + sign(payload);
}

function readToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > Date.now() ? data.uid : null;
  } catch { return null; }
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function userIdFromRequest(req) {
  return readToken(parseCookies(req.headers.cookie)[COOKIE]);
}

function setSession(res, userId) {
  const parts = [`${COOKIE}=${createToken(userId)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 86400}`];
  if (isProd) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearSession(res) {
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProd ? '; Secure' : ''}`);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = stored.split('$');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Token de restablecimiento: al usuario se le manda el valor, en la base solo el hash.
function newResetToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: crypto.createHash('sha256').update(token).digest('hex') };
}
const hashResetToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

module.exports = { userIdFromRequest, setSession, clearSession, hashPassword, verifyPassword, newResetToken, hashResetToken };
