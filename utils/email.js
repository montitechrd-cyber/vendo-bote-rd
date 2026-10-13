const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const SITE_URL = (process.env.SITE_URL || 'https://vendoboterd.com').replace(/[/]+$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'montitechrd@gmail.com';
// Avisos de reservas y comprobantes: llegan al correo admin y a Penélope (se pueden sumar más en NOTIFY_EMAILS, separados por coma)
const ADMIN_RECIPIENTS = [...new Set([ADMIN_EMAIL, 'penelope.1021@hotmail.com', ...(process.env.NOTIFY_EMAILS || '').split(',')].map(e => e.trim()).filter(Boolean))];

function slotLabel(s) {
  if (s === '9am-3pm')   return '9:00 AM – 3:00 PM';
  if (s === '4pm-10pm')  return '4:00 PM – 10:00 PM';
  if (s === '10am-4pm')  return '10:00 AM – 4:00 PM';
  if (s === '5pm-11pm')  return '5:00 PM – 11:00 PM';
  if (s === 'full-day')  return 'Día completo';
  return s || '—';
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('es-DO', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
}

function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('es-DO') + ' USD';
}

/* ── Diseño base: tablas con estilos en línea (los clientes de correo no soportan flex) ── */
const C = { navy: '#0F3460', sky: '#0369A1', ink: '#0F2B4A', mute: '#5B84A8', line: '#E2EEF7', soft: '#F0F9FF' };
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// Convierte las filas "etiqueta / valor" de las plantillas en filas de tabla compactas
function rowsToTable(html) {
  return html.replace(/<div class="row( total)?"><span class="lbl">([\s\S]*?)<\/span><span class="val"( data-n)?>([\s\S]*?)<\/span><\/div>/g,
    (m, total, l, n, v) => `<tr><td style="padding:7px 0;border-bottom:1px solid ${C.line};font-size:13px;color:${C.mute};vertical-align:top;width:34%;">${l}</td><td style="padding:7px 0;border-bottom:1px solid ${C.line};font-size:${total ? 17 : 13}px;font-weight:${total ? 800 : n ? 500 : 600};color:${total ? C.sky : C.ink};text-align:right;vertical-align:top;">${v}</td></tr>`);
}

function box(title, rows) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.soft};border:1px solid ${C.line};border-radius:10px;margin:0 0 14px;"><tr><td style="padding:14px 16px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${C.sky};margin-bottom:6px;">${title}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr></table>`;
}

function wrap(title, body) {
  const html = rowsToTable(body)
    // los bloques .box de las plantillas viejas pasan a tarjetas compactas
    .replace(/<div class="box">\s*<div class="box-title">([\s\S]*?)<\/div>([\s\S]*?)<\/div>(?=\s*(?:<div class="box">|<p|<div class="cta">|$))/g, (m, t, rows) => box(t, rows))
    .replace(/<p class="greeting">([\s\S]*?)<\/p>/g, `<p style="margin:0 0 6px;font-size:16px;font-weight:700;color:${C.ink};">$1</p>`)
    .replace(/<p class="intro">([\s\S]*?)<\/p>/g, `<p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#2D5987;">$1</p>`)
    .replace(/<div class="cta"><a class="btn" href="([^"]*)">([\s\S]*?)<\/a><\/div>/g, `<div style="text-align:center;margin:18px 0 4px;"><a href="$1" style="display:inline-block;background:${C.sky};color:#ffffff;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;">$2</a></div>`);
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#EAF3FA;font-family:'Helvetica Neue',Arial,sans-serif;color:${C.ink};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EAF3FA;"><tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;">
  <tr><td align="center" style="padding:18px 24px 12px;background:#ffffff;"><img src="${SITE_URL}/assets/img/email-logo.png" width="150" alt="Vendo Bote RD" style="display:block;border:0;height:auto;"/></td></tr>
  <tr><td align="center" style="background:${C.navy};color:#ffffff;padding:11px 24px;font-size:14px;font-weight:700;letter-spacing:0.04em;">${title}</td></tr>
  <tr><td style="padding:20px 24px 8px;">${html}</td></tr>
  <tr><td align="center" style="padding:14px 24px 18px;border-top:1px solid ${C.line};font-size:12px;line-height:1.5;color:${C.mute};">Correo automático de <strong>Vendo Bote RD</strong> · <a href="mailto:${ADMIN_EMAIL}" style="color:${C.sky};">${ADMIN_EMAIL}</a></td></tr>
</table></td></tr></table></body></html>`;
}

function bookingRows(b) {
  const meta = b.booking_meta ? String(b.booking_meta).split(' · ').map(esc).join('<br/>') : '';
  return `
    <div class="row"><span class="lbl">Embarcación</span><span class="val">${esc(b.boat_name) || '—'}${b.boat_location ? ' · ' + esc(b.boat_location) : ''}</span></div>
    <div class="row"><span class="lbl">Fecha</span><span class="val">${fmtDate(b.start_date)}</span></div>
    <div class="row"><span class="lbl">Horario</span><span class="val">${slotLabel(b.schedule)}</span></div>
    <div class="row"><span class="lbl">Personas</span><span class="val">${b.guests || 1}</span></div>
    ${meta ? `<div class="row"><span class="lbl">Detalle</span><span class="val" data-n>${meta}</span></div>` : ''}
    ${b.special_requests ? `<div class="row"><span class="lbl">Solicitudes</span><span class="val" data-n>${esc(b.special_requests)}</span></div>` : ''}
    <div class="row total"><span class="lbl">Total</span><span class="val">${fmtMoney(b.total_price)}</span></div>
    <div class="row"><span class="lbl">Referencia</span><span class="val">${esc(b.booking_ref)}</span></div>`;
}

function clientRows(user) {
  const tel = user.phone ? `<a href="tel:${esc(user.phone)}" style="color:${C.sky};text-decoration:none;">${esc(user.phone)}</a>` : '—';
  return `
    <div class="row"><span class="lbl">Nombre</span><span class="val">${esc(user.name)}</span></div>
    <div class="row"><span class="lbl">Teléfono</span><span class="val">${tel}</span></div>
    <div class="row"><span class="lbl">Correo</span><span class="val"><a href="mailto:${esc(user.email)}" style="color:${C.sky};text-decoration:none;">${esc(user.email)}</a></span></div>`;
}

/* ── 1. Nueva reserva con comprobante → Admin (un solo correo, con el comprobante adjunto) ── */
async function sendPaymentSubmittedAdmin(booking, user, receipt, payment = {}) {
  if (!process.env.EMAIL_USER) return;
  const payRows = `
    <div class="row"><span class="lbl">Estado</span><span class="val">Comprobante adjunto: por verificar</span></div>
    ${payment.reference_number ? `<div class="row"><span class="lbl">Referencia banco</span><span class="val">${esc(payment.reference_number)}</span></div>` : ''}
    ${payment.bank_name ? `<div class="row"><span class="lbl">Banco</span><span class="val">${esc(payment.bank_name)}</span></div>` : ''}`;
  await transporter.sendMail({
    from: `"Vendo Bote RD" <${process.env.EMAIL_USER}>`,
    to: ADMIN_RECIPIENTS,
    subject: `🆕 Nueva reserva con comprobante: ${booking.boat_name} · ${booking.start_date} · ${booking.booking_ref}`,
    attachments: receipt ? [{ filename: receipt.filename, content: receipt.content, contentType: receipt.contentType }] : [],
    html: wrap('Nueva reserva + comprobante de pago', `
      <div class="box"><div class="box-title">Reserva</div>${bookingRows(booking)}</div>
      <div class="box"><div class="box-title">Cliente</div>${clientRows(user)}</div>
      <div class="box"><div class="box-title">Pago</div>${payRows}</div>
      <div class="cta"><a class="btn" href="${SITE_URL}/admin.html">Verificar pago en el panel</a></div>
    `),
  });
}

/* ── 3. Pago aprobado → Usuario y Admin ── */
async function sendPaymentApproved(booking, user) {
  if (!process.env.EMAIL_USER) return;

  const userHtml = wrap('¡Reserva Confirmada! 🎉', `
    <p class="greeting">¡Todo listo, ${user.name}!</p>
    <p class="intro">Tu pago fue verificado y tu reserva está <strong>oficialmente confirmada</strong>. ¡Prepárate para disfrutar el mar!</p>
    <div class="box">
      <div class="box-title">Tu Reserva Confirmada</div>
      ${bookingRows(booking)}
    </div>
    <div class="box">
      <div class="box-title">Información Importante</div>
      <div class="row"><span class="lbl">Punto de salida</span><span class="val">${booking.boat_location || 'Boca Chica'}</span></div>
      <div class="row"><span class="lbl">Horario</span><span class="val">${slotLabel(booking.schedule)}</span></div>
      <div class="row"><span class="lbl">Llega</span><span class="val">30 min antes del turno</span></div>
    </div>
    <p style="font-size:13px;color:#5B84A8;line-height:1.7;margin-top:16px;">
      Para cualquier consulta o petición especial, contáctanos al WhatsApp o responde este correo.<br/>
      <strong>¡Nos vemos en el mar! ⛵</strong>
    </p>
    <div class="cta"><a class="btn" href="${SITE_URL}/dashboard.html">Ver mi reserva</a></div>
  `);

  const adminHtml = wrap('Reserva Confirmada', `
    <p class="greeting">Reserva aprobada</p>
    <p class="intro">Has confirmado el pago de <strong>${user.name}</strong>. El cliente fue notificado.</p>
    <div class="box">
      <div class="box-title">Reserva Confirmada</div>
      ${bookingRows(booking)}
    </div>
    <div class="box">
      <div class="box-title">Cliente</div>
      <div class="row"><span class="lbl">Nombre</span><span class="val">${user.name}</span></div>
      <div class="row"><span class="lbl">Email</span><span class="val">${user.email}</span></div>
      <div class="row"><span class="lbl">Teléfono</span><span class="val">${user.phone || '—'}</span></div>
    </div>
  `);

  await Promise.all([
    transporter.sendMail({
      from: `"Vendo Bote RD" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: `✅ ¡Reserva confirmada! ${booking.booking_ref} — Vendo Bote RD`,
      html: userHtml,
    }),
    transporter.sendMail({
      from: `"Vendo Bote RD" <${process.env.EMAIL_USER}>`,
      to: ADMIN_RECIPIENTS,
      subject: `✅ Reserva confirmada: ${booking.booking_ref}`,
      html: adminHtml,
    }),
  ]);
}

/* ── 4. Pago rechazado → Usuario ── */
async function sendPaymentRejected(booking, user, reason) {
  if (!process.env.EMAIL_USER) return;
  await transporter.sendMail({
    from: `"Vendo Bote RD" <${process.env.EMAIL_USER}>`,
    to: user.email,
    subject: `❌ Pago no verificado — ${booking.booking_ref}`,
    html: wrap('Pago No Verificado', `
      <p class="greeting">Hola ${user.name},</p>
      <p class="intro">Revisamos el comprobante de pago para tu reserva <strong>${booking.booking_ref}</strong> y no pudimos verificarlo.</p>
      <div class="box">
        <div class="box-title">Motivo</div>
        <p style="font-size:14px;color:#0F2B4A;margin:0;">${reason || 'El comprobante no coincide con la transferencia esperada.'}</p>
      </div>
      <div class="box">
        <div class="box-title">Tu Reserva</div>
        ${bookingRows(booking)}
      </div>
      <p style="font-size:13px;color:#5B84A8;line-height:1.7;">
        Por favor realiza la transferencia de <strong>${fmtMoney(booking.total_price)}</strong> y sube el nuevo comprobante desde tu panel. Si tienes dudas, contáctanos.
      </p>
      <div class="cta"><a class="btn" href="${SITE_URL}/dashboard.html?tab=payment">Subir nuevo comprobante</a></div>
    `),
  });
}

/* ── Crear / restablecer contraseña ── */
async function sendPasswordReset(user, link) {
  if (!process.env.EMAIL_USER) throw new Error('EMAIL_USER no configurado');
  await transporter.sendMail({
    from: `"Vendo Bote RD" <${process.env.EMAIL_USER}>`,
    to: user.email,
    subject: '🔑 Crea o restablece tu contraseña — Vendo Bote RD',
    html: wrap('Contraseña', `
      <p class="greeting">Hola ${user.name || ''},</p>
      <p class="intro">Recibimos una solicitud para crear o restablecer la contraseña de tu cuenta. El enlace es válido por 1 hora.</p>
      <div class="cta"><a class="btn" href="${link}">Elegir mi contraseña</a></div>
      <p style="font-size:12px;color:#5B84A8;line-height:1.7;margin-top:24px;">Si no fuiste tú, ignora este correo: tu cuenta sigue segura.</p>
    `),
  });
}

module.exports = { sendPaymentSubmittedAdmin, sendPaymentApproved, sendPaymentRejected, sendPasswordReset };
