// Accès Postgres (Supabase) via le pooler — source de vérité des commandes.
const { Pool } = require('pg');
const config = require('./config');

if (!config.databaseUrl) console.warn('[db] DATABASE_URL manquante — l\'API ne pourra pas fonctionner');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: /supabase\.(co|com)/.test(config.databaseUrl) ? { rejectUnauthorized: false } : false,
  max: 10,
});

const query = (text, params) => pool.query(text, params);

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
