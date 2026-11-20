// Base de datos PostgreSQL LOCAL para desarrollo (no toca producción).
// Uso:   npm i --no-save embedded-postgres   (una sola vez)
//        node scripts/dev-db.js              (déjalo corriendo en una terminal)
//        y en .env:  DATABASE_URL=postgresql://postgres:postgres@localhost:54329/vendobote  NODE_ENV=development
const path = require('path');
const fs = require('fs');
let EmbeddedPostgres;
try { EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres'); }
catch (e) { console.error('Falta embedded-postgres. Ejecuta: npm i --no-save embedded-postgres'); process.exit(1); }

const dir = path.join(__dirname, '..', '.localdb');
const port = 54329;

(async () => {
  const first = !fs.existsSync(path.join(dir, 'PG_VERSION'));
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: true });
  if (first) await pg.initialise();
  await pg.start();
  if (first) await pg.createDatabase('vendobote');
  console.log('PostgreSQL local listo: postgresql://postgres:postgres@localhost:' + port + '/vendobote');
  const stop = async () => { await pg.stop(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
})().catch(e => { console.error(e); process.exit(1); });
