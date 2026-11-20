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
module.exports = { audit };
