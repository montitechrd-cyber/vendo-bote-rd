require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const db = {
  async query(sql, params = []) {
    const r = await pool.query(sql, params);
    return r.rows;
  },
  async queryOne(sql, params = []) {
    const r = await pool.query(sql, params);
    return r.rows[0];
  },
  async run(sql, params = []) {
    const r = await pool.query(sql, params);
    return { lastInsertRowid: r.rows[0]?.id ?? null, rowCount: r.rowCount };
  },
};

async function createTables() {
  // Migrations for existing tables
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS schedule TEXT DEFAULT 'full-day'`).catch(() => {});
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_id TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`).catch(() => {});
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_clerk_id_idx ON users(clerk_id) WHERE clerk_id IS NOT NULL`).catch(() => {});
  // For-sale columns (added post-launch)
  await pool.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS for_sale BOOLEAN DEFAULT FALSE`).catch(() => {});
  await pool.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS sale_price REAL`).catch(() => {});
  await pool.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS sale_description TEXT`).catch(() => {});
  // Esquema de precio por paquete de horas (renta fuera de Boca Chica: 3h/4h, hora extra, cargo por persona extra, extras de comida)
  await pool.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS pricing_scheme TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_meta TEXT`).catch(() => {});
  // Evita doble reserva del mismo turno a nivel de base de datos (la validación en la ruta
  // es check-then-insert y por sí sola no cierra la carrera entre dos solicitudes simultáneas).
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS bookings_slot_unique_idx ON bookings(boat_id, start_date, schedule) WHERE status IN ('confirmed','pending')`).catch(() => {});
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      phone TEXT,
      role TEXT DEFAULT 'user',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS boats (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      short_description TEXT,
      location TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      length_ft INTEGER,
      year INTEGER,
      brand TEXT,
      price_per_day REAL NOT NULL,
      images TEXT DEFAULT '[]',
      features TEXT DEFAULT '[]',
      amenities TEXT DEFAULT '[]',
      rules TEXT DEFAULT '[]',
      available BOOLEAN DEFAULT TRUE,
      featured BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      booking_ref TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      boat_id INTEGER NOT NULL REFERENCES boats(id),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      days INTEGER NOT NULL,
      guests INTEGER DEFAULT 1,
      total_price REAL NOT NULL,
      additionals TEXT DEFAULT '[]',
      additionals_price REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      payment_status TEXT DEFAULT 'pending',
      special_requests TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      booking_id INTEGER NOT NULL REFERENCES bookings(id),
      amount REAL NOT NULL,
      bank_name TEXT,
      account_holder TEXT,
      reference_number TEXT,
      receipt_filename TEXT,
      status TEXT DEFAULT 'pending',
      verified_by INTEGER,
      verified_at TIMESTAMPTZ,
      rejection_reason TEXT,
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      booking_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      boat_id INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

async function seedData() {
  // La autenticación es 100% Clerk (ver middleware/auth.js) — el primer admin se
  // designa asignando role:"admin" en publicMetadata desde el dashboard de Clerk,
  // no sembrando una cuenta con contraseña local.

  const count = await db.queryOne('SELECT COUNT(*) as c FROM boats');
  if (parseInt(count.c) > 0) return;

  await db.run(
    `INSERT INTO boats (name,slug,description,short_description,location,capacity,length_ft,year,brand,price_per_day,images,features,amenities,rules,available,featured)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      'Lancha Gober', 'lancha-gober',
      'La renta incluye 6 horas a bordo de la Lancha Gober: salida desde Boca Chica, un recorrido completo por la playa y anclaje para que disfrutes nadando en las tranquilas aguas de Boca Chica con toda tu familia o grupo. Una experiencia completa en el mar dominicano.',
      'Lancha premium para disfrutar la playa de Boca Chica, anclados en sus aguas tranquilas en familia o grupo.',
      'Boca Chica', 15, 32, 2022, 'Gober Marine', 850,
      JSON.stringify(['/assets/img/GOBER/GOBER (6).jpeg','/assets/img/GOBER/GOBER (1).jpeg','/assets/img/GOBER/GOBER (2).jpeg','/assets/img/GOBER/GOBER (3).jpeg','/assets/img/GOBER/GOBER (4).jpeg','/assets/img/GOBER/GOBER (5).jpeg','/assets/img/GOBER/GOBER (7).jpeg','/assets/img/GOBER/GOBER (8).jpeg','/assets/img/GOBER/GOBER (9).jpeg']),
      JSON.stringify(['Motor potente','Cubierta abierta','Toldo de sol','Nevera a bordo','Sistema de sonido','GPS marino','Equipo de seguridad']),
      JSON.stringify(['Refrigerio','Hielo','Cervezas','Agua','1 hora de Jet Ski']),
      JSON.stringify(['Máximo 15 personas','No fumar a bordo','Chalecos obligatorios para menores','Respetar horarios de salida']),
      true, true,
    ]
  );

  await db.run(
    `INSERT INTO boats (name,slug,description,short_description,location,capacity,length_ft,year,brand,price_per_day,images,features,amenities,rules,available,featured)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      'Sea Ray Sundancer', 'sea-ray-sundancer',
      'Experimenta el lujo en el mar a bordo de la Sea Ray Sundancer. Esta embarcación de alto rendimiento combina elegancia y potencia para ofrecerte una experiencia náutica premium anclada en las playas de Boca Chica.',
      'Lancha de lujo con cabina, perfecta para disfrutar anclados en las playas de Boca Chica.',
      'Boca Chica', 8, 31, 2021, 'Sea Ray', 1200,
      JSON.stringify(['/assets/img/SEARAY/SEARAY (1).png','/assets/img/SEARAY/SEARAY (2).png','/assets/img/SEARAY/SEARAY (3).png','/assets/img/SEARAY/SEARAY (4).png','/assets/img/SEARAY/SEARAY (5).png']),
      JSON.stringify(['Motor de alto rendimiento','Cabina con climatización','Cubierta de sol','Nevera a bordo','Sistema de sonido premium','GPS marino','Equipo de seguridad completo','Zona de baño a popa']),
      JSON.stringify(['Refrigerio','Hielo','Bebidas','Agua','Toallas a bordo']),
      JSON.stringify(['Máximo 8 personas','No fumar a bordo','Chalecos obligatorios para menores','Respetar horarios de salida','No mascotas']),
      true, true,
    ]
  );
}

async function init() {
  await createTables();
  await seedData();
  console.log('  Base de datos PostgreSQL lista.');
  return db;
}

function getDB() { return db; }

module.exports = { init, getDB, pool };
