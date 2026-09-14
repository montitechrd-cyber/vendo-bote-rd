// Agrega los 2 botes nuevos en venta de la carpeta VENTAS/ (con nota DATOS.txt):
// Intrepid 38 (2005, con precio real) y Sea Ray Sedan Bridge 51' (2002, sin precio -> Consultar).

require('dotenv').config();
const { init, pool } = require('./database');

const boats = [
  {
    name: 'Intrepid 38',
    slug: 'intrepid-38',
    short_description: 'Intrepid 38 (2005) en venta — $190,000 USD.',
    description: 'Intrepid 38 (2005) en venta. 3 motores Suzuki 300 HP con 986 horas de uso. Generador Phasor 4.5 kilos, thruster en la proa. Cuenta con camarote, cocina, baño, aire acondicionado, sistema GPS Garmin, sistema de música JL Audio y todos sus covers. Precio: $190,000 USD.',
    location: 'Punta Cana', capacity: 12, length_ft: 38, year: 2005, brand: 'Intrepid',
    price_per_day: 0,
    // Nota: la carpeta INTREPID 38 solo trae DATOS.txt, sin fotos ni video todavía.
    images: [],
    features: [
      '3 motores Suzuki 300 HP (986 horas)',
      'Generador Phasor 4.5 kilos',
      'Thruster en la proa',
      'Camarote', 'Cocina', 'Baño',
      'Aire acondicionado',
      'Sistema GPS Garmin',
      'Sistema de música JL Audio',
      'Incluye todos sus covers',
    ],
    amenities: [], rules: [],
    available: false, featured: false, for_sale: true, sale_price: 190000,
    sale_description: 'Precio: $190,000 USD. Contáctanos por WhatsApp para más información y agendar una visita.',
  },
  {
    name: 'Sea Ray Sedan Bridge 51',
    slug: 'sea-ray-sedan-bridge-51',
    short_description: 'Sea Ray Sedan Bridge de 51 pies (2002) en venta — consultar precio y disponibilidad.',
    description: 'Sea Ray Sedan Bridge de 51 pies (2002) en venta. Motores Caterpillar (nuevos) y planta Onan de 20 kilos (nueva). Cuenta con salón, cocina, 3 habitaciones, sistema GPS Garmin y aire acondicionado con mantenimiento reciente. Especificaciones referenciales; precio y detalles exactos sujetos a confirmación. Contáctanos por WhatsApp para más información.',
    location: 'Punta Cana', capacity: 14, length_ft: 51, year: 2002, brand: 'Sea Ray',
    price_per_day: 0,
    images: [
      '/assets/img/VENTAS/Sea Ray Sedan Bridge 2001 51 PIES/Sea Ray Sedan BridgE 51 2002.mp4',
    ],
    features: [
      'Motores Caterpillar (nuevos)',
      'Planta Onan 20 kilos (nueva)',
      'Salón', 'Cocina', '3 habitaciones',
      'Sistema GPS Garmin',
      'Aire acondicionado (mantenimiento reciente)',
    ],
    amenities: [], rules: [],
    available: false, featured: false, for_sale: true, sale_price: null,
    sale_description: 'Precio y especificaciones exactas sujetas a confirmación — consultar por WhatsApp.',
  },
];

async function run() {
  const db = await init();
  for (const b of boats) {
    const existing = await db.queryOne('SELECT id FROM boats WHERE slug = $1', [b.slug]);
    const params = [
      b.name, b.slug, b.description, b.short_description, b.location, b.capacity,
      b.length_ft, b.year, b.brand, b.price_per_day,
      JSON.stringify(b.images), JSON.stringify(b.features), JSON.stringify(b.amenities), JSON.stringify(b.rules),
      b.available, b.featured, b.for_sale, b.sale_price, b.sale_description,
    ];
    if (existing) {
      await db.run(
        `UPDATE boats SET name=$1, description=$3, short_description=$4, location=$5, capacity=$6,
         length_ft=$7, year=$8, brand=$9, price_per_day=$10, images=$11, features=$12, amenities=$13,
         rules=$14, available=$15, featured=$16, for_sale=$17, sale_price=$18, sale_description=$19 WHERE slug=$2`,
        params
      );
      console.log(`Actualizado: ${b.name} (${b.slug})`);
    } else {
      await db.run(
        `INSERT INTO boats (name,slug,description,short_description,location,capacity,length_ft,year,brand,price_per_day,images,features,amenities,rules,available,featured,for_sale,sale_price,sale_description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        params
      );
      console.log(`Agregado: ${b.name} (${b.slug})`);
    }
  }
  console.log('Listo.');
  await pool.end();
}

run().catch((e) => { console.error('Error:', e.message); process.exit(1); });
