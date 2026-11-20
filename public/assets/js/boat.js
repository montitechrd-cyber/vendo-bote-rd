(function () {
  const params = new URLSearchParams(location.search);
  const slug = params.get('slug') || (location.pathname.indexOf('/embarcacion/') === 0 ? decodeURIComponent(location.pathname.split('/').filter(Boolean).pop()) : '');
  if (!slug) { location.href = '/embarcaciones.html'; return; }

  let boat = null;
  let bookedSlots = {}; // { 'YYYY-MM-DD': ['10am-4pm', '5pm-11pm'] }
  let calYear, calMonth;
  let selDate = null, selSlot = null;
  let selPackageHours = null, extraHours = 0, selBirthday = false;
  let lightboxImgs = [], lightboxIdx = 0;

  const fmt = (d) => window.VBR.fmtDateLong(d);
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  /* ── Fetch boat ── */
  function loadBoat() {
    fetch('/api/boats/' + slug).then(r => r.json()).then(data => {
      if (data.error) { location.href = '/embarcaciones.html'; return; }
      boat = data;
      document.title = boat.name + ' — VENDO BOTE RD';
      renderBoat();
      if (boat.for_sale) {
        activateSaleMode();
      } else {
        initBookingListeners();
        loadAvailability();
      }
      document.getElementById('page-loading').classList.add('hidden');
      document.getElementById('boat-page').classList.remove('hidden');
    });
  }

  const isVid = src => src && /\.(mp4|webm|mov)$/i.test(src);
  function mediaThumb(src, idx, extra) {
    if (isVid(src)) return `<video src="${src}" muted playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit;" data-action="open-lightbox" data-idx="${idx}" ${extra||''}></video>`;
    return `<img src="${src}" alt="${(boat && boat.name || 'Embarcación').replace(/"/g, '&quot;')}" loading="lazy" style="width:100%;height:100%;object-fit:cover;" />`;
  }

  let mainIdx = 0;
  function paintMain() {
    const imgs = lightboxImgs;
    if (!imgs.length) return;
    const src = imgs[mainIdx];
    const gallery = document.getElementById('gallery');
    // Foto o video completos (sin recortar), centrados y sin marco: cada uno toma su propia proporción.
    const mainHTML = isVid(src)
      ? `<div class="gallery-main" data-action="open-lightbox" data-idx="${mainIdx}">
           <div class="gallery-media">
             <video src="${src}#t=0.1" muted playsinline preload="auto"></video>
             <div class="gallery-play">▶</div>
           </div>
         </div>`
      : `<div class="gallery-main" data-action="open-lightbox" data-idx="${mainIdx}"><div class="gallery-media"><img src="${src}" alt="${boat.name}" loading="eager" /></div></div>`;
    gallery.innerHTML = mainHTML;
    document.querySelectorAll('.gallery-thumb-btn').forEach((t, i) => {
      t.classList.toggle('active', i === mainIdx);
      if (i === mainIdx && t.scrollIntoView) t.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
    document.querySelectorAll('.gallery-dot').forEach((d, i) => d.classList.toggle('active', i === mainIdx));
    // En celular: la foto vertical se muestra más grande (el marco crece según la orientación, sin recortar ni deformar)
    const media = gallery.querySelector('img, video');
    const setOrient = () => {
      if (!media) return;
      const w = media.naturalWidth || media.videoWidth, h = media.naturalHeight || media.videoHeight;
      if (w && h) gallery.classList.toggle('is-portrait', h > w * 1.05);
    };
    if (media) { media.addEventListener('load', setOrient); media.addEventListener('loadedmetadata', setOrient); setOrient(); }
  }

  function shiftMain(delta) {
    const n = lightboxImgs.length;
    if (!n) return;
    mainIdx = (mainIdx + delta + n) % n;
    paintMain();
  }

  const FALLBACK_IMG = 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1200&q=75';
  let hasRealImages = true;

  function renderGallery() {
    const realImgs = boat.images || [];
    hasRealImages = realImgs.length > 0;
    const imgs = realImgs.length ? realImgs : [FALLBACK_IMG];
    lightboxImgs = imgs;
    // Arranca en la primera foto real si hay alguna: evita autoreproducir de entrada
    // un video pesado (varios pesan 40-70MB) solo por ser el primer elemento.
    const firstPhotoIdx = imgs.findIndex(src => !isVid(src));
    mainIdx = firstPhotoIdx !== -1 ? firstPhotoIdx : 0;
    const multi = imgs.length > 1;
    // Tira de miniaturas (todas las fotos/videos); clic = ver esa foto arriba
    document.getElementById('gallery-strip').innerHTML = multi
      ? imgs.map((src, i) => `<button type="button" class="gallery-thumb-btn" data-i="${i}" aria-label="Ver foto ${i + 1}">
          ${isVid(src) ? '<video src="' + src + '" muted playsinline preload="metadata"></video><span class="gallery-thumb-play">▶</span>' : '<img src="' + src + '" alt="" loading="lazy" />'}
        </button>`).join('')
      : '';
    document.querySelectorAll('.gallery-thumb-btn').forEach(b => b.addEventListener('click', () => { mainIdx = parseInt(b.dataset.i, 10); paintMain(); }));
    document.getElementById('gallery-prev').style.display = multi ? '' : 'none';
    document.getElementById('gallery-next').style.display = multi ? '' : 'none';
    document.getElementById('gallery-prev').onclick = () => shiftMain(-1);
    document.getElementById('gallery-next').onclick = () => shiftMain(1);
    document.getElementById('gallery-dots').innerHTML = realImgs.length > 1
      ? imgs.slice(0, 10).map((_, i) => `<span class="gallery-dot${i === 0 ? ' active' : ''}" data-i="${i}"></span>`).join('')
      : '';
    document.querySelectorAll('.gallery-dot').forEach(d => d.addEventListener('click', () => { mainIdx = parseInt(d.dataset.i); paintMain(); }));
    paintMain();

    // Swipe gestures on mobile
    const main = document.getElementById('gallery-section');
    let touchStartX = null;
    main.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    main.addEventListener('touchend', e => {
      if (touchStartX === null) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 40) shiftMain(dx < 0 ? 1 : -1);
      touchStartX = null;
    }, { passive: true });
  }

  function renderBoat() {
    renderGallery();

    document.getElementById('boat-name').textContent = boat.name;
    document.getElementById('breadcrumb-name').textContent = boat.name;
    document.getElementById('boat-location-tag').textContent = '📍 ' + boat.location;
    document.getElementById('boat-brand-tag').textContent = '⛵ ' + (boat.brand || 'Embarcación');
    const dayBased = isDayBased();
    document.getElementById('panel-price').textContent = '$' + Number(dayBased ? dayBasedMinPrice() : boat.price_per_day).toLocaleString();
    document.getElementById('panel-price-unit').textContent = dayBased ? 'USD / desde' : boat.pricing_scheme ? 'USD / paquete' : (boat.location === 'Boca Chica' ? 'USD / todo incluido' : 'USD / día');
    document.getElementById('boat-description').textContent = boat.description || '';

    // Boca Chica: precio fijo todo incluido, sin extras de pago que elegir
    const includedBlock = document.getElementById('included-block');
    if (includedBlock) includedBlock.style.display = (boat.location === 'Boca Chica') ? '' : 'none';

    // Esquema de precio por paquete de horas (fuera de Boca Chica)
    if (!boat.for_sale) {
      renderDayBasedUI();
      renderIncluded();
      renderPackageOptions();
      renderExtraHoursUI();
      renderMealAddonsUI();
      const maxG = (boat.pricing_scheme && boat.pricing_scheme.max_capacity) || boat.capacity;
      document.getElementById('guests-input').max = maxG;
      document.getElementById('guests-max-label').textContent = 'máx. ' + maxG;
      clampGuests();
    }

    // Specs
    const specsData = [
      ['👥', 'Capacidad', boat.capacity + ' personas'],
      boat.for_sale
        ? ['🏷️', 'Venta', boat.sale_price ? '$' + Number(boat.sale_price).toLocaleString() : 'Consultar']
        : ['💰', 'Precio', dayBased ? 'Desde $' + dayBasedMinPrice().toLocaleString() : '$' + Number(boat.price_per_day).toLocaleString()],
      ['📍', 'Puerto', boat.location],
    ];
    document.getElementById('boat-specs').innerHTML = specsData.map(([icon, label, v]) => `
      <div class="boat-spec-item">
        <div class="boat-spec-icon">${icon}</div>
        <div class="boat-spec-label">${label}</div>
        <div class="boat-spec-val">${v}</div>
      </div>`).join('');

    // Sticky mobile price bar
    const stickyBtn = document.getElementById('sticky-book-btn');
    if (boat.for_sale) {
      document.getElementById('sticky-price').textContent = boat.sale_price ? '$' + Number(boat.sale_price).toLocaleString() : 'Consultar';
      document.getElementById('sticky-price-unit').textContent = boat.sale_price ? 'USD' : 'precio';
      stickyBtn.textContent = 'Ver más';
    } else {
      document.getElementById('sticky-price').textContent = '$' + Number(dayBased ? dayBasedMinPrice() : boat.price_per_day).toLocaleString();
      document.getElementById('sticky-price-unit').textContent = dayBased ? 'USD / desde' : boat.pricing_scheme ? 'USD / paquete' : 'USD / día';
      stickyBtn.textContent = 'Reservar';
    }

    // Favorito (persistido en localStorage)
    const favBtn = document.getElementById('gallery-fav');
    const favs = JSON.parse(localStorage.getItem('vbr_favs') || '[]');
    favBtn.textContent = favs.includes(boat.id) ? '❤️' : '♡';
    favBtn.onclick = () => {
      const cur = JSON.parse(localStorage.getItem('vbr_favs') || '[]');
      const has = cur.includes(boat.id);
      const next = has ? cur.filter(id => id !== boat.id) : [...cur, boat.id];
      localStorage.setItem('vbr_favs', JSON.stringify(next));
      favBtn.textContent = has ? '♡' : '❤️';
      window.VBR?.toast(has ? 'Eliminado de favoritos' : 'Guardado en favoritos', 'success');
    };

    // Amenidades
    const amen = boat.amenities || [];
    const amenBlock = document.getElementById('boat-amenities').parentElement;
    if (amenBlock) amenBlock.style.display = amen.length ? '' : 'none';
    document.getElementById('boat-amenities').innerHTML = amen.map(a => `<span class="feature-tag">${esc(a)}</span>`).join('');


    // Guests max (ya ajustado arriba según pricing_scheme.max_capacity cuando aplica)
  }

  /* ── Availability ── */
  function loadAvailability() {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    fetchAvailability();
  }

  let availabilityRequestId = 0;
  function fetchAvailability() {
    const requestId = ++availabilityRequestId;
    const requestedYear = calYear, requestedMonth = calMonth;
    fetch(`/api/boats/${boat.id}/availability?year=${requestedYear}&month=${requestedMonth + 1}`)
      .then(r => r.json())
      .then(data => {
        // Ignora respuestas de un mes que el usuario ya dejó atrás (petición más lenta
        // que llega después de haber navegado a otro mes) — evita mostrar disponibilidad de un mes distinto.
        if (requestId !== availabilityRequestId || requestedYear !== calYear || requestedMonth !== calMonth) return;
        bookedSlots = {};
        if (Array.isArray(data)) {
          data.forEach(b => {
            if (!bookedSlots[b.start_date]) bookedSlots[b.start_date] = [];
            if (b.schedule) bookedSlots[b.start_date].push(b.schedule);
          });
        }
        renderCalendar();
        if (selDate) refreshSlotUI();
      })
      .catch(() => { if (requestId === availabilityRequestId) renderCalendar(); });
  }

  function getSlotDefs() {
    const scheme = boat && boat.pricing_scheme;
    if (scheme && scheme.type === 'day_based') return DEFAULT_SLOTS;
    if (scheme && scheme.time_slots && scheme.time_slots.length) {
      const icons = ['🌅', '☀️', '🌆', '🌙'];
      return scheme.time_slots.map((label, i) => ({ key: label, label, shortLabel: 'Turno ' + (i + 1), icon: icons[i] || '🕐' }));
    }
    if (scheme) return [{ key: 'full-day', label: 'Día completo', shortLabel: 'Día completo', icon: '📅' }];
    return DEFAULT_SLOTS;
  }
  const DEFAULT_SLOTS = [
    { key: '9am-3pm', label: '9:00 AM – 3:00 PM', shortLabel: 'Mañana/Tarde', icon: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M5 17a7 7 0 0 1 14 0z" fill="#FBBF24"/><path d="M12 3.5v2.5M5 8l1.8 1.8M19 8l-1.8 1.8M2.5 13.5H5M19 13.5h2.5" stroke="#F59E0B" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M3 20.5h18" stroke="#38BDF8" stroke-width="2" stroke-linecap="round"/></svg>' },
    { key: '4pm-10pm', label: '4:00 PM – 10:00 PM', shortLabel: 'Tarde/Noche', icon: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M6.5 18a5.5 5.5 0 0 1 11 0z" fill="#F97316"/><path d="M12 7v2.5M6 10.5l1.7 1.7M18 10.5l-1.7 1.7M3.5 15.5H6M18 15.5h2.5" stroke="#FB7185" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M3 20.5h18" stroke="#A855F7" stroke-width="2" stroke-linecap="round"/></svg>' },
  ];

  /* ── Precios por día de la semana + combo de cumpleaños ── */
  const isDayBased = () => !!(boat && boat.pricing_scheme && boat.pricing_scheme.type === 'day_based');
  const isWeekendDate = (ds) => [0, 6].includes(new Date(ds + 'T00:00:00').getDay());
  // Tarifa de fin de semana: solo sábado/domingo EN LA TARDE; la mañana cuesta lo mismo que de lunes a viernes.
  const dayKey = () => (selDate && isWeekendDate(selDate) && selSlot === '4pm-10pm') ? 'weekend' : 'weekday';
  const dayBasedMinPrice = () => Math.min(...Object.values(boat.pricing_scheme.prices));

  function renderDayBasedUI() {
    const sec = document.getElementById('daybased-section');
    if (!isDayBased() || boat.location !== 'Boca Chica') { sec.style.display = 'none'; selBirthday = false; return; }
    const p = boat.pricing_scheme.prices;
    sec.style.display = 'block';
    const diff = document.getElementById('birthday-diff');
    diff.textContent = ''; diff.style.display = 'none';
  }

  // Lo incluido depende del servicio elegido: normal o con combo de cumpleaños (solo Boca Chica).
  const INC_EMOJI = { 'parrillada': '🍖', 'agua': '💧', 'hielo': '🧊', 'gasolina': '⛽', 'tripulación': '⚓', 'cocinero': '👨‍🍳',
    '1 hora de jetski': '🌊', '1 hora de jet ski': '🌊', 'jetski': '🌊', 'decoración': '🎈', 'bizcocho': '🎂', 'refresco': '🥤', 'bbq en vivo': '🍖' };
  const incChip = (name, extra) => '<span class="inc-chip' + (extra ? ' is-combo' : '') + '"><span aria-hidden="true">' + (INC_EMOJI[String(name).toLowerCase()] || '✔️') + '</span>' + name + '</span>';
  function renderIncluded() {
    if (boat.location !== 'Boca Chica') return;
    const s = boat.pricing_scheme;
    const dayBased = isDayBased();
    const base = (dayBased && s.included) || ['Agua', 'Hielo', 'Gasolina', 'Tripulación'];
    const sunday = !!selDate && new Date(selDate + 'T00:00:00').getDay() === 0;
    // Los domingos el combo no incluye la hora de jetski (en ninguna embarcación)
    const combo = (dayBased && selBirthday) ? (s.birthday_combo || []).filter(i => !(sunday && /jetski|jet ski/i.test(i))) : [];
    // con el combo, la lista del combo se muestra completa (incluye parrillada y cocinero) y arriba solo queda lo que el combo no repite
    const baseShown = combo.length ? base.filter(i => !combo.includes(i)) : base;
    document.getElementById('included-title').textContent = 'Incluido en el precio';
    document.getElementById('included-text').innerHTML = baseShown.map(i => incChip(i, false)).join('') +
      (combo.length ? '<div class="inc-combo-title">🎉 Con el combo de cumpleaños</div>' + combo.map(i => incChip(i, true)).join('') + (sunday && (s.birthday_combo || []).some(i => /jetski|jet ski/i.test(i)) ? '<div class="inc-note">Los domingos el combo no incluye el jetski.</div>' : '') : '');
  }

  window.toggleBirthday = function (checked) { selBirthday = !!checked; renderIncluded(); updateSummary(); };

  /* ── Hora de República Dominicana: no se cotiza un turno ya pasado ni con menos de 2 h de antelación ── */
  const DR_TZ = 'America/Santo_Domingo', MIN_LEAD_MIN = 120;
  function nowDR() {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: DR_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date()).map(x => [x.type, x.value]));
    return { date: p.year + '-' + p.month + '-' + p.day, minutes: parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10) };
  }
  function slotStartMin(key) {
    const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(String(key || ''));
    if (!m) return 8 * 60;
    let h = parseInt(m[1], 10) % 12;
    if (m[3].toLowerCase() === 'pm') h += 12;
    return h * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  }
  function isSlotClosed(ds, key) {
    const n = nowDR();
    if (ds < n.date) return true;
    if (ds > n.date) return false;
    return n.minutes > slotStartMin(key) - MIN_LEAD_MIN;
  }
  const isDayClosed = (ds) => getSlotDefs().every(d => isSlotClosed(ds, d.key));

  function isDayFull(ds) {
    const slots = bookedSlots[ds] || [];
    return getSlotDefs().every(d => slots.includes(d.key) || isSlotClosed(ds, d.key));
  }

  /* ── Calendar ── */
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const DAYS_HDR = ['Do','Lu','Ma','Mi','Ju','Vi','Sa'];
  const DAYS_SHORT = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

  function renderCalendar() {
    document.getElementById('cal-title').textContent = MONTHS[calMonth] + ' ' + calYear;

    const hdr = document.getElementById('cal-days-header');
    hdr.innerHTML = DAYS_HDR.map(d => `<div class="calendar-day-name">${d}</div>`).join('');

    const first = new Date(calYear, calMonth, 1);
    const last  = new Date(calYear, calMonth + 1, 0);
    const today = new Date(); today.setHours(0,0,0,0);
    const cells = [];
    const drToday = nowDR().date;

    for (let i = 0; i < first.getDay(); i++) cells.push('<div class="calendar-day empty"></div>');

    const todayStr = ymd(today);

    for (let d = 1; d <= last.getDate(); d++) {
      const date = new Date(calYear, calMonth, d);
      const ds = ymd(date);
      const isPast = ds < drToday || isDayClosed(ds);
      const isFull = isDayFull(ds);
      const isToday = ds === drToday;
      const dayName = DAYS_SHORT[date.getDay()];
      const inner = `<span class="cal-day-name">${dayName}</span><span class="cal-day-num">${d}</span>`;
      let cls = 'calendar-day';
      if (isPast)        { cls += ' past'; cells.push(`<div class="${cls}">${inner}</div>`); continue; }
      if (isFull)        { cls += ' blocked'; cells.push(`<div class="${cls}">${inner}</div>`); continue; }
      if (ds === selDate)  cls += ' selected';
      else if (isToday)    cls += ' today';
      cells.push(`<div class="${cls}" data-date="${ds}">${inner}</div>`);
    }

    document.getElementById('cal-days').innerHTML = cells.join('');
    $$('.calendar-day[data-date]').forEach(el => {
      el.addEventListener('click', () => onDateClick(el.dataset.date));
    });
  }

  function $$(sel) { return [...document.querySelectorAll(sel)]; }

  function onDateClick(ds) {
    if (ds < nowDR().date || isDayClosed(ds) || isDayFull(ds)) return;

    selDate = ds;
    selSlot = null;
    renderDayBasedUI();
    renderIncluded();
    renderCalendar();
    refreshSlotUI();
    updateSummary();
    updateWizardSteps();
  }

  /* ── Desbloquea los pasos 2 y 3 del flujo una vez elegida la fecha (y turno, si aplica) ── */
  function updateWizardSteps() {
    const step1 = document.getElementById('wizard-step-1');
    const step2 = document.getElementById('wizard-step-2');
    const step3 = document.getElementById('wizard-step-3');
    if (!step1 || !step2 || !step3) return;
    const needsSlot = getSlotDefs().length > 1;
    const ready = !!(selDate && (!needsSlot || selSlot));

    step1.classList.toggle('is-complete', ready);
    step2.classList.toggle('is-locked', !ready);
    step3.classList.toggle('is-locked', !ready);
    const sub2 = document.getElementById('wizard-step-2-sub');
    if (sub2) sub2.textContent = ready ? 'Ajusta personas y extras a tu gusto' : 'Primero elige la fecha en el paso 1';

  }

  function refreshSlotUI() {
    const sec = document.getElementById('schedule-section');
    const container = document.getElementById('schedule-options');
    if (!selDate) { sec.style.display = 'none'; return; }
    sec.style.display = 'block';

    const defs = getSlotDefs();
    const slots = bookedSlots[selDate] || [];

    if (defs.length === 1) {
      selSlot = defs[0].key;
      document.getElementById('schedule-title').textContent = 'Turno';
      container.style.gridTemplateColumns = '1fr';
      container.innerHTML = `<div style="font-size:0.85rem;color:var(--cream-2);padding:0.85rem;border:1.5px solid var(--line-2);border-radius:var(--r-sm);">📅 Reserva de día completo — el horario exacto se coordina con el capitán.</div>`;
      return;
    }

    document.getElementById('schedule-title').textContent = 'Selecciona el turno';
    container.style.gridTemplateColumns = defs.length >= 3 ? 'repeat(auto-fit, minmax(150px, 1fr))' : '1fr 1fr';
    container.innerHTML = defs.map(d => {
      const closed = isSlotClosed(selDate, d.key);
      const booked = slots.includes(d.key) || closed;
      const cls = 'schedule-btn' + (booked ? ' slot-booked' : '') + (selSlot === d.key && !closed ? ' slot-selected' : '');
      const safeKey = d.key.replace(/'/g, "\\'");
      return `<button type="button" class="${cls}" ${booked ? 'disabled' : ''} data-action="select-slot" data-slot="${esc(d.key)}">
        <span class="slot-icon">${d.icon}</span>
        <span class="slot-time">${d.label}</span>
        ${closed ? '' : booked ? '<span class="slot-status">Reservado</span>' :'<span class="slot-dot" title="Disponible"></span>'}
      </button>`;
    }).join('');
  }

  window.selectSlot = function(slot) {
    if (!selDate) return;
    selSlot = slot;
    renderDayBasedUI();
    refreshSlotUI();
    updateSummary();
    updateWizardSteps();
  };

  /* ── Paquetes de horas / horas extra / extras de comida (esquema especial) ── */
  window.selectPackage = function (hours) {
    selPackageHours = hours;
    renderPackageOptions();
    updateSummary();
  };

  function renderPackageOptions() {
    const scheme = boat.pricing_scheme;
    const sec = document.getElementById('package-section');
    if (!scheme || !scheme.packages || !scheme.packages.length) { sec.style.display = 'none'; return; }
    sec.style.display = 'block';
    if (!selPackageHours || !scheme.packages.some(p => p.hours === selPackageHours)) selPackageHours = scheme.packages[0].hours;
    document.getElementById('package-options').innerHTML = scheme.packages.map(p => `
      <label class="additional-item" style="cursor:pointer;">
        <input type="radio" name="pkg-hours" value="${p.hours}" ${selPackageHours === p.hours ? 'checked' : ''} data-action="select-package" data-hours="${p.hours}" style="display:none;" />
        <div class="additional-icon">⏱️</div>
        <div class="additional-info">
          <div class="additional-name">${p.hours} horas</div>
          <div class="additional-price">$${p.price.toLocaleString()}</div>
        </div>
      </label>`).join('');
  }

  function renderExtraHoursUI() {
    const scheme = boat.pricing_scheme;
    const sec = document.getElementById('extra-hours-section');
    if (!scheme || !scheme.extra_hour_price) { sec.style.display = 'none'; return; }
    sec.style.display = 'block';
    document.getElementById('extra-hours-price-label').textContent = `+$${scheme.extra_hour_price} usd / hora`;
    document.getElementById('extra-hours-val').textContent = extraHours;
  }

  function renderMealAddonsUI() {
    const scheme = boat.pricing_scheme;
    const sec = document.getElementById('meal-addons-section');
    if (!scheme || !scheme.meal_addons || !scheme.meal_addons.length) { sec.style.display = 'none'; return; }
    sec.style.display = 'block';
    document.getElementById('meal-addons-options').innerHTML = scheme.meal_addons.map(m => `
      <label class="additional-item">
        <input type="checkbox" class="meal-addon-cb" data-key="${m.key}" data-price="${m.price}" data-pp="${m.per_person ? 1 : 0}" data-action="recalc-total" />
        <div class="additional-icon">🍽️</div>
        <div class="additional-info">
          <div class="additional-name">${m.name}</div>
          <div class="additional-price">+$${m.price}${m.per_person ? '/persona' : ''}</div>
        </div>
      </label>`).join('');
  }

  function getMealAddons() {
    const guests = parseInt(document.getElementById('guests-input').value) || 1;
    const cbs = document.querySelectorAll('.meal-addon-cb:checked');
    return Array.from(cbs).map(c => {
      const perPerson = c.dataset.pp === '1';
      const unit = parseInt(c.dataset.price);
      const price = perPerson ? unit * guests : unit;
      return { key: c.dataset.key, price, name: c.closest('.additional-item').querySelector('.additional-name').textContent };
    });
  }

  /* ── Contador de personas (+/-, editable, con tope de capacidad) ── */
  function getMaxGuests() {
    return (boat.pricing_scheme && boat.pricing_scheme.max_capacity) || boat.capacity || 99;
  }

  function clampGuests() {
    const input = document.getElementById('guests-input');
    const max = getMaxGuests();
    let v = parseInt(input.value);
    if (isNaN(v) || v < 1) v = 1;
    if (v > max) { v = max; window.VBR?.toast('Máximo ' + max + ' personas para esta embarcación', 'error'); }
    input.value = v;
    return v;
  }

  window.recalcTotal = function () { updateSummary(); };

  /* ── Cálculo unificado del total (usado por el resumen y la reserva) ── */
  function computeBooking() {
    const scheme = boat.pricing_scheme;
    const defs = getSlotDefs();
    const needsSlot = defs.length > 1;
    const guests = parseInt(document.getElementById('guests-input').value) || 1;
    const ready = !!(selDate && (!needsSlot || selSlot));
    if (!ready) return { ready: false };

    const extraLines = [];
    let base, durationLabel, scheduleLabel;

    if (scheme && scheme.type === 'day_based') {
      const k = dayKey();
      base = scheme.prices[k];
      durationLabel = '1 turno (6 horas)';
      scheduleLabel = selSlot === '9am-3pm' ? '9:00 AM – 3:00 PM' : '4:00 PM – 10:00 PM';
      if (selBirthday) extraLines.push({ label: 'Combo de cumpleaños', price: scheme.prices[k + '_birthday'] - base, hidden: true });
    } else if (scheme) {
      const pkg = (scheme.packages || []).find(p => p.hours === selPackageHours) || scheme.packages[0];
      base = pkg.price;
      durationLabel = pkg.hours + ' horas';
      scheduleLabel = needsSlot ? selSlot : 'Día completo';

      if (scheme.extra_hour_price && extraHours > 0) {
        extraLines.push({ label: extraHours + 'h extra', price: extraHours * scheme.extra_hour_price });
      }
      if (scheme.overage_threshold && guests > scheme.overage_threshold) {
        const overN = guests - scheme.overage_threshold;
        extraLines.push({ label: '+' + overN + ' persona(s)', price: overN * scheme.overage_price_per_person });
      }
      getMealAddons().forEach(m => extraLines.push({ label: m.name, price: m.price }));
    } else {
      base = boat.price_per_day;
      durationLabel = '1 turno (6 horas)';
      scheduleLabel = selSlot === '9am-3pm' ? '9:00 AM – 3:00 PM' : '4:00 PM – 10:00 PM';
    }

    const extraTotal = extraLines.reduce((s, l) => s + l.price, 0);
    return { ready: true, scheme, guests, base, extraLines, extraTotal, total: base + extraTotal, durationLabel, scheduleLabel };
  }

  function updateSummary() {
    const lines = document.getElementById('booking-lines');
    const btn = document.getElementById('btn-reserve');
    const calc = computeBooking();
    if (calc.ready) {
      document.getElementById('sum-start').textContent = window.VBR.fmtDateShort(selDate);
      document.getElementById('sum-end').textContent = calc.scheduleLabel;
      document.getElementById('sum-days').textContent = calc.durationLabel;
      const addLine = document.getElementById('sum-additionals-line');
      if (calc.extraLines.length) {
        document.getElementById('sum-additionals').textContent = calc.extraLines.map(l => l.hidden ? l.label : l.label + ' +$' + l.price.toLocaleString()).join(' · ');
        addLine.style.display = 'flex';
      } else {
        addLine.style.display = 'none';
      }
      document.getElementById('sum-total').textContent = '$' + calc.total.toLocaleString() + ' USD';
      lines.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Reservar ahora';

      const hint = document.getElementById('overage-hint');
      if (calc.scheme && calc.scheme.overage_threshold && calc.guests > calc.scheme.overage_threshold) {
        hint.style.display = 'block';
        hint.textContent = `Incluye ${calc.guests - calc.scheme.overage_threshold} persona(s) extra a $${calc.scheme.overage_price_per_person} c/u.`;
      } else if (hint) hint.style.display = 'none';
    } else {
      lines.style.display = 'none';
      btn.disabled = true;
      btn.textContent = selDate ? 'Selecciona un turno' : 'Selecciona la fecha';
    }
  }

  /* ── Cal nav (only wired when boat is rentable) ── */
  function initBookingListeners() {
    document.getElementById('cal-prev').addEventListener('click', () => {
      const now = new Date();
      if (calYear === now.getFullYear() && calMonth === now.getMonth()) return;
      calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
      fetchAvailability();
    });
    document.getElementById('cal-next').addEventListener('click', () => {
      calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
      fetchAvailability();
    });
    document.getElementById('btn-reserve').addEventListener('click', startBooking);
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('booking-modal').addEventListener('click', e => { if (e.target.id === 'booking-modal') closeModal(); });
    document.getElementById('guests-input').addEventListener('input', () => { clampGuests(); updateSummary(); });
    document.getElementById('guests-minus').addEventListener('click', () => {
      document.getElementById('guests-input').value = Math.max(1, (parseInt(document.getElementById('guests-input').value) || 1) - 1);
      clampGuests();
      updateSummary();
    });
    document.getElementById('guests-plus').addEventListener('click', () => {
      document.getElementById('guests-input').value = (parseInt(document.getElementById('guests-input').value) || 1) + 1;
      clampGuests();
      updateSummary();
    });
    document.getElementById('extra-hours-minus').addEventListener('click', () => {
      extraHours = Math.max(0, extraHours - 1);
      document.getElementById('extra-hours-val').textContent = extraHours;
      updateSummary();
    });
    document.getElementById('extra-hours-plus').addEventListener('click', () => {
      extraHours = Math.min(6, extraHours + 1);
      document.getElementById('extra-hours-val').textContent = extraHours;
      updateSummary();
    });
  }

  /* ── Delegated handlers (sin atributos on* por la CSP) ── */
  document.addEventListener('click', e => {
    const el = e.target.closest && e.target.closest('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
      case 'open-lightbox': window.openLightbox(parseInt(el.dataset.idx, 10)); break;
      case 'select-slot': window.selectSlot(el.dataset.slot); break;
      case 'copy-text': if (typeof window.copyText === 'function') window.copyText(el.dataset.text); break;
    }
  });
  document.addEventListener('change', e => {
    const el = e.target.closest && e.target.closest('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
      case 'toggle-birthday': window.toggleBirthday(el.checked); break;
      case 'select-package': window.selectPackage(parseInt(el.dataset.hours, 10)); break;
      case 'recalc-total': window.recalcTotal(); break;
    }
  });
  const hover = (e, on) => {
    const el = e.target.closest && e.target.closest('[data-hover-prop]');
    if (!el) return;
    el.style[el.dataset.hoverProp] = on ? el.dataset.hoverOn : el.dataset.hoverOff;
  };
  document.addEventListener('mouseover', e => hover(e, true));
  document.addEventListener('mouseout', e => hover(e, false));

  document.addEventListener('DOMContentLoaded', () => {

    // Gallery floating actions
    document.getElementById('gallery-back').addEventListener('click', () => {
      if (document.referrer && document.referrer.includes(location.host)) history.back();
      else location.href = '/embarcaciones.html';
    });
    document.getElementById('gallery-share').addEventListener('click', async () => {
      const shareData = { title: boat ? boat.name : 'VENDO BOTE RD', text: 'Mira esta embarcación en VENDO BOTE RD', url: location.href };
      if (navigator.share) { try { await navigator.share(shareData); } catch {} }
      else { navigator.clipboard.writeText(location.href).then(() => window.VBR?.toast('Enlace copiado', 'success')); }
    });
    document.getElementById('sticky-book-btn').addEventListener('click', () => {
      document.getElementById('booking-sidebar').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Lightbox
    document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
    document.getElementById('lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') closeLightbox(); });
    document.getElementById('lightbox-prev').addEventListener('click', () => { lightboxIdx = (lightboxIdx - 1 + lightboxImgs.length) % lightboxImgs.length; updateLightbox(); });
    document.getElementById('lightbox-next').addEventListener('click', () => { lightboxIdx = (lightboxIdx + 1) % lightboxImgs.length; updateLightbox(); });
    document.addEventListener('keydown', e => {
      if (document.getElementById('lightbox').classList.contains('is-open')) {
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft')  { lightboxIdx = (lightboxIdx - 1 + lightboxImgs.length) % lightboxImgs.length; updateLightbox(); }
        if (e.key === 'ArrowRight') { lightboxIdx = (lightboxIdx + 1) % lightboxImgs.length; updateLightbox(); }
      }
    });

    loadBoat();
  });

  window.openLightbox = function (idx) {
    lightboxIdx = idx;
    updateLightbox();
    document.getElementById('lightbox').classList.add('is-open');
    document.body.style.overflow = 'hidden';
  };
  function closeLightbox() {
    document.getElementById('lightbox').classList.remove('is-open');
    document.body.style.overflow = '';
    const v = document.getElementById('lightbox').querySelector('video');
    if (v) v.pause();
  }
  function updateLightbox() {
    const src = lightboxImgs[lightboxIdx];
    const box = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    let vid = box.querySelector('.lightbox-vid');
    if (/\.(mp4|webm|mov)$/i.test(src)) {
      img.style.display = 'none';
      if (!vid) { vid = document.createElement('video'); vid.className = 'lightbox-vid'; vid.controls = true; vid.style.cssText = 'max-width:90vw;max-height:80vh;border-radius:12px;'; box.insertBefore(vid, img.nextSibling); }
      vid.src = src; vid.style.display = 'block'; vid.play();
    } else {
      img.src = src; img.style.display = 'block';
      if (vid) { vid.pause(); vid.style.display = 'none'; }
    }
    document.getElementById('lightbox-counter').textContent = (lightboxIdx + 1) + ' / ' + lightboxImgs.length;
  }

  /* ── Reserve flow ── */
  async function startBooking() {
    const me = await window.VBR_getUser();
    if (!me) { sessionStorage.setItem('vbr_redirect', location.href); location.href = '/auth.html'; return; }
    const calc = computeBooking();
    if (!calc.ready) { window.VBR.toast('Selecciona fecha y turno', 'error'); return; }
    if (isSlotClosed(selDate, selSlot)) { window.VBR.toast('Este turno ya no está disponible: reserva al menos 2 horas antes del horario.', 'error'); selSlot = null; refreshSlotUI(); updateSummary(); return; }
    const maxCapacity = (boat.pricing_scheme && boat.pricing_scheme.max_capacity) || boat.capacity;
    if (calc.guests > maxCapacity) { window.VBR.toast('Máximo ' + maxCapacity + ' personas', 'error'); return; }
    await loadAzulConfig();
    showModal(calc);
  }

  // ¿Está habilitado el pago con tarjeta (AZUL)? Si falla la consulta, solo transferencia.
  let azulEnabled = false, itbisRate = 0.18;
  function loadAzulConfig() {
    return fetch('/api/payments/azul/config', { credentials: 'same-origin' })
      .then(r => r.json()).then(d => {
        azulEnabled = !!(d && d.enabled);
        if (d && typeof d.itbisRate === 'number' && d.itbisRate >= 0 && d.itbisRate <= 1) itbisRate = d.itbisRate;
      })
      .catch(() => { azulEnabled = false; });
  }

  const BANKS = [
    { name: 'Banco Popular', rows: [['Banco', 'Banco Popular Dominicano'], ['Tipo', 'Cuenta corriente'], ['Titular', 'Penelope Gonzalez Then', 1], ['Cuenta', '0832468474', 1]] },
    { name: 'Zelle', usd: true, rows: [['Método', 'Zelle'], ['Correo', 'vendobote@icloud.com', 1]] },
    { name: 'Banreservas (DOP)', rows: [['Banco', 'Banco de Reservas (BanReservas)'], ['Tipo', 'Cuenta en pesos (DOP)'], ['Titular', 'Juan Alberto Romero', 1], ['Cuenta', '9606655039', 1], ['Cédula', '226-0007735-2', 1]] },
    { name: 'Banreservas USD', usd: true, rows: [['Banco', 'Banco de Reservas (BanReservas)'], ['Tipo', 'Cuenta en dólares (USD)'], ['Titular', 'Juan Alberto Romero', 1], ['Cuenta', '9609859038', 1]] },
    { name: 'Banco BHD', rows: [['Banco', 'Banco BHD'], ['Titular', 'Penelope Gonzalez Then', 1], ['Cuenta', '36727140016', 1]] },
  ];

  function showModal(calc) {
    const addHTML = calc.extraLines.length ? `
      <div style="border-top:1px solid var(--line);margin-top:0.5rem;padding-top:0.5rem;">
        <div style="font-family:var(--mono);font-size:0.6875rem;color:var(--cream-3);letter-spacing:0.12em;text-transform:uppercase;margin-bottom:0.4rem;">${boat.pricing_scheme ? 'Cargos adicionales' : 'Adicionales'}</div>
        ${calc.extraLines.map(a => `<div style="display:flex;justify-content:space-between;font-size:0.82rem;color:var(--cream-2);padding:0.15rem 0;">${a.label}<span style="color:var(--sky-2);">+$${a.price.toLocaleString()}</span></div>`).join('')}
      </div>` : '';
    document.getElementById('modal-title').textContent = 'Confirmar y pagar';
    document.getElementById('modal-body').innerHTML = `
      <div class="sum-card">
        <div class="sum-head">
          <div class="sum-boat">${boat.name}</div>
          <div class="sum-loc">📍 ${boat.location}</div>
        </div>
        <div class="sum-rows">
          <div class="sum-row"><span>Fecha</span><strong>${window.VBR.fmtDateShort(selDate)}</strong></div>
          <div class="sum-row"><span>Horario</span><strong>${calc.scheduleLabel}</strong></div>
          <div class="sum-row"><span>Duración</span><strong>${calc.durationLabel}</strong></div>
          <div class="sum-row"><span>Personas</span><strong>${calc.guests}</strong></div>
          ${calc.extraLines.map(x => `<div class="sum-row sum-extra"><span>${x.label}</span><strong>${x.hidden ? 'Incluido' : '+$' + x.price.toLocaleString()}</strong></div>`).join('')}
        </div>
        <div class="sum-total"><span>Total</span><strong>$${Number(calc.total).toLocaleString()} USD</strong></div>
      </div>
      <div class="form-group" style="margin-bottom:1.25rem;">
        <label class="form-label" for="special-requests">Solicitudes especiales (opcional)</label>
        <textarea class="form-textarea" id="special-requests" placeholder="Decoración especial, peticiones del grupo..." rows="3" maxlength="500"></textarea>
      </div>
      ${azulEnabled ? `<div class="pay-methods" role="radiogroup" aria-label="Método de pago">
        <label class="pay-method is-active" id="pm-transfer"><input type="radio" name="pay-method" value="transfer" checked /><span>Transferencia</span></label>
        <label class="pay-method" id="pm-card"><input type="radio" name="pay-method" value="card" /><span>Tarjeta (AZUL)</span></label>
      </div>` : ''}
      <div id="pay-transfer">
      <div style="border:1.5px solid var(--line-2);border-radius:var(--r-sm);padding:1rem;margin-bottom:1rem;">
        <div style="font-weight:700;color:var(--cream);margin-bottom:0.15rem;">1. Transfiere ${'$'}${Number(calc.total).toLocaleString()} USD</div>
        <div style="font-size:0.8rem;color:var(--cream-3);margin-bottom:0.6rem;">Elige el banco y transfiere el monto exacto.</div>
        <select class="form-select" id="pay-bank" aria-label="Banco para la transferencia">${BANKS.map((b, i) => '<option value="' + i + '">' + b.name + '</option>').join('')}</select>
        <div id="pay-bank-detail" style="margin-top:0.6rem;"></div>
        <div id="pay-dop" class="pay-dop" aria-live="polite"></div>
      </div>
      <div style="border:1.5px solid var(--line-2);border-radius:var(--r-sm);padding:1rem;margin-bottom:1rem;">
        <div style="font-weight:700;color:var(--cream);margin-bottom:0.15rem;">2. Adjunta el comprobante <span style="color:#B91C1C;">*</span></div>
        <div style="font-size:0.8rem;color:var(--cream-3);margin-bottom:0.6rem;">Obligatorio para reservar. Foto o captura de la transferencia (JPG, PNG, WEBP o PDF, máx. 10MB).</div>
        <input type="file" class="form-input" id="receipt-file" accept=".jpg,.jpeg,.png,.pdf,.webp" style="padding:0.6rem;" />
        <div id="receipt-error" class="form-error hidden" role="alert" style="margin-top:0.5rem;"></div>
      </div>
      <button class="btn btn-primary w-full" id="confirm-booking-btn" style="justify-content:center;" disabled>
        Adjunta el comprobante para reservar
      </button>
      <p style="font-size:0.75rem;color:var(--cream-3);text-align:center;margin-top:0.75rem;line-height:1.5;">
        Tu reserva se envía junto con el comprobante y nuestro equipo la verificará en menos de 24 horas.
      </p>
      </div>
      <div id="pay-card" class="pay-card hidden">
        <div class="pay-card-total">
          <div class="pay-card-line"><span>Total a pagar</span><strong>$${Number(calc.total).toLocaleString()} USD</strong></div>
          <div class="pay-card-line"><span>Subtotal</span><strong id="pay-card-sub">Calculando…</strong></div>
          <div class="pay-card-line"><span id="pay-card-itbis-lbl">ITBIS</span><strong id="pay-card-itbis">Calculando…</strong></div>
          <div class="pay-card-line"><span>Total a pagar con tarjeta</span><strong id="pay-card-dop">Calculando…</strong></div>
          <div class="pay-dop-note" id="pay-card-rate"></div>
          <div class="pay-dop-note">El pago con tarjeta incluye ITBIS; la transferencia no.</div>
        </div>
        <div class="pay-card-secure">Pagarás en el sitio seguro de AZUL; no guardamos tu tarjeta.</div>
        <div class="pay-logos" aria-label="Tarjetas aceptadas y autenticación segura">
          <img src="/assets/img/pagos/visa.png" alt="Visa" height="28" />
          <img src="/assets/img/pagos/mastercard.png" alt="MasterCard" height="28" />
          <img src="/assets/img/pagos/verified-by-visa.png" alt="Verified by Visa" height="28" />
          <img src="/assets/img/pagos/mastercard-idcheck.png" alt="MasterCard ID Check" height="28" />
        </div>
        <label class="pay-terms" for="accept-terms">
          <input type="checkbox" id="accept-terms" />
          <span>Acepto los <a href="/terminos.html" target="_blank" rel="noopener">Términos y Condiciones</a> y la <a href="/reembolsos.html" target="_blank" rel="noopener">Política de reembolsos y cambios de fecha</a>. Más sobre la <a href="/seguridad-pagos.html" target="_blank" rel="noopener">seguridad de los pagos</a>.</span>
        </label>
        <button class="btn btn-primary w-full" id="pay-card-btn" style="justify-content:center;" disabled>Pagar con tarjeta</button>
      </div>
    `;
    openModal();
    const bankSel = document.getElementById('pay-bank');
    const renderBank = () => {
      const bk = BANKS[parseInt(bankSel.value, 10)];
      document.getElementById('pay-bank-detail').innerHTML = bk.rows.map(r =>
        '<div class="bank-row"><span class="bank-key">' + r[0] + '</span><div style="display:flex;gap:0.5rem;align-items:center;"><span class="bank-val">' + r[1] + '</span>' +
        (r[2] ? '<button type="button" class="bank-copy" data-action="copy-text" data-text="' + esc(r[1]) + '">Copiar</button>' : '') + '</div></div>').join('');
    };
    // Conversión a pesos con la tasa del día (las cuentas en dólares no se convierten)
    let usdDop = null;
    const dopBox = document.getElementById('pay-dop');
    const renderDop = () => {
      const bk = BANKS[parseInt(bankSel.value, 10)];
      if (bk.usd) { dopBox.innerHTML = '<div class="pay-dop-note">Esta cuenta recibe <strong>dólares</strong>: transfiere el monto en USD.</div>'; return; }
      if (!usdDop) { dopBox.innerHTML = '<div class="pay-dop-note">Calculando el monto en pesos…</div>'; return; }
      if (usdDop.error) { dopBox.innerHTML = '<div class="pay-dop-note">No pudimos cargar la tasa del día. Consulta el monto en pesos con tu banco.</div>'; return; }
      const dop = calc.total * usdDop.rate;
      const fmtDop = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', currencyDisplay: 'code' }).format(dop).replace('DOP', 'RD$').replace(/\u00a0/g, ' ');
      dopBox.innerHTML = '<div class="pay-dop-main"><span>Si transfieres en pesos</span><strong>' + fmtDop + '</strong></div>' +
        '<div class="pay-dop-note">Tasa del día: 1 USD = RD$ ' + usdDop.rate.toFixed(2) + '. Es una referencia; tu banco puede aplicar una tasa un poco distinta.</div>';
    };
    fetch('/api/rates/usd-dop').then(r => r.json()).then(d => { usdDop = d && d.rate ? d : { error: true }; renderDop(); }).catch(() => { usdDop = { error: true }; renderDop(); });
    bankSel.addEventListener('change', () => { renderBank(); renderDop(); }); renderBank(); renderDop();
    const fileInput = document.getElementById('receipt-file');
    const confirmBtn = document.getElementById('confirm-booking-btn');
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0], err = document.getElementById('receipt-error');
      err.classList.add('hidden');
      let valid = !!f;
      if (f && !/[.](jpe?g|png|webp|pdf)$/i.test(f.name)) { err.textContent = 'El comprobante debe ser JPG, PNG, WEBP o PDF.'; valid = false; }
      else if (f && f.size > 10 * 1024 * 1024) { err.textContent = 'El archivo supera los 10MB.'; valid = false; }
      if (f && !valid) err.classList.remove('hidden');
      confirmBtn.disabled = !valid;
      confirmBtn.textContent = valid ? 'Enviar reserva con comprobante' : 'Adjunta el comprobante para reservar';
    });
    confirmBtn.addEventListener('click', () => submitBooking(calc));

    // ── Pago con tarjeta (AZUL) ──
    if (azulEnabled) {
      const transferBox = document.getElementById('pay-transfer'), cardBox = document.getElementById('pay-card');
      const cardDop = document.getElementById('pay-card-dop'), cardRate = document.getElementById('pay-card-rate');
      const terms = document.getElementById('accept-terms'), cardBtn = document.getElementById('pay-card-btn');
      const fmtRD = (n) => 'RD$ ' + new Intl.NumberFormat('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
      const renderCardDop = () => {
        const cardSub = document.getElementById('pay-card-sub'), cardItbis = document.getElementById('pay-card-itbis');
        const itbisLbl = document.getElementById('pay-card-itbis-lbl');
        const rateTxt = Number((itbisRate * 100).toFixed(2)).toLocaleString('es-DO');
        itbisLbl.textContent = 'ITBIS (' + rateTxt + ' %)';
        if (!usdDop) { cardSub.textContent = cardItbis.textContent = cardDop.textContent = 'Calculando…'; return; }
        if (usdDop.error) {
          cardSub.textContent = cardItbis.textContent = cardDop.textContent = 'No disponible';
          cardRate.textContent = 'No pudimos cargar la tasa del día. Intenta de nuevo en unos minutos o paga por transferencia.';
          return;
        }
        // Vista previa: el servidor es la autoridad y calcula el cobro real (mismo redondeo en centavos).
        const baseCents = Math.round(calc.total * usdDop.rate * 100);
        const itbisCents = Math.round(baseCents * itbisRate);
        cardSub.textContent = fmtRD(baseCents / 100);
        cardItbis.textContent = fmtRD(itbisCents / 100);
        cardDop.textContent = fmtRD((baseCents + itbisCents) / 100);
        cardRate.textContent = 'Subtotal RD$ ' + fmtRD(baseCents / 100).replace('RD$ ', '') + ' · ITBIS (' + rateTxt + ' %) ' + fmtRD(itbisCents / 100) + ' · Total a pagar con tarjeta ' + fmtRD((baseCents + itbisCents) / 100) + '. Tasa del día: 1 USD = RD$ ' + usdDop.rate.toFixed(2) + '. El cobro final lo confirma AZUL en su pantalla de pago.';
      };
      const baseRender = renderDop;
      fetch('/api/rates/usd-dop').then(r => r.json()).then(d => { usdDop = d && d.rate ? d : { error: true }; baseRender(); renderCardDop(); }).catch(() => { usdDop = { error: true }; baseRender(); renderCardDop(); });
      document.querySelectorAll('input[name="pay-method"]').forEach(r => r.addEventListener('change', () => {
        const card = document.querySelector('input[name="pay-method"]:checked').value === 'card';
        transferBox.classList.toggle('hidden', card); cardBox.classList.toggle('hidden', !card);
        document.getElementById('pm-card').classList.toggle('is-active', card);
        document.getElementById('pm-transfer').classList.toggle('is-active', !card);
        if (card) renderCardDop();
      }));
      terms.addEventListener('change', () => { cardBtn.disabled = !terms.checked; });
      cardBtn.addEventListener('click', () => payWithCard(calc));
    }
  }

  // Inicia el pago: el servidor calcula el monto y firma; el navegador envía el formulario a AZUL.
  function payWithCard(calc) {
    const btn = document.getElementById('pay-card-btn');
    if (!document.getElementById('accept-terms').checked) { window.VBR.toast('Debes aceptar los Términos y la Política de reembolsos y cambios de fecha', 'error'); return; }
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Conectando con AZUL…';
    const reset = () => { btn.disabled = !document.getElementById('accept-terms').checked; btn.textContent = label; };
    const body = {
      boat_id: boat.id, start_date: selDate, schedule: selSlot, guests: calc.guests,
      special_requests: (document.getElementById('special-requests') || {}).value || '',
      accept_terms: true
    };
    if (isDayBased()) {
      body.birthday_combo = !!selBirthday;
    } else if (boat.pricing_scheme) {
      body.package_hours = selPackageHours;
      body.extra_hours = extraHours;
      body.meal_addons = getMealAddons().map(m => m.key);
    }
    fetch('/api/payments/azul/start', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json().catch(() => ({ error: 'Error de conexión con el servidor' })))
      .then(data => {
        if (!data || data.error || !data.action || !data.fields) {
          const msg = (data && data.error) || 'No se pudo iniciar el pago con tarjeta';
          window.VBR.toast(msg, 'error'); reset();
          if (/turno/i.test(msg)) fetchAvailability();
          return;
        }
        const form = document.createElement('form');
        form.method = 'post'; form.action = data.action; form.style.display = 'none';
        Object.keys(data.fields).forEach(k => {
          const i = document.createElement('input');
          i.type = 'hidden'; i.name = k; i.value = String(data.fields[k]);
          form.appendChild(i);
        });
        document.body.appendChild(form);
        form.submit();
      }).catch(() => { window.VBR.toast('Error al iniciar el pago con tarjeta', 'error'); reset(); });
  }

  function submitBooking(calc) {
    const btn = document.getElementById('confirm-booking-btn');
    const file = document.getElementById('receipt-file').files[0];
    if (!file) { window.VBR.toast('Adjunta el comprobante de pago para reservar', 'error'); return; }
    btn.disabled = true; btn.textContent = 'Enviando...';
    const special = document.getElementById('special-requests')?.value;
    const fd = new FormData();
    fd.append('boat_id', boat.id); fd.append('start_date', selDate); fd.append('schedule', selSlot);
    fd.append('guests', calc.guests); if (special) fd.append('special_requests', special);
    if (isDayBased()) {
      fd.append('birthday_combo', selBirthday ? 'true' : 'false');
    } else if (boat.pricing_scheme) {
      fd.append('package_hours', selPackageHours);
      fd.append('extra_hours', extraHours);
      fd.append('meal_addons', JSON.stringify(getMealAddons().map(m => m.key)));
    }
    fd.append('receipt', file);
    const reset = () => { btn.disabled = false; btn.textContent = 'Enviar reserva con comprobante'; };
    fetch('/api/bookings', { method: 'POST', credentials: 'same-origin', body: fd })
      .then(r => r.json().catch(() => ({ error: 'Error de conexión con el servidor' })))
      .then(data => {
        if (data.error) { window.VBR.toast(data.error, 'error'); reset(); if (/turno/i.test(data.error)) fetchAvailability(); return; }
        location.href = '/dashboard.html?sent=1';
      }).catch(() => { window.VBR.toast('Error al enviar la reserva', 'error'); reset(); });
  }

  function openModal()  { document.getElementById('booking-modal').classList.add('is-open'); document.body.style.overflow = 'hidden'; }
  function closeModal() { document.getElementById('booking-modal').classList.remove('is-open'); document.body.style.overflow = ''; }

  /* ── For-sale mode ── */
  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function activateSaleMode() {
    const wizard = document.getElementById('booking-sidebar');
    if (!wizard) return;

    const parent = wizard.parentElement;
    wizard.style.display = 'none';

    // WA link — boat.name is URL-encoded, safe in href
    const waText = encodeURIComponent(
      'Hola! Me interesa la embarcación ' + boat.name + ' que vi en VendoBoteRD.com. ¿Me pueden dar más información?'
    );
    const waLink = 'https://wa.me/14073614042?text=' + waText;

    // price block — uses Number, no user content
    const priceHtml = boat.sale_price
      ? '<div style="font-family:var(--serif);font-size:2rem;font-style:italic;font-weight:700;color:var(--sky-2);">$' + Number(boat.sale_price).toLocaleString() + ' <span style="font-family:var(--mono);font-size:0.75rem;font-style:normal;font-weight:400;color:var(--text-muted);">USD</span></div>'
      : '<div style="font-family:var(--serif);font-size:1.6rem;font-style:italic;font-weight:700;color:var(--sky-2);">Precio a consultar</div>';

    const panel = document.createElement('div');
    panel.className = 'booking-summary';
    // innerHTML uses esc() for any field that comes from the DB
    panel.innerHTML = `
      <div style="text-align:center;margin-bottom:1.5rem;">
        <div style="font-family:var(--mono);font-size:0.6875rem;letter-spacing:0.18em;color:var(--sky-2);text-transform:uppercase;margin-bottom:0.5rem;">EN VENTA</div>
        ${priceHtml}
      </div>
      <div style="border-top:1px solid var(--line-2);padding-top:1.25rem;margin-bottom:1.5rem;">
        <div style="font-family:var(--mono);font-size:0.6875rem;letter-spacing:0.15em;color:var(--text-muted);text-transform:uppercase;margin-bottom:0.9rem;">Detalles de la embarcación</div>
        <div style="display:flex;flex-direction:column;gap:0.55rem;">
          <div style="display:flex;justify-content:space-between;font-size:0.85rem;">
            <span style="color:var(--text-muted);">Capacidad</span>
            <span style="font-weight:600;color:var(--text);">${esc(String(boat.capacity))} personas</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:0.85rem;">
            <span style="color:var(--text-muted);">Ubicación</span>
            <span style="font-weight:600;color:var(--text);">📍 ${esc(boat.location || '—')}</span>
          </div>
        </div>
      </div>
      <a href="${waLink}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:0.65rem;background:#25D366;color:#fff;border-radius:var(--r-sm);padding:0.9rem 1.25rem;font-family:var(--mono);font-size:0.78rem;font-weight:500;letter-spacing:0.04em;text-decoration:none;transition:background 0.2s;" data-hover-prop="background" data-hover-on="#1ebe5d" data-hover-off="#25D366">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        Consultar por WhatsApp
      </a>
      <p style="font-family:var(--mono);font-size:0.6875rem;color:var(--text-muted);text-align:center;margin-top:0.85rem;line-height:1.6;">Respuesta rápida · Sin compromiso</p>
    `;
    parent.insertBefore(panel, wizard);
  }

})();
