// Prueba de punta a punta del pago con tarjeta (AZUL) contra Postgres LOCAL y el simulador.
//   E2E_DB_URL=postgresql://postgres:postgres@localhost:54341/vendobote node scripts/e2e-azul.js
// Lanza el simulador (4010) y el servidor (PORT 3011) con variables en línea, crea usuarios de prueba
// con correo verificado en la base local, recorre los escenarios por la API (sin navegador) y borra
// todos sus datos al terminar. Nunca se conecta a otra base que la local de desarrollo.
// Como solo puede haber UNA retención con tarjeta activa por usuario, cada escenario usa su propio usuario.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const { Pool } = require('pg');

const root = path.join(__dirname, '..');
const DB_URL = process.env.E2E_DB_URL || 'postgresql://postgres:postgres@localhost:54329/vendobote';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL)) { console.error('E2E_DB_URL debe apuntar a localhost'); process.exit(1); }
const PORT = 3011;
const BASE = `http://localhost:${PORT}`;
const RATE_PORT = 3012; // servidor con tasa fuera de rango y límite de /start bajo
const PROD_PORT = 3013; // app mínima con NODE_ENV=production y AZUL_ENV=test
const RAIL_PORT = 3014; // servidor con RAILWAY_ENVIRONMENT sin NODE_ENV
const SIM_PORT = 4010;
const KEY = crypto.randomBytes(48).toString('hex');
const SECRET = crypto.randomBytes(48).toString('hex');
const env = {
  ...process.env, DATABASE_URL: DB_URL, NODE_ENV: 'development', PORT: String(PORT), SESSION_SECRET: SECRET,
  AZUL_ENV: 'test', AZUL_MERCHANT_ID: '39038540035', AZUL_AUTH_KEY: KEY, AZUL_MERCHANT_NAME: 'VENDO BOTE RD',
  AZUL_PAYMENT_URL: `http://localhost:${SIM_PORT}/PaymentPage/`, USD_DOP_RATE: '58.5', WRITE_LIMIT: '200', AZUL_START_LIMIT: '1000',
  CARD_EXPIRY_INTERVAL_MS: '2000',
  EMAIL_USER: '', EMAIL_PASS: '', ADMIN_EMAIL: '', AZUL_SIM_TAMPER: '', RAILWAY_ENVIRONMENT: ''
};
// Para que las variables de entorno de la sesión en curso no afecten a los hijos ni al require local
Object.assign(process.env, { SESSION_SECRET: SECRET, AZUL_AUTH_KEY: KEY });
const session = require('../utils/session');
const { computeQuote } = require('../utils/booking-quote');

const pool = new Pool({ connectionString: DB_URL });
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const children = [];
let serverLog = '';
const logs = {}; // registro por puerto de los servidores auxiliares
const results = [];
let failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, expected, actual, ok) {
  const pass = ok === undefined ? JSON.stringify(expected) === JSON.stringify(actual) : ok;
  if (!pass) failed++;
  results.push({ name, expected, actual, pass });
  console.log(`${pass ? 'OK  ' : 'FALLA'} ${name} | esperado=${typeof expected === 'string' ? expected : JSON.stringify(expected)} | obtenido=${typeof actual === 'string' ? actual : JSON.stringify(actual)}`);
}

function launch(file, extraEnv, onOut) {
  const args = Array.isArray(file) ? file : [file];
  const c = spawn(process.execPath, args, { cwd: root, env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  c.stdout.on('data', (d) => onOut && onOut(String(d)));
  c.stderr.on('data', (d) => onOut && onOut(String(d)));
  children.push(c);
  return c;
}
async function waitFor(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { await fetch(url); return; } catch { await sleep(300); }
  }
  throw new Error('no respondió ' + url);
}
async function until(fn, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(300); }
  return false;
}

async function mkUser(tag, verified = true, role = 'user') {
  const email = `e2e-azul-${tag}-${crypto.randomBytes(3).toString('hex')}@test.invalid`;
  const [u] = await q(
    `INSERT INTO users (name, email, password_hash, phone, email_verified, profile_completed, role) VALUES ($1,$2,$3,'8095550000',$4,true,$5) RETURNING *`,
    [`E2E ${tag}`, email, session.hashPassword('Prueba-e2e-1234'), verified, role]
  );
  return { ...u, cookie: `vbr_session=${makeToken(u)}` };
}
// createToken no se exporta: se firma igual que utils/session.js (HMAC-SHA256 con SESSION_SECRET)
function makeToken(u) {
  const b64 = (s) => Buffer.from(s).toString('base64url');
  const payload = b64(JSON.stringify({ uid: u.id, v: session.sessionVersion(u.password_hash), exp: Date.now() + 864e5 }));
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

async function api(method, url, { cookie, body, base = BASE } = {}) {
  const r = await fetch(base + url, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json, location: r.headers.get('location'), headers: r.headers };
}
const start = (u, b, base) => api('POST', '/api/payments/azul/start', { cookie: u && u.cookie, body: b, base });

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
const refOf = async (orderNumber) => (await q('SELECT booking_ref FROM bookings WHERE id=(SELECT booking_id FROM card_payments WHERE order_number=$1)', [orderNumber]))[0].booking_ref;
const bookingByRef = async (ref) => (await q(`SELECT b.id, b.status, b.payment_status, b.payment_method, cp.status AS cp_status, cp.completed_at, cp.iso_code, cp.order_number
  FROM bookings b JOIN card_payments cp ON cp.booking_id = b.id WHERE b.booking_ref = $1`, [ref]))[0];
const availability = async (boatId, date, schedule) => {
  const r = await api('GET', `/api/boats/${boatId}/availability`);
  return r.json.some((x) => x.start_date === date && x.schedule === schedule);
};
const activeHolds = async (userId) => (await q("SELECT COUNT(*)::int AS n FROM bookings WHERE user_id=$1 AND status='pending' AND payment_status='card_pending'", [userId]))[0].n;

// App mínima con NODE_ENV=production y AZUL_ENV=test (la base local no admite SSL, que database.js exige en producción)
const PROD_APP = `
process.env.NODE_ENV = 'development';
const { init } = require('./database');
const express = require('express');
init().then(() => {
  process.env.NODE_ENV = 'production';
  const app = express(); app.use(express.json());
  app.use('/api/payments/azul', require('./routes/azul'));
  app.listen(Number(process.env.PORT), () => console.log('listo'));
}).catch((e) => { console.error(e); process.exit(1); });`;

(async () => {
  console.log('Iniciando simulador y servidores...');
  launch(path.join('scripts', 'azul-sim.js'), {}, () => {});
  launch('server.js', {}, (d) => { serverLog += d; });
  logs[RATE_PORT] = ''; logs[PROD_PORT] = ''; logs[RAIL_PORT] = '';
  launch('server.js', { PORT: String(RATE_PORT), USD_DOP_RATE: '0.58', AZUL_START_LIMIT: '3' }, (d) => { logs[RATE_PORT] += d; });
  launch(['-e', PROD_APP], { PORT: String(PROD_PORT), NODE_ENV: 'production', AZUL_ENV: 'test', AZUL_PAYMENT_URL: '', AZUL_ALLOW_TEST_IN_PROD: '' }, (d) => { logs[PROD_PORT] += d; });
  await waitFor(`http://localhost:${SIM_PORT}/health`);
  await waitFor(`${BASE}/api/payments/azul/config`);
  await waitFor(`http://localhost:${RATE_PORT}/api/payments/azul/config`);
  await waitFor(`http://localhost:${PROD_PORT}/api/payments/azul/config`);

  // Embarcación y turno cotizables
  const boats = await q('SELECT * FROM boats WHERE available = true ORDER BY id');
  let boat, schedule;
  for (const b of boats) for (const s of ['9am-3pm', '4pm-10pm', 'full-day']) {
    if (!boat && computeQuote(b, { start_date: '2027-06-08', schedule: s, guests: 2 }).ok) { boat = b; schedule = s; }
  }
  if (!boat) throw new Error('no hay embarcación cotizable');
  console.log(`Embarcación ${boat.id} (${boat.name}) turno ${schedule}`);
  let d = 0;
  const nextDate = () => { // fechas distintas, solo las cotizables
    for (;;) {
      const dt = new Date(Date.UTC(2027, 5, 8 + d++)).toISOString().slice(0, 10);
      if (computeQuote(boat, { start_date: dt, schedule, guests: 2 }).ok) return dt;
    }
  };
  const body = (date, extra) => ({ boat_id: String(boat.id), start_date: date, schedule, guests: 2, accept_terms: true, ...(extra || {}) });

  // --- 1. Validaciones de entrada
  const uVal = await mkUser('val'), uUnv = await mkUser('unv', false);
  let r = await start(null, body(nextDate()));
  check('Sin sesión → 401', 401, r.status);
  r = await start(uVal, body(nextDate(), { accept_terms: undefined }));
  check('Sin accept_terms → 400', 400, r.status);
  r = await start(uVal, body(nextDate(), { accept_terms: 'true' }));
  check('accept_terms como texto "true" (no booleano) → 400', 400, r.status);
  r = await start(uUnv, body(nextDate()));
  check('Correo sin verificar → 403 email_unverified', [403, 'email_unverified'], [r.status, r.json && r.json.code]);
  const noRows = (await q('SELECT COUNT(*)::int AS n FROM bookings WHERE user_id = ANY($1)', [[uVal.id, uUnv.id]]))[0].n;
  check('Las validaciones fallidas no crean reservas', 0, noRows);

  // --- 2. El simulador valida la petición
  const uSim = await mkUser('sim');
  r = await start(uSim, body(nextDate()));
  check('/start devuelve action del simulador y campos firmados', [200, true], [r.status, r.json && r.json.action === env.AZUL_PAYMENT_URL && !!r.json.fields.AuthHash]);
  const f0 = r.json.fields, ref0 = await refOf(f0.OrderNumber);
  check('Los campos firmados incluyen ShowTransactionResult=0', '0', f0.ShowTransactionResult);
  // ITBIS 18 %: Amount = base + ITBIS (tasa 58.5); card_payments guarda el total y el impuesto aparte
  const cp0 = (await q('SELECT amount_dop_cents, itbis_dop_cents, usd_total FROM card_payments WHERE order_number=$1', [f0.OrderNumber]))[0];
  const base0 = Math.round(Number(cp0.usd_total) * 58.5 * 100), itbis0 = Math.round(base0 * 0.18);
  check('Amount = base + ITBIS 18 % y el campo ITBIS = el impuesto', [String(base0 + itbis0), String(itbis0)], [String(Number(f0.Amount)), String(Number(f0.ITBIS))]);
  check('card_payments guarda el TOTAL con ITBIS y el impuesto', [base0 + itbis0, itbis0], [Number(cp0.amount_dop_cents), Number(cp0.itbis_dop_cents)]);
  let s = await simPay(r.json.action, { ...f0, Amount: String(Number(f0.Amount) - 100) });
  check('Simulador rechaza petición con monto alterado (hash no coincide) → 400', 400, s.status, s.status === 400 && /AuthHash/.test(s.html));
  const { MerchantId, ...sinCampo } = f0;
  s = await simPay(r.json.action, sinCampo);
  check('Simulador rechaza petición con campo faltante → 400', 400, s.status);
  s = await simPay(r.json.action, { ...f0, AuthHash: 'a'.repeat(128) });
  check('Simulador rechaza AuthHash inválido → 400', 400, s.status);
  s = await simPay(r.json.action, f0);
  check('Simulador acepta la petición legítima y ofrece 3 botones', [200, 3, 0], [s.status, (s.html.match(/<button/g) || []).length, (s.html.match(/(card|cvv|vencim|name="pan")/gi) || []).length], s.status === 200 && (s.html.match(/<button/g) || []).length === 3 && !/(cardnumber|cvv|vencim)/i.test(s.html));
  await ret(await simClick(s.token, 'cancel'));
  check('Cancelar desde el simulador libera esa reserva', 'cancelled/cancelled', (await bookingByRef(ref0)).status + '/' + (await bookingByRef(ref0)).payment_status);

  // --- 3. Aprobada
  const uOk = await mkUser('ok'), uOther = await mkUser('other');
  const dOk = nextDate();
  r = await start(uOk, body(dOk));
  const refOk = await refOf(r.json.fields.OrderNumber);
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
  const before = { ...row };
  rr = await ret(locOk);
  row = await bookingByRef(refOk);
  check('Repetir la URL aprobada → estado=aprobado, sin cambios en BD', [true, 'aprobado'], [String(row.completed_at) === String(before.completed_at) && row.payment_status === 'verified', rr.estado]);
  check('Repetir la URL aprobada → sin segundo "pago aprobado" (sin segundo correo)', logsBefore + 1, (serverLog.match(/pago aprobado/g) || []).length);
  r = await start(uOther, body(dOk));
  check('Segundo usuario, turno ya confirmado → 409', 409, r.status);

  // --- 4. Turno retenido (card_pending) → 409 para otro usuario
  const uH1 = await mkUser('h1'), uH2 = await mkUser('h2');
  const dHold = nextDate();
  const rA = await start(uH1, body(dHold));
  const refHold = await refOf(rA.json.fields.OrderNumber);
  r = await start(uH2, body(dHold));
  check('Segundo usuario mientras hay card_pending → 409', [200, 409], [rA.status, r.status]);
  s = await simPay(rA.json.action, rA.json.fields);
  rr = await ret(await simClick(s.token, 'decline'));
  row = await bookingByRef(refHold);
  check('Declinada → estado=declinado, reserva cancelled/rejected, pago declined, IsoCode 05', ['declinado', 'cancelled', 'rejected', 'declined', '05'], [rr.estado, row.status, row.payment_status, row.cp_status, row.iso_code]);
  check('Declinada → turno liberado en availability', false, await availability(boat.id, dHold, schedule));
  r = await start(uH2, body(dHold));
  check('Tras declinar, otro usuario puede reservar ese turno → 200', 200, r.status);
  s = await simPay(r.json.action, r.json.fields);
  const refB = await refOf(r.json.fields.OrderNumber);
  rr = await ret(await simClick(s.token, 'cancel'));
  row = await bookingByRef(refB);
  check('Cancelada → estado=cancelado, reserva cancelled/cancelled, pago cancelled', ['cancelado', 'cancelled', 'cancelled', 'cancelled'], [rr.estado, row.status, row.payment_status, row.cp_status]);
  check('Cancelada → turno liberado en availability', false, await availability(boat.id, dHold, schedule));

  // --- 5. Monto alterado en la respuesta (hash válido para el monto original)
  const uAmt = await mkUser('amt'), uAmtF = await mkUser('amtf');
  r = await start(uAmt, body(nextDate()));
  const refAmt = await refOf(r.json.fields.OrderNumber);
  s = await simPay(r.json.action, r.json.fields, '?tamper=amount');
  rr = await ret(await simClick(s.token, 'approve'));
  row = await bookingByRef(refAmt);
  check('Monto distinto con hash válido → no confirma (estado=revision, booking no confirmed/verified, pago needs_review)', ['revision', false, 'needs_review'], [rr.estado, row.status === 'confirmed' || row.payment_status === 'verified', row.cp_status]);
  r = await start(uAmtF, body(nextDate()));
  const refAmtF = await refOf(r.json.fields.OrderNumber);
  s = await simPay(r.json.action, r.json.fields, '?tamper=amountforged');
  rr = await ret(await simClick(s.token, 'approve'));
  row = await bookingByRef(refAmtF);
  check('Monto cambiado tras firmar (hash inválido) → no confirma', ['revision', false], [rr.estado, row.status === 'confirmed' || row.payment_status === 'verified']);
  check('Monto alterado → el servidor registró el aviso de revisión', true, /pago por revisar|monto de la respuesta distinto/.test(serverLog));

  // --- 6. Hash alterado
  const uHash = await mkUser('hash');
  const dHash = nextDate();
  r = await start(uHash, body(dHash));
  const refHash = await refOf(r.json.fields.OrderNumber);
  s = await simPay(r.json.action, r.json.fields, '?tamper=hash');
  rr = await ret(await simClick(s.token, 'approve'));
  row = await bookingByRef(refHash);
  check('Hash alterado → no confirma (estado=revision, sigue pending/card_pending, pago sin completar)', ['revision', 'pending', 'card_pending', false], [rr.estado, row.status, row.payment_status, row.cp_status === 'approved']);
  const forged = new URL(`${BASE}/api/payments/azul/approved/${r.json.fields.OrderNumber}`);
  Object.entries({ OrderNumber: r.json.fields.OrderNumber, Amount: r.json.fields.Amount, AuthorizationCode: '123456', DateTime: '20270101000000', ResponseCode: 'ISO8583', IsoCode: '00', ResponseMessage: 'APROBADA', ErrorDescription: '', RRN: '1', AuthHash: 'f'.repeat(128) }).forEach(([k, v]) => forged.searchParams.set(k, v));
  rr = await ret(forged.toString());
  row = await bookingByRef(refHash);
  check('Respuesta aprobada falsificada a mano (sin la clave) → no confirma', ['revision', 'pending'], [rr.estado, row.status]);
  rr = await ret(`${BASE}/api/payments/azul/approved/${r.json.fields.OrderNumber}`);
  row = await bookingByRef(refHash);
  check('URL aprobada sin parámetros → no confirma', ['revision', 'pending'], [rr.estado, row.status]);

  // --- 7. Expiración a 15 minutos (job periódico), expired_unconfirmed y aviso
  const uExp = await mkUser('exp'), uExp2 = await mkUser('exp2');
  const dExp = nextDate();
  r = await start(uExp, body(dExp));
  const ordExp = r.json.fields.OrderNumber;
  const refExp = await refOf(ordExp);
  s = await simPay(r.json.action, r.json.fields);
  check('Antes de 15 min el turno sigue retenido', true, await availability(boat.id, dExp, schedule));
  await q(`UPDATE bookings SET created_at = NOW() - INTERVAL '16 minutes' WHERE booking_ref = $1`, [refExp]);
  check('Pasados 15 min → turno libre en availability (sin depender del job)', false, await availability(boat.id, dExp, schedule));
  const expired = await until(async () => (await bookingByRef(refExp)).payment_status === 'expired');
  row = await bookingByRef(refExp);
  check('El job expira la reserva sola (sin ninguna petición) → cancelled/expired', ['cancelled', 'expired'], [row.status, row.payment_status], expired);
  check('Expiración → el cobro created pasa a expired_unconfirmed', 'expired_unconfirmed', row.cp_status);
  check('Expiración → el servidor registró el aviso con la orden y la referencia', true, serverLog.includes(`${refExp}/${ordExp}`));
  const adminReview = await mkUser('adm', true, 'admin');
  r = await api('GET', '/api/payments/azul/admin/review', { cookie: adminReview.cookie });
  const listed = Array.isArray(r.json) ? r.json.find((x) => x.order_number === ordExp) : null;
  check('GET /admin/review (admin) lista el cobro expired_unconfirmed sin datos sensibles', [200, 'expired_unconfirmed', true], [r.status, listed && listed.status, !!listed && !('authorization_code' in listed) && !('rrn' in listed)]);
  r = await api('GET', '/api/payments/azul/admin/review', { cookie: uExp.cookie });
  check('GET /admin/review sin ser admin → 403', 403, r.status);
  r = await api('GET', '/api/payments/azul/admin/review');
  check('GET /admin/review sin sesión → 401', 401, r.status);
  r = await start(uExp2, body(dExp));
  check('Tras expirar, otro usuario puede reservar el turno → 200', 200, r.status);
  rr = await ret(await simClick(s.token, 'approve'));
  row = await bookingByRef(refExp);
  check('Aprobación tardía tras expirar → needs_review, la reserva NO se confirma', ['revision', 'needs_review', 'cancelled'], [rr.estado, row.cp_status, row.status]);

  // --- 8. Una sola retención con tarjeta por usuario
  const uOne = await mkUser('one');
  r = await start(uOne, body(nextDate()));
  const first = r.status;
  r = await start(uOne, body(nextDate()));
  check('Segundo /start del mismo usuario → 409 "en curso"', [200, 409, 'Ya tienes un pago con tarjeta en curso. Complétalo o espera 15 minutos.'], [first, r.status, r.json && r.json.error]);
  const uPar = await mkUser('par');
  const dates = Array.from({ length: 20 }, () => nextDate());
  const par = await Promise.all(dates.map((dt) => start(uPar, body(dt))));
  const okCount = par.filter((x) => x.status === 200).length;
  check('20 /start en paralelo del mismo usuario → exactamente 1 reserva card_pending', [1, 19, 1], [okCount, par.filter((x) => x.status === 409).length, await activeHolds(uPar.id)]);

  // --- 9. Tope diario de intentos sin completar
  const uCap = await mkUser('cap');
  const codes = [];
  for (let i = 0; i < 5; i++) {
    const x = await start(uCap, body(nextDate()));
    codes.push(x.status);
    await ret(`${BASE}/api/payments/azul/cancelled/${x.json.fields.OrderNumber}`);
  }
  r = await start(uCap, body(nextDate()));
  check('5 pagos iniciados y cancelados en el día; el sexto → 429', [[200, 200, 200, 200, 200], 429], [codes, r.status]);

  // --- 10. No se borra la evidencia de cobros; verify-payment no aplica a tarjeta
  const bNeeds = await bookingByRef(refAmt);
  r = await api('DELETE', `/api/bookings/${bNeeds.id}`, { cookie: adminReview.cookie });
  const stillThere = (await q('SELECT COUNT(*)::int AS n FROM card_payments WHERE booking_id=$1', [bNeeds.id]))[0].n;
  check('DELETE de reserva con pago needs_review → 409 y el cobro sigue en la base', [409, 1], [r.status, stillThere]);
  const bExpired = await bookingByRef(refExp);
  r = await api('DELETE', `/api/bookings/${bExpired.id}`, { cookie: adminReview.cookie });
  check('DELETE de reserva con cobro needs_review (aprobación tardía) → 409', 409, r.status);
  const bDeclined = await bookingByRef(refHold);
  r = await api('DELETE', `/api/bookings/${bDeclined.id}`, { cookie: adminReview.cookie });
  const gone = (await q('SELECT COUNT(*)::int AS n FROM bookings WHERE id=$1', [bDeclined.id]))[0].n;
  check('DELETE de reserva con pago declinado (sin dinero) → 200 y se borra', [200, 0], [r.status, gone]);
  const bOk = await bookingByRef(refOk);
  r = await api('DELETE', `/api/bookings/${bOk.id}`, { cookie: adminReview.cookie });
  check('DELETE de reserva con pago aprobado → 409', 409, r.status);
  r = await api('PATCH', `/api/bookings/${bOk.id}/verify-payment`, { cookie: adminReview.cookie, body: { action: 'approve' } });
  const r2 = await api('PATCH', `/api/bookings/${bOk.id}/verify-payment`, { cookie: adminReview.cookie, body: { action: 'reject' } });
  const after = await bookingByRef(refOk);
  check('verify-payment (approve y reject) sobre reserva con tarjeta → 400 y no cambia', [400, 400, 'confirmed/verified'], [r.status, r2.status, after.status + '/' + after.payment_status]);
  const bHold = await q("SELECT id FROM bookings WHERE user_id=$1 AND payment_status='card_pending'", [uOne.id]);
  r = await api('PATCH', `/api/bookings/${bHold[0].id}/verify-payment`, { cookie: adminReview.cookie, body: { action: 'approve' } });
  const afterHold = await q('SELECT status, payment_status FROM bookings WHERE id=$1', [bHold[0].id]);
  check('verify-payment approve sobre reserva card_pending → 400 y sigue card_pending', [400, 'card_pending'], [r.status, afterHold[0].payment_status]);

  // --- 11. Tasa fuera de rango y límite de /start (servidor auxiliar con USD_DOP_RATE=0.58 y AZUL_START_LIMIT=3)
  const uRate = await mkUser('rate');
  const rateBase = `http://localhost:${RATE_PORT}`;
  const rcodes = [];
  for (let i = 0; i < 3; i++) rcodes.push((await start(uRate, body(nextDate()), rateBase)).status);
  const rateRows = (await q('SELECT COUNT(*)::int AS n FROM bookings WHERE user_id=$1', [uRate.id]))[0].n;
  check('Tasa 0.58 (fuera de rango) → /start 503 y sin crear reserva', [[503, 503, 503], 0], [rcodes, rateRows]);
  r = await start(uRate, body(nextDate()), rateBase);
  check('Límite de /start (AZUL_START_LIMIT=3): el cuarto intento → 429', 429, r.status);

  // --- 12. Producción con AZUL_ENV=test
  const uProd = await mkUser('prod');
  const prodBase = `http://localhost:${PROD_PORT}`;
  r = await start(uProd, body(nextDate()), prodBase);
  const prodRows = (await q('SELECT COUNT(*)::int AS n FROM bookings WHERE user_id=$1', [uProd.id]))[0].n;
  check('NODE_ENV=production con AZUL_ENV=test → /start 503 y sin reserva', [503, 0], [r.status, prodRows]);
  r = await api('GET', '/api/payments/azul/config', { base: prodBase });
  check('NODE_ENV=production con AZUL_ENV=test → /config enabled:false', false, r.json && r.json.enabled);
  const rail = launch('server.js', { PORT: String(RAIL_PORT), NODE_ENV: '', RAILWAY_ENVIRONMENT: 'production' }, (x) => { logs[RAIL_PORT] += x; });
  await until(() => rail.exitCode !== null || /fuerza NODE_ENV/.test(logs[RAIL_PORT]), 15000);
  check('RAILWAY_ENVIRONMENT sin NODE_ENV → el servidor fuerza production y avisa', true, /se fuerza NODE_ENV=production/.test(logs[RAIL_PORT]));

  // --- 13. /config y secretos
  const cfg = await api('GET', '/api/payments/azul/config');
  check('GET /config → enabled true con credenciales (desarrollo)', true, cfg.json && cfg.json.enabled);
  check('Los logs del servidor no contienen AuthKey', false, serverLog.includes(KEY));
  check('Los logs del servidor no contienen AuthHash completos', false, /[0-9a-f]{128}/i.test(serverLog));

  // --- 14. Limitador de las rutas de retorno: al pasar de 300 redirige (302) a revisión, no JSON 429
  let limited = null;
  for (let n = 0; n < 340 && !limited; n++) {
    const x = await fetch(`${BASE}/api/payments/azul/cancelled/999999999999`, { redirect: 'manual' });
    if (x.headers.get('retry-after') !== null) limited = x; // el limitador responde con Retry-After
  }
  check('Rutas de retorno superado el límite (300) → 302 a /pago-resultado.html?estado=revision (no JSON 429)', [302, '/pago-resultado.html?estado=revision'], [limited && limited.status, limited && limited.headers.get('location')]);
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
