document.addEventListener("DOMContentLoaded", function () {
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var form = $('hx-search'); if (!form) return;
  var MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  var pops = { loc: $('hx-loc-pop'), date: $('hx-cal') };
  var btns = { loc: $('hx-loc-btn'), date: $('hx-date-btn') };
  function closeAll(except) {
    Object.keys(pops).forEach(function (k) {
      if (k === except) return;
      pops[k].hidden = true; btns[k].setAttribute('aria-expanded', 'false');
    });
  }
  function toggle(k) {
    var open = pops[k].hidden;
    closeAll(open ? k : null);
    pops[k].hidden = !open; btns[k].setAttribute('aria-expanded', String(open));
    if (open) setTimeout(function () { pops[k].scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 30);
  }
  btns.loc.addEventListener('click', function () { toggle('loc'); });
  btns.date.addEventListener('click', function () { toggle('date'); });
  document.addEventListener('click', function (e) { if (!form.contains(e.target)) closeAll(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });

  // Destino
  pops.loc.addEventListener('click', function (e) {
    var o = e.target.closest('.hx-opt'); if (!o) return;
    var v = o.getAttribute('data-v');
    $('hx-loc-v').value = v;
    var t = $('hx-loc-t'); t.textContent = v || 'Buscar destinos'; t.classList.toggle('hx-ph', !v);
    [].forEach.call(pops.loc.querySelectorAll('.hx-opt'), function (x) { x.classList.toggle('on', x === o); });
    closeAll();
  });

  // Calendario
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var view = new Date(today.getFullYear(), today.getMonth(), 1);
  var sel = null;
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function render() {
    $('hx-cal-title').textContent = MESES[view.getMonth()] + ' ' + view.getFullYear();
    $('hx-cal-prev').disabled = view.getFullYear() === today.getFullYear() && view.getMonth() === today.getMonth();
    var first = (new Date(view.getFullYear(), view.getMonth(), 1).getDay() + 6) % 7;
    var days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    var h = '';
    for (var i = 0; i < first; i++) h += '<span></span>';
    for (var d = 1; d <= days; d++) {
      var dt = new Date(view.getFullYear(), view.getMonth(), d);
      var past = dt < today;
      var cls = 'hx-day' + (dt.getTime() === today.getTime() ? ' today' : '') + (sel && dt.getTime() === sel.getTime() ? ' sel' : '');
      h += '<button type="button" class="' + cls + '" data-d="' + iso(dt) + '"' + (past ? ' disabled' : '') + '>' + d + '</button>';
    }
    $('hx-cal-grid').innerHTML = h;
  }
  function setDate(d) {
    sel = d;
    $('hx-date-v').value = d ? iso(d) : '';
    var t = $('hx-date-t');
    t.textContent = d ? d.getDate() + ' ' + MESES[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear() : 'Agregar fecha';
    t.classList.toggle('hx-ph', !d);
    render();
  }
  $('hx-cal-grid').addEventListener('click', function (e) {
    var b = e.target.closest('.hx-day'); if (!b || b.disabled) return;
    var p = b.getAttribute('data-d').split('-');
    setDate(new Date(+p[0], +p[1] - 1, +p[2])); closeAll();
  });
  $('hx-cal-prev').addEventListener('click', function () { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); render(); });
  $('hx-cal-next').addEventListener('click', function () { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); render(); });
  $('hx-cal-clear').addEventListener('click', function () { setDate(null); });
  $('hx-cal-today').addEventListener('click', function () { view = new Date(today.getFullYear(), today.getMonth(), 1); setDate(new Date(today)); closeAll(); });
  render();
})();
// Bank tab switcher
var bankFold = document.getElementById("bank-fold");
if (bankFold && window.innerWidth > 700) bankFold.open = true;
function switchBank(id, btn) {
  document.querySelectorAll(".bank-panel").forEach(function (p) { p.classList.remove("active"); });
  document.querySelectorAll(".bank-box-tab-btn").forEach(function (b) { b.classList.remove("active"); });
  document.getElementById("bank-" + id).classList.add("active");
  btn.classList.add("active");
}
document.addEventListener("click", function (e) {
  var el = e.target.closest("[data-action]"); if (!el) return;
  var a = el.getAttribute("data-action");
  if (a === "switch-bank") switchBank(el.getAttribute("data-bank"), el);
  else if (a === "copy") window.copyText(el.getAttribute("data-text"));
});
});
