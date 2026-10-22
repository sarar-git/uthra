import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import {
  SAMPLES,
  CATALOG_HEADERS,
  LISTINGS_HEADERS,
  CATALOG_REQUIRED,
  LISTINGS_REQUIRED,
} from '../src/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  {
    label: 'Catalog',
    file: SAMPLES.catalog,
    required: CATALOG_REQUIRED,
    optional: Object.values(CATALOG_HEADERS).flat(),
  },
  {
    label: 'Listings',
    file: SAMPLES.listings,
    required: LISTINGS_REQUIRED,
    optional: Object.values(LISTINGS_HEADERS).flat(),
  },
];

const blocking = [];
const warnings = [];

function readSheet(absPath) {
  const buffer = fs.readFileSync(absPath);
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    defval: '',
    raw: false,
  });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { sheetName, headers, rows };
}

function suggest(header, known) {
  const lower = header.toLowerCase().trim();
  return known.find((h) => h.toLowerCase().trim() === lower);
}

for (const { label, file, required, optional } of FILES) {
  const absPath = path.join(root, file);
  console.log(`\n=== ${label}: ${file} ===`);

  if (!fs.existsSync(absPath)) {
    blocking.push(`${label} file not found at ${file} — copy it into /samples.`);
    continue;
  }

  const { sheetName, headers, rows } = readSheet(absPath);
  console.log(`sheet: ${sheetName}  |  data rows: ${rows.length}`);
  console.log(`headers (${headers.length}):`);
  for (const h of headers) {
    const known = suggest(h, optional);
    const note = known && known !== h ? `  (case/space variant of "${known}")` : '';
    console.log(`  - ${h}${note}`);
  }

  console.log('first 3 rows:');
  rows.slice(0, 3).forEach((row, i) => console.log(`  ${i + 1}.`, JSON.stringify(row)));

  if (rows.length === 0) blocking.push(`${label} file has zero data rows.`);

  for (const col of required) {
    if (!headers.includes(col)) {
      const near = suggest(col, headers);
      blocking.push(
        `${label}: required column "${col}" missing.` +
          (near ? ` Found near-variant "${near}".` : ' (wrong file in this slot?)'),
      );
    }
  }

  for (const col of optional) {
    if (!required.includes(col) && !headers.includes(col)) {
      if (col === LISTINGS_HEADERS.isShopsy) {
        warnings.push(`"${col}" is missing — every row will default to Flipkart (FALSE).`);
      } else {
        warnings.push(`${label}: column "${col}" not found (display field may be empty).`);
      }
    }
  }
}

console.log('\n=== Verdict ===');
if (warnings.length) {
  console.log('Warnings:');
  warnings.forEach((w) => console.log(`  ! ${w}`));
}
if (blocking.length) {
  console.log('Blocking errors:');
  blocking.forEach((b) => console.log(`  x ${b}`));
  process.exit(1);
}
console.log('OK — headers match section 3 of the plan.');
