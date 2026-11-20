// Tasa del día USD → DOP para que el cliente vea cuánto transferir en pesos.
// La lógica (consulta, caché de 1 hora, USD_DOP_RATE manual) vive en utils/rates.js.
const express = require('express');
const { getUsdDopRate } = require('../utils/rates');
const router = express.Router();

router.get('/usd-dop', async (req, res) => {
  try {
    const r = await getUsdDopRate();
    if (r.source !== 'manual') res.set('Cache-Control', 'public, max-age=600');
    res.json({ rate: r.rate, date: r.date, source: r.source });
  } catch (e) {
    res.status(503).json({ error: 'No se pudo obtener la tasa del día' });
  }
});

module.exports = router;
