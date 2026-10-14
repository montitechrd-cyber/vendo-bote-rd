const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDB } = require('../database');
const { authRequired, adminRequired } = require('../middleware/auth');
const { setSession, clearSession, hashPassword, verifyPassword, newResetToken, hashResetToken } = require('../utils/session');
const { sendPasswordReset } = require('../utils/email');

const router = express.Router();

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
  next();
});
const ID_NUMBER_RE = /^[A-Za-z0-9\-\s]{5,25}$/;

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
  if (process.env.NODE_ENV === 'production') return process.env.SITE_URL || 'https://vendoboterd.com';
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

    const result = await db.run(
      'INSERT INTO users (name, last_name, phone, id_number, email, password_hash, role, profile_completed) VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING id',
      [name, last_name, phone, id_number, email, hashPassword(password), 'user']
    );
    if (avatarFile) await saveAvatar(db, result.lastInsertRowid, avatarFile);
    if (docFile) await saveIdDoc(db, result.lastInsertRowid, docFile);
    setSession(res, result.lastInsertRowid);
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
    let user = await db.queryOne('SELECT id FROM users WHERE email = $1', [email]);
    if (!user) {
      const name = String(p.given_name || p.name || email.split('@')[0]).trim().slice(0, 80);
      const lastName = String(p.family_name || '').trim().slice(0, 80) || null;
      const role = email === ADMIN_EMAIL ? 'admin' : 'user';
      const r = await db.run(
        'INSERT INTO users (name, last_name, email, role) VALUES ($1, $2, $3, $4) RETURNING id',
        [name, lastName, email, role]
      );
      user = { id: r.lastInsertRowid };
    }
    setSession(res, user.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[auth] google:', e.message);
    res.status(401).json({ error: 'No se pudo iniciar sesión con Google' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const db = getDB();
    const email = normEmail(req.body.email);
    const password = String(req.body.password || '');
    const user = await db.queryOne('SELECT id, password_hash FROM users WHERE email = $1', [email]);
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos. Si tu cuenta es anterior, usa "Olvidé mi contraseña" para crear la tuya.' });
    }
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    }
    setSession(res, user.id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo iniciar sesión' });
  }
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
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
        await sendPasswordReset(user, link).catch(e => console.error('[auth] no se pudo enviar el correo:', e.message));
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
      'SELECT id FROM users WHERE reset_token_hash = $1 AND reset_expires > NOW()',
      [hashResetToken(req.body.token)]
    );
    if (!user) return res.status(400).json({ error: 'El enlace no es válido o ya venció. Pide uno nuevo.' });
    await db.run('UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_expires = NULL WHERE id = $2', [hashPassword(password), user.id]);
    setSession(res, user.id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo cambiar la contraseña' });
  }
});

async function getMe(db, userId) {
  return db.queryOne(
    `SELECT u.id, u.name, u.last_name, u.email, u.phone, u.id_number, u.role, u.profile_completed, u.created_at,
            (u.password_hash IS NOT NULL) AS has_password,
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
    await db.run('UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_expires = NULL WHERE id = $2', [hashPassword(next), req.user.id]);
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
    if (targetId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });
    const f = await getDB().queryOne('SELECT avatar_data, avatar_mime FROM user_files WHERE user_id = $1', [targetId]);
    if (!f || !f.avatar_data) return res.status(404).json({ error: 'Sin foto' });
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
    const { name, last_name, phone } = req.body;
    const id_number = String(req.body.id_number || '').trim();
    if (!name?.trim() || !last_name?.trim() || !phone?.trim() || !id_number) {
      return res.status(400).json({ error: 'Nombre, apellido, teléfono y cédula o pasaporte son requeridos' });
    }
    if (!ID_NUMBER_RE.test(id_number)) return res.status(400).json({ error: 'La cédula o pasaporte no es válido' });

    const fields = ['name = $1', 'last_name = $2', 'phone = $3', 'id_number = $4', 'profile_completed = true'];
    const params = [name.trim(), last_name.trim(), phone.trim(), id_number];
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
    const targetId = parseInt(req.params.userId);
    if (targetId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    const f = await db.queryOne('SELECT id_data, id_mime FROM user_files WHERE user_id = $1', [targetId]);
    if (f && f.id_data) {
      res.set('Content-Type', f.id_mime || 'application/octet-stream');
      return res.send(f.id_data);
    }
    const user = await db.queryOne('SELECT id_document_filename FROM users WHERE id = $1', [targetId]);
    if (!user?.id_document_filename) return res.status(404).json({ error: 'Sin documento' });
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
    const targetId = parseInt(req.params.userId);
    const user = await db.queryOne('SELECT id_document_filename FROM users WHERE id = $1', [targetId]);
    if (!user?.id_document_filename) return res.status(404).json({ error: 'Sin documento' });

    fs.unlink(path.join(__dirname, '../uploads/ids', user.id_document_filename), () => {});
    await db.run('UPDATE user_files SET id_data = NULL, id_mime = NULL WHERE user_id = $1', [targetId]);
    await db.run('UPDATE users SET id_document_filename = NULL WHERE id = $1', [targetId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
