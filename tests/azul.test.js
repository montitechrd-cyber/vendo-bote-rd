const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const azul = require('../utils/azul');

const hmac = (s, k) => crypto.createHmac('sha512', k).update(Buffer.from(s, 'utf8')).digest('hex');

test('toAzulAmount: centavos exactos', () => {
  assert.equal(azul.toAzulAmount(17483.21), '1748321');
  assert.equal(azul.toAzulAmount(10), '1000');
  assert.equal(azul.toAzulAmount(0), '000');
  assert.equal(azul.toAzulAmount(0.1 + 0.2), '030');
  assert.throws(() => azul.toAzulAmount(-1));
  assert.throws(() => azul.toAzulAmount(NaN));
  assert.throws(() => azul.toAzulAmount(Infinity));
});

const ORDER = ['MerchantId', 'MerchantName', 'MerchantType', 'CurrencyCode', 'OrderNumber', 'Amount', 'ITBIS',
  'ApprovedUrl', 'DeclinedUrl', 'CancelUrl', 'UseCustomField1', 'CustomField1Label', 'CustomField1Value',
  'UseCustomField2', 'CustomField2Label', 'CustomField2Value'];

test('buildRequestHash: UTF-8 (como el ejemplo de AZUL) HMAC-SHA512 hex minuscula en el orden del manual', () => {
  const f = {};
  ORDER.forEach((k, i) => { f[k] = 'v' + i; });
  f.CustomField2Label = '';
  f.CustomField2Value = '';
  const esperado = hmac(ORDER.map((k) => f[k]).join('') + 'k', 'k');
  assert.equal(azul.buildRequestHash(f, 'k'), esperado);
  assert.match(esperado, /^[0-9a-f]{128}$/);
  assert.equal(azul.buildRequestHash(f, 'k'), esperado.toLowerCase());
});

const RORDER = ['OrderNumber', 'Amount', 'AuthorizationCode', 'DateTime', 'ResponseCode', 'IsoCode',
  'ResponseMessage', 'ErrorDescription', 'RRN'];

function respuesta(key) {
  const p = { OrderNumber: 'VB1', Amount: '1000', AuthorizationCode: 'OK1234', DateTime: '20261120120000',
    ResponseCode: 'ISO8583', IsoCode: '00', ResponseMessage: 'APROBADA', ErrorDescription: '', RRN: '123' };
  p.AuthHash = hmac(RORDER.map((k) => p[k]).join('') + key, key).toUpperCase();
  return p;
}

test('verifyResponseHash', () => {
  const p = respuesta('clave');
  assert.equal(azul.buildResponseHash(p, 'clave'), p.AuthHash.toLowerCase());
  assert.equal(azul.verifyResponseHash(p, 'clave'), true);
  assert.equal(azul.verifyResponseHash({ ...p, Amount: '1001' }, 'clave'), false);
  assert.equal(azul.verifyResponseHash(p, 'otra'), false);
  const sin = { ...p }; delete sin.AuthHash;
  assert.equal(azul.verifyResponseHash(sin, 'clave'), false);
  assert.equal(azul.verifyResponseHash({ ...p, AuthHash: 'abc' }, 'clave'), false);
});

test('buildResponseHash: campos ausentes cuentan como vacio', () => {
  const p = respuesta('clave');
  delete p.ErrorDescription;
  assert.equal(azul.verifyResponseHash(p, 'clave'), true);
});

const base = () => ({ merchantId: '390', merchantName: 'VendoBote', orderNumber: 'VB1', amountDop: 17483.21,
  itbisDop: 0, approvedUrl: 'https://x/a', declinedUrl: 'https://x/d', cancelUrl: 'https://x/c',
  authKey: 'k', bookingRef: 'R-1' });

test('buildPaymentFields', () => {
  const f = azul.buildPaymentFields(base());
  assert.equal(f.Amount, '1748321');
  assert.equal(f.ITBIS, '000');
  assert.equal(f.MerchantType, 'ECommerce');
  assert.equal(f.CurrencyCode, '$');
  assert.equal(f.UseCustomField1, '1');
  assert.equal(f.CustomField1Label, 'Reserva');
  assert.equal(f.CustomField1Value, 'R-1');
  assert.equal(f.UseCustomField2, '0');
  assert.equal(f.AuthHash, azul.buildRequestHash(f, 'k'));
  assert.equal(f.AuthKey, undefined);
  assert.equal(f.ShowTransactionResult, '0');
  // ShowTransactionResult no entra en el hash
  const g = { ...f }; delete g.ShowTransactionResult;
  assert.equal(azul.buildRequestHash(g, 'k'), f.AuthHash);
});

test('buildPaymentFields: AltMerchantName valido y limites', () => {
  assert.equal(azul.buildPaymentFields({ ...base(), altMerchantName: 'Vendo Bote RD' }).AltMerchantName, 'Vendo Bote RD');
  for (const n of ['a"b', 'a\\b', "a'b", 'x'.repeat(26)]) {
    assert.throws(() => azul.buildPaymentFields({ ...base(), altMerchantName: n }));
  }
  assert.doesNotThrow(() => azul.buildPaymentFields({ ...base(), altMerchantName: 'x'.repeat(25) }));
});

test('verifyResponseHash acepta tambien la respuesta firmada en UNICODE (UTF-16LE)', () => {
  const p = respuesta('clave');
  const unicode = azul.buildResponseHash(p, 'clave', 'utf16le');
  assert.notEqual(unicode, azul.buildResponseHash(p, 'clave'));
  assert.equal(azul.verifyResponseHash({ ...p, AuthHash: unicode }, 'clave'), true);
});

test('datos del tarjetahabiente para 3D Secure: limpios, opcionales y fuera del hash', () => {
  const sin = azul.buildPaymentFields(base());
  assert.equal('CardHolderName' in sin, false);
  const con = azul.buildPaymentFields({ ...base(), cardHolder: { name: 'Ana "<b>" P', email: 'ana@x.com', phone: '8095550000' } });
  assert.equal(con.CardHolderName, 'Ana b P');
  assert.equal(con.CardHolderEmail, 'ana@x.com');
  assert.equal(con.CardHolderPhoneMobile, '8095550000');
  assert.equal(con.AuthHash, sin.AuthHash);
});

test('isApproved', () => {
  assert.equal(azul.isApproved({ IsoCode: '00' }), true);
  assert.equal(azul.isApproved({ IsoCode: '05' }), false);
  assert.equal(azul.isApproved({}), false);
});
