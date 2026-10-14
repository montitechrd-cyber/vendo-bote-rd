// Tasa del día USD → DOP para que el cliente vea cuánto transferir en pesos.
// Se consulta a un servicio público, se guarda 1 hora en memoria y, si falla, se usa el último valor conocido.
// USD_DOP_RATE (variable de entorno) fija la tasa a mano si se quiere usar la del banco.
const express = require('express');
const router = express.Router();

const TTL_MS = 60 * 60 * 1000;
let cache = null; // { rate, date, source, at }

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function fetchRate() {
  try {
    const j = await getJson('https://open.er-api.com/v6/latest/USD');
    const rate = j && j.rates && Number(j.rates.DOP);
    if (rate > 0) return { rate, date: new Date().toISOString().slice(0, 10), source: 'open.er-api.com' };
  } catch {}
  const j = await getJson('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json');
  const rate = j && j.usd && Number(j.usd.dop);
  if (!(rate > 0)) throw new Error('sin tasa');
  return { rate, date: j.date || new Date().toISOString().slice(0, 10), source: 'currency-api' };
}

router.get('/usd-dop', async (req, res) => {
  const manual = Number(process.env.USD_DOP_RATE);
  if (manual > 0) return res.json({ rate: manual, date: new Date().toISOString().slice(0, 10), source: 'manual' });
  try {
    if (!cache || Date.now() - cache.at > TTL_MS) cache = { ...(await fetchRate()), at: Date.now() };
  } catch (e) {
    if (!cache) return res.status(503).json({ error: 'No se pudo obtener la tasa del día' });
  }
  res.set('Cache-Control', 'public, max-age=600');
  res.json({ rate: cache.rate, date: cache.date, source: cache.source });
});

module.exports = router;
