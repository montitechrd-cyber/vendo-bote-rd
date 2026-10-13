const { getDB } = require('../database');
const { userIdFromRequest } = require('../utils/session');

async function loadUser(req) {
  const userId = userIdFromRequest(req);
  if (!userId) return null;
  return getDB().queryOne('SELECT * FROM users WHERE id = $1', [userId]);
}

function authRequired(req, res, next) {
  loadUser(req)
    .then(user => {
      if (!user) return res.status(401).json({ error: 'No autenticado' });
      req.user = user;
      next();
    })
    .catch(e => { console.error(e); res.status(500).json({ error: 'Error de autenticación' }); });
}

function adminRequired(req, res, next) {
  loadUser(req)
    .then(user => {
      if (!user) return res.status(401).json({ error: 'No autenticado' });
      if (user.role !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });
      req.user = user;
      next();
    })
    .catch(e => { console.error(e); res.status(500).json({ error: 'Error de autenticación' }); });
}

function optionalAuth(req, res, next) {
  loadUser(req).then(user => { if (user) req.user = user; next(); }).catch(() => next());
}

module.exports = { authRequired, adminRequired, optionalAuth };
