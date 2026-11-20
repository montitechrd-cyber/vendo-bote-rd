// Código corto y fácil de decir por teléfono: VB-4827
async function generateRef(db) {
  for (let digits = 4; digits <= 6; digits++) {
    const min = Math.pow(10, digits - 1), span = 9 * min;
    for (let i = 0; i < 40; i++) {
      const ref = 'VB-' + (min + Math.floor(Math.random() * span));
      const taken = await db.queryOne('SELECT 1 FROM bookings WHERE booking_ref = $1', [ref]);
      if (!taken) return ref;
    }
  }
  return 'VB-' + Date.now().toString().slice(-8);
}

module.exports = { generateRef };
