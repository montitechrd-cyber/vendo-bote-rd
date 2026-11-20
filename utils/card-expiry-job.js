// Tarea periódica: libera las retenciones con tarjeta vencidas y avisa al admin de los cobros por conciliar.
const { expireCardHolds } = require('./card-holds');

// Una pasada. Nunca lanza: los errores solo se registran. Devuelve las filas expiradas.
async function runCardExpiry(db, email) {
  try {
    const rows = await expireCardHolds(db);
    if (rows.length) {
      console.error(`AZUL: ${rows.length} cobro(s) con tarjeta expirados sin confirmar: ${rows.map((r) => `${r.booking_ref}/${r.order_number}`).join(', ')}`);
      try {
        const p = email.sendCardsExpiredUnconfirmed(rows);
        if (p && typeof p.catch === 'function') p.catch((e) => console.error('AZUL: fallo al enviar aviso de expiración:', e && e.message));
      } catch (e) { console.error('AZUL: fallo al enviar aviso de expiración:', e && e.message); }
    }
    return rows;
  } catch (e) {
    console.error('AZUL: error en la expiración de retenciones:', e && e.message);
    return [];
  }
}

function startCardExpiryJob(db, email, intervalMs = 60 * 1000) {
  const t = setInterval(() => { runCardExpiry(db, email); }, intervalMs);
  if (t.unref) t.unref();
  return t;
}

module.exports = { runCardExpiry, startCardExpiryJob };
