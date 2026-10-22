import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, BUCKETS } from '../config.js';

let client;
function getClient() {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

export const db = new Proxy(
  {},
  {
    get(_, prop) {
      const c = getClient();
      const v = c[prop];
      return typeof v === 'function' ? v.bind(c) : v;
    },
  },
);

export async function getActiveVersion() {
  const { data, error } = await db.from('versions').select('*').eq('is_active', true).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function getActiveProducts() {
  const { data, error } = await db.from('active_products').select('*');
  if (error) throw new Error(error.message);
  return data;
}

export async function getVersions() {
  const { data, error } = await db.from('versions').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function publishVersionRow(id) {
  const { error } = await db.rpc('publish_version', { p_version_id: id });
  if (error) throw new Error(error.message);
}

export async function updateSettlementPrice(fsn, settlementPrice) {
  const { data: version, error: vErr } = await db
    .from('versions')
    .select('id')
    .eq('is_active', true)
    .maybeSingle();
  if (vErr) throw new Error(vErr.message);
  if (!version) throw new Error('No active version');
  const { data, error } = await db
    .from('products')
    .update({ settlement_price: settlementPrice })
    .eq('version_id', version.id)
    .eq('fsn', fsn)
    .select('fsn');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error(`FSN ${fsn} not found in the active version`);
}

export async function uploadRawFile(versionId, name, file) {
  const path = `${versionId}/${name}`;
  const { error } = await db.storage
    .from(BUCKETS.rawUploads)
    .upload(path, file, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if (error) throw new Error(error.message);
  return path;
}

export async function saveAndPublish({ versionId, catalogPath, listingsPath, catalogRows, listingsRows, report, note, products }) {
  const { error: vErr } = await db.from('versions').insert({
    id: versionId,
    is_active: false,
    catalog_path: catalogPath,
    listings_path: listingsPath,
    catalog_rows: catalogRows,
    listings_rows: listingsRows,
    quality_report: report,
    note: note || null,
  });
  if (vErr) throw new Error(vErr.message);

  const chunk = 200;
  for (let i = 0; i < products.length; i += chunk) {
    const rows = products.slice(i, i + chunk).map((p) => ({ ...p, version_id: versionId }));
    const { error } = await db.from('products').insert(rows);
    if (error) throw new Error(error.message);
  }

  await publishVersionRow(versionId);
}

export async function cleanupVersion(versionId, uploadedPaths) {
  await db.from('versions').delete().eq('id', versionId);
  if (uploadedPaths.length) {
    await db.storage.from(BUCKETS.rawUploads).remove(uploadedPaths);
  }
}
