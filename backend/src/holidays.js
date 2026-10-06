// Calendrier des fêtes, calculé hors ligne avec les calendriers ICU de Node.js :
// hébraïque (exact), hégirien Umm al-Qura (±1 jour selon l'observation lunaire locale),
// lunaire chinois (fêtes bouddhistes d'Asie de l'Est), grégorien (comput de Pâques).
// Les dates saisies à la main dans le back office (source = 'manual') ne sont jamais écrasées.
const db = require('./db');

const DAY = 86400000;
const iso = d => d.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const addDays = (d, n) => new Date(d.getTime() + n * DAY);

const fmt = (cal, opts) => new Intl.DateTimeFormat(`en-u-ca-${cal}`, { timeZone: 'UTC', ...opts });
const HEB = fmt('hebrew', { day: 'numeric', month: 'long' });
const HIJ = fmt('islamic-umalqura', { day: 'numeric', month: 'numeric' });
const CHN = fmt('chinese', { day: 'numeric', month: 'numeric' });
const parts = (f, d) => Object.fromEntries(f.formatToParts(d).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));

// Fêtes à date fixe dans un calendrier non grégorien : [occasion, calendrier, mois, jour, durée en jours, approximatif]
const LUNAR = [
  ['roch-hachana', 'heb', 'Tishri', 1, 2, false],
  ['yom-kippour', 'heb', 'Tishri', 10, 1, false],
  ['soukkot', 'heb', 'Tishri', 15, 7, false],
  ['hanoucca', 'heb', 'Kislev', 25, 8, false],
  ['pourim', 'heb', ['Adar', 'Adar II'], 14, 1, false],
  ['pessah', 'heb', 'Nisan', 15, 8, false],
  ['chavouot', 'heb', 'Sivan', 6, 2, false],
  ['ramadan', 'hij', '9', 1, 30, true],
  ['aid-al-fitr', 'hij', '10', 1, 3, true],
  ['aid-al-adha', 'hij', '12', 10, 4, true],
  ['nouvel-an-hegire', 'hij', '1', 1, 1, true],
  ['mawlid', 'hij', '3', 12, 1, true],
  ['nouvel-an-lunaire', 'chn', '1', 1, 15, true],  // ICU peut décaler d'un jour quand la nouvelle lune tombe vers minuit à Pékin
  ['vesak', 'chn', '4', 15, 1, true],      // pleine lune de Vesakha ; la date varie selon les pays
  ['ulambana', 'chn', '7', 15, 1, false],
];

function easter(y) { // algorithme de Meeus/Jones/Butcher
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
    f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(y, month, day);
}

function gregorian(y) {
  const e = easter(y);
  return [
    ['avent-noel', utc(y, 12, 25), 1], ['noel-prot', utc(y, 12, 25), 1],
    ['epiphanie', utc(y, 1, 6), 1],
    ['careme-paques', e, 1], ['paques-prot', addDays(e, -2), 3],
    ['pentecote', addDays(e, 49), 2], ['pentecote-prot', addDays(e, 49), 2],
    ['assomption', utc(y, 8, 15), 1], ['toussaint', utc(y, 11, 1), 1],
    ['reformation', utc(y, 10, 31), 1],
  ];
}

/** Toutes les fêtes entre `from` et `to` (dates UTC) */
function compute(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const h = parts(HEB, d), i = parts(HIJ, d), c = parts(CHN, d);
    for (const [occ, cal, month, day, len, approx] of LUNAR) {
      const p = cal === 'heb' ? h : cal === 'hij' ? i : c;
      const months = Array.isArray(month) ? month : [month];
      // Pourim : 14 Adar, ou 14 Adar II les années embolismiques (pas Adar I)
      if (Number(p.day) === day && months.includes(p.month)) {
        out.push({ occasion: occ, start: iso(d), end: iso(addDays(d, len - 1)), approximate: approx, source: 'icu' });
      }
    }
  }
  for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
    for (const [occ, d, len] of gregorian(y)) {
      if (d >= from && d <= to) out.push({ occasion: occ, start: iso(d), end: iso(addDays(d, len - 1)), approximate: false, source: 'computus' });
    }
  }
  return out;
}

async function refresh({ monthsAhead = 24 } = {}) {
  const now = new Date();
  const from = utc(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const to = addDays(from, monthsAhead * 31);
  const list = compute(from, to);
  const { rows } = await db.query('select id from occasions');
  const known = new Set(rows.map(r => r.id));
  let n = 0;
  for (const h of list) {
    if (!known.has(h.occasion)) continue;
    const { rowCount } = await db.query(
      `insert into holidays (occasion_id, starts_on, ends_on, approximate, source)
       select $1,$2,$3,$4,$5 where not exists (
         select 1 from holidays where occasion_id = $1 and source = 'manual'
           and starts_on between ($2::date - 40) and ($2::date + 40))
       on conflict (occasion_id, starts_on) do nothing`,
      [h.occasion, h.start, h.end, h.approximate, h.source]);
    n += rowCount;
  }
  return n;
}

module.exports = { compute, refresh, easter };
