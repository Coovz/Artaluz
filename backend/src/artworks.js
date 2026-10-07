// Visuels : import (studio ou artiste), aperçu filigrané, contrôles techniques.
const sharp = require('sharp');
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const storage = require('./storage');
const { PRINT_SPECS } = require('./production');
const { isPdf, pdfInfo, renderPdf } = require('./pdf');

// Un PDF est considéré vectoriel : on enregistre ses proportions sur une base de 20 000 px
// (tous les formats au bon ratio sont proposés). Les images intégrées au PDF ne sont pas contrôlées.
const PDF_VIRTUAL_LONG_SIDE = 20000;

const ACCEPTED = ['jpeg', 'png', 'tiff', 'webp'];

const slugify = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** Contrôle d'un fichier source : format, dimensions, formats imprimables. */
async function inspect(buffer) {
  if (isPdf(buffer)) {
    const { widthPt, heightPt, pages } = await pdfInfo(buffer);
    const k = PDF_VIRTUAL_LONG_SIDE / Math.max(widthPt, heightPt);
    return { width: Math.round(widthPt * k), height: Math.round(heightPt * k), format: 'pdf', pages,
      pageCm: { w: +(widthPt / 72 * 2.54).toFixed(1), h: +(heightPt / 72 * 2.54).toFixed(1) } };
  }
  const meta = await sharp(buffer, { limitInputPixels: false }).metadata();
  if (!ACCEPTED.includes(meta.format)) throw new Error(`Format ${meta.format} refusé (PDF, JPEG, PNG, TIFF ou WebP)`);
  if (Math.min((meta.autoOrient || meta).width, (meta.autoOrient || meta).height) < 1000) throw new Error('Image trop petite : 1 000 px minimum sur le petit côté');
  const { width, height } = meta.autoOrient || meta; // dimensions après rotation EXIF
  return { width, height, format: meta.format, space: meta.space, hasAlpha: meta.hasAlpha };
}

/** Plus grand format imprimable sans descendre sous 70 % de la résolution cible, par support. */
async function printableProducts(widthPx, heightPx) {
  const { rows } = await db.query('select ref, support, width_cm, height_cm from products where active and brand = $1', [config.brand]);
  const ok = [];
  for (const p of rows) {
    const spec = PRINT_SPECS[p.support];
    const w = Number(p.width_cm), h = Number(p.height_cm);
    const long = Math.max(widthPx, heightPx), short = Math.min(widthPx, heightPx);
    const needLong = Math.max(w, h) / 2.54 * spec.dpi * 0.7;
    const needShort = spec.fit === 'inside' ? 0 : Math.min(w, h) / 2.54 * spec.dpi * 0.7;
    if (long >= needLong && short >= needShort) ok.push(p.ref);
  }
  return ok;
}

async function watermarkedPreview(buffer) {
  let base;
  if (isPdf(buffer)) {
    const r = await renderPdf(buffer, { longSide: 1600 });
    base = sharp(r.data, { raw: { width: r.width, height: r.height, channels: r.channels } });
  } else {
    base = sharp(buffer, { limitInputPixels: false }).rotate().resize(1600, 1600, { fit: 'inside' });
  }
  const { width, height } = await base.clone().toBuffer({ resolveWithObject: true }).then(r => r.info);
  const fs = Math.round(Math.min(width, height) / 9);
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Georgia, serif"
      font-size="${fs}" letter-spacing="${fs / 4}" fill="#ffffff" fill-opacity="0.28"
      transform="rotate(-28 ${width / 2} ${height / 2})">ARTALUZ</text></svg>`);
  return base.composite([{ input: svg }]).flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}

/**
 * Crée un visuel. tags = [{religion, occasion?, figure?}]
 * status 'accepte' pour le studio interne, 'en_attente' pour un artiste externe.
 */
async function createArtwork({ artistId, title, description, buffer, originalName, tags = [], supports, status = 'en_attente', featured = false }) {
  const info = await inspect(buffer);
  if (!tags.length) throw new Error('Au moins une religion est requise');
  if (!/^[0-9a-f-]{36}$/i.test(String(artistId))) throw new Error('Artiste introuvable : identifiant requis');
  const { rowCount: okArtist } = await db.query('select 1 from artists where id = $1', [artistId]);
  if (!okArtist) throw new Error('Artiste introuvable : identifiant requis');
  const id = crypto.randomUUID();
  const ext = ({ jpeg: 'jpg', png: 'png', tiff: 'tif', webp: 'webp', pdf: 'pdf' })[info.format];
  const originalPath = `originals/${artistId}/${id}.${ext}`;
  const previewPath = `previews/${id}.jpg`;
  await storage.upload(config.storageBucketPrivate, originalPath, buffer, info.format === 'pdf' ? 'application/pdf' : `image/${info.format}`);
  await storage.upload(config.storageBucketPublic, previewPath, await watermarkedPreview(buffer), 'image/jpeg');

  let slug = slugify(title) || id.slice(0, 8);
  const { rowCount } = await db.query('select 1 from artworks where slug = $1', [slug]);
  if (rowCount) slug = `${slug}-${id.slice(0, 6)}`;

  await db.tx(async c => {
    await c.query(
      `insert into artworks (id, slug, artist_id, title, description, original_path, preview_path,
          width_px, height_px, supports, status, featured, published_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce($10, array['bache','sticker','magnet','poster','alu']),$11,$12,
               case when $11 = 'accepte' then now() end)`,
      [id, slug, artistId, title, description || null, originalPath, previewPath, info.width, info.height,
        supports || null, status, featured]);
    for (const t of tags) {
      await c.query('insert into artwork_tags (artwork_id, religion_id, occasion_id, figure_id) values ($1,$2,$3,$4)',
        [id, t.religion, t.occasion || null, t.figure || null]);
    }
  });
  return { id, slug, ...info, originalName, printable: await printableProducts(info.width, info.height) };
}

module.exports = { createArtwork, inspect, printableProducts, watermarkedPreview, slugify };
