const test = require('node:test');
const assert = require('node:assert/strict');
const { expireCardHolds, HOLD_MINUTES } = require('../utils/card-holds');

test('expireCardHolds: sin vencidas no toca card_payments y devuelve []', async () => {
  const calls = [];
  const db = { async query(sql) { calls.push(sql); return []; } };
  assert.deepEqual(await expireCardHolds(db), []);
  assert.equal(calls.length, 1);
});

test('expireCardHolds: marca los cobros created como expired_unconfirmed y devuelve order_number y ref', async () => {
  const calls = [];
  const db = {
    async query(sql, p) {
      calls.push({ sql, p });
      if (sql.includes('UPDATE bookings')) return [{ id: 10, booking_ref: 'VB-1' }, { id: 11, booking_ref: 'VB-2' }];
      if (sql.includes('UPDATE card_payments')) return [{ order_number: '111111111111', booking_id: 10, amount_dop_cents: '5000' }];
      throw new Error('no previsto');
    },
  };
  const r = await expireCardHolds(db);
  assert.deepEqual(r, [{ order_number: '111111111111', booking_ref: 'VB-1', amount_dop_cents: '5000' }]);
  assert.equal(calls[0].p[0], HOLD_MINUTES);
  assert.deepEqual(calls[1].p[0], [10, 11]);
  assert.match(calls[1].sql, /expired_unconfirmed/);
  assert.match(calls[1].sql, /status = 'created'/);
});
