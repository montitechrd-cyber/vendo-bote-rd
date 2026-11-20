const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../utils/totp');

// Vectores de RFC 6238 (apéndice B), SHA-1, secreto ASCII "12345678901234567890", 8 dígitos
const SECRET = t.base32Encode(Buffer.from('12345678901234567890'));
test('RFC 6238: vectores SHA-1', () => {
  const v = { 59: '94287082', 1111111109: '07081804', 1111111111: '14050471', 1234567890: '89005924', 2000000000: '69279037', 20000000000: '65353130' };
  for (const [sec, code] of Object.entries(v)) assert.equal(t.totpAt(SECRET, Number(sec) * 1000, 8), code);
});
test('base32 ida y vuelta', () => {
  assert.equal(t.base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
  assert.equal(t.base32Decode('MZXW 6YTB-OI').toString(), 'foobar');
  const s = t.generateSecret(); assert.equal(s.length, 32); assert.equal(t.base32Encode(t.base32Decode(s)), s);
});
test('verifyTotp: ventana ±1, rechaza fuera de ventana y formatos raros', () => {
  const now = 1111111109000, code = t.totpAt(SECRET, now);
  assert.equal(t.verifyTotp(SECRET, code, { now }), t.stepAt(now));
  assert.equal(t.verifyTotp(SECRET, code, { now: now + 30000 }), t.stepAt(now));
  assert.equal(t.verifyTotp(SECRET, code, { now: now + 90000 }), null);
  assert.equal(t.verifyTotp(SECRET, '12345', { now }), null);
  assert.equal(t.verifyTotp(SECRET, 'abcdef', { now }), null);
  assert.equal(t.verifyTotp(SECRET, code.slice(0, 3) + ' ' + code.slice(3), { now }), t.stepAt(now));
});
test('verifyTotp: un código ya usado (mismo paso o anterior) no se acepta otra vez', () => {
  const now = 1111111109000, code = t.totpAt(SECRET, now), step = t.stepAt(now);
  assert.equal(t.verifyTotp(SECRET, code, { now, lastStep: step }), null);
  assert.equal(t.verifyTotp(SECRET, code, { now, lastStep: step - 1 }), step);
});
test('cifrado AES-256-GCM: ida y vuelta, no es el texto claro y detecta manipulación', () => {
  const enc = t.encryptSecret(SECRET, 'clave-larga-de-prueba');
  assert.ok(!enc.includes(SECRET));
  assert.equal(t.decryptSecret(enc, 'clave-larga-de-prueba'), SECRET);
  assert.throws(() => t.decryptSecret(enc, 'otra-clave'));
  assert.throws(() => t.decryptSecret(enc.slice(0, -2) + 'AA', 'clave-larga-de-prueba'));
});
test('códigos de recuperación: 10 distintos, hash estable e insensible a guiones y mayúsculas', () => {
  const c = t.newRecoveryCodes(); assert.equal(new Set(c).size, 10);
  assert.equal(t.hashRecovery(c[0], 'k'), t.hashRecovery(c[0].toLowerCase().replace('-', ' '), 'k'));
  assert.notEqual(t.hashRecovery(c[0], 'k'), t.hashRecovery(c[1], 'k'));
  assert.ok(t.looksLikeRecovery(c[0]) && !t.looksLikeRecovery('123456'));
});
test('reto del login: válido, manipulado y vencido', () => {
  const tok = t.signChallenge(7, 'abc', 'k');
  assert.deepEqual(t.readChallenge(tok, 'k'), { uid: 7, v: 'abc' });
  assert.equal(t.readChallenge(tok, 'otra'), null);
  assert.equal(t.readChallenge(tok.slice(0, -2) + 'xx', 'k'), null);
  assert.equal(t.readChallenge(t.signChallenge(7, 'abc', 'k', -1), 'k'), null);
});
test('otpauth', () => {
  const u = t.otpauthUrl('ABC', 'a@b.com');
  assert.match(u, /^otpauth:\/\/totp\/Vendo%20Bote%20RD:a%40b\.com\?secret=ABC&issuer=Vendo%20Bote%20RD/);
});
