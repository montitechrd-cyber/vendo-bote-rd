const express = require('express');
const { getDB } = require('../database');
const { adminRequired } = require('../middleware/auth');

const router = express.Router();

function parseBoat(boat) {
  if (!boat) return null;
  return {
    ...boat,
    images:   JSON.parse(boat.images   || '[]'),
    features: JSON.parse(boat.features || '[]'),
    amenities:JSON.parse(boat.amenities|| '[]'),
    rules:    JSON.parse(boat.rules    || '[]'),
    available: Boolean(boat.available),
    featured:  Boolean(boat.featured),
    pricing_scheme: boat.pricing_scheme ? JSON.parse(boat.pricing_scheme) : null,
  };
}

router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const { location, capacity, min_price, max_price, search } = req.query;
    let sql = 'SELECT * FROM boats WHERE available = true';
    const params = [];
    let i = 1;

    if (location)   { sql += ` AND location = $${i++}`;                                        params.push(location); }
    if (capacity)   { sql += ` AND capacity >= $${i++}`;                                       params.push(parseInt(capacity)); }
    if (min_price)  { sql += ` AND price_per_day >= $${i++}`;                                  params.push(parseFloat(min_price)); }
    if (max_price)  { sql += ` AND price_per_day <= $${i++}`;                                  params.push(parseFloat(max_price)); }
    if (search)     { sql += ` AND (name ILIKE $${i} OR description ILIKE $${i} OR brand ILIKE $${i})`; params.push(`%${search}%`); i++; }

    sql += ' ORDER BY featured DESC, created_at DESC';
    const boats = await db.query(sql, params);
    res.json(boats.map(parseBoat));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener embarcaciones' });
  }
});

router.get('/featured', async (req, res) => {
  try {
    const db = getDB();
    const boats = await db.query('SELECT * FROM boats WHERE featured = true AND available = true ORDER BY price_per_day DESC LIMIT 6');
    res.json(boats.map(parseBoat));
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.get('/locations', async (req, res) => {
  try {
    const db = getDB();
    const locs = await db.query('SELECT DISTINCT location, COUNT(*) as count FROM boats WHERE available = true GROUP BY location');
    res.json(locs);
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.get('/for-sale', async (req, res) => {
  try {
    const db = getDB();
    const boats = await db.query('SELECT * FROM boats WHERE for_sale = true ORDER BY sale_price ASC');
    res.json(boats.map(b => ({ ...parseBoat(b), for_sale: true })));
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.get('/admin/all', adminRequired, async (req, res) => {
  try {
    const db = getDB();
    const boats = await db.query('SELECT * FROM boats ORDER BY created_at DESC');
    res.json(boats.map(parseBoat));
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.post('/', adminRequired, async (req, res) => {
  try {
    const db = getDB();
    const { name, slug, description, short_description, location, capacity, length_ft, year, brand, price_per_day, images, features, amenities, rules, available, featured } = req.body;
    if (!name || !slug || !location || !capacity || !price_per_day) return res.status(400).json({ error: 'Campos requeridos faltantes' });

    const result = await db.run(
      `INSERT INTO boats (name,slug,description,short_description,location,capacity,length_ft,year,brand,price_per_day,images,features,amenities,rules,available,featured)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [name, slug, description, short_description, location, capacity, length_ft || null, year || null, brand,
       price_per_day, JSON.stringify(images||[]), JSON.stringify(features||[]), JSON.stringify(amenities||[]),
       JSON.stringify(rules||[]), available ?? true, featured ?? false]
    );
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al crear embarcación' });
  }
});

router.put('/:id', adminRequired, async (req, res) => {
  try {
    const db = getDB();
    const { name, description, short_description, location, capacity, length_ft, year, brand, price_per_day, images, features, amenities, rules, available, featured } = req.body;
    await db.run(
      `UPDATE boats SET name=$1,description=$2,short_description=$3,location=$4,capacity=$5,length_ft=$6,year=$7,
       brand=$8,price_per_day=$9,images=$10,features=$11,amenities=$12,rules=$13,available=$14,featured=$15 WHERE id=$16`,
      [name, description, short_description, location, capacity, length_ft||null, year||null, brand, price_per_day,
       JSON.stringify(images||[]), JSON.stringify(features||[]), JSON.stringify(amenities||[]),
       JSON.stringify(rules||[]), available ?? true, featured ?? false, req.params.id]
    );
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al actualizar embarcación' });
  }
});

router.delete('/:id', adminRequired, async (req, res) => {
  try {
    const db = getDB();
    await db.run('UPDATE boats SET available = false WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.get('/:slug', async (req, res) => {
  try {
    const db = getDB();
    const boat = await db.queryOne('SELECT * FROM boats WHERE slug = $1', [req.params.slug]);
    if (!boat) return res.status(404).json({ error: 'Embarcación no encontrada' });

    const reviews = await db.query(
      `SELECT r.*, u.name as user_name FROM reviews r JOIN users u ON r.user_id = u.id WHERE r.boat_id = $1 ORDER BY r.created_at DESC`,
      [boat.id]
    );
    const avgRating = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : null;
    res.json({ ...parseBoat(boat), reviews, avg_rating: avgRating, review_count: reviews.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.get('/:id/availability', async (req, res) => {
  try {
    const db = getDB();
    const idNum = parseInt(req.params.id);
    const boat = !isNaN(idNum)
      ? await db.queryOne('SELECT id FROM boats WHERE id = $1', [idNum])
      : await db.queryOne('SELECT id FROM boats WHERE slug = $1', [req.params.id]);
    if (!boat) return res.status(404).json({ error: 'No encontrado' });

    const { year, month } = req.query;
    let sql = `SELECT start_date, schedule FROM bookings WHERE boat_id = $1 AND status IN ('confirmed','pending')`;
    const params = [boat.id];

    if (year && month) {
      sql += ` AND EXTRACT(YEAR FROM start_date::date) = $2 AND EXTRACT(MONTH FROM start_date::date) = $3`;
      params.push(parseInt(year), parseInt(month));
    }
    sql += ' ORDER BY start_date ASC';

    const bookings = await db.query(sql, params);
    res.json(bookings);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
