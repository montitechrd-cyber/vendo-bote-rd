// Agrega los botes nuevos de la carpeta VENTAS/ que traen nota DATOS.txt:
// Maxum 2700SE (28'), Sea Ray Sundancer (40') y Tiara (43').
// Todos con precio a "Consultar" (sale_price null) y ocultos del catálogo de
// renta (available:false), igual que el resto de embarcaciones en venta.

require('dotenv').config();
const { init, pool } = require('./database');

const boats = [
  {
    name: 'Maxum 2700SE',
    slug: 'maxum-2700se-28',
    short_description: 'Maxum 2700SE de 28 pies (2008) en venta — consultar precio y disponibilidad.',
    description: 'Maxum 2700SE de 28 pies (2008) en venta. Motor Mercruiser 350 Mag MPI. Cuenta con salón, baño y habitación. Especificaciones referenciales; precio y detalles exactos sujetos a confirmación. Contáctanos por WhatsApp para más información.',
    location: 'Punta Cana', capacity: 8, length_ft: 28, year: 2008, brand: 'Maxum',
    price_per_day: 0,
    images: ['/assets/img/VENTAS/MAXUM 28 PIES 2008/MAXUM 28 PIES 2008.mp4'],
    features: ['Motor Mercruiser 350 Mag MPI', 'Salón', 'Baño', 'Habitación'],
    amenities: [], rules: [],
    available: false, featured: false, for_sale: true, sale_price: null,
    sale_description: 'Precio y especificaciones exactas sujetas a confirmación — consultar por WhatsApp.',
  },
  {
    name: 'Sea Ray Sundancer 40 pies',
    slug: 'sea-ray-sundancer-40',
    short_description: 'Sea Ray Sundancer de 40 pies (2007) en venta — consultar precio y disponibilidad.',
    description: 'Sea Ray Sundancer de 40 pies (2007) en venta. Planta eléctrica Onan 9 KVA (overhauled, 200 horas). Motores Cummins QSB 5.9-425 nuevos (overhauled, 150 horas), transmisión electrónica ZF y aire acondicionado nuevo. Especificaciones referenciales; precio y detalles exactos sujetos a confirmación. Contáctanos por WhatsApp para más información.',
    location: 'Punta Cana', capacity: 12, length_ft: 40, year: 2007, brand: 'Sea Ray',
    price_per_day: 0,
    images: ['/assets/img/VENTAS/SEA RAY SUNDANCER 40 PIES/SEA RAY SUNDANCER 40 PIES.mp4'],
    features: [
      'Planta Onan 9 KVA (overhauled, 200h)',
      'Motores Cummins QSB 5.9-425 nuevos (overhauled, 150h)',
      'Transmisión electrónica ZF',
      'Aire acondicionado nuevo',
    ],
    amenities: [], rules: [],
    available: false, featured: false, for_sale: true, sale_price: null,
    sale_description: 'Precio y especificaciones exactas sujetas a confirmación — consultar por WhatsApp.',
  },
  {
    name: 'Tiara 43 pies',
    slug: 'tiara-43-2000',
    short_description: 'Tiara de 43 pies (2000) en venta — consultar precio y disponibilidad.',
    description: 'Tiara de 43 pies (2000) en venta. Motores Caterpillar de 670 HP con 2,800 horas de uso. Planta eléctrica (cooler) de 9 kilos casi nueva con 400 horas de uso. Cuenta con sala, cocina, habitación, baño, aire acondicionado y sistema de GPS. Especificaciones referenciales; precio y detalles exactos sujetos a confirmación. Contáctanos por WhatsApp para más información.',
    location: 'Punta Cana', capacity: 14, length_ft: 43, year: 2000, brand: 'Tiara',
    price_per_day: 0,
    images: ['/assets/img/VENTAS/TIARA 43 PIES 2000/TIARA 43 PIES 2000.mp4'],
    features: [
      'Motores Caterpillar 670 HP (2,800 h de uso)',
      'Planta/cooler 9 kg (400 h de uso)',
      'Sala', 'Cocina', 'Habitación', 'Baño',
      'Aire acondicionado', 'Sistema de GPS',
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
