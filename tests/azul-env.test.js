const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAzulEnv } = require('../utils/azul-env');

test('quita espacios, saltos de línea y comillas pegados por error, sin revelar valores', () => {
  const env = { AZUL_ENV: 'prod', AZUL_MERCHANT_ID: ' 123456 \n', AZUL_AUTH_KEY: '"abc def​"' };
  const report = normalizeAzulEnv(env);
  assert.equal(env.AZUL_MERCHANT_ID, '123456');
  assert.equal(env.AZUL_AUTH_KEY, 'abcdef');
  assert.match(report, /AZUL_AUTH_KEY: 6 caracteres \(se quitaron/);
  assert.equal(report.includes('abcdef'), false);
  assert.equal(report.includes('123456'), false);
});

test('informa cuando falta una credencial', () => {
  assert.match(normalizeAzulEnv({}), /AZUL_MERCHANT_ID: falta · AZUL_AUTH_KEY: falta/);
});

test('la huella solo aparece en modo pruebas y nunca incluye la llave', () => {
  const env = { AZUL_MERCHANT_ID: '123', AZUL_AUTH_KEY: 'secreta-larga', AZUL_ENV: 'test' };
  assert.match(normalizeAzulEnv({ ...env }), /MerchantID=123, huella de la llave=[0-9a-f]{8}/);
  assert.equal(normalizeAzulEnv({ ...env }).includes('secreta-larga'), false);
  assert.equal(/huella/.test(normalizeAzulEnv({ ...env, AZUL_ENV: 'prod' })), false);
});
