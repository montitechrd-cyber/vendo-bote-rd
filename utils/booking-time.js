// Reglas de horario de reservas, siempre en hora de República Dominicana
// (America/Santo_Domingo, UTC-4 todo el año; el servidor corre en UTC).
const TZ = 'America/Santo_Domingo';
const MIN_LEAD_MINUTES = 120; // hay que reservar al menos 2 horas antes del turno
const FULL_DAY_START_MINUTES = 8 * 60; // turno "full-day": se asume que sale a las 8:00 am

function nowInDR(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(now).map(p => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10) };
}

// '9am-3pm' -> 540, '4pm-10pm' -> 960, '8:30 am – 11:30 am' -> 510, 'full-day' -> 480
function slotStartMinutes(slotKey) {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(String(slotKey || ''));
  if (!m) return FULL_DAY_START_MINUTES;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toLowerCase() === 'pm') h += 12;
  return h * 60 + (m[2] ? parseInt(m[2], 10) : 0);
}

// true si ya no se puede reservar ese turno (fecha pasada o faltan menos de 2 horas)
function isSlotClosed(dateStr, slotKey, now = new Date()) {
  const dr = nowInDR(now);
  if (dateStr < dr.date) return true;
  if (dateStr > dr.date) return false;
  return dr.minutes > slotStartMinutes(slotKey) - MIN_LEAD_MINUTES;
}

module.exports = { nowInDR, slotStartMinutes, isSlotClosed, MIN_LEAD_MINUTES };
