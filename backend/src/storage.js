// Stockage des fichiers : Supabase Storage en production, disque local en développement.
const fs = require('fs/promises');
const path = require('path');
const config = require('./config');

let sb = null;
if (!config.localStorageDir && config.supabaseUrl && config.supabaseServiceKey) {
  // Node < 22 n'a pas de WebSocket natif, exigé au démarrage par supabase-js (même sans temps réel)
  if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = require('ws');
  const { createClient } = require('@supabase/supabase-js');
  sb = createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const local = (bucket, p) => path.join(config.localStorageDir, bucket, p);

async function upload(bucket, p, buffer, contentType) {
  if (sb) {
    const { error } = await sb.storage.from(bucket).upload(p, buffer, { contentType, upsert: true });
    if (error) throw new Error(`[storage] upload ${p}: ${error.message}`);
    return p;
  }
  await fs.mkdir(path.dirname(local(bucket, p)), { recursive: true });
  await fs.writeFile(local(bucket, p), buffer);
  return p;
}

async function download(bucket, p) {
  if (sb) {
    const { data, error } = await sb.storage.from(bucket).download(p);
    if (error) throw new Error(`[storage] download ${p}: ${error.message}`);
    return Buffer.from(await data.arrayBuffer());
  }
  return fs.readFile(local(bucket, p));
}

// Lien de téléchargement signé (expire après `days` jours)
async function signedUrl(bucket, p, days, downloadName) {
  if (sb) {
    const { data, error } = await sb.storage.from(bucket)
      .createSignedUrl(p, days * 86400, downloadName ? { download: downloadName } : undefined);
    if (error) throw new Error(`[storage] signedUrl ${p}: ${error.message}`);
    return data.signedUrl;
  }
  return `file://${local(bucket, p)}`;
}

function publicUrl(bucket, p) {
  if (!p) return null;
  if (sb) return sb.storage.from(bucket).getPublicUrl(p).data.publicUrl;
  return `${process.env.PUBLIC_API_URL || ''}/local-storage/${bucket}/${p}`;
}

module.exports = { upload, download, signedUrl, publicUrl };
