const { getDB } = require('../database');
const { sessionFromRequest, sessionVersion, mfaBinding } = require('../utils/session');

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
  // ¿Esta sesión presentó el segundo factor? (se compara con el secreto 2FA vigente de la cuenta)
  user.mfaOk = !!(user.totp_enabled && user.totp_secret_enc && session.mfa && session.mfa === mfaBinding(user.totp_secret_enc));
  return user;
}

// Decisión única de acceso de administrador (PCI DSS 8). Devuelve null si pasa, o { status, body } con el rechazo.
function adminDenial(user) {
  if (!user) return { status: 401, body: { error: 'No autenticado' } };
  if (user.role !== 'admin') return { status: 403, body: { error: 'Acceso denegado' } };
  // Un admin sin 2FA solo puede usar la configuración del 2FA (/api/auth/2fa/*, que usa authRequired)
  if (!user.totp_enabled) return { status: 403, body: { error: 'Activa la verificación en dos pasos para usar el panel de administración.', code: 'totp_setup_required' } };
  // Con 2FA activado, la sesión debe haber presentado el código (las anteriores a la activación no valen)
  if (!user.mfaOk) return { status: 401, body: { error: 'Vuelve a iniciar sesión con tu código de verificación.', code: 'mfa_required' } };
  return null;
}
// Para rutas "dueño o admin": si quien llama no es el dueño, exige admin completo. Devuelve true si ya respondió (rechazado).
function denyUnlessAdmin(req, res) {
  const d = adminDenial(req.user);
  if (d) { res.status(d.status).json(d.body); return true; }
  return false;
}

function authRequired(req, res, next) {
  loadUser(req)
    .then(user => {
      if (!user) return res.status(401).json({ error: 'No autenticado' });
      // Un admin con 2FA cuya sesión no lo presentó no tiene sesión válida para nada: debe volver a entrar
      if (user.role === 'admin' && user.totp_enabled && !user.mfaOk) return res.status(401).json({ error: 'Vuelve a iniciar sesión con tu código de verificación.', code: 'mfa_required' });
      req.user = user;
      next();
    })
    .catch(e => { console.error(e); res.status(500).json({ error: 'Error de autenticación' }); });
}

function adminRequired(req, res, next) {
  loadUser(req)
    .then(user => {
      const d = adminDenial(user);
      if (d) return res.status(d.status).json(d.body);
      req.user = user;
      next();
    })
    .catch(e => { console.error(e); res.status(500).json({ error: 'Error de autenticación' }); });
}

function optionalAuth(req, res, next) {
  loadUser(req).then(user => { if (user && !(user.role === 'admin' && user.totp_enabled && !user.mfaOk)) req.user = user; next(); }).catch(() => next());
}

module.exports = { authRequired, adminRequired, optionalAuth, adminDenial, denyUnlessAdmin };
