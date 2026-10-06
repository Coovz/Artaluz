// Artaluz — fonctions communes à toutes les pages
const API = window.ARTALUZ_API;
const LEAD_DAYS = window.ARTALUZ_LEAD_DAYS || 8;

export const RELIGION_COLORS = {
  islam: 'var(--islam)', judaisme: 'var(--judaisme)', catholicisme: 'var(--catholicisme)',
  protestantisme: 'var(--protestantisme)', bouddhisme: 'var(--bouddhisme)',
};
export const SUPPORT_LABELS = { bache: 'Bâche', sticker: 'Sticker', magnet: 'Magnet', poster: 'Poster', alu: 'Tableau alu' };

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const eur = cents => (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

export async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

let catalogPromise;
export const catalog = () => (catalogPromise ||= api('/api/catalog'));

// ---------------------------------------------------------------------------
// Panier (navigateur) — les prix affichés sont recalculés par l'API au paiement
// ---------------------------------------------------------------------------
const KEY = 'artaluz-cart-v1';
export const cart = {
  read() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } },
  write(items) { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {} renderCartCount(); },
  add(item) {
    const items = cart.read();
    const same = items.find(i => i.artworkSlug === item.artworkSlug && i.productRef === item.productRef
      && JSON.stringify([...(i.finishIds || [])].sort()) === JSON.stringify([...(item.finishIds || [])].sort()));
    if (same) same.quantity += item.quantity; else items.push(item);
    cart.write(items);
  },
  count() { return cart.read().reduce((s, i) => s + i.quantity, 0); },
};

function renderCartCount() {
  const el = document.querySelector('.cart-count');
  if (el) el.textContent = cart.count();
}

// ---------------------------------------------------------------------------
// Dates des fêtes
// ---------------------------------------------------------------------------
const DAY = 86400000;
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const parseDay = s => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const fmtDay = (d, opts = { day: 'numeric', month: 'long' }) => d.toLocaleDateString('fr-FR', opts);

export function feastCard(h, religionsById = {}) {
  const start = parseDay(h.starts_on);
  const days = Math.round((start - today()) / DAY);
  const deadline = new Date(start.getTime() - LEAD_DAYS * DAY);
  const left = Math.round((deadline - today()) / DAY);
  const when = days <= 0 ? 'En ce moment' : days === 1 ? 'Demain' : `Dans ${days} jours`;
  const deadlineTxt = left < 0 ? 'Livraison avant la fête non garantie'
    : left === 0 ? 'Commandez aujourd\'hui pour être livré à temps'
    : `Commandez avant le ${fmtDay(deadline)}`;
  const rel = religionsById[h.religion_id];
  return `<a class="feast" style="--c:${RELIGION_COLORS[h.religion_id]}" href="/religion/${h.religion_id}?fete=${encodeURIComponent(h.occasion_id)}">
    <div class="when">${when} · ${fmtDay(start, { weekday: 'long', day: 'numeric', month: 'long' })}${h.approximate ? ' (±1 jour)' : ''}</div>
    <div class="what">${esc(h.name)}</div>
    ${rel ? `<div class="when">${esc(rel.name)}</div>` : ''}
    <div class="deadline ${left >= 0 && left <= 5 ? 'soon' : ''}">${deadlineTxt}</div>
  </a>`;
}

export function artworkCard(a) {
  return `<a class="card" href="/visuel/${encodeURIComponent(a.slug)}">
    <div class="frame"><img src="${esc(a.preview)}" alt="${esc(a.title)}" loading="lazy" width="${a.width_px}" height="${a.height_px}"></div>
    <div class="t">${esc(a.title)}</div><div class="a">${esc(a.artist)}</div></a>`;
}

// ---------------------------------------------------------------------------
// En-tête et pied de page
// ---------------------------------------------------------------------------
export async function chrome(current = '') {
  const head = document.createElement('header');
  head.className = 'site-head';
  head.innerHTML = `<div class="wrap">
    <a class="logo" href="/"><img src="/assets/logo.svg" alt="" onerror="this.remove()">Artaluz</a>
    <nav class="nav" aria-label="Religions"></nav>
    <a class="cart-link" href="/panier/"><span>Panier</span><span class="cart-count">0</span></a></div>`;
  document.body.prepend(head);
  const foot = document.createElement('footer');
  foot.className = 'site-foot';
  foot.innerHTML = `<div class="wrap">
    <div><div class="logo">Artaluz</div><p>Art sacré imprimé dans notre atelier de Seine-Saint-Denis : bâches, stickers, magnets, posters et tableaux en aluminium.</p></div>
    <div class="foot-rel"></div>
    <div><a href="/artistes/">Proposer vos créations</a><a href="/cgv/">Conditions de vente</a><a href="/mentions-legales/">Mentions légales</a><a href="mailto:contact@artaluz.com">contact@artaluz.com</a></div></div>`;
  document.body.append(foot);
  renderCartCount();
  try {
    const { religions } = await catalog();
    const links = religions.map(r => `<a href="/religion/${r.id}"${r.id === current ? ' aria-current="page"' : ''}>${esc(r.name)}</a>`).join('');
    head.querySelector('.nav').innerHTML = links;
    foot.querySelector('.foot-rel').innerHTML = links;
  } catch { /* API indisponible : la navigation reste vide */ }
}
