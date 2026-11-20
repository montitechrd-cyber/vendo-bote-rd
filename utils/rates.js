// Tasa del día USD → DOP. Se consulta a un servicio público, se guarda 1 hora en memoria y,
// si falla, se usa el último valor conocido. USD_DOP_RATE (variable de entorno) la fija a mano.
// Toda tasa debe estar dentro de [AZUL_RATE_MIN, AZUL_RATE_MAX] (por defecto 40 y 120): una tasa errónea
// (p. ej. 0.58 en vez de 58) se habría cobrado y confirmado sin alarma. Para COBRAR con tarjeta
// (opts.forCard) además: no se usa el respaldo de terceros ni una tasa de caché con más de 24 h.
const TTL_MS = 60 * 60 * 1000;
const CARD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let cache = null; // { rate, date, source, at, fetchedAt }

function bounds(env = process.env) {
  return { min: Number(env.AZUL_RATE_MIN) || 40, max: Number(env.AZUL_RATE_MAX) || 120 };
}
function inRange(rate, env = process.env) {
  const { min, max } = bounds(env);
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= min && rate <= max;
}

async function defaultGetJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function fetchRate(getJson) {
  try {
    const j = await getJson('https://open.er-api.com/v6/latest/USD');
    const rate = j && j.rates && Number(j.rates.DOP);
    if (inRange(rate)) return { rate, date: new Date().toISOString().slice(0, 10), source: 'open.er-api.com' };
  } catch {}
  // Respaldo con versión fija (no @latest). Solo para mostrar la tasa; nunca para cobrar con tarjeta.
  const j = await getJson('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@2024-03-06/v1/currencies/usd.json');
  const rate = j && j.usd && Number(j.usd.dop);
  if (!inRange(rate)) throw new Error('sin tasa válida');
  return { rate, date: j.date || new Date().toISOString().slice(0, 10), source: 'currency-api' };
}

// Devuelve { rate, date, source }; lanza si no hay ninguna tasa válida disponible.
// opts: { forCard, getJson, now } (getJson y now solo para pruebas)
async function getUsdDopRate(opts = {}) {
  const forCard = !!opts.forCard;
  const getJson = opts.getJson || defaultGetJson;
  const now = opts.now || Date.now;
  const manualRaw = process.env.USD_DOP_RATE;
  if (manualRaw !== undefined && manualRaw !== '' && Number(manualRaw) > 0) {
    const manual = Number(manualRaw);
    if (!inRange(manual)) throw new Error('USD_DOP_RATE fuera del rango permitido');
    return { rate: manual, date: new Date().toISOString().slice(0, 10), source: 'manual' };
  }
  try {
    if (!cache || now() - cache.at > TTL_MS) cache = { ...(await fetchRate(getJson)), at: now(), fetchedAt: now() };
  } catch (e) {
    if (cache) cache.at = now() - TTL_MS + 60000; // reintenta en 1 min, no en cada visita
    else throw new Error('No se pudo obtener la tasa del día');
  }
  if (forCard && (cache.source === 'currency-api' || now() - cache.fetchedAt > CARD_MAX_AGE_MS)) {
    throw new Error('No hay una tasa reciente y fiable para cobrar con tarjeta');
  }
  return { rate: cache.rate, date: cache.date, source: cache.source };
}

function _resetCache() { cache = null; }

module.exports = { getUsdDopRate, inRange, _resetCache };
