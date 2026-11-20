// Tarea periódica: libera las retenciones con tarjeta vencidas y avisa al admin de los cobros por conciliar.
const { expireCardHolds, setExpiryNotifier } = require('./card-holds');

// Registra en el log y avisa por correo (sin esperar y sin lanzar) de los cobros expirados sin confirmar.
function reportExpired(email, rows) {
  if (!rows || !rows.length) return;
  console.error(`AZUL: ${rows.length} cobro(s) con tarjeta expirados sin confirmar: ${rows.map((r) => `${r.booking_ref}/${r.order_number}`).join(', ')}`);
  try {
    const p = email.sendCardsExpiredUnconfirmed(rows);
    if (p && typeof p.catch === 'function') p.catch((e) => console.error('AZUL: fallo al enviar aviso de expiración:', e && e.message));
  } catch (e) { console.error('AZUL: fallo al enviar aviso de expiración:', e && e.message); }
}

// Una pasada. Nunca lanza: los errores solo se registran. Devuelve las filas expiradas.
async function runCardExpiry(db, email) {
  try {
    const rows = await expireCardHolds(db, { notify: false }); // el aviso lo hace esta función
    reportExpired(email, rows);
    return rows;
  } catch (e) {
    console.error('AZUL: error en la expiración de retenciones:', e && e.message);
    return [];
  }
}

function startCardExpiryJob(db, email, intervalMs = 60 * 1000) {
  // Las expiraciones que ocurran dentro de /start o POST /api/bookings también avisan al admin.
  setExpiryNotifier((rows) => reportExpired(email, rows));
  const t = setInterval(() => { runCardExpiry(db, email); }, intervalMs);
  if (t.unref) t.unref();
  return t;
}

module.exports = { runCardExpiry, startCardExpiryJob, reportExpired };
