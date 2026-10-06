// Calcul du panier côté serveur. Les prix envoyés par le navigateur ne sont JAMAIS utilisés :
// tout est relu dans la base (produits, finitions, codes promo).
const db = require('./db');
const config = require('./config');

class CartError extends Error {}

const ttcFromHt = ht => Math.round(ht * (1 + config.vatRate));
const htFromTtc = ttc => Math.round(ttc / (1 + config.vatRate));

/**
 * @param {Array<{artworkSlug:string, productRef:string, quantity:number, finishIds?:string[]}>} items
 * @param {string|null} promoCode
 * @param {string|null} email  pour les codes à usage unique
 */
async function priceCart(items, promoCode = null, email = null) {
  if (!Array.isArray(items) || items.length === 0) throw new CartError('Panier vide');
  if (items.length > 50) throw new CartError('Panier trop volumineux');

  const lines = [];
  for (const raw of items) {
    const qty = Number.parseInt(raw.quantity, 10);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw new CartError('Quantité invalide');

    const { rows: [art] } = await db.query(
      `select a.id, a.slug, a.title, a.supports, a.preview_path, a.width_px, a.height_px,
              ar.id as artist_id, ar.is_internal
         from artworks a join artists ar on ar.id = a.artist_id
        where a.slug = $1 and a.status = 'accepte'`, [raw.artworkSlug]);
    if (!art) throw new CartError(`Visuel introuvable : ${raw.artworkSlug}`);

    const { rows: [prod] } = await db.query(
      `select ref, support, variant, format_label, width_cm, height_cm, price_ttc, min_qty
         from products where ref = $1 and active and brand = $2`, [raw.productRef, config.brand]);
    if (!prod) throw new CartError(`Produit introuvable : ${raw.productRef}`);
    if (!art.supports.includes(prod.support)) throw new CartError(`Ce visuel n'est pas proposé en ${prod.variant}`);
    if (qty < prod.min_qty) {
      throw new CartError(`Minimum ${prod.min_qty} exemplaires pour ${prod.variant} ${prod.format_label}`);
    }

    if (raw.finishIds !== undefined && !Array.isArray(raw.finishIds)) throw new CartError('Finitions invalides');
    if (typeof raw.artworkSlug !== 'string' || typeof raw.productRef !== 'string') throw new CartError('Article invalide');
    const finishIds = [...new Set(raw.finishIds || [])];
    if (finishIds.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) throw new CartError('Finition invalide');
    let finishes = [];
    if (finishIds.length) {
      const { rows } = await db.query(
        `select id, name, detail, price_ht from finishes
          where id = any($1::uuid[]) and active and support = $2
            and (product_ref is null or product_ref = $3)`, [finishIds, prod.support, prod.ref]);
      if (rows.length !== finishIds.length) throw new CartError('Finition non disponible pour ce produit');
      finishes = rows.map(f => ({ id: f.id, name: f.name, detail: f.detail, price_ht: f.price_ht,
        price_ttc: ttcFromHt(f.price_ht) }));
    }

    const unitTtc = prod.price_ttc + finishes.reduce((s, f) => s + f.price_ttc, 0);
    lines.push({
      artwork: art, product: prod, quantity: qty, finishes,
      unitTtc, totalTtc: unitTtc * qty,
      // Assiette royalties : prix HT du produit (hors finitions), avant remise, hors port
      royaltyBaseHt: art.is_internal ? 0 : htFromTtc(prod.price_ttc) * qty,
    });
  }

  const subtotal = lines.reduce((s, l) => s + l.totalTtc, 0);

  let discount = 0, promo = null;
  if (promoCode) {
    const code = String(promoCode).trim().toUpperCase();
    const { rows: [p] } = await db.query(
      `select * from promo_codes where upper(code) = $1 and active
          and (brand is null or brand = $2) and (expires_at is null or expires_at > now())`,
      [code, config.brand]);
    if (p && p.single_use_per_email && email) {
      const { rowCount } = await db.query(
        `select 1 from promo_usage u left join orders o on o.id = u.order_id
          where upper(u.code) = $1 and lower(u.email) = lower($2)
            and not (coalesce(o.status, '') = 'cancelled' or (o.status = 'pending' and o.created_at < now() - interval '70 minutes'))`, [code, email]);
      if (rowCount) throw new CartError('Ce code a déjà été utilisé');
    }
    if (!p) throw new CartError('Code promo invalide ou expiré');
    discount = p.discount_type === 'percent'
      ? Math.round(subtotal * Number(p.discount_value) / 100)
      : Math.min(subtotal, Math.round(Number(p.discount_value)));
    promo = { code: p.code, type: p.discount_type, value: Number(p.discount_value),
      singleUse: p.single_use_per_email };
  }

  const goods = subtotal - discount;
  const shipping = goods >= config.freeShippingThreshold ? 0 : config.shippingFlat;
  const total = goods + shipping;

  return {
    lines, subtotal, discount, shipping, total, promo,
    freeShippingThreshold: config.freeShippingThreshold,
    missingForFreeShipping: Math.max(0, config.freeShippingThreshold - goods),
    vat: total - htFromTtc(total),
  };
}

// Version « affichable » du panier pour le navigateur (sans données internes)
function publicCart(c) {
  return {
    lines: c.lines.map(l => ({
      artworkSlug: l.artwork.slug, title: l.artwork.title,
      productRef: l.product.ref, variant: l.product.variant, format: l.product.format_label,
      quantity: l.quantity, finishes: l.finishes.map(f => ({ id: f.id, name: f.name, priceTtc: f.price_ttc })),
      unitTtc: l.unitTtc, totalTtc: l.totalTtc,
    })),
    subtotal: c.subtotal, discount: c.discount, shipping: c.shipping, total: c.total,
    promoCode: c.promo?.code || null, missingForFreeShipping: c.missingForFreeShipping,
  };
}

module.exports = { priceCart, publicCart, CartError, ttcFromHt, htFromTtc };
