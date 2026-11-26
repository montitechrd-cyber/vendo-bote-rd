// Núcleo puro de la Página de Pago AZUL: montos en centavos y firma HMAC-SHA512.
// Nunca maneja datos de tarjeta. No registrar AuthKey ni AuthHash de la clave.
const crypto = require('node:crypto');

const AZUL_URLS = {
  test: 'https://pruebas.azul.com.do/PaymentPage/',
  prod: 'https://pagos.azul.com.do/PaymentPage/Default.aspx',
  prodAlt: 'https://contpagos.azul.com.do/PaymentPage/Default.aspx'
};

const REQUEST_ORDER = ['MerchantId', 'MerchantName', 'MerchantType', 'CurrencyCode', 'OrderNumber', 'Amount', 'ITBIS',
  'ApprovedUrl', 'DeclinedUrl', 'CancelUrl', 'UseCustomField1', 'CustomField1Label', 'CustomField1Value',
  'UseCustomField2', 'CustomField2Label', 'CustomField2Value'];

const RESPONSE_ORDER = ['OrderNumber', 'Amount', 'AuthorizationCode', 'DateTime', 'ResponseCode', 'IsoCode',
  'ResponseMessage', 'ErrorDescription', 'RRN'];

function toAzulAmount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Monto inválido para AZUL');
  }
  const cents = Math.round(Number(value.toFixed(2)) * 100);
  return String(cents).padStart(3, '0');
}

// El manual 2026 admite UTF-8 o UNICODE (UTF-16LE). El ejemplo de cálculo que entrega AZUL usa UTF-8.
function hmacHex(text, authKey, encoding = 'utf8') {
  return crypto.createHmac('sha512', String(authKey)).update(Buffer.from(text, encoding)).digest('hex');
}

const val = (o, k) => (o[k] === undefined || o[k] === null ? '' : String(o[k]));

function buildRequestHash(fields, authKey) {
  return hmacHex(REQUEST_ORDER.map((k) => val(fields, k)).join('') + authKey, authKey);
}

function buildResponseHash(params, authKey, encoding = 'utf8') {
  return hmacHex(RESPONSE_ORDER.map((k) => val(params, k)).join('') + authKey, authKey, encoding);
}

// El manual dice que la respuesta se firma desde una cadena UNICODE y su ejemplo de envío usa UTF-8: se
// aceptan ambas codificaciones. Las dos exigen conocer la AuthKey, así que no debilita la verificación.
function verifyResponseHash(params, authKey) {
  if (!params || typeof params.AuthHash !== 'string' || !params.AuthHash) return false;
  const recibido = Buffer.from(params.AuthHash.toLowerCase(), 'utf8');
  let ok = false;
  for (const encoding of ['utf8', 'utf16le']) {
    const esperado = Buffer.from(buildResponseHash(params, authKey, encoding), 'utf8');
    if (recibido.length === esperado.length && crypto.timingSafeEqual(recibido, esperado)) ok = true;
  }
  return ok;
}

// Datos del tarjetahabiente para 3D Secure (no entran en el hash). Sin comillas ni barras invertidas.
const cleanHolder = (v, max) => String(v == null ? '' : v).replace(/["'\\<>]/g, '').trim().slice(0, max);

function buildPaymentFields(o) {
  const f = {
    MerchantId: o.merchantId,
    MerchantName: o.merchantName,
    MerchantType: 'ECommerce',
    CurrencyCode: '$',
    OrderNumber: o.orderNumber,
    Amount: toAzulAmount(o.amountDop),
    ITBIS: toAzulAmount(o.itbisDop),
    ApprovedUrl: o.approvedUrl,
    DeclinedUrl: o.declinedUrl,
    CancelUrl: o.cancelUrl,
    UseCustomField1: '1',
    CustomField1Label: 'Reserva',
    CustomField1Value: String(o.bookingRef),
    UseCustomField2: '0',
    CustomField2Label: '',
    CustomField2Value: '',
    // ShowTransactionResult '0' (fuera del hash): AZUL redirige directo al retorno, sin pantalla propia; reduce el abandono.
    ShowTransactionResult: '0',
    Locale: o.locale === 'EN' ? 'EN' : 'ES'
  };
  if (o.altMerchantName !== undefined && o.altMerchantName !== null && o.altMerchantName !== '') {
    const n = String(o.altMerchantName);
    if (n.length > 25 || /["\\']/.test(n)) throw new Error('AltMerchantName inválido');
    f.AltMerchantName = n;
  }
  const holder = o.cardHolder || {};
  const name = cleanHolder(holder.name, 96), mail = cleanHolder(holder.email, 254), phone = cleanHolder(holder.phone, 32);
  if (name) f.CardHolderName = name;
  if (mail) f.CardHolderEmail = mail;
  if (phone) f.CardHolderPhoneMobile = phone;
  f.AuthHash = buildRequestHash(f, o.authKey);
  return f;
}

function isApproved(params) {
  return !!params && params.IsoCode === '00';
}

module.exports = { AZUL_URLS, toAzulAmount, buildRequestHash, buildResponseHash, verifyResponseHash, buildPaymentFields, isApproved };
