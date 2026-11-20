process.env.SESSION_SECRET = 'secreto-de-prueba-largo-para-sesiones-0123456789';
const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../utils/session');
const { adminDenial } = require('../middleware/auth');

const exp = (tok) => JSON.parse(Buffer.from(tok.split('.')[0], 'base64url').toString()).exp;

test('sesión normal: 30 días y sin marca de 2FA', () => {
  const tok = s.createToken(1, 'h');
  const left = exp(tok) - Date.now();
  assert.ok(left > 29.9 * 864e5 && left <= 30 * 864e5);
  assert.equal(s.readToken(tok).mfa, null);
});
test('sesión de admin: máximo 12 horas', () => {
  const tok = s.createToken(1, 'h', { admin: true });
  const left = exp(tok) - Date.now();
  assert.ok(left > 11.9 * 3600e3 && left <= 12 * 3600e3, 'dura ' + left);
  assert.equal(s.readToken(tok).uid, 1);
});
test('la marca mfa va firmada: no se puede añadir ni cambiar', () => {
  const tok = s.createToken(1, 'h', { admin: true, mfa: s.mfaBinding('sec') });
  assert.equal(s.readToken(tok).mfa, s.mfaBinding('sec'));
  const [p, sig] = tok.split('.');
  const d = JSON.parse(Buffer.from(p, 'base64url').toString()); d.mfa = 'otra';
  const forged = Buffer.from(JSON.stringify(d)).toString('base64url') + '.' + sig;
  assert.equal(s.readToken(forged), null);
});
test('mfaBinding depende del secreto cifrado vigente', () => {
  assert.notEqual(s.mfaBinding('a'), s.mfaBinding('b'));
  assert.equal(s.mfaBinding('a'), s.mfaBinding('a'));
  assert.equal(s.mfaBinding(null), null);
});
test('adminDenial: usuario, admin sin 2FA, admin con 2FA sin marca y admin completo', () => {
  assert.equal(adminDenial(null).status, 401);
  assert.equal(adminDenial({ role: 'user' }).status, 403);
  assert.equal(adminDenial({ role: 'admin', totp_enabled: false }).body.code, 'totp_setup_required');
  const d = adminDenial({ role: 'admin', totp_enabled: true, mfaOk: false });
  assert.equal(d.status, 401); assert.equal(d.body.code, 'mfa_required');
  assert.equal(adminDenial({ role: 'admin', totp_enabled: true, mfaOk: true }), null);
});
