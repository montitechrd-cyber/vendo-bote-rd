// Corrige: (1) el tipo correcto de cada embarcación (lancha/yate, no "bote"
// genérico ni intercambiados), y (2) el lenguaje de marketing que sugería
// "cruceros" o "explorar el Caribe" — el servicio real son paseos por las
// playas de cada ubicación, disfrutados anclados, no cruceros de exploración.

require('dotenv').config();
const { init, pool } = require('./database');

const updates = [
  {
    slug: 'lancha-gober',
    short_description: 'Lancha premium para disfrutar la playa de Boca Chica, anclados en sus aguas tranquilas en familia o grupo.',
  },
  {
    slug: 'sea-ray-sundancer',
    description: 'Experimenta el lujo en el mar a bordo de la Sea Ray Sundancer. Esta embarcación de alto rendimiento combina elegancia y potencia para ofrecerte una experiencia náutica premium anclada en las playas de Boca Chica.',
    short_description: 'Lancha de lujo con cabina, perfecta para disfrutar anclados en las playas de Boca Chica.',
  },
  {
    slug: 'rinker-26',
    description: 'Lancha Rinker 26 con capacidad para 6 personas, con salida desde Punta Cana. Incluye yate y gasolina, capitán, transporte privado de ida y vuelta desde tu hotel o villa, equipo de snorkel, nachos con salsa, hielo, 12 aguas, 12 refrescos y 12 cervezas. Visita el delfinario para ver a los delfines desde el exterior, además de las piscinas naturales y la zona de snorkel. El cliente puede traer su propia bebida a bordo. Precio: $800 usd por 3 horas o $900 usd por 4 horas.',
    short_description: 'Lancha íntima Rinker 26 para 6 personas, ideal para grupos pequeños en Punta Cana.',
  },
  {
    slug: 'sea-ray-45',
    description: 'Lancha Sea Ray 45 con capacidad para 12 personas, con salida desde Punta Cana. Incluye yate y gasolina, capitán y marino, equipos de esnórquel, transporte privado de ida y vuelta desde tu hotel o villa, nachos con salsa, hielo, aguas, refrescos y 2 litros de cerveza. Visita las piscinas naturales de Punta Cana y la zona de esnórquel. El cliente puede traer su propia bebida a bordo. Precio: $1,250 usd por 3 horas o $1,450 usd por 4 horas.',
    short_description: 'Lancha premium Sea Ray 45 para 12 personas con snorkel y open bar en Punta Cana.',
  },
  {
    slug: 'nicole',
    description: 'Renta de la lancha Nicole, con salida desde La Romana (ubicación asumida por el lote de fotos; confirmar). Precio: $1,800 usd. Capacidad estimada en 12 personas — pendiente confirmar con el proveedor el detalle exacto de inclusiones.',
    short_description: 'Lancha Nicole para paseos privados en La Romana.',
  },
  {
    slug: 'elite',
    description: 'Renta del yate Elite. Capacidad para 20 personas. Precio: $900 usd.',
    short_description: 'Yate Elite para hasta 20 personas.',
  },
  {
    slug: 'lupita',
    description: 'Renta de la lancha Lupita. Capacidad para 20 personas. Precio: $700 usd.',
    short_description: 'Lancha Lupita para hasta 20 personas.',
  },
];

async function run() {
  const db = await init();
  for (const u of updates) {
    const sets = [];
    const params = [];
    let i = 1;
    if (u.description !== undefined) { sets.push(`description = $${i++}`); params.push(u.description); }
    if (u.short_description !== undefined) { sets.push(`short_description = $${i++}`); params.push(u.short_description); }
    params.push(u.slug);
    await db.run(`UPDATE boats SET ${sets.join(', ')} WHERE slug = $${i}`, params);
    console.log('Corregido:', u.slug);
  }
  console.log('Listo.');
  await pool.end();
}

run().catch((e) => { console.error('Error:', e.message); process.exit(1); });
