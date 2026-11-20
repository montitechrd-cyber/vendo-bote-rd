// Falla A PROPÓSITO mientras algún HTML de public/ contenga el marcador [COMPLETAR-DUEÑO].
// Son datos que solo el dueño puede dar (dirección permanente, política exacta de reembolso, texto legal).
// Así el sitio no puede llegar a producción con datos pendientes. No lo omitas ni lo ocultes:
// reemplaza cada marcador por el dato real y la prueba pasa.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MARCADOR = '[COMPLETAR-DUEÑO]';
const PUBLIC = path.join(__dirname, '..', 'public');

function htmls(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return htmls(p);
    return e.name.endsWith('.html') ? [p] : [];
  });
}

test('ningún HTML de public/ contiene el marcador [COMPLETAR-DUEÑO]', () => {
  const pendientes = [];
  for (const f of htmls(PUBLIC)) {
    const n = fs.readFileSync(f, 'utf8').split(MARCADOR).length - 1;
    if (n) pendientes.push(`${path.relative(PUBLIC, f)} (${n})`);
  }
  assert.deepStrictEqual(pendientes, [],
    `\n\nFALTAN DATOS DEL DUEÑO: reemplaza ${MARCADOR} en:\n  ${pendientes.join('\n  ')}\n`);
});
