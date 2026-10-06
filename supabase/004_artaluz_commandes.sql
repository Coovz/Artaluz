-- ============================================================
-- ARTALUZ — Compléments commandes : numérotation des factures,
-- détail des finitions par ligne, suivi des fichiers HD.
-- ============================================================

create table if not exists public.invoice_counters (
  brand  text not null references public.brands(id),
  year   integer not null,
  last   integer not null default 0,
  primary key (brand, year)
);
alter table public.invoice_counters enable row level security;

-- Numéro de facture séquentiel par marque et par année : FA-2026-00001
create or replace function public.next_invoice_number(p_brand text)
returns text language plpgsql as $$
declare y integer := extract(year from now()); n integer;
begin
  insert into public.invoice_counters (brand, year, last) values (p_brand, y, 1)
  on conflict (brand, year) do update set last = public.invoice_counters.last + 1
  returning last into n;
  return 'FA-' || y || '-' || lpad(n::text, 5, '0');
end $$;

alter table public.orders      add column if not exists amount_discount integer not null default 0;
alter table public.orders      add column if not exists promo_code text;
alter table public.orders      add column if not exists production_email_sent_at timestamptz;
alter table public.order_items add column if not exists finishes jsonb not null default '[]';  -- [{id,name,price_ht}]
alter table public.order_items add column if not exists hd_status text not null default 'a_generer'
  check (hd_status in ('a_generer','pret','erreur'));
alter table public.order_items add column if not exists position integer not null default 0;  -- ordre des lignes
