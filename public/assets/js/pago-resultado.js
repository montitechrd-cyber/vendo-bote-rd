/* Resultado del pago con tarjeta (AZUL). Sin innerHTML: todo con textContent. */
(function () {
  'use strict';
  const ESTADOS = {
    aprobado: { cls: 'ok', icon: '✓', title: '¡Pago aprobado!', msg: 'Tu pago con tarjeta fue aprobado y tu reserva quedó confirmada. Te enviamos los detalles por correo.' },
    declinado: { cls: 'bad', icon: '✕', title: 'Pago declinado', msg: 'Tu banco no aprobó el pago y no se te cobró. Puedes intentarlo de nuevo con otra tarjeta o reservar por transferencia.' },
    cancelado: { cls: 'warn', icon: '!', title: 'Pago cancelado', msg: 'Cancelaste el pago y no se te cobró nada. Si aún quieres reservar, vuelve a la embarcación y elige tu método de pago.' },
    revision: { cls: 'warn', icon: '⏳', title: 'Pago en revisión', msg: 'Recibimos tu pago, pero necesitamos revisar tu reserva (por ejemplo, el turno ya no estaba disponible). Nuestro equipo te contactará pronto; si no se confirma, te devolveremos el dinero.' },
    desconocido: { cls: 'warn', icon: '?', title: 'Resultado no disponible', msg: 'No pudimos identificar el resultado del pago. Revisa el estado de tu reserva en tu cuenta o escríbenos por WhatsApp.' }
  };
  const params = new URLSearchParams(location.search);
  let estado = params.get('estado') || '';
  if (!Object.prototype.hasOwnProperty.call(ESTADOS, estado) || estado === 'desconocido') estado = 'desconocido';
  const ref = params.get('ref') || '';
  const e = ESTADOS[estado];
  const $ = (id) => document.getElementById(id);
  document.title = e.title + ' | VENDO BOTE RD';
  $('res-title').textContent = e.title;
  $('res-msg').textContent = e.msg;
  $('res-icon').textContent = e.icon;
  $('res-box').classList.add('pay-result-' + e.cls);
  if (/^VB-\d+$/.test(ref)) {
    $('res-ref').textContent = ref;
    $('res-ref-wrap').classList.remove('hidden');
  }
  if (estado === 'declinado' || estado === 'cancelado') {
    $('res-main').textContent = 'Volver a las embarcaciones';
    $('res-main').setAttribute('href', '/embarcaciones.html');
    $('res-alt').textContent = 'Ver mis reservas';
    $('res-alt').setAttribute('href', '/dashboard.html');
  }
})();
