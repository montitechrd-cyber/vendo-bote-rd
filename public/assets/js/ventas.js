(function () {
  let allBoats = [];

  const WA_NUMBER = '14073614042';
  const esc = (s) => window.VBR.esc(s);

  function fmt(price) {
    return '$' + Number(price).toLocaleString('en-US');
  }

  // Mensaje de WhatsApp organizado en formato de "orden" con los datos de la embarcación
  function waLink(boat) {
    const priceDisplay = boat.sale_price ? fmt(boat.sale_price) + ' USD' : 'A consultar';
    const lines = [
      '🛥️ *SOLICITUD DE INFORMACIÓN*',
      '',
      `⛵ *Embarcación:* ${boat.name}`,
      `📍 *Ubicación:* ${boat.location || '—'}`,
      `👥 *Capacidad:* ${boat.capacity || '—'} personas`,
      `📏 *Eslora:* ${boat.length_ft ? boat.length_ft + ' ft' : '—'}`,
      boat.year ? `📅 *Año:* ${boat.year}` : null,
      `💰 *Precio:* ${priceDisplay}`,
      '',
      'Hola, estoy interesado en esta embarcación. ¿Me pueden dar más información y coordinar una visita?',
    ].filter(l => l !== null).join('\n');
    return 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(lines);
  }

  function buildSaleCard(boat) {
    const src = (boat.images && boat.images[0]) ? boat.images[0] : '';
    const isVideo = /\.(mp4|webm|mov)$/i.test(src);

    // Los videos ya no se reproducen en la tarjeta: se muestra una portada fija
    // (un fotograma tomado del propio video) con un ícono de play; el video
    // completo se ve al entrar a la ficha de la embarcación.
    const media = isVideo
      ? `<div class="sale-card-video-wrap" data-video-src="${esc(src)}">
           <img class="sale-card-poster" alt="${esc(boat.name)}" style="width:100%;height:100%;object-fit:cover;display:block;background:var(--bg-2);" />
           <div class="sale-card-play">▶</div>
         </div>`
      : `<img src="${esc(src || 'https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?w=800&q=80')}" alt="${esc(boat.name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;" />`;

    const priceDisplay = boat.sale_price ? fmt(boat.sale_price) : 'Consultar';
    const specs = [
      boat.capacity ? `<span class="card-spec">👥 ${boat.capacity} pers.</span>` : '',
      boat.length_ft ? `<span class="card-spec">⛵ ${boat.length_ft} ft</span>` : '',
    ].filter(Boolean).join('');

    // Misma tarjeta que en Rentar (.card / .card-img / .card-body / .card-meta),
    // solo que en vez de precio por día + reservar, se muestra el precio de
    // venta (o "Consultar") y un botón para pedir información por WhatsApp.
    return `
      <article class="card" data-href="/embarcacion/${encodeURIComponent(boat.slug)}" data-reveal>
        <div class="card-img">
          ${media}
          <span class="card-badge sale">EN VENTA</span>
          <div class="card-location">📍 ${esc(boat.location || '')}</div>
        </div>
        <div class="card-body">
          <h3 class="card-name"><a href="/embarcacion/${encodeURIComponent(boat.slug)}" style="color:inherit;text-decoration:none;">${esc(boat.name)}</a></h3>
          <div class="card-desc">${esc(boat.short_description || '')}</div>
          <div class="card-meta">
            <div class="card-specs">${specs}</div>
            <div class="card-price">
              <div class="card-price-amount">${priceDisplay}</div>
              <div class="card-price-unit">${boat.sale_price ? 'USD · precio de venta' : 'precio de venta'}</div>
            </div>
          </div>
          <a href="${waLink(boat)}" target="_blank" class="card-wa-btn" data-stop>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            Consultar por WhatsApp
          </a>
        </div>
      </article>`;
  }

  function applyFilters() {
    const maxPrice = parseFloat(document.getElementById('filter-price').value) || Infinity;
    const capacity = parseInt(document.getElementById('filter-capacity').value) || 0;
    const search = document.getElementById('filter-search').value.toLowerCase().trim();

    const filtered = allBoats.filter(b =>
      (!b.sale_price || b.sale_price <= maxPrice) &&
      b.capacity >= capacity &&
      (!search || b.name.toLowerCase().includes(search) ||
        (b.brand || '').toLowerCase().includes(search) ||
        (b.description || '').toLowerCase().includes(search))
    );

    document.getElementById('results-count').textContent =
      `${filtered.length} ${filtered.length !== 1 ? 'embarcaciones' : 'embarcación'} en venta`;

    const grid = document.getElementById('sale-grid');
    const empty = document.getElementById('empty-sale');
    const cta = document.getElementById('sale-cta');

    if (!filtered.length) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      cta.classList.add('hidden');
    } else {
      empty.classList.add('hidden');
      grid.innerHTML = filtered.map(buildSaleCard).join('');
      window.VBR.observeReveals();
      cta.classList.remove('hidden');
    }

    generateVideoPosters();
  }

  // Toma un fotograma real del video (no lo reproduce) para usarlo como portada de la tarjeta.
  // Se procesan uno a la vez y se espera a que el frame esté realmente pintado
  // (2 rAF después de 'seeked') para no capturar un cuadro a medio decodificar.
  // Carrera contra un timeout: si la pestaña está en segundo plano, requestAnimationFrame
  // no se ejecuta y esto nunca debe bloquear el procesamiento del resto de las tarjetas.
  function waitFrame() {
    return new Promise(r => {
      let done = false;
      const finish = () => { if (!done) { done = true; r(); } };
      requestAnimationFrame(() => requestAnimationFrame(finish));
      setTimeout(finish, 300);
    });
  }

  // Algunos videos de venta pesan 40-70MB: generar la portada desde el video
  // en cada visita descarga buena parte de ese archivo solo para sacar un
  // cuadro. Se cachea el resultado en localStorage (por src) para que solo
  // el primer visitante de este navegador pague ese costo.
  const POSTER_CACHE_PREFIX = 'vbr_poster_';

  function getCachedPoster(src) {
    try { return localStorage.getItem(POSTER_CACHE_PREFIX + src); } catch (e) { return null; }
  }
  function setCachedPoster(src, dataUrl) {
    try { localStorage.setItem(POSTER_CACHE_PREFIX + src, dataUrl); } catch (e) { /* storage llena o bloqueada: no pasa nada */ }
  }

  async function capturePoster(wrap) {
    const src = wrap.dataset.videoSrc;
    const img = wrap.querySelector('.sale-card-poster');
    if (!src || !img) return;

    const cached = getCachedPoster(src);
    if (cached) { img.src = cached; return; }

    const vid = document.createElement('video');
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = 'metadata';
    vid.src = src;

    try {
      await new Promise((resolve, reject) => {
        vid.addEventListener('loadedmetadata', resolve, { once: true });
        vid.addEventListener('error', reject, { once: true });
      });
      // Cerca del inicio: alcanza para no caer en cuadro negro y evita forzar
      // la descarga de tramos lejanos del archivo en videos sin "fast start".
      await new Promise((resolve, reject) => {
        vid.addEventListener('seeked', resolve, { once: true });
        vid.addEventListener('error', reject, { once: true });
        vid.currentTime = Math.min(0.5, vid.duration || 0.5);
      });
      await waitFrame();
      const canvas = document.createElement('canvas');
      canvas.width = vid.videoWidth;
      canvas.height = vid.videoHeight;
      canvas.getContext('2d').drawImage(vid, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      img.src = dataUrl;
      setCachedPoster(src, dataUrl);
    } catch (e) { /* se deja el fondo por defecto */ }
    vid.src = '';
  }

  function generateVideoPosters() {
    const wraps = [...document.querySelectorAll('.sale-card-video-wrap')];
    (async () => { for (const w of wraps) await capturePoster(w); })();

    // Preview del video al hacer clic en la portada (ver el listener de abajo).
    document.querySelectorAll('.sale-card-video-wrap').forEach(wrap => {
      wrap.addEventListener('click', (e) => {
        // Preview en la misma tarjeta: sin audio, en bucle y sin controles. Un clic sobre
        // el video ya reproduciéndose deja pasar el evento y abre la ficha de la tarjeta.
        const playing = wrap.querySelector('video');
        if (playing && !playing.paused) return;
        e.stopPropagation();
        if (currentPlayingVideo && !currentPlayingVideo.paused) currentPlayingVideo.pause();
        if (playing) { playing.play().catch(() => {}); currentPlayingVideo = playing; return; }
        wrap.innerHTML = `<video src="${wrap.dataset.videoSrc}" muted loop autoplay playsinline style="width:100%;height:100%;object-fit:cover;display:block;"></video>`;
        const vid = wrap.querySelector('video');
        vid.muted = true;
        vid.play().catch(() => {});
        currentPlayingVideo = vid;
      });
    });
  }
  let currentPlayingVideo = null;

  // Clic en la tarjeta abre la ficha; el botón de WhatsApp (data-stop) no la abre
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-stop]')) return;
    const card = e.target.closest('.card[data-href]');
    if (card) location.href = card.dataset.href;
  });

  function init() {
    document.getElementById('btn-filter').addEventListener('click', applyFilters);
    document.getElementById('filter-search').addEventListener('keypress', e => {
      if (e.key === 'Enter') applyFilters();
    });
    document.getElementById('filter-price').addEventListener('change', applyFilters);
    document.getElementById('filter-capacity').addEventListener('change', applyFilters);

    fetch('/api/boats/for-sale')
      .then(r => r.json())
      .then(boats => {
        allBoats = boats;
        applyFilters();
      })
      .catch(() => {
        document.getElementById('sale-grid').innerHTML = '';
        document.getElementById('empty-sale').classList.remove('hidden');
        document.getElementById('results-count').textContent = '0 embarcaciones en venta';
      });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
