// Pago con tarjeta mediante la Página de Pago de AZUL.
// El servidor NUNCA recibe datos de tarjeta: el cliente paga en el sitio de AZUL y vuelve por una URL
// de retorno. La reserva solo se confirma con un hash de respuesta válido (HMAC-SHA512 con AuthKey),
// OrderNumber y Amount iguales a los guardados y IsoCode '00'. Nunca se registran AuthKey ni AuthHash.
const express = require('express');
const crypto = require('node:crypto');
const { getDB } = require('../database');
const { authRequired } = require('../middleware/auth');
const emailUtil = require('../utils/email');
const azul = require('../utils/azul');
const { computeQuote } = require('../utils/booking-quote');
const { generateRef } = require('../utils/booking-ref');
const { SLOT_HOLDING_PAYMENT_STATUSES, expireCardHolds } = require('../utils/card-holds');
const { getUsdDopRate } = require('../utils/rates');

const router = express.Router();

const RATE_ERROR = 'No pudimos obtener la tasa del día; intenta de nuevo o paga por transferencia';
const RESPONSE_FIELDS = ['OrderNumber', 'Amount', 'AuthorizationCode', 'DateTime', 'ResponseCode', 'IsoCode', 'ResponseMessage', 'ErrorDescription', 'RRN', 'AuthHash'];

// ---------- utilidades ----------

// 12 dígitos aleatorios criptográficos (≤15 caracteres, solo dígitos, sin cero inicial)
function generateOrderNumber() {
  const n = crypto.randomBytes(6).readUIntBE(0, 6) % 900000000000;
  return String(100000000000 + n);
}

let probeCache = null; // { ok, at }
async function defaultProbe(url) {
  try {
    await fetch(url, { method: 'GET', signal: AbortSignal.timeout(2000), redirect: 'manual' });
    return true;
  } catch { return false; }
}

// URL del formulario de AZUL. AZUL_PAYMENT_URL (simulador local) se ignora en producción.
async function resolveActionUrl(env, opts = {}) {
  const prod = env.NODE_ENV === 'production';
  if (!prod && env.AZUL_PAYMENT_URL) return env.AZUL_PAYMENT_URL;
  if (env.AZUL_ENV !== 'prod') return azul.AZUL_URLS.test;
  const now = Date.now();
  if (opts.fresh || !probeCache || now - probeCache.at > 60 * 1000) {
    const probe = opts.probe || defaultProbe;
    probeCache = { ok: await probe(azul.AZUL_URLS.prod), at: now };
  }
  return probeCache.ok ? azul.AZUL_URLS.prod : azul.AZUL_URLS.prodAlt;
}

function itbisRate(env) {
  const r = Number(env.AZUL_ITBIS_RATE);
  return Number.isFinite(r) && r >= 0 && r <= 1 ? r : 0;
}

const fail = (status, error, extra) => ({ status, body: { error, ...(extra || {}) } });

// ---------- inicio del pago ----------
// deps: { db, getRate, env, baseUrl, now? }  ·  user: fila de users  ·  body: JSON del cliente
async function startPayment(deps, user, body) {
  const { db, getRate, env } = deps;
  const b = body || {};
  if (!env.AZUL_MERCHANT_ID || !env.AZUL_AUTH_KEY) return fail(503, 'El pago con tarjeta no está disponible por ahora. Puedes pagar por transferencia.');
  const baseUrl = String(deps.baseUrl || '').replace(/\/+$/, '');
  if (env.NODE_ENV === 'production' && !/^https:\/\//i.test(baseUrl)) {
    console.error('AZUL: SITE_URL de producción no es https; se rechaza el inicio del pago');
    return fail(503, 'El pago con tarjeta no está disponible por ahora. Puedes pagar por transferencia.');
  }

  await expireCardHolds(db);
  if (!user.email_verified) {
    return fail(403, 'Confirma tu correo para poder reservar. Te enviamos un enlace al registrarte; puedes pedir otro desde tu panel.', { code: 'email_unverified' });
  }
  if (b.accept_terms !== true) return fail(400, 'Debes aceptar los términos y condiciones para pagar con tarjeta.');

  const waiting = await db.queryOne("SELECT COUNT(*)::int AS n FROM bookings WHERE user_id = $1 AND status = 'pending' AND payment_status IN ('submitted','card_pending')", [user.id]);
  if (waiting.n >= 3) return fail(429, 'Ya tienes 3 reservas esperando verificación de pago. Espera a que las revisemos antes de crear otra.');

  let { boat_id, start_date, schedule, guests, package_hours, extra_hours, meal_addons, birthday_combo, special_requests } = b;
  if (!boat_id || !start_date || !schedule) return fail(400, 'Datos de reserva incompletos');
  if (!/^\d+$/.test(String(boat_id))) return fail(400, 'Embarcación inválida');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start_date))) return fail(400, 'Fecha inválida');
  if (special_requests != null) special_requests = String(special_requests).slice(0, 500);

  const boatRow = await db.queryOne('SELECT * FROM boats WHERE id = $1 AND available = true', [boat_id]);
  if (!boatRow) return fail(404, 'Embarcación no disponible');
  const quote = computeQuote(boatRow, { start_date, schedule, guests, package_hours, extra_hours, meal_addons, birthday_combo }, deps.now || new Date());
  if (!quote.ok) return fail(quote.status, quote.error);

  let rate;
  try {
    rate = (await getRate()).rate;
    if (!(rate > 0)) throw new Error('tasa inválida');
  } catch {
    return fail(503, RATE_ERROR);
  }
  const amountCents = Math.round(quote.total * rate * 100);
  if (!(amountCents > 0)) return fail(400, 'Monto inválido');
  const itbisCents = Math.round(amountCents * itbisRate(env));

  const conflict = await db.queryOne(
    `SELECT id FROM bookings WHERE boat_id = $1 AND status IN ('confirmed','pending') AND payment_status = ANY($4) AND start_date = $2 AND schedule = $3`,
    [boat_id, start_date, schedule, SLOT_HOLDING_PAYMENT_STATUSES]
  );
  if (conflict) return fail(409, 'Ese turno ya está reservado');

  const ref = await generateRef(db);
  let inserted;
  try {
    inserted = await db.run(
      `INSERT INTO bookings (booking_ref,user_id,boat_id,start_date,end_date,days,guests,total_price,additionals,additionals_price,special_requests,schedule,booking_meta,payment_status,payment_method)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,'card_pending','card') RETURNING id`,
      [ref, user.id, boat_id, start_date, 1, quote.guests, quote.total,
       JSON.stringify(quote.additionals), quote.additionalsPrice, special_requests || null, schedule, quote.meta]
    );
  } catch (e) {
    if (e.code === '23505') return fail(409, 'Ese turno ya está reservado');
    throw e;
  }
  const bookingId = inserted.lastInsertRowid;

  let orderNumber = null;
  try {
    for (let i = 0; i < 5 && !orderNumber; i++) {
      const candidate = generateOrderNumber();
      try {
        await db.run(
          `INSERT INTO card_payments (booking_id, order_number, amount_dop_cents, itbis_dop_cents, usd_total, usd_dop_rate)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [bookingId, candidate, amountCents, itbisCents, quote.total, rate]
        );
        orderNumber = candidate;
      } catch (e) {
        if (e.code !== '23505') throw e; // OrderNumber repetido: se vuelve a sortear
      }
    }
    if (!orderNumber) throw new Error('No se pudo generar un OrderNumber único');
  } catch (e) {
    await db.run('DELETE FROM bookings WHERE id = $1', [bookingId]); // no dejar una reserva sin registro de pago
    throw e;
  }

  const ret = (k) => `${baseUrl}/api/payments/azul/${k}/${orderNumber}`;
  const fields = azul.buildPaymentFields({
    merchantId: env.AZUL_MERCHANT_ID,
    merchantName: env.AZUL_MERCHANT_NAME || 'VENDO BOTE RD',
    orderNumber,
    amountDop: amountCents / 100,
    itbisDop: itbisCents / 100,
    approvedUrl: ret('approved'),
    declinedUrl: ret('declined'),
    cancelUrl: ret('cancelled'),
    authKey: env.AZUL_AUTH_KEY,
    bookingRef: ref,
  });
  const action = await resolveActionUrl(env);
  return { status: 200, body: { action, fields } };
}

// ---------- retorno de AZUL ----------

// Llama a un envío de correo sin esperarlo ni dejar que su fallo afecte al cliente.
function fireAndForget(fn) {
  try {
    const p = fn();
    if (p && typeof p.catch === 'function') p.catch((e) => console.error('AZUL: fallo al enviar correo:', e && e.message));
  } catch (e) {
    console.error('AZUL: fallo al enviar correo:', e && e.message);
  }
}

const cleanIso = (v) => (typeof v === 'string' && /^[A-Za-z0-9]{1,4}$/.test(v) ? v : null);
const cleanText = (v, n = 200) => (typeof v === 'string' && v ? v.slice(0, n) : null);

async function loadForEmail(db, cp) {
  const booking = await db.queryOne(
    `SELECT b.*, bt.name as boat_name, bt.location as boat_location FROM bookings b JOIN boats bt ON b.boat_id = bt.id WHERE b.id = $1`,
    [cp.booking_id]
  );
  const user = booking ? await db.queryOne('SELECT name, email, phone FROM users WHERE id = $1', [booking.user_id]) : null;
  return { booking, user };
}

// Pago aprobado que no se pudo asignar a la reserva (turno vencido/tomado, monto distinto): se
// conserva el registro y se avisa al admin una sola vez.
async function markNeedsReview({ db, email }, cp, ref, params) {
  const r = await db.run(
    `UPDATE card_payments SET status = 'needs_review', iso_code = $2, authorization_code = $3, rrn = $4, azul_datetime = $5, completed_at = NOW()
     WHERE id = $1 AND status NOT IN ('approved','needs_review')`,
    [cp.id, cleanIso(params && params.IsoCode), cleanText(params && params.AuthorizationCode, 40), cleanText(params && params.RRN, 40), cleanText(params && params.DateTime, 40)]
  );
  console.error(`AZUL: pago por revisar orderNumber=${cp.order_number} bookingRef=${ref} IsoCode=${cleanIso(params && params.IsoCode) || '-'}`);
  if (r.rowCount) {
    try {
      const { booking, user } = await loadForEmail(db, cp);
      const payment = { ...cp, authorization_code: params && params.AuthorizationCode, rrn: params && params.RRN, azul_datetime: params && params.DateTime };
      if (booking && user) fireAndForget(() => email.sendCardNeedsReview(booking, user, payment));
    } catch (e) { console.error('AZUL: no se pudo preparar el aviso de revisión:', e.message); }
  }
  return { estado: 'revision', ref };
}

// Libera el turno de una reserva con pago con tarjeta no completado.
async function releaseHold(db, cp, ref, cpStatus, bookingPayStatus, params) {
  await db.run(
    "UPDATE bookings SET status = 'cancelled', payment_status = $2 WHERE id = $1 AND payment_status = 'card_pending'",
    [cp.booking_id, bookingPayStatus]
  );
  await db.run(
    `UPDATE card_payments SET status = $2, iso_code = $3, response_message = $4, completed_at = NOW()
     WHERE id = $1 AND status NOT IN ('approved','needs_review')`,
    [cp.id, cpStatus, cleanIso(params && params.IsoCode), cleanText(params && params.ResponseMessage)]
  );
  return { estado: cpStatus === 'declined' ? 'declinado' : 'cancelado', ref };
}

// deps: { db, email, authKey }  ·  input: { kind: 'approved'|'declined'|'cancelled', orderNumber, params }
// Devuelve { estado: 'aprobado'|'declinado'|'cancelado'|'revision', ref }.
async function handleReturn(deps, input) {
  const { db, authKey } = deps;
  const { kind, orderNumber } = input;
  const params = input.params || {};
  if (typeof orderNumber !== 'string' || !/^\d{1,15}$/.test(orderNumber)) return { estado: 'revision', ref: undefined };

  const cp = await db.queryOne(
    `SELECT cp.*, b.booking_ref FROM card_payments cp JOIN bookings b ON b.id = cp.booking_id WHERE cp.order_number = $1`,
    [orderNumber]
  );
  if (!cp) {
    console.error(`AZUL: retorno con orderNumber desconocido orderNumber=${orderNumber}`);
    return { estado: 'revision', ref: undefined };
  }
  const ref = cp.booking_ref;
  if (cp.status === 'approved') return { estado: 'aprobado', ref }; // idempotente: sin repetir efectos

  // La respuesta es de confianza solo con hash válido y el mismo OrderNumber de la URL.
  const trusted = !!authKey && azul.verifyResponseHash(params, authKey) && params.OrderNumber === orderNumber;
  const amountOk = trusted && /^\d{1,18}$/.test(String(params.Amount)) && BigInt(params.Amount) === BigInt(cp.amount_dop_cents);
  const iso = trusted ? params.IsoCode : undefined;

  if (kind !== 'approved') {
    // /declined y /cancelled nunca confirman. Una aprobación válida llegando por aquí se manda a revisión.
    if (trusted && azul.isApproved(params)) return markNeedsReview(deps, cp, ref, params);
    return releaseHold(db, cp, ref, kind === 'declined' ? 'declined' : 'cancelled', kind === 'declined' ? 'rejected' : 'cancelled', trusted ? params : null);
  }

  if (!trusted) {
    console.error(`AZUL: respuesta no verificada orderNumber=${orderNumber} bookingRef=${ref}`);
    return { estado: 'revision', ref };
  }
  if (!azul.isApproved(params)) {
    console.error(`AZUL: pago no aprobado orderNumber=${orderNumber} bookingRef=${ref} IsoCode=${cleanIso(iso) || '-'}`);
    return releaseHold(db, cp, ref, 'declined', 'rejected', params);
  }
  if (!amountOk) {
    console.error(`AZUL: monto de la respuesta distinto al guardado orderNumber=${orderNumber} bookingRef=${ref}`);
    return markNeedsReview(deps, cp, ref, params);
  }

  // Confirmación atómica: solo una respuesta puede pasar de card_pending a verified.
  let won;
  try {
    won = await db.run(
      "UPDATE bookings SET status = 'confirmed', payment_status = 'verified', payment_method = 'card' WHERE id = $1 AND payment_status = 'card_pending'",
      [cp.booking_id]
    );
  } catch (e) {
    if (e.code === '23505') return markNeedsReview(deps, cp, ref, params); // otro cliente ocupó el turno
    throw e;
  }
  if (!won.rowCount) {
    const now = await db.queryOne('SELECT status, payment_status, payment_method FROM bookings WHERE id = $1', [cp.booking_id]);
    if (now && now.payment_status === 'verified' && now.payment_method === 'card') return { estado: 'aprobado', ref }; // otra respuesta ganó
    return markNeedsReview(deps, cp, ref, params); // expirada o liberada: el dinero se cobró
  }

  await db.run(
    `UPDATE card_payments SET status = 'approved', iso_code = $2, response_message = $3, authorization_code = $4, rrn = $5, azul_datetime = $6, completed_at = NOW()
     WHERE id = $1`,
    [cp.id, cleanIso(params.IsoCode), cleanText(params.ResponseMessage), cleanText(params.AuthorizationCode, 40), cleanText(params.RRN, 40), cleanText(params.DateTime, 40)]
  );
  console.log(`AZUL: pago aprobado orderNumber=${orderNumber} bookingRef=${ref} IsoCode=00`);
  try {
    const { booking, user } = await loadForEmail(db, cp);
    const payment = { ...cp, authorization_code: params.AuthorizationCode, rrn: params.RRN, azul_datetime: params.DateTime };
    if (booking && user) fireAndForget(() => deps.email.sendCardReceipt(booking, user, payment));
  } catch (e) { console.error('AZUL: no se pudo preparar el recibo:', e.message); }
  return { estado: 'aprobado', ref };
}

// ---------- rutas HTTP ----------

router.get('/config', (req, res) => {
  res.json({ enabled: !!(process.env.AZUL_MERCHANT_ID && process.env.AZUL_AUTH_KEY) });
});

router.post('/start', authRequired, async (req, res) => {
  try {
    const isProd = process.env.NODE_ENV === 'production';
    const baseUrl = isProd
      ? (process.env.SITE_URL || 'https://vendoboterd.com')
      : `${req.protocol}://${req.get('host')}`;
    const r = await startPayment({ db: getDB(), getRate: getUsdDopRate, env: process.env, baseUrl }, req.user, req.body);
    res.status(r.status).json(r.body);
  } catch (e) {
    console.error('AZUL: error al iniciar el pago:', e.message);
    res.status(500).json({ error: 'Error al iniciar el pago con tarjeta' });
  }
});

router.get('/:kind(approved|declined|cancelled)/:orderNumber', async (req, res) => {
  let result = { estado: 'revision', ref: undefined };
  try {
    const params = {};
    for (const k of RESPONSE_FIELDS) if (typeof req.query[k] === 'string') params[k] = req.query[k];
    result = await handleReturn(
      { db: getDB(), email: emailUtil, authKey: process.env.AZUL_AUTH_KEY },
      { kind: req.params.kind, orderNumber: req.params.orderNumber, params }
    );
  } catch (e) {
    console.error(`AZUL: error en el retorno orderNumber=${String(req.params.orderNumber).slice(0, 15)}:`, e.message);
  }
  const q = new URLSearchParams({ estado: result.estado });
  if (result.ref) q.set('ref', result.ref);
  res.redirect(302, `/pago-resultado.html?${q.toString()}`);
});

module.exports = router;
module.exports.handleReturn = handleReturn;
module.exports.startPayment = startPayment;
module.exports.generateOrderNumber = generateOrderNumber;
module.exports.resolveActionUrl = resolveActionUrl;
