/* ============================================================
   VENDO BOTE RD — Main JS
   ============================================================ */

(function () {
  'use strict';

  /* ── Utilities ── */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  // Escapa texto libre (nombres, notas, referencias, etc.) antes de insertarlo
  // vía innerHTML. Usar SIEMPRE con cualquier campo que un cliente pudo escribir.
  function esc(str) {
    if (str === null || str === undefined) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }
  window.VBR_esc = esc;

  // Formateo de fechas compartido (evita reimplementarlo en cada página)
  const fmtDateLong  = d => new Date(d + 'T00:00:00').toLocaleDateString('es-DO', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const fmtDateShort = d => new Date(d + 'T00:00:00').toLocaleDateString('es-DO', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
  const API = '/api';

  function safe(fn, name) {
    try { fn(); } catch (e) { console.warn('[VBR]', name, e); }
  }

  // Usuario con sesión (cookie propia). Se consulta una vez por página y se cachea la promesa.
  // Devuelve el usuario (id, name, email, role, profile_completed...) o null si no hay sesión.
  let _userPromise = null;
  function getUser(force) {
    if (!_userPromise || force) {
      _userPromise = fetch(API + '/auth/me', { credentials: 'same-origin' })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null);
    }
    return _userPromise;
  }
  window.VBR_getUser = getUser;
  window.VBR_logout = async function () {
    try { await fetch(API + '/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
    location.href = '/';
  };

  async function api(path, opts = {}) {
    const r = await fetch(API + path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
      body: opts.body && typeof opts.body === 'object' ? JSON.stringify(opts.body) : opts.body,
    });
    const isJson = (r.headers.get('content-type') || '').includes('application/json');
    if (!isJson) return { error: 'Error de conexión con el servidor (' + r.status + ')' };
    return r.json();
  }

  window.VBR = { api, esc, fmtDateLong, fmtDateShort, observeReveals, $, $$ };

  /* ── Toast ── */
  function toast(msg, type = 'info') {
    const icons = { success: '✓', error: '✕', info: '◈' };
    const container = $('#toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span class="toast-msg">${esc(msg)}</span>`;
    container.appendChild(el);
    requestAnimationFrame(() => { requestAnimationFrame(() => el.classList.add('is-in')); });
    setTimeout(() => {
      el.classList.remove('is-in');
      setTimeout(() => el.remove(), 500);
    }, 4000);
  }
  window.VBR.toast = toast;

  /* ── Copy utility ── */
  window.copyText = function (text) {
    navigator.clipboard.writeText(text).then(() => toast('Copiado al portapapeles', 'success'));
  };

  /* ── Splash ── */
  function initSplash() {
    const splash = $('[data-splash]');
    if (!splash) return;
    const hide = () => splash.classList.add('is-out');
    if (document.readyState === 'complete') setTimeout(hide, 700);
    else window.addEventListener('load', () => setTimeout(hide, 500));
    setTimeout(hide, 3800);
  }

  /* ── Nav ── */
  function initNav() {
    const nav = $('#nav');
    if (!nav) return;
    const update = () => nav.classList.toggle('is-scrolled', scrollY > 40);
    update();
    window.addEventListener('scroll', update, { passive: true });

    // Active link
    const path = location.pathname;
    $$('.nav-link').forEach(a => { if (a.getAttribute('href') === path) a.classList.add('active'); });

    // Estado de sesión
    const loginBtn = $('#nav-login-btn');
    const registerBtn = $('#nav-register-btn');
    const mobileLoginBtn = $('#nav-mobile-login-btn');
    getUser().then(u => {
      if (!u) return;
      const name = (u.name || '').split(' ')[0] || (u.email || '').split('@')[0] || 'Usuario';
      const role = u.role || 'user';
      if (loginBtn) { loginBtn.textContent = name; loginBtn.href = '/dashboard.html'; }
      if (registerBtn) {
        if (role === 'admin') { registerBtn.textContent = 'Admin Panel'; registerBtn.href = '/admin.html'; }
        else { registerBtn.textContent = 'Mis Reservas'; registerBtn.href = '/dashboard.html'; }
      }
      if (mobileLoginBtn) {
        if (role === 'admin') { mobileLoginBtn.innerHTML = '🛠️ Panel Admin'; mobileLoginBtn.href = '/admin.html'; }
        else { mobileLoginBtn.innerHTML = '👤 ' + name; mobileLoginBtn.href = '/dashboard.html'; }
      }
    });
  }

  /* ── Hamburger ── */
  function initHamburger() {
    const btn = $('#hamburger');
    const mobile = $('#nav-mobile');
    if (!btn || !mobile) return;
    btn.addEventListener('click', () => {
      const open = btn.classList.toggle('is-open');
      mobile.classList.toggle('is-open', open);
      mobile.setAttribute('aria-hidden', String(!open));
      document.body.style.overflow = open ? 'hidden' : '';
    });
    $$('.nav-mobile-link', mobile).forEach(a => a.addEventListener('click', () => {
      btn.classList.remove('is-open');
      mobile.classList.remove('is-open');
      mobile.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }));
  }

  /* ── Scroll progress ── */
  function initScrollProgress() {
    const bar = $('[data-scroll-progress]');
    if (!bar) return;
    let raf = null;
    function update() {
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
      raf = null;
    }
    window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
  }

  /* ── Reveal on scroll ──
     Also re-scans for [data-reveal] elements added later (e.g. cards rendered
     after an async fetch) and force-reveals everything after a short grace
     period, so content can never get stuck invisible if IntersectionObserver
     doesn't fire for some reason (unsupported browser, webview quirks, etc). */
  const revealIO = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-revealed'); revealIO.unobserve(e.target); } });
  }, { threshold: 0.05, rootMargin: '0px 0px -3% 0px' });

  // Observa cualquier [data-reveal] nuevo con el MISMO observer compartido — llamar
  // después de inyectar tarjetas/listas por fetch (ej. tras un innerHTML de resultados).
  function observeReveals() {
    $$('[data-reveal]:not(.is-revealed)').forEach(el => revealIO.observe(el));
  }
  window.VBR_observeReveals = observeReveals;

  function initReveals() {
    observeReveals();
    const rescan = setInterval(observeReveals, 500);
    setTimeout(() => {
      clearInterval(rescan);
      $$('[data-reveal]:not(.is-revealed)').forEach(el => el.classList.add('is-revealed'));
    }, 2500);
  }

  /* ── Count-up ── */
  function initCountUp() {
    $$('[data-count-to]').forEach(el => {
      const target = parseFloat(el.dataset.countTo);
      const isDecimal = String(target).includes('.');
      const io = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (!e.isIntersecting) return;
          io.unobserve(e.target);
          const start = performance.now();
          const dur = 1400;
          (function frame(now) {
            const t = Math.min((now - start) / dur, 1);
            const ease = 1 - Math.pow(1 - t, 3);
            el.textContent = isDecimal ? (target * ease).toFixed(1) : Math.round(target * ease);
            if (t < 1) requestAnimationFrame(frame);
          })(start);
        });
      }, { threshold: 0.5 });
      io.observe(el);
    });
  }

  /* ── Marquee ──
     El ancho real del track cambia una vez cargan las tipografías (Fraunces/Inter),
     así que medirlo de inmediato en DOMContentLoaded da un valor obsoleto y provoca
     un salto/tirón visible cada vez que el recorrido vuelve al inicio. Se mide tras
     document.fonts.ready (con reintento si la API no existe) y se recalcula en resize. */
  function initMarquee() {
    const track = $('#marquee-track');
    if (!track) return;
    const clone = track.cloneNode(true);
    clone.removeAttribute('id');
    clone.setAttribute('aria-hidden', 'true');
    $$('a', clone).forEach(a => a.setAttribute('tabindex', '-1'));
    track.parentNode.appendChild(clone);

    let distance = track.scrollWidth;
    let pos = 0;
    const speed = 55;
    let last = performance.now();

    function remeasure() { distance = track.scrollWidth; }
    if (document.fonts?.ready) document.fonts.ready.then(remeasure);
    window.addEventListener('resize', remeasure);

    (function tick(now) {
      const dt = (now - last) / 1000;
      last = now;
      pos -= speed * dt;
      if (pos <= -distance) pos += distance;
      track.style.transform = `translate3d(${pos}px,0,0)`;
      clone.style.transform = `translate3d(${pos + distance}px,0,0)`;
      requestAnimationFrame(tick);
    })(last);
  }

  /* ── Portada de video en tarjetas: varios videos pesan decenas de MB, así que en
     vez de reproducirlos apenas cargan (autoplay), se muestra un cuadro capturado
     del propio video, cacheado en localStorage para no repetir la descarga parcial
     en cada visita. Mismo mecanismo que usa ventas.html. ── */
  const CARD_POSTER_CACHE_PREFIX = 'vbr_poster_';
  function getCachedCardPoster(src) { try { return localStorage.getItem(CARD_POSTER_CACHE_PREFIX + src); } catch (e) { return null; } }
  function setCachedCardPoster(src, dataUrl) { try { localStorage.setItem(CARD_POSTER_CACHE_PREFIX + src, dataUrl); } catch (e) { /* storage llena o bloqueada */ } }
  function waitCardFrame() {
    return new Promise(r => {
      let done = false;
      const finish = () => { if (!done) { done = true; r(); } };
      requestAnimationFrame(() => requestAnimationFrame(finish));
      setTimeout(finish, 300);
    });
  }
  async function captureCardPoster(wrap) {
    const src = wrap.dataset.videoSrc;
    const img = wrap.querySelector('.card-video-poster');
    if (!src || !img) return;
    const cached = getCachedCardPoster(src);
    if (cached) { img.src = cached; return; }
    const vid = document.createElement('video');
    vid.muted = true; vid.playsInline = true; vid.preload = 'metadata'; vid.src = src;
    try {
      await new Promise((resolve, reject) => {
        vid.addEventListener('loadedmetadata', resolve, { once: true });
        vid.addEventListener('error', reject, { once: true });
      });
      await new Promise((resolve, reject) => {
        vid.addEventListener('seeked', resolve, { once: true });
        vid.addEventListener('error', reject, { once: true });
        vid.currentTime = Math.min(0.5, vid.duration || 0.5);
      });
      await waitCardFrame();
      const canvas = document.createElement('canvas');
      canvas.width = vid.videoWidth;
      canvas.height = vid.videoHeight;
      canvas.getContext('2d').drawImage(vid, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      img.src = dataUrl;
      setCachedCardPoster(src, dataUrl);
    } catch (e) { /* se deja el fondo por defecto */ }
    vid.src = '';
  }
  function generateCardVideoPosters(container) {
    const wraps = [...(container || document).querySelectorAll('.card-video-wrap')];
    (async () => { for (const w of wraps) await captureCardPoster(w); })();
  }
  window.VBR.generateCardVideoPosters = generateCardVideoPosters;

  /* ── Preview del video en la tarjeta: al pulsar ▶ se reproduce sin audio dentro de
     la misma tarjeta (en bucle). Va en fase de captura para que el clic no dispare la
     navegación a la ficha. Clic en el video ya reproduciéndose sí abre la ficha. ── */
  document.addEventListener('click', e => {
    const wrap = e.target.closest && e.target.closest('.card-video-wrap');
    if (!wrap || !wrap.dataset.videoSrc) return;
    const play = wrap.querySelector('.card-video-play');
    // Con el video ya reproduciéndose, el clic cae en la tarjeta (abre la ficha).
    const existing = wrap.querySelector('video');
    if (existing && !existing.paused) return;
    e.stopPropagation();
    e.preventDefault();
    document.querySelectorAll('.card-video-wrap video').forEach(v => v.pause());
    let vid = existing;
    if (!vid) {
      vid = document.createElement('video');
      vid.className = 'card-video-poster';
      vid.muted = true; vid.defaultMuted = true; vid.loop = true; vid.playsInline = true;
      vid.setAttribute('muted', ''); vid.setAttribute('playsinline', '');
      vid.preload = 'auto';
      vid.src = wrap.dataset.videoSrc;
      const poster = wrap.querySelector('.card-video-poster');
      if (poster && poster.src) vid.poster = poster.src;
      wrap.appendChild(vid);
      const img = wrap.querySelector('img.card-video-poster');
      if (img) img.style.display = 'none';
    }
    if (play) play.style.display = 'none';
    vid.play().catch(() => { if (play) play.style.display = ''; });
  }, true);

  /* ── Carrusel de fotos en la tarjeta: flechas y deslizar (touch) sin abrir la ficha ── */
  function goToCardSlide(card, dir) {
    const track = card.querySelector('.card-track');
    if (!track) return;
    const n = track.children.length;
    const i = (((parseInt(track.dataset.i, 10) || 0) + dir) % n + n) % n;
    track.dataset.i = i;
    track.style.transform = `translateX(-${i * 100}%)`;
    card.querySelectorAll('.card-dot').forEach((d, k) => d.classList.toggle('active', k === i));
    const count = card.querySelector('.card-count');
    if (count) count.textContent = (i + 1) + ' / ' + n;
    card.querySelectorAll('video').forEach(v => v.pause());
  }
  let cardSwipeAt = 0;
  document.addEventListener('click', e => {
    const arrow = e.target.closest && e.target.closest('.card-arrow');
    const swiped = Date.now() - cardSwipeAt < 400 && e.target.closest && e.target.closest('.card-track');
    if (!arrow && !swiped) return;
    e.stopPropagation();
    e.preventDefault();
    if (arrow) goToCardSlide(arrow.closest('.card'), arrow.classList.contains('card-arrow-next') ? 1 : -1);
  }, true);
  let touchStart = null;
  document.addEventListener('touchstart', e => {
    const track = e.target.closest && e.target.closest('.card-track');
    touchStart = track ? { x: e.touches[0].clientX, y: e.touches[0].clientY, card: track.closest('.card') } : null;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!touchStart) return;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      cardSwipeAt = Date.now();
      goToCardSlide(touchStart.card, dx < 0 ? 1 : -1);
    }
    touchStart = null;
  }, { passive: true });

  /* ── Boat card builder ── */
  function buildBoatCard(boat) {
    const imgs = Array.isArray(boat.images) ? boat.images : JSON.parse(boat.images || '[]');
    const src = imgs[0] || 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&q=70';
    const isVid = /\.(mp4|webm|mov)$/i.test(src);
    const media = isVid
      ? `<div class="card-video-wrap" data-video-src="${esc(src)}"><img class="card-video-poster" alt="${esc(boat.name)}" /><div class="card-video-play">▶</div></div>`
      : `<img src="${esc(src)}" alt="${esc(boat.name)}" loading="lazy" />`;
    const dayBased = !!(boat.pricing_scheme && boat.pricing_scheme.type === 'day_based');
    // Carrusel: la portada (foto o video) + el resto de las fotos de la galería.
    const extraPhotos = imgs.slice(1).filter(p => !/\.(mp4|webm|mov)$/i.test(p));
    const slides = [media, ...extraPhotos.map(p => `<img src="${esc(p)}" alt="${esc(boat.name)}" loading="lazy" draggable="false" />`)];
    const carousel = slides.length > 1
      ? `<div class="card-track" data-i="0">${slides.map(s => `<div class="card-slide">${s}</div>`).join('')}</div>
          <button type="button" class="card-arrow card-arrow-prev" aria-label="Foto anterior">‹</button>
          <button type="button" class="card-arrow card-arrow-next" aria-label="Foto siguiente">›</button>
          <div class="card-dots">${slides.length > 7 ? `<span class="card-count">1 / ${slides.length}</span>` : slides.map((_, i) => `<span class="card-dot${i ? '' : ' active'}"></span>`).join('')}</div>`
      : media;
    const badge = boat.featured ? '<span class="card-badge featured">⭐ Destacado</span>' : '';
    return `
      <article class="card" onclick="location.href='/embarcacion/${encodeURIComponent(boat.slug)}'" data-reveal>
        <div class="card-img">
          ${carousel}
          ${badge}
          <div class="card-location">📍 ${esc(boat.location)}</div>
        </div>
        <div class="card-body">
          <h3 class="card-name"><a href="/embarcacion/${encodeURIComponent(boat.slug)}" style="color:inherit;text-decoration:none;">${esc(boat.name)}</a></h3>
          <div class="card-desc">${esc(boat.short_description || '')}</div>
          <div class="card-meta">
            <div class="card-specs">
              <span class="card-spec">👥 ${boat.capacity} pers.</span>
              ${boat.length_ft ? `<span class="card-spec">⛵ ${boat.length_ft} ft</span>` : ''}
            </div>
            <div class="card-price">
              <div class="card-price-amount">$${Number(dayBased ? Math.min(...Object.values(boat.pricing_scheme.prices)) : boat.price_per_day).toLocaleString()}</div>
              <div class="card-price-unit">${dayBased ? 'USD / desde' : 'USD / día'}</div>
            </div>
          </div>
        </div>
      </article>`;
  }
  window.VBR.buildBoatCard = buildBoatCard;

  /* ── Featured boats ── */
  function initFeaturedBoats() {
    const grid = $('#featured-boats');
    if (!grid) return;
    api('/boats/featured').then(boats => {
      if (!Array.isArray(boats) || !boats.length) { grid.innerHTML = '<p class="text-muted">No hay embarcaciones disponibles.</p>'; return; }
      grid.innerHTML = boats.map(buildBoatCard).join('');
      generateCardVideoPosters(grid);
      initReveals();
    }).catch(() => { grid.innerHTML = '<p class="text-muted">Error cargando embarcaciones.</p>'; });
  }

  /* ── Chatbot ── */
  function initChatbot() {
    const toggle = $('#chatbot-toggle');
    const panel  = $('#chatbot-panel');
    const body   = $('#chatbot-body');
    const faqs   = $('#chatbot-faqs');
    if (!toggle || !panel) return;

    toggle.addEventListener('click', () => {
      const open = panel.classList.toggle('is-open');
      toggle.classList.toggle('is-open', open);
      toggle.textContent = open ? '✕' : '💬';
      if (open && body) body.scrollTop = body.scrollHeight;
    });

    if (faqs) {
      faqs.querySelectorAll('.chatbot-faq-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const q = btn.dataset.q;
          const a = btn.dataset.a;

          // User bubble
          const uMsg = document.createElement('div');
          uMsg.className = 'chatbot-msg user';
          uMsg.textContent = q;
          body.appendChild(uMsg);

          // Typing indicator
          const typing = document.createElement('div');
          typing.className = 'chatbot-msg bot';
          typing.textContent = '...';
          body.appendChild(typing);
          body.scrollTop = body.scrollHeight;

          setTimeout(() => {
            typing.textContent = a;
            body.scrollTop = body.scrollHeight;
          }, 600);

          // Hide FAQ buttons after first interaction
          faqs.style.display = 'none';

          // Show reset link
          const reset = document.createElement('button');
          reset.className = 'chatbot-faq-btn';
          reset.textContent = '← Ver más preguntas';
          reset.style.marginTop = '0.5rem';
          reset.addEventListener('click', () => {
            faqs.style.display = '';
            reset.remove();
          });
          body.after(reset);
        });
      });
    }
  }

  /* ── Init ── */
  document.addEventListener('DOMContentLoaded', () => {
    safe(initSplash, 'splash');
    safe(initNav, 'nav');
    safe(initHamburger, 'hamburger');
    safe(initScrollProgress, 'scrollProgress');
    safe(initReveals, 'reveals');
    safe(initCountUp, 'countUp');
    safe(initMarquee, 'marquee');
    safe(initFeaturedBoats, 'featuredBoats');
    safe(initChatbot, 'chatbot');
  });

})();
