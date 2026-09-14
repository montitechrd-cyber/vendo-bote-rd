// Las carpetas de fotos/videos de las embarcaciones en RENTA se movieron de
// public/assets/img/<CARPETA>/ a public/assets/img/RENTAS/<CARPETA>/.
// Este script corrige las rutas guardadas en boats.images para que sigan
// apuntando a los archivos reales (evita 404 en todo el catálogo de renta).

require('dotenv').config();
const { init, pool } = require('./database');

const RENTAL_FOLDERS = [
  'CATAMARAN 36',
  'CATAMARAN CON TOBOGAN',
  'ELITE',
  'GOBER',
  'LA SANTA - 1600US - LA ROMANA',
  'LUPITA',
  'NICOLE - 1800US',
  'PRINCESS 50',
  'REFUGIO MARINO',
  'RINKER 26',
  'SEARAY 45',
  'SEARAY',
  'YATE 1 - 2500US - LA ROMANA',
  'YATE 2 - 2500 US - LA ROMANA',
];

function fixPath(p) {
  for (const folder of RENTAL_FOLDERS) {
    const oldPrefix = '/assets/img/' + folder + '/';
    if (p.startsWith(oldPrefix)) {
      return '/assets/img/RENTAS/' + folder + '/' + p.slice(oldPrefix.length);
    }
  }
  return p;
}

async function run() {
  const db = await init();
  const boats = await db.query('SELECT id, name, slug, images FROM boats');
  let changedCount = 0;

  for (const b of boats) {
    const imgs = JSON.parse(b.images || '[]');
    const fixed = imgs.map(fixPath);
    const changed = fixed.some((p, i) => p !== imgs[i]);
    if (changed) {
      await db.run('UPDATE boats SET images = $1 WHERE id = $2', [JSON.stringify(fixed), b.id]);
      console.log(`Corregido: ${b.name} (${b.slug}) -> ${fixed.length} rutas`);
      changedCount++;
    }
  }

  console.log(`Listo. ${changedCount} embarcaciones actualizadas.`);
  await pool.end();
}

run().catch((e) => { console.error('Error:', e.message); process.exit(1); });
