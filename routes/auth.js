const express = require('express');
const multer = require('multer');
const path = require('path');
const { getDB } = require('../database');
const { authRequired } = require('../middleware/auth');

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

// Paso obligatorio tras el registro con Clerk: la plataforma pide nombre real,
// apellido y teléfono (Clerk solo verifica el correo/contraseña). La foto de
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

module.exports = router;
