const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../utils/reschedule');

// Hoy (RD): viernes 20-nov-2026, 8:00 am (12:00 UTC)
const NOW = new Date('2026-11-20T12:00:00Z');
const dayBased = { id: 1, location: 'Boca Chica', pricing_scheme: JSON.stringify({ type: 'day_based', prices: { weekday: 100, weekend: 150 } }) };
const packaged = { id: 2, location: 'Boca Chica', pricing_scheme: JSON.stringify({ type: 'packages', packages: [{ hours: 4, price: 300 }], time_slots: ['10am-4pm', '5pm-11pm'] }) };
const fixed = { id: 3, location: 'Punta Cana', pricing_scheme: null, price_per_day: 500 };
// martes 1-dic-2026 en la mañana (faltan ~11 días)
const base = (extra = {}) => ({ id: 9, status: 'confirmed', payment_status: 'verified', start_date: '2026-12-01', schedule: '9am-3pm', reschedule_count: 0, original_start_date: null, ...extra });

test('cliente: un cambio válido se acepta', () => {
  assert.deepEqual(R.checkClientReschedule(base(), dayBased, '2026-12-03', '9am-3pm', NOW), { ok: true });
});
test('cliente: con menos de 24 h no se puede', () => {
  const b = base({ start_date: '2026-11-21', schedule: '9am-3pm' }); // mañana 9am: faltan 25 h -> sí
  assert.equal(R.checkClientReschedule(b, dayBased, '2026-11-25', '9am-3pm', NOW).ok, true);
  const b2 = base({ start_date: '2026-11-21', schedule: '9am-3pm' });
  const nowLate = new Date('2026-11-21T14:00:00Z'); // 10:00 am del 21: el turno ya empezó
  assert.equal(R.checkClientReschedule(b2, dayBased, '2026-11-25', '9am-3pm', nowLate).code, 'too_late');
  const nowClose = new Date('2026-11-20T14:00:00Z'); // 10:00 am del 20: faltan 23 h
  const r = R.checkClientReschedule(b2, dayBased, '2026-11-25', '9am-3pm', nowClose);
  assert.equal(r.ok, false); assert.equal(r.code, 'too_late'); assert.equal(r.status, 409);
});
test('cliente: ya cambiada una vez', () => {
  const r = R.checkClientReschedule(base({ reschedule_count: 1 }), dayBased, '2026-12-03', '9am-3pm', NOW);
  assert.equal(r.code, 'already_rescheduled'); assert.equal(r.status, 409);
});
test('cliente: más de 90 días después de la fecha original', () => {
  assert.equal(R.checkClientReschedule(base(), dayBased, '2027-03-01', '9am-3pm', NOW).ok, true);  // 1-dic + 90 = 1-mar-2027
  const r = R.checkClientReschedule(base(), dayBased, '2027-03-02', '9am-3pm', NOW);
  assert.equal(r.ok, false); assert.equal(r.code, 'out_of_window');
});
test('cliente: no puede ir antes de la fecha original', () => {
  assert.equal(R.checkClientReschedule(base(), dayBased, '2026-11-30', '9am-3pm', NOW).code, 'before_original');
});
test('cliente: turno inválido para la embarcación', () => {
  assert.equal(R.checkClientReschedule(base(), dayBased, '2026-12-03', 'full-day', NOW).code, 'bad_schedule');
  assert.equal(R.checkClientReschedule(base({ schedule: '10am-4pm' }), packaged, '2026-12-03', '9am-3pm', NOW).code, 'bad_schedule');
  assert.equal(R.checkClientReschedule(base(), dayBased, '2026-12-03', 'cualquiera', NOW).code, 'bad_schedule');
  assert.equal(R.checkClientReschedule(base(), dayBased, '2026-13-45', '9am-3pm', NOW).code, 'bad_date');
});
test('cliente: turno pasado o a menos de 2 h', () => {
  // la reserva original es lejana pero el nuevo turno queda antes de hoy: bloquea por turno cerrado
  const b = base({ start_date: '2026-11-10' });
  assert.equal(R.checkClientReschedule(b, dayBased, '2026-11-19', '9am-3pm', NOW).code, 'slot_closed');
  // hoy 8:00 am: el turno 9am-3pm de hoy (9:00) queda a menos de 2 h
  const b2 = base({ start_date: '2026-11-20', schedule: '4pm-10pm' });
  assert.equal(R.checkClientReschedule(b2, dayBased, '2026-11-20', '9am-3pm', NOW).code, 'slot_closed');
});
test('cliente: entre semana -> fin de semana (tarde) cuesta más: price_difference', () => {
  // original martes 1-dic; nuevo sábado 5-dic 4pm-10pm
  const r = R.checkClientReschedule(base(), dayBased, '2026-12-05', '4pm-10pm', NOW);
  assert.equal(r.ok, false); assert.equal(r.status, 409); assert.equal(r.code, 'price_difference');
  assert.match(r.error, /Ese turno cuesta más/); assert.match(r.error, /\+1 407 361 4042/);
  // el sábado en la mañana cuesta como entre semana: permitido
  assert.equal(R.checkClientReschedule(base(), dayBased, '2026-12-05', '9am-3pm', NOW).ok, true);
});
test('cliente: fin de semana -> entre semana está permitido; fin de semana -> fin de semana también', () => {
  const sat = base({ start_date: '2026-12-05', schedule: '4pm-10pm' });
  assert.equal(R.checkClientReschedule(sat, dayBased, '2026-12-08', '4pm-10pm', NOW).ok, true);
  assert.equal(R.checkClientReschedule(sat, dayBased, '2026-12-12', '4pm-10pm', NOW).ok, true);
});
test('cliente: paquete y precio fijo no dependen de la fecha: permitido', () => {
  assert.equal(R.checkClientReschedule(base({ schedule: '10am-4pm' }), packaged, '2026-12-05', '5pm-11pm', NOW).ok, true);
  assert.equal(R.checkClientReschedule(base({ schedule: '9am-3pm' }), fixed, '2026-12-05', '4pm-10pm', NOW).ok, true);
});
test('cliente: reserva no verificada o no confirmada', () => {
  for (const extra of [{ payment_status: 'submitted' }, { payment_status: 'pending' }, { payment_status: 'card_pending' }, { status: 'cancelled' }, { status: 'pending' }]) {
    assert.equal(R.checkClientReschedule(base(extra), dayBased, '2026-12-03', '9am-3pm', NOW).code, 'not_eligible');
  }
});
test('cliente: mismo turno no es un cambio', () => {
  assert.equal(R.checkClientReschedule(base(), dayBased, '2026-12-01', '9am-3pm', NOW).code, 'same_slot');
});

test('admin: weather hasta 6 meses desde la fecha original, sin 24 h ni límite de cambios', () => {
  const b = base({ reschedule_count: 3, start_date: '2026-11-21', schedule: '9am-3pm' });
  const nowClose = new Date('2026-11-21T10:00:00Z'); // 6:00 am del 21: faltan 3 h
  assert.equal(R.checkAdminReschedule(b, dayBased, '2026-12-05', '4pm-10pm', 'weather', nowClose).ok, true);
  assert.equal(R.checkAdminReschedule(b, dayBased, '2027-05-21', '9am-3pm', 'weather', nowClose).ok, true);   // exactamente 6 meses
  const r = R.checkAdminReschedule(b, dayBased, '2027-05-22', '9am-3pm', 'weather', nowClose);
  assert.equal(r.ok, false); assert.equal(r.code, 'out_of_window');
});
test('admin: el tope de 6 meses cuenta desde la fecha original aunque ya se haya movido', () => {
  const b = base({ start_date: '2027-03-01', original_start_date: '2026-12-01' });
  assert.equal(R.checkAdminReschedule(b, dayBased, '2027-06-01', '9am-3pm', 'vendor', NOW).ok, true);
  assert.equal(R.checkAdminReschedule(b, dayBased, '2027-06-02', '9am-3pm', 'vendor', NOW).code, 'out_of_window');
});
test('admin: con motivo "other" aplica la regla de precio; weather/authority/vendor no', () => {
  for (const reason of ['weather', 'authority', 'vendor']) {
    assert.equal(R.checkAdminReschedule(base(), dayBased, '2026-12-05', '4pm-10pm', reason, NOW).ok, true);
  }
  assert.equal(R.checkAdminReschedule(base(), dayBased, '2026-12-05', '4pm-10pm', 'other', NOW).code, 'price_difference');
});
test('admin: motivo inválido, turno inválido y reserva no verificada', () => {
  assert.equal(R.checkAdminReschedule(base(), dayBased, '2026-12-03', '9am-3pm', 'porque si', NOW).code, 'bad_reason');
  assert.equal(R.checkAdminReschedule(base(), dayBased, '2026-12-03', 'full-day', 'weather', NOW).code, 'bad_schedule');
  assert.equal(R.checkAdminReschedule(base({ payment_status: 'submitted' }), dayBased, '2026-12-03', '9am-3pm', 'weather', NOW).code, 'not_eligible');
});

test('utilidades: addMonths recorta a fin de mes y hoursUntilStart usa hora de RD', () => {
  assert.equal(R.addMonths('2026-08-31', 6), '2027-02-28');
  assert.equal(R.addMonths('2026-11-20', 6), '2027-05-20');
  assert.equal(R.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(R.hoursUntilStart('2026-11-21', '9am-3pm', NOW), 25);
  assert.equal(R.hoursUntilStart('2026-11-21', 'full-day', NOW), 24);
});
test('estado para el panel: eligible, done, too_late o nada', () => {
  assert.equal(R.clientRescheduleState(base(), NOW), 'eligible');
  assert.equal(R.clientRescheduleState(base({ reschedule_count: 1 }), NOW), 'done');
  assert.equal(R.clientRescheduleState(base({ start_date: '2026-11-20', schedule: '4pm-10pm' }), NOW), 'too_late');
  assert.equal(R.clientRescheduleState(base({ start_date: '2026-11-19' }), NOW), null);
  assert.equal(R.clientRescheduleState(base({ payment_status: 'submitted' }), NOW), null);
});
