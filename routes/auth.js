const express = require('express');
const { getDB } = require('../database');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/me', authRequired, async (req, res) => {
  try {
    const db = getDB();
    const user = await db.queryOne(
      'SELECT id, name, email, phone, role, created_at FROM users WHERE id = $1',
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

module.exports = router;
