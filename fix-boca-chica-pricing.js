// Boca Chica pasa de cotizar por extras a la carta (jet ski, parrillada, decoración,
// buffet) a un precio fijo todo incluido: 1h de Jet Ski, parrillada, agua, hielo,
// gasolina, tripulación y cocinero. Precios: Lupita $750, Elite $900, resto $1500.
// Elite y Lupita quedan marcadas como Boca Chica (la ubicación en el repo estaba
// desactualizada respecto a la base de datos real).
//
// Uso:  node fix-boca-chica-pricing.js

require('dotenv').config();
const { init, pool } = require('./database');

const STANDARD_INCLUSIONS = ['1 hora de Jet Ski', 'Parrillada', 'Agua', 'Hielo', 'Gasolina', 'Tripulación', 'Cocinero'];

async function run() {
  const db = await init();

  await db.run(`UPDATE boats SET location = 'Boca Chica' WHERE slug IN ('elite','lupita')`);
  console.log('Ubicación corregida a Boca Chica: elite, lupita');

  await db.run(`UPDATE boats SET price_per_day = 750 WHERE slug = 'lupita'`);
  await db.run(`UPDATE boats SET price_per_day = 900 WHERE slug = 'elite'`);
  const rest = await db.run(`UPDATE boats SET price_per_day = 1500 WHERE location = 'Boca Chica' AND slug NOT IN ('elite','lupita')`);
  console.log(`Precios fijados: lupita=$750, elite=$900, resto de Boca Chica=$1500 (${rest.rowCount} embarcación(es))`);

  await db.run(`UPDATE boats SET description = REPLACE(description, '$700 usd', '$750 usd') WHERE slug = 'lupita'`);

  const bocaChicaBoats = await db.query(`SELECT id, slug, amenities FROM boats WHERE location = 'Boca Chica'`);
  for (const boat of bocaChicaBoats) {
    const current = JSON.parse(boat.amenities || '[]');
    const merged = [...current];
    STANDARD_INCLUSIONS.forEach(item => { if (!merged.includes(item)) merged.push(item); });
    await db.run('UPDATE boats SET amenities = $1 WHERE id = $2', [JSON.stringify(merged), boat.id]);
    console.log('Amenidades actualizadas:', boat.slug);
  }

  console.log('Listo.');
  await pool.end();
}

run().catch((e) => { console.error('Error:', e.message); process.exit(1); });
