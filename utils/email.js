const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'montitechrd@gmail.com';

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

/* ── Base HTML wrapper ── */
function wrap(title, body) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body{margin:0;padding:0;background:#F0F9FF;font-family:'Helvetica Neue',Arial,sans-serif;color:#0F2B4A;}
  .outer{max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(14,165,233,0.12);}
  .header{background:#0F3460;padding:32px 40px;text-align:center;}
  .header h1{color:#fff;font-size:22px;font-weight:700;margin:0;letter-spacing:0.5px;}
  .header p{color:#A8C8E0;font-size:13px;margin:6px 0 0;}
  .body{padding:36px 40px;}
  .greeting{font-size:17px;font-weight:600;margin-bottom:12px;}
  .intro{color:#2D5987;font-size:14px;line-height:1.7;margin-bottom:24px;}
  .box{background:#F0F9FF;border-radius:12px;padding:24px;margin-bottom:24px;border:1px solid rgba(14,165,233,0.18);}
  .box-title{font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#0EA5E9;margin-bottom:14px;}
  .row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(14,165,233,0.10);}
  .row:last-child{border-bottom:none;}
  .lbl{font-size:13px;color:#5B84A8;}
  .val{font-size:13px;font-weight:600;color:#0F2B4A;text-align:right;}
  .total .val{font-size:18px;color:#0EA5E9;}
  .badge{display:inline-block;padding:4px 12px;border-radius:50px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;}
  .badge-ok{background:#D1FAE5;color:#065F46;}
  .badge-pending{background:#FEF3C7;color:#92400E;}
  .badge-rejected{background:#FEE2E2;color:#991B1B;}
  .cta{display:block;text-align:center;margin:24px 0 0;}
  .btn{display:inline-block;background:#0EA5E9;color:#fff;font-size:14px;font-weight:700;padding:13px 32px;border-radius:10px;text-decoration:none;letter-spacing:0.5px;}
  .footer{background:#F0F9FF;padding:24px 40px;text-align:center;border-top:1px solid rgba(14,165,233,0.15);}
  .footer p{font-size:12px;color:#5B84A8;margin:0;line-height:1.6;}
</style>
</head>
<body>
<div class="outer">
  <div class="header">
    <h1>⛵ VENDO BOTE RD</h1>
    <p>${title}</p>
  </div>
  <div class="body">${body}</div>
  <div class="footer">
    <p>Este es un correo automático de <strong>Vendo Bote RD</strong>.<br/>
    Para soporte escribe a: <a href="mailto:${ADMIN_EMAIL}" style="color:#0EA5E9;">${ADMIN_EMAIL}</a></p>
  </div>
</div>
</body></html>`;
}

function bookingRows(b) {
  return `
    <div class="row"><span class="lbl">Embarcación</span><span class="val">${b.boat_name || '—'}</span></div>
    <div class="row"><span class="lbl">Fecha</span><span class="val">${fmtDate(b.start_date)}</span></div>
    <div class="row"><span class="lbl">Turno</span><span class="val">${slotLabel(b.schedule)}</span></div>
    <div class="row"><span class="lbl">Personas</span><span class="val">${b.guests || 1}</span></div>
    ${b.booking_meta ? `<div class="row"><span class="lbl">Detalle</span><span class="val">${b.booking_meta}</span></div>` : ''}
    <div class="row total"><span class="lbl">Total</span><span class="val">${fmtMoney(b.total_price)}</span></div>
    <div class="row"><span class="lbl">Referencia</span><span class="val">${b.booking_ref}</span></div>`;
}

/* ── 1. Nueva reserva → Admin ── */
async function sendNewBookingAdmin(booking, user) {
  if (!process.env.EMAIL_USER) return;
  await transporter.sendMail({
    from: `"Vendo Bote RD" <${process.env.EMAIL_USER}>`,
    to: ADMIN_EMAIL,
    subject: `🆕 Nueva reserva: ${booking.booking_ref}`,
    html: wrap('Nueva Reserva Recibida', `
      <p class="greeting">Nueva reserva de ${user.name}</p>
      <p class="intro">Se ha creado una nueva reserva. El cliente debe realizar la transferencia y subir el comprobante.</p>
      <div class="box">
        <div class="box-title">Detalles de la Reserva</div>
        ${bookingRows({...booking, boat_name: booking.boat_name})}
      </div>
      <div class="box">
        <div class="box-title">Datos del Cliente</div>
        <div class="row"><span class="lbl">Nombre</span><span class="val">${user.name}</span></div>
        <div class="row"><span class="lbl">Email</span><span class="val">${user.email}</span></div>
        <div class="row"><span class="lbl">Teléfono</span><span class="val">${user.phone || '—'}</span></div>
      </div>
      <div class="cta"><a class="btn" href="http://localhost:3001/admin.html">Ver en Admin</a></div>
    `),
  });
}

/* ── 2. Comprobante enviado → Admin ── */
async function sendPaymentSubmittedAdmin(booking, user) {
  if (!process.env.EMAIL_USER) return;
  await transporter.sendMail({
    from: `"Vendo Bote RD" <${process.env.EMAIL_USER}>`,
    to: ADMIN_EMAIL,
    subject: `💳 Comprobante enviado: ${booking.booking_ref}`,
    html: wrap('Comprobante de Pago Recibido', `
      <p class="greeting">Comprobante de ${user.name}</p>
      <p class="intro"><strong>${user.name}</strong> ha enviado el comprobante de pago para la reserva <strong>${booking.booking_ref}</strong>. Por favor verifica la transferencia en el panel de administración.</p>
      <div class="box">
        <div class="box-title">Detalles de la Reserva</div>
        ${bookingRows(booking)}
      </div>
      <div class="cta"><a class="btn" href="http://localhost:3001/admin.html">Verificar Pago</a></div>
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
    <div class="cta"><a class="btn" href="http://localhost:3001/dashboard.html">Ver mi reserva</a></div>
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
      to: ADMIN_EMAIL,
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
      <div class="cta"><a class="btn" href="http://localhost:3001/dashboard.html?tab=payment">Subir nuevo comprobante</a></div>
    `),
  });
}

module.exports = { sendNewBookingAdmin, sendPaymentSubmittedAdmin, sendPaymentApproved, sendPaymentRejected };
