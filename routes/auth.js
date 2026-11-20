const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDB } = require('../database');
const { authRequired, adminRequired, denyUnlessAdmin } = require('../middleware/auth');
const { setSession, clearSession, sessionFromRequest, hashPassword, verifyPassword, newResetToken, hashResetToken } = require('../utils/session');
const { allValid } = require('../utils/filecheck');
const DUMMY_HASH = hashPassword('contrasena-de-relleno'); // para que login tarde igual exista o no el correo
const { sendPasswordReset, sendEmailVerification } = require('../utils/email');
const { sessionVersion, mfaBinding } = require('../utils/session');
const totp = require('../utils/totp');
const { audit, allowEvent } = require('../utils/audit');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Estas rutas solo se usan desde nuestras páginas con JSON: se rechazan formularios de otros sitios (CSRF de login).
router.use(['/login', '/forgot', '/reset', '/google', '/verify-email', '/2fa'], (req, res, next) => {
  if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ error: 'Formato no permitido' });
  next();
});

const DOC_EXT = ['.jpg', '.jpeg', '.png', '.pdf', '.webp'];
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf' };
const uploadId = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, DOC_EXT.includes(path.extname(file.originalname).toLowerCase()))
});
const uploadAvatarMw = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(file.originalname).toLowerCase()))
});
// Convierte errores de multer (archivo muy grande) en una respuesta clara
const withUpload = (mw, field, msg) => (req, res, next) => mw.single(field)(req, res, err => {
  if (err) return res.status(400).json({ error: msg });
  if (req.file && !allValid(req.file, path)) return res.status(400).json({ error: 'El archivo no es una imagen o PDF válido.' });
  next();
});
const uploadIdDoc = withUpload(uploadId, 'id_document', 'El documento es demasiado grande (máx. 10MB) o no es válido.');
const uploadAvatar = withUpload(uploadAvatarMw, 'avatar', 'La foto es demasiado grande o no es válida (JPG, PNG o WEBP).');

// Registro: la foto de perfil y el documento llegan junto a los datos (ambos opcionales)
const uploadRegMw = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => DOC_EXT.includes(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('tipo no permitido'))
}).fields([{ name: 'avatar', maxCount: 1 }, { name: 'id_document', maxCount: 1 }]);
const uploadReg = (req, res, next) => uploadRegMw(req, res, err => {
  if (err) return res.status(400).json({ error: 'Un archivo es demasiado grande (máx. 10MB) o no es válido.' });
  const sent = [].concat((req.files && req.files.avatar) || [], (req.files && req.files.id_document) || []);
  if (!allValid(sent, path)) return res.status(400).json({ error: 'Un archivo no es una imagen o PDF válido.' });
  next();
});
const ID_NUMBER_RE = /^[A-Za-z0-9\-\s]{5,25}$/;

// Marca el correo como pendiente de verificar y manda el enlace. Sin correo configurado (desarrollo) queda verificado.
async function startEmailVerification(db, user, req) {
  if (!process.env.EMAIL_USER) {
    await db.run('UPDATE users SET email_verified = true WHERE id = $1', [user.id]);
    return;
  }
  const { token, hash } = newResetToken();
  await db.run("UPDATE users SET email_verified = false, email_verify_hash = $1, email_verify_expires = NOW() + INTERVAL '48 hours' WHERE id = $2", [hash, user.id]);
  const link = `${siteUrl(req)}/auth.html?verify=${encodeURIComponent(token)}`;
  sendEmailVerification(user, link).catch(e => console.error('[auth] no se pudo enviar la verificación:', e.message));
}

async function saveAvatar(db, userId, file) {
  const ext = path.extname(file.originalname).toLowerCase();
  await db.run(
    'INSERT INTO user_files (user_id, avatar_data, avatar_mime, avatar_updated_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (user_id) DO UPDATE SET avatar_data = EXCLUDED.avatar_data, avatar_mime = EXCLUDED.avatar_mime, avatar_updated_at = NOW()',
    [userId, file.buffer, MIME[ext] || 'image/jpeg']
  );
}

async function saveIdDoc(db, userId, file) {
  const ext = path.extname(file.originalname).toLowerCase();
  await db.run(
    'INSERT INTO user_files (user_id, id_data, id_mime) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET id_data = EXCLUDED.id_data, id_mime = EXCLUDED.id_mime',
    [userId, file.buffer, MIME[ext] || 'application/octet-stream']
  );
  await db.run('UPDATE users SET id_document_filename = $1 WHERE id = $2', ['cedula_' + userId + ext, userId]);
}

/* ── Registro / login propios (correo + contraseña) ── */
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'montitechrd@gmail.com').toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = (e) => String(e || '').trim().toLowerCase();

function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, ''); // nunca armar el enlace con la cabecera Host
  if (process.env.NODE_ENV === 'production') return 'https://vendoboterd.com';
  return `${req.protocol}://${req.get('host')}`;
}

router.post('/register', uploadReg, async (req, res) => {
  try {
    const db = getDB();
    const email = normEmail(req.body.email);
    const name = String(req.body.name || '').trim().slice(0, 80);
    const last_name = String(req.body.last_name || '').trim().slice(0, 80);
    const phone = String(req.body.phone || '').trim().slice(0, 30);
    const id_number = String(req.body.id_number || '').trim().slice(0, 25);
    const password = String(req.body.password || '');
    const avatarFile = req.files && req.files.avatar && req.files.avatar[0];
    const docFile = req.files && req.files.id_document && req.files.id_document[0];
    if (!name) return res.status(400).json({ error: 'Escribe tu nombre' });
    if (!last_name) return res.status(400).json({ error: 'Escribe tu apellido' });
    if (!phone) return res.status(400).json({ error: 'Escribe tu teléfono' });
    if (!id_number) return res.status(400).json({ error: 'Escribe tu cédula o pasaporte' });
    if (!ID_NUMBER_RE.test(id_number)) return res.status(400).json({ error: 'La cédula o pasaporte no es válido' });
    if (avatarFile && (avatarFile.size > 2 * 1024 * 1024 || path.extname(avatarFile.originalname).toLowerCase() === '.pdf')) {
      return res.status(400).json({ error: 'La foto de perfil debe ser una imagen de hasta 2MB' });
    }
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Correo inválido' });
    if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

    // Cuentas anteriores (Clerk) y la del administrador no se pueden "reclamar" registrándose:
    // la contraseña se crea desde el enlace que llega a su correo.
    const existing = await db.queryOne('SELECT id, password_hash FROM users WHERE email = $1', [email]);
    if (existing || email === ADMIN_EMAIL) {
      const msg = existing && existing.password_hash
        ? 'Ya existe una cuenta con ese correo. Inicia sesión.'
        : 'Ya existe una cuenta con ese correo. Usa "Olvidé mi contraseña" para crear tu contraseña.';
      return res.status(409).json({ error: msg });
    }

    const pwHash = hashPassword(password);
    const result = await db.run(
      'INSERT INTO users (name, last_name, phone, id_number, email, password_hash, role, profile_completed) VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING id',
      [name, last_name, phone, id_number, email, pwHash, 'user']
    );
    if (avatarFile) await saveAvatar(db, result.lastInsertRowid, avatarFile);
    if (docFile) await saveIdDoc(db, result.lastInsertRowid, docFile);
    await startEmailVerification(db, { id: result.lastInsertRowid, name, email }, req);
    setSession(res, result.lastInsertRowid, pwHash);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo crear la cuenta' });
  }
});

// Configuración pública para el navegador (el ID de cliente de Google no es secreto)
router.get('/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
});

// Inicio de sesión con Google: el navegador manda el "credential" (JWT firmado por Google) y aquí se verifica.
// Google confirma que el correo es de esa persona, así que sirve también para entrar a cuentas anteriores.
let googleClient = null;
router.post('/google', async (req, res) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return res.status(503).json({ error: 'El acceso con Google aún no está configurado' });
    const credential = String(req.body.credential || '');
    if (!credential) return res.status(400).json({ error: 'Falta la credencial de Google' });

    if (!googleClient) {
      const { OAuth2Client } = require('google-auth-library');
      googleClient = new OAuth2Client(clientId);
    }
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId });
    const p = ticket.getPayload();
    const email = normEmail(p && p.email);
    if (!p || !p.email_verified || !EMAIL_RE.test(email)) {
      return res.status(401).json({ error: 'Google no pudo verificar tu correo' });
    }

    const db = getDB();
    let user = await db.queryOne('SELECT id, password_hash, email_verified, role, totp_enabled FROM users WHERE email = $1', [email]);
    if (user && !user.email_verified) {
      // Alguien registró este correo sin confirmarlo. Google acaba de demostrar que el correo es de quien entra:
      // se borra la contraseña de quien lo registró primero y la cuenta pasa a ser de su dueño real.
      await db.run('UPDATE users SET password_hash = NULL, email_verified = true, email_verify_hash = NULL, email_verify_expires = NULL, reset_token_hash = NULL, reset_expires = NULL WHERE id = $1', [user.id]);
      user.password_hash = null;
    }
    if (!user) {
      const name = String(p.given_name || p.name || email.split('@')[0]).trim().slice(0, 80);
      const lastName = String(p.family_name || '').trim().slice(0, 80) || null;
      const role = email === ADMIN_EMAIL ? 'admin' : 'user';
      const r = await db.run(
        'INSERT INTO users (name, last_name, email, role, email_verified) VALUES ($1, $2, $3, $4, true) RETURNING id',
        [name, lastName, email, role]
      );
      user = { id: r.lastInsertRowid, password_hash: null, role, totp_enabled: false };
    }
    await finishLogin(req, res, user);
  } catch (e) {
    console.error('[auth] google:', e.message);
    res.status(401).json({ error: 'No se pudo iniciar sesión con Google' });
  }
});

/* ── 2FA TOTP de administradores (PCI DSS 8) ── */
// Límite estricto del paso del código y de la gestión del 2FA (además del límite general de /login)
const totpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: Number(process.env.TOTP_LIMIT) || 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiados intentos, espera unos minutos antes de volver a intentar' },
});
router.use(['/login/2fa', '/2fa'], (req, res, next) => (req.method === 'GET' ? next() : totpLimiter(req, res, next)));

// Bloqueo por cuenta (en memoria): 5 códigos fallidos en 15 min => 15 min sin poder probar más, venga de la IP que venga
const totpFails = new Map();
const lockedOut = (uid) => { const f = totpFails.get(uid); return !!f && f.n >= 5 && Date.now() < f.until; };
function noteTotpFail(uid) {
  const f = totpFails.get(uid);
  const n = f && Date.now() < f.until ? f.n + 1 : 1;
  totpFails.set(uid, { n, until: Date.now() + 15 * 60 * 1000 });
  if (totpFails.size > 500) for (const [k, v] of totpFails) if (Date.now() > v.until) totpFails.delete(k);
}

// Comprueba el segundo factor de un admin con 2FA activo: código TOTP (sin reutilizar) o código de recuperación (una sola vez).
// Devuelve 'totp', 'recovery' o null.
async function checkSecondFactor(db, user, code) {
  if (!user || !user.totp_enabled || !user.totp_secret_enc) return null;
  if (lockedOut(user.id)) return null;
  const raw = String(code || '').trim().slice(0, 40);
  let ok = null;
  if (/^\d{3}\s?\d{3}$/.test(raw)) {
    let secret;
    try { secret = totp.decryptSecret(user.totp_secret_enc); } catch (e) { console.error('[2fa] no se pudo descifrar el secreto:', e.message); return null; }
    const step = totp.verifyTotp(secret, raw, { lastStep: user.totp_last_step });
    if (step != null) {
      // Atómico: solo gana quien avance el último paso usado (dos peticiones con el mismo código no pasan las dos)
      const r = await db.run('UPDATE users SET totp_last_step = $1 WHERE id = $2 AND (totp_last_step IS NULL OR totp_last_step < $1)', [step, user.id]);
      if (r.rowCount === 1) ok = 'totp';
    }
  } else if (totp.looksLikeRecovery(raw)) {
    const r = await db.run('UPDATE totp_recovery_codes SET used_at = NOW() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL', [user.id, totp.hashRecovery(raw)]);
    if (r.rowCount === 1) ok = 'recovery';
  }
  if (ok) totpFails.delete(user.id); else noteTotpFail(user.id);
  return ok;
}

// Cierra el inicio de sesión con contraseña/Google/restablecer. Un admin con 2FA activo NO recibe sesión aquí:
// recibe un reto firmado (5 min) y la sesión solo se emite al validar el código en /login/2fa.
async function finishLogin(req, res, user) {
  if (user.role === 'admin' && user.totp_enabled) {
    return res.json({ ok: true, totp_required: true, challenge: totp.signChallenge(user.id, sessionVersion(user.password_hash)) });
  }
  // Admin sin 2FA: sesión de 12 h sin marca de 2FA (solo sirve para configurar el 2FA)
  setSession(res, user.id, user.password_hash, user.role === 'admin' ? { admin: true } : {});
  if (user.role === 'admin') await audit(getDB(), { user: { id: user.id }, ip: req.ip }, 'admin.login', 'user', user.id, 'sin 2FA activado');
  res.json({ ok: true });
}

router.post('/login/2fa', async (req, res) => {
  const bad = () => res.status(401).json({ error: 'Código incorrecto o vencido. Inténtalo de nuevo.' });
  try {
    const db = getDB();
    const ch = totp.readChallenge(req.body.challenge);
    if (!ch) return res.status(401).json({ error: 'La verificación venció. Vuelve a iniciar sesión.', expired: true });
    const user = await db.queryOne('SELECT * FROM users WHERE id = $1', [ch.uid]);
    if (!user || user.role !== 'admin' || !user.totp_enabled || ch.v !== sessionVersion(user.password_hash)) {
      return res.status(401).json({ error: 'La verificación venció. Vuelve a iniciar sesión.', expired: true });
    }
    const who = { user: { id: user.id }, ip: req.ip };
    if (lockedOut(user.id)) {
      await audit(db, who, 'admin.login_fail', 'user', user.id, 'cuenta bloqueada temporalmente');
      return res.status(429).json({ error: 'Demasiados códigos incorrectos. Espera 15 minutos.' });
    }
    const how = await checkSecondFactor(db, user, req.body.code);
    if (!how) { await audit(db, who, 'admin.login_fail', 'user', user.id, 'paso 2FA'); return bad(); }
    // Única vía que emite sesión completa a un admin con 2FA: lleva la marca firmada de que presentó el código, y dura 12 h
    setSession(res, user.id, user.password_hash, { admin: true, mfa: mfaBinding(user.totp_secret_enc) });
    await audit(db, who, 'admin.login', 'user', user.id, how === 'recovery' ? 'con código de recuperación' : 'con 2FA');
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo iniciar sesión' });
  }
});

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });
  next();
}

async function replaceRecoveryCodes(db, userId) {
  const codes = totp.newRecoveryCodes();
  await db.run('DELETE FROM totp_recovery_codes WHERE user_id = $1', [userId]);
  for (const c of codes) await db.run('INSERT INTO totp_recovery_codes (user_id, code_hash) VALUES ($1, $2)', [userId, totp.hashRecovery(c)]);
  return codes;
}

router.get('/2fa/status', authRequired, adminOnly, async (req, res) => {
  try {
    const left = req.user.totp_enabled
      ? (await getDB().queryOne('SELECT COUNT(*)::int AS n FROM totp_recovery_codes WHERE user_id = $1 AND used_at IS NULL', [req.user.id])).n : 0;
    res.json({ enabled: !!req.user.totp_enabled, recovery_left: left, has_password: !!req.user.password_hash });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

// Inscribir, activar, regenerar o quitar el 2FA exige la contraseña actual si la cuenta tiene (una sesión robada no basta
// para quitar al dueño). Los admin que entran solo con Google no tienen contraseña: para ellos no se pide.
async function checkPassword(req, res) {
  const u = req.user;
  if (!u.password_hash) return true;
  if (verifyPassword(String((req.body && req.body.password) || '').slice(0, 200), u.password_hash)) return true;
  await audit(getDB(), req, 'admin.2fa_reauth_fail', 'user', u.id, 'contraseña');
  res.status(401).json({ error: 'La contraseña no es correcta', code: 'password_required' });
  return false;
}

// Paso 1: genera un secreto nuevo (cifrado en la base, aún sin activar) y lo muestra una sola vez para escanearlo o teclearlo
router.post('/2fa/setup', authRequired, adminOnly, async (req, res) => {
  try {
    if (req.user.totp_enabled) return res.status(409).json({ error: 'El 2FA ya está activado. Desactívalo primero para configurarlo de nuevo.' });
    if (!(await checkPassword(req, res))) return;
    const secret = totp.generateSecret();
    await getDB().run('UPDATE users SET totp_secret_enc = $1, totp_enabled = FALSE, totp_last_step = NULL WHERE id = $2', [totp.encryptSecret(secret), req.user.id]);
    res.set('Cache-Control', 'no-store');
    res.json({ secret: totp.groupSecret(secret), otpauth: totp.otpauthUrl(secret, req.user.email) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo preparar el 2FA' }); }
});

// Paso 2: confirma con un primer código, activa el 2FA y entrega los códigos de recuperación (única vez que se ven)
router.post('/2fa/enable', authRequired, adminOnly, async (req, res) => {
  try {
    const db = getDB();
    const u = req.user;
    if (u.totp_enabled) return res.status(409).json({ error: 'El 2FA ya está activado.' });
    if (!(await checkPassword(req, res))) return;
    if (!u.totp_secret_enc) return res.status(400).json({ error: 'Primero genera el secreto.' });
    let secret;
    try { secret = totp.decryptSecret(u.totp_secret_enc); } catch { return res.status(400).json({ error: 'Genera el secreto de nuevo.' }); }
    const step = totp.verifyTotp(secret, req.body.code);
    if (step == null) return res.status(400).json({ error: 'El código no coincide. Revisa que la hora del teléfono sea automática y prueba con el siguiente código.' });
    await db.run('UPDATE users SET totp_enabled = TRUE, totp_last_step = $1 WHERE id = $2', [step, u.id]);
    const codes = await replaceRecoveryCodes(db, u.id);
    await audit(db, req, 'admin.2fa_enable', 'user', u.id);
    // Sesión NUEVA con marca de 2FA para quien acaba de activarlo. Las demás sesiones anteriores de este usuario
    // (sin esa marca) dejan de valer solas: loadUser exige la marca ligada al secreto vigente.
    setSession(res, u.id, u.password_hash, { admin: true, mfa: mfaBinding(u.totp_secret_enc) });
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, recovery_codes: codes });
  } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo activar el 2FA' }); }
});

// Desactivar y regenerar los códigos de recuperación exigen contraseña (si la cuenta tiene) + un código vigente
async function reauth(req, res) {
  const u = req.user;
  if (!u.totp_enabled) { res.status(400).json({ error: 'El 2FA no está activado.' }); return false; }
  if (u.password_hash && !verifyPassword(String(req.body.password || '').slice(0, 200), u.password_hash)) {
    await audit(getDB(), req, 'admin.2fa_reauth_fail', 'user', u.id, 'contraseña');
    res.status(401).json({ error: 'La contraseña no es correcta' }); return false;
  }
  if (!(await checkSecondFactor(getDB(), u, req.body.code))) {
    await audit(getDB(), req, 'admin.2fa_reauth_fail', 'user', u.id, 'código');
    res.status(401).json({ error: 'El código no es correcto' }); return false;
  }
  return true;
}

router.post('/2fa/disable', authRequired, adminOnly, async (req, res) => {
  try {
    if (!(await reauth(req, res))) return;
    const db = getDB();
    await db.run('UPDATE users SET totp_enabled = FALSE, totp_secret_enc = NULL, totp_last_step = NULL WHERE id = $1', [req.user.id]);
    await db.run('DELETE FROM totp_recovery_codes WHERE user_id = $1', [req.user.id]);
    await audit(db, req, 'admin.2fa_disable', 'user', req.user.id);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo desactivar el 2FA' }); }
});

router.post('/2fa/recovery-codes', authRequired, adminOnly, async (req, res) => {
  try {
    if (!(await reauth(req, res))) return;
    const codes = await replaceRecoveryCodes(getDB(), req.user.id);
    await audit(getDB(), req, 'admin.2fa_recovery_regen', 'user', req.user.id);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, recovery_codes: codes });
  } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudieron regenerar los códigos' }); }
});

router.post('/login', async (req, res) => {
  try {
    const db = getDB();
    const email = normEmail(req.body.email);
    const password = String(req.body.password || '');
    const user = await db.queryOne('SELECT id, password_hash, role, totp_enabled FROM users WHERE email = $1', [email]);
    // Mismo mensaje y mismo tiempo de respuesta exista o no la cuenta (no revela qué correos están registrados).
    const okPass = verifyPassword(password.slice(0, 200), user && user.password_hash ? user.password_hash : DUMMY_HASH);
    if (!user || !user.password_hash || !okPass) {
      if (user && user.role === 'admin' && allowEvent('loginfail:' + req.ip, 5, 60000)) await audit(db, { user: { id: user.id }, ip: req.ip }, 'admin.login_fail', 'user', user.id, 'contraseña');
      return res.status(401).json({ error: 'Correo o contraseña incorrectos. Si tu cuenta es anterior, usa "Olvidé mi contraseña".' });
    }
    await finishLogin(req, res, user);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo iniciar sesión' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const s = sessionFromRequest(req);
    if (s && s.th) {
      const db = getDB();
      await db.run("INSERT INTO revoked_sessions (token_hash, expires_at) VALUES ($1, NOW() + INTERVAL '31 days') ON CONFLICT DO NOTHING", [s.th]);
      await db.run('DELETE FROM revoked_sessions WHERE expires_at < NOW()');
    }
  } catch (e) { console.error(e); }
  clearSession(res);
  res.json({ ok: true });
});

// Confirmar el correo con el enlace que llegó por mail (el token es la prueba, no hace falta sesión)
router.post('/verify-email', async (req, res) => {
  try {
    const r = await getDB().run(
      'UPDATE users SET email_verified = true, email_verify_hash = NULL, email_verify_expires = NULL WHERE email_verify_hash = $1 AND email_verify_expires > NOW()',
      [hashResetToken(req.body.token)]
    );
    if (!r.rowCount) return res.status(400).json({ error: 'El enlace no es válido o ya venció. Pide uno nuevo desde tu panel.' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo confirmar el correo' });
  }
});

router.post('/resend-verification', authRequired, async (req, res) => {
  try {
    if (req.user.email_verified) return res.json({ ok: true, already: true });
    await startEmailVerification(getDB(), { id: req.user.id, name: req.user.name, email: req.user.email }, req);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo enviar el correo' });
  }
});

// Siempre responde igual exista o no la cuenta (no revela qué correos están registrados).
router.post('/forgot', async (req, res) => {
  try {
    const db = getDB();
    const email = normEmail(req.body.email);
    if (EMAIL_RE.test(email)) {
      let user = await db.queryOne('SELECT id, name, email FROM users WHERE email = $1', [email]);
      if (!user && email === ADMIN_EMAIL) {
        await db.run("INSERT INTO users (name, email, role) VALUES ($1, $2, 'admin')", ['Administrador', email]);
        user = await db.queryOne('SELECT id, name, email FROM users WHERE email = $1', [email]);
      }
      if (user) {
        const { token, hash } = newResetToken();
        await db.run("UPDATE users SET reset_token_hash = $1, reset_expires = NOW() + INTERVAL '1 hour' WHERE id = $2", [hash, user.id]);
        const link = `${siteUrl(req)}/auth.html?reset=${encodeURIComponent(token)}`;
        sendPasswordReset(user, link).catch(e => console.error('[auth] no se pudo enviar el correo:', e.message)); // sin await: el tiempo de respuesta no delata si la cuenta existe
      }
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo procesar la solicitud' });
  }
});

router.post('/reset', async (req, res) => {
  try {
    const db = getDB();
    const password = String(req.body.password || '');
    if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    const user = await db.queryOne(
      'SELECT id, role, totp_enabled FROM users WHERE reset_token_hash = $1 AND reset_expires > NOW()',
      [hashResetToken(req.body.token)]
    );
    if (!user) return res.status(400).json({ error: 'El enlace no es válido o ya venció. Pide uno nuevo.' });
    const newHash = hashPassword(password);
    await db.run('UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_expires = NULL, email_verified = true WHERE id = $2', [newHash, user.id]);
    await finishLogin(req, res, { ...user, password_hash: newHash });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo cambiar la contraseña' });
  }
});

async function getMe(db, userId) {
  return db.queryOne(
    `SELECT u.id, u.name, u.last_name, u.email, u.phone, u.id_number, u.role, u.profile_completed, u.created_at,
            (u.password_hash IS NOT NULL) AS has_password,
            COALESCE(u.email_verified, false) AS email_verified,
            (f.avatar_data IS NOT NULL) AS has_avatar,
            COALESCE(EXTRACT(EPOCH FROM f.avatar_updated_at)::bigint, 0) AS avatar_v,
            (f.id_data IS NOT NULL OR u.id_document_filename IS NOT NULL) AS has_id_document
     FROM users u LEFT JOIN user_files f ON f.user_id = u.id WHERE u.id = $1`,
    [userId]
  );
}

router.get('/me', authRequired, async (req, res) => {
  try {
    const user = await getMe(getDB(), req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Datos personales: nombre, apellido, teléfono y cédula
router.put('/me', authRequired, async (req, res) => {
  try {
    const db = getDB();
    const name = String(req.body.name || '').trim().slice(0, 80);
    const last_name = String(req.body.last_name || '').trim().slice(0, 80);
    const phone = String(req.body.phone || '').trim().slice(0, 30);
    const id_number = String(req.body.id_number || '').trim().slice(0, 25);
    if (!name || !last_name) return res.status(400).json({ error: 'Nombre y apellido son requeridos' });
    if (!phone) return res.status(400).json({ error: 'El teléfono es requerido' });
    if (id_number && !/^[A-Za-z0-9\-\s]{5,25}$/.test(id_number)) return res.status(400).json({ error: 'La cédula o pasaporte no es válido' });
    await db.run('UPDATE users SET name = $1, last_name = $2, phone = $3, id_number = $4, profile_completed = true WHERE id = $5',
      [name, last_name, phone, id_number || null, req.user.id]);
    res.json(await getMe(db, req.user.id));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al actualizar el perfil' });
  }
});

// Cambiar correo: pide la contraseña actual. La cuenta del administrador principal no se cambia desde aquí.
router.post('/me/email', authRequired, async (req, res) => {
  try {
    const db = getDB();
    const email = normEmail(req.body.email);
    const current = String(req.body.current_password || '');
    if (!req.user.password_hash) return res.status(400).json({ error: 'Tu cuenta no tiene contraseña. Crea una primero en la sección Contraseña.' });
    if (req.user.role === 'admin') return res.status(403).json({ error: 'El correo de la cuenta administradora no se puede cambiar desde aquí.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Correo inválido' });
    if (!verifyPassword(current, req.user.password_hash)) return res.status(401).json({ error: 'La contraseña actual no es correcta' });
    if (email === req.user.email) return res.status(400).json({ error: 'Ese ya es tu correo' });
    if (email === ADMIN_EMAIL) return res.status(409).json({ error: 'Ese correo no está disponible' });
    const taken = await db.queryOne('SELECT id FROM users WHERE email = $1 AND id != $2', [email, req.user.id]);
    if (taken) return res.status(409).json({ error: 'Ese correo ya está en uso' });
    await db.run('UPDATE users SET email = $1 WHERE id = $2', [email, req.user.id]);
    await startEmailVerification(db, { id: req.user.id, name: req.user.name, email }, req);
    res.json(await getMe(db, req.user.id));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo cambiar el correo' });
  }
});

// Cambiar (o crear) la contraseña
router.post('/me/password', authRequired, async (req, res) => {
  try {
    const db = getDB();
    const next = String(req.body.new_password || '');
    if (next.length < 8) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
    if (req.user.password_hash && !verifyPassword(String(req.body.current_password || ''), req.user.password_hash)) {
      return res.status(401).json({ error: 'La contraseña actual no es correcta' });
    }
    const nextHash = hashPassword(next);
    await db.run('UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_expires = NULL WHERE id = $2', [nextHash, req.user.id]);
    // esta sesión sigue (conserva la marca de 2FA y el tope de 12 h si es admin); las demás se cierran
    setSession(res, req.user.id, nextHash, req.user.role === 'admin' ? { admin: true, mfa: req.user.mfaOk ? mfaBinding(req.user.totp_secret_enc) : undefined } : {});
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo cambiar la contraseña' });
  }
});

// Foto de perfil (se guarda en la base de datos; solo la ve su dueño o un admin)
router.post('/me/avatar', authRequired, uploadAvatar, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Elige una foto (JPG, PNG o WEBP)' });
    const ext = path.extname(req.file.originalname).toLowerCase();
    await getDB().run(
      'INSERT INTO user_files (user_id, avatar_data, avatar_mime, avatar_updated_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (user_id) DO UPDATE SET avatar_data = EXCLUDED.avatar_data, avatar_mime = EXCLUDED.avatar_mime, avatar_updated_at = NOW()',
      [req.user.id, req.file.buffer, MIME[ext] || 'image/jpeg']
    );
    res.json(await getMe(getDB(), req.user.id));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo guardar la foto' });
  }
});

router.delete('/me/avatar', authRequired, async (req, res) => {
  try {
    await getDB().run('UPDATE user_files SET avatar_data = NULL, avatar_mime = NULL, avatar_updated_at = NULL WHERE user_id = $1', [req.user.id]);
    res.json(await getMe(getDB(), req.user.id));
  } catch (e) {
    res.status(500).json({ error: 'No se pudo quitar la foto' });
  }
});

router.get('/avatar/:userId', authRequired, async (req, res) => {
  try {
    const targetId = parseInt(req.params.userId, 10);
    if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Usuario inválido' });
    const foreign = targetId !== req.user.id;
    if (foreign && denyUnlessAdmin(req, res)) return;
    const f = await getDB().queryOne('SELECT avatar_data, avatar_mime FROM user_files WHERE user_id = $1', [targetId]);
    if (!f || !f.avatar_data) return res.status(404).json({ error: 'Sin foto' });
    // El panel pide muchas fotos seguidas: se registra como máximo una vez cada 10 min por admin y usuario
    if (foreign && allowEvent('avatar:' + req.user.id + ':' + targetId, 1, 10 * 60000)) await audit(getDB(), req, 'avatar.view', 'user', targetId);
    res.set('Content-Type', f.avatar_mime || 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=0, must-revalidate');
    res.send(f.avatar_data);
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Cédula / pasaporte (foto o PDF)
router.post('/me/id-document', authRequired, uploadIdDoc, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Adjunta una foto o PDF de tu cédula (JPG, PNG, WEBP o PDF)' });
    await saveIdDoc(getDB(), req.user.id, req.file);
    res.json(await getMe(getDB(), req.user.id));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo guardar el documento' });
  }
});

router.delete('/me/id-document', authRequired, async (req, res) => {
  try {
    const db = getDB();
    await db.run('UPDATE user_files SET id_data = NULL, id_mime = NULL WHERE user_id = $1', [req.user.id]);
    await db.run('UPDATE users SET id_document_filename = NULL WHERE id = $1', [req.user.id]);
    res.json(await getMe(db, req.user.id));
  } catch (e) {
    res.status(500).json({ error: 'No se pudo eliminar el documento' });
  }
});

// Paso obligatorio tras el registro: la plataforma pide nombre real,
// apellido y teléfono. La foto de
// cédula o pasaporte es opcional por ahora — se guarda igual que los comprobantes
// de pago: nunca pública, solo accesible por el propio dueño o un admin.
router.post('/complete-profile', authRequired, uploadIdDoc, async (req, res) => {
  try {
    const db = getDB();
    const name = String(req.body.name || '').trim().slice(0, 80);
    const last_name = String(req.body.last_name || '').trim().slice(0, 80);
    const phone = String(req.body.phone || '').trim().slice(0, 30);
    const id_number = String(req.body.id_number || '').trim().slice(0, 25);
    if (!name || !last_name || !phone || !id_number) {
      return res.status(400).json({ error: 'Nombre, apellido, teléfono y cédula o pasaporte son requeridos' });
    }
    if (!ID_NUMBER_RE.test(id_number)) return res.status(400).json({ error: 'La cédula o pasaporte no es válido' });

    const fields = ['name = $1', 'last_name = $2', 'phone = $3', 'id_number = $4', 'profile_completed = true'];
    const params = [name, last_name, phone, id_number];
    params.push(req.user.id);

    await db.run(`UPDATE users SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
    if (req.file) await saveIdDoc(db, req.user.id, req.file);
    const user = await db.queryOne(
      'SELECT id, name, last_name, email, phone, role, profile_completed, id_document_filename FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json(user);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al guardar el perfil' });
  }
});

// Documento de identidad: mismo criterio que los comprobantes de pago — jamás
// público, solo el propio usuario o un admin pueden pedirlo.
router.get('/id-document/:userId', authRequired, async (req, res) => {
  try {
    const db = getDB();
    const targetId = parseInt(req.params.userId, 10);
    if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Usuario inválido' });
    const foreign = targetId !== req.user.id;
    if (foreign && denyUnlessAdmin(req, res)) return;
    const f = await db.queryOne('SELECT id_data, id_mime FROM user_files WHERE user_id = $1', [targetId]);
    if (f && f.id_data) {
      if (foreign) await audit(db, req, 'id_document.view', 'user', targetId);
      res.set('Content-Type', f.id_mime || 'application/octet-stream');
      res.set('Cache-Control', 'private, no-store');
      return res.send(f.id_data);
    }
    const user = await db.queryOne('SELECT id_document_filename FROM users WHERE id = $1', [targetId]);
    if (!user?.id_document_filename) return res.status(404).json({ error: 'Sin documento' });
    if (foreign) await audit(db, req, 'id_document.view', 'user', targetId);
    res.sendFile(path.join(__dirname, '../uploads/ids', user.id_document_filename), err => { if (err && !res.headersSent) res.status(404).json({ error: 'Sin documento' }); });
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Permite a un admin borrar el documento de identidad de un usuario (por
// ejemplo, a pedido del propio usuario o del cliente dueño de la plataforma).
router.delete('/id-document/:userId', adminRequired, async (req, res) => {
  try {
    const db = getDB();
    const targetId = parseInt(req.params.userId, 10);
    if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Usuario inválido' });
    const user = await db.queryOne('SELECT id_document_filename FROM users WHERE id = $1', [targetId]);
    if (!user?.id_document_filename) return res.status(404).json({ error: 'Sin documento' });

    fs.unlink(path.join(__dirname, '../uploads/ids', user.id_document_filename), () => {});
    await db.run('UPDATE user_files SET id_data = NULL, id_mime = NULL WHERE user_id = $1', [targetId]);
    await db.run('UPDATE users SET id_document_filename = NULL WHERE id = $1', [targetId]);
    await audit(db, req, 'id_document.delete', 'user', targetId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
