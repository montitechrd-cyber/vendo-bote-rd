// Reglas para cambiar la fecha de una reserva (cliente y admin). Funciones puras: sin base de datos ni red.
// Las fechas son 'YYYY-MM-DD' y los turnos son las claves de siempre ('9am-3pm', '4pm-10pm', 'full-day', ...).
// Todo se calcula en hora de República Dominicana (utils/booking-time).
const { nowInDR, slotStartMinutes, isSlotClosed } = require('./booking-time');
const { validSchedulesFor } = require('./booking-quote');

const MIN_HOURS_NOTICE = 24;       // el cliente debe cambiar con 24 h o más de antelación
const CLIENT_WINDOW_DAYS = 90;     // el cliente: hasta 90 días después de la fecha original
const ADMIN_WINDOW_MONTHS = 6;     // el admin: hasta 6 meses después de la fecha original
const PRICE_DIFF_MSG = 'Ese turno cuesta más. Escríbenos por WhatsApp (+1 407 361 4042) para ajustar la diferencia.';
const FREE_REASONS = ['weather', 'authority', 'vendor']; // causas ajenas al cliente: sin regla de precio
const REASONS = [...FREE_REASONS, 'other'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const fail = (status, code, error) => ({ ok: false, status, code, error });
const OK = { ok: true };

function dayNumber(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function isRealDate(dateStr) {
  return DATE_RE.test(String(dateStr)) && addDays(dateStr, 0) === dateStr;
}
// Suma meses de calendario y recorta al último día del mes si hace falta (31 ene + 1 mes = 28/29 feb)
function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}
const dayOfWeek = (dateStr) => new Date(dayNumber(dateStr) * 86400000).getUTCDay(); // 0 = domingo

// Horas que faltan para el inicio de un turno (hora de RD); negativo si ya empezó.
function hoursUntilStart(dateStr, schedule, now = new Date()) {
  const dr = nowInDR(now);
  const startAbs = dayNumber(dateStr) * 1440 + slotStartMinutes(schedule);
  const nowAbs = dayNumber(dr.date) * 1440 + dr.minutes;
  return (startAbs - nowAbs) / 60;
}

// Categoría de precio de un turno: 'weekend' (sáb/dom en '4pm-10pm') o 'weekday'. Solo importa en esquemas day_based;
// en paquetes o precio fijo el precio no depende de la fecha y devuelve null.
function priceCategory(boat, dateStr, schedule) {
  const scheme = boat && boat.pricing_scheme ? JSON.parse(boat.pricing_scheme) : null;
  if (scheme?.type !== 'day_based') return null;
  return ([0, 6].includes(dayOfWeek(dateStr)) && schedule === '4pm-10pm') ? 'weekend' : 'weekday';
}
const RANK = { weekday: 0, weekend: 1 };
// true si el turno nuevo cuesta más que el original
function costsMore(boat, booking, newDate, newSchedule) {
  const a = priceCategory(boat, booking.start_date, booking.schedule);
  const b = priceCategory(boat, newDate, newSchedule);
  if (a === null || b === null) return false;
  return RANK[b] > RANK[a];
}

// Comprobaciones comunes al cliente y al admin
function baseChecks(booking, boat, newDate, newSchedule, now) {
  if (!booking || !boat) return fail(404, 'not_found', 'Reserva no encontrada');
  if (booking.status !== 'confirmed' || booking.payment_status !== 'verified') {
    return fail(400, 'not_eligible', 'Solo se puede cambiar la fecha de una reserva confirmada con el pago verificado.');
  }
  if (!isRealDate(newDate)) return fail(400, 'bad_date', 'Fecha inválida');
  if (!validSchedulesFor(boat).includes(newSchedule)) return fail(400, 'bad_schedule', 'Turno inválido');
  if (isSlotClosed(newDate, newSchedule, now)) {
    return fail(400, 'slot_closed', 'Ese turno ya no está disponible: hay que elegir uno con al menos 2 horas de antelación.');
  }
  if (newDate === booking.start_date && newSchedule === booking.schedule) {
    return fail(400, 'same_slot', 'Elige una fecha o un turno distinto al actual.');
  }
  return null;
}

// Cliente: una sola vez, 24 h o más antes del turno original, hasta 90 días después de la fecha original,
// misma embarcación (ya viene en `boat`), sin costo adicional.
function checkClientReschedule(booking, boat, newDate, newSchedule, now = new Date()) {
  const bad = baseChecks(booking, boat, newDate, newSchedule, now);
  if (bad) return bad;
  if (Number(booking.reschedule_count || 0) >= 1) {
    return fail(409, 'already_rescheduled', 'Esta reserva ya cambió de fecha una vez. Escríbenos por WhatsApp (+1 407 361 4042) si necesitas otro ajuste.');
  }
  if (hoursUntilStart(booking.start_date, booking.schedule, now) < MIN_HOURS_NOTICE) {
    return fail(409, 'too_late', 'Faltan menos de 24 horas para tu turno: ya no se puede cambiar la fecha desde aquí. Escríbenos por WhatsApp (+1 407 361 4042).');
  }
  if (newDate < booking.start_date) {
    return fail(400, 'before_original', 'La nueva fecha no puede ser anterior a la fecha original de tu reserva.');
  }
  if (newDate > addDays(booking.start_date, CLIENT_WINDOW_DAYS)) {
    return fail(400, 'out_of_window', 'La nueva fecha debe quedar dentro de los 90 días siguientes a la fecha original.');
  }
  if (costsMore(boat, booking, newDate, newSchedule)) return fail(409, 'price_difference', PRICE_DIFF_MSG);
  return OK;
}

// Admin: sin regla de 24 h ni límite de cambios; hasta 6 meses desde la fecha ORIGINAL de la reserva.
// Con motivo weather/authority/vendor tampoco aplica la regla de precio; con 'other' sí.
function checkAdminReschedule(booking, boat, newDate, newSchedule, reason, now = new Date()) {
  if (!REASONS.includes(reason)) return fail(400, 'bad_reason', 'Indica el motivo del cambio.');
  const bad = baseChecks(booking, boat, newDate, newSchedule, now);
  if (bad) return bad;
  const original = booking.original_start_date || booking.start_date;
  if (newDate > addMonths(original, ADMIN_WINDOW_MONTHS)) {
    return fail(400, 'out_of_window', 'La nueva fecha debe quedar dentro de los 6 meses siguientes a la fecha original.');
  }
  if (!FREE_REASONS.includes(reason) && costsMore(boat, booking, newDate, newSchedule)) {
    return fail(409, 'price_difference', PRICE_DIFF_MSG);
  }
  return OK;
}

// Estado del cambio de fecha para el panel del cliente: 'eligible' | 'done' | 'too_late' | null (nada que mostrar).
function clientRescheduleState(booking, now = new Date()) {
  if (!booking || booking.status !== 'confirmed' || booking.payment_status !== 'verified') return null;
  if (Number(booking.reschedule_count || 0) >= 1) return 'done';
  const h = hoursUntilStart(booking.start_date, booking.schedule, now);
  if (h < 0) return null;                    // el turno ya empezó o pasó
  return h >= MIN_HOURS_NOTICE ? 'eligible' : 'too_late';
}

module.exports = {
  MIN_HOURS_NOTICE, CLIENT_WINDOW_DAYS, ADMIN_WINDOW_MONTHS, REASONS, FREE_REASONS, PRICE_DIFF_MSG,
  addDays, addMonths, dayOfWeek, hoursUntilStart, priceCategory, costsMore,
  checkClientReschedule, checkAdminReschedule, clientRescheduleState,
};
