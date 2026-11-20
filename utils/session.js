// Sesiones propias (sin servicios externos): cookie HttpOnly firmada con HMAC-SHA256.
// Contraseñas con scrypt (módulo crypto de Node, sin dependencias extra).
const crypto = require('crypto');

const COOKIE = 'vbr_session';
const SESSION_DAYS = 30;
const ADMIN_SESSION_HOURS = 12; // PCI DSS 8: las sesiones de administrador duran como máximo 12 h
const isProd = process.env.NODE_ENV === 'production';

let SECRET = process.env.SESSION_SECRET;
if (!SECRET && isProd) {
  console.error('[auth] FALTA SESSION_SECRET en producción: el servidor no arranca sin una clave de sesión fija.');
  process.exit(1);
}
if (!SECRET) {
  // En desarrollo se usa una clave temporal (las sesiones se pierden al reiniciar).
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[auth] SESSION_SECRET no definido: se usa una clave temporal (las sesiones se pierden al reiniciar).');
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

// "Versión" de la sesión: cambia cuando cambia la contraseña, así que cambiarla o restablecerla
// cierra las sesiones abiertas en otros dispositivos (cookies robadas incluidas).
const sessionVersion = (passwordHash) => crypto.createHash('sha256').update(String(passwordHash || '') + SECRET).digest('base64url').slice(0, 10);

// Marca de "pasó el 2FA", ligada al secreto 2FA vigente: si el admin desactiva y vuelve a activar el 2FA (secreto nuevo),
// las sesiones anteriores dejan de valer aunque tuvieran marca.
const mfaBinding = (secretEnc) => secretEnc ? crypto.createHash('sha256').update('mfa:' + secretEnc + SECRET).digest('base64url').slice(0, 12) : null;

const ttlMs = (opts) => (opts && opts.admin ? ADMIN_SESSION_HOURS * 36e5 : SESSION_DAYS * 864e5);

// opts: { admin: true } => 12 h; { mfa: mfaBinding(...) } => sesión que presentó el segundo factor
function createToken(userId, passwordHash, opts = {}) {
  const body = { uid: userId, v: sessionVersion(passwordHash), exp: Date.now() + ttlMs(opts) };
  if (opts.mfa) body.mfa = opts.mfa;
  const payload = b64(JSON.stringify(body));
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
    return data.exp > Date.now() ? { uid: data.uid, v: data.v || null, mfa: data.mfa || null } : null;
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

function sessionFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const s = readToken(token);
  if (s) s.th = crypto.createHash('sha256').update(token).digest('hex'); // huella para poder revocar esta sesión
  return s;
}
function userIdFromRequest(req) {
  const s = sessionFromRequest(req);
  return s ? s.uid : null;
}

function setSession(res, userId, passwordHash, opts = {}) {
  const parts = [`${COOKIE}=${createToken(userId, passwordHash, opts)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(ttlMs(opts) / 1000)}`];
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
  try {
    const [, saltHex, hashHex] = stored.split('$');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch (e) { return false; }
}

// Token de restablecimiento: al usuario se le manda el valor, en la base solo el hash.
function newResetToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: crypto.createHash('sha256').update(token).digest('hex') };
}
const hashResetToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

module.exports = { createToken, readToken, mfaBinding, userIdFromRequest, sessionFromRequest, sessionVersion, setSession, clearSession, hashPassword, verifyPassword, newResetToken, hashResetToken };
