// Retención de turno mientras el cliente paga con tarjeta (AZUL).
const HOLD_MINUTES = 15;
// Estados de pago que ocupan el turno (el índice único de bookings usa la misma lista).
const SLOT_HOLDING_PAYMENT_STATUSES = ['card_pending', 'submitted', 'verified'];

// Libera los turnos retenidos con tarjeta que superaron los 15 minutos. Devuelve cuántos liberó.
async function expireCardHolds(db) {
  const r = await db.run(
    `UPDATE bookings SET status = 'cancelled', payment_status = 'expired'
     WHERE payment_status = 'card_pending' AND created_at < NOW() - ($1 * INTERVAL '1 minute')`,
    [HOLD_MINUTES]
  );
  return r.rowCount || 0;
}

module.exports = { HOLD_MINUTES, SLOT_HOLDING_PAYMENT_STATUSES, expireCardHolds };
