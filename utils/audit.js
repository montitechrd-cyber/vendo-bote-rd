// Registro de auditoría de acciones administrativas (PCI DSS 10). NUNCA recibe contraseñas, secretos, códigos ni tarjetas:
// solo qué acción, sobre qué registro, quién y desde qué IP. Si falla, no interrumpe la acción (solo avisa en el log).
const SENSITIVE = /(\b\d{13,19}\b|password|contrase|secret|token)/i;

async function audit(db, req, action, entity = null, entityId = null, detail = null) {
  try {
    let d = detail == null ? null : String(detail);
    if (d && SENSITIVE.test(d)) d = '[omitido]';
    if (d) d = d.slice(0, 200);
    const userId = req && req.user && req.user.id != null ? req.user.id : null;
    const ip = (req && (req.ip || (req.socket && req.socket.remoteAddress))) || null;
    await db.run(
      'INSERT INTO audit_log (user_id, action, entity, entity_id, ip, detail) VALUES ($1,$2,$3,$4,$5,$6)',
      [userId, String(action).slice(0, 60), entity ? String(entity).slice(0, 40) : null,
       entityId == null ? null : String(entityId).slice(0, 40), ip ? String(ip).slice(0, 64) : null, d]
    );
  } catch (e) { console.error('[audit]', e.message); }
}

// Tope de filas por clave y ventana (contador en memoria): evita inundar audit_log (p. ej. con contraseñas falladas
// desde una IP, o con muchas miniaturas vistas seguidas). Devuelve true si este evento SÍ se debe registrar.
const buckets = new Map();
function allowEvent(key, max, windowMs, now = Date.now()) {
  const b = buckets.get(key);
  if (!b || now >= b.until) {
    buckets.set(key, { n: 1, until: now + windowMs });
    if (buckets.size > 2000) for (const [k, v] of buckets) if (now >= v.until) buckets.delete(k);
    return true;
  }
  if (b.n >= max) return false;
  b.n++;
  return true;
}
module.exports = { audit, allowEvent };
