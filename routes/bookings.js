const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../database');
const { authRequired, adminRequired } = require('../middleware/auth');
const email = require('../utils/email');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads/receipts'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `receipt_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg','.jpeg','.png','.pdf','.webp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  }
});

function generateRef() {
  return 'VBR-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
}

const ADDITIONALS_PRICES = { decoracion: 100, parrillada: 150, buffet: 300, jetski: 200 };

function isWeekday(dateStr) {
  const day = new Date(dateStr + 'T00:00:00').getDay(); // 0=Dom .. 6=Sáb
  return day >= 1 && day <= 5;
}

router.post('/', authRequired, async (req, res) => {
  try {
    const db = getDB();
    const { boat_id, start_date, schedule, guests, additionals, package_hours, extra_hours, meal_addons } = req.body;
    let { special_requests } = req.body;
    if (!boat_id || !start_date || !schedule) return res.status(400).json({ error: 'Datos de reserva incompletos' });
    if (special_requests != null) {
      special_requests = String(special_requests).slice(0, 500);
    }

    const boatRow = await db.queryOne('SELECT * FROM boats WHERE id = $1 AND available = true', [boat_id]);
    if (!boatRow) return res.status(404).json({ error: 'Embarcación no disponible' });
    const scheme = boatRow.pricing_scheme ? JSON.parse(boatRow.pricing_scheme) : null;

    // El turno válido depende del esquema de la embarcación
    const validSchedules = scheme?.time_slots?.length ? scheme.time_slots : (scheme ? ['full-day'] : ['9am-3pm', '4pm-10pm']);
    if (!validSchedules.includes(schedule)) return res.status(400).json({ error: 'Turno inválido' });

    const maxCapacity = scheme?.max_capacity || boatRow.capacity;
    const guestsNum = parseInt(guests) || 1;
    if (guestsNum > maxCapacity) return res.status(400).json({ error: `Máximo ${maxCapacity} personas` });

    const start = new Date(start_date + 'T00:00:00');
    const today = new Date(); today.setHours(0,0,0,0);
    if (start < today) return res.status(400).json({ error: 'La fecha debe ser futura' });

    const conflict = await db.queryOne(
      `SELECT id FROM bookings WHERE boat_id = $1 AND status IN ('confirmed','pending') AND start_date = $2 AND schedule = $3`,
      [boat_id, start_date, schedule]
    );
    if (conflict) return res.status(409).json({ error: 'Ese turno ya está reservado' });

    let total = 0;
    let selectedAdditionals = [];
    let additionals_price = 0;
    const metaParts = [];

    if (scheme) {
      const pkg = (scheme.packages || []).find(p => p.hours === Number(package_hours)) || scheme.packages?.[0];
      if (!pkg) return res.status(400).json({ error: 'Paquete de horas inválido' });
      total += pkg.price;
      metaParts.push(`Paquete ${pkg.hours}h: $${pkg.price}`);

      const extraH = scheme.extra_hour_price ? Math.max(0, parseInt(extra_hours) || 0) : 0;
      if (extraH > 0) {
        const amt = extraH * scheme.extra_hour_price;
        total += amt;
        selectedAdditionals.push('extra_hours');
        additionals_price += amt;
        metaParts.push(`${extraH}h extra: +$${amt}`);
      }

      if (scheme.overage_threshold && guestsNum > scheme.overage_threshold) {
        const overN = guestsNum - scheme.overage_threshold;
        const amt = overN * scheme.overage_price_per_person;
        total += amt;
        selectedAdditionals.push('overage_guests');
        additionals_price += amt;
        metaParts.push(`${overN} persona(s) extra: +$${amt}`);
      }

      if (Array.isArray(meal_addons) && scheme.meal_addons?.length) {
        meal_addons.forEach(key => {
          const m = scheme.meal_addons.find(x => x.key === key);
          if (!m) return;
          const amt = m.per_person ? m.price * guestsNum : m.price;
          total += amt;
          selectedAdditionals.push(m.key);
          additionals_price += amt;
          metaParts.push(`${m.name}: +$${amt}`);
        });
      }
    } else {
      total = boatRow.price_per_day;
      const freeJetski = boatRow.location === 'Boca Chica' && isWeekday(start_date);
      const rawAdditionals = Array.isArray(additionals) ? additionals.filter(a => ADDITIONALS_PRICES[a]) : [];
      rawAdditionals.forEach(key => {
        const price = (key === 'jetski' && freeJetski) ? 0 : ADDITIONALS_PRICES[key];
        additionals_price += price;
        selectedAdditionals.push(key);
        if (key === 'jetski' && freeJetski) metaParts.push('Jet Ski: gratis (lun–vie)');
      });
      total += additionals_price;
    }

    const ref = generateRef();
    const booking_meta = metaParts.length ? metaParts.join(' · ') : null;

    let result;
    try {
      result = await db.run(
        `INSERT INTO bookings (booking_ref,user_id,boat_id,start_date,end_date,days,guests,total_price,additionals,additionals_price,special_requests,schedule,booking_meta)
         VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [ref, req.user.id, boat_id, start_date, 1, guestsNum, total,
         JSON.stringify(selectedAdditionals), additionals_price, special_requests||null, schedule, booking_meta]
      );
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'Ese turno ya está reservado' });
      throw e;
    }

    const booking = await db.queryOne(
      `SELECT b.*, bt.name as boat_name, bt.location as boat_location FROM bookings b JOIN boats bt ON b.boat_id = bt.id WHERE b.id = $1`,
      [result.lastInsertRowid]
    );
    const user = await db.queryOne('SELECT name, email, phone FROM users WHERE id = $1', [req.user.id]);
    email.sendNewBookingAdmin(booking, user).catch(console.error);
    res.json(booking);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al crear reserva' });
  }
});

router.get('/my', authRequired, async (req, res) => {
  try {
    const db = getDB();
    const bookings = await db.query(
      `SELECT b.*, bt.name as boat_name, bt.slug as boat_slug, bt.location as boat_location,
              bt.images as boat_images, bt.price_per_day,
              p.status as payment_verified_status, p.receipt_filename, p.reference_number
       FROM bookings b
       JOIN boats bt ON b.boat_id = bt.id
       LEFT JOIN payments p ON p.booking_id = b.id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    res.json(bookings.map(b => ({ ...b, boat_images: JSON.parse(b.boat_images || '[]') })));
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.get('/admin/calendar-all', adminRequired, async (req, res) => {
  try {
    const db = getDB();
    const bookings = await db.query(
      `SELECT b.*, bt.name as boat_name, u.name as user_name, u.phone as user_phone
       FROM bookings b
       JOIN boats bt ON b.boat_id = bt.id
       JOIN users u ON b.user_id = u.id
       WHERE b.status != 'cancelled'
       ORDER BY b.boat_id, b.start_date ASC`
    );
    res.json(bookings);
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.get('/admin/calendar/:boatId', adminRequired, async (req, res) => {
  try {
    const db = getDB();
    const bookings = await db.query(
      `SELECT b.*, u.name as user_name, u.email as user_email, u.phone as user_phone
       FROM bookings b JOIN users u ON b.user_id = u.id
       WHERE b.boat_id = $1 AND b.status != 'cancelled'
       ORDER BY b.start_date ASC`,
      [req.params.boatId]
    );
    res.json(bookings);
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.get('/', adminRequired, async (req, res) => {
  try {
    const db = getDB();
    const { status, payment_status } = req.query;
    let sql = `SELECT b.*, bt.name as boat_name, bt.location as boat_location,
               u.name as user_name, u.email as user_email, u.phone as user_phone,
               p.status as pay_status, p.reference_number, p.receipt_filename, p.bank_name
               FROM bookings b
               JOIN boats bt ON b.boat_id = bt.id
               JOIN users u ON b.user_id = u.id
               LEFT JOIN payments p ON p.booking_id = b.id
               WHERE 1=1`;
    const params = [];
    let i = 1;
    if (status)         { sql += ` AND b.status = $${i++}`;          params.push(status); }
    if (payment_status) { sql += ` AND b.payment_status = $${i++}`;  params.push(payment_status); }
    sql += ' ORDER BY b.created_at DESC';
    res.json(await db.query(sql, params));
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    const db = getDB();
    const booking = await db.queryOne(
      `SELECT b.*, bt.name as boat_name, bt.slug as boat_slug, bt.location as boat_location,
              bt.images as boat_images, bt.brand, bt.length_ft, bt.capacity,
              u.name as user_name, u.email as user_email, u.phone as user_phone,
              p.status as pay_status, p.bank_name, p.account_holder, p.reference_number,
              p.receipt_filename, p.rejection_reason
       FROM bookings b
       JOIN boats bt ON b.boat_id = bt.id
       JOIN users u ON b.user_id = u.id
       LEFT JOIN payments p ON p.booking_id = b.id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (!booking) return res.status(404).json({ error: 'Reserva no encontrada' });
    if (booking.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });
    res.json({ ...booking, boat_images: JSON.parse(booking.boat_images || '[]') });
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Comprobante de pago: puede contener datos bancarios del cliente, así que nunca se
// sirve como archivo estático público — solo el dueño de la reserva o un admin pueden verlo.
router.get('/:id/receipt', authRequired, async (req, res) => {
  try {
    const db = getDB();
    const booking = await db.queryOne('SELECT user_id FROM bookings WHERE id = $1', [req.params.id]);
    if (!booking) return res.status(404).json({ error: 'Reserva no encontrada' });
    if (booking.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });

    const payment = await db.queryOne('SELECT receipt_filename FROM payments WHERE booking_id = $1', [req.params.id]);
    if (!payment?.receipt_filename) return res.status(404).json({ error: 'Sin comprobante' });

    res.sendFile(path.join(__dirname, '../uploads/receipts', payment.receipt_filename));
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.post('/:id/payment', authRequired, upload.single('receipt'), async (req, res) => {
  try {
    const db = getDB();
    const booking = await db.queryOne('SELECT * FROM bookings WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!booking) return res.status(404).json({ error: 'Reserva no encontrada' });
    if (booking.payment_status !== 'pending') return res.status(400).json({ error: 'Pago ya procesado' });

    if (!req.file) return res.status(400).json({ error: 'Adjunta la foto o captura del comprobante de pago' });

    // El cliente ya no digita estos datos: el titular se toma de su cuenta;
    // el banco de origen y el número de referencia se verifican directo en la foto.
    const requester = await db.queryOne('SELECT name FROM users WHERE id = $1', [req.user.id]);
    const bank_name = req.body.bank_name || null;
    const account_holder = req.body.account_holder || requester?.name || null;
    const reference_number = req.body.reference_number || null;

    const existing = await db.queryOne('SELECT id FROM payments WHERE booking_id = $1', [booking.id]);
    if (existing) {
      await db.run(
        `UPDATE payments SET bank_name=$1, account_holder=$2, reference_number=$3, receipt_filename=$4, status='pending', submitted_at=NOW() WHERE booking_id=$5`,
        [bank_name, account_holder, reference_number, req.file.filename, booking.id]
      );
    } else {
      await db.run(
        'INSERT INTO payments (booking_id,amount,bank_name,account_holder,reference_number,receipt_filename) VALUES ($1,$2,$3,$4,$5,$6)',
        [booking.id, booking.total_price, bank_name, account_holder, reference_number, req.file.filename]
      );
    }

    await db.run('UPDATE bookings SET payment_status = $1 WHERE id = $2', ['submitted', booking.id]);
    const user = await db.queryOne('SELECT name, email, phone FROM users WHERE id = $1', [req.user.id]);
    const fullBooking = await db.queryOne(
      `SELECT b.*, bt.name as boat_name, bt.location as boat_location FROM bookings b JOIN boats bt ON b.boat_id = bt.id WHERE b.id = $1`,
      [booking.id]
    );
    email.sendPaymentSubmittedAdmin(fullBooking, user).catch(console.error);
    res.json({ success: true, message: 'Comprobante enviado. El host verificará tu pago en breve.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al procesar pago' });
  }
});

router.post('/:id/cancel', authRequired, async (req, res) => {
  try {
    const db = getDB();
    const booking = await db.queryOne('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (!booking) return res.status(404).json({ error: 'Reserva no encontrada' });
    if (booking.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });
    if (booking.status === 'cancelled') return res.status(400).json({ error: 'Ya cancelada' });
    await db.run('UPDATE bookings SET status = $1 WHERE id = $2', ['cancelled', booking.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.patch('/:id/verify-payment', adminRequired, async (req, res) => {
  try {
    const db = getDB();
    const { action, rejection_reason } = req.body;
    const booking = await db.queryOne('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (!booking) return res.status(404).json({ error: 'Reserva no encontrada' });

    if (action === 'approve') {
      await db.run('UPDATE bookings SET status=$1, payment_status=$2 WHERE id=$3', ['confirmed','verified', booking.id]);
      await db.run('UPDATE payments SET status=$1, verified_by=$2, verified_at=NOW() WHERE booking_id=$3', ['verified', req.user.id, booking.id]);
      const fullBooking = await db.queryOne(
        `SELECT b.*, bt.name as boat_name, bt.location as boat_location FROM bookings b JOIN boats bt ON b.boat_id = bt.id WHERE b.id = $1`,
        [booking.id]
      );
      const user = await db.queryOne('SELECT name, email, phone FROM users WHERE id = $1', [booking.user_id]);
      email.sendPaymentApproved(fullBooking, user).catch(console.error);
      res.json({ success: true, message: 'Pago verificado y reserva confirmada' });
    } else if (action === 'reject') {
      await db.run('UPDATE bookings SET payment_status=$1 WHERE id=$2', ['rejected', booking.id]);
      await db.run('UPDATE payments SET status=$1, rejection_reason=$2, verified_by=$3, verified_at=NOW() WHERE booking_id=$4', ['rejected', rejection_reason||'Pago rechazado', req.user.id, booking.id]);
      const fullBooking = await db.queryOne(
        `SELECT b.*, bt.name as boat_name, bt.location as boat_location FROM bookings b JOIN boats bt ON b.boat_id = bt.id WHERE b.id = $1`,
        [booking.id]
      );
      const user = await db.queryOne('SELECT name, email, phone FROM users WHERE id = $1', [booking.user_id]);
      email.sendPaymentRejected(fullBooking, user, rejection_reason).catch(console.error);
      res.json({ success: true, message: 'Pago rechazado' });
    } else {
      res.status(400).json({ error: 'Acción inválida' });
    }
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.post('/:id/review', authRequired, async (req, res) => {
  try {
    const db = getDB();
    const { rating, comment } = req.body;
    const booking = await db.queryOne(`SELECT * FROM bookings WHERE id=$1 AND user_id=$2 AND status='confirmed'`, [req.params.id, req.user.id]);
    if (!booking) return res.status(404).json({ error: 'Reserva no encontrada o no confirmada' });
    const existing = await db.queryOne('SELECT id FROM reviews WHERE booking_id = $1', [booking.id]);
    if (existing) return res.status(409).json({ error: 'Ya enviaste una reseña' });
    await db.run('INSERT INTO reviews (booking_id,user_id,boat_id,rating,comment) VALUES ($1,$2,$3,$4,$5)', [booking.id, req.user.id, booking.boat_id, rating, comment]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
