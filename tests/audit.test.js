const test = require('node:test');
const assert = require('node:assert/strict');
const { audit } = require('../utils/audit');

test('audit: inserta usuario, acción, entidad e IP', async () => {
  let args; const db = { async run(sql, p) { args = p; } };
  await audit(db, { user: { id: 3 }, ip: '1.2.3.4' }, 'booking.delete', 'booking', 55, 'ref VBR-1');
  assert.deepEqual(args, [3, 'booking.delete', 'booking', '55', '1.2.3.4', 'ref VBR-1']);
});
test('audit: omite detalles con pinta de dato sensible y recorta largos', async () => {
  const seen = []; const db = { async run(sql, p) { seen.push(p[5]); } };
  await audit(db, {}, 'x', 'e', 1, 'tarjeta 4111111111111111');
  await audit(db, {}, 'x', 'e', 1, 'password=abc');
  await audit(db, {}, 'x', 'e', 1, 'a'.repeat(500));
  assert.equal(seen[0], '[omitido]'); assert.equal(seen[1], '[omitido]'); assert.equal(seen[2].length, 200);
});
test('audit: un fallo de la base no rompe la acción', async () => {
  const db = { async run() { throw new Error('caída'); } };
  const orig = console.error; console.error = () => {};
  try { await audit(db, {}, 'x'); } finally { console.error = orig; }
});

test('allowEvent: deja pasar hasta N eventos por ventana y clave, y luego los frena', () => {
  const { allowEvent } = require('../utils/audit');
  const t0 = 1_000_000;
  const r = [1, 2, 3, 4].map((i) => allowEvent('k1', 3, 60000, t0 + i));
  assert.deepEqual(r, [true, true, true, false]);
  assert.equal(allowEvent('k2', 3, 60000, t0), true);          // otra clave no se ve afectada
  assert.equal(allowEvent('k1', 3, 60000, t0 + 60001), true);  // pasada la ventana vuelve a registrar
});
