// Artaluz — fonctions communes à toutes les pages
const API = window.ARTALUZ_API;
const LEAD_DAYS = window.ARTALUZ_LEAD_DAYS || 8;

// Les cinq traditions, par ordre alphabétique (menu, accueil, pied de page)
export const RELIGIONS = [
  { id: 'bouddhisme', name: 'Bouddhisme' },
  { id: 'catholicisme', name: 'Catholicisme' },
  { id: 'islam', name: 'Islam' },
  { id: 'judaisme', name: 'Judaïsme' },
  { id: 'protestantisme', name: 'Protestantisme' },
];
export const RELIGION_COLORS = Object.fromEntries(RELIGIONS.map(r => [r.id, `var(--${r.id})`]));

// Emblèmes (traits dorés sur la couleur de la tradition)
const G = '#F2DFA9';
export const RELIGION_ICONS = {
  bouddhisme: `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="${G}" stroke-width="1.5"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2"/><path d="M12 3.5V20.5M3.5 12H20.5M6 6l12 12M18 6L6 18"/></g></svg>`,
  catholicisme: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3V21M6 8.5H18" stroke="${G}" stroke-width="2" stroke-linecap="round"/></svg>`,
  islam: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4a9 9 0 1 0 0 16 10 10 0 0 1 0-16z" fill="${G}"/><path d="M17.6 8.6l.9 2 2.1.2-1.6 1.4.5 2.1-1.9-1.1-1.9 1.1.5-2.1-1.6-1.4 2.1-.2z" fill="${G}"/></svg>`,
  judaisme: `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="${G}" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3l8 14H4z"/><path d="M12 21L4 7h16z"/></g></svg>`,
  protestantisme: `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="${G}" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 6V18M7.5 10H16.5"/></g></svg>`,
};
export const STAR = `<svg class="star" viewBox="0 0 40 40" width="30" height="30" aria-hidden="true"><path d="M20 1l3.5 15.5L39 20l-15.5 3.5L20 39l-3.5-15.5L1 20l15.5-3.5z" fill="#B98B2E"/></svg>`;
const FLAME = `<svg class="flame" viewBox="0 0 24 36" aria-hidden="true"><path d="M12 2C17 10 19 15 19 20a7 7 0 0 1-14 0C5 15 8 10 12 2z" fill="#E1A93B"/><path d="M12 14c2.5 4 3 6 3 8a3 3 0 0 1-6 0c0-2 1-4 3-8z" fill="#FBFAF7"/><rect x="11" y="29" width="2" height="6" fill="#1C2A3A"/></svg>`;
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
  const deadline = new Date(start.getTime() - LEAD_DAYS * DAY);
  const left = Math.round((deadline - today()) / DAY);
  const deadlineTxt = left < 0 ? 'Livraison avant la fête non garantie'
    : left === 0 ? 'Commandez aujourd\'hui'
    : `Commandez avant le ${fmtDay(deadline)}`;
  const rel = religionsById[h.religion_id];
  const when = (h.approximate ? 'Vers le ' : '') + fmtDay(start, h.approximate ? { day: 'numeric', month: 'long' } : { weekday: 'long', day: 'numeric', month: 'long' });
  return `<a class="feast" style="--c:${RELIGION_COLORS[h.religion_id]}" href="/religion/${h.religion_id}?fete=${encodeURIComponent(h.occasion_id)}">
    ${FLAME}
    <div class="what">${esc(h.name)}</div>
    <div class="when">${esc(when.charAt(0).toUpperCase() + when.slice(1))}${h.approximate ? ' (±1 jour)' : ''}</div>
    ${rel ? `<div class="rel">${esc(rel.name)}</div>` : ''}
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
export function chrome(current = '') {
  const link = r => `<a class="rel" href="/religion/${r.id}"${r.id === current ? ' aria-current="page"' : ''}>${esc(r.name)}</a>`;
  const head = document.createElement('header');
  head.className = 'site-head';
  head.innerHTML = `<div class="wrap">
    <nav class="nav left" aria-label="Traditions">${RELIGIONS.slice(0, 3).map(link).join('')}</nav>
    <a class="logo" href="/"><picture><source media="(max-width: 960px)" srcset="/assets/logo.png"><img src="/assets/logo-full.png" alt="Artaluz — des décors pour célébrer" width="485" height="163"></picture></a>
    <nav class="nav right" aria-label="Traditions et panier">${RELIGIONS.slice(3).map(link).join('')}
      <a class="cart-link" href="/panier/"><span>Panier</span><span class="cart-count">0</span></a></nav></div>
    <nav class="nav-mobile" aria-label="Traditions">${RELIGIONS.map(link).join('')}</nav>`;
  document.body.prepend(head);
  const foot = document.createElement('footer');
  foot.className = 'site-foot';
  foot.innerHTML = `<div class="wrap">
    <div><div class="brand">Artaluz <small>— des décors pour célébrer</small></div>
      <p style="margin-top:12px">Art sacré imprimé à la commande dans notre atelier de Stains (93) : bâches, stickers, magnets, posters et tableaux en aluminium. Livraison offerte dès 75 € d'achat.</p></div>
    <div>${RELIGIONS.map(r => `<a href="/religion/${r.id}">${esc(r.name)}</a>`).join('')}</div>
    <div><a href="/artistes/">Proposer vos créations</a><a href="/cgv/">Conditions de vente</a><a href="/mentions-legales/">Mentions légales</a><a href="mailto:contact@artaluz.com">contact@artaluz.com</a></div></div>`;
  document.body.append(foot);
  renderCartCount();
}
