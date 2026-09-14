// Agrega los botes que faltaban en el catálogo de RENTA y en el de VENTA.
// Para las carpetas sin nota de precio/capacidad se usan valores placeholder
// claramente marcados como "pendiente de confirmar" (ver PENDIENTE_CAPACIDAD
// más abajo) — corregir desde el panel de administración cuando el dueño
// confirme los datos reales.
//
// Uso:  node seed-missing-boats.js

require('dotenv').config();
const { init, pool } = require('./database');

const PENDIENTE_CAPACIDAD = true; // usado solo como recordatorio en comentarios

const boats = [
  // ---- RENTA: precio/ubicación conocidos por el nombre de carpeta, capacidad estimada ----
  {
    name: 'La Santa',
    slug: 'la-santa',
    short_description: 'Yate La Santa para paseos privados en La Romana.',
    description: 'Renta del yate La Santa con salida desde La Romana. Precio: $1,600 usd. Capacidad estimada en 12 personas — pendiente confirmar con el proveedor el detalle exacto de inclusiones (capitán, combustible, refrigerio, etc.).',
    location: 'La Romana', capacity: 12, length_ft: null, year: null, brand: null,
    price_per_day: 1600,
    images: [
      '/assets/img/LA SANTA - 1600US - LA ROMANA/portada.jpeg',
      '/assets/img/LA SANTA - 1600US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.51.08 PM.jpeg',
      '/assets/img/LA SANTA - 1600US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.51.08 PM (1).jpeg',
      '/assets/img/LA SANTA - 1600US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.51.08 PM (2).jpeg',
      '/assets/img/LA SANTA - 1600US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.51.08 PM (3).jpeg',
      '/assets/img/LA SANTA - 1600US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.51.09 PM.jpeg',
      '/assets/img/LA SANTA - 1600US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.51.09 PM (1).jpeg',
      '/assets/img/LA SANTA - 1600US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.51.09 PM (2).jpeg',
      '/assets/img/LA SANTA - 1600US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.51.09 PM (3).jpeg',
      '/assets/img/LA SANTA - 1600US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.51.09 PM (4).jpeg',
      '/assets/img/LA SANTA - 1600US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.51.10 PM.jpeg',
      '/assets/img/LA SANTA - 1600US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.51.10 PM (1).jpeg',
      '/assets/img/LA SANTA - 1600US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.51.11 PM.jpeg',
    ],
    features: [], amenities: [],
    rules: ['Precio: $1,600 usd', 'Capacidad estimada: 12 personas (pendiente de confirmar)'],
    available: true, featured: false, for_sale: false, sale_price: null, sale_description: null,
  },
  {
    name: 'Nicole',
    slug: 'nicole',
    short_description: 'Yate Nicole para paseos privados en La Romana.',
    description: 'Renta del yate Nicole, con salida desde La Romana (ubicación asumida por el lote de fotos; confirmar). Precio: $1,800 usd. Capacidad estimada en 12 personas — pendiente confirmar con el proveedor el detalle exacto de inclusiones.',
    location: 'La Romana', capacity: 12, length_ft: null, year: null, brand: null,
    price_per_day: 1800,
    images: [
      '/assets/img/NICOLE - 1800US/portada.jpeg',
      '/assets/img/NICOLE - 1800US/WhatsApp Image 2026-06-30 at 3.51.30 PM (1).jpeg',
      '/assets/img/NICOLE - 1800US/WhatsApp Image 2026-06-30 at 3.51.31 PM.jpeg',
      '/assets/img/NICOLE - 1800US/WhatsApp Image 2026-06-30 at 3.51.31 PM (1).jpeg',
      '/assets/img/NICOLE - 1800US/WhatsApp Image 2026-06-30 at 3.51.32 PM.jpeg',
      '/assets/img/NICOLE - 1800US/WhatsApp Image 2026-06-30 at 3.51.32 PM (1).jpeg',
      '/assets/img/NICOLE - 1800US/WhatsApp Image 2026-06-30 at 3.51.32 PM (2).jpeg',
      '/assets/img/NICOLE - 1800US/WhatsApp Image 2026-06-30 at 3.51.33 PM.jpeg',
      '/assets/img/NICOLE - 1800US/WhatsApp Image 2026-06-30 at 3.51.33 PM (1).jpeg',
      '/assets/img/NICOLE - 1800US/WhatsApp Image 2026-06-30 at 3.51.33 PM (2).jpeg',
      '/assets/img/NICOLE - 1800US/WhatsApp Image 2026-06-30 at 3.51.33 PM (3).jpeg',
      '/assets/img/NICOLE - 1800US/WhatsApp Image 2026-06-30 at 3.51.34 PM.jpeg',
      '/assets/img/NICOLE - 1800US/WhatsApp Image 2026-06-30 at 3.51.34 PM (1).jpeg',
      '/assets/img/NICOLE - 1800US/WhatsApp Image 2026-06-30 at 3.51.34 PM (2).jpeg',
    ],
    features: [], amenities: [],
    rules: ['Precio: $1,800 usd', 'Capacidad estimada: 12 personas (pendiente de confirmar)'],
    available: true, featured: false, for_sale: false, sale_price: null, sale_description: null,
  },
  {
    name: 'Yate 1',
    slug: 'yate-1-la-romana',
    short_description: 'Yate privado para paseos en La Romana.',
    description: 'Renta de yate con salida desde La Romana. Precio: $2,500 usd. Capacidad estimada en 15 personas — pendiente confirmar con el proveedor el detalle exacto de inclusiones.',
    location: 'La Romana', capacity: 15, length_ft: null, year: null, brand: null,
    price_per_day: 2500,
    images: [
      '/assets/img/YATE 1 - 2500US - LA ROMANA/portada.jpeg',
      '/assets/img/YATE 1 - 2500US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.07 PM (1).jpeg',
      '/assets/img/YATE 1 - 2500US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.07 PM (3).jpeg',
      '/assets/img/YATE 1 - 2500US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.07 PM (4).jpeg',
      '/assets/img/YATE 1 - 2500US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.08 PM.jpeg',
      '/assets/img/YATE 1 - 2500US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.08 PM (1).jpeg',
      '/assets/img/YATE 1 - 2500US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.08 PM (2).jpeg',
      '/assets/img/YATE 1 - 2500US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.08 PM (3).jpeg',
      '/assets/img/YATE 1 - 2500US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.08 PM (4).jpeg',
      '/assets/img/YATE 1 - 2500US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.08 PM (5).jpeg',
      '/assets/img/YATE 1 - 2500US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.09 PM.jpeg',
      '/assets/img/YATE 1 - 2500US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.09 PM (1).jpeg',
      '/assets/img/YATE 1 - 2500US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.09 PM (2).jpeg',
    ],
    features: [], amenities: [],
    rules: ['Precio: $2,500 usd', 'Capacidad estimada: 15 personas (pendiente de confirmar)'],
    available: true, featured: false, for_sale: false, sale_price: null, sale_description: null,
  },
  {
    name: 'Yate 2',
    slug: 'yate-2-la-romana',
    short_description: 'Yate privado para paseos en La Romana.',
    description: 'Renta de yate con salida desde La Romana. Precio: $2,500 usd. Capacidad estimada en 15 personas — pendiente confirmar con el proveedor el detalle exacto de inclusiones.',
    location: 'La Romana', capacity: 15, length_ft: null, year: null, brand: null,
    price_per_day: 2500,
    images: [
      '/assets/img/YATE 2 - 2500 US - LA ROMANA/portada.jpeg',
      '/assets/img/YATE 2 - 2500 US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.05 PM (1).jpeg',
      '/assets/img/YATE 2 - 2500 US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.06 PM.jpeg',
      '/assets/img/YATE 2 - 2500 US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.06 PM (3).jpeg',
      '/assets/img/YATE 2 - 2500 US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.06 PM (5).jpeg',
      '/assets/img/YATE 2 - 2500 US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.06 PM (6).jpeg',
      '/assets/img/YATE 2 - 2500 US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.06 PM (7).jpeg',
      '/assets/img/YATE 2 - 2500 US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.06 PM (8).jpeg',
      '/assets/img/YATE 2 - 2500 US - LA ROMANA/WhatsApp Image 2026-06-30 at 3.52.07 PM.jpeg',
    ],
    features: [], amenities: [],
    rules: ['Precio: $2,500 usd', 'Capacidad estimada: 15 personas (pendiente de confirmar)'],
    available: true, featured: false, for_sale: false, sale_price: null, sale_description: null,
  },

  // ---- RENTA: sin ningún dato (solo video) — se cargan OCULTOS (available:false) hasta completar info ----
  {
    name: 'Elite',
    slug: 'elite',
    short_description: 'PENDIENTE: falta precio, capacidad y descripción.',
    description: 'Bote "Elite": solo se recibió video de portada, sin precio, capacidad ni descripción. No se muestra en el catálogo público hasta completar los datos (editar desde el panel de administración).',
    location: 'Punta Cana', capacity: 10, length_ft: null, year: null, brand: null,
    price_per_day: 0,
    images: ['/assets/img/ELITE/portada.mp4'],
    features: [], amenities: [], rules: ['PENDIENTE DE CONFIRMAR: precio y capacidad'],
    available: false, featured: false, for_sale: false, sale_price: null, sale_description: null,
  },
  {
    name: 'Lupita',
    slug: 'lupita',
    short_description: 'PENDIENTE: falta precio, capacidad y descripción.',
    description: 'Bote "Lupita": solo se recibieron videos, sin precio, capacidad ni descripción. No se muestra en el catálogo público hasta completar los datos (editar desde el panel de administración).',
    location: 'Punta Cana', capacity: 10, length_ft: null, year: null, brand: null,
    price_per_day: 0,
    images: ['/assets/img/LUPITA/portada.mp4', '/assets/img/LUPITA/LUPITA (1).mp4'],
    features: [], amenities: [], rules: ['PENDIENTE DE CONFIRMAR: precio y capacidad'],
    available: false, featured: false, for_sale: false, sale_price: null, sale_description: null,
  },
  {
    name: 'Refugio Marino',
    slug: 'refugio-marino',
    short_description: 'PENDIENTE: falta precio, capacidad y descripción.',
    description: 'Bote "Refugio Marino": solo se recibieron videos, sin precio, capacidad ni descripción. No se muestra en el catálogo público hasta completar los datos (editar desde el panel de administración).',
    location: 'Punta Cana', capacity: 10, length_ft: null, year: null, brand: null,
    price_per_day: 0,
    images: ['/assets/img/REFUGIO MARINO/portada.mp4', '/assets/img/REFUGIO MARINO/REFUGIO MARINO (2).mp4'],
    features: [], amenities: [], rules: ['PENDIENTE DE CONFIRMAR: precio y capacidad'],
    available: false, featured: false, for_sale: false, sale_price: null, sale_description: null,
  },

  // ---- VENTA: carpeta VENTAS/, solo video, sin precio -> se muestran con "Consultar" ----
  {
    name: 'Prestige 50',
    slug: 'prestige-50',
    short_description: 'Prestige 50 en venta — consultar precio y disponibilidad.',
    description: 'Prestige 50 en venta. Yate flybridge de aproximadamente 50 pies, ideal para paseos familiares y de grupo. Especificaciones referenciales; precio y detalles exactos sujetos a confirmación. Contáctanos por WhatsApp para más información.',
    location: 'Punta Cana', capacity: 12, length_ft: 50, year: null, brand: 'Prestige',
    price_per_day: 0,
    images: [
      '/assets/img/VENTAS/PRESTIGE 50/VIDEO PORTADA SIN AUDIO.mp4',
      '/assets/img/VENTAS/PRESTIGE 50/VIDEO EXPLICTIVO.mp4',
    ],
    features: [], amenities: [], rules: [],
    available: false, featured: false, for_sale: true, sale_price: null,
    sale_description: 'Precio y especificaciones exactas sujetas a confirmación — consultar por WhatsApp.',
  },
  {
    name: 'Sea Ray Sundancer 24',
    slug: 'sea-ray-sundancer-24',
    short_description: 'Sea Ray Sundancer 24 en venta — consultar precio y disponibilidad.',
    description: 'Sea Ray Sundancer 24 en venta. Lancha deportiva compacta, ideal para salidas rápidas en el mar. Especificaciones referenciales; precio y detalles exactos sujetos a confirmación. Contáctanos por WhatsApp para más información.',
    location: 'Punta Cana', capacity: 8, length_ft: 24, year: null, brand: 'Sea Ray',
    price_per_day: 0,
    images: [
      '/assets/img/VENTAS/SEARAY SUNDANCER 24/VIDEO PORTADA SIN AUDIO.mp4',
      '/assets/img/VENTAS/SEARAY SUNDANCER 24/VIDEO EXPLICATIVO.mp4',
    ],
    features: [], amenities: [], rules: [],
    available: false, featured: false, for_sale: true, sale_price: null,
    sale_description: 'Precio y especificaciones exactas sujetas a confirmación — consultar por WhatsApp.',
  },
  {
    name: 'Sea Ray Sundancer 36',
    slug: 'sea-ray-sundancer-36',
    short_description: 'Sea Ray Sundancer 36 en venta — consultar precio y disponibilidad.',
    description: 'Sea Ray Sundancer 36 en venta. Crucero deportivo de mediano porte, cómodo para grupos familiares. Especificaciones referenciales; precio y detalles exactos sujetos a confirmación. Contáctanos por WhatsApp para más información.',
    location: 'Punta Cana', capacity: 10, length_ft: 36, year: null, brand: 'Sea Ray',
    price_per_day: 0,
    images: [
      '/assets/img/VENTAS/SEARAY SUNDANCER 36/VIDEO PORTADA  SIN AUDIO.mp4',
      '/assets/img/VENTAS/SEARAY SUNDANCER 36/VIDEO EXPLICATIVO.mp4',
    ],
    features: [], amenities: [], rules: [],
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

run().catch((e) => {
  console.error('Error al actualizar el catálogo:', e.message);
  process.exit(1);
});
