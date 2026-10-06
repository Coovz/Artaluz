// Accès Postgres (Supabase) via le pooler — source de vérité des commandes.
const { Pool, types } = require('pg');

// Les colonnes DATE restent des chaînes 'AAAA-MM-JJ' (pas de décalage de fuseau horaire)
types.setTypeParser(1082, v => v);
const config = require('./config');

if (!config.databaseUrl) console.warn('[db] DATABASE_URL manquante — l\'API ne pourra pas fonctionner');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: /supabase\.(co|com)/.test(config.databaseUrl) ? { rejectUnauthorized: false } : false,
  max: 10,
  connectionTimeoutMillis: 10000,   // une base injoignable renvoie une erreur au lieu de bloquer
  query_timeout: 30000,
});

const query = (text, params) => pool.query(text, params);

// Diagnostic au démarrage, sans jamais afficher le mot de passe
if (config.databaseUrl) {
  let host = '?';
  try { const u = new URL(config.databaseUrl); host = `${u.hostname}:${u.port || 5432}`; } catch { host = 'adresse illisible'; }
  pool.query('select 1')
    .then(() => console.log(`[db] connexion OK (${host})`))
    .catch(e => console.error(`[db] connexion IMPOSSIBLE vers ${host} : ${e.message}`));
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };
