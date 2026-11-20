// Simulador LOCAL de la Página de Pago de AZUL (solo desarrollo y pruebas).
//   node scripts/azul-sim.js      → http://localhost:4010/PaymentPage/
// Recibe el POST del formulario, valida el AuthHash de la petición con la misma función que usa el
// servidor (utils/azul.js, nunca una copia del algoritmo), muestra un resumen con tres botones
// (Aprobar / Declinar / Cancelar, sin campos de tarjeta) y redirige por GET a la URL de retorno con
// los parámetros de respuesta firmados con buildResponseHash.
//
// Pruebas de seguridad: AZUL_SIM_TAMPER (o ?tamper=... en la URL del formulario) altera la respuesta:
//   hash          → AuthHash corrupto
//   amount        → monto distinto al cobrado pero firmado con hash VÁLIDO (el servidor debe comparar el monto guardado)
//   amountforged  → monto cambiado después de firmar (el hash ya no coincide)
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const azul = require('../utils/azul');

const PORT = Number(process.env.AZUL_SIM_PORT) || 4010;
const BASE = '/PaymentPage/';
const PENDING_TTL_MS = 30 * 60 * 1000;
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];
const pending = new Map(); // token → { fields, tamper, at }

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Campos que AZUL exige siempre con valor; los de "UseCustomField" pueden ser '0'/'1' y los demás campos personalizados pueden ir vacíos.
const REQUIRED = ['MerchantId', 'MerchantName', 'MerchantType', 'CurrencyCode', 'OrderNumber', 'Amount', 'ITBIS',
  'ApprovedUrl', 'DeclinedUrl', 'CancelUrl', 'UseCustomField1', 'UseCustomField2', 'AuthHash'];

function page(title, body, status = 200) {
  return { status, html: `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#f3f4f6;margin:0;padding:24px;color:#111}main{max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 12px #0002}
h1{font-size:20px;margin:0 0 4px}.tag{display:inline-block;background:#fde68a;color:#78350f;font-size:12px;padding:2px 8px;border-radius:99px;margin-bottom:12px}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:16px 0}dt{color:#555}dd{margin:0;font-weight:600}
button{font-size:16px;padding:12px;border:0;border-radius:8px;cursor:pointer;width:100%;margin-top:8px;color:#fff}.ok{background:#15803d}.no{background:#b91c1c}.cx{background:#4b5563}.err{color:#b91c1c}</style></head><body><main>${body}</main></body></html>` };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 100000) { reject(new Error('demasiado grande')); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function validateRequest(fields) {
  for (const k of REQUIRED) if (fields[k] === undefined || fields[k] === '') return `Falta el campo ${k}`;
  if (!/^\d{3,}$/.test(fields.Amount)) return 'Amount inválido (debe ser entero en centavos)';
  const key = process.env.AZUL_AUTH_KEY;
  if (!key) return 'El simulador no tiene AZUL_AUTH_KEY configurada';
  if (process.env.AZUL_MERCHANT_ID && fields.MerchantId !== process.env.AZUL_MERCHANT_ID) return 'MerchantId no coincide con el de pruebas';
  const a = Buffer.from(String(fields.AuthHash).toLowerCase());
  const b = Buffer.from(azul.buildRequestHash(fields, key));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'AuthHash de la petición no coincide: la solicitud fue alterada o la clave es distinta';
  for (const u of ['ApprovedUrl', 'DeclinedUrl', 'CancelUrl']) {
    try { if (!LOCAL_HOSTS.includes(new URL(fields[u]).hostname)) return `${u} debe apuntar a localhost en el simulador`; }
    catch { return `${u} no es una URL válida`; }
  }
  return null;
}

function money(cents) {
  const c = String(cents).padStart(3, '0');
  return `RD$ ${Number(c.slice(0, -2)).toLocaleString('es-DO')}.${c.slice(-2)}`;
}

function buildResult(fields, kind, tamper) {
  const approved = kind === 'approve';
  const p = {
    OrderNumber: fields.OrderNumber,
    Amount: fields.Amount, // el mismo recibido
    AuthorizationCode: approved ? String(Math.floor(100000 + Math.random() * 900000)) : '',
    DateTime: new Date().toISOString().replace(/\D/g, '').slice(0, 14),
    ResponseCode: 'ISO8583',
    IsoCode: approved ? '00' : '05',
    ResponseMessage: approved ? 'APROBADA' : 'DECLINADA',
    ErrorDescription: '',
    RRN: approved ? String(Math.floor(1e11 + Math.random() * 9e11)) : ''
  };
  if (tamper === 'amount') p.Amount = String(BigInt(p.Amount) + 100n); // se firma el monto distinto
  p.AuthHash = azul.buildResponseHash(p, process.env.AZUL_AUTH_KEY);
  if (tamper === 'amountforged') p.Amount = String(BigInt(p.Amount) + 100n); // hash del monto original, monto distinto
  if (tamper === 'hash') p.AuthHash = p.AuthHash.replace(/^./, (c) => (c === '0' ? '1' : '0'));
  return p;
}

const validTamper = (v) => (['hash', 'amount', 'amountforged'].includes(v) ? v : null);

const server = http.createServer(async (req, res) => {
  const send = (r) => { res.writeHead(r.status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(r.html); };
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
    if (url.pathname !== BASE && url.pathname !== BASE + 'Default.aspx' && url.pathname !== BASE + 'finish') {
      return send(page('No encontrado', '<h1>No encontrado</h1>', 404));
    }

    if (url.pathname === BASE + 'finish' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      const entry = pending.get(form.get('token'));
      const action = form.get('action');
      if (!entry || !['approve', 'decline', 'cancel'].includes(action)) return send(page('Sesión vencida', '<h1 class="err">Sesión de pago no válida o vencida</h1>', 400));
      pending.delete(form.get('token'));
      const f = entry.fields;
      const dest = action === 'approve' ? f.ApprovedUrl : action === 'decline' ? f.DeclinedUrl : f.CancelUrl;
      const target = new URL(dest);
      if (action !== 'cancel') {
        const p = buildResult(f, action, entry.tamper);
        for (const [k, v] of Object.entries(p)) target.searchParams.set(k, v);
      }
      res.writeHead(302, { Location: target.toString(), 'Cache-Control': 'no-store' });
      return res.end();
    }

    if (req.method !== 'POST') return send(page('Simulador AZUL', '<span class="tag">SIMULADOR LOCAL</span><h1>Página de Pago (simulada)</h1><p>Espera un POST con el formulario de pago.</p>', 405));
    const fields = Object.fromEntries(new URLSearchParams(await readBody(req)));
    const problem = validateRequest(fields);
    if (problem) {
      console.error('[azul-sim] petición rechazada:', problem, 'OrderNumber=' + (fields.OrderNumber || '-'));
      return send(page('Error', `<span class="tag">SIMULADOR LOCAL</span><h1 class="err">No se puede procesar el pago</h1><p>${esc(problem)}</p>`, 400));
    }
    const tamper = validTamper(url.searchParams.get('tamper')) || validTamper(process.env.AZUL_SIM_TAMPER);
    const token = crypto.randomBytes(16).toString('hex');
    pending.set(token, { fields, tamper, at: Date.now() });
    for (const [t, e] of pending) if (Date.now() - e.at > PENDING_TTL_MS) pending.delete(t);
    const btn = (action, cls, label) => `<form method="post" action="${BASE}finish"><input type="hidden" name="token" value="${token}"><input type="hidden" name="action" value="${action}"><button class="${cls}">${label}</button></form>`;
    send(page('Pago simulado', `<span class="tag">SIMULADOR LOCAL · sin tarjeta</span><h1>${esc(fields.MerchantName)}</h1>
<dl><dt>Reserva</dt><dd>${esc(fields.CustomField1Value)}</dd><dt>Monto</dt><dd>${money(fields.Amount)}</dd><dt>ITBIS</dt><dd>${money(fields.ITBIS)}</dd><dt>Orden</dt><dd>${esc(fields.OrderNumber)}</dd></dl>
${btn('approve', 'ok', 'Aprobar')}${btn('decline', 'no', 'Declinar')}${btn('cancel', 'cx', 'Cancelar')}`));
  } catch (e) {
    console.error('[azul-sim] error:', e.message);
    send(page('Error', '<h1 class="err">Error del simulador</h1>', 500));
  }
});

// Escucha solo en 127.0.0.1 y se niega a arrancar si el host configurado no es local o si la base de datos es remota
// (firma con el AZUL_AUTH_KEY del .env: con una base de producción aprobaría reservas reales sin pago).
function assertLocalOnly(env = process.env) {
  const host = env.AZUL_SIM_HOST || 'localhost';
  if (!LOCAL_HOSTS.includes(host)) throw new Error(`el simulador solo puede escuchar en localhost (AZUL_SIM_HOST=${host})`);
  if (env.DATABASE_URL) {
    let h = '';
    try { h = new URL(env.DATABASE_URL).hostname; } catch { throw new Error('DATABASE_URL no es válida'); }
    if (!LOCAL_HOSTS.includes(h)) throw new Error('el simulador no se inicia con una base de datos remota');
  }
}

if (require.main === module) {
  try { assertLocalOnly(); } catch (e) { console.error('[azul-sim] ' + e.message); process.exit(1); }
  server.listen(PORT, '127.0.0.1', () => console.log(`[azul-sim] Simulador AZUL en http://localhost:${PORT}${BASE}`));
}
module.exports = { server, validateRequest, assertLocalOnly };
