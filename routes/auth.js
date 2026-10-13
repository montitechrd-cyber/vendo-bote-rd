const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDB } = require('../database');
const { authRequired, adminRequired } = require('../middleware/auth');
const { setSession, clearSession, hashPassword, verifyPassword, newResetToken, hashResetToken } = require('../utils/session');
const { sendPasswordReset } = require('../utils/email');

const router = express.Router();

const idStorage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads/ids'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `id_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const uploadId = multer({
  storage: idStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.pdf', '.webp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  }
});

/* ── Registro / login propios (correo + contraseña) ── */
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'montitechrd@gmail.com').toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = (e) => String(e || '').trim().toLowerCase();

function siteUrl(req) {
  if (process.env.NODE_ENV === 'production') return process.env.SITE_URL || 'https://vendoboterd.com';
  return `${req.protocol}://${req.get('host')}`;
}

router.post('/register', async (req, res) => {
  try {
    const db = getDB();
    const email = normEmail(req.body.email);
    const name = String(req.body.name || '').trim().slice(0, 80);
    const password = String(req.body.password || '');
    if (!name) return res.status(400).json({ error: 'Escribe tu nombre' });
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
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, email, hashPassword(password), 'user']
    );
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

router.get('/me', authRequired, async (req, res) => {
  try {
    const db = getDB();
    const user = await db.queryOne(
      'SELECT id, name, last_name, email, phone, role, profile_completed, id_document_filename, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.put('/me', authRequired, async (req, res) => {
  try {
    const db = getDB();
    const { name, phone } = req.body;
    await db.run('UPDATE users SET name = $1, phone = $2 WHERE id = $3', [name, phone, req.user.id]);
    const user = await db.queryOne('SELECT id, name, email, phone, role FROM users WHERE id = $1', [req.user.id]);
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: 'Error al actualizar perfil' });
  }
});

// Paso obligatorio tras el registro: la plataforma pide nombre real,
// apellido y teléfono. La foto de
// cédula o pasaporte es opcional por ahora — se guarda igual que los comprobantes
// de pago: nunca pública, solo accesible por el propio dueño o un admin.
router.post('/complete-profile', authRequired, uploadId.single('id_document'), async (req, res) => {
  try {
    const db = getDB();
    const { name, last_name, phone } = req.body;
    if (!name?.trim() || !last_name?.trim() || !phone?.trim()) {
      return res.status(400).json({ error: 'Nombre, apellido y teléfono son requeridos' });
    }

    const fields = ['name = $1', 'last_name = $2', 'phone = $3', 'profile_completed = true'];
    const params = [name.trim(), last_name.trim(), phone.trim()];
    if (req.file) {
      fields.push(`id_document_filename = $${params.length + 1}`);
      params.push(req.file.filename);
    }
    params.push(req.user.id);

    await db.run(`UPDATE users SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
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
    const user = await db.queryOne('SELECT id_document_filename FROM users WHERE id = $1', [targetId]);
    if (!user?.id_document_filename) return res.status(404).json({ error: 'Sin documento' });
    res.sendFile(path.join(__dirname, '../uploads/ids', user.id_document_filename));
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
    await db.run('UPDATE users SET id_document_filename = NULL WHERE id = $1', [targetId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
