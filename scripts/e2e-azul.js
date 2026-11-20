// Prueba de punta a punta del pago con tarjeta (AZUL) contra Postgres LOCAL y el simulador.
//   node scripts/e2e-azul.js
// Lanza el simulador (4010) y el servidor (PORT 3011) con variables en línea, crea usuarios de prueba
// con correo verificado en la base local, recorre los escenarios por la API (sin navegador) y borra
// todos sus datos al terminar. Nunca se conecta a otra base que la local de desarrollo.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const { Pool } = require('pg');

const root = path.join(__dirname, '..');
const DB_URL = process.env.E2E_DB_URL || 'postgresql://postgres:postgres@localhost:54329/vendobote';
const PORT = 3011;
const BASE = `http://localhost:${PORT}`;
const SIM_PORT = 4010;
const KEY = crypto.randomBytes(48).toString('hex');
const SECRET = crypto.randomBytes(48).toString('hex');
const env = {
  ...process.env, DATABASE_URL: DB_URL, NODE_ENV: 'development', PORT: String(PORT), SESSION_SECRET: SECRET,
  AZUL_ENV: 'test', AZUL_MERCHANT_ID: '39038540035', AZUL_AUTH_KEY: KEY, AZUL_MERCHANT_NAME: 'VENDO BOTE RD',
  AZUL_PAYMENT_URL: `http://localhost:${SIM_PORT}/PaymentPage/`, USD_DOP_RATE: '58.5', WRITE_LIMIT: '200',
  EMAIL_USER: '', EMAIL_PASS: '', ADMIN_EMAIL: '', AZUL_SIM_TAMPER: ''
};
// Para que las variables de entorno de la sesión en curso no afecten a los hijos ni al require local
Object.assign(process.env, { SESSION_SECRET: SECRET, AZUL_AUTH_KEY: KEY });
const session = require('../utils/session');
const { computeQuote } = require('../utils/booking-quote');

const pool = new Pool({ connectionString: DB_URL });
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const children = [];
let serverLog = '';
const results = [];
let failed = 0;

function check(name, expected, actual, ok) {
  const pass = ok === undefined ? JSON.stringify(expected) === JSON.stringify(actual) : ok;
  if (!pass) failed++;
  results.push({ name, expected, actual, pass });
  console.log(`${pass ? 'OK  ' : 'FALLA'} ${name} | esperado=${typeof expected === 'string' ? expected : JSON.stringify(expected)} | obtenido=${typeof actual === 'string' ? actual : JSON.stringify(actual)}`);
}

function launch(file, extraEnv, onOut) {
  const c = spawn(process.execPath, [file], { cwd: root, env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  c.stdout.on('data', (d) => onOut && onOut(String(d)));
  c.stderr.on('data', (d) => onOut && onOut(String(d)));
  children.push(c);
  return c;
}
async function waitFor(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { await fetch(url); return; } catch { await new Promise((r) => setTimeout(r, 300)); }
  }
  throw new Error('no respondió ' + url);
}

async function mkUser(tag, verified = true) {
  const email = `e2e-azul-${tag}-${crypto.randomBytes(3).toString('hex')}@test.invalid`;
  const [u] = await q(
    `INSERT INTO users (name, email, password_hash, phone, email_verified, profile_completed) VALUES ($1,$2,$3,'8095550000',$4,true) RETURNING *`,
    [`E2E ${tag}`, email, session.hashPassword('Prueba-e2e-1234'), verified]
  );
  return { ...u, cookie: `vbr_session=${makeToken(u)}` };
}
// createToken no se exporta: se firma igual que utils/session.js (HMAC-SHA256 con SESSION_SECRET)
function makeToken(u) {
  const b64 = (s) => Buffer.from(s).toString('base64url');
  const payload = b64(JSON.stringify({ uid: u.id, v: session.sessionVersion(u.password_hash), exp: Date.now() + 864e5 }));
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

async function api(method, url, { cookie, body } = {}) {
  const r = await fetch(BASE + url, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json, location: r.headers.get('location') };
}
const start = (u, b) => api('POST', '/api/payments/azul/start', { cookie: u && u.cookie, body: b });

// Envía el formulario al simulador, pulsa un botón y devuelve la URL de retorno (Location)
async function simPay(action, fields, simQuery = '') {
  const form = new URLSearchParams(fields);
  const r1 = await fetch(action + simQuery, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
  const html = await r1.text();
  const token = (html.match(/name="token" value="([0-9a-f]+)"/) || [])[1];
  return { status: r1.status, html, token };
}
async function simClick(token, kind) {
  const r = await fetch(`http://localhost:${SIM_PORT}/PaymentPage/finish`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token, action: kind }) });
  return r.headers.get('location');
}
async function ret(locationUrl) {
  const u = new URL(locationUrl);
  const r = await fetch(BASE + u.pathname + u.search, { redirect: 'manual' });
  const to = new URL(r.headers.get('location'), BASE);
  return { status: r.status, estado: to.searchParams.get('estado'), ref: to.searchParams.get('ref') };
}
const bookingByRef = async (ref) => (await q(`SELECT b.status, b.payment_status, b.payment_method, cp.status AS cp_status, cp.completed_at, cp.iso_code, cp.order_number
  FROM bookings b JOIN card_payments cp ON cp.booking_id = b.id WHERE b.booking_ref = $1`, [ref]))[0];
const availability = async (boatId, date, schedule) => {
  const r = await api('GET', `/api/boats/${boatId}/availability`);
  return r.json.some((x) => x.start_date === date && x.schedule === schedule);
};

(async () => {
  console.log('Iniciando simulador y servidor...');
  launch(path.join('scripts', 'azul-sim.js'), {}, () => {});
  launch('server.js', {}, (d) => { serverLog += d; });
  await waitFor(`http://localhost:${SIM_PORT}/health`);
  await waitFor(`${BASE}/api/payments/azul/config`);

  // Embarcación y turno cotizables
  const boats = await q('SELECT * FROM boats WHERE available = true ORDER BY id');
  let boat, schedule;
  for (const b of boats) for (const s of ['9am-3pm', '4pm-10pm', 'full-day']) {
    if (!boat && computeQuote(b, { start_date: '2027-06-08', schedule: s, guests: 2 }).ok) { boat = b; schedule = s; }
  }
  if (!boat) throw new Error('no hay embarcación cotizable');
  console.log(`Embarcación ${boat.id} (${boat.name}) turno ${schedule}`);
  let d = 0;
  const nextDate = () => `2027-06-${String(8 + 7 * 0 + d++).padStart(2, '0')}`; // 08..28, días distintos
  const body = (date, extra) => ({ boat_id: String(boat.id), start_date: date, schedule, guests: 2, accept_terms: true, ...(extra || {}) });

  const userA = await mkUser('a'), userB = await mkUser('b'), userC = await mkUser('c', false);
  const users = [userA, userB, userC];

  // --- 1. Validaciones de entrada
  let r = await start(null, body(nextDate()));
  check('Sin sesión → 401', 401, r.status);
  r = await start(userA, body(nextDate(), { accept_terms: undefined }));
  check('Sin accept_terms → 400', 400, r.status);
  r = await start(userA, body(nextDate(), { accept_terms: 'true' }));
  check('accept_terms como texto "true" (no booleano) → 400', 400, r.status);
  r = await start(userC, body(nextDate()));
  check('Correo sin verificar → 403 email_unverified', [403, 'email_unverified'], [r.status, r.json && r.json.code]);
  const noRows = (await q('SELECT COUNT(*)::int AS n FROM bookings WHERE user_id = ANY($1)', [users.map((u) => u.id)]))[0].n;
  check('Las validaciones fallidas no crean reservas', 0, noRows);

  // --- 2. El simulador valida la petición
  const dBad = nextDate();
  r = await start(userA, body(dBad));
  check('/start devuelve action del simulador y campos firmados', [200, true], [r.status, r.json && r.json.action === env.AZUL_PAYMENT_URL && !!r.json.fields.AuthHash]);
  const f0 = r.json.fields, ref0 = (await q(`SELECT booking_ref FROM bookings WHERE id=(SELECT booking_id FROM card_payments WHERE order_number=$1)`, [f0.OrderNumber]))[0].booking_ref;
  let s = await simPay(r.json.action, { ...f0, Amount: String(Number(f0.Amount) - 100) });
  check('Simulador rechaza petición con monto alterado (hash no coincide) → 400', 400, s.status, s.status === 400 && /AuthHash/.test(s.html));
  const { MerchantId, ...sinCampo } = f0;
  s = await simPay(r.json.action, sinCampo);
  check('Simulador rechaza petición con campo faltante → 400', 400, s.status);
  s = await simPay(r.json.action, { ...f0, AuthHash: 'a'.repeat(128) });
  check('Simulador rechaza AuthHash inválido → 400', 400, s.status);
  s = await simPay(r.json.action, f0);
  check('Simulador acepta la petición legítima y ofrece 3 botones', [200, 3, 0], [s.status, (s.html.match(/<button/g) || []).length, (s.html.match(/(card|cvv|vencim|name="pan")/gi) || []).length], s.status === 200 && (s.html.match(/<button/g) || []).length === 3 && !/(cardnumber|cvv|vencim)/i.test(s.html));
  // La reserva pendiente de esta sección se cancela desde el simulador
  await ret(await simClick(s.token, 'cancel'));
  check('Cancelar desde el simulador libera esa reserva', 'cancelled/cancelled', (await bookingByRef(ref0)).status + '/' + (await bookingByRef(ref0)).payment_status);

  // --- 3. Aprobada
  const dOk = nextDate();
  r = await start(userA, body(dOk));
  const refOk = (await q(`SELECT booking_ref FROM bookings WHERE id=(SELECT booking_id FROM card_payments WHERE order_number=$1)`, [r.json.fields.OrderNumber]))[0].booking_ref;
  let row = await bookingByRef(refOk);
  check('Tras /start: booking pending/card_pending y turno retenido', ['pending', 'card_pending', true], [row.status, row.payment_status, await availability(boat.id, dOk, schedule)]);
  s = await simPay(r.json.action, r.json.fields);
  const locOk = await simClick(s.token, 'approve');
  const logsBefore = (serverLog.match(/pago aprobado/g) || []).length;
  let rr = await ret(locOk);
  row = await bookingByRef(refOk);
  check('Aprobada → estado=aprobado y reserva confirmed/verified/card', ['aprobado', 'confirmed', 'verified', 'card', 'approved', '00'], [rr.estado, row.status, row.payment_status, row.payment_method, row.cp_status, row.iso_code]);
  check('Aprobada → turno ocupado en /api/boats/:id/availability', true, await availability(boat.id, dOk, schedule));
  check('Aprobada → el servidor registró un solo "pago aprobado"', logsBefore + 1, (serverLog.match(/pago aprobado/g) || []).length);
  // Repetir la URL
  const before = { ...row };
  rr = await ret(locOk);
  row = await bookingByRef(refOk);
  check('Repetir la URL aprobada → estado=aprobado, sin cambios en BD', [true, 'aprobado'], [String(row.completed_at) === String(before.completed_at) && row.payment_status === 'verified', rr.estado]);
  check('Repetir la URL aprobada → sin segundo "pago aprobado" (sin segundo correo)', logsBefore + 1, (serverLog.match(/pago aprobado/g) || []).length);
  // Otro usuario sobre el turno ya confirmado
  r = await start(userB, body(dOk));
  check('Segundo usuario, turno ya confirmado → 409', 409, r.status);

  // --- 4. Turno retenido (card_pending) → 409 para otro usuario
  const dHold = nextDate();
  const rA = await start(userA, body(dHold));
  const refHold = (await q(`SELECT booking_ref FROM bookings WHERE id=(SELECT booking_id FROM card_payments WHERE order_number=$1)`, [rA.json.fields.OrderNumber]))[0].booking_ref;
  r = await start(userB, body(dHold));
  check('Segundo usuario mientras hay card_pending → 409', [200, 409], [rA.status, r.status]);
  // y al declinar, el turno se libera y B puede tomarlo
  s = await simPay(rA.json.action, rA.json.fields);
  rr = await ret(await simClick(s.token, 'decline'));
  row = await bookingByRef(refHold);
  check('Declinada → estado=declinado, reserva cancelled/rejected, pago declined, IsoCode 05', ['declinado', 'cancelled', 'rejected', 'declined', '05'], [rr.estado, row.status, row.payment_status, row.cp_status, row.iso_code]);
  check('Declinada → turno liberado en availability', false, await availability(boat.id, dHold, schedule));
  r = await start(userB, body(dHold));
  check('Tras declinar, otro usuario puede reservar ese turno → 200', 200, r.status);
  // B lo cancela (también prueba la ruta cancelled con parámetros ausentes de la respuesta)
  s = await simPay(r.json.action, r.json.fields);
  const refB = (await q(`SELECT booking_ref FROM bookings WHERE id=(SELECT booking_id FROM card_payments WHERE order_number=$1)`, [r.json.fields.OrderNumber]))[0].booking_ref;
  rr = await ret(await simClick(s.token, 'cancel'));
  row = await bookingByRef(refB);
  check('Cancelada → estado=cancelado, reserva cancelled/cancelled, pago cancelled', ['cancelado', 'cancelled', 'cancelled', 'cancelled'], [rr.estado, row.status, row.payment_status, row.cp_status]);
  check('Cancelada → turno liberado en availability', false, await availability(boat.id, dHold, schedule));

  // --- 5. Monto alterado en la respuesta (hash válido para el monto original)
  const dAmt = nextDate();
  r = await start(userA, body(dAmt));
  const refAmt = (await q(`SELECT booking_ref FROM bookings WHERE id=(SELECT booking_id FROM card_payments WHERE order_number=$1)`, [r.json.fields.OrderNumber]))[0].booking_ref;
  s = await simPay(r.json.action, r.json.fields, '?tamper=amount');
  rr = await ret(await simClick(s.token, 'approve'));
  row = await bookingByRef(refAmt);
  check('Monto distinto con hash válido → no confirma (estado=revision, booking no confirmed/verified, pago needs_review)', ['revision', false, 'needs_review'], [rr.estado, row.status === 'confirmed' || row.payment_status === 'verified', row.cp_status]);
  // Monto cambiado después de firmar (el hash ya no coincide)
  const dAmtF = nextDate();
  r = await start(userB, body(dAmtF));
  const refAmtF = (await q(`SELECT booking_ref FROM bookings WHERE id=(SELECT booking_id FROM card_payments WHERE order_number=$1)`, [r.json.fields.OrderNumber]))[0].booking_ref;
  s = await simPay(r.json.action, r.json.fields, '?tamper=amountforged');
  rr = await ret(await simClick(s.token, 'approve'));
  row = await bookingByRef(refAmtF);
  check('Monto cambiado tras firmar (hash inválido) → no confirma', ['revision', false], [rr.estado, row.status === 'confirmed' || row.payment_status === 'verified']);
  check('Monto alterado → el servidor registró el aviso de revisión', true, /pago por revisar|monto de la respuesta distinto/.test(serverLog));

  // --- 6. Hash alterado
  const dHash = nextDate();
  r = await start(userA, body(dHash));
  const refHash = (await q(`SELECT booking_ref FROM bookings WHERE id=(SELECT booking_id FROM card_payments WHERE order_number=$1)`, [r.json.fields.OrderNumber]))[0].booking_ref;
  s = await simPay(r.json.action, r.json.fields, '?tamper=hash');
  rr = await ret(await simClick(s.token, 'approve'));
  row = await bookingByRef(refHash);
  check('Hash alterado → no confirma (estado=revision, sigue pending/card_pending, pago sin completar)', ['revision', 'pending', 'card_pending', false], [rr.estado, row.status, row.payment_status, row.cp_status === 'approved']);
  // Respuesta falsificada a mano, sin pasar por el simulador
  const forged = new URL(`${BASE}/api/payments/azul/approved/${r.json.fields.OrderNumber}`);
  Object.entries({ OrderNumber: r.json.fields.OrderNumber, Amount: r.json.fields.Amount, AuthorizationCode: '123456', DateTime: '20270101000000', ResponseCode: 'ISO8583', IsoCode: '00', ResponseMessage: 'APROBADA', ErrorDescription: '', RRN: '1', AuthHash: 'f'.repeat(128) }).forEach(([k, v]) => forged.searchParams.set(k, v));
  rr = await ret(forged.toString());
  row = await bookingByRef(refHash);
  check('Respuesta aprobada falsificada a mano (sin la clave) → no confirma', ['revision', 'pending'], [rr.estado, row.status]);
  rr = await ret(`${BASE}/api/payments/azul/approved/${r.json.fields.OrderNumber}`);
  row = await bookingByRef(refHash);
  check('URL aprobada sin parámetros → no confirma', ['revision', 'pending'], [rr.estado, row.status]);

  // --- 7. Expiración a 15 minutos
  const dExp = nextDate();
  r = await start(userA, body(dExp));
  const refExp = (await q(`SELECT booking_ref FROM bookings WHERE id=(SELECT booking_id FROM card_payments WHERE order_number=$1)`, [r.json.fields.OrderNumber]))[0].booking_ref;
  s = await simPay(r.json.action, r.json.fields);
  check('Antes de 15 min el turno sigue retenido', true, await availability(boat.id, dExp, schedule));
  await q(`UPDATE bookings SET created_at = NOW() - INTERVAL '16 minutes' WHERE booking_ref = $1`, [refExp]);
  check('Pasados 15 min → turno libre en availability', false, await availability(boat.id, dExp, schedule));
  row = await bookingByRef(refExp);
  check('Expirada → reserva cancelled/expired', ['cancelled', 'expired'], [row.status, row.payment_status]);
  r = await start(userB, body(dExp));
  check('Tras expirar, otro usuario puede reservar el turno → 200', 200, r.status);
  // Pago aprobado que llega tarde (ya expiró): no se pierde en silencio
  rr = await ret(await simClick(s.token, 'approve'));
  row = await bookingByRef(refExp);
  check('Aprobación tardía tras expirar → needs_review, la reserva NO se confirma', ['revision', 'needs_review', 'cancelled'], [rr.estado, row.cp_status, row.status]);

  // --- 8. Tope de reservas esperando (sanidad del contador) y /config
  const cfg = await api('GET', '/api/payments/azul/config');
  check('GET /config → enabled true con credenciales', true, cfg.json && cfg.json.enabled);

  // Seguridad: el servidor no registró la clave ni hashes
  check('Los logs del servidor no contienen AuthKey', false, serverLog.includes(KEY));
  check('Los logs del servidor no contienen AuthHash completos', false, /[0-9a-f]{128}/i.test(serverLog));
})()
  .catch((e) => { failed++; console.error('ERROR en la prueba:', e, '\n--- log servidor ---\n' + serverLog.slice(-1500)); })
  .finally(async () => {
    try {
      const ids = (await q(`SELECT id FROM users WHERE email LIKE 'e2e-azul-%@test.invalid'`)).map((x) => x.id);
      if (ids.length) {
        await q('DELETE FROM card_payments WHERE booking_id IN (SELECT id FROM bookings WHERE user_id = ANY($1))', [ids]);
        await q('DELETE FROM bookings WHERE user_id = ANY($1)', [ids]);
        await q('DELETE FROM users WHERE id = ANY($1)', [ids]);
      }
      const left = (await q(`SELECT COUNT(*)::int AS n FROM users WHERE email LIKE 'e2e-azul-%'`))[0].n;
      console.log(`Datos de prueba borrados (usuarios restantes de prueba: ${left}).`);
    } catch (e) { console.error('Error limpiando:', e.message); }
    await pool.end().catch(() => {});
    children.forEach((c) => { try { c.kill(); } catch {} });
    console.log(`\nResultado: ${results.filter((x) => x.pass).length}/${results.length} comprobaciones correctas, ${failed} fallo(s).`);
    process.exit(failed ? 1 : 0);
  });
