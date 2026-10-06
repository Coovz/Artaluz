// Configuration centrale — toutes les valeurs viennent des variables d'environnement Railway.
require('dotenv').config();

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

module.exports = {
  port: Number(env('PORT', 3002)),
  brand: 'artaluz',
  frontendUrl: env('FRONTEND_URL', 'http://localhost:8080'),
  databaseUrl: env('DATABASE_URL', ''),           // chaîne de connexion Postgres Supabase (Settings > Database)
  supabaseUrl: env('SUPABASE_URL', ''),
  supabaseServiceKey: env('SUPABASE_SERVICE_ROLE_KEY', ''),
  storageBucketPrivate: env('STORAGE_BUCKET_PRIVATE', 'artaluz-private'),  // originaux + fichiers HD
  storageBucketPublic: env('STORAGE_BUCKET_PUBLIC', 'artaluz-public'),     // aperçus filigranés
  localStorageDir: env('LOCAL_STORAGE_DIR', ''),  // dev uniquement : stockage disque au lieu de Supabase
  stripeSecretKey: env('STRIPE_SECRET_KEY', ''),
  stripeWebhookSecret: env('STRIPE_WEBHOOK_SECRET', ''),
  resendApiKey: env('RESEND_API_KEY', ''),
  fromEmail: env('FROM_EMAIL', 'Artaluz <commandes@artaluz.com>'),
  productionEmail: env('PRODUCTION_EMAIL', 'iotaprint@iotasystem.com'),
  adminPassword: env('ADMIN_PASSWORD', ''),
  vatRate: Number(env('VAT_RATE', 0.20)),
  // Livraison offerte dès 75 € TTC (décision du 6/10/2026). En dessous : forfait provisoire,
  // à remplacer par la grille de frais de port à venir.
  freeShippingThreshold: Number(env('FREE_SHIPPING_THRESHOLD_CENTS', 7500)),
  shippingFlat: Number(env('SHIPPING_FLAT_CENTS', 690)),
  royaltyRate: Number(env('ROYALTY_RATE', 0.10)),
  hdLinkDays: Number(env('HD_LINK_DAYS', 30)),
  merchant: {
    name: 'Iota System',
    siret: '883 710 519 00025',
    address: '83 avenue Aristide Briand, Lot 10',
    zip: '93240',
    city: 'Stains',
    country: 'France',
    email: 'contact@artaluz.com',
    site: 'artaluz.com',
  },
};
