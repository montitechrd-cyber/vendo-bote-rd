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
  // Datos de perfil que la plataforma pide aparte de Clerk (nombre/apellido reales,
  // teléfono, foto de cédula/pasaporte opcional) — ver routes/auth.js complete-profile.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT`).catch(() => {});
  // Restablecer / crear contraseña por correo (se guarda solo el hash del token)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMPTZ`).catch(() => {});
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS id_document_filename TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN DEFAULT FALSE`).catch(() => {});
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
  // La autenticación es propia (ver middleware/auth.js y routes/auth.js). El administrador
  // es el usuario cuyo correo coincide con ADMIN_EMAIL: se marca aquí en cada arranque y
  // crea su contraseña con "Olvidé mi contraseña" (nunca se siembra una contraseña local).
  const adminEmail = (process.env.ADMIN_EMAIL || 'montitechrd@gmail.com').toLowerCase();
  await pool.query("UPDATE users SET role = 'admin' WHERE lower(email) = $1", [adminEmail]);

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

// Migraciones de datos de una sola vez: cada una se aplica exactamente una vez contra
// la base real (Railway/Supabase), sin importar cuántas veces reinicie el servidor,
// para no pisar cambios de precio/ubicación que el admin haga después a mano.
async function runDataMigrationOnce(name, fn) {
  await pool.query(`CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())`);
  const already = await pool.query('SELECT 1 FROM migrations WHERE name = $1', [name]);
  if (already.rowCount) return;
  await fn();
  await pool.query('INSERT INTO migrations (name) VALUES ($1)', [name]);
  console.log('Migración de datos aplicada:', name);
}

// Boca Chica pasa de cotizar por extras a la carta (jet ski, parrillada, decoración,
// buffet) a un precio fijo todo incluido: 1h de Jet Ski, parrillada, agua, hielo,
// gasolina, tripulación y cocinero. Precios: Lupita $750, Elite $900, resto $1500.
// Elite y Lupita quedan marcadas como Boca Chica (la ubicación estaba desactualizada).
async function migrateBocaChicaPricing() {
  const STANDARD_INCLUSIONS = ['1 hora de Jet Ski', 'Parrillada', 'Agua', 'Hielo', 'Gasolina', 'Tripulación', 'Cocinero'];

  await pool.query(`UPDATE boats SET location = 'Boca Chica' WHERE slug IN ('elite','lupita')`);
  await pool.query(`UPDATE boats SET price_per_day = 750 WHERE slug = 'lupita'`);
  await pool.query(`UPDATE boats SET price_per_day = 900 WHERE slug = 'elite'`);
  await pool.query(`UPDATE boats SET price_per_day = 1500 WHERE location = 'Boca Chica' AND slug NOT IN ('elite','lupita')`);
  await pool.query(`UPDATE boats SET description = REPLACE(description, '$700 usd', '$750 usd') WHERE slug = 'lupita'`);

  const { rows: bocaChicaBoats } = await pool.query(`SELECT id, amenities FROM boats WHERE location = 'Boca Chica'`);
  for (const boat of bocaChicaBoats) {
    const current = JSON.parse(boat.amenities || '[]');
    const merged = [...current];
    STANDARD_INCLUSIONS.forEach(item => { if (!merged.includes(item)) merged.push(item); });
    await pool.query('UPDATE boats SET amenities = $1 WHERE id = $2', [JSON.stringify(merged), boat.id]);
  }
}

// Pone como primera foto (portada) del catálogo la que el dueño eligió para
// Perla Negra y Yate 3. Busca por nombre porque estos botes se cargaron desde
// el panel de administración y no existen en ningún script de siembra.
async function migrateBoatCoverPhotos() {
  const covers = [
    { nameLike: '%Perla Negra%', coverPath: '/assets/img/RENTAS/perla negra/foto-4.jpeg' },
    { nameLike: '%Yate 3%', coverPath: '/assets/img/RENTAS/yate 3/portada.jpg' },
  ];

  for (const { nameLike, coverPath } of covers) {
    const { rows } = await pool.query('SELECT id, images FROM boats WHERE name ILIKE $1', [nameLike]);
    for (const boat of rows) {
      const current = JSON.parse(boat.images || '[]');
      const reordered = [coverPath, ...current.filter(img => img !== coverPath)];
      await pool.query('UPDATE boats SET images = $1 WHERE id = $2', [JSON.stringify(reordered), boat.id]);
    }
  }
}

// La foto de portada de Perla Negra se renombró (foto-4.jpeg -> portada perla negra.jpeg)
// y la ruta vieja quedó rota en la base. Reemplaza la ruta rota y la deja como portada.
async function migratePerlaNegraCoverRename() {
  const oldPath = '/assets/img/RENTAS/perla negra/foto-4.jpeg';
  const newPath = '/assets/img/RENTAS/perla negra/portada perla negra.jpeg';
  const { rows } = await pool.query("SELECT id, images FROM boats WHERE name ILIKE '%Perla Negra%'");
  for (const boat of rows) {
    const current = JSON.parse(boat.images || '[]');
    const reordered = [newPath, ...current.filter(img => img !== oldPath && img !== newPath)];
    await pool.query('UPDATE boats SET images = $1 WHERE id = $2', [JSON.stringify(reordered), boat.id]);
  }
}

// Precios por día de la semana y combo de cumpleaños (tabla del dueño, 2026-10-12).
// Se busca por nombre porque varias de estas embarcaciones se cargaron desde el panel.
async function migrateDayBasedPricing() {
  const COMBO = ['1 hora de jetski', 'Decoración', 'Bizcocho', 'Parrillada', 'Agua', 'Hielo', 'Refresco'];
  const boats = [
    { like: '%Lupita%',         weekday: 500, weekday_birthday: 650,  weekend: 550, weekend_birthday: 750,  capacity: 15 },
    { like: '%Perla Negra%',    weekday: 700, weekday_birthday: 1100, weekend: 750, weekend_birthday: 1000, capacity: 12 },
    { like: '%Refugio Marino%', weekday: 700, weekday_birthday: 1000, weekend: 800, weekend_birthday: 1200, capacity: 25 },
    { like: '%Elite%',          weekday: 800, weekday_birthday: 1000, weekend: 900, weekend_birthday: 1200, capacity: 20 },
  ];
  for (const b of boats) {
    const scheme = {
      type: 'day_based',
      prices: { weekday: b.weekday, weekday_birthday: b.weekday_birthday, weekend: b.weekend, weekend_birthday: b.weekend_birthday },
      birthday_combo: COMBO,
    };
    await pool.query(
      "UPDATE boats SET pricing_scheme = $1, price_per_day = $2, capacity = $3, location = 'Boca Chica' WHERE name ILIKE $4",
      [JSON.stringify(scheme), b.weekday, b.capacity, b.like]
    );
  }
}

// Los textos de Lupita, Elite, Perla Negra y Refugio Marino tenían capacidad y precios viejos
// (o la plantilla "PENDIENTE"). Se reescriben acordes a la tabla de precios por día.
async function migrateDayBasedCopy() {
  const boats = [
    { like: '%Lupita%', type: 'lancha', name: 'Lupita', capacity: 15 },
    { like: '%Perla Negra%', type: 'yate', name: 'Perla Negra', capacity: 12 },
    { like: '%Refugio Marino%', type: 'bote', name: 'Refugio Marino', capacity: 25 },
    { like: '%Elite%', type: 'yate', name: 'Elite', capacity: 20 },
  ];
  const amenities = ['1 hora de Jet Ski', 'Parrillada', 'Agua', 'Hielo', 'Gasolina', 'Tripulación', 'Cocinero'];
  for (const b of boats) {
    const short = `${b.type[0].toUpperCase()}${b.type.slice(1)} ${b.name} en Boca Chica para hasta ${b.capacity} personas.`;
    const desc = `Renta del ${b.type} ${b.name} en Boca Chica, con capacidad para ${b.capacity} personas. Incluye 1 hora de Jet Ski, parrillada, agua, hielo, gasolina, tripulación y cocinero. El precio varía según el día de la semana, y puedes agregar el combo de cumpleaños (1 hora de jetski, decoración, bizcocho, parrillada, agua, hielo y refresco).`;
    const rules = [`Máximo ${b.capacity} personas`];
    await pool.query(
      'UPDATE boats SET short_description = $1, description = $2, rules = $3, amenities = $4 WHERE name ILIKE $5',
      [short, desc, JSON.stringify(rules), JSON.stringify(amenities), b.like]
    );
  }
}

// Servicio normal (sin combo) NO incluye la hora de jetski; el combo de cumpleaños sí.
// Se guarda en el esquema lo que incluye el servicio normal y se ajustan descripción y amenidades.
async function migrateDayBasedIncluded() {
  const included = ['Parrillada', 'Agua', 'Hielo', 'Gasolina', 'Tripulación', 'Cocinero'];
  const { rows } = await pool.query("SELECT id, pricing_scheme FROM boats WHERE pricing_scheme LIKE '%day_based%'");
  for (const boat of rows) {
    const scheme = JSON.parse(boat.pricing_scheme);
    scheme.included = included;
    const { rows: [b] } = await pool.query('SELECT name, capacity FROM boats WHERE id = $1', [boat.id]);
    const desc = `Renta de ${b.name} en Boca Chica, con capacidad para ${b.capacity} personas. El servicio normal incluye parrillada, agua, hielo, gasolina, tripulación y cocinero. El precio varía según el día de la semana. Con el combo de cumpleaños se agrega 1 hora de jetski, decoración, bizcocho y refresco.`;
    await pool.query('UPDATE boats SET pricing_scheme = $1, amenities = $2, description = $3 WHERE id = $4',
      [JSON.stringify(scheme), JSON.stringify(included), desc, boat.id]);
  }
}

// "Yate 1" (La Romana) pasa a llamarse Azimut Nona. Las fotos conservan su ruta.
async function migrateRenameYate1() {
  await pool.query(
    `UPDATE boats SET name = 'Azimut Nona', slug = 'azimut-nona',
       short_description = 'Yate Azimut Nona para paseos privados en La Romana.'
     WHERE slug = 'yate-1-la-romana'`
  );
}

// "Yate 3" pasa a llamarse Andrea del Mar. Las fotos conservan su ruta.
async function migrateRenameYate3() {
  await pool.query("UPDATE boats SET name = 'Andrea del Mar', slug = 'andrea-del-mar' WHERE slug = 'yate-3'");
}

// Azimut Nona: precio $5,000 por día (antes figuraba $2,500 como Yate 1).
async function migrateAzimutNonaPrice() {
  await pool.query(
    `UPDATE boats SET price_per_day = 5000,
       description = $1, rules = $2
     WHERE slug = 'azimut-nona'`,
    [
      'Renta del yate Azimut Nona con salida desde La Romana. Precio: $5,000 usd por día. Capacidad estimada en 15 personas — pendiente confirmar el detalle exacto de inclusiones.',
      JSON.stringify(['Precio: $5,000 usd por día', 'Capacidad estimada: 15 personas (pendiente de confirmar)']),
    ]
  );
}

// Quita de las galerías las rutas locales a archivos que ya no existen (ej. fotos borradas
// al reemplazarlas), para que no salgan fotos rotas.
async function migrateRemoveBrokenImagePaths() {
  const fsx = require('fs');
  const pathx = require('path');
  const { rows } = await pool.query('SELECT id, name, images FROM boats');
  for (const boat of rows) {
    const current = JSON.parse(boat.images || '[]');
    const kept = current.filter(p => !String(p).startsWith('/assets/') || fsx.existsSync(pathx.join(__dirname, 'public', p)));
    if (kept.length !== current.length) {
      console.log('  [imágenes] ' + boat.name + ': se quitaron ' + (current.length - kept.length) + ' ruta(s) rota(s)');
      await pool.query('UPDATE boats SET images = $1 WHERE id = $2', [JSON.stringify(kept), boat.id]);
    }
  }
}

// Todas las embarcaciones de Boca Chica quedan destacadas (se muestran en la home).
async function migrateFeatureBocaChica() {
  await pool.query("UPDATE boats SET featured = true WHERE location = 'Boca Chica' AND for_sale = false");
}

async function init() {
  await createTables();
  await seedData();
  await runDataMigrationOnce('2026-09-28-boca-chica-pricing', migrateBocaChicaPricing);
  await runDataMigrationOnce('2026-09-28-boat-cover-photos', migrateBoatCoverPhotos);
  await runDataMigrationOnce('2026-10-12-perla-negra-cover-rename', migratePerlaNegraCoverRename);
  await runDataMigrationOnce('2026-10-12-day-based-pricing', migrateDayBasedPricing);
  await runDataMigrationOnce('2026-10-12-day-based-copy', migrateDayBasedCopy);
  await runDataMigrationOnce('2026-10-12-day-based-included', migrateDayBasedIncluded);
  await runDataMigrationOnce('2026-10-13-rename-yate-1', migrateRenameYate1);
  await runDataMigrationOnce('2026-10-13-rename-yate-3', migrateRenameYate3);
  await runDataMigrationOnce('2026-10-13-azimut-nona-price', migrateAzimutNonaPrice);
  await runDataMigrationOnce('2026-10-13-remove-broken-image-paths', migrateRemoveBrokenImagePaths);
  await runDataMigrationOnce('2026-10-13-feature-boca-chica', migrateFeatureBocaChica);
  console.log('  Base de datos PostgreSQL lista.');
  return db;
}

function getDB() { return db; }

module.exports = { init, getDB, pool };
