// Comprueba que un archivo subido sea realmente lo que dice su extensión (por sus primeros bytes),
// para no guardar HTML/ejecutables renombrados como .png o .pdf.
function matches(buf, ext) {
  if (!buf || buf.length < 12) return false;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const webp = buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  const pdf = buf.toString('ascii', 0, 5) === '%PDF-';
  switch (String(ext || '').toLowerCase()) {
    case '.jpg': case '.jpeg': return jpg;
    case '.png': return png;
    case '.webp': return webp;
    case '.pdf': return pdf;
    default: return false;
  }
}

// files: un archivo de multer o un arreglo de archivos
function allValid(files, path) {
  return [].concat(files || []).every(f => f && matches(f.buffer, path.extname(f.originalname || '')));
}

module.exports = { matches, allValid };
