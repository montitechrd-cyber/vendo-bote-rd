// Deja el catálogo de embarcaciones de tu base LOCAL igual que el de producción (vendoboterd.com).
// Uso:  npm run db:sync     (no toca usuarios, reservas ni pagos; solo la tabla boats)
// Fuente: scripts/boats-snapshot.json (copia del catálogo público). Para refrescarla desde producción: npm run db:sync -- --refresh
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
process.chdir(root);
require('dotenv').config({ path: path.join(root, '.env') });
const { Pool } = require('pg');

if (process.env.NODE_ENV === 'production') { console.error('Este script es solo para la base local.'); process.exit(1); }
const dbUrl = process.env.DATABASE_URL || '';
if (!/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(dbUrl)) { console.error('DATABASE_URL no es una base local: no se modifica.'); process.exit(1); }

const file = path.join(__dirname, 'boats-snapshot.json');
(async () => {
  if (process.argv.includes('--refresh')) {
    const g = (u) => fetch('https://vendoboterd.com' + u).then(r => r.json());
    const [a, b] = await Promise.all([g('/api/boats'), g('/api/boats/for-sale')]);
    const seen = new Set(); const boats = [];
    for (const x of [...a, ...b]) { if (seen.has(x.slug)) continue; seen.add(x.slug); const { id, created_at, ...rest } = x; boats.push(rest); }
    fs.writeFileSync(file, JSON.stringify({ generado: new Date().toISOString().slice(0, 10), fuente: 'catalogo publico de vendoboterd.com', boats }, null, 1));
    console.log('Copia del catálogo actualizada desde producción:', boats.length, 'embarcaciones.');
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pool = new Pool({ connectionString: dbUrl });
  const j = (v) => JSON.stringify(v == null ? [] : v);
  let nuevas = 0, actualizadas = 0;
  for (const b of data.boats) {
    const vals = [b.name, b.slug, b.description, b.short_description, b.location, b.capacity, b.length_ft, b.year, b.brand, b.price_per_day,
      j(b.images), j(b.features), j(b.amenities), j(b.rules), !!b.available, !!b.featured, !!b.for_sale, b.sale_price, b.sale_description,
      b.pricing_scheme ? JSON.stringify(b.pricing_scheme) : null];
    const r = await pool.query(
      `UPDATE boats SET name=$1,description=$3,short_description=$4,location=$5,capacity=$6,length_ft=$7,year=$8,brand=$9,price_per_day=$10,
        images=$11,features=$12,amenities=$13,rules=$14,available=$15,featured=$16,for_sale=$17,sale_price=$18,sale_description=$19,pricing_scheme=$20
       WHERE slug=$2`, vals);
    if (r.rowCount) { actualizadas++; continue; }
    await pool.query(
      `INSERT INTO boats (name,slug,description,short_description,location,capacity,length_ft,year,brand,price_per_day,images,features,amenities,rules,available,featured,for_sale,sale_price,sale_description,pricing_scheme)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`, vals);
    nuevas++;
  }
  // Embarcaciones que existen solo en tu base local y no en producción: se dejan, pero se avisa.
  const slugs = data.boats.map(b => b.slug);
  const extra = await pool.query('SELECT slug FROM boats WHERE NOT (slug = ANY($1))', [slugs]);
  console.log(`Catálogo local sincronizado: ${actualizadas} actualizadas, ${nuevas} nuevas.`);
  if (extra.rowCount) console.log('Solo existen en tu base local (no en producción):', extra.rows.map(r => r.slug).join(', '));
  await pool.end();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
