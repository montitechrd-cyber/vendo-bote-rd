'use strict';
document.addEventListener('DOMContentLoaded', function () {
(function () {
  window.logout = () => window.VBR_logout();

  window.VBR_getUser().then(user => {
    if (!user) { location.href = '/auth.html'; return; }
    if (user.role !== 'admin') { location.href = '/dashboard.html'; return; }
    loadDashboard();
    loadAllBookings();
    loadBoatsAdmin();
  });

  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const SCHEDULE_LABEL = { '9am-3pm': 'Mañana 9AM–3PM', '4pm-10pm': 'Tarde 4PM–10PM', 'full-day': 'Día completo' };
  const SCHEDULE_SHORT = { '9am-3pm': '☀️ 9AM–3PM', '4pm-10pm': '🌇 4PM–10PM', 'full-day': 'Día completo' };
  const fmtDate = (d) => window.VBR.fmtDateShort(d);
  // Portada de la embarcación: primera foto; si solo hay videos, un fotograma del video
  function boatThumb(b) {
    let imgs = []; try { imgs = JSON.parse(b.boat_images || '[]'); } catch {}
    const isVid = (u) => /[.](mp4|webm|mov)([?]|$)/i.test(u || '');
    const photo = imgs.find(u => !isVid(u)), vid = imgs.find(isVid);
    if (photo) return '<img src="' + esc(encodeURI(photo)) + '" alt="" loading="lazy" />';
    if (vid) return '<video src="' + esc(encodeURI(vid)) + '#t=0.5" muted playsinline preload="metadata"></video>';
    return '⛵';
  }
  const esc = (s) => window.VBR.esc(s);

  function badge(label, cls) { return `<span class="badge badge-${cls}">${label}</span>`; }

  /* ── Section nav ── */
  window.showSection = function (id, el) {
    document.querySelectorAll('.admin-main > section').forEach(s => s.classList.add('hidden'));
    document.getElementById('sec-' + id).classList.remove('hidden');
    document.querySelectorAll('.admin-nav-item').forEach(n => n.classList.remove('active'));
    if (el) el.classList.add('active');
    // En móvil el sidebar queda en flujo normal arriba del contenido — sin esto,
    // el usuario toca un módulo y la sección nueva queda fuera de la pantalla,
    // pareciendo que nada pasó.
    if (window.innerWidth <= 768) {
      const main = document.querySelector('.admin-main');
      if (main) main.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (id === 'dashboard')  loadDashboard();
    if (id === 'bookings')   loadAllBookings();
    if (id === 'payments')   loadPendingPayments();
    if (id === 'boats')      loadBoatsAdmin();
    if (id === 'calendar')   initCalendarSection();
  };

  /* ── Dashboard ── */
  function loadDashboard() {
    window.VBR.api('/admin/stats').then(stats => {
      document.getElementById('admin-stats').innerHTML = `
        <div class="stat-card"><div class="stat-card-label">Embarcaciones</div><div class="stat-card-num">${stats.total_boats}</div></div>
        <div class="stat-card"><div class="stat-card-label">Total Reservas</div><div class="stat-card-num">${stats.total_bookings}</div></div>
        <div class="stat-card"><div class="stat-card-label">Confirmadas</div><div class="stat-card-num">${stats.confirmed_bookings}</div></div>
        <div class="stat-card" style="border-color:rgba(14,165,233,0.3);"><div class="stat-card-label">Pagos pendientes</div><div class="stat-card-num" style="color:var(--sky-2);">${stats.pending_verification}</div><div class="stat-card-sub">Requieren verificación</div></div>
        <div class="stat-card"><div class="stat-card-label">Ingresos confirmados</div><div class="stat-card-num">$${Number(stats.total_revenue).toLocaleString()}</div><div class="stat-card-sub">USD</div></div>
      `;
      const tbody = document.getElementById('recent-bookings-body');
      if (!stats.recent_bookings || !stats.recent_bookings.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--cream-3);padding:2rem;">Sin reservas aún — los datos reales aparecerán aquí.</td></tr>';
        return;
      }
      tbody.innerHTML = stats.recent_bookings.map(b => `
        <tr data-action="open-verify-modal" data-id="${b.id}" style="cursor:pointer;">
          <td data-label="Referencia" style="font-family:var(--mono);font-size:0.72rem;">${esc(b.booking_ref)}</td>
          <td data-label="Embarcación">${esc(b.boat_name)}</td>
          <td data-label="Cliente">${esc(b.user_name)}</td>
          <td data-label="Fecha">${fmtDate(b.start_date)}</td>
          <td data-label="Turno" style="font-family:var(--mono);font-size:0.7rem;">${SCHEDULE_LABEL[b.schedule]||b.schedule||'—'}</td>
          <td data-label="Total">$${Number(b.total_price).toLocaleString()}</td>
          <td data-label="Estado">${badge(b.status==='confirmed'?'Confirmada':b.status==='cancelled'?'Cancelada':'Pendiente', b.status==='confirmed'?'confirmed':b.status==='cancelled'?'cancelled':'pending')}</td>
          <td data-label="Pago">${badge(payLabel(b), payClass(b))}</td>
        </tr>`).join('');
    }).catch(() => window.VBR.toast('Error cargando el dashboard', 'error'));
  }

  // Etiqueta y color del estado de pago (incluye pagos con tarjeta)
  const isCard = (b) => b.payment_method === 'card' || b.payment_status === 'card_pending';
  function payLabel(b) {
    if (b.payment_status === 'verified') return b.payment_method === 'card' ? 'Pagado con tarjeta' : 'Verificado';
    return { submitted: 'En revisión', rejected: 'Rechazado', card_pending: 'Pago con tarjeta pendiente', expired: 'Expirado', cancelled: 'Cancelado' }[b.payment_status] || 'Sin pago';
  }
  function payClass(b) {
    return b.payment_status === 'verified' ? 'verified' : (b.payment_status === 'submitted' || b.payment_status === 'card_pending') ? 'submitted' : (b.payment_status === 'rejected' || b.payment_status === 'expired') ? 'rejected' : 'pending';
  }

  /* ── All bookings ── */
  /* ── Todas las reservas: los filtros se aplican al instante, sin botón ── */
  let allBookingsData = [];
  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  function renderAllBookings() {
    const q = norm(document.getElementById('book-search').value.trim());
    const status = document.getElementById('book-filter-status').value;
    const pay = document.getElementById('book-filter-pay').value;
    const boat = document.getElementById('book-filter-boat').value;
    const data = allBookingsData.filter(b =>
      (!status || b.status === status) && (!pay || b.payment_status === pay) && (!boat || String(b.boat_id) === boat) &&
      (!q || norm([b.booking_ref, b.boat_name, b.user_name, b.user_last_name, b.user_email, b.user_phone].join(' ')).includes(q)));
    const active = !!(q || status || pay || boat);
    document.getElementById('book-clear').classList.toggle('hidden', !active);
    document.getElementById('book-count').textContent = data.length + (data.length === 1 ? ' reserva' : ' reservas');
    const list = document.getElementById('all-bookings-list');
    if (!data.length) {
      list.innerHTML = '<p style="text-align:center;color:var(--cream-3);padding:2rem;">' + (active ? 'Ninguna reserva coincide con los filtros.' : 'Sin reservas registradas.') + '</p>';
      return;
    }
    list.innerHTML = data.map(b => {
      const client = [[b.user_name, b.user_last_name].filter(Boolean).join(' '), b.user_phone, b.user_email].filter(Boolean).join(' · ');
      const canAct = b.status !== 'cancelled';
      return window.VBR.bookingCard(b, { client, actions:
        (b.receipt_filename ? '<button class="btn btn-ghost btn-sm" data-action="view-receipt" data-id="' + b.id + '">Comprobante</button>' : '') +
        (canAct && b.payment_status === 'submitted' && !isCard(b) ? '<button class="btn btn-success btn-sm" data-action="verify-payment" data-verdict="approve" data-id="' + b.id + '">Aprobar</button>' : '') +
        (canAct && !isCard(b) ? '<button class="btn btn-danger btn-sm" data-action="prompt-reject" data-id="' + b.id + '">Rechazar</button>' : '') +
        '<button class="btn btn-ghost btn-sm" style="color:#B91C1C;" data-action="delete-booking" data-id="' + b.id + '">Eliminar</button>' });
    }).join('');
    window.VBR.observeReveals && window.VBR.observeReveals();
  }
  window.loadAllBookings = function () {
    window.VBR.api('/bookings').then(data => {
      allBookingsData = Array.isArray(data) ? data : [];
      // lista de embarcaciones que tienen reservas, conservando la selección actual
      const sel = document.getElementById('book-filter-boat'), keep = sel.value;
      const boats = [...new Map(allBookingsData.map(b => [String(b.boat_id), b.boat_name])).entries()].sort((x, y) => String(x[1]).localeCompare(String(y[1])));
      sel.innerHTML = '<option value="">Todas las embarcaciones</option>' + boats.map(([id, n]) => '<option value="' + esc(id) + '">' + esc(n) + '</option>').join('');
      sel.value = boats.some(([id]) => id === keep) ? keep : '';
      renderAllBookings();
    }).catch(() => window.VBR.toast('Error cargando reservas', 'error'));
  };
  ['book-filter-status', 'book-filter-pay', 'book-filter-boat'].forEach(id => document.getElementById(id).addEventListener('change', renderAllBookings));
  document.getElementById('book-search').addEventListener('input', renderAllBookings);
  document.getElementById('book-clear').addEventListener('click', () => {
    ['book-search', 'book-filter-status', 'book-filter-pay', 'book-filter-boat'].forEach(id => { document.getElementById(id).value = ''; });
    renderAllBookings();
  });

  /* ── Pagos con tarjeta por revisar (AZUL) ── */
  const CARD_STATUS = { created: 'Iniciado (sin respuesta)', needs_review: 'Aprobado por AZUL: por revisar', expired_unconfirmed: 'Reserva expirada sin confirmar' };
  function loadCardReview() {
    const box = document.getElementById('card-review-list');
    if (!box) return;
    window.VBR.api('/payments/azul/admin/review').then(rows => {
      box.textContent = '';
      if (!rows || !rows.length) return; // vacío si no hay nada por revisar
      const table = document.createElement('table');
      table.className = 'data-table';
      const head = document.createElement('thead'), hr = document.createElement('tr');
      ['Reserva', 'Orden', 'Estado', 'Monto', 'USD', 'Creado', 'Completado'].forEach(h => { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
      head.appendChild(hr); table.appendChild(head);
      const body = document.createElement('tbody');
      const fmt = (d) => d ? new Date(d).toLocaleString('es-DO') : '—';
      rows.forEach(r => {
        const tr = document.createElement('tr');
        [r.booking_ref, r.order_number, CARD_STATUS[r.status] || r.status + (r.iso_code ? ' (' + r.iso_code + ')' : ''),
         'RD$ ' + Number(r.amount_dop).toLocaleString('es-DO', { minimumFractionDigits: 2 }), '$' + Number(r.usd_total).toLocaleString(),
         fmt(r.created_at), fmt(r.completed_at)].forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
        body.appendChild(tr);
      });
      table.appendChild(body); box.appendChild(table);
    }).catch(() => { if (box) box.textContent = ''; });
  }

  /* ── Pending payments ── */
  function loadPendingPayments() {
    loadCardReview();
    window.VBR.api('/bookings?payment_status=submitted').then(data => {
      const wrap = document.getElementById('payments-pending-list');
      if (!data.length) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">✅</div><h3 class="empty-state-title">Sin pagos pendientes</h3><p class="empty-state-desc">Todos los comprobantes han sido verificados.</p></div>`;
        return;
      }
      wrap.innerHTML = data.map(b => `
        <div style="background:var(--bg-card);border:1px solid var(--line-2);border-radius:var(--r);padding:1.5rem;border-left:3px solid var(--sky);">
          <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:1rem;">
            <div>
              <div style="font-family:var(--serif);font-size:1.1rem;font-style:italic;color:var(--cream);margin-bottom:0.3rem;">${esc(b.boat_name)}</div>
              <div style="font-family:var(--mono);font-size:0.6875rem;color:var(--cream-3);">${esc(b.booking_ref)}</div>
              <div style="margin-top:0.5rem;font-size:0.85rem;color:var(--cream-2);">👤 ${esc(b.user_name)} · ${esc(b.user_email)}${b.user_phone?' · '+esc(b.user_phone):''}</div>
              <div style="font-size:0.85rem;color:var(--cream-2);margin-top:0.2rem;">📅 ${fmtDate(b.start_date)} · ${esc(SCHEDULE_LABEL[b.schedule]||b.schedule||'')}</div>
              ${b.reference_number ? `<div style="font-family:var(--mono);font-size:0.72rem;color:var(--sky-2);margin-top:0.4rem;">Ref: ${esc(b.reference_number)}</div>` : ''}
              ${b.bank_name ? `<div style="font-size:0.8rem;color:var(--cream-3);">Banco: ${esc(b.bank_name)}</div>` : ''}
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <div style="font-family:var(--serif);font-size:1.4rem;font-style:italic;color:var(--sky-2);margin-bottom:0.9rem;">$${Number(b.total_price).toLocaleString()} USD</div>
              <div style="display:flex;gap:0.5rem;flex-wrap:wrap;justify-content:flex-end;">
                ${b.receipt_filename ? `<button class="btn btn-ghost btn-sm" data-action="view-receipt" data-id="${b.id}">Ver comprobante</button>` : ''}
                <button class="btn btn-success btn-sm" data-action="verify-payment" data-verdict="approve" data-id="${b.id}">✓ Aprobar</button>
                <button class="btn btn-danger btn-sm" data-action="verify-payment" data-verdict="reject" data-id="${b.id}">✕ Rechazar</button>
              </div>
            </div>
          </div>
        </div>`).join('');
    }).catch(() => window.VBR.toast('Error cargando pagos pendientes', 'error'));
  }

  /* ── Verify modal ── */
  window.openVerifyModal = function (id) {
    window.VBR.api('/bookings/' + id).then(b => {
      document.getElementById('verify-modal-title').textContent = 'Reserva · ' + b.booking_ref;
      document.getElementById('verify-modal-body').innerHTML = `
        <div style="display:flex;flex-direction:column;gap:1rem;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
            <div class="boat-spec-item"><div class="boat-spec-label">Embarcación</div><div class="boat-spec-val">${esc(b.boat_name)}</div></div>
            <div class="boat-spec-item"><div class="boat-spec-label">Ubicación</div><div class="boat-spec-val">${esc(b.boat_location)}</div></div>
            <div class="boat-spec-item"><div class="boat-spec-label">Cliente</div><div class="boat-spec-val">${esc(b.user_name)}</div></div>
            <div class="boat-spec-item"><div class="boat-spec-label">Contacto</div><div class="boat-spec-val" style="font-size:0.78rem;">${esc(b.user_email)}<br>${esc(b.user_phone||'—')}</div></div>
            <div class="boat-spec-item"><div class="boat-spec-label">Fecha</div><div class="boat-spec-val">${fmtDate(b.start_date)}</div></div>
            <div class="boat-spec-item"><div class="boat-spec-label">Turno</div><div class="boat-spec-val">${esc(SCHEDULE_LABEL[b.schedule]||b.schedule||'—')}</div></div>
            <div class="boat-spec-item"><div class="boat-spec-label">Personas</div><div class="boat-spec-val">${b.guests} pers.</div></div>
            <div class="boat-spec-item"><div class="boat-spec-label">Total</div><div class="boat-spec-val" style="font-family:var(--serif);font-style:italic;font-size:1.1rem;color:var(--sky-2);">$${Number(b.total_price).toLocaleString()} USD</div></div>
          </div>
          ${b.bank_name||b.reference_number ? `
          <div class="bank-box">
            <div class="bank-box-title">Comprobante de pago</div>
            ${b.bank_name?`<div class="bank-row"><span class="bank-key">Banco</span><span class="bank-val">${esc(b.bank_name)}</span></div>`:''}
            ${b.account_holder?`<div class="bank-row"><span class="bank-key">Titular</span><span class="bank-val">${esc(b.account_holder)}</span></div>`:''}
            ${b.reference_number?`<div class="bank-row"><span class="bank-key">Referencia</span><span class="bank-val" style="font-family:var(--mono);">${esc(b.reference_number)}</span></div>`:''}
            ${b.receipt_filename?`<div class="bank-row"><span class="bank-key">Archivo</span><button class="btn btn-ghost btn-sm" data-action="view-receipt" data-id="${b.id}">Ver comprobante</button></div>`:''}
          </div>` : '<p style="color:var(--cream-3);font-size:0.85rem;">Sin comprobante enviado aún.</p>'}
          ${b.special_requests?`<div class="boat-spec-item"><div class="boat-spec-label">Notas</div><div class="boat-spec-val" style="font-size:0.85rem;">${esc(b.special_requests)}</div></div>`:''}
          <div style="border-top:1px solid var(--line);padding-top:1.25rem;">
            <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
              ${b.payment_status === 'submitted' && !isCard(b) && b.status !== 'cancelled' ? `<button class="btn btn-success" data-action="approve-close" data-id="${b.id}">✓ Aprobar pago</button>` : ''}
              ${b.status !== 'cancelled' && !isCard(b) ? `<button class="btn btn-danger" data-action="prompt-reject" data-id="${b.id}">✕ Rechazar reserva</button>` : ''}
              <button class="btn btn-ghost" style="color:#E05A5A;" data-action="delete-booking-close" data-id="${b.id}">🗑 Eliminar</button>
            </div>
            <p style="font-family:var(--mono);font-size:0.72rem;color:var(--cream-3);margin-top:0.75rem;">Estado: ${b.status === 'cancelled' ? 'cancelada' : b.status === 'confirmed' ? 'confirmada' : 'pendiente'} · pago: ${esc(payLabel(b))}${isCard(b) ? ' (tarjeta, gestionado por AZUL)' : ''}</p>
          </div>
        </div>`;
      document.getElementById('verify-modal').classList.add('is-open');
      document.body.style.overflow = 'hidden';
    }).catch(() => window.VBR.toast('Error cargando la reserva', 'error'));
  };
  // El comprobante ya no se sirve como archivo público — se pide con la sesión
  // y se abre como blob, igual que cualquier otra llamada autenticada del panel.
  window.viewReceipt = async function (id) {
    try {
      const r = await fetch('/api/bookings/' + id + '/receipt', { credentials: 'same-origin' });
      if (!r.ok) { window.VBR.toast('No se pudo cargar el comprobante', 'error'); return; }
      const blob = await r.blob();
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (e) {
      window.VBR.toast('Error al abrir el comprobante', 'error');
    }
  };
  window.closeVerifyModal = function () { document.getElementById('verify-modal').classList.remove('is-open'); document.body.style.overflow = ''; };
  document.getElementById('verify-modal').addEventListener('click', e => { if (e.target.id === 'verify-modal') window.closeVerifyModal(); });

  window.verifyPayment = function (id, action, reason) {
    window.VBR.api('/bookings/' + id + '/verify-payment', { method: 'PATCH', body: { action, rejection_reason: reason } }).then(d => {
      if (d.error) { window.VBR.toast(d.error, 'error'); return; }
      window.VBR.toast(d.message || (action === 'approve' ? 'Pago aprobado' : 'Pago rechazado'), action === 'approve' ? 'success' : 'info');
      loadPendingPayments(); loadDashboard(); if (window.loadAllBookings) loadAllBookings(); refreshCalBookings();
    }).catch(() => window.VBR.toast('Error de conexión al verificar el pago', 'error'));
  };
  window.promptReject = function (id) {
    const reason = prompt('Motivo del rechazo (opcional):');
    if (reason === null) return;
    window.verifyPayment(id, 'reject', reason || 'Reserva rechazada');
    window.closeVerifyModal();
  };

  window.deleteBooking = function (id) {
    if (!confirm('¿Eliminar esta reserva por completo? Esta acción no se puede deshacer.')) return;
    window.VBR.api('/bookings/' + id, { method: 'DELETE' }).then(d => {
      if (d.error) { window.VBR.toast(d.error, 'error'); return; }
      window.VBR.toast('Reserva eliminada', 'info');
      loadPendingPayments(); loadDashboard(); if (window.loadAllBookings) loadAllBookings(); refreshCalBookings();
    }).catch(() => window.VBR.toast('Error al eliminar la reserva', 'error'));
  };
  function refreshCalBookings() {
    if (!calInited) return;
    window.VBR.api('/bookings/admin/calendar-all').then(b => { if (Array.isArray(b)) { calAllBookings = b; renderCalendar(); } });
  }

  /* ── Boats admin ── */
  let allBoatsCached = [];
  let currentBoatsTab = 'renta';

  window.switchBoatsTab = function (tab, el) {
    currentBoatsTab = tab;
    document.querySelectorAll('.boats-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('boats-tab-renta').classList.toggle('hidden', tab !== 'renta');
    document.getElementById('boats-tab-venta').classList.toggle('hidden', tab !== 'venta');
  };

  function loadBoatsAdmin() {
    window.VBR.api('/boats/admin/all').then(boats => {
      allBoatsCached = boats;
      const renta = boats.filter(b => !b.for_sale);
      const venta = boats.filter(b => b.for_sale);

      document.getElementById('tab-count-renta').textContent = renta.length;
      document.getElementById('tab-count-venta').textContent = venta.length;

      // Tabla renta
      document.getElementById('boats-renta-body').innerHTML = renta.length ? renta.map(b => {
        const meta = esc([b.brand, b.length_ft ? b.length_ft+'ft' : '', b.year].filter(Boolean).join(' · '));
        return `
        <tr>
          <td data-label="Embarcación"><div style="font-weight:600;color:var(--cream);">${esc(b.name)}</div>${meta ? `<div style="font-family:var(--mono);font-size:0.6875rem;color:var(--cream-3);">${meta}</div>` : ''}</td>
          <td data-label="Ubicación">📍 ${esc(b.location)}</td>
          <td data-label="Capacidad">${b.capacity} pers.</td>
          <td data-label="Precio / día" style="font-family:var(--serif);font-style:italic;color:var(--sky-2);">$${Number(b.price_per_day).toLocaleString()}<span style="font-family:var(--mono);font-size:0.6875rem;color:var(--cream-3);font-style:normal;"> /día</span></td>
          <td data-label="Destacada">${b.featured?'⭐ Sí':'—'}</td>
          <td data-label="Estado"><span class="badge badge-${b.available?'confirmed':'cancelled'}">${b.available?'Activa':'Inactiva'}</span></td>
          <td data-label="Acciones" style="display:flex;gap:0.4rem;">
            <button class="btn btn-ghost btn-sm" data-action="open-boat-modal" data-id="${b.id}">Editar</button>
            <button class="btn btn-ghost btn-sm" data-name="${esc(b.name)}" data-action="deactivate-boat" data-id="${b.id}" ${!b.available?'disabled':''}>Desactivar</button>
            <button class="btn btn-danger btn-sm" data-action="delete-boat" data-id="${b.id}">Eliminar</button>
          </td>
        </tr>`;
      }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--cream-3);padding:2rem;">Sin embarcaciones en renta.</td></tr>';

      // Tabla venta
      document.getElementById('boats-venta-body').innerHTML = venta.length ? venta.map(b => {
        const meta = esc([b.brand, b.length_ft ? b.length_ft+'ft' : '', b.year].filter(Boolean).join(' · '));
        return `
        <tr>
          <td data-label="Embarcación"><div style="font-weight:600;color:var(--cream);">${esc(b.name)}</div>${meta ? `<div style="font-family:var(--mono);font-size:0.6875rem;color:var(--cream-3);">${meta}</div>` : ''}</td>
          <td data-label="Ubicación">📍 ${esc(b.location)}</td>
          <td data-label="Capacidad">${b.capacity} pers.</td>
          <td data-label="Precio de venta" style="font-family:var(--serif);font-style:italic;color:var(--sky-2);">${b.sale_price ? '$'+Number(b.sale_price).toLocaleString()+' USD' : '<span style="color:var(--cream-3);">A consultar</span>'}</td>
          <td data-label="Estado"><span class="badge badge-${b.available?'confirmed':'cancelled'}">${b.available?'Activa':'Inactiva'}</span></td>
          <td data-label="Acciones" style="display:flex;gap:0.4rem;">
            <button class="btn btn-ghost btn-sm" data-action="open-boat-modal" data-id="${b.id}">Editar</button>
            <a href="/boat.html?slug=${encodeURIComponent(b.slug)}" target="_blank" class="btn btn-ghost btn-sm">Ver página</a>
            <button class="btn btn-danger btn-sm" data-action="delete-boat" data-id="${b.id}">Eliminar</button>
          </td>
        </tr>`;
      }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--cream-3);padding:2rem;">Sin embarcaciones en venta.</td></tr>';
    }).catch(() => window.VBR.toast('Error cargando embarcaciones', 'error'));
  }

  let editingBoatId = null;

  window.openBoatModal = function (id) {
    editingBoatId = id;
    document.getElementById('boat-modal-title').textContent = id ? 'Editar Embarcación' : 'Agregar Embarcación';
    if (id) {
      window.VBR.api('/boats/admin/all').then(boats => {
        const b = boats.find(x => x.id === id);
        if (!b) return;
        document.getElementById('bm-name').value = b.name;
        document.getElementById('bm-slug').value = b.slug;
        document.getElementById('bm-location').value = b.location;
        document.getElementById('bm-brand').value = b.brand||'';
        document.getElementById('bm-capacity').value = b.capacity;
        document.getElementById('bm-length').value = b.length_ft||'';
        document.getElementById('bm-year').value = b.year||'';
        document.getElementById('bm-price').value = b.price_per_day;
        document.getElementById('bm-short-desc').value = b.short_description||'';
        document.getElementById('bm-desc').value = b.description||'';
        document.getElementById('bm-images').value = (b.images||[]).join('\n');
        document.getElementById('bm-features').value = (b.features||[]).join('\n');
        document.getElementById('bm-amenities').value = (b.amenities||[]).join('\n');
        document.getElementById('bm-rules').value = (b.rules||[]).join('\n');
        document.getElementById('bm-featured').checked = Boolean(b.featured);
        document.getElementById('bm-available').checked = Boolean(b.available);
        document.getElementById('bm-for-sale').checked = Boolean(b.for_sale);
      }).catch(() => window.VBR.toast('Error cargando la embarcación', 'error'));
    } else {
      ['bm-name','bm-slug','bm-brand','bm-capacity','bm-length','bm-year','bm-price','bm-short-desc','bm-desc','bm-images','bm-features','bm-amenities','bm-rules'].forEach(i => document.getElementById(i).value = '');
      document.getElementById('bm-featured').checked = false;
      document.getElementById('bm-available').checked = true;
      document.getElementById('bm-for-sale').checked = false;
    }
    document.getElementById('boat-modal').classList.add('is-open');
    document.body.style.overflow = 'hidden';
    document.getElementById('bm-name').addEventListener('input', function () {
      if (!editingBoatId) document.getElementById('bm-slug').value = this.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    });
  };
  window.closeBoatModal = function () { document.getElementById('boat-modal').classList.remove('is-open'); document.body.style.overflow = ''; };
  document.getElementById('boat-modal').addEventListener('click', e => { if (e.target.id === 'boat-modal') window.closeBoatModal(); });

  window.saveBoat = function () {
    const lines = id => document.getElementById(id).value.split('\n').map(s=>s.trim()).filter(Boolean);
    const body = {
      name: document.getElementById('bm-name').value.trim(),
      slug: document.getElementById('bm-slug').value.trim(),
      location: document.getElementById('bm-location').value,
      brand: document.getElementById('bm-brand').value.trim(),
      capacity: parseInt(document.getElementById('bm-capacity').value),
      length_ft: parseInt(document.getElementById('bm-length').value)||null,
      year: parseInt(document.getElementById('bm-year').value)||null,
      price_per_day: parseFloat(document.getElementById('bm-price').value)||0,
      short_description: document.getElementById('bm-short-desc').value.trim(),
      description: document.getElementById('bm-desc').value.trim(),
      images: lines('bm-images'),
      features: lines('bm-features'),
      amenities: lines('bm-amenities'),
      rules: lines('bm-rules'),
      featured: document.getElementById('bm-featured').checked,
      available: document.getElementById('bm-available').checked,
      for_sale: document.getElementById('bm-for-sale').checked,
    };
    if (!body.name || !body.slug || !body.capacity) {
      document.getElementById('boat-form-error').textContent = 'Nombre, slug y capacidad son requeridos';
      document.getElementById('boat-form-error').classList.remove('hidden'); return;
    }
    const method = editingBoatId ? 'PUT' : 'POST';
    const url = editingBoatId ? '/boats/' + editingBoatId : '/boats';
    const btn = document.getElementById('save-boat-btn');
    if (btn.disabled) return; // evita doble envío (doble clic, conexión lenta)
    btn.disabled = true; btn.textContent = 'Guardando...';
    window.VBR.api(url, { method, body }).then(d => {
      if (d.error) {
        document.getElementById('boat-form-error').textContent = d.error;
        document.getElementById('boat-form-error').classList.remove('hidden');
        btn.disabled = false; btn.textContent = 'Guardar embarcación';
        return;
      }
      window.VBR.toast(editingBoatId ? 'Embarcación actualizada' : 'Embarcación creada', 'success');
      btn.disabled = false; btn.textContent = 'Guardar embarcación';
      window.closeBoatModal();
      loadBoatsAdmin();
    }).catch(() => {
      document.getElementById('boat-form-error').textContent = 'Error de conexión con el servidor';
      document.getElementById('boat-form-error').classList.remove('hidden');
      btn.disabled = false; btn.textContent = 'Guardar embarcación';
    });
  };

  window.deactivateBoat = function (id, name) {
    if (!confirm(`¿Desactivar "${name}"? No aparecerá en el catálogo.`)) return;
    window.VBR.api('/boats/' + id, { method: 'DELETE' }).then(() => { window.VBR.toast('Embarcación desactivada', 'info'); loadBoatsAdmin(); })
      .catch(() => window.VBR.toast('Error al desactivar la embarcación', 'error'));
  };

  // Eliminar por completo: se pregunta dos veces antes de hacerlo
  window.deleteBoat = function (id) {
    const found = (allBoatsCached || []).find(x => x.id === id); const name = found ? found.name : 'esta embarcación';
    if (!confirm('¿Deseas eliminar la embarcación "' + name + '" de la plataforma?')) return;
    if (!confirm('¿Estás seguro? "' + name + '" se eliminará por completo y esta acción no se puede deshacer.')) return;
    window.VBR.api('/boats/' + id + '/permanent', { method: 'DELETE', body: { confirmed: true } }).then(d => {
      if (d.error) { window.VBR.toast(d.error, 'error'); return; }
      window.VBR.toast('Embarcación eliminada', 'info'); loadBoatsAdmin();
    }).catch(() => window.VBR.toast('Error al eliminar la embarcación', 'error'));
  };

  /* ══════════════════════════════════════════
     CALENDARIO REDISEÑADO
  ══════════════════════════════════════════ */
  let calYear = new Date().getFullYear();
  let calMonth = new Date().getMonth();
  let calAllBoats = [], calAllBookings = [];
  let calStatusFilter = 'all';
  let calInited = false;

  window.setCalFilter = function (f, el) {
    calStatusFilter = f;
    document.querySelectorAll('.cal-filter-pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    renderCalendar();
  };

  function initCalendarSection() {
    if (calInited) { renderCalendar(); return; }
    calInited = true;

    Promise.all([
      window.VBR.api('/boats/admin/all'),
      window.VBR.api('/bookings/admin/calendar-all')
    ]).then(([boats, bookings]) => {
      calAllBoats = boats.filter(b => !b.for_sale); // solo lanchas en renta
      calAllBookings = bookings;

      // Populate boat filter
      const sel = document.getElementById('cal-filter-boat');
      calAllBoats.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id; opt.textContent = b.name;
        sel.appendChild(opt);
      });

      renderCalendar();
    }).catch(() => { calInited = false; window.VBR.toast('Error cargando el calendario', 'error'); });

    document.getElementById('cal-prev-month').addEventListener('click', () => {
      calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
      renderCalendar();
    });
    document.getElementById('cal-next-month').addEventListener('click', () => {
      calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
      renderCalendar();
    });
    document.getElementById('cal-today-btn').addEventListener('click', () => {
      calYear = new Date().getFullYear();
      calMonth = new Date().getMonth();
      renderCalendar();
    });
  }

  window.renderCalendar = function () {
    const today = new Date(); today.setHours(0,0,0,0);
    const firstDay = new Date(calYear, calMonth, 1);
    const lastDay  = new Date(calYear, calMonth + 1, 0);
    const daysInMonth = lastDay.getDate();

    // Update header
    document.getElementById('cal-month-title').textContent = MONTHS[calMonth] + ' ' + calYear;
    document.getElementById('cal-range').textContent =
      firstDay.toLocaleDateString('es-DO', {day:'numeric', month:'long', year:'numeric'}) + ' – ' +
      lastDay.toLocaleDateString('es-DO', {day:'numeric', month:'long', year:'numeric'});

    // Filter bookings
    const boatFilter = document.getElementById('cal-filter-boat').value;
    let bookings = calAllBookings.filter(b => b.status !== 'cancelled');
    if (calStatusFilter !== 'all') bookings = bookings.filter(b => b.status === calStatusFilter);
    if (boatFilter) bookings = bookings.filter(b => String(b.boat_id) === boatFilter);

    // Start from Monday — get day of week (0=Sun..6=Sat) → convert to Mon-based (0=Mon..6=Sun)
    let startDow = firstDay.getDay(); // 0=Sun
    startDow = startDow === 0 ? 6 : startDow - 1; // convert to Mon-based

    const grid = document.getElementById('admin-cal-grid');
    let html = '';

    // Leading empty cells
    for (let i = 0; i < startDow; i++) {
      html += `<div class="cal-cell out-month"></div>`;
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
      const ds = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const date = new Date(calYear, calMonth, day);
      const isToday = date.toDateString() === today.toDateString();

      // Find bookings starting or spanning this day
      const dayBookings = bookings.filter(b => ds >= b.start_date && ds <= b.end_date);

      let eventsHtml = '';
      const maxShow = 3;
      const shown = dayBookings.slice(0, maxShow);
      const extra = dayBookings.length - maxShow;

      shown.forEach(b => {
        const boatName = (calAllBoats.find(bt => bt.id === b.boat_id)||{}).name || b.boat_name || '—';
        const cls = b.status === 'confirmed' ? 'confirmed' : 'pending';
        const shortName = boatName.length > 14 ? boatName.slice(0,13)+'…' : boatName;
        eventsHtml += `
          <div class="cal-event ${cls}" data-action="open-verify-modal" data-id="${b.id}" title="${esc(boatName)} · ${esc(b.user_name)} · ${b.status === 'confirmed' ? 'Aprobada' : 'Pendiente de confirmar'}">
            <div class="cal-event-dot"></div>
            <span>${esc(shortName)}</span>
          </div>`;
      });
      if (extra > 0) eventsHtml += `<div class="cal-more">+${extra} más</div>`;

      html += `
        <div class="cal-cell ${isToday?'is-today':''}">
          <div class="cal-cell-num">${day}</div>
          ${eventsHtml}
        </div>`;
    }

    // Trailing empty cells to complete last row
    const totalCells = startDow + daysInMonth;
    const trailing = (7 - (totalCells % 7)) % 7;
    for (let i = 0; i < trailing; i++) {
      html += `<div class="cal-cell out-month"></div>`;
    }

    grid.innerHTML = html;
  };

  /* ── Acciones delegadas (sin atributos on* en línea, por la CSP) ── */
  const ACTIONS = {
    'show-section': (el) => window.showSection(el.dataset.section, el),
    'logout': () => window.logout(),
    'open-boat-modal': (el) => window.openBoatModal(el.dataset.id ? Number(el.dataset.id) : null),
    'switch-boats-tab': (el) => window.switchBoatsTab(el.dataset.tab, el),
    'set-cal-filter': (el) => window.setCalFilter(el.dataset.filter, el),
    'close-verify-modal': () => window.closeVerifyModal(),
    'close-boat-modal': () => window.closeBoatModal(),
    'save-boat': () => window.saveBoat(),
    'open-verify-modal': (el) => window.openVerifyModal(Number(el.dataset.id)),
    'view-receipt': (el) => window.viewReceipt(Number(el.dataset.id)),
    'verify-payment': (el) => window.verifyPayment(Number(el.dataset.id), el.dataset.verdict),
    'approve-close': (el) => { window.verifyPayment(Number(el.dataset.id), 'approve'); window.closeVerifyModal(); },
    'prompt-reject': (el) => window.promptReject(Number(el.dataset.id)),
    'delete-booking': (el) => window.deleteBooking(Number(el.dataset.id)),
    'delete-booking-close': (el) => { window.deleteBooking(Number(el.dataset.id)); window.closeVerifyModal(); },
    'deactivate-boat': (el) => window.deactivateBoat(Number(el.dataset.id), el.dataset.name),
    'delete-boat': (el) => window.deleteBoat(Number(el.dataset.id)),
  };
  const CHANGE_ACTIONS = { 'render-calendar': () => window.renderCalendar() };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = ACTIONS[el.dataset.action];
    if (fn) fn(el, e);
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-action]');
    const fn = el && CHANGE_ACTIONS[el.dataset.action];
    if (fn) fn(el, e);
  });

})();
});
