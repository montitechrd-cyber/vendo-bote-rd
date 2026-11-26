const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAzulEnv } = require('../utils/azul-env');

test('quita espacios, saltos de línea y comillas pegados por error, sin revelar valores', () => {
  const env = { AZUL_MERCHANT_ID: ' 123456 \n', AZUL_AUTH_KEY: '"abc def​"' };
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
