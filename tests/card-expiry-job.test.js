const test = require('node:test');
const assert = require('node:assert/strict');
const { runCardExpiry } = require('../utils/card-expiry-job');

function dbWith(bookings, cps) {
  return { async query(sql) { return sql.includes('UPDATE bookings') ? bookings : cps; } };
}

test('runCardExpiry: con filas envía UN solo correo con todas', async () => {
  const sent = [];
  const email = { sendCardsExpiredUnconfirmed: async (rows) => { sent.push(rows); } };
  const db = dbWith([{ id: 1, booking_ref: 'VB-1' }, { id: 2, booking_ref: 'VB-2' }], [
    { order_number: '1', booking_id: 1, amount_dop_cents: '100' }, { order_number: '2', booking_id: 2, amount_dop_cents: '200' }]);
  const orig = console.error; console.error = () => {};
  try { const r = await runCardExpiry(db, email); assert.equal(r.length, 2); } finally { console.error = orig; }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 2);
});

test('runCardExpiry: sin filas no envía correo', async () => {
  let n = 0;
  await runCardExpiry(dbWith([], []), { sendCardsExpiredUnconfirmed: async () => { n++; } });
  assert.equal(n, 0);
});

test('runCardExpiry: un error de BD o de correo no se propaga', async () => {
  const orig = console.error; console.error = () => {};
  try {
    assert.deepEqual(await runCardExpiry({ async query() { throw new Error('bd caída'); } }, {}), []);
    const db = dbWith([{ id: 1, booking_ref: 'VB-1' }], [{ order_number: '1', booking_id: 1, amount_dop_cents: '1' }]);
    await runCardExpiry(db, { sendCardsExpiredUnconfirmed: async () => { throw new Error('smtp'); } });
    await runCardExpiry(db, { sendCardsExpiredUnconfirmed: () => { throw new Error('smtp sync'); } });
  } finally { console.error = orig; }
});
