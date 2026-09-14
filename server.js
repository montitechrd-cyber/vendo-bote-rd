require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { init, getDB } = require('./database');

const { clerkMiddleware } = require('@clerk/express');

const app = express();
const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== 'production';

// Necesario detrás de cualquier proxy real (Render, Railway, Nginx, Cloudflare...):
// sin esto, Express ve la IP del proxy en TODAS las solicitudes y el rate limiting
// termina tratando a todos los usuarios como uno solo (o bloqueándolos a todos juntos).
if (!isDev) app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // gestionado por cada página
  crossOriginEmbedderPolicy: false,
}));

// CORS: en producción solo el dominio propio
const allowedOrigins = isDev
  ? true
  : [process.env.SITE_URL || 'https://vendoboterd.com'];
app.use(cors({ origin: allowedOrigins, credentials: true }));

app.use(clerkMiddleware());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Los comprobantes de pago NO se sirven como archivos estáticos públicos (pueden
// contener datos bancarios) — se sirven autenticados vía GET /api/bookings/:id/receipt.

// Límite general para todo el API: evita abuso/spam automatizado
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intenta de nuevo en unos minutos' },
});
app.use('/api', apiLimiter);

// Límite estricto para acciones sensibles: crear reservas y subir comprobantes de pago
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos, espera unos minutos antes de volver a intentar' },
});
app.use('/api/bookings', (req, res, next) => (req.method === 'POST' ? writeLimiter(req, res, next) : next()));

const { adminRequired } = require('./middleware/auth');

app.get('/api/admin/stats', adminRequired, async (req, res) => {
  try {
    const db = getDB();
    const [boats, bookings, pending, confirmed, revenue, recent] = await Promise.all([
      db.queryOne('SELECT COUNT(*) as c FROM boats WHERE available = true'),
      db.queryOne('SELECT COUNT(*) as c FROM bookings'),
      db.queryOne("SELECT COUNT(*) as c FROM bookings WHERE payment_status = 'submitted'"),
      db.queryOne("SELECT COUNT(*) as c FROM bookings WHERE status = 'confirmed'"),
      db.queryOne("SELECT COALESCE(SUM(total_price), 0) as s FROM bookings WHERE status = 'confirmed'"),
      db.query(`SELECT b.*, bt.name as boat_name, u.name as user_name
                FROM bookings b JOIN boats bt ON b.boat_id = bt.id JOIN users u ON b.user_id = u.id
                ORDER BY b.created_at DESC LIMIT 8`),
    ]);
    res.json({
      total_boats: parseInt(boats.c),
      total_bookings: parseInt(bookings.c),
      pending_verification: parseInt(pending.c),
      confirmed_bookings: parseInt(confirmed.c),
      total_revenue: parseFloat(revenue.s),
      recent_bookings: recent,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/boats', require('./routes/boats'));
app.use('/api/bookings', require('./routes/bookings'));

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Manejador de errores global: cualquier error no atrapado por una ruta (JSON
// malformado, límite de tamaño de Multer, etc.) cae aquí. Nunca se expone el
// stack trace ni el mensaje interno al cliente, solo un JSON genérico.
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'El archivo supera el tamaño máximo permitido (10MB)' });
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: 'Error del servidor' });
});

// Crear directorios necesarios al arrancar
fs.mkdirSync(path.join(__dirname, 'uploads', 'receipts'), { recursive: true });

init().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  VENDO BOTE RD - Servidor corriendo en http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('Error iniciando base de datos:', err);
  process.exit(1);
});
