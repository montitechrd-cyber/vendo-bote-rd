const { getAuth, clerkClient } = require('@clerk/express');
const { getDB } = require('../database');

async function resolveClerkUser(userId) {
  const db = getDB();

  let user = await db.queryOne('SELECT * FROM users WHERE clerk_id = $1', [userId]);
  if (user) return user;

  // First-time: fetch from Clerk and upsert locally
  const cu = await clerkClient.users.getUser(userId);
  const email = cu.emailAddresses[0]?.emailAddress || '';
  const name = [cu.firstName, cu.lastName].filter(Boolean).join(' ') || email.split('@')[0];
  const role = cu.publicMetadata?.role || 'user';

  await db.run(
    `INSERT INTO users (clerk_id, name, email, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET clerk_id = EXCLUDED.clerk_id, name = EXCLUDED.name, role = EXCLUDED.role`,
    [userId, name, email, role]
  );

  return db.queryOne('SELECT * FROM users WHERE clerk_id = $1', [userId]);
}

function authRequired(req, res, next) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'No autenticado' });
  resolveClerkUser(userId)
    .then(user => { if (!user) return res.status(401).json({ error: 'Usuario no encontrado' }); req.user = user; next(); })
    .catch(e => { console.error(e); res.status(500).json({ error: 'Error de autenticación' }); });
}

function adminRequired(req, res, next) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'No autenticado' });
  resolveClerkUser(userId)
    .then(user => {
      if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });
      req.user = user;
      next();
    })
    .catch(e => { console.error(e); res.status(500).json({ error: 'Error de autenticación' }); });
}

function optionalAuth(req, res, next) {
  const { userId } = getAuth(req);
  if (!userId) return next();
  resolveClerkUser(userId).then(user => { req.user = user; next(); }).catch(() => next());
}

module.exports = { authRequired, adminRequired, optionalAuth };
