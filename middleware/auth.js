const { getDB } = require('../database');
const { sessionFromRequest, sessionVersion } = require('../utils/session');

async function loadUser(req) {
  const session = sessionFromRequest(req);
  if (!session) return null;
  const user = await getDB().queryOne('SELECT * FROM users WHERE id = $1', [session.uid]);
  if (!user) return null;
  // Las sesiones nuevas llevan la "versión" de la contraseña: si la cambiaron, esta sesión ya no vale.
  if (session.v && session.v !== sessionVersion(user.password_hash)) return null;
  // Sesión cerrada por el usuario con "Cerrar sesión"
  if (session.th) {
    const revoked = await getDB().queryOne('SELECT 1 FROM revoked_sessions WHERE token_hash = $1', [session.th]);
    if (revoked) return null;
  }
  return user;
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
      // PCI DSS 8: un admin sin 2FA activado puede entrar, pero solo puede usar la configuración del 2FA (/api/auth/2fa/*, que usa authRequired)
      if (!user.totp_enabled) return res.status(403).json({ error: 'Activa la verificación en dos pasos para usar el panel de administración.', code: 'totp_setup_required' });
      req.user = user;
      next();
    })
    .catch(e => { console.error(e); res.status(500).json({ error: 'Error de autenticación' }); });
}

function optionalAuth(req, res, next) {
  loadUser(req).then(user => { if (user) req.user = user; next(); }).catch(() => next());
}

module.exports = { authRequired, adminRequired, optionalAuth };
