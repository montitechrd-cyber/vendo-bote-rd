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

function hmacHex(text, authKey) {
  return crypto.createHmac('sha512', String(authKey)).update(Buffer.from(text, 'utf16le')).digest('hex');
}

const val = (o, k) => (o[k] === undefined || o[k] === null ? '' : String(o[k]));

function buildRequestHash(fields, authKey) {
  return hmacHex(REQUEST_ORDER.map((k) => val(fields, k)).join('') + authKey, authKey);
}

function buildResponseHash(params, authKey) {
  return hmacHex(RESPONSE_ORDER.map((k) => val(params, k)).join('') + authKey, authKey);
}

function verifyResponseHash(params, authKey) {
  if (!params || typeof params.AuthHash !== 'string' || !params.AuthHash) return false;
  const recibido = Buffer.from(params.AuthHash.toLowerCase(), 'utf8');
  const esperado = Buffer.from(buildResponseHash(params, authKey), 'utf8');
  if (recibido.length !== esperado.length) return false;
  return crypto.timingSafeEqual(recibido, esperado);
}

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
    Locale: o.locale === 'EN' ? 'EN' : 'ES',
    ShowTransactionResult: '0'
  };
  if (o.altMerchantName !== undefined && o.altMerchantName !== null && o.altMerchantName !== '') {
    const n = String(o.altMerchantName);
    if (n.length > 25 || /["\\']/.test(n)) throw new Error('AltMerchantName inválido');
    f.AltMerchantName = n;
  }
  f.AuthHash = buildRequestHash(f, o.authKey);
  return f;
}

function isApproved(params) {
  return !!params && params.IsoCode === '00';
}

module.exports = { AZUL_URLS, toAzulAmount, buildRequestHash, buildResponseHash, verifyResponseHash, buildPaymentFields, isApproved };
