// Commandes : création (avant paiement), finalisation (après paiement Stripe), production.
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const storage = require('./storage');
const { priceCart, CartError } = require('./pricing');
const production = require('./production');
const emails = require('./emails');

const COUNTRIES = ['FR', 'BE', 'LU', 'MC', 'CH', 'DE', 'ES', 'IT', 'NL', 'PT', 'AT'];

function newOrderNumber() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `ART-${ymd}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function validateCustomer(c) {
  const req = ['email', 'name', 'address1', 'postalCode', 'city', 'country'];
  if (!c || typeof c !== 'object') throw new CartError('Coordonnées manquantes');
  for (const k of [...req, 'address2']) if (c[k] !== undefined && c[k] !== null && typeof c[k] !== 'string') throw new CartError(`Champ invalide : ${k}`);
  for (const k of req) if (!String(c[k] || '').trim()) throw new CartError(`Champ manquant : ${k}`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) throw new CartError('Email invalide');
  if (!COUNTRIES.includes(String(c.country).toUpperCase())) throw new CartError('Pays de livraison non desservi');
}

/** Enregistre la commande « en attente de paiement » et retourne { order, cart }. */
async function createPendingOrder({ items, promoCode, customer }) {
  validateCustomer(customer);
  const cart = await priceCart(items, promoCode, customer.email);
  if (cart.total < 50) throw new CartError('Montant minimum de paiement : 0,50 €');

  const order = await db.tx(async c => {
    const { rows: [o] } = await c.query(
      `insert into orders (order_number, brand, customer_email, customer_name, ship_address_line1,
          ship_address_line2, ship_postal_code, ship_city, ship_country, amount_total, amount_shipping,
          amount_discount, promo_code, vat_rate, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending') returning *`,
      [newOrderNumber(), config.brand, customer.email.trim().toLowerCase(), customer.name.trim(),
        customer.address1.trim(), (customer.address2 || '').trim() || null, customer.postalCode.trim(),
        customer.city.trim(), customer.country.toUpperCase(), cart.total, cart.shipping, cart.discount,
        cart.promo?.code || null, config.vatRate]);
    if (cart.promo?.singleUse) {
      // Réserve le code dès la création : deux paiements simultanés ne peuvent pas l'utiliser deux fois.
      // Une réservation liée à une commande annulée ou abandonnée depuis plus de 70 min est libérée.
      await c.query(
        `delete from promo_usage u using orders o where o.id = u.order_id and upper(u.code) = upper($1)
            and lower(u.email) = lower($2) and (o.status = 'cancelled' or (o.status = 'pending' and o.created_at < now() - interval '70 minutes'))`,
        [cart.promo.code, o.customer_email]);
      const { rowCount } = await c.query(
        `insert into promo_usage (code, email, order_id) values ($1,$2,$3) on conflict (code, email) do nothing`,
        [cart.promo.code, o.customer_email, o.id]);
      if (!rowCount) throw new CartError('Ce code a déjà été utilisé ou une commande est en cours avec ce code');
    }
    for (const [i, l] of cart.lines.entries()) {
      await c.query(
        `insert into order_items (order_id, product_type, quantity, unit_price, customization,
            artwork_id, product_ref, finishes, source_file_path, position)
         select $1,$2,$3,$4,$5,$6,$7,$8, original_path, $9 from artworks where id = $6`,
        [o.id, l.product.support, l.quantity, l.unitTtc,
          { variant: l.product.variant, format: l.product.format_label, royaltyBaseHt: l.royaltyBaseHt },
          l.artwork.id, l.product.ref, JSON.stringify(l.finishes), i]);
    }
    return o;
  });
  return { order, cart };
}

/** Recharge les lignes d'une commande avec produit, visuel et artiste. */
async function loadLines(orderId) {
  const { rows } = await db.query(
    `select oi.id, oi.quantity, oi.unit_price, oi.finishes, oi.customization,
            p.ref, p.support, p.variant, p.format_label, p.width_cm, p.height_cm, p.price_ttc,
            a.id as artwork_id, a.slug, a.title, a.original_path, a.width_px, a.height_px,
            ar.id as artist_id, ar.is_internal
       from order_items oi
       join products p on p.ref = oi.product_ref
       join artworks a on a.id = oi.artwork_id
       join artists ar on ar.id = a.artist_id
      where oi.order_id = $1 order by oi.position, oi.id`, [orderId]);
  return rows.map(r => ({
    itemId: r.id, quantity: r.quantity, unitTtc: r.unit_price, finishes: r.finishes || [],
    product: { ref: r.ref, support: r.support, variant: r.variant, format_label: r.format_label,
      width_cm: r.width_cm, height_cm: r.height_cm, price_ttc: r.price_ttc },
    artwork: { id: r.artwork_id, slug: r.slug, title: r.title, original_path: r.original_path,
      width_px: r.width_px, height_px: r.height_px },
    artist: { id: r.artist_id, is_internal: r.is_internal },
  }));
}

/**
 * Marque la commande payée (idempotent : un webhook Stripe rejoué ne fait rien).
 * Crée le numéro de facture, l'usage du code promo et les royalties.
 * Retourne la commande si elle vient d'être payée, sinon null.
 */
async function markPaid(orderId, { stripeSessionId = null, stripePaymentId = null, amountPaid = null } = {}) {
  return db.tx(async c => {
    const { rows: [o] } = await c.query('select * from orders where id = $1 for update', [orderId]);
    if (!o) throw new Error(`Commande ${orderId} introuvable`);
    if (o.status !== 'pending') return null;
    const mismatch = amountPaid !== null && amountPaid !== o.amount_total;
    if (mismatch) console.error(`[orders] Montant payé ${amountPaid} ≠ montant attendu ${o.amount_total} pour ${o.order_number}`);
    const { rows: [{ inv }] } = await c.query('select next_invoice_number($1) as inv', [config.brand]);
    const { rows: [paid] } = await c.query(
      `update orders set status = 'paid', paid_at = now(), invoice_number = $2,
          stripe_session_id = coalesce($3, stripe_session_id), stripe_payment_id = $4,
          notes = case when $5 then concat_ws(E'\n', notes, 'MONTANT PAYÉ DIFFÉRENT (' || $6 || ' centimes) : production bloquée, à vérifier') else notes end
        where id = $1 returning *`, [orderId, inv, stripeSessionId, stripePaymentId, mismatch, amountPaid]);
    paid.amountMismatch = mismatch;

    if (paid.promo_code) {
      await c.query(`insert into promo_usage (code, email, order_id) values ($1,$2,$3)
                     on conflict (code, email) do nothing`, [paid.promo_code, paid.customer_email, orderId]);
    }
    // Royalties : 10 % du HT avant remise, hors port, hors finitions — artistes externes uniquement
    const { rows: items } = await c.query(
      `select oi.id, oi.quantity, (oi.customization->>'royaltyBaseHt')::int as base, ar.id as artist_id, ar.is_internal
         from order_items oi
         join artworks a on a.id = oi.artwork_id join artists ar on ar.id = a.artist_id
        where oi.order_id = $1`, [orderId]);
    for (const it of items) {
      // Assiette figée au moment de la commande (prix HT avant remise, hors port, hors finitions)
      const base = it.base || 0;
      if (it.is_internal || base <= 0) continue;
      await c.query(
        `insert into royalties (order_item_id, artist_id, base_ht, rate, amount)
         values ($1,$2,$3,$4,$5) on conflict (order_item_id) do nothing`,
        [it.id, it.artist_id, base, config.royaltyRate, Math.round(base * config.royaltyRate)]);
    }
    return paid;
  });
}

/** Génère les fichiers HD + le bon de fabrication et envoie les emails (atelier puis client). */
async function runProduction(order) {
  const lines = await loadLines(order.id);
  const prepared = [];
  for (const [i, line] of lines.entries()) {
    const original = await storage.download(config.storageBucketPrivate, line.artwork.original_path);
    let hd;
    try {
      hd = await production.buildHdFile(order.order_number, i, line, original);
      await db.query(`update order_items set print_file_path = $2, hd_status = 'pret' where id = $1`, [line.itemId, hd.path]);
    } catch (e) {
      await db.query(`update order_items set hd_status = 'erreur' where id = $1`, [line.itemId]);
      throw e;
    }
    const url = await storage.signedUrl(config.storageBucketPrivate, hd.path, config.hdLinkDays, hd.fileName);
    prepared.push({ line, hd, url, thumb: await production.thumbnail(original) });
  }
  const pdf = await production.buildWorkOrderPdf(order, prepared);
  await storage.upload(config.storageBucketPrivate, `hd/${order.order_number}/BDF-${order.order_number}.pdf`, pdf, 'application/pdf');
  await emails.sendProductionEmail(order, prepared, pdf);
  await db.query('update orders set production_email_sent_at = now() where id = $1', [order.id]);
  await emails.sendCustomerConfirmation(order, prepared);
  return prepared;
}

/** Paiement confirmé -> commande payée -> production. Ne lève pas : les erreurs sont journalisées. */
async function finalizeOrder(orderId, payment) {
  const order = await markPaid(orderId, payment);
  if (!order) return null;
  if (order.amountMismatch) return order; // production bloquée jusqu'à vérification dans le back office
  try {
    await runProduction(order);
    console.log(`[orders] ${order.order_number} : production envoyée`);
  } catch (e) {
    console.error(`[orders] ${order.order_number} : échec production — relancer depuis le back office`, e);
  }
  return order;
}

/** Commande abandonnée (session Stripe expirée ou en échec) : annulation et libération du code promo. */
async function cancelPending(orderId) {
  await db.tx(async c => {
    const { rowCount } = await c.query(`update orders set status = 'cancelled' where id = $1 and status = 'pending'`, [orderId]);
    if (rowCount) await c.query('delete from promo_usage where order_id = $1', [orderId]);
  });
}

/** Au démarrage : relance la production des commandes payées dont l'email atelier n'est pas parti. */
async function sweepUnsent() {
  const { rows } = await db.query(
    `select * from orders where brand = $1 and status = 'paid' and production_email_sent_at is null
        and paid_at < now() - interval '2 minutes' and coalesce(notes, '') not like '%MONTANT PAYÉ DIFFÉRENT%'
      order by paid_at limit 20`, [config.brand]);
  for (const o of rows) {
    try { await runProduction(o); console.log(`[orders] ${o.order_number} : production relancée`); }
    catch (e) { console.error(`[orders] ${o.order_number} : relance impossible`, e.message); }
  }
}

module.exports = { cancelPending, sweepUnsent, createPendingOrder, markPaid, runProduction, finalizeOrder, loadLines, newOrderNumber };
