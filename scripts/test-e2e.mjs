import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { parseSheet } from '../src/lib/parse.js';
import { analyze } from '../src/lib/build.js';
import {
  db,
  getActiveProducts,
  getActiveVersion,
  uploadRawFile,
  saveAndPublish,
  publishVersionRow,
  cleanupVersion,
} from '../src/lib/db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const catalogBuf = fs.readFileSync(path.join(root, 'samples/uthra_catalog.xlsx'));
const listingsBuf = fs.readFileSync(path.join(root, 'samples/uthra_flipkart_pricing.xlsx'));

function runAnalysis(previous) {
  const catalog = parseSheet(catalogBuf);
  const listings = parseSheet(listingsBuf);
  return analyze({
    catalogHeaders: catalog.headers,
    catalogRows: catalog.rows,
    listingsHeaders: listings.headers,
    listingsRows: listings.rows,
    previous,
  });
}

async function publishTestVersion(previous, note) {
  const analysis = runAnalysis(previous);
  const versionId = crypto.randomUUID();
  const uploaded = [];
  try {
    const catalogPath = await uploadRawFile(versionId, 'catalog.xlsx', new Blob([catalogBuf]));
    uploaded.push(catalogPath);
    const listingsPath = await uploadRawFile(versionId, 'listings.xlsx', new Blob([listingsBuf]));
    uploaded.push(listingsPath);
    await saveAndPublish({
      versionId,
      catalogPath,
      listingsPath,
      catalogRows: analysis.report.catalogRows,
      listingsRows: analysis.report.listingsRows,
      report: analysis.report,
      note,
      products: analysis.products,
    });
    return { versionId, uploaded, analysis };
  } catch (e) {
    await cleanupVersion(versionId, uploaded).catch(() => {});
    throw e;
  }
}

const preActive = await getActiveVersion();
check('clean slate (no active version)', preActive === null, preActive?.id);

console.log('\n--- publish v1 (fresh) ---');
const v1 = await publishTestVersion([], 'e2e-v1');
const afterV1 = await getActiveVersion();
const productsV1 = await getActiveProducts();
check('v1 is active', afterV1?.id === v1.versionId);
check('147 active products', productsV1.length === 147, `got ${productsV1.length}`);
check('all new', productsV1.every((p) => p.status === 'new'));

console.log('\n--- raw files uploaded ---');
const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const adminList = await admin.storage.from('raw-uploads').list(v1.versionId);
check('raw files in storage for v1', !adminList.error && adminList.data?.length === 2, JSON.stringify(adminList.data?.map((f) => f.name)));

console.log('\n--- publish v2 (re-upload: all existing) ---');
const v2 = await publishTestVersion(productsV1, 'e2e-v2');
const afterV2 = await getActiveVersion();
const productsV2 = await getActiveProducts();
check('v2 is active', afterV2?.id === v2.versionId);
check('147 products, all existing', productsV2.length === 147 && productsV2.every((p) => p.status === 'existing'));

console.log('\n--- rollback to v1 ---');
await publishVersionRow(v1.versionId);
const rolledBack = await getActiveVersion();
check('v1 active again after rollback', rolledBack?.id === v1.versionId);

console.log('\n--- forward to v2 again ---');
await publishVersionRow(v2.versionId);
const forward = await getActiveVersion();
check('v2 active again', forward?.id === v2.versionId);

console.log('\n--- cleanup ---');
await cleanupVersion(v2.versionId, v2.uploaded);
await cleanupVersion(v1.versionId, v1.uploaded);
const finalVersions = await db.from('versions').select('id');
const finalProducts = await db.from('active_products').select('fsn');
check('all test versions removed', !finalVersions.error && finalVersions.data.length === 0, `left: ${finalVersions.data.length}`);
check('no active products left', !finalProducts.error && finalProducts.data.length === 0, `left: ${finalProducts.data.length}`);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL E2E CHECKS PASSED');
process.exit(failures ? 1 : 0);
