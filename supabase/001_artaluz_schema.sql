-- ============================================================
-- ARTALUZ — Extension du schéma multi-marques Iota System
-- Prérequis : supabase-schema-iota.sql déjà appliqué (brands, customers,
-- orders, order_items, promo_codes, promo_usage).
-- À coller dans Supabase : SQL Editor > New query > Run
-- ============================================================

insert into public.brands (id, name, domain) values ('artaluz', 'Artaluz', 'artaluz.com')
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 1. TAXONOMIE : religion > fête/événement > figure
-- ------------------------------------------------------------
create table public.religions (
  id          text primary key,                -- 'islam', 'judaisme', 'catholicisme', 'protestantisme', 'bouddhisme'
  name        text not null,
  calendar    text not null check (calendar in ('hijri','hebrew','gregorian','lunisolar')),
  figure_label text not null,                  -- 'Saints', 'Prophètes', 'Bodhisattvas'...
  sort_order  integer not null default 0,
  active      boolean not null default true
);

create table public.occasions (
  id          text primary key,                -- 'ramadan', 'hanoucca', 'noel'...
  religion_id text not null references public.religions(id),
  name        text not null,
  kind        text not null default 'fete' check (kind in ('fete','evenement_de_vie','periode')),
  description text,
  sort_order  integer not null default 0,
  active      boolean not null default true
);
create index idx_occasions_religion on public.occasions(religion_id);

create table public.figures (
  id          text primary key,                -- 'saint-joseph', 'moise'...
  religion_id text not null references public.religions(id),
  name        text not null,
  feast_month integer check (feast_month between 1 and 12),  -- fête fixe (calendrier grégorien), si applicable
  feast_day   integer check (feast_day between 1 and 31),
  description text,
  active      boolean not null default true
);
create index idx_figures_religion on public.figures(religion_id);

-- Dates calculées des fêtes (remplies par la tâche planifiée annuelle)
create table public.holidays (
  id           uuid primary key default gen_random_uuid(),
  occasion_id  text not null references public.occasions(id) on delete cascade,
  starts_on    date not null,
  ends_on      date,
  approximate  boolean not null default false, -- true = ±1 jour (observation lunaire)
  source       text not null default 'auto',   -- 'hebcal', 'aladhan', 'computus', 'manual'
  unique (occasion_id, starts_on)
);
create index idx_holidays_date on public.holidays(starts_on);

-- ------------------------------------------------------------
-- 2. CATALOGUE : supports, formats, prix (issus de la grille tarifaire)
-- ------------------------------------------------------------
create table public.products (
  ref            text primary key,             -- 'BAC-01', 'STK-07'...
  brand          text not null default 'artaluz' references public.brands(id),
  support        text not null check (support in ('bache','sticker','magnet','poster','alu')),
  variant        text not null,                -- 'Bâche qualité éco', 'Sticker mat'...
  format_label   text not null,                -- '100 × 50 cm'
  width_cm       numeric(6,1) not null,
  height_cm      numeric(6,1) not null,
  price_ttc      integer not null,             -- centimes, prix final affiché (arrondi ,99)
  cost_ht        integer,                      -- centimes, PRHT (interne, jamais exposé)
  min_qty        integer not null default 1,
  sort_order     integer not null default 0,
  active         boolean not null default true
);

create table public.finishes (
  id            uuid primary key default gen_random_uuid(),
  support       text not null,
  name          text not null,                 -- 'Œillets', 'Cadre aluminium noir'...
  detail        text,                          -- 'Oeuillets aluminium'
  product_ref   text references public.products(ref),  -- NULL = valable pour tous les formats du support
  price_ht      integer not null default 0,    -- centimes
  supplier_ref  text,                          -- référence fournisseur (ex. frame.board_châssis.15)
  active        boolean not null default true
);

-- ------------------------------------------------------------
-- 3. ARTISTES ET VISUELS
-- ------------------------------------------------------------
create table public.artists (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid unique references auth.users(id) on delete set null,
  email          text not null unique,
  display_name   text not null,
  country        text default 'FR',
  bio            text,
  portfolio_url  text,
  tax_status     text check (tax_status in ('artiste_auteur_fr','societe','etranger','interne')),
  siret          text,
  iban_encrypted text,                         -- chiffré côté backend, jamais exposé au front
  contract_signed_at timestamptz,
  status         text not null default 'candidat' check (status in ('candidat','actif','suspendu','refuse')),
  is_internal    boolean not null default false, -- true = créations Iota System (pas de royalties)
  created_at     timestamptz not null default now()
);

create table public.artworks (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  artist_id       uuid not null references public.artists(id),
  title           text not null,
  description     text,
  original_path   text not null,               -- Storage privé : 'originals/<artist>/<file>'
  preview_path    text,                        -- Storage public filigrané
  width_px        integer not null,
  height_px       integer not null,
  ratio           numeric(6,4) generated always as (width_px::numeric / height_px) stored,
  supports        text[] not null default array['bache','sticker','magnet','poster','alu'],
  status          text not null default 'en_attente'
                  check (status in ('en_attente','accepte','a_corriger','refuse','retire')),
  moderation_note text,
  featured        boolean not null default false,
  tags            text[] not null default '{}',
  created_at      timestamptz not null default now(),
  published_at    timestamptz
);
create index idx_artworks_status on public.artworks(status);

create table public.artwork_tags (
  artwork_id  uuid not null references public.artworks(id) on delete cascade,
  religion_id text not null references public.religions(id),
  occasion_id text references public.occasions(id),
  figure_id   text references public.figures(id)
);
create index idx_atags_artwork  on public.artwork_tags(artwork_id);
create index idx_atags_religion on public.artwork_tags(religion_id);
create index idx_atags_occasion on public.artwork_tags(occasion_id);
create index idx_atags_figure   on public.artwork_tags(figure_id);

-- ------------------------------------------------------------
-- 4. LIENS COMMANDE -> VISUEL, ROYALTIES, RELEVÉS
-- ------------------------------------------------------------
alter table public.order_items add column if not exists artwork_id  uuid references public.artworks(id);
alter table public.order_items add column if not exists product_ref text references public.products(ref);

create table public.payouts (
  id            uuid primary key default gen_random_uuid(),
  artist_id     uuid not null references public.artists(id),
  period_start  date not null,
  period_end    date not null,
  amount        integer not null,              -- centimes
  statement_path text,                         -- PDF du relevé dans Storage
  status        text not null default 'emis' check (status in ('emis','paye','reporte')),
  paid_at       timestamptz,
  created_at    timestamptz not null default now(),
  unique (artist_id, period_start)
);

create table public.royalties (
  id             uuid primary key default gen_random_uuid(),
  order_item_id  uuid not null unique references public.order_items(id) on delete cascade,
  artist_id      uuid not null references public.artists(id),
  base_ht        integer not null,             -- centimes : prix HT avant remise, hors port
  rate           numeric(4,3) not null default 0.100,
  amount         integer not null,             -- centimes
  status         text not null default 'en_attente'
                 check (status in ('en_attente','acquise','versee','annulee')),
  payout_id      uuid references public.payouts(id),
  created_at     timestamptz not null default now()
);
create index idx_royalties_artist on public.royalties(artist_id, status);

-- ------------------------------------------------------------
-- 5. SÉCURITÉ (RLS)
-- Lecture publique : catalogue publié uniquement. Tout le reste passe
-- par le backend (clé service_role).
-- ------------------------------------------------------------
alter table public.religions    enable row level security;
alter table public.occasions    enable row level security;
alter table public.figures      enable row level security;
alter table public.holidays     enable row level security;
alter table public.products     enable row level security;
alter table public.finishes     enable row level security;
alter table public.artists      enable row level security;
alter table public.artworks     enable row level security;
alter table public.artwork_tags enable row level security;
alter table public.royalties    enable row level security;
alter table public.payouts      enable row level security;

create policy "public religions" on public.religions for select using (active);
create policy "public occasions" on public.occasions for select using (active);
create policy "public figures"   on public.figures   for select using (active);
create policy "public holidays"  on public.holidays  for select using (true);
create policy "public finishes"  on public.finishes  for select using (active);
create policy "public artworks"  on public.artworks  for select using (status = 'accepte');
create policy "public atags"     on public.artwork_tags for select using (
  exists (select 1 from public.artworks a where a.id = artwork_id and a.status = 'accepte'));

-- products : pas de policy publique (cost_ht est confidentiel) ; exposé via la vue ci-dessous
create view public.products_public with (security_invoker = false) as
  select ref, support, variant, format_label, width_cm, height_cm, price_ttc, min_qty, sort_order
  from public.products where active and brand = 'artaluz';
grant select on public.products_public to anon, authenticated;

-- Artistes : chacun voit sa fiche, ses visuels, ses royalties et relevés
create policy "artist own profile"   on public.artists   for select using (user_id = auth.uid());
create policy "artist own artworks"  on public.artworks  for select using (
  artist_id in (select id from public.artists where user_id = auth.uid()));
create policy "artist own royalties" on public.royalties for select using (
  artist_id in (select id from public.artists where user_id = auth.uid()));
create policy "artist own payouts"   on public.payouts   for select using (
  artist_id in (select id from public.artists where user_id = auth.uid()));
