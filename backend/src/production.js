// Production : fichiers HD au format final + bon de fabrication PDF (une page par ligne).
const sharp = require('sharp');
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');
const config = require('./config');
const storage = require('./storage');
const { isPdf, renderPdf } = require('./pdf');

sharp.cache(false);
sharp.concurrency(1); // limite la mémoire sur Railway (fichiers jusqu'à ~60 Mpx)

// Résolution et fonds perdus par support (cahier des charges, section Produits)
const PRINT_SPECS = {
  bache:   { dpi: 100, bleedMm: 0, fit: 'cover',  label: 'Bâche' },
  poster:  { dpi: 150, bleedMm: 3, fit: 'cover',  label: 'Poster' },
  alu:     { dpi: 150, bleedMm: 3, fit: 'cover',  label: 'Tableau alu (Dibond)' },
  sticker: { dpi: 150, bleedMm: 2, fit: 'inside', label: 'Sticker' },  // format = plus grand côté
  magnet:  { dpi: 150, bleedMm: 2, fit: 'inside', label: 'Magnet' },
};

const mmToPx = (mm, dpi) => Math.round(mm / 25.4 * dpi);

/**
 * Dimensions finales (cm) dans l'orientation du visuel.
 * Bâche/poster/alu : le format est tourné pour suivre l'orientation du visuel (100×50 -> 50×100).
 * Sticker/magnet : le format désigne le plus grand côté, l'autre suit le ratio du visuel.
 */
function finalSizeCm(product, artwork) {
  const w = Number(product.width_cm), h = Number(product.height_cm);
  const ratio = artwork.width_px / artwork.height_px;
  if (PRINT_SPECS[product.support].fit === 'inside') {
    const longSide = Math.max(w, h);
    return ratio >= 1 ? { w: longSide, h: +(longSide / ratio).toFixed(1) }
                      : { w: +(longSide * ratio).toFixed(1), h: longSide };
  }
  const artLandscape = ratio >= 1, fmtLandscape = w >= h;
  return artLandscape === fmtLandscape ? { w, h } : { w: h, h: w };
}

function hdFileName(orderNumber, lineIndex, product, size) {
  const fmt = `${size.w}x${size.h}cm`.replace(/\./g, ',');
  return `${orderNumber}-L${lineIndex + 1}-${product.ref}-${fmt}.tif`;
}

/**
 * Génère le fichier HD d'une ligne et le dépose dans le stockage privé.
 * Retourne { path, fileName, widthPx, heightPx, effectiveDpi, size, bleedMm, dpi }.
 */
async function buildHdFile(orderNumber, lineIndex, line, originalBuffer) {
  const spec = PRINT_SPECS[line.product.support];
  const size = finalSizeCm(line.product, line.artwork);
  const wPx = mmToPx(size.w * 10 + 2 * spec.bleedMm, spec.dpi);
  const hPx = mmToPx(size.h * 10 + 2 * spec.bleedMm, spec.dpi);

  const fromPdf = isPdf(originalBuffer);
  let input, effectiveDpi;
  if (fromPdf) {
    // PDF : rendu direct à la taille finale (net pour le vectoriel) ; le PDF source est aussi transmis à l'atelier
    const r = await renderPdf(originalBuffer, { width: wPx, height: hPx, fit: spec.fit });
    const want = spec.fit === 'cover' ? Math.max(wPx / r.width, hPx / r.height) : Math.min(wPx / r.width, hPx / r.height);
    effectiveDpi = Math.round(spec.dpi / Math.max(want, 1)); // < cible seulement si le garde-fou mémoire a réduit le rendu
    input = sharp(r.data, { raw: { width: r.width, height: r.height, channels: r.channels }, limitInputPixels: false });
  } else {
    const raw = await sharp(originalBuffer, { limitInputPixels: false }).metadata();
    const meta = raw.autoOrient || raw; // dimensions après rotation EXIF
    // Résolution réelle du visuel source une fois imprimé à ce format (alerte si < 70 % de la cible)
    const scale = spec.fit === 'cover'
      ? Math.max(wPx / meta.width, hPx / meta.height)
      : Math.min(wPx / meta.width, hPx / meta.height);
    effectiveDpi = Math.round(spec.dpi / scale);
    input = sharp(originalBuffer, { limitInputPixels: false }).rotate();
  }

  const buf = await input
    .resize(wPx, hPx, { fit: spec.fit === 'cover' ? 'cover' : 'contain', position: 'centre',
      background: { r: 255, g: 255, b: 255, alpha: 0 }, kernel: 'lanczos3' })
    .toColorspace('srgb')
    .withMetadata({ density: spec.dpi })
    .tiff({ compression: 'lzw', xres: spec.dpi / 25.4, yres: spec.dpi / 25.4, resolutionUnit: 'inch' }) // xres en px/mm
    .toBuffer();

  const fileName = hdFileName(orderNumber, lineIndex, line.product, size);
  const path = `hd/${orderNumber}/${fileName}`;
  await storage.upload(config.storageBucketPrivate, path, buf, 'image/tiff');
  return { path, fileName, widthPx: wPx, heightPx: hPx, effectiveDpi, size, bleedMm: spec.bleedMm, dpi: spec.dpi, fromPdf };
}

async function thumbnail(originalBuffer) {
  if (isPdf(originalBuffer)) {
    const r = await renderPdf(originalBuffer, { longSide: 420 });
    return sharp(r.data, { raw: { width: r.width, height: r.height, channels: r.channels } }).png().toBuffer();
  }
  return sharp(originalBuffer, { limitInputPixels: false })
    .rotate().resize(420, 420, { fit: 'inside' }).flatten({ background: '#ffffff' }).png().toBuffer();
}

const barcode = text => bwipjs.toBuffer({ bcid: 'code128', text, scale: 2, height: 12, includetext: false });

const fmtDate = d => new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris',
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Bon de fabrication : une page par ligne de commande.
 * @param order  ligne de la table orders
 * @param lines  [{ line, hd, thumb }]
 */
async function buildWorkOrderPdf(order, lines) {
  const code = await barcode(order.order_number);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: `Bon de fabrication ${order.order_number}` } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - 72;

    lines.forEach(({ line, hd, thumb }, i) => {
      if (i > 0) doc.addPage();
      // En-tête
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#666').text('ARTALUZ — BON DE FABRICATION', 36, 36);
      doc.font('Helvetica-Bold').fontSize(20).fillColor('#000').text(order.order_number, 36, 50);
      doc.font('Helvetica').fontSize(10).text(`Payée le ${fmtDate(order.paid_at || order.created_at)}`, 36, 76);
      doc.text(`Ligne ${i + 1} / ${lines.length}`, 36, 90);
      doc.image(code, 36 + W - 170, 40, { width: 170 });
      doc.fontSize(8).text(order.order_number, 36 + W - 170, 80, { width: 170, align: 'center' });

      // Client / livraison
      doc.moveTo(36, 112).lineTo(36 + W, 112).strokeColor('#ccc').stroke();
      doc.font('Helvetica-Bold').fontSize(10).text('Livraison', 36, 122);
      doc.font('Helvetica').fontSize(10).text([
        order.customer_name || '', order.ship_address_line1 || '', order.ship_address_line2 || '',
        `${order.ship_postal_code || ''} ${order.ship_city || ''}`.trim(), (order.ship_country || 'FR').toUpperCase(),
      ].filter(Boolean).join('\n'), 36, 137, { width: W / 2 });
      doc.font('Helvetica-Bold').text('Contact', 36 + W / 2, 122);
      doc.font('Helvetica').text(order.customer_email, 36 + W / 2, 137, { width: W / 2 });

      // Fabrication
      const y0 = 215;
      doc.moveTo(36, y0 - 10).lineTo(36 + W, y0 - 10).stroke();
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#000')
        .text(`${line.quantity} × ${line.product.variant}`, 36, y0);
      const rows = [
        ['Référence', line.product.ref],
        ['Format final', `${String(hd.size.w).replace('.', ',')} × ${String(hd.size.h).replace('.', ',')} cm` +
          (line.product.support === 'sticker' || line.product.support === 'magnet'
            ? ` (format commandé : ${line.product.format_label})` : '')],
        ['Fonds perdus', hd.bleedMm ? `${hd.bleedMm} mm par côté (inclus dans le fichier)` : 'aucun'],
        ['Finitions', line.finishes.length ? line.finishes.map(f => f.detail ? `${f.name} (${f.detail})` : f.name).join(', ') : 'aucune'],
        ['Visuel', `${line.artwork.title} — ${line.artwork.slug}`],
        ['Fichier HD', hd.fileName],
        ['Fichier', `${hd.widthPx} × ${hd.heightPx} px, ${hd.dpi} dpi, TIFF sRGB`],
        ['Résolution source', (hd.fromPdf ? `PDF rendu à ${hd.effectiveDpi} dpi (PDF source joint au mail)` : `${hd.effectiveDpi} dpi effectifs`) + (hd.effectiveDpi < hd.dpi * 0.7 ? '  ATTENTION : À VÉRIFIER AVANT IMPRESSION' : '')],
      ];
      let y = y0 + 32;
      for (const [k, v] of rows) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor(k === 'Résolution source' && hd.effectiveDpi < hd.dpi * 0.7 ? '#b00020' : '#000')
          .text(k, 36, y, { width: 120 });
        doc.font('Helvetica').text(v, 160, y, { width: W - 124 });
        y = doc.y + 6;
      }
      if (thumb) doc.image(thumb, 36, Math.max(y + 12, 470), { fit: [W, 300], align: 'center' });
      doc.fontSize(8).fillColor('#888').text(
        `${config.merchant.name} — ${config.merchant.address}, ${config.merchant.zip} ${config.merchant.city}`,
        36, doc.page.height - 50, { width: W, align: 'center' });
    });
    doc.end();
  });
}

module.exports = { PRINT_SPECS, finalSizeCm, buildHdFile, buildWorkOrderPdf, thumbnail, hdFileName };
