// ============================================================================
// ARTALUZ — API (Node.js / Express) — déployée sur Railway
// Basée sur l'architecture Stickrz : Stripe, Resend, Supabase (Postgres + Storage).
// ============================================================================
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const config = require('./config');
const db = require('./db');
const db_ = db;
const storage = require('./storage');
const { priceCart, publicCart, CartError } = require('./pricing');
const orders = require('./orders');
const artworks = require('./artworks');
const holidays = require('./holidays');

const stripe = config.stripeSecretKey ? require('stripe')(config.stripeSecretKey) : null;
if (!stripe) console.warn('[artaluz] STRIPE_SECRET_KEY absente — paiement désactivé');

const app = express();
app.set('trust proxy', 1);
// Origines autorisées : FRONTEND_URL + les adresses du site connues (tolère espaces et « / » final)
const clean = u => u.trim().replace(/\/+$/, '').toLowerCase();
const ALLOWED = new Set([...config.frontendUrl.split(','), 'https://artaluz.com', 'https://www.artaluz.com',
  'https://artaluz.netlify.app'].map(clean).filter(Boolean));
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || ALLOWED.has(clean(origin)) || /^https:\/\/[a-z0-9-]+--artaluz\.netlify\.app$/.test(origin)),
  credentials: true,
  allowedHeaders: ['Content-Type', 'X-Admin-Token'],
}));
app.use((req, res, next) => (req.path === '/api/stripe-webhook' ? next() : express.json({ limit: '1mb' })(req, res, next)));
// Développement uniquement : seuls les aperçus publics sont servis (jamais les originaux ni les fichiers HD)
if (config.localStorageDir) {
  app.use(`/local-storage/${config.storageBucketPublic}`, express.static(require('path').join(config.localStorageDir, config.storageBucketPublic)));
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 300 * 1024 * 1024 } });
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  if (err instanceof CartError) return res.status(400).json({ error: err.message });
  console.error(`[${req.method} ${req.path}]`, err);
  res.status(500).json({ error: 'Erreur serveur' });
});
function requireAdmin(req, res, next) {
  if (!config.adminPassword) return res.status(503).json({ error: 'Admin non configuré' });
  const a = crypto.createHash('sha256').update(String(req.get('X-Admin-Token') || '')).digest();
  const b = crypto.createHash('sha256').update(config.adminPassword).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Accès refusé' });
  next();
}
const previewUrl = p => storage.publicUrl(config.storageBucketPublic, p);
const qs = v => (typeof v === 'string' ? v : Array.isArray(v) ? String(v[0]) : '');
const int = (v, def, min, max) => { const n = Math.trunc(Number(qs(v))); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };

// ---------------------------------------------------------------------------
// Catalogue public
// ---------------------------------------------------------------------------
app.get('/health', async (req, res) => {
  // Diagnostic public sans donnée sensible : seule une catégorie d'erreur est renvoyée
  let db = 'ok';
  try {
    await db_.query('select count(*) from holidays');
  } catch (e) {
    const m = String(e.message || '');
    db = /password authentication/i.test(m) ? 'mot de passe incorrect'
      : /tenant or user not found/i.test(m) ? 'utilisateur incorrect (format postgres.xxxx attendu)'
      : /does not exist/i.test(m) ? 'tables absentes : mauvais projet Supabase ou scripts SQL non exécutés'
      : /timeout|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i.test(m) ? 'base injoignable : vérifier l\'adresse (pooler, port 6543)'
      : /ssl|certificate/i.test(m) ? 'problème SSL'
      : 'autre erreur : ' + (e.code || 'inconnue');
  }
  const store = await storage.check([config.storageBucketPrivate, config.storageBucketPublic]).catch(e => 'erreur : ' + e.message);
  res.json({ ok: true, stripe: !!stripe, db, storage: store });
});

app.get('/api/catalog', wrap(async (req, res) => {
  const [rel, occ, fig, prod, fin] = await Promise.all([
    db.query('select id, name, calendar, figure_label from religions where active order by sort_order'),
    db.query('select id, religion_id, name, kind from occasions where active order by religion_id, sort_order'),
    db.query('select id, religion_id, name, feast_month, feast_day from figures where active order by religion_id, name'),
    db.query(`select ref, support, variant, format_label, width_cm, height_cm, price_ttc, min_qty
                from products where active and brand = $1 order by sort_order`, [config.brand]),
    db.query(`select id, support, name, detail, product_ref, round(price_ht * (1 + $1::numeric))::int as price_ttc
                from finishes where active order by support, name`, [config.vatRate]),
  ]);
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ religions: rel.rows, occasions: occ.rows, figures: fig.rows, products: prod.rows,
    finishes: fin.rows, freeShippingThreshold: config.freeShippingThreshold });
}));

app.get('/api/holidays', wrap(async (req, res) => {
  const params = [], where = ['h.starts_on >= current_date - 2', `h.starts_on < current_date + interval '13 months'`];
  if (qs(req.query.religion)) { params.push(qs(req.query.religion)); where.push(`o.religion_id = $${params.length}`); }
  const { rows } = await db.query(
    `select h.starts_on, h.ends_on, h.approximate, o.id as occasion_id, o.name, o.religion_id
       from holidays h join occasions o on o.id = h.occasion_id
      where ${where.join(' and ')} order by h.starts_on limit 40`, params);
  res.json(rows);
}));

app.get('/api/artworks', wrap(async (req, res) => {
  const params = [], where = [`a.status = 'accepte'`];
  for (const [k, col] of [['religion', 'religion_id'], ['occasion', 'occasion_id'], ['figure', 'figure_id']]) {
    if (qs(req.query[k])) {
      params.push(qs(req.query[k]));
      where.push(`exists (select 1 from artwork_tags t where t.artwork_id = a.id and t.${col} = $${params.length})`);
    }
  }
  if (qs(req.query.q)) { params.push(`%${qs(req.query.q).slice(0, 80)}%`); where.push(`(a.title ilike $${params.length} or array_to_string(a.tags, ' ') ilike $${params.length})`); }
  const limit = int(req.query.limit, 24, 1, 60), offset = int(req.query.offset, 0, 0, 100000);
  const { rows } = await db.query(
    `select a.slug, a.title, a.preview_path, a.width_px, a.height_px, a.featured, ar.display_name as artist
       from artworks a join artists ar on ar.id = a.artist_id
      where ${where.join(' and ')}
      order by a.featured desc, a.published_at desc nulls last limit ${limit} offset ${offset}`, params);
  res.json(rows.map(r => ({ ...r, preview: previewUrl(r.preview_path), preview_path: undefined })));
}));

app.get('/api/artworks/:slug', wrap(async (req, res) => {
  const { rows: [a] } = await db.query(
    `select a.id, a.slug, a.title, a.description, a.preview_path, a.width_px, a.height_px, a.supports,
            ar.display_name as artist, ar.is_internal
       from artworks a join artists ar on ar.id = a.artist_id where a.slug = $1 and a.status = 'accepte'`, [req.params.slug]);
  if (!a) return res.status(404).json({ error: 'Visuel introuvable' });
  const { rows: tags } = await db.query(
    `select t.religion_id, r.name as religion, t.occasion_id, o.name as occasion, t.figure_id, f.name as figure
       from artwork_tags t join religions r on r.id = t.religion_id
       left join occasions o on o.id = t.occasion_id left join figures f on f.id = t.figure_id
      where t.artwork_id = $1`, [a.id]);
  const printable = await artworks.printableProducts(a.width_px, a.height_px);
  res.json({ ...a, id: undefined, is_internal: undefined, artist: a.is_internal ? 'Création Artaluz' : `Par ${a.artist}`,
    preview_path: undefined, preview: previewUrl(a.preview_path), tags,
    printableRefs: printable });
}));

// ---------------------------------------------------------------------------
// Panier et paiement
// ---------------------------------------------------------------------------
app.post('/api/cart/price', wrap(async (req, res) => {
  const cart = await priceCart(req.body.items, req.body.promoCode || null, req.body.email || null);
  res.json(publicCart(cart));
}));

app.post('/api/checkout', wrap(async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Paiement indisponible' });
  const { order, cart } = await orders.createPendingOrder(req.body);
  const sessionCfg = {
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: order.customer_email,
    locale: 'fr',
    line_items: cart.lines.map(l => ({
      quantity: l.quantity,
      price_data: {
        currency: 'eur', unit_amount: l.unitTtc,
        product_data: {
          name: `${l.artwork.title} — ${l.product.variant} ${l.product.format_label}`,
          ...(l.finishes.length ? { description: l.finishes.map(f => f.name).join(', ') } : {}),
        },
      },
    })),
    shipping_options: [{ shipping_rate_data: {
      type: 'fixed_amount', display_name: cart.shipping ? 'Livraison standard' : 'Livraison offerte',
      fixed_amount: { amount: cart.shipping, currency: 'eur' } } }],
    metadata: { orderId: order.id, orderNumber: order.order_number, brand: config.brand },
    payment_intent_data: { metadata: { orderNumber: order.order_number } },
    success_url: `${config.frontendUrl.split(',')[0]}/commande/?n=${order.order_number}&status=ok`,
    cancel_url: `${config.frontendUrl.split(',')[0]}/panier/?status=annule`,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };
  let coupon = null, session;
  try {
    if (cart.discount > 0) {
      coupon = await stripe.coupons.create({ amount_off: cart.discount, currency: 'eur', duration: 'once',
        max_redemptions: 1, name: `Code ${cart.promo.code}` });
      sessionCfg.discounts = [{ coupon: coupon.id }];
    }
    session = await stripe.checkout.sessions.create(sessionCfg);
  } catch (e) {
    await orders.cancelPending(order.id).catch(() => {});
    if (coupon) await stripe.coupons.del(coupon.id).catch(() => {});
    throw e;
  }
  await db.query('update orders set stripe_session_id = $2 where id = $1', [order.id, session.id]);
  res.json({ checkoutUrl: session.url, orderNumber: order.order_number });
}));

app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(503).end();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), config.stripeWebhookSecret);
  } catch (e) {
    console.error('[webhook] signature invalide', e.message);
    return res.status(400).send('Signature invalide');
  }
  const s = event.data.object;
  if (s?.metadata?.brand !== config.brand || !s.metadata?.orderId) return res.json({ received: true });
  const paidEvent = (event.type === 'checkout.session.completed' && s.payment_status === 'paid')
    || event.type === 'checkout.session.async_payment_succeeded';
  if (paidEvent) {
    let order;
    try {
      // Enregistré AVANT de répondre : si la base échoue, Stripe renverra l'événement.
      order = await orders.markPaid(s.metadata.orderId, { stripeSessionId: s.id,
        stripePaymentId: s.payment_intent, amountPaid: s.amount_total });
    } catch (e) {
      console.error('[webhook] enregistrement du paiement', e);
      return res.status(500).send('Erreur temporaire');
    }
    res.json({ received: true });
    if (order && !order.amountMismatch) {
      orders.runProduction(order)
        .then(() => console.log(`[orders] ${order.order_number} : production envoyée`))
        .catch(e => console.error(`[orders] ${order.order_number} : échec production — relance au prochain démarrage ou depuis le back office`, e));
    }
    return;
  }
  if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
    await orders.cancelPending(s.metadata.orderId).catch(e => console.error('[webhook] annulation', e.message));
    for (const d of s.discounts || []) if (d.coupon) await stripe.coupons.del(typeof d.coupon === 'string' ? d.coupon : d.coupon.id).catch(() => {});
  }
  res.json({ received: true });
});

app.get('/api/orders/:number', wrap(async (req, res) => {
  const { rows: [o] } = await db.query(
    `select order_number, status, amount_total, created_at from orders
      where order_number = $1 and brand = $2`, [req.params.number, config.brand]);
  if (!o) return res.status(404).json({ error: 'Commande introuvable' });
  res.json(o);
}));

// ---------------------------------------------------------------------------
// Back office (mot de passe admin, comme Stickrz)
// ---------------------------------------------------------------------------
app.post('/api/admin/artworks', requireAdmin, upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier manquant' });
  const tags = JSON.parse(req.body.tags || '[]');
  let artistId = req.body.artistId;
  if (!artistId) {
    const { rows: [studio] } = await db.query(`select id from artists where is_internal order by created_at limit 1`);
    if (!studio) return res.status(400).json({ error: 'Artiste interne absent : appliquez 003_artaluz_taxonomie.sql' });
    artistId = studio.id;
  }
  try {
    const out = await artworks.createArtwork({ artistId, title: req.body.title, description: req.body.description,
      buffer: req.file.buffer, originalName: req.file.originalname, tags,
      supports: req.body.supports ? JSON.parse(req.body.supports) : null,
      status: req.body.status || 'accepte', featured: req.body.featured === 'true' });
    res.json(out);
  } catch (e) {
    if (/refusé|trop petite|requise|introuvable|PDF|unsupported image format|Input buffer/i.test(e.message)) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

app.get('/api/admin/artworks', requireAdmin, wrap(async (req, res) => {
  const { rows } = await db.query(
    `select a.slug, a.title, a.status, a.width_px, a.height_px, a.preview_path, a.featured, a.created_at,
            case when a.original_path ilike '%.pdf' then 'pdf' else 'image' end as original_format,
            ar.display_name as artist,
            (select string_agg(coalesce(o.name, f.name, r.name), ', ') from artwork_tags t
               join religions r on r.id = t.religion_id left join occasions o on o.id = t.occasion_id
               left join figures f on f.id = t.figure_id where t.artwork_id = a.id) as tags
       from artworks a join artists ar on ar.id = a.artist_id order by a.created_at desc limit 300`);
  res.json(rows.map(r => ({ ...r, preview: previewUrl(r.preview_path) })));
}));

app.patch('/api/admin/artworks/:slug', requireAdmin, wrap(async (req, res) => {
  const allowed = ['accepte', 'a_corriger', 'refuse', 'retire', 'en_attente'];
  if (req.body.status && !allowed.includes(req.body.status)) return res.status(400).json({ error: 'Statut invalide' });
  const { rows: [a] } = await db.query(
    `update artworks set status = coalesce($2, status), featured = coalesce($3, featured),
        moderation_note = coalesce($4, moderation_note),
        published_at = case when $2 = 'accepte' and published_at is null then now() else published_at end
      where slug = $1 returning slug, status, featured`,
    [req.params.slug, req.body.status || null, req.body.featured ?? null, req.body.note || null]);
  if (!a) return res.status(404).json({ error: 'Visuel introuvable' });
  res.json(a);
}));

app.get('/api/admin/orders', requireAdmin, wrap(async (req, res) => {
  const { rows } = await db.query(
    `select o.order_number, o.status, o.customer_name, o.customer_email, o.amount_total, o.paid_at,
            o.production_email_sent_at, o.invoice_number,
            (select count(*) from order_items i where i.order_id = o.id) as lines
       from orders o where o.brand = $1 order by o.created_at desc limit 200`, [config.brand]);
  res.json(rows);
}));

app.post('/api/admin/orders/:number/production', requireAdmin, wrap(async (req, res) => {
  const { rows: [o] } = await db.query('select * from orders where order_number = $1 and brand = $2', [req.params.number, config.brand]);
  if (!o || o.status === 'pending' || o.status === 'cancelled') return res.status(400).json({ error: 'Commande non payée' });
  await orders.runProduction(o);
  res.json({ ok: true });
}));

app.patch('/api/admin/orders/:number', requireAdmin, wrap(async (req, res) => {
  const allowed = ['paid', 'in_production', 'shipped', 'delivered', 'cancelled', 'refunded'];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error: 'Statut invalide' });
  const { rows: [o] } = await db.query(`update orders set status = $3 where order_number = $1 and brand = $2
     and status <> 'pending' returning order_number, status`, [req.params.number, config.brand, req.body.status]);
  if (!o) return res.status(404).json({ error: 'Commande introuvable' });
  if (req.body.status === 'refunded' || req.body.status === 'cancelled') {
    await db.query(`update royalties set status = 'annulee' where status in ('en_attente','acquise')
       and order_item_id in (select i.id from order_items i join orders o on o.id = i.order_id where o.order_number = $1)`, [req.params.number]);
  }
  res.json(o);
}));

if (require.main === module) {
  app.listen(config.port, () => console.log(`[artaluz] API sur le port ${config.port}`));
  // Calendrier des fêtes : mise à jour au démarrage puis chaque jour
  const syncHolidays = () => holidays.refresh()
    .then(n => n && console.log(`[holidays] ${n} date(s) ajoutée(s)`))
    .catch(e => console.error('[holidays]', e.message));
  syncHolidays();
  orders.sweepUnsent().catch(e => console.error('[orders] relance', e.message));
  setInterval(syncHolidays, 24 * 3600 * 1000).unref();
}
module.exports = app;
