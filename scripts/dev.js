// Arranque local que SIEMPRE tiene base de datos:  npm run dev   (o doble clic en INICIAR.bat)
//  1) Lee DATABASE_URL del .env.
//  2) Si apunta a este equipo (localhost) y no hay ningún Postgres respondiendo, levanta uno propio (embedded-postgres)
//     con el mismo usuario, clave, puerto y nombre de base que diga la URL, guardado en la carpeta .localdb.
//  3) Si no hay .env o DATABASE_URL, usa una base local por defecto y lo crea.
//  4) Arranca el servidor. En una base vacía, database.js crea las tablas y carga el catálogo real.
// Si DATABASE_URL apunta a un servidor remoto (por ejemplo Railway) NO levanta nada: solo avisa.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
process.chdir(root);
require('dotenv').config({ path: path.join(root, '.env') });

const DEFAULT_URL = 'postgresql://postgres:postgres@localhost:54329/vendobote';
let rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
  rawUrl = DEFAULT_URL;
  process.env.DATABASE_URL = rawUrl;
  console.log('  Sin DATABASE_URL en .env: se usa la base local por defecto.');
}
if (process.env.NODE_ENV === 'production') { console.error('  npm run dev es solo para desarrollo. En producción usa: npm start'); process.exit(1); }

let url;
try { url = new URL(rawUrl); } catch { console.error('  DATABASE_URL no es una URL válida.'); process.exit(1); }
const host = url.hostname;
const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
let port = Number(url.port || 5432);
const user = decodeURIComponent(url.username || 'postgres');
const password = decodeURIComponent(url.password || 'postgres');
const dbName = decodeURIComponent(url.pathname.replace(/^\//, '') || 'postgres');

const { Client } = require('pg');
async function canConnect(database) {
  const c = new Client({ host: isLocal ? '127.0.0.1' : host, port, user, password, database, connectionTimeoutMillis: 3000,
    ssl: process.env.DB_SSL === '1' ? { rejectUnauthorized: false } : false });
  try { await c.connect(); await c.end(); return true; } catch (e) { try { await c.end(); } catch {} return e; }
}

// Cambia el puerto en esta ejecución y en el .env, para que todo (servidor, scripts) use el que sí funciona.
function useNewPort(newPort) {
  const old = port;
  port = newPort;
  url.port = String(newPort);
  process.env.DATABASE_URL = url.toString();
  const envFile = path.join(root, '.env');
  try {
    if (fs.existsSync(envFile)) {
      const txt = fs.readFileSync(envFile, 'utf8');
      const out = txt.replace(/^(DATABASE_URL=.*@[^:\/]+):\d+(\/.*)$/m, '$1:' + newPort + '$2');
      if (out !== txt) { fs.writeFileSync(envFile, out); console.log('  .env actualizado: la base local ahora usa el puerto ' + newPort + ' (el ' + old + ' está bloqueado en este equipo).'); }
    }
  } catch {}
}

async function ensureDatabase() {
  const first = await canConnect(dbName);
  if (first === true) return;
  // Postgres responde pero falta la base: se crea.
  const admin = await canConnect('postgres');
  if (admin === true) {
    const c = new Client({ host: '127.0.0.1', port, user, password, database: 'postgres' });
    await c.connect();
    await c.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
    await c.end();
    console.log('  Base creada:', dbName);
    return;
  }
  if (!isLocal) { console.error('  No se pudo conectar a la base remota (' + host + '):', first.message); process.exit(1); }

  // Nada responde en localhost: levantar el Postgres propio.
  let EmbeddedPostgres;
  try { EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres'); }
  catch { console.error('  Falta la base local. Ejecuta una vez:  npm install'); process.exit(1); }
  const dir = path.join(root, '.localdb');
  const isNew = !fs.existsSync(path.join(dir, 'PG_VERSION'));
  if (isNew) {
    console.log('  Creando la base de datos local (solo la primera vez)...');
    await new EmbeddedPostgres({ databaseDir: dir, user, password, port, persistent: true }).initialise();
  }
  // Windows reserva o bloquea algunos puertos (5432 incluido en muchos equipos): si el pedido no se puede usar, se prueba otro.
  const candidates = [port, 54329, 54330, 54331, 54332].filter((v, i, a) => a.indexOf(v) === i);
  let pg = null;
  for (const tryPort of candidates) {
    const inst = new EmbeddedPostgres({ databaseDir: dir, user, password, port: tryPort, persistent: true });
    try { await inst.start(); pg = inst; if (tryPort !== port) useNewPort(tryPort); break; }
    catch (e) { console.log('  El puerto ' + tryPort + ' no está disponible' + (e && e.message ? ' (' + e.message + ')' : '') + '. Probando otro...'); }
  }
  if (!pg) { console.error('  No se pudo iniciar la base local en ningún puerto. Cierra otros Postgres y vuelve a intentar.'); process.exit(1); }
  if (isNew || (await canConnect(dbName)) !== true) { try { await pg.createDatabase(dbName); } catch {} }
  console.log('  Base de datos local lista en el puerto ' + port + '.');
  const stop = async () => { try { await pg.stop(); } catch {} process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

(async () => {
  if (isLocal) await ensureDatabase();
  else console.log('  AVISO: DATABASE_URL apunta a un servidor remoto (' + host + '). Todo lo que hagas afecta esa base' + (process.env.DB_READONLY === '1' ? ' (solo lectura).' : '.'));
  // Simulador local de AZUL: solo con AZUL_ENV=test, fuera de producción y con AZUL_PAYMENT_URL apuntando a localhost.
  try {
    const pu = process.env.AZUL_PAYMENT_URL ? new URL(process.env.AZUL_PAYMENT_URL) : null;
    // Nunca con una base remota: el simulador firma con el AuthKey del .env y "aprobaría" reservas reales sin pago.
    if (!isLocal && pu) console.log('  El simulador AZUL NO se inicia porque DATABASE_URL no es local.');
    else if (process.env.AZUL_ENV === 'test' && process.env.NODE_ENV !== 'production' && pu && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(pu.hostname)) {
      process.env.AZUL_SIM_PORT = process.env.AZUL_SIM_PORT || pu.port || '4010';
      require('./azul-sim.js').server.listen(Number(process.env.AZUL_SIM_PORT), '127.0.0.1', () => console.log('  Simulador AZUL en ' + process.env.AZUL_PAYMENT_URL));
    }
  } catch (e) { console.log('  No se pudo iniciar el simulador AZUL:', e.message); }
  require('../server.js');
})().catch(e => { console.error('  Error preparando la base local:', e.message || e); process.exit(1); });
