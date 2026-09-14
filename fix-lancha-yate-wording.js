// La descripción de estas dos lanchas decía "Incluye yate y gasolina" (residuo de
// las notas originales), lo cual contradice su tipo real ya corregido ("Lancha")
// y hacía que el filtro de tipo "Yate" del marquee las mostrara por error.

require('dotenv').config();
const { init, pool } = require('./database');

const updates = [
  {
    slug: 'rinker-26',
    description: 'Lancha Rinker 26 con capacidad para 6 personas, con salida desde Punta Cana. Incluye combustible, capitán, transporte privado de ida y vuelta desde tu hotel o villa, equipo de snorkel, nachos con salsa, hielo, 12 aguas, 12 refrescos y 12 cervezas. Visita el delfinario para ver a los delfines desde el exterior, además de las piscinas naturales y la zona de snorkel. El cliente puede traer su propia bebida a bordo. Precio: $800 usd por 3 horas o $900 usd por 4 horas.',
  },
  {
    slug: 'sea-ray-45',
    description: 'Lancha Sea Ray 45 con capacidad para 12 personas, con salida desde Punta Cana. Incluye combustible, capitán y marino, equipos de esnórquel, transporte privado de ida y vuelta desde tu hotel o villa, nachos con salsa, hielo, aguas, refrescos y 2 litros de cerveza. Visita las piscinas naturales de Punta Cana y la zona de esnórquel. El cliente puede traer su propia bebida a bordo. Precio: $1,250 usd por 3 horas o $1,450 usd por 4 horas.',
  },
];

async function run() {
  const db = await init();
  for (const u of updates) {
    await db.run('UPDATE boats SET description = $1 WHERE slug = $2', [u.description, u.slug]);
    console.log('Corregido:', u.slug);
  }
  console.log('Listo.');
  await pool.end();
}

run().catch((e) => { console.error('Error:', e.message); process.exit(1); });
