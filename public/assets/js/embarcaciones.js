(function () {
  let allBoats = [];
  const state = { location: '', capacity: '', price: '', search: '', sort: 'featured' };

  const params = new URLSearchParams(location.search);
  const metaLoc = document.querySelector('meta[name="vbr-location"]');
  if (metaLoc && metaLoc.content) state.location = metaLoc.content;
  else if (params.get('location')) state.location = params.get('location');
  if (params.get('search')) state.search = params.get('search');
  if (parseInt(params.get('capacity')) > 0) state.capacity = String(parseInt(params.get('capacity')));

  const $ = (id) => document.getElementById(id);

  // precio mostrado en la tarjeta: el más bajo si la embarcación tiene precio por día de la semana
  const priceOf = (b) => (b.pricing_scheme && b.pricing_scheme.type === 'day_based')
    ? Math.min(...Object.values(b.pricing_scheme.prices)) : b.price_per_day;

  function matches(b, ignoreLocation) {
    const q = state.search.toLowerCase().trim();
    return (ignoreLocation || !state.location || b.location === state.location) &&
      b.capacity >= (parseInt(state.capacity) || 0) &&
      priceOf(b) <= (parseFloat(state.price) || Infinity) &&
      (!q || [b.name, b.description, b.short_description, b.brand].some(t => (t || '').toLowerCase().includes(q)));
  }

  function sortBoats(list) {
    const s = state.sort;
    const by = {
      'price-asc': (a, b) => priceOf(a) - priceOf(b),
      'price-desc': (a, b) => priceOf(b) - priceOf(a),
      'capacity-desc': (a, b) => b.capacity - a.capacity,
      featured: (a, b) => (b.featured || 0) - (a.featured || 0),
    }[s];
    return list.slice().sort(by);
  }

  function activeFilterCount() {
    return (state.capacity ? 1 : 0) + (state.price ? 1 : 0);
  }

  function render() {
    // contadores por ubicación (respetan búsqueda, personas y precio)
    document.querySelectorAll('.cat-chip').forEach(chip => {
      const loc = chip.dataset.location;
      const n = allBoats.filter(b => matches(b, true) && (!loc || b.location === loc)).length;
      chip.querySelector('.cat-chip-n').textContent = allBoats.length ? n : '';
      // oculta ubicaciones sin embarcaciones (salvo "Todas" y la activa)
      chip.hidden = !!allBoats.length && loc !== '' && n === 0 && state.location !== loc;
      chip.classList.toggle('active', loc === state.location);
    });

    const filtered = sortBoats(allBoats.filter(b => matches(b)));
    $('results-count').textContent = filtered.length + ' ' + (filtered.length !== 1 ? 'embarcaciones' : 'embarcación');

    const n = activeFilterCount();
    $('btn-clear').hidden = !(n || state.search || state.location);

    document.querySelectorAll('.cat-opts').forEach(g => {
      g.querySelectorAll('.cat-opt').forEach(o => o.classList.toggle('active', o.dataset.value === state[g.dataset.filter]));
    });

    const grid = $('boats-grid');
    if (!filtered.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><div class="empty-state-icon">⛵</div><h3 class="empty-state-title">Sin resultados</h3><p class="empty-state-desc">No encontramos embarcaciones con esos filtros. Intenta ampliar la búsqueda.</p><button class="btn btn-primary" data-action="reset-filters">Limpiar filtros</button></div>';
      return;
    }
    grid.innerHTML = filtered.map(window.VBR.buildBoatCard).join('');
    window.VBR.generateCardVideoPosters(grid);
    window.VBR.observeReveals();
  }

  window.resetFilters = function () {
    Object.assign(state, { location: '', capacity: '', price: '', search: '', sort: 'featured' });
    $('filter-search').value = '';
    $('filter-sort').value = 'featured';
    render();
  };

  document.addEventListener('click', e => {
    if (e.target.closest && e.target.closest('[data-action="reset-filters"]')) window.resetFilters();
  });

  function init() {
    $('filter-search').value = state.search;

    document.querySelectorAll('.cat-chip').forEach(chip => chip.addEventListener('click', () => {
      state.location = chip.dataset.location; render();
    }));
    document.querySelectorAll('.cat-opts').forEach(g => g.addEventListener('click', e => {
      const o = e.target.closest('.cat-opt'); if (!o) return;
      state[g.dataset.filter] = o.dataset.value; render();
    }));

    let t;
    $('filter-search').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { state.search = e.target.value; render(); }, 180); });
    $('filter-sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
    $('btn-clear').addEventListener('click', window.resetFilters);

    fetch('/api/boats').then(r => r.json()).then(boats => {
      allBoats = boats;
      render();
    });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
