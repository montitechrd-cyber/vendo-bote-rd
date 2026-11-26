// Limpia las credenciales de AZUL pegadas en el panel del hosting (espacios, saltos de línea o comillas que
// se cuelan al copiar de un correo) y describe su forma SIN revelar sus valores.
const crypto = require('node:crypto');

// Huella corta e irreversible para comparar la llave de PRUEBAS con la que envió AZUL sin mostrarla.
const fingerprint = (v) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 8);

const KEYS = ['AZUL_MERCHANT_ID', 'AZUL_AUTH_KEY'];

const clean = (v) => String(v).replace(/[\s ​-‍﻿]+/g, '').replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');

function normalizeAzulEnv(env) {
  const report = [];
  for (const k of KEYS) {
    if (env[k] === undefined || env[k] === '') { report.push(`${k}: falta`); continue; }
    const value = clean(env[k]);
    report.push(`${k}: ${value.length} caracteres${value !== env[k] ? ' (se quitaron espacios o comillas)' : ''}${/^[\x21-\x7e]*$/.test(value) ? '' : ' (tiene caracteres no válidos)'}`);
    env[k] = value;
  }
  if (env.AZUL_ENV !== 'prod' && env.AZUL_MERCHANT_ID && env.AZUL_AUTH_KEY) {
    report.push(`modo pruebas: MerchantID=${env.AZUL_MERCHANT_ID}, huella de la llave=${fingerprint(env.AZUL_AUTH_KEY)}`);
  }
  return report.join(' · ');
}

// Resumen del formulario enviado a AZUL para diagnosticar rechazos en el ambiente de PRUEBAS. No incluye la
// firma ni los datos personales: de estos solo la longitud y si tienen caracteres fuera de ASCII imprimible.
function describeFields(action, fields) {
  const out = { action };
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'AuthHash') continue;
    if (k.startsWith('CardHolder')) out[k] = `len=${String(v).length}${/^[ -~]*$/.test(v) ? '' : ' no-ascii'}`;
    else out[k] = v;
  }
  return JSON.stringify(out);
}

module.exports = { normalizeAzulEnv, describeFields };
