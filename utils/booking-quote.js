// Cotización y validación de una reserva (USD). Función pura: la usan la reserva por
// transferencia y el pago con tarjeta para que ambas cobren exactamente lo mismo.
const { isSlotClosed } = require('./booking-time');

const fail = (status, error) => ({ ok: false, status, error });

// Turnos válidos de una embarcación según su esquema de precios (los usan la reserva y el cambio de fecha)
function validSchedulesFor(boatRow) {
  const scheme = boatRow && boatRow.pricing_scheme ? JSON.parse(boatRow.pricing_scheme) : null;
  const dayBased = scheme?.type === 'day_based';
  return scheme?.time_slots?.length ? scheme.time_slots : ((scheme && !dayBased) ? ['full-day'] : ['9am-3pm', '4pm-10pm']);
}

// boatRow: fila de `boats`. body: { start_date, schedule, guests, package_hours, extra_hours, meal_addons, birthday_combo }
// (los valores pueden venir como texto, de un multipart). now: solo para pruebas.
function computeQuote(boatRow, body, now = new Date()) {
  let { start_date, schedule, guests, package_hours, extra_hours, meal_addons, birthday_combo } = body || {};
  if (typeof meal_addons === 'string') { try { meal_addons = JSON.parse(meal_addons); } catch { meal_addons = []; } }
  birthday_combo = birthday_combo === true || birthday_combo === 'true';

  const scheme = boatRow.pricing_scheme ? JSON.parse(boatRow.pricing_scheme) : null;

  // El turno válido depende del esquema de la embarcación
  const dayBased = scheme?.type === 'day_based';
  const validSchedules = validSchedulesFor(boatRow);
  if (!validSchedules.includes(schedule)) return fail(400, 'Turno inválido');

  const maxCapacity = scheme?.max_capacity || boatRow.capacity;
  if (birthday_combo === true && boatRow.location !== 'Boca Chica') return fail(400, 'El combo de cumpleaños solo aplica en Boca Chica');
  const guestsNum = Math.max(1, parseInt(guests, 10) || 1);
  if (guestsNum > maxCapacity) return fail(400, `Máximo ${maxCapacity} personas`);

  const start = new Date(start_date + 'T00:00:00');
  if (isNaN(start)) return fail(400, 'Fecha inválida');
  // Hora de República Dominicana: no se cotiza/reserva un turno que ya pasó ni con menos de 2 horas de antelación.
  if (isSlotClosed(start_date, schedule, now)) {
    return fail(400, 'Este turno ya no está disponible: hay que reservar al menos 2 horas antes del horario.');
  }

  let total = 0;
  const additionals = [];
  let additionalsPrice = 0;
  const metaParts = [];

  if (dayBased) {
    // Precio según el día de la semana (sáb/dom = fin de semana) y si lleva combo de cumpleaños.
    // Tarifa de fin de semana: solo sábado/domingo en la tarde (la mañana cuesta como entre semana).
    const weekend = [0, 6].includes(start.getDay()) && schedule === '4pm-10pm';
    const base = weekend ? scheme.prices.weekend : scheme.prices.weekday;
    total = base;
    metaParts.push(`${weekend ? 'Sábado/domingo (tarde)' : 'Tarifa normal'}: ${base}`);
    if (birthday_combo === true) {
      const withCombo = weekend ? scheme.prices.weekend_birthday : scheme.prices.weekday_birthday;
      total = withCombo;
      additionals.push('birthday_combo');
      additionalsPrice += withCombo - base;
      // Los domingos el combo no incluye la hora de jetski
      const comboItems = (scheme.birthday_combo || []).filter(i => !(start.getDay() === 0 && /jetski|jet ski/i.test(i)));
      metaParts.push(`Combo de cumpleaños (${comboItems.join(', ')})`);
    }
  } else if (scheme) {
    const pkg = (scheme.packages || []).find(p => p.hours === Number(package_hours)) || scheme.packages?.[0];
    if (!pkg) return fail(400, 'Paquete de horas inválido');
    total += pkg.price;
    metaParts.push(`Paquete ${pkg.hours}h: $${pkg.price}`);

    const extraH = scheme.extra_hour_price ? Math.min(12, Math.max(0, parseInt(extra_hours, 10) || 0)) : 0;
    if (extraH > 0) {
      const amt = extraH * scheme.extra_hour_price;
      total += amt;
      additionals.push('extra_hours');
      additionalsPrice += amt;
      metaParts.push(`${extraH}h extra: +$${amt}`);
    }

    if (scheme.overage_threshold && guestsNum > scheme.overage_threshold) {
      const overN = guestsNum - scheme.overage_threshold;
      const amt = overN * scheme.overage_price_per_person;
      total += amt;
      additionals.push('overage_guests');
      additionalsPrice += amt;
      metaParts.push(`${overN} persona(s) extra: +$${amt}`);
    }

    if (Array.isArray(meal_addons) && scheme.meal_addons?.length) {
      meal_addons.forEach(key => {
        const m = scheme.meal_addons.find(x => x.key === key);
        if (!m) return;
        const amt = m.per_person ? m.price * guestsNum : m.price;
        total += amt;
        additionals.push(m.key);
        additionalsPrice += amt;
        metaParts.push(`${m.name}: +$${amt}`);
      });
    }
  } else {
    total = boatRow.price_per_day;
    if (boatRow.location === 'Boca Chica') {
      metaParts.push('Todo incluido: 1h de Jet Ski, parrillada, agua, hielo, gasolina, tripulación y cocinero');
    }
  }

  return { ok: true, total, additionals, additionalsPrice, meta: metaParts.length ? metaParts.join(' · ') : null, guests: guestsNum };
}

module.exports = { computeQuote, validSchedulesFor };
