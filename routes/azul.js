// Pago con tarjeta mediante la Página de Pago de AZUL.
// El servidor NUNCA recibe datos de tarjeta: el cliente paga en el sitio de AZUL y vuelve por una URL
// de retorno. La reserva solo se confirma con un hash de respuesta válido (HMAC-SHA512 con AuthKey),
// OrderNumber y Amount iguales a los guardados y IsoCode '00'. Nunca se registran AuthKey ni AuthHash.
const express = require('express');
const crypto = require('node:crypto');
const { getDB } = require('../database');
const { optionalAuth, authRequired, adminRequired } = require('../middleware/auth');
const emailUtil = require('../utils/email');
const azul = require('../utils/azul');
const { computeQuote } = require('../utils/booking-quote');
const { generateRef } = require('../utils/booking-ref');
const { SLOT_HOLDING_PAYMENT_STATUSES, expireCardHolds } = require('../utils/card-holds');
const { getUsdDopRate, inRange: rateInRange } = require('../utils/rates');

const router = express.Router();

const RATE_ERROR = 'No pudimos obtener la tasa del día; intenta de nuevo o paga por transferencia';
const USER_HOLD_ERROR = 'Ya tienes un pago con tarjeta en curso. Complétalo o espera 15 minutos.';
const RESPONSE_FIELDS = ['OrderNumber', 'Amount', 'AuthorizationCode', 'DateTime', 'ResponseCode', 'IsoCode', 'ResponseMessage', 'ErrorDescription', 'RRN', 'AuthHash',
  'DCCApplied', 'DCCCurrencyAlpha', 'DCCExchangeRate', 'DCCMarkup', 'DCCAmount'];

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

const DEFAULT_ITBIS_RATE = 0.18;
// Tasa de ITBIS (fracción 0..1). Por defecto 18 %; AZUL_ITBIS_RATE la cambia. Valor vacío o inválido → 18 %.
function itbisRate(env) {
  const raw = env.AZUL_ITBIS_RATE;
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_ITBIS_RATE;
  const r = Number(raw);
  return Number.isFinite(r) && r >= 0 && r <= 1 ? r : DEFAULT_ITBIS_RATE;
}

// Desglose en centavos de peso: base (precio publicado × tasa del día), ITBIS y total cobrado (base + ITBIS).
function computeBreakdown(totalUsd, rate, itbisRateValue) {
  const baseCents = Math.round(totalUsd * rate * 100);
  const itbisCents = Math.round(baseCents * itbisRateValue);
  return { baseCents, itbisCents, totalCents: baseCents + itbisCents };
}

// ¿Se puede cobrar con tarjeta en este entorno? Sin credenciales no; en producción solo con AZUL_ENV=prod
// (o AZUL_ALLOW_TEST_IN_PROD=1, explícito): con credenciales de pruebas se confirmarían reservas reales sin dinero real.
// Correos autorizados a ver y usar el pago de PRUEBAS en el sitio publicado (certificación con AZUL).
function testEmails(env) {
  return String(env.AZUL_TEST_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}
// ¿Es un cobro contra el ambiente de pruebas (sin dinero real)?
const isTestMode = (env) => env.AZUL_ENV !== 'prod';

function cardEnabled(env, user) {
  if (!env.AZUL_MERCHANT_ID || !env.AZUL_AUTH_KEY) return false;
  if (env.NODE_ENV === 'production' && isTestMode(env) && env.AZUL_ALLOW_TEST_IN_PROD !== '1') {
    return !!(user && user.email && testEmails(env).includes(String(user.email).toLowerCase()));
  }
  return true;
}

const fail = (status, error, extra) => ({ status, body: { error, ...(extra || {}) } });

// ---------- inicio del pago ----------
// deps: { db, getRate, env, baseUrl, now? }  ·  user: fila de users  ·  body: JSON del cliente
async function startPayment(deps, user, body) {
  const { db, getRate, env } = deps;
  const b = body || {};
  if (!cardEnabled(env, user)) {
    if (env.AZUL_MERCHANT_ID && env.AZUL_AUTH_KEY) console.error('AZUL: en producción AZUL_ENV no es "prod" (y falta AZUL_ALLOW_TEST_IN_PROD=1); se rechaza el inicio del pago');
    return fail(503, 'El pago con tarjeta no está disponible por ahora. Puedes pagar por transferencia.');
  }
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

  // Una sola retención con tarjeta activa por usuario (el índice único lo garantiza aun con peticiones en paralelo)
  const active = await db.queryOne("SELECT id FROM bookings WHERE user_id = $1 AND status = 'pending' AND payment_status = 'card_pending' LIMIT 1", [user.id]);
  if (active) return fail(409, USER_HOLD_ERROR);
  // Tope diario de intentos de tarjeta que acabaron sin pagar (retención renovable sin coste)
  const failed = await db.queryOne("SELECT COUNT(*)::int AS n FROM bookings WHERE user_id = $1 AND payment_method = 'card' AND payment_status IN ('expired','cancelled','rejected') AND created_at > NOW() - INTERVAL '24 hours'", [user.id]);
  if (failed.n >= 5) return fail(429, 'Has iniciado muchos pagos con tarjeta sin completarlos hoy. Intenta de nuevo mañana o paga por transferencia.');

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
    if (!rateInRange(rate)) throw new Error('tasa fuera de rango');
  } catch {
    return fail(503, RATE_ERROR);
  }
  const itbisRateValue = itbisRate(env);
  const { baseCents, itbisCents, totalCents: amountCents } = computeBreakdown(quote.total, rate, itbisRateValue);
  if (!(baseCents > 0)) return fail(400, 'Monto inválido');

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
    if (e.code === '23505') {
      // Dos índices únicos parciales: el del turno y el de una retención activa por usuario
      const userIdx = e.constraint === 'bookings_user_card_pending_idx' || /\(user_id\)/.test(String(e.detail || ''));
      return fail(409, userIdx ? USER_HOLD_ERROR : 'Ese turno ya está reservado');
    }
    throw e;
  }
  const bookingId = inserted.lastInsertRowid;

  let orderNumber = null;
  try {
    for (let i = 0; i < 5 && !orderNumber; i++) {
      const candidate = generateOrderNumber();
      try {
        await db.run(
          `INSERT INTO card_payments (booking_id, order_number, amount_dop_cents, itbis_dop_cents, usd_total, usd_dop_rate, is_test)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [bookingId, candidate, amountCents, itbisCents, quote.total, rate, isTestMode(env)]
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
    cardHolder: { name: [user.name, user.last_name].filter(Boolean).join(' '), email: user.email, phone: user.phone },
  });
  const action = await resolveActionUrl(env);
  return {
    status: 200,
    body: {
      action, fields,
      breakdown: { baseDop: baseCents / 100, itbisDop: itbisCents / 100, totalDop: amountCents / 100, itbisRate: itbisRateValue, usdDopRate: rate, usdTotal: quote.total },
    },
  };
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

// Conversión de moneda (DCC): el manual exige mostrarla en el recibo cuando el tarjetahabiente la acepta.
// Formatos de AZUL: tasa con 4 decimales ('00185' = 0.0185), margen y monto con 2 ('500' = 5.00, '028' = 0.28).
function dccFromParams(p) {
  const digits = (v) => (typeof v === 'string' && /^\d{1,18}$/.test(v) ? v : null);
  if (!p || p.DCCApplied !== '1') return null;
  const currency = typeof p.DCCCurrencyAlpha === 'string' && /^[A-Z]{3}$/.test(p.DCCCurrencyAlpha) ? p.DCCCurrencyAlpha : null;
  const amount = digits(p.DCCAmount), rate = digits(p.DCCExchangeRate), markup = digits(p.DCCMarkup);
  if (!currency || !amount) return null;
  return { dcc_currency: currency, dcc_amount: amount, dcc_rate: rate, dcc_markup: markup };
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
    [cp.id, cpStatus, cleanIso(params && params.IsoCode), cleanText([params && params.ResponseMessage, params && params.ErrorDescription].filter(Boolean).join(' · '))]
  );
  return { estado: cpStatus === 'declined' ? 'declinado' : 'cancelado', ref };
}

// Segunda respuesta aprobada, con hash válido, de una orden ya aprobada pero con otro código de autorización
// o RRN: posible doble cobro. Se registra y se avisa al admin UNA sola vez; al cliente se le sigue diciendo 'aprobado'.
async function checkDuplicateApproval({ db, email }, cp, ref, params, trusted) {
  if (!trusted || !azul.isApproved(params)) return;
  const auth = cleanText(params.AuthorizationCode, 40) || '', rrn = cleanText(params.RRN, 40) || '';
  if (auth === (cp.authorization_code || '') && rrn === (cp.rrn || '')) return;
  try {
    const r = await db.run('UPDATE card_payments SET dup_notified = true WHERE id = $1 AND dup_notified = false', [cp.id]);
    if (!r.rowCount) return;
    console.error(`AZUL: segunda aprobación distinta (posible doble cobro) orderNumber=${cp.order_number} bookingRef=${ref}`);
    fireAndForget(() => email.sendCardDuplicateApproval(cp.order_number, ref));
  } catch (e) { console.error('AZUL: no se pudo registrar la segunda aprobación:', e.message); }
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

  // La respuesta es de confianza solo con hash válido y el mismo OrderNumber de la URL.
  const trusted = !!authKey && azul.verifyResponseHash(params, authKey) && params.OrderNumber === orderNumber;
  if (cp.status === 'approved') { // idempotente: sin repetir efectos
    await checkDuplicateApproval(deps, cp, ref, params, trusted);
    return { estado: 'aprobado', ref };
  }
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
  const dcc = dccFromParams(params);
  if (dcc) {
    await db.run('UPDATE card_payments SET dcc_currency = $2, dcc_amount = $3, dcc_rate = $4, dcc_markup = $5 WHERE id = $1',
      [cp.id, dcc.dcc_currency, dcc.dcc_amount, dcc.dcc_rate, dcc.dcc_markup]);
  }
  console.log(`AZUL: pago aprobado orderNumber=${orderNumber} bookingRef=${ref} IsoCode=00`);
  try {
    const { booking, user } = await loadForEmail(db, cp);
    const payment = { ...cp, ...(dccFromParams(params) || {}), authorization_code: params.AuthorizationCode, rrn: params.RRN, azul_datetime: params.DateTime };
    if (booking && user) fireAndForget(() => deps.email.sendCardReceipt(booking, user, payment));
  } catch (e) { console.error('AZUL: no se pudo preparar el recibo:', e.message); }
  return { estado: 'aprobado', ref };
}

// ---------- rutas HTTP ----------

router.get('/config', optionalAuth, (req, res) => {
  const enabled = cardEnabled(process.env, req.user);
  res.set('Cache-Control', 'private, no-store');
  res.json({ enabled, testMode: enabled && isTestMode(process.env), itbisRate: itbisRate(process.env) });
});

// Cobros con tarjeta que no terminaron en 'approved', 'declined' ni 'cancelled': por revisar y conciliar con AZUL.
router.get('/admin/review', adminRequired, async (req, res) => {
  try {
    const rows = await getDB().query(
      `SELECT cp.id, cp.order_number, b.booking_ref, cp.status, cp.usd_total, cp.amount_dop_cents, cp.created_at, cp.completed_at, cp.iso_code
       FROM card_payments cp JOIN bookings b ON b.id = cp.booking_id
       WHERE cp.status NOT IN ('approved','declined','cancelled')
       ORDER BY cp.created_at DESC LIMIT 200`
    );
    res.json(rows.map((r) => ({
      id: r.id, order_number: r.order_number, booking_ref: r.booking_ref, status: r.status, usd_total: r.usd_total,
      amount_dop: Number(r.amount_dop_cents) / 100, created_at: r.created_at, completed_at: r.completed_at, iso_code: r.iso_code,
    })));
  } catch (e) {
    console.error('AZUL: error al listar pagos por revisar:', e.message);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.post('/start', authRequired, async (req, res) => {
  try {
    const isProd = process.env.NODE_ENV === 'production';
    const baseUrl = isProd
      ? (process.env.SITE_URL || 'https://vendoboterd.com')
      : `${req.protocol}://${req.get('host')}`;
    const r = await startPayment({ db: getDB(), getRate: () => getUsdDopRate({ forCard: true }), env: process.env, baseUrl }, req.user, req.body);
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
module.exports.dccFromParams = dccFromParams;
module.exports.startPayment = startPayment;
module.exports.generateOrderNumber = generateOrderNumber;
module.exports.resolveActionUrl = resolveActionUrl;
module.exports.cardEnabled = cardEnabled;
module.exports.itbisRate = itbisRate;
module.exports.computeBreakdown = computeBreakdown;
