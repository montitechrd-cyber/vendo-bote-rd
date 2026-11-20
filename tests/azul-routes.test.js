const test = require('node:test');
const assert = require('node:assert/strict');
const azul = require('../utils/azul');
const { handleReturn, startPayment, generateOrderNumber, resolveActionUrl, cardEnabled, itbisRate, computeBreakdown } = require('../routes/azul');

const KEY = 'clave-de-prueba';

// Doble de db en memoria: reconoce las consultas por fragmentos de SQL.
function fakeDb(over = {}) {
  const st = {
    cp: { id: 1, booking_id: 10, order_number: '123456789012', amount_dop_cents: '1748321', status: 'created', booking_ref: 'VB-1234' },
    booking: { id: 10, status: 'pending', payment_status: 'card_pending', payment_method: 'card', booking_ref: 'VB-1234', user_id: 5, total_price: 300, boat_name: 'Bote', start_date: '2027-01-10', schedule: '9am-3pm' },
    conflict: false, calls: [], ...over,
  };
  const db = {
    st,
    async queryOne(sql, p = []) {
      st.calls.push(sql);
      if (sql.includes('FROM card_payments cp')) return st.cp && p[0] === st.cp.order_number ? { ...st.cp } : undefined;
      if (sql.includes('SELECT status, payment_status, payment_method FROM bookings')) return { ...st.booking };
      if (sql.includes('FROM bookings b JOIN boats')) return { ...st.booking };
      if (sql.includes('FROM users')) return { name: 'Ana', email: 'ana@x.com', phone: '809' };
      throw new Error('queryOne no previsto: ' + sql);
    },
    async run(sql, p = []) {
      st.calls.push(sql);
      if (sql.includes("UPDATE bookings SET status = 'confirmed'")) {
        if (st.conflict) { const e = new Error('dup'); e.code = '23505'; throw e; }
        if (st.booking.payment_status !== 'card_pending') return { rowCount: 0 };
        Object.assign(st.booking, { status: 'confirmed', payment_status: 'verified', payment_method: 'card' });
        return { rowCount: 1 };
      }
      if (sql.includes("UPDATE bookings SET status = 'cancelled', payment_status = $2")) {
        if (st.booking.payment_status !== 'card_pending') return { rowCount: 0 };
        Object.assign(st.booking, { status: 'cancelled', payment_status: p[1] });
        return { rowCount: 1 };
      }
      if (sql.includes("UPDATE card_payments SET status = 'approved'")) { Object.assign(st.cp, { status: 'approved', authorization_code: p[3], rrn: p[4] }); return { rowCount: 1 }; }
      if (sql.includes('SET dup_notified = true')) { if (st.cp.dup_notified) return { rowCount: 0 }; st.cp.dup_notified = true; return { rowCount: 1 }; }
      if (sql.includes("UPDATE card_payments SET status = 'needs_review'")) {
        if (st.cp.status === 'needs_review' || st.cp.status === 'approved') return { rowCount: 0 };
        st.cp.status = 'needs_review'; return { rowCount: 1 };
      }
      if (sql.includes('UPDATE card_payments SET status = $2')) { st.cp.status = p[1]; st.cp.iso_code = p[2]; return { rowCount: 1 }; }
      throw new Error('run no previsto: ' + sql);
    },
  };
  return db;
}

function fakeEmail() {
  const e = { receipts: 0, reviews: 0, dups: 0 };
  e.sendCardDuplicateApproval = async () => { e.dups++; };
  e.sendCardReceipt = async () => { e.receipts++; };
  e.sendCardNeedsReview = async () => { e.reviews++; };
  return e;
}

function resp(over = {}) {
  const p = { OrderNumber: '123456789012', Amount: '1748321', AuthorizationCode: 'OK1234', DateTime: '20261120120000', ResponseCode: 'ISO8583', IsoCode: '00', ResponseMessage: 'APROBADA', ErrorDescription: '', RRN: '999', ...over };
  p.AuthHash = over.AuthHash !== undefined ? over.AuthHash : azul.buildResponseHash(p, KEY);
  return p;
}

const run = (db, email, kind, params, orderNumber = '123456789012') =>
  handleReturn({ db, email, authKey: KEY }, { kind, orderNumber, params });

test('hash válido y monto igual: confirma, un recibo', async () => {
  const db = fakeDb(), email = fakeEmail();
  const r = await run(db, email, 'approved', resp());
  assert.deepEqual(r, { estado: 'aprobado', ref: 'VB-1234' });
  assert.equal(db.st.booking.status, 'confirmed');
  assert.equal(db.st.booking.payment_status, 'verified');
  assert.equal(db.st.cp.status, 'approved');
  assert.equal(email.receipts, 1);
});

test('hash válido pero Amount distinto: no confirma', async () => {
  const db = fakeDb(), email = fakeEmail();
  const r = await run(db, email, 'approved', resp({ Amount: '100' }));
  assert.equal(r.estado, 'revision');
  assert.equal(db.st.booking.payment_status, 'card_pending');
  assert.equal(email.receipts, 0);
});

test('hash inválido: no confirma ni cambia nada', async () => {
  const db = fakeDb(), email = fakeEmail();
  const r = await run(db, email, 'approved', resp({ AuthHash: 'abc' }));
  assert.equal(r.estado, 'revision');
  assert.equal(db.st.booking.payment_status, 'card_pending');
  assert.equal(db.st.cp.status, 'created');
  assert.equal(email.receipts, 0);
});

test('sin AuthHash o con clave distinta: no confirma', async () => {
  const email = fakeEmail();
  const p = resp(); delete p.AuthHash;
  assert.equal((await run(fakeDb(), email, 'approved', p)).estado, 'revision');
  const otra = azul.buildResponseHash(resp(), 'otra-clave');
  assert.equal((await run(fakeDb(), email, 'approved', resp({ AuthHash: otra }))).estado, 'revision');
  assert.equal(email.receipts, 0);
});

test('OrderNumber de la respuesta distinto al de la ruta: no confirma', async () => {
  const db = fakeDb(), email = fakeEmail();
  const r = await run(db, email, 'approved', resp({ OrderNumber: '999999999999' }));
  assert.equal(r.estado, 'revision');
  assert.equal(email.receipts, 0);
});

test('segunda respuesta aprobada idéntica: un solo recibo', async () => {
  const db = fakeDb(), email = fakeEmail();
  await run(db, email, 'approved', resp());
  const r = await run(db, email, 'approved', resp());
  assert.equal(r.estado, 'aprobado');
  assert.equal(email.receipts, 1);
});

test('dos respuestas simultáneas: un solo recibo y sin needs_review', async () => {
  const db = fakeDb(), email = fakeEmail();
  const [a, b] = await Promise.all([run(db, email, 'approved', resp()), run(db, email, 'approved', resp())]);
  assert.equal(a.estado, 'aprobado');
  assert.equal(b.estado, 'aprobado');
  assert.equal(email.receipts, 1);
  assert.equal(email.reviews, 0);
  assert.equal(db.st.cp.status, 'approved');
});

test("IsoCode '05' con hash válido: declinada y libera el turno", async () => {
  const db = fakeDb(), email = fakeEmail();
  const r = await run(db, email, 'approved', resp({ IsoCode: '05', ResponseMessage: 'DECLINADA' }));
  assert.equal(r.estado, 'declinado');
  assert.equal(db.st.booking.status, 'cancelled');
  assert.equal(db.st.booking.payment_status, 'rejected');
  assert.equal(db.st.cp.status, 'declined');
  assert.equal(db.st.cp.iso_code, '05');
  assert.equal(email.receipts, 0);
});

test('IsoCode distinto de 00 con hash inválido: no se toca nada', async () => {
  const db = fakeDb();
  const r = await run(db, fakeEmail(), 'approved', resp({ IsoCode: '05', AuthHash: 'x' }));
  assert.equal(r.estado, 'revision');
  assert.equal(db.st.booking.payment_status, 'card_pending');
});

test('orderNumber inexistente: revisión sin cambiar nada', async () => {
  const db = fakeDb(), email = fakeEmail();
  const r = await run(db, email, 'approved', resp({ OrderNumber: '555' }), '555');
  assert.deepEqual(r, { estado: 'revision', ref: undefined });
  assert.equal(db.st.booking.payment_status, 'card_pending');
  assert.equal(email.receipts, 0);
});

test('conflicto 23505: needs_review y aviso urgente, sin recibo', async () => {
  const db = fakeDb({ conflict: true }), email = fakeEmail();
  const r = await run(db, email, 'approved', resp());
  assert.equal(r.estado, 'revision');
  assert.equal(db.st.cp.status, 'needs_review');
  assert.equal(email.reviews, 1);
  assert.equal(email.receipts, 0);
});

test('reserva ya expirada con pago aprobado: needs_review', async () => {
  const db = fakeDb(); db.st.booking.payment_status = 'expired'; db.st.booking.status = 'cancelled';
  const email = fakeEmail();
  const r = await run(db, email, 'approved', resp());
  assert.equal(r.estado, 'revision');
  assert.equal(db.st.cp.status, 'needs_review');
  assert.equal(email.reviews, 1);
});

test('cancelled y declined (sin hash) liberan el turno; nunca confirman', async () => {
  let db = fakeDb();
  assert.equal((await run(db, fakeEmail(), 'cancelled', {})).estado, 'cancelado');
  assert.equal(db.st.booking.status, 'cancelled');
  assert.equal(db.st.booking.payment_status, 'cancelled');
  db = fakeDb();
  assert.equal((await run(db, fakeEmail(), 'declined', {})).estado, 'declinado');
  assert.equal(db.st.booking.payment_status, 'rejected');
  // una respuesta "aprobada" válida enviada a /declined no confirma
  db = fakeDb(); const email = fakeEmail();
  await run(db, email, 'declined', resp());
  assert.notEqual(db.st.booking.status, 'confirmed');
  assert.equal(email.receipts, 0);
});

test('cancelled sobre un pago ya aprobado no lo deshace', async () => {
  const db = fakeDb(), email = fakeEmail();
  await run(db, email, 'approved', resp());
  const r = await run(db, email, 'cancelled', {});
  assert.equal(r.estado, 'aprobado');
  assert.equal(db.st.booking.status, 'confirmed');
});

test('B2: segunda aprobación válida con otro código/RRN: aviso una sola vez, el cliente ve aprobado', async () => {
  const db = fakeDb(), email = fakeEmail();
  await run(db, email, 'approved', resp());
  assert.equal(email.dups, 0);
  // repetición idéntica: sin aviso
  assert.equal((await run(db, email, 'approved', resp())).estado, 'aprobado');
  assert.equal(email.dups, 0);
  // otro código de autorización o RRN con hash válido: aviso
  const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.join(' '));
  try {
    assert.equal((await run(db, email, 'approved', resp({ AuthorizationCode: 'OTRO99' }))).estado, 'aprobado');
    assert.equal((await run(db, email, 'approved', resp({ RRN: '1000' }))).estado, 'aprobado');
  } finally { console.error = orig; }
  assert.equal(email.dups, 1);
  assert.ok(logs.some((l) => l.includes('123456789012') && l.includes('VB-1234')));
  assert.equal(db.st.booking.payment_status, 'verified');
});

test('B2: una segunda "aprobación" con hash inválido no avisa', async () => {
  const db = fakeDb(), email = fakeEmail();
  await run(db, email, 'approved', resp());
  await run(db, email, 'approved', resp({ AuthorizationCode: 'X', AuthHash: 'malo' }));
  assert.equal(email.dups, 0);
});

test('los registros no incluyen AuthHash ni la clave', async () => {
  const logs = [];
  const orig = [console.error, console.log, console.warn];
  console.error = console.log = console.warn = (...a) => logs.push(a.join(' '));
  try {
    const p = resp({ Amount: '5' });
    await run(fakeDb(), fakeEmail(), 'approved', p);
    await run(fakeDb(), fakeEmail(), 'approved', resp({ IsoCode: '05' }));
    assert.ok(!logs.join('\n').includes(p.AuthHash));
    assert.ok(!logs.join('\n').includes(KEY));
  } finally { [console.error, console.log, console.warn] = orig; }
});

test('generateOrderNumber: solo dígitos, 12, distintos', () => {
  const s = new Set();
  for (let i = 0; i < 50; i++) { const n = generateOrderNumber(); assert.match(n, /^[1-9]\d{11}$/); s.add(n); }
  assert.ok(s.size > 45);
});

test('resolveActionUrl: test, producción y AZUL_PAYMENT_URL solo fuera de producción', async () => {
  const sim = 'http://localhost:9/sim';
  assert.equal(await resolveActionUrl({ AZUL_ENV: 'test', NODE_ENV: 'development', AZUL_PAYMENT_URL: sim }), sim);
  assert.equal(await resolveActionUrl({ AZUL_ENV: 'test', NODE_ENV: 'production', AZUL_PAYMENT_URL: sim }), azul.AZUL_URLS.test);
  const probe = async () => true;
  assert.equal(await resolveActionUrl({ AZUL_ENV: 'prod', NODE_ENV: 'production', AZUL_PAYMENT_URL: sim }, { probe, fresh: true }), azul.AZUL_URLS.prod);
  assert.equal(await resolveActionUrl({ AZUL_ENV: 'prod', NODE_ENV: 'production' }, { probe: async () => false, fresh: true }), azul.AZUL_URLS.prodAlt);
});

// ---- startPayment ----
function startDeps(over = {}) {
  const inserted = { bookings: [], cps: [] };
  const boat = { id: 3, name: 'Bote', location: 'Boca Chica', capacity: 10, price_per_day: 200, pricing_scheme: null, available: true };
  const db = {
    inserted,
    async query() { return []; }, // expireCardHolds: sin retenciones vencidas
    async queryOne(sql, p) {
      if (sql.includes("payment_status = 'card_pending' LIMIT 1")) return over.active ? { id: 1 } : undefined;
      if (sql.includes("payment_method = 'card'")) return { n: over.failed || 0 };
      if (sql.includes('COUNT(*)')) return { n: over.waiting || 0 };
      if (sql.includes('FROM boats')) return boat;
      if (sql.includes('FROM bookings WHERE boat_id')) return over.conflict ? { id: 1 } : undefined;
      if (sql.includes('booking_ref = $1')) return undefined;
      throw new Error('queryOne no previsto: ' + sql);
    },
    async run(sql, p) {
      if (sql.includes('UPDATE bookings SET status')) return { rowCount: 0 };
      if (sql.includes('INSERT INTO bookings')) { if (over.insertError) throw over.insertError; inserted.bookings.push(p); return { lastInsertRowid: 77 }; }
      if (sql.includes('INSERT INTO card_payments')) { inserted.cps.push(p); return { lastInsertRowid: 1 }; }
      if (sql.includes('DELETE FROM bookings')) { inserted.deleted = true; return { rowCount: 1 }; }
      throw new Error('run no previsto: ' + sql);
    },
  };
  return {
    db,
    getRate: over.getRate || (async () => ({ rate: 58.5, date: '2026-11-20', source: 'manual' })),
    env: { AZUL_MERCHANT_ID: '39038540035', AZUL_MERCHANT_NAME: 'VENDO BOTE', AZUL_AUTH_KEY: KEY, AZUL_ENV: 'test', NODE_ENV: 'development', ...(over.env || {}) },
    baseUrl: 'http://localhost:3000',
    now: new Date('2026-12-01T12:00:00Z'),
  };
}
const body = { boat_id: '3', start_date: '2027-03-10', schedule: '9am-3pm', guests: 2, accept_terms: true };
const user = { id: 5, email_verified: true };

test('start: crea reserva card_pending, monto en DOP y campos firmados', async () => {
  const d = startDeps();
  const r = await startPayment(d, user, body);
  assert.equal(r.status, 200);
  // 200 USD × 58.5 = RD$ 11,700.00 de base; ITBIS 18 % = 2,106.00; total = 13,806.00
  assert.equal(r.body.fields.Amount, '1380600');
  assert.equal(r.body.fields.ITBIS, '210600');
  assert.deepEqual(r.body.breakdown, { baseDop: 11700, itbisDop: 2106, totalDop: 13806, itbisRate: 0.18, usdDopRate: 58.5, usdTotal: 200 });
  assert.match(r.body.fields.OrderNumber, /^\d{12}$/);
  assert.match(r.body.fields.ApprovedUrl, /^http:\/\/localhost:3000\/api\/payments\/azul\/approved\/\d{12}$/);
  assert.match(r.body.fields.CancelUrl, /\/cancelled\/\d{12}$/);
  assert.equal(r.body.fields.MerchantName, 'VENDO BOTE');
  assert.equal(r.body.action, azul.AZUL_URLS.test);
  assert.equal(d.db.inserted.cps.length, 1);
  // card_payments guarda el TOTAL con ITBIS y, aparte, el impuesto
  assert.equal(d.db.inserted.cps[0][2], 1380600);
  assert.equal(d.db.inserted.cps[0][3], 210600);
});

test('ITBIS: 58.5 y 500 USD → base 29250.00, ITBIS 5265.00, total 34515.00 (Amount 3451500, ITBIS 526500)', () => {
  assert.deepEqual(computeBreakdown(500, 58.5, 0.18), { baseCents: 2925000, itbisCents: 526500, totalCents: 3451500 });
  const f = azul.buildPaymentFields({
    merchantId: '1', merchantName: 'X', orderNumber: '123456789012', amountDop: 3451500 / 100, itbisDop: 526500 / 100,
    approvedUrl: 'https://x/a', declinedUrl: 'https://x/d', cancelUrl: 'https://x/c', authKey: KEY, bookingRef: 'VB-1',
  });
  assert.equal(f.Amount, '3451500');
  assert.equal(f.ITBIS, '526500');
});

test('ITBIS: el redondeo es en centavos (base primero, luego el impuesto) y total = base + ITBIS', () => {
  // 333.33 × 58.37 = 19456.4721 → base 1945647 c; × 0.18 = 350216.46 → 350216 c
  assert.deepEqual(computeBreakdown(333.33, 58.37, 0.18), { baseCents: 1945647, itbisCents: 350216, totalCents: 2295863 });
  // 0.5 de centavo hacia arriba: 10.01 × 1 = 1001 c; × 0.18 = 180.18 → 180
  assert.deepEqual(computeBreakdown(10.01, 1, 0.18), { baseCents: 1001, itbisCents: 180, totalCents: 1181 });
});

test('ITBIS: tasa por defecto 0.18; AZUL_ITBIS_RATE la cambia; valores inválidos o fuera de 0..1 vuelven a 0.18', () => {
  assert.equal(itbisRate({}), 0.18);
  assert.equal(itbisRate({ AZUL_ITBIS_RATE: '' }), 0.18);
  assert.equal(itbisRate({ AZUL_ITBIS_RATE: '0.16' }), 0.16);
  assert.equal(itbisRate({ AZUL_ITBIS_RATE: '0' }), 0);
  assert.equal(itbisRate({ AZUL_ITBIS_RATE: '1' }), 1);
  for (const bad of ['abc', '-0.1', '1.5', '18', 'NaN']) assert.equal(itbisRate({ AZUL_ITBIS_RATE: bad }), 0.18, bad);
});

test('ITBIS: con AZUL_ITBIS_RATE=0.10 el cobro usa esa tasa', async () => {
  const d = startDeps({ env: { AZUL_ITBIS_RATE: '0.10' } });
  const r = await startPayment(d, user, body);
  assert.equal(r.body.fields.Amount, '1287000'); // 11700 + 1170
  assert.equal(r.body.fields.ITBIS, '117000');
});

test('ITBIS: respuesta con el monto SIN ITBIS (la base) → needs_review, no confirma', async () => {
  const db = fakeDb({ cp: { id: 1, booking_id: 10, order_number: '123456789012', amount_dop_cents: '3451500', itbis_dop_cents: '526500', status: 'created', booking_ref: 'VB-1234' } });
  const email = fakeEmail();
  const r = await run(db, email, 'approved', resp({ Amount: '2925000' }));
  assert.equal(r.estado, 'revision');
  assert.equal(db.st.booking.payment_status, 'card_pending');
  assert.equal(email.receipts, 0);
  const ok = await run(fakeDb({ cp: { id: 1, booking_id: 10, order_number: '123456789012', amount_dop_cents: '3451500', itbis_dop_cents: '526500', status: 'created', booking_ref: 'VB-1234' } }), fakeEmail(), 'approved', resp({ Amount: '3451500' }));
  assert.equal(ok.estado, 'aprobado');
});

test('start: exige accept_terms y correo verificado', async () => {
  assert.equal((await startPayment(startDeps(), user, { ...body, accept_terms: false })).status, 400);
  assert.equal((await startPayment(startDeps(), user, { ...body, accept_terms: 'true' })).status, 400);
  const r = await startPayment(startDeps(), { id: 5, email_verified: false }, body);
  assert.equal(r.status, 403);
});

test('start: sin tasa del día responde 503 con el mensaje exacto', async () => {
  const d = startDeps({ getRate: async () => { throw new Error('x'); } });
  const r = await startPayment(d, user, body);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'No pudimos obtener la tasa del día; intenta de nuevo o paga por transferencia');
  assert.equal(d.db.inserted.bookings.length, 0);
});

test('start: tope de 3 pendientes, turno ocupado y sin credenciales', async () => {
  assert.equal((await startPayment(startDeps({ waiting: 3 }), user, body)).status, 429);
  assert.equal((await startPayment(startDeps({ conflict: true }), user, body)).status, 409);
  assert.equal((await startPayment(startDeps({ env: { AZUL_AUTH_KEY: '' } }), user, body)).status, 503);
});

test('start: en producción SITE_URL debe ser https', async () => {
  const d = startDeps({ env: { NODE_ENV: 'production', AZUL_ENV: 'prod', SITE_URL: 'http://vendoboterd.com' } });
  d.baseUrl = 'http://vendoboterd.com';
  const r = await startPayment(d, user, body);
  assert.equal(r.status, 503);
  assert.equal(d.db.inserted.bookings.length, 0);
});

test('A2: ya hay una retención con tarjeta activa del usuario → 409 en curso, sin insertar', async () => {
  const d = startDeps({ active: true });
  const r = await startPayment(d, user, body);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'Ya tienes un pago con tarjeta en curso. Complétalo o espera 15 minutos.');
  assert.equal(d.db.inserted.bookings.length, 0);
});

test('A2: 23505 del índice por usuario (carrera) → 409 en curso; el del turno → turno ocupado', async () => {
  const e1 = Object.assign(new Error('dup'), { code: '23505', constraint: 'bookings_user_card_pending_idx' });
  const r1 = await startPayment(startDeps({ insertError: e1 }), user, body);
  assert.equal(r1.status, 409);
  assert.match(r1.body.error, /en curso/);
  const e2 = Object.assign(new Error('dup'), { code: '23505', constraint: 'bookings_slot_active_idx' });
  const r2 = await startPayment(startDeps({ insertError: e2 }), user, body);
  assert.equal(r2.status, 409);
  assert.equal(r2.body.error, 'Ese turno ya está reservado');
  const e3 = Object.assign(new Error('dup'), { code: '23505', detail: 'Key (user_id)=(5) already exists.' });
  assert.match((await startPayment(startDeps({ insertError: e3 }), user, body)).body.error, /en curso/);
});

test('M1: tope diario de intentos de tarjeta sin completar → 429', async () => {
  assert.equal((await startPayment(startDeps({ failed: 4 }), user, body)).status, 200);
  const r = await startPayment(startDeps({ failed: 5 }), user, body);
  assert.equal(r.status, 429);
  assert.match(r.body.error, /mañana|transferencia/);
});

test('M2: tasa fuera de rango (0.58) → 503 sin crear reserva; 58 → 200', async () => {
  const d = startDeps({ getRate: async () => ({ rate: 0.58 }) });
  const r = await startPayment(d, user, body);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'No pudimos obtener la tasa del día; intenta de nuevo o paga por transferencia');
  assert.equal(d.db.inserted.bookings.length, 0);
  assert.equal((await startPayment(startDeps({ getRate: async () => ({ rate: 58 }) }), user, body)).status, 200);
});

test('M3: en producción con AZUL_ENV=test → 503 sin reserva; con AZUL_ALLOW_TEST_IN_PROD=1 → 200', async () => {
  const prodTest = { NODE_ENV: 'production', AZUL_ENV: 'test' };
  const d = startDeps({ env: prodTest });
  d.baseUrl = 'https://vendoboterd.com';
  const orig = console.error; console.error = () => {};
  try {
    const r = await startPayment(d, user, body);
    assert.equal(r.status, 503);
    assert.equal(d.db.inserted.bookings.length, 0);
  } finally { console.error = orig; }
  const d2 = startDeps({ env: { ...prodTest, AZUL_ALLOW_TEST_IN_PROD: '1' } });
  d2.baseUrl = 'https://vendoboterd.com';
  assert.equal((await startPayment(d2, user, body)).status, 200);
});

test('M3: cardEnabled (usada por /config)', () => {
  const base = { AZUL_MERCHANT_ID: '1', AZUL_AUTH_KEY: 'k' };
  assert.equal(cardEnabled({ ...base, NODE_ENV: 'development', AZUL_ENV: 'test' }), true);
  assert.equal(cardEnabled({ ...base, NODE_ENV: 'production', AZUL_ENV: 'prod' }), true);
  assert.equal(cardEnabled({ ...base, NODE_ENV: 'production', AZUL_ENV: 'test' }), false);
  assert.equal(cardEnabled({ ...base, NODE_ENV: 'production' }), false);
  assert.equal(cardEnabled({ ...base, NODE_ENV: 'production', AZUL_ENV: 'test', AZUL_ALLOW_TEST_IN_PROD: '1' }), true);
  assert.equal(cardEnabled({ NODE_ENV: 'development' }), false);
});
