import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { parseSheet } from '../src/lib/parse.js';
import { analyze } from '../src/lib/build.js';
import {
  db,
  getActiveProducts,
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const catalogBuf = fs.readFileSync(path.join(root, 'samples/uthra_catalog.xlsx'));
const listingsBuf = fs.readFileSync(path.join(root, 'samples/uthra_flipkart_pricing.xlsx'));

const catalog = parseSheet(catalogBuf);
const listings = parseSheet(listingsBuf);
const analysis = analyze({
  catalogHeaders: catalog.headers,
  catalogRows: catalog.rows,
  listingsHeaders: listings.headers,
  listingsRows: listings.rows,
  previous: [],
});

console.log('--- publish a version to mirror ---');
const preProducts = await getActiveProducts();
const prePaths = new Map(preProducts.map((p) => [p.fsn, new Set(p.image_paths ?? [])]));
const versionId = crypto.randomUUID();
const uploaded = [];
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
  note: 'phase6-mirror-test',
  products: analysis.products,
});
check('version published', true);

console.log('\n--- invoke mirror-images ---');
const { data: summary1, error: invErr } = await db.functions.invoke('mirror-images');
check('invoke ok', !invErr, invErr?.message ?? JSON.stringify(invErr));
console.log('summary1:', JSON.stringify(summary1));
check('function found work', (summary1?.needing ?? 0) > 0, `needing: ${summary1?.needing}`);

console.log('\n--- poll until image_paths land ---');
let mirroredProducts = [];
for (let i = 0; i < 60; i++) {
  const rows = await getActiveProducts();
  mirroredProducts = rows.filter((p) => (p.image_paths ?? []).some(Boolean));
  if (mirroredProducts.length >= (summary1?.needing ?? 1)) break;
  await sleep(5000);
}
check(
  'products got image_paths',
  mirroredProducts.length > 0,
  `mirrored products: ${mirroredProducts.length}/${summary1?.needing}`,
);

console.log('\n--- self-hosted image is publicly fetchable ---');
const sample = mirroredProducts.find((p) => (p.image_paths ?? []).some(Boolean));
const storedPath = sample.image_paths.find(Boolean);
const publicUrl = `${process.env.VITE_SUPABASE_URL}/storage/v1/object/public/product-images/${storedPath}`;
const imgRes = await fetch(publicUrl);
const body = imgRes.ok ? await imgRes.arrayBuffer() : null;
check('public image URL returns 200', imgRes.ok, `status ${imgRes.status}`);
check('image bytes served', (body?.byteLength ?? 0) > 1000, `${body?.byteLength ?? 0} bytes`);
check('content-type is image', (imgRes.headers.get('content-type') ?? '').startsWith('image/'), imgRes.headers.get('content-type'));

console.log('\n--- second run is idempotent ---');
const { data: summary2, error: invErr2 } = await db.functions.invoke('mirror-images');
check('second invoke ok', !invErr2, invErr2?.message);
console.log('summary2:', JSON.stringify(summary2));
if ((summary1?.failed ?? 0) === 0) {
  check('no new images mirrored on second run', (summary2?.imagesMirrored ?? -1) === 0);
  check('no product updates on second run', (summary2?.updated ?? -1) === 0);
} else {
  console.log(`(skipping strict idempotency asserts: first run had ${summary1.failed} CDN failures, which the retry is allowed to fix)`);
}

console.log('\n--- cleanup (preserving pre-existing versions) ---');
const { data: othersBefore } = await db
  .from('versions')
  .select('id')
  .neq('id', versionId)
  .order('created_at', { ascending: false });
const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const { data: folders } = await admin.storage.from('product-images').list('', { limit: 1000 });
let removedFiles = 0;
let keptFiles = 0;
for (const folder of folders ?? []) {
  const { data: files } = await admin.storage.from('product-images').list(folder.name, { limit: 1000 });
  const pre = prePaths.get(folder.name) ?? new Set();
  const paths = (files ?? [])
    .filter((f) => !pre.has(`${folder.name}/${f.name}`))
    .map((f) => `${folder.name}/${f.name}`);
  keptFiles += (files?.length ?? 0) - paths.length;
  if (paths.length) {
    const { error } = await admin.storage.from('product-images').remove(paths);
    if (!error) removedFiles += paths.length;
  }
}
console.log(`removed ${removedFiles} test images, kept ${keptFiles} pre-existing images`);
if (othersBefore?.length) {
  await publishVersionRow(othersBefore[0].id);
}
await cleanupVersion(versionId, uploaded);
const { data: left } = await db.from('versions').select('id, is_active');
check('test version removed', !(left ?? []).some((v) => v.id === versionId));
if (othersBefore?.length) {
  check(
    'pre-existing version active again',
    (left ?? []).some((v) => v.id === othersBefore[0].id && v.is_active),
    JSON.stringify(left),
  );
} else {
  check('no versions left', (left ?? []).length === 0, `left: ${left?.length}`);
}
let remainingFiles = 0;
for (const folder of imgLeft ?? []) {
  const { data: fs2 } = await admin.storage.from('product-images').list(folder.name, { limit: 1000 });
  remainingFiles += fs2?.length ?? 0;
}
check('test images removed, pre-existing kept', remainingFiles === keptFiles, `remaining: ${remainingFiles}, expected kept: ${keptFiles}`);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL IMAGE MIRROR CHECKS PASSED');
process.exit(failures ? 1 : 0);
