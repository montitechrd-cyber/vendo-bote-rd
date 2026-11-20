#!/usr/bin/env node
// Reinicia el 2FA de UN administrador (salida de emergencia: teléfono y códigos de recuperación perdidos,
// o SESSION_SECRET cambiada). Uso:
//     DATABASE_URL=postgresql://... node scripts/reset-2fa.js correo@dominio --yes
// Solo toca la base de DATABASE_URL del entorno (o de .env). Sin --yes solo muestra qué haría.
// OJO: con la DATABASE_URL de PRODUCCIÓN es una acción sensible (quita la segunda barrera de esa cuenta): hazla solo
// si el dueño lo pidió. Queda una fila en audit_log (action 'admin.2fa_reset').
const { pool } = require('../database');

function target(url) {
  try { const u = new URL(url); return `${u.hostname}:${u.port || '5432'}${u.pathname}`; } catch { return '(DATABASE_URL no válida)'; }
}

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes('--yes');
  const email = (args.find((a) => !a.startsWith('--')) || '').trim().toLowerCase();
  if (!process.env.DATABASE_URL) { console.error('Falta DATABASE_URL en el entorno. No se hace nada.'); return 2; }
  if (!email) { console.error('Uso: node scripts/reset-2fa.js correo@dominio --yes'); return 2; }

  console.log(`Base de datos: ${target(process.env.DATABASE_URL)}`);
  console.log('AVISO: si esta es la base de PRODUCCIÓN, esto es una acción sensible; confirma que el dueño de la cuenta lo pidió.');
  const u = (await pool.query('SELECT id, email, role, totp_enabled FROM users WHERE email = $1', [email])).rows[0];
  if (!u) { console.error(`No existe ninguna cuenta con el correo ${email}.`); return 1; }
  if (u.role !== 'admin') { console.error(`La cuenta ${email} no es de administrador. No se hace nada.`); return 1; }
  if (!yes) {
    console.log(`Se desactivaría el 2FA de ${email} (id ${u.id}, 2FA ${u.totp_enabled ? 'activado' : 'no activado'}) y se borrarían su secreto y sus códigos de recuperación.`);
    console.log('Para ejecutarlo de verdad, repite el comando añadiendo --yes');
    return 1;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET totp_enabled = FALSE, totp_secret_enc = NULL, totp_last_step = NULL WHERE id = $1', [u.id]);
    const del = await client.query('DELETE FROM totp_recovery_codes WHERE user_id = $1', [u.id]);
    await client.query(
      "INSERT INTO audit_log (user_id, action, entity, entity_id, ip, detail) VALUES ($1, 'admin.2fa_reset', 'user', $2, 'script', $3)",
      [u.id, String(u.id), 'reiniciado con scripts/reset-2fa.js']
    );
    await client.query('COMMIT');
    console.log(`Listo: 2FA reiniciado para ${email}. Códigos de recuperación borrados: ${del.rowCount}.`);
    console.log('Al volver a iniciar sesión tendrá que configurar el 2FA de nuevo (sus sesiones con 2FA ya no valen).');
    return 0;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('No se pudo reiniciar el 2FA:', e.message);
    return 1;
  } finally { client.release(); }
}

main().then((code) => pool.end().then(() => process.exit(code)), (e) => { console.error(e.message); process.exit(1); });
