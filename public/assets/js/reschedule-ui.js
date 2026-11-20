/* Modal para cambiar la fecha de una reserva. Lo usan el panel del cliente (dashboard.js) y el del admin (admin.js).
   Se construye con el DOM y textContent (nada de innerHTML con datos). El servidor decide siempre al enviar:
   aquí solo se ayuda a elegir (turnos ocupados, rango de fechas, turno que costaría más). */
(function () {
  const V = window.VBR;
  const WA = 'https://wa.me/14073614042';
  const WA_CODES = ['price_difference', 'too_late', 'already_rescheduled'];
  const REASONS = [['weather', 'Clima o condiciones de mar'], ['authority', 'Autoridad marítima'], ['vendor', 'Causa de Vendo Bote RD'], ['other', 'Otro motivo']];

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const fmtDMY = (d) => d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '—';
  function slotName(k) {
    const known = V.slotLabel(k);
    if (known !== k) return known;
    return String(k).replace(/(\d{1,2})(am|pm)/gi, (m, h, a) => h + ':00 ' + a.toUpperCase()).replace(/-/g, ' – ');
  }
  const todayLocal = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const isWeekend = (ds) => { const w = new Date(ds + 'T00:00:00Z').getUTCDay(); return w === 0 || w === 6; };
  function addDays(ds, n) { const [y, m, d] = ds.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
  function addMonths(ds, n) {
    const [y, m, d] = ds.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
  }

  let ui = null;   // referencias al modal (se crea una sola vez)
  let ctx = null;  // reserva que se está cambiando

  function build() {
    const overlay = el('div', 'modal-overlay'); overlay.id = 'resched-modal';
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-labelledby', 'resched-title');
    const modal = el('div', 'modal resched-modal');
    const close = el('button', 'modal-close', '✕'); close.type = 'button'; close.setAttribute('aria-label', 'Cerrar');
    const title = el('div', 'modal-title', 'Cambiar fecha'); title.id = 'resched-title';
    const boat = el('div', 'resched-boat');
    const summary = el('div', 'resched-summary'); summary.setAttribute('aria-live', 'polite');
    const sumFrom = el('div', 'resched-sum-from'), sumTo = el('div', 'resched-sum-to');
    summary.append(sumFrom, sumTo);

    const fields = el('div', 'resched-fields');
    const gDate = el('div', 'form-group'); const lDate = el('label', 'form-label', 'Nueva fecha'); lDate.htmlFor = 'resched-date';
    const date = el('input', 'form-input'); date.type = 'date'; date.id = 'resched-date';
    gDate.append(lDate, date);
    const gSlot = el('div', 'form-group'); const lSlot = el('label', 'form-label', 'Turno'); lSlot.htmlFor = 'resched-slot';
    const slot = el('select', 'form-select'); slot.id = 'resched-slot';
    gSlot.append(lSlot, slot);
    fields.append(gDate, gSlot);

    const gReason = el('div', 'form-group resched-reason'); const lReason = el('label', 'form-label', 'Motivo'); lReason.htmlFor = 'resched-reason';
    const reason = el('select', 'form-select'); reason.id = 'resched-reason';
    REASONS.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; reason.appendChild(o); });
    gReason.append(lReason, reason);

    const notice = el('p', 'resched-notice');
    const err = el('div', 'form-error hidden resched-error'); err.setAttribute('role', 'alert');
    const actions = el('div', 'resched-actions');
    const cancel = el('button', 'btn btn-ghost', 'Cancelar'); cancel.type = 'button';
    const confirm = el('button', 'btn btn-primary', 'Confirmar cambio'); confirm.type = 'button';
    actions.append(cancel, confirm);

    modal.append(close, title, boat, summary, fields, gReason, notice, err, actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const u = { overlay, boat, sumFrom, sumTo, date, slot, gReason, reason, notice, err, confirm, cancel };
    close.addEventListener('click', closeModal);
    cancel.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('is-open')) closeModal(); });
    date.addEventListener('change', refresh);
    slot.addEventListener('change', refresh);
    reason.addEventListener('change', refresh);
    confirm.addEventListener('click', submit);
    return u;
  }

  function closeModal() {
    if (!ui) return;
    ui.overlay.classList.remove('is-open');
    document.body.style.overflow = '';
    if (ctx && ctx.opener && ctx.opener.focus) { try { ctx.opener.focus(); } catch (e) { /* sin foco */ } }
    ctx = null;
  }

  function showError(msg, code) {
    ui.err.textContent = msg || '';
    if (msg && WA_CODES.includes(code)) {
      const a = el('a', 'resched-wa', 'Abrir WhatsApp'); a.href = WA; a.target = '_blank'; a.rel = 'noopener';
      ui.err.append(' ', a);
    }
    ui.err.classList.toggle('hidden', !msg);
  }

  // ¿El turno cuesta más que el original? (misma regla del servidor: solo esquemas por día; sáb/dom en la tarde)
  function locksWeekend() {
    return ctx.weekendLocked && (ctx.mode === 'client' || ui.reason.value === 'other');
  }

  // Marca como no elegibles los turnos ocupados, el actual y los que costarían más; deja uno elegido si hay
  function refresh() {
    if (!ctx) return;
    const d = ui.date.value;
    const lock = locksWeekend();
    let firstOk = null, selOk = false;
    Array.from(ui.slot.options).forEach((o) => {
      const k = o.value; let why = '';
      if (d && d === ctx.booking.start_date && k === ctx.booking.schedule) why = 'turno actual';
      else if (d && ctx.booked.has(d + '|' + k)) why = 'ocupado';
      else if (d && lock && isWeekend(d) && k === '4pm-10pm') why = 'cuesta más';
      o.disabled = !!why;
      o.textContent = slotName(k) + (why ? ' (' + why + ')' : '');
      if (!why) { if (!firstOk) firstOk = o; if (o.selected) selOk = true; }
    });
    if (!selOk && firstOk) firstOk.selected = true;
    const okDate = d && d >= ctx.minDate && d <= ctx.maxDate;
    const ready = !!(okDate && firstOk && !ui.slot.selectedOptions[0].disabled);
    ui.confirm.disabled = !ready || ctx.busy;
    ui.sumFrom.textContent = 'Fecha actual: ' + fmtDMY(ctx.booking.start_date) + ' · ' + slotName(ctx.booking.schedule);
    ui.sumTo.textContent = ready ? 'Nueva fecha: ' + fmtDMY(d) + ' · ' + slotName(ui.slot.value) : (d && !okDate ? 'Elige una fecha dentro del rango permitido.' : (d && !firstOk ? 'No hay turnos libres ese día.' : 'Nueva fecha: elige una fecha y un turno.'));
    showError('');
  }

  async function submit() {
    if (!ctx || ctx.busy || ui.confirm.disabled) return;
    ctx.busy = true; ui.confirm.disabled = true; ui.confirm.textContent = 'Guardando…';
    const body = { start_date: ui.date.value, schedule: ui.slot.value };
    if (ctx.mode === 'admin') body.reason = ui.reason.value;
    let r;
    try {
      r = await V.api('/bookings/' + ctx.booking.id + '/reschedule', { method: ctx.mode === 'admin' ? 'PATCH' : 'POST', body });
    } catch (e) { r = { error: 'Error de conexión' }; }
    ctx.busy = false; ui.confirm.textContent = 'Confirmar cambio';
    if (r && r.error) { ui.confirm.disabled = false; showError(r.error, r.code); return; }
    const done = ctx.onDone;
    V.toast(ctx.mode === 'admin' ? 'Reserva reprogramada. Avisamos al cliente por correo.' : '¡Listo! Cambiamos la fecha de tu reserva.', 'success');
    closeModal();
    if (done) done(r);
  }

  /* opts: { mode: 'client'|'admin', booking: {id, boat_id, boat_name, start_date, schedule}, slots: [claves de turno],
             minDate, maxDate, weekendLocked: bool, onDone(reserva), opener: elemento que lo abrió } */
  async function open(opts) {
    if (!ui) ui = build();
    ctx = { mode: opts.mode, booking: opts.booking, minDate: opts.minDate, maxDate: opts.maxDate, weekendLocked: !!opts.weekendLocked, onDone: opts.onDone, opener: opts.opener, booked: new Set(), busy: false };
    const isAdmin = ctx.mode === 'admin';
    ui.boat.textContent = ctx.booking.boat_name || '';
    ui.slot.replaceChildren();
    (opts.slots || []).forEach((k) => { const o = el('option', null, slotName(k)); o.value = k; ui.slot.appendChild(o); });
    ui.date.min = ctx.minDate; ui.date.max = ctx.maxDate; ui.date.value = '';
    ui.gReason.classList.toggle('hidden', !isAdmin);
    ui.reason.value = 'weather';
    ui.notice.textContent = isAdmin
      ? 'Reprogramación por el equipo: sin límite de cambios ni de antelación, hasta 6 meses desde la fecha original. El precio y el pago no cambian. Se avisa al cliente por correo.'
      : 'Solo puedes cambiar la fecha una vez, sin costo, con 24 h o más de antelación. No hay devolución de dinero.';
    showError('');
    ui.confirm.textContent = 'Confirmar cambio';
    refresh();
    ui.overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    ui.date.focus();
    // Turnos ocupados de esa embarcación (el mismo endpoint público que usa la página de la embarcación)
    const current = ctx;
    try {
      const data = await fetch('/api/boats/' + encodeURIComponent(current.booking.boat_id) + '/availability').then((r) => r.json());
      if (Array.isArray(data)) data.forEach((b) => { if (b.schedule) current.booked.add(b.start_date + '|' + b.schedule); });
    } catch (e) { /* sin disponibilidad: el servidor igual lo valida */ }
    if (ctx === current) refresh();
  }

  window.VBR_reschedule = { open, addDays, addMonths, todayLocal, fmtDMY };
})();
