require('dotenv').config();
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { init, getDB } = require('./database');

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
  frameguard: false, // el embebido lo controla frame-ancestors (abajo)
  // El inicio de sesión con Google abre una ventana emergente que responde por postMessage:
  // con COOP "same-origin" (valor por defecto) esa ventana queda aislada y se congela.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
// Content-Security-Policy: solo se cargan scripts del propio sitio y de Google (inicio de sesión), así que
// un script inyectado desde otro dominio no se ejecuta. Los scripts/estilos en línea siguen permitidos porque
// las páginas los usan. Además solo NEURALAB (portafolio) y el propio sitio pueden embeber esta web en un iframe.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "connect-src 'self' https://accounts.google.com",
  "frame-src https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self' https://neuralabrd.com https://www.neuralabrd.com http://localhost:* http://127.0.0.1:*",
].join('; ');
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  next();
});

// Comprime HTML/CSS/JS/JSON (deja pasar mp4/jpeg tal cual: ya vienen comprimidos
// y intentar recomprimirlos solo gasta CPU sin ganar tamaño).
app.use(compression());

// CORS: en producción solo el dominio propio
const allowedOrigins = isDev
  ? true
  : [process.env.SITE_URL || 'https://vendoboterd.com'];
app.use(cors({ origin: allowedOrigins, credentials: true }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Fotos/videos/CSS/JS: cache largo en el navegador. Son cientos de MB de medios
// (varios videos pesan 40-70MB) — sin esto, cada visita los vuelve a descargar
// completos en vez de servirlos desde la caché local a partir de la segunda vista.
// Sin "immutable": las fotos se reemplazan de vez en cuando bajo el mismo nombre
// (ej. portada.jpg), así que el navegador revalida después de un día en vez de
// ignorar por una semana un archivo que en realidad cambió.
// SEO (robots.txt, sitemap.xml, metadatos por página): debe ir ANTES del static
// para que las páginas HTML salgan con su title/description/JSON-LD propios.
app.use(require('./routes/seo'));
// Fotos de embarcaciones: si el navegador acepta WebP y existe la versión .webp junto al
// original (foo.jpeg -> foo.jpeg.webp), se sirve esa; las rutas guardadas no cambian.
const IMG_ROOT = path.join(__dirname, 'public', 'assets', 'img');
app.use('/assets/img', (req, res, next) => {
  if (req.method !== 'GET' || !/^\/(RENTAS|VENTAS)\//.test(req.path) || !/\.(jpe?g|png)$/i.test(req.path)) return next();
  res.setHeader('Vary', 'Accept');
  if (!(req.headers.accept || '').includes('image/webp')) return next();
  let rel;
  try { rel = decodeURIComponent(req.path); } catch (e) { return next(); }
  const file = path.join(IMG_ROOT, rel + '.webp');
  if (!file.startsWith(IMG_ROOT + path.sep)) return next();
  fs.access(file, fs.constants.R_OK, (err) => {
    if (err) return next();
    res.type('image/webp');
    res.setHeader('Cache-Control', 'public, max-age=2592000');
    res.sendFile(file);
  });
});
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets'), {
  maxAge: '1d',
  // imagenes, video y fuentes casi nunca cambian de nombre: cache larga; css/js se versionan con ?v=
  setHeaders(res, file) { if (/\.(jpe?g|png|webp|avif|gif|svg|mp4|woff2?)$/i.test(file)) res.setHeader('Cache-Control', 'public, max-age=2592000'); }
}));
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
  max: Number(process.env.WRITE_LIMIT) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos, espera unos minutos antes de volver a intentar' },
});
app.use('/api/bookings', (req, res, next) => (req.method === 'POST' ? writeLimiter(req, res, next) : next()));

// Login/registro/recuperación: límite estricto contra adivinación de contraseñas y spam de correos
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_LIMIT) || 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos, espera unos minutos antes de volver a intentar' },
});
app.use(['/api/auth/login', '/api/auth/register', '/api/auth/forgot', '/api/auth/reset', '/api/auth/google', '/api/auth/me/email', '/api/auth/me/password'], authLimiter);

const { adminRequired } = require('./middleware/auth');

app.get('/api/admin/stats', adminRequired, async (req, res) => {
  try {
    const db = getDB();
    const [boats, bookings, pending, confirmed, revenue, recent] = await Promise.all([
      db.queryOne('SELECT COUNT(*) as c FROM boats WHERE available = true OR for_sale = true'),
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
app.use('/api/rates', require('./routes/rates'));
app.use('/api/bookings', require('./routes/bookings'));

// Rutas desconocidas: 404 real (antes devolvía el home con 200, lo que Google
// interpreta como páginas duplicadas). Se muestra el home pero sin indexar.
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.setHeader('X-Robots-Tag', 'noindex');
  res.status(404).type('html').send(fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'));
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
fs.mkdirSync(path.join(__dirname, 'uploads', 'ids'), { recursive: true });

init().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  VENDO BOTE RD - Servidor corriendo en http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('Error iniciando base de datos:', err);
  process.exit(1);
});
