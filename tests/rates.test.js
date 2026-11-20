const test = require('node:test');
const assert = require('node:assert/strict');
const rates = require('../utils/rates');

const okJson = (dop) => async (url) => {
  if (url.includes('open.er-api.com')) return { rates: { DOP: dop } };
  throw new Error('respaldo caído');
};
const clean = () => { delete process.env.USD_DOP_RATE; rates._resetCache(); };

test('tasa 0.58 (fuera de rango) rechazada', async () => {
  clean();
  await assert.rejects(() => rates.getUsdDopRate({ forCard: true, getJson: okJson(0.58) }));
  clean();
});

test('tasa 58 aceptada', async () => {
  clean();
  const r = await rates.getUsdDopRate({ forCard: true, getJson: okJson(58) });
  assert.equal(r.rate, 58);
  assert.equal(r.source, 'open.er-api.com');
  clean();
});

test('límites configurables por entorno', async () => {
  clean();
  process.env.AZUL_RATE_MAX = '70';
  try {
    await assert.rejects(() => rates.getUsdDopRate({ getJson: okJson(90) }));
    assert.equal(rates.inRange(60), true);
    assert.equal(rates.inRange(71), false);
  } finally { delete process.env.AZUL_RATE_MAX; clean(); }
});

test('caché de más de 24 h rechazada para tarjeta, aceptada para mostrar', async () => {
  clean();
  let t = 1_000_000;
  const now = () => t;
  await rates.getUsdDopRate({ forCard: true, getJson: okJson(58), now }); // llena la caché
  t += 25 * 60 * 60 * 1000;
  const caido = async () => { throw new Error('sin red'); };
  await assert.rejects(() => rates.getUsdDopRate({ forCard: true, getJson: caido, now }));
  const r = await rates.getUsdDopRate({ getJson: caido, now }); // la ruta pública sigue sirviendo la última conocida
  assert.equal(r.rate, 58);
  clean();
});

test('el respaldo de terceros no sirve para cobrar con tarjeta', async () => {
  clean();
  const soloRespaldo = async (url) => {
    if (url.includes('open.er-api.com')) throw new Error('caído');
    assert.ok(!url.includes('@latest'), 'el respaldo debe tener versión fija');
    return { date: '2024-03-06', usd: { dop: 58.9 } };
  };
  await assert.rejects(() => rates.getUsdDopRate({ forCard: true, getJson: soloRespaldo }));
  clean();
  const r = await rates.getUsdDopRate({ getJson: soloRespaldo });
  assert.equal(r.source, 'currency-api');
  clean();
});

test('USD_DOP_RATE manual fuera de rango se rechaza; dentro se acepta', async () => {
  clean();
  process.env.USD_DOP_RATE = '0.58';
  await assert.rejects(() => rates.getUsdDopRate({ forCard: true }));
  process.env.USD_DOP_RATE = '58.5';
  assert.equal((await rates.getUsdDopRate({ forCard: true })).rate, 58.5);
  clean();
});
