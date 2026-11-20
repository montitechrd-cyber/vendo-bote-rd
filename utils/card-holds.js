// Retención de turno mientras el cliente paga con tarjeta (AZUL).
const HOLD_MINUTES = 15;
// Estados de pago que ocupan el turno (el índice único de bookings usa la misma lista).
const SLOT_HOLDING_PAYMENT_STATUSES = ['card_pending', 'submitted', 'verified'];

// Libera los turnos retenidos con tarjeta que superaron los 15 minutos. Los cobros 'created' de esas
// reservas pasan a 'expired_unconfirmed' (el cliente pudo haber pagado sin que el retorno llegara) para
// que se concilien con el portal de AZUL. Devuelve las filas { order_number, booking_ref, amount_dop_cents } afectadas.
async function expireCardHolds(db) {
  const rows = await db.query(
    `UPDATE bookings SET status = 'cancelled', payment_status = 'expired'
     WHERE payment_status = 'card_pending' AND created_at < NOW() - ($1 * INTERVAL '1 minute')
     RETURNING id, booking_ref`,
    [HOLD_MINUTES]
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const cps = await db.query(
    `UPDATE card_payments SET status = 'expired_unconfirmed', completed_at = NOW()
     WHERE booking_id = ANY($1) AND status = 'created'
     RETURNING order_number, booking_id, amount_dop_cents`,
    [ids]
  );
  const refById = new Map(rows.map((r) => [r.id, r.booking_ref]));
  return (cps || []).map((c) => ({ order_number: c.order_number, booking_ref: refById.get(c.booking_id), amount_dop_cents: c.amount_dop_cents }));
}

module.exports = { HOLD_MINUTES, SLOT_HOLDING_PAYMENT_STATUSES, expireCardHolds };
