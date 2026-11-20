const test = require('node:test');
const assert = require('node:assert');
const { computeQuote } = require('../utils/booking-quote');

// Fecha lejana para que nunca esté "cerrada"; 2030-06-03 es lunes, 2030-06-08 sábado, 2030-06-09 domingo
const MON = '2030-06-03', SAT = '2030-06-08', SUN = '2030-06-09';
const NOW = new Date('2030-01-01T12:00:00Z');

const dayBoat = {
  location: 'Boca Chica', capacity: 10, price_per_day: 1,
  pricing_scheme: JSON.stringify({
    type: 'day_based', time_slots: ['9am-3pm', '4pm-10pm'], max_capacity: 10,
    prices: { weekday: 300, weekend: 400, weekday_birthday: 500, weekend_birthday: 650 },
    birthday_combo: ['Pastel', 'Hora de jetski', 'Decoración'],
  }),
};
const pkgBoat = {
  location: 'Santo Domingo', capacity: 12, price_per_day: 1,
  pricing_scheme: JSON.stringify({
    packages: [{ hours: 4, price: 500 }, { hours: 8, price: 900 }],
    extra_hour_price: 100, overage_threshold: 8, overage_price_per_person: 20, max_capacity: 12,
    meal_addons: [
      { key: 'lunch', name: 'Almuerzo', price: 15, per_person: true },
      { key: 'cake', name: 'Pastel', price: 50, per_person: false },
    ],
  }),
};
const fixedBoat = { location: 'Boca Chica', capacity: 6, price_per_day: 750, pricing_scheme: null };

test('day_based: entre semana, fin de semana (solo tarde) y combo', () => {
  assert.strictEqual(computeQuote(dayBoat, { start_date: MON, schedule: '4pm-10pm', guests: 4 }, NOW).total, 300);
  assert.strictEqual(computeQuote(dayBoat, { start_date: SAT, schedule: '4pm-10pm', guests: 4 }, NOW).total, 400);
  assert.strictEqual(computeQuote(dayBoat, { start_date: SAT, schedule: '9am-3pm', guests: 4 }, NOW).total, 300);
  const c = computeQuote(dayBoat, { start_date: MON, schedule: '9am-3pm', guests: 4, birthday_combo: 'true' }, NOW);
  assert.strictEqual(c.total, 500);
  assert.strictEqual(c.additionalsPrice, 200);
  assert.deepStrictEqual(c.additionals, ['birthday_combo']);
  assert.match(c.meta, /Combo de cumpleaños \(Pastel, Hora de jetski, Decoración\)/);
  const d = computeQuote(dayBoat, { start_date: SUN, schedule: '4pm-10pm', guests: 4, birthday_combo: true }, NOW);
  assert.strictEqual(d.total, 650);
  assert.doesNotMatch(d.meta, /jetski/i);
});

test('paquetes: extras, personas extra y comidas', () => {
  const q = computeQuote(pkgBoat, {
    start_date: MON, schedule: 'full-day', guests: 10, package_hours: '8', extra_hours: '2',
    meal_addons: JSON.stringify(['lunch', 'cake', 'nope']),
  }, NOW);
  // 900 + 2*100 + 2*20 + 15*10 + 50
  assert.strictEqual(q.ok, true);
  assert.strictEqual(q.total, 900 + 200 + 40 + 150 + 50);
  assert.strictEqual(q.additionalsPrice, 440);
  assert.deepStrictEqual(q.additionals, ['extra_hours', 'overage_guests', 'lunch', 'cake']);
  assert.strictEqual(q.guests, 10);
  assert.match(q.meta, /^Paquete 8h: \$900 · 2h extra: \+\$200 · 2 persona\(s\) extra: \+\$40/);
  // paquete desconocido → primero
  assert.strictEqual(computeQuote(pkgBoat, { start_date: MON, schedule: 'full-day', guests: 2, package_hours: '99' }, NOW).total, 500);
});

test('precio fijo', () => {
  const q = computeQuote(fixedBoat, { start_date: MON, schedule: '9am-3pm', guests: 2 }, NOW);
  assert.strictEqual(q.total, 750);
  assert.match(q.meta, /^Todo incluido/);
  assert.strictEqual(computeQuote({ ...fixedBoat, location: 'Samaná' }, { start_date: MON, schedule: '9am-3pm', guests: 2 }, NOW).meta, null);
});

test('errores de validación', () => {
  const bad = (boat, body, status, error) => assert.deepStrictEqual(computeQuote(boat, { start_date: MON, schedule: '9am-3pm', guests: 2, ...body }, NOW), { ok: false, status, error });
  bad(fixedBoat, { schedule: 'madrugada' }, 400, 'Turno inválido');
  bad(fixedBoat, { guests: 7 }, 400, 'Máximo 6 personas');
  bad(pkgBoat, { schedule: 'full-day', birthday_combo: 'true' }, 400, 'El combo de cumpleaños solo aplica en Boca Chica');
  bad(fixedBoat, { start_date: '2029-12-31' }, 400, 'Este turno ya no está disponible: hay que reservar al menos 2 horas antes del horario.');
  bad(pkgBoat, { schedule: 'full-day', start_date: 'xx' }, 400, 'Fecha inválida');
  bad({ ...pkgBoat, pricing_scheme: JSON.stringify({ packages: [] }) }, { schedule: 'full-day' }, 400, 'Paquete de horas inválido');
});
