// Asigna el esquema de precio por paquete de horas a las embarcaciones fuera
// de Boca Chica que lo tienen (renta por 3h/4h, hora extra, cargo por persona
// adicional, extras de comida). Las que no aparecen aquí (Catamarán 36, La
// Santa, Nicole, Yate 1, Yate 2) siguen con precio fijo por día sin cambios.

require('dotenv').config();
const { init, pool } = require('./database');

const schemes = {
  'catamaran-36': {
    type: 'hourly',
    packages: [
      { hours: 4, price: 1950 },
    ],
  },
  'rinker-26': {
    type: 'hourly',
    packages: [
      { hours: 3, price: 800 },
      { hours: 4, price: 900 },
    ],
  },
  'sea-ray-45': {
    type: 'hourly',
    packages: [
      { hours: 3, price: 1250 },
      { hours: 4, price: 1450 },
    ],
  },
  'princess-50': {
    type: 'hourly',
    packages: [
      { hours: 3, price: 1350 },
      { hours: 4, price: 1550 },
    ],
    extra_hour_price: 200,
    overage_threshold: 10,
    overage_price_per_person: 80,
    max_capacity: 20,
  },
  'catamaran-con-tobogan': {
    type: 'hourly',
    packages: [
      { hours: 3, price: 1050 },
    ],
    extra_hour_price: 200,
    time_slots: [
      '8:30 am – 11:30 am',
      '11:30 am – 2:30 pm',
      '2:30 pm – 5:30 pm',
    ],
    meal_addons: [
      { key: 'almuerzo', name: 'Almuerzo dominicano (buffet)', price: 15, per_person: true },
      { key: 'hamburguesas', name: 'Hamburguesas', price: 15, per_person: true },
      { key: 'hamburguesas_pollo', name: 'Hamburguesas y pollo', price: 20, per_person: true },
      { key: 'langostas', name: 'Langostas', price: 35, per_person: true },
    ],
  },
};

async function run() {
  const db = await init();
  for (const [slug, scheme] of Object.entries(schemes)) {
    await db.run('UPDATE boats SET pricing_scheme = $1 WHERE slug = $2', [JSON.stringify(scheme), slug]);
    console.log('Esquema asignado:', slug);
  }
  console.log('Listo.');
  await pool.end();
}

run().catch((e) => { console.error('Error:', e.message); process.exit(1); });
