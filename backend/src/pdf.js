// Fichiers PDF (visuels vectoriels ou PDF HD) : lecture et rendu avec MuPDF (WebAssembly, sans dépendance système).
// Le PDF original est conservé tel quel ; seuls l'aperçu et le fichier HD de production sont rendus en image.
let mu = null;
const load = async () => (mu ||= await import('mupdf'));

const MAX_PIXELS = 160e6; // garde-fou mémoire : ~ 100 × 150 cm à 200 dpi

const isPdf = buf => Buffer.isBuffer(buf) && buf.subarray(0, 5).toString('latin1') === '%PDF-';

/** Taille de la page 1 en points (1 pt = 1/72 pouce) et nombre de pages. */
async function pdfInfo(buffer) {
  const m = await load();
  let doc;
  try { doc = m.Document.openDocument(buffer, 'application/pdf'); }
  catch { throw new Error('PDF illisible ou protégé par mot de passe'); }
  if (doc.needsPassword && doc.needsPassword()) throw new Error('PDF protégé par mot de passe : envoyez une version sans protection');
  const pages = doc.countPages();
  if (!pages) throw new Error('PDF vide');
  const [x0, y0, x1, y1] = doc.loadPage(0).getBounds();
  return { widthPt: x1 - x0, heightPt: y1 - y0, pages };
}

/**
 * Rend la page 1 en RVB.
 * - { longSide } : le plus grand côté fait longSide pixels (aperçus)
 * - { width, height, fit: 'cover' | 'inside' } : couvre ou tient dans ce cadre (fichier HD)
 * Retourne { data, width, height, channels } (pixels bruts, à passer à sharp avec { raw }).
 */
async function renderPdf(buffer, target) {
  const m = await load();
  const doc = m.Document.openDocument(buffer, 'application/pdf');
  const page = doc.loadPage(0);
  const [x0, y0, x1, y1] = page.getBounds();
  const w = x1 - x0, h = y1 - y0;
  let scale;
  if (target.longSide) scale = target.longSide / Math.max(w, h);
  else if (target.fit === 'cover') scale = Math.max(target.width / w, target.height / h);
  else scale = Math.min(target.width / w, target.height / h);
  if (w * scale * h * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (w * h));
  // Fond blanc (pas d'alpha) : une zone transparente du PDF s'imprime en blanc
  const pix = page.toPixmap(m.Matrix.scale(scale, scale), m.ColorSpace.DeviceRGB, false, true);
  const width = pix.getWidth(), height = pix.getHeight(), channels = pix.getNumberOfComponents();
  const stride = pix.getStride(), px = pix.getPixels();
  let data;
  if (stride === width * channels) data = Buffer.from(px.buffer, px.byteOffset, px.byteLength);
  else { // lignes avec remplissage : recopie compacte
    data = Buffer.alloc(width * height * channels);
    for (let y = 0; y < height; y++) Buffer.from(px.buffer, px.byteOffset + y * stride, width * channels).copy(data, y * width * channels);
  }
  data = Buffer.from(data); // copie hors de la mémoire WebAssembly avant de libérer le pixmap
  pix.destroy?.(); page.destroy?.(); doc.destroy?.();
  return { data, width, height, channels };
}

module.exports = { isPdf, pdfInfo, renderPdf };
