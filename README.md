# Artaluz — artaluz.com

Boutique d'art religieux imprimé (bâches, stickers, magnets, posters, tableaux alu) pour l'islam, le judaïsme, le catholicisme, le protestantisme et le bouddhisme. Même architecture que Stickrz : site statique sur Netlify, API Node.js sur Railway, Supabase, Stripe, Resend.

```
site/        Site public + back office (/admin/) — Netlify, sans étape de build
backend/     API Express — Railway (service dédié « artaluz-api »)
supabase/    Scripts SQL à exécuter dans l'ordre (001 → 004)
scripts/     build_seed.py : régénère le catalogue depuis la grille tarifaire Excel
data/        Grille tarifaire de référence
```

## Mise en ligne (environ 1 heure)

### 1. Supabase (même projet que Stickrz)
1. SQL Editor : exécuter `001_artaluz_schema.sql`, `002_artaluz_seed.sql`, `003_artaluz_taxonomie.sql`, `004_artaluz_commandes.sql`, dans cet ordre. Ils s'ajoutent au schéma Iota existant sans le modifier (seulement deux colonnes ajoutées à `order_items` et trois à `orders`).
2. Storage : créer deux buckets.
   - `artaluz-private` : **privé** (originaux des artistes, fichiers HD, bons de fabrication).
   - `artaluz-public` : **public** (aperçus filigranés).
3. Settings > Database : copier la chaîne de connexion du **pooler** (mode transaction, port 6543) pour `DATABASE_URL`.

### 2. Railway
1. Nouveau service depuis le dépôt GitHub, dossier racine `backend`, commande `npm start`.
2. Variables : voir `backend/.env.example`.
3. Domaine : `api.artaluz.com`.

### 3. Stripe
Webhook vers `https://api.artaluz.com/api/stripe-webhook`, événements :
`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`. Copier le secret `whsec_…` dans `STRIPE_WEBHOOK_SECRET`.

### 4. Resend
Ajouter et vérifier le domaine `artaluz.com` (enregistrements DNS), puis expéditeur `commandes@artaluz.com`.

### 5. Netlify
1. Nouveau site depuis le dépôt : base directory `site`, publish directory `site`, pas de commande de build.
2. Dans `site/assets/config.js`, vérifier `ARTALUZ_API = 'https://api.artaluz.com'`.
3. Domaine `artaluz.com` + `www`.
4. Logo : `site/assets/logo.png` (en-tête) et `site/assets/logo-full.png` (avec la signature), déjà intégrés.

### 6. Premiers visuels
`https://artaluz.com/admin/` → mot de passe `ADMIN_PASSWORD` → onglet Visuels. Formats acceptés : PDF HD (page 1, considéré vectoriel ; le PDF d'origine est aussi envoyé à l'atelier), JPEG, PNG, TIFF, WebP. Chaque image est contrôlée (1 000 px minimum), un aperçu filigrané est créé et seuls les formats imprimables à au moins 70 % de la résolution cible sont proposés à la vente.

## Fonctionnement d'une commande
1. Le navigateur envoie le panier ; **l'API recalcule tous les prix** depuis la base (aucun prix du navigateur n'est utilisé), vérifie les minimums (5 pour le sticker de 5 cm) et applique la livraison offerte dès 75 € TTC.
2. La commande est créée « en attente », puis le client paie sur Stripe Checkout (carte).
3. Le webhook Stripe enregistre le paiement (numéro de facture `FA-AAAA-00001`, royalties) **avant** de répondre ; si la base est indisponible, Stripe renvoie l'événement.
4. Pour chaque ligne : fichier HD TIFF au format final (fonds perdus inclus, 100 dpi bâche / 150 dpi autres), déposé dans `artaluz-private/hd/<commande>/`.
5. Email atelier (`PRODUCTION_EMAIL`) : bon de fabrication PDF en pièce jointe (une page par ligne, code-barres) + un lien de téléchargement HD par ligne, valable 30 jours. Puis email de confirmation au client.
6. Si l'email atelier n'est pas parti (panne), il est relancé au redémarrage de l'API, ou via « Renvoyer à l'atelier » dans le back office. Un montant payé différent du montant attendu bloque la production et l'indique dans les notes de la commande.

## Règles métier en place
| Règle | Où |
|---|---|
| Prix TTC arrondis au ,99 (sticker 5 cm : 0,49 €) | `data/grille_tarifaire.xlsx` → `scripts/build_seed.py` |
| Royalties 10 % du HT avant remise, hors port, **hors finitions**, artistes externes uniquement | `backend/src/pricing.js`, `orders.js` |
| Livraison offerte dès 75 € TTC (après remise) ; sinon forfait provisoire 6,90 € | `FREE_SHIPPING_THRESHOLD_CENTS`, `SHIPPING_FLAT_CENTS` |
| Codes promo à usage unique réservés dès la création de la commande | `orders.js` |
| « Commander avant le … » = date de la fête − 8 jours | `site/assets/config.js` (`ARTALUZ_LEAD_DAYS`) |
| Fonds perdus : 0 mm bâche, 3 mm poster/alu, 2 mm sticker/magnet | `backend/src/production.js` (`PRINT_SPECS`) |

## Calendrier des fêtes
Calculé par l'API, sans service externe, à chaque démarrage puis chaque jour, sur 24 mois : calendrier hébraïque (exact), hégirien Umm al-Qura (marqué ±1 jour), lunaire chinois (marqué approximatif), comput de Pâques. Une date saisie à la main (`source = 'manual'` dans `holidays`) n'est jamais écrasée. Le Losar n'est pas calculé : à saisir à la main.

## Mettre à jour les prix
```
python3 scripts/build_seed.py data/grille_tarifaire.xlsx supabase/002_artaluz_seed.sql
```
puis exécuter `002_artaluz_seed.sql` dans Supabase. La grille doit garder les colonnes `Réf`, `Support`, `Format`, `Largeur (cm)`, `Hauteur (cm)`, `PRHT`, `Prix TTC final (€)`, `Qté minimum`.

## Reste à faire (lots 3 et 4, après l'ouverture)
Portail artistes (inscription, contrat, dépôt), relevés bimensuels et versements, comptes clients, multilingue (EN, DE, ES), grille de frais de port sous 75 €, pages CGV / mentions légales / « Proposer vos créations », découpe à la forme des stickers (moteur Stickrz).
