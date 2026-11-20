const test = require('node:test');
const assert = require('node:assert/strict');
const { assertLocalOnly } = require('../scripts/azul-sim');

test('B3: el simulador solo arranca en localhost y con base local', () => {
  assert.doesNotThrow(() => assertLocalOnly({}));
  assert.doesNotThrow(() => assertLocalOnly({ AZUL_SIM_HOST: '127.0.0.1', DATABASE_URL: 'postgresql://u:p@localhost:54341/x' }));
  assert.throws(() => assertLocalOnly({ AZUL_SIM_HOST: '0.0.0.0' }), /localhost/);
  assert.throws(() => assertLocalOnly({ DATABASE_URL: 'postgresql://u:p@db.example.com:5432/x' }), /remota/);
});
