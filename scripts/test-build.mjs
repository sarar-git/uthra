import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSheet } from '../src/lib/parse.js';
import { analyze } from '../src/lib/build.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const catalog = parseSheet(fs.readFileSync(path.join(root, 'samples/uthra_catalog.xlsx')));
const listings = parseSheet(fs.readFileSync(path.join(root, 'samples/uthra_flipkart_pricing.xlsx')));
console.log(`parsed: catalog ${catalog.rows.length} rows, listings ${listings.rows.length} rows\n`);

console.log('--- run 1: fresh publish (no previous version) ---');
const r1 = analyze({
  catalogHeaders: catalog.headers,
  catalogRows: catalog.rows,
  listingsHeaders: listings.headers,
  listingsRows: listings.rows,
  previous: [],
});
check('no blocking errors', r1.report.errors.length === 0, JSON.stringify(r1.report.errors.slice(0, 3)));
check('147 products built', r1.products.length === 147, `got ${r1.products.length}`);
check('all new', r1.report.newCount === 147, `got ${r1.report.newCount}`);
check('123 matched to catalog', r1.report.matched === 123, `got ${r1.report.matched}`);
check('24 listings without catalog', r1.report.listingsWithoutCatalog === 24, `got ${r1.report.listingsWithoutCatalog}`);
check('70 stock-zero rows', r1.report.stockZero === 70, `got ${r1.report.stockZero}`);
check('shopsy column missing warning', r1.report.warnings.some((w) => w.code === 'SHOPSY_COLUMN_MISSING'));
check('no prices are null', r1.products.every((p) => p.mrp != null && p.selling_price != null && p.settlement_price != null));

console.log('\n--- run 2: re-upload (existing / new / inactive) ---');
const previous = [
  ...r1.products.slice(0, 100).map((p) => ({ ...p, status: 'existing' })),
  ...Array.from({ length: 5 }, (_, i) => ({
    fsn: `GHOSTFSN${i}`,
    sku: `GHOST${i}`,
    title: 'Ghost product',
    brand: 'UTHRA',
    category: 'petticoat',
    sizes: [],
    mrp: 100,
    selling_price: 90,
    settlement_price: 80,
    stock: 0,
    is_shopsy: false,
    status: 'existing',
    image_src: [],
    image_paths: [],
  })),
];
const r2 = analyze({
  catalogHeaders: catalog.headers,
  catalogRows: catalog.rows,
  listingsHeaders: listings.headers,
  listingsRows: listings.rows,
  previous,
});
check('100 existing', r2.report.existingCount === 100, `got ${r2.report.existingCount}`);
check('47 new', r2.report.newCount === 47, `got ${r2.report.newCount}`);
check('5 inactive carried', r2.report.inactiveCarried === 5, `got ${r2.report.inactiveCarried}`);
check('total 152 products', r2.products.length === 152, `got ${r2.products.length}`);
check('no blocking errors', r2.report.errors.length === 0, JSON.stringify(r2.report.errors.slice(0, 3)));

console.log('\n--- run 3: duplicate FSN is blocking ---');
const dupRows = [listings.rows[0], ...listings.rows];
const r3 = analyze({
  catalogHeaders: catalog.headers,
  catalogRows: catalog.rows,
  listingsHeaders: listings.headers,
  listingsRows: dupRows,
  previous: [],
});
check('DUPLICATE_FSN error', r3.report.errors.some((e) => e.code === 'DUPLICATE_FSN'));
check('cannot publish', r3.report.canPublish === false);

console.log('\n--- run 4: wrong file in catalog slot is blocking ---');
const r4 = analyze({
  catalogHeaders: listings.headers,
  catalogRows: listings.rows,
  listingsHeaders: listings.headers,
  listingsRows: listings.rows,
  previous: [],
});
check('WRONG_FILE error', r4.report.errors.some((e) => e.code === 'WRONG_FILE'));
check('cannot publish', r4.report.canPublish === false);

console.log('\n--- run 4b: missing required listings column is blocking ---');
const strippedHeaders = listings.headers.filter((h) => h !== 'Product Title');
const r4b = analyze({
  catalogHeaders: catalog.headers,
  catalogRows: catalog.rows,
  listingsHeaders: strippedHeaders,
  listingsRows: listings.rows,
  previous: [],
});
check('MISSING_COLUMN error', r4b.report.errors.some((e) => e.code === 'MISSING_COLUMN'));
check('cannot publish', r4b.report.canPublish === false);

console.log('\n--- run 5: zero overlap is blocking ---');
const r5 = analyze({
  catalogHeaders: catalog.headers,
  catalogRows: catalog.rows.map((row) => ({ ...row, 'Flipkart Serial Number': `X${row['Flipkart Serial Number']}` })),
  listingsHeaders: listings.headers,
  listingsRows: listings.rows,
  previous: [],
});
check('ZERO_OVERLAP error', r5.report.errors.some((e) => e.code === 'ZERO_OVERLAP'));

console.log('\n--- sample product ---');
console.log(JSON.stringify(r1.products[0], null, 2));

console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
