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
  const CLERK_PK = 'pk_live_Y2xlcmsudmVuZG9ib3RlcmQuY29tJA';

  function safe(fn, name) {
    try { fn(); } catch (e) { console.warn('[VBR]', name, e); }
  }

  // Load Clerk JS dynamically and cache the promise
  let _clerkPromise = null;
  function getClerk() {
    if (_clerkPromise) return _clerkPromise;
    _clerkPromise = new Promise((resolve) => {
      if (window.__clerk) { resolve(window.__clerk); return; }
      const s = document.createElement('script');
      s.setAttribute('data-clerk-publishable-key', CLERK_PK);
      s.src = 'https://clerk.vendoboterd.com/npm/@clerk/clerk-js@latest/dist/clerk.browser.js';
      s.crossOrigin = 'anonymous';
      s.async = true;
      s.addEventListener('load', async () => {
        await window.Clerk.load();
        window.__clerk = window.Clerk;
        resolve(window.Clerk);
      });
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
    return _clerkPromise;
  }
  window.VBR_getClerk = getClerk;

  async function api(path, opts = {}) {
    let token = null;
    try {
      const clerk = await getClerk();
      if (clerk?.session) token = await clerk.session.getToken();
    } catch {}
    const r = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...opts.headers },
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

    // Auth state via Clerk
    const loginBtn = $('#nav-login-btn');
    const registerBtn = $('#nav-register-btn');
    getClerk().then(clerk => {
      if (!clerk?.user) return;
      const u = clerk.user;
      const name = u.firstName || u.emailAddresses?.[0]?.emailAddress?.split('@')[0] || 'Usuario';
      const role = u.publicMetadata?.role || 'user';
      if (loginBtn) { loginBtn.textContent = name; loginBtn.href = '/dashboard.html'; }
      if (registerBtn) {
        if (role === 'admin') { registerBtn.textContent = 'Admin Panel'; registerBtn.href = '/admin.html'; }
        else { registerBtn.textContent = 'Mis Reservas'; registerBtn.href = '/dashboard.html'; }
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

  /* ── Boat card builder ── */
  function buildBoatCard(boat) {
    const imgs = Array.isArray(boat.images) ? boat.images : JSON.parse(boat.images || '[]');
    const src = imgs[0] || 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&q=70';
    const isVid = /\.(mp4|webm|mov)$/i.test(src);
    const media = isVid
      ? `<video src="${esc(src)}" muted autoplay loop playsinline></video>`
      : `<img src="${esc(src)}" alt="${esc(boat.name)}" loading="lazy" />`;
    const badge = boat.featured ? '<span class="card-badge featured">⭐ Destacado</span>' : '';
    return `
      <article class="card" onclick="location.href='/boat.html?slug=${encodeURIComponent(boat.slug)}'" data-reveal>
        <div class="card-img">
          ${media}
          ${badge}
          <div class="card-location">📍 ${esc(boat.location)}</div>
        </div>
        <div class="card-body">
          <div class="card-name">${esc(boat.name)}</div>
          <div class="card-desc">${esc(boat.short_description || '')}</div>
          <div class="card-meta">
            <div class="card-specs">
              <span class="card-spec">👥 ${boat.capacity} pers.</span>
              <span class="card-spec">⛵ ${boat.length_ft || '—'} ft</span>
            </div>
            <div class="card-price">
              <div class="card-price-amount">$${Number(boat.price_per_day).toLocaleString()}</div>
              <div class="card-price-unit">USD / día</div>
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
