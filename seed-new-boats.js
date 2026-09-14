// Script de una sola vez: agrega/actualiza en el catálogo de alquiler
// los botes nuevos cuyas fotos y notas de descripción fueron añadidas
// en public/assets/img/<CARPETA>/ (ver *.txt / DESCRIPCION.txt de cada carpeta).
//
// Uso:  node seed-new-boats.js
// Requiere que DATABASE_URL (en .env) apunte a un Postgres accesible.

require('dotenv').config();
const { init, pool } = require('./database');

const boats = [
  {
    name: 'Catamarán 36',
    slug: 'catamaran-36',
    short_description: 'Catamarán de 36 pies para 18 personas, snorkel y piscinas naturales saliendo de Cap Cana.',
    description: 'Disfruta 4 horas a bordo del Catamarán 36 con capacidad para 18 personas, con salida desde Cap Cana. La renta incluye catamarán y combustible, capitán y marino, transporte privado de ida y vuelta desde tu hotel o villa, equipo de snorkel, hielo, agua y refrescos. Visita las piscinas naturales de Punta Cana y su zona de snorkel. El cliente puede traer su propia bebida a bordo. Precio: $1,950 usd por 4 horas (18 personas).',
    location: 'Punta Cana',
    capacity: 18,
    length_ft: 36,
    year: null,
    brand: 'Catamarán',
    price_per_day: 1950,
    images: [
      '/assets/img/CATAMARAN 36/CATAMARAN 36.jpeg',
      '/assets/img/CATAMARAN 36/WhatsApp Image 2026-07-25 at 10.26.34 PM.jpeg',
      '/assets/img/CATAMARAN 36/WhatsApp Image 2026-07-25 at 10.26.35 PM.jpeg',
      '/assets/img/CATAMARAN 36/WhatsApp Image 2026-07-25 at 10.26.35 PM (1).jpeg',
      '/assets/img/CATAMARAN 36/WhatsApp Image 2026-07-25 at 10.26.36 PM.jpeg',
      '/assets/img/CATAMARAN 36/WhatsApp Image 2026-07-25 at 10.26.36 PM (1).jpeg',
      '/assets/img/CATAMARAN 36/WhatsApp Image 2026-07-25 at 10.26.37 PM.jpeg',
    ],
    features: [
      'Catamarán y gasolina incluidos',
      'Capitán y marino',
      'Transporte privado de ida y vuelta desde tu hotel o villa',
      'Equipo de snorkel',
    ],
    amenities: ['Hielo', 'Agua', 'Refrescos'],
    rules: [
      'Máximo 18 personas',
      'Duración de la renta: 4 horas',
      'El cliente puede traer su propia bebida a bordo',
    ],
    available: true,
    featured: false,
  },
  {
    name: 'Catamarán con Tobogán',
    slug: 'catamaran-con-tobogan',
    short_description: 'Catamarán privado con tobogán, open bar completo y snorkel para hasta 15 personas.',
    description: 'Catamarán privado con tobogán para hasta 15 personas, con salida desde Punta Cana. Incluye catamarán y combustible, transporte privado de ida y vuelta desde tu hotel o villa, equipo de snorkel y paddle board. Visita la zona de snorkel, los bancos de arena (piscinas naturales) y el delfinario para ver a los delfines desde afuera. Duración: 3 horas, con horarios de 8:30am a 11:30am, 11:30am a 2:30pm y 2:30pm a 5:30pm (hora extra: $200 usd). Hay opciones de almuerzo disponibles (dominicano, hamburguesas, hamburguesas con pollo o langosta, con costo adicional por persona). El cliente puede traer sus propias bebidas y comida si lo desea. Precio: $1,050 usd (15 personas).',
    location: 'Punta Cana',
    capacity: 15,
    length_ft: null,
    year: null,
    brand: 'Catamarán',
    price_per_day: 1050,
    images: [
      '/assets/img/CATAMARAN CON TOBOGAN/CATAMARÁN CON TOBOGAN PORTADA.jpeg',
      '/assets/img/CATAMARAN CON TOBOGAN/CATAMARÁN CON TOBOGAN (1).jpeg',
      '/assets/img/CATAMARAN CON TOBOGAN/CATAMARÁN CON TOBOGAN (2).jpeg',
      '/assets/img/CATAMARAN CON TOBOGAN/CATAMARÁN CON TOBOGAN (3).jpeg',
      '/assets/img/CATAMARAN CON TOBOGAN/CATAMARÁN CON TOBOGAN (5).jpeg',
      '/assets/img/CATAMARAN CON TOBOGAN/CATAMARÁN CON TOBOGAN (6).jpeg',
      '/assets/img/CATAMARAN CON TOBOGAN/CATAMARÁN CON TOBOGAN (7).jpeg',
    ],
    features: [
      'Catamarán y combustible incluidos',
      'Transporte privado de ida y vuelta desde tu hotel o villa',
      'Equipo de snorkel',
      'Paddle board',
      'Tobogán acuático',
    ],
    amenities: [
      'Open Bar: ron, cerveza Presidente, mamajuana, mojito, ponche de frutas, refrescos, agua y hielo',
      'Snacks: sándwiches, frutas tropicales, nachos con salsa',
    ],
    rules: [
      'Máximo 15 personas',
      'Duración: 3 horas (hora extra $200 usd)',
      'Horarios disponibles: 8:30am-11:30am, 11:30am-2:30pm, 2:30pm-5:30pm',
      'El cliente puede traer sus propias bebidas y comida',
    ],
    available: true,
    featured: false,
  },
  {
    name: 'Princess 50',
    slug: 'princess-50',
    short_description: 'Yate de lujo Princess 50 para 10-20 personas con open bar completo y snorkel en Punta Cana.',
    description: 'Yate Princess 50 con capacidad estándar para 10 personas (máximo 20 personas, con cargo adicional de $80 usd por persona extra), con salida desde Punta Cana. Incluye yate y gasolina, capitán y marino, transporte privado de ida y vuelta desde tu hotel o villa, equipos de snorkel, nachos con salsa, frutas tropicales y open bar (cerveza, hielo, agua, refrescos, mamajuana, ron y jugos). Visita las piscinas naturales de Punta Cana y la zona de snorkel. El cliente puede traer su propia bebida a bordo. Precio: $1,350 usd por 3 horas o $1,550 usd por 4 horas (hora extra: $200 usd).',
    location: 'Punta Cana',
    capacity: 10,
    length_ft: 50,
    year: null,
    brand: 'Princess',
    price_per_day: 1350,
    images: [
      '/assets/img/PRINCESS 50/PRINCESS 50 PORTADA.jpeg',
      '/assets/img/PRINCESS 50/PRINCESS 50 (1).jpeg',
      '/assets/img/PRINCESS 50/PRINCESS 50 (2).jpeg',
      '/assets/img/PRINCESS 50/PRINCESS 50 (3).jpeg',
      '/assets/img/PRINCESS 50/PRINCESS 50 (4).jpeg',
      '/assets/img/PRINCESS 50/PRINCESS 50 (5).jpeg',
      '/assets/img/PRINCESS 50/PRINCESS 50 (6).jpeg',
      '/assets/img/PRINCESS 50/PRINCESS 50 (7).jpeg',
      '/assets/img/PRINCESS 50/PRINCESS 50 (8).jpeg',
      '/assets/img/PRINCESS 50/PRINCESS 50 (9).jpeg',
      '/assets/img/PRINCESS 50/PRINCESS 50 (10).jpeg',
      '/assets/img/PRINCESS 50/PRINCESS 50 (11).jpeg',
      '/assets/img/PRINCESS 50/PRINCESS 50 (12).jpeg',
      '/assets/img/PRINCESS 50/PRINCESS 50 (13).jpeg',
      '/assets/img/PRINCESS 50/PRINCESS 50 (14).jpeg',
      '/assets/img/PRINCESS 50/PRINCESS 50 (15).jpeg',
      '/assets/img/PRINCESS 50/PRINCESS 50 (17).jpeg',
      '/assets/img/PRINCESS 50/PRINCESS 50 (18).jpeg',
      '/assets/img/PRINCESS 50/PRINCESS 50 (19).jpeg',
    ],
    features: [
      'Yate y gasolina incluidos',
      'Capitán y marino',
      'Transporte privado de ida y vuelta desde tu hotel o villa',
      'Equipos de snorkel',
    ],
    amenities: [
      'Nachos con salsa',
      'Frutas tropicales',
      'Open Bar: cerveza, hielo, agua, refrescos, mamajuana, ron y jugos',
    ],
    rules: [
      'Capacidad estándar 10 personas (máximo 20; $80 usd por persona adicional)',
      '3 horas $1,350 usd / 4 horas $1,550 usd (hora extra $200 usd)',
      'El cliente puede traer su propia bebida a bordo',
    ],
    available: true,
    featured: false,
  },
  {
    name: 'Rinker 26',
    slug: 'rinker-26',
    short_description: 'Yate íntimo Rinker 26 para 6 personas, ideal para grupos pequeños en Punta Cana.',
    description: 'Yate Rinker 26 con capacidad para 6 personas, con salida desde Punta Cana. Incluye yate y gasolina, capitán, transporte privado de ida y vuelta desde tu hotel o villa, equipo de snorkel, nachos con salsa, hielo, 12 aguas, 12 refrescos y 12 cervezas. Visita el delfinario para ver a los delfines desde el exterior, además de las piscinas naturales y la zona de snorkel. El cliente puede traer su propia bebida a bordo. Precio: $800 usd por 3 horas o $900 usd por 4 horas.',
    location: 'Punta Cana',
    capacity: 6,
    length_ft: 26,
    year: null,
    brand: 'Rinker',
    price_per_day: 800,
    images: [
      '/assets/img/RINKER 26/RINKER 26 PORTADA.jpeg',
      '/assets/img/RINKER 26/WhatsApp Image 2026-07-25 at 10.26.30 PM.jpeg',
      '/assets/img/RINKER 26/WhatsApp Image 2026-07-25 at 10.26.31 PM.jpeg',
      '/assets/img/RINKER 26/WhatsApp Image 2026-07-25 at 10.26.31 PM (1).jpeg',
      '/assets/img/RINKER 26/WhatsApp Image 2026-07-25 at 10.26.31 PM (2).jpeg',
      '/assets/img/RINKER 26/WhatsApp Image 2026-07-25 at 10.26.31 PM (3).jpeg',
      '/assets/img/RINKER 26/WhatsApp Image 2026-07-25 at 10.26.32 PM (1).jpeg',
      '/assets/img/RINKER 26/WhatsApp Image 2026-07-25 at 10.26.32 PM (2).jpeg',
      '/assets/img/RINKER 26/WhatsApp Image 2026-07-25 at 10.26.32 PM (3).jpeg',
      '/assets/img/RINKER 26/WhatsApp Image 2026-07-25 at 10.26.32 PM (4).jpeg',
      '/assets/img/RINKER 26/WhatsApp Image 2026-07-25 at 10.26.33 PM.jpeg',
      '/assets/img/RINKER 26/WhatsApp Image 2026-07-25 at 10.26.33 PM (1).jpeg',
      '/assets/img/RINKER 26/WhatsApp Image 2026-07-25 at 10.26.33 PM (2).jpeg',
      '/assets/img/RINKER 26/WhatsApp Image 2026-07-25 at 10.26.33 PM (3).jpeg',
      '/assets/img/RINKER 26/WhatsApp Image 2026-07-25 at 10.26.34 PM (1).jpeg',
      '/assets/img/RINKER 26/WhatsApp Image 2026-07-25 at 10.26.34 PM (2).jpeg',
    ],
    features: [
      'Yate y gasolina incluidos',
      'Capitán',
      'Transporte privado de ida y vuelta desde tu hotel o villa',
      'Equipo de snorkel',
    ],
    amenities: ['Nachos con salsa', 'Hielo, 12 aguas, 12 refrescos y 12 cervezas'],
    rules: [
      'Máximo 6 personas',
      '3 horas $800 usd / 4 horas $900 usd',
      'El cliente puede traer su propia bebida a bordo',
    ],
    available: true,
    featured: false,
  },
  {
    name: 'Sea Ray 45',
    slug: 'sea-ray-45',
    short_description: 'Yate premium Sea Ray 45 para 12 personas con snorkel y open bar en Punta Cana.',
    description: 'Yate Sea Ray 45 con capacidad para 12 personas, con salida desde Punta Cana. Incluye yate y gasolina, capitán y marino, equipos de esnórquel, transporte privado de ida y vuelta desde tu hotel o villa, nachos con salsa, hielo, aguas, refrescos y 2 litros de cerveza. Visita las piscinas naturales de Punta Cana y la zona de esnórquel. El cliente puede traer su propia bebida a bordo. Precio: $1,250 usd por 3 horas o $1,450 usd por 4 horas.',
    location: 'Punta Cana',
    capacity: 12,
    length_ft: 45,
    year: null,
    brand: 'Sea Ray',
    price_per_day: 1250,
    images: [
      '/assets/img/SEARAY 45/SEA RAY 45 PORTADA.jpeg',
      '/assets/img/SEARAY 45/SEA RAY 45 (1).jpeg',
      '/assets/img/SEARAY 45/SEA RAY 45 (2).jpeg',
      '/assets/img/SEARAY 45/SEA RAY 45 (3).jpeg',
      '/assets/img/SEARAY 45/SEA RAY 45 (4).jpeg',
      '/assets/img/SEARAY 45/SEA RAY 45 (5).jpeg',
      '/assets/img/SEARAY 45/SEA RAY 45 (6).jpeg',
      '/assets/img/SEARAY 45/SEA RAY 45 (7).jpeg',
      '/assets/img/SEARAY 45/SEA RAY 45 (8).jpeg',
      '/assets/img/SEARAY 45/SEA RAY 45 (10).jpeg',
    ],
    features: [
      'Yate y gasolina incluidos',
      'Capitán y marino',
      'Equipos de esnórquel',
      'Transporte privado de ida y vuelta desde tu hotel o villa',
    ],
    amenities: ['Nachos con salsa', 'Hielo, aguas, refrescos y 2 litros de cerveza'],
    rules: [
      'Máximo 12 personas',
      '3 horas $1,250 usd / 4 horas $1,450 usd',
      'El cliente puede traer su propia bebida a bordo',
    ],
    available: true,
    featured: false,
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
      b.available, b.featured,
    ];

    if (existing) {
      await db.run(
        `UPDATE boats SET name=$1, description=$3, short_description=$4, location=$5, capacity=$6,
         length_ft=$7, year=$8, brand=$9, price_per_day=$10, images=$11, features=$12, amenities=$13,
         rules=$14, available=$15, featured=$16 WHERE slug=$2`,
        params
      );
      console.log(`Actualizado: ${b.name} (${b.slug})`);
    } else {
      await db.run(
        `INSERT INTO boats (name,slug,description,short_description,location,capacity,length_ft,year,brand,price_per_day,images,features,amenities,rules,available,featured)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
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
