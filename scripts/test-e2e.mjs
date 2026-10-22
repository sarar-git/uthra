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
  updateSettlementPrice,
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

const pre = await db.from('versions').select('id, is_active');
const preexisting = pre.data ?? [];
console.log(`pre-existing versions: ${preexisting.length}`);

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

console.log('\n--- settlement edit on active version ---');
const editFsn = productsV2[0].fsn;
const originalSettlement = productsV2[0].settlement_price;
await updateSettlementPrice(editFsn, 999);
const afterEdit = await getActiveProducts();
check('settlement updated in DB', afterEdit.find((p) => p.fsn === editFsn)?.settlement_price === 999);

console.log('\n--- rollback to v1 ---');
await publishVersionRow(v1.versionId);
const rolledBack = await getActiveVersion();
check('v1 active again after rollback', rolledBack?.id === v1.versionId);
const rolledBackProducts = await getActiveProducts();
check(
  'v1 shows original settlement (edit lives on v2 only)',
  rolledBackProducts.find((p) => p.fsn === editFsn)?.settlement_price === originalSettlement,
  `got ${rolledBackProducts.find((p) => p.fsn === editFsn)?.settlement_price}, expected ${originalSettlement}`,
);

console.log('\n--- forward to v2 again ---');
await publishVersionRow(v2.versionId);
const forward = await getActiveVersion();
check('v2 active again', forward?.id === v2.versionId);
const forwardProducts = await getActiveProducts();
check(
  'edit persisted on v2 row (direct-edit semantics)',
  forwardProducts.find((p) => p.fsn === editFsn)?.settlement_price === 999,
);

console.log('\n--- failed publish leaves nothing behind ---');
const badAnalysis = runAnalysis([]);
badAnalysis.products[0] = { ...badAnalysis.products[0], status: 'bogus' };
const vBad = crypto.randomUUID();
const uploadedBad = [];
let threw = false;
try {
  const cp = await uploadRawFile(vBad, 'catalog.xlsx', new Blob([catalogBuf]));
  uploadedBad.push(cp);
  const lp = await uploadRawFile(vBad, 'listings.xlsx', new Blob([listingsBuf]));
  uploadedBad.push(lp);
  await saveAndPublish({
    versionId: vBad,
    catalogPath: cp,
    listingsPath: lp,
    catalogRows: badAnalysis.report.catalogRows,
    listingsRows: badAnalysis.report.listingsRows,
    report: badAnalysis.report,
    note: 'e2e-fail',
    products: badAnalysis.products,
  });
} catch {
  threw = true;
}
check('bad publish rejected', threw);
await cleanupVersion(vBad, uploadedBad);
const afterFail = await db.from('versions').select('id');
const afterFailIds = (afterFail.data ?? []).map((v) => v.id);
check(
  'failed version removed, real versions untouched',
  !afterFail.error && afterFailIds.includes(v1.versionId) && afterFailIds.includes(v2.versionId) && !afterFailIds.includes(vBad),
  `left: ${JSON.stringify(afterFailIds)}`,
);

console.log('\n--- cleanup (preserving pre-existing versions) ---');
await cleanupVersion(v2.versionId, v2.uploaded);
await cleanupVersion(v1.versionId, v1.uploaded);
if (preexisting.length) {
  const byCreated = await db.from('versions').select('id, created_at').neq('id', v1.versionId).neq('id', v2.versionId).order('created_at', { ascending: false });
  if (byCreated.data?.length) await publishVersionRow(byCreated.data[0].id);
}
const finalVersions = await db.from('versions').select('id, is_active');
const finalIds = (finalVersions.data ?? []).map((v) => v.id);
check(
  'all test versions removed',
  !finalVersions.error && !finalIds.includes(v1.versionId) && !finalIds.includes(v2.versionId),
  `left: ${JSON.stringify(finalIds)}`,
);
if (preexisting.length) {
  check('a pre-existing version is active again', (finalVersions.data ?? []).some((v) => v.is_active));
} else {
  check('no active products left', (finalVersions.data ?? []).length === 0, `left: ${finalVersions.data?.length}`);
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL E2E CHECKS PASSED');
process.exit(failures ? 1 : 0);
