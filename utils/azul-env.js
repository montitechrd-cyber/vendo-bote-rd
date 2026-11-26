// Limpia las credenciales de AZUL pegadas en el panel del hosting (espacios, saltos de línea o comillas que
// se cuelan al copiar de un correo) y describe su forma SIN revelar sus valores.
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
  return report.join(' · ');
}

module.exports = { normalizeAzulEnv };
