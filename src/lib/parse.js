import * as XLSX from 'xlsx';
import { CATALOG_HEADERS, LISTINGS_HEADERS, CATALOG_REQUIRED, LISTINGS_REQUIRED } from '../config.js';

export function parseSheet(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const workbook = XLSX.read(bytes, { type: 'array' });
  const ws = workbook.Sheets[workbook.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
  if (!aoa.length) return { headers: [], rows: [] };
  const headers = aoa[0].map((h) => String(h).trim());
  const rows = aoa
    .slice(1)
    .map((arr) => {
      const row = {};
      headers.forEach((h, i) => {
        const v = arr[i];
        row[h] = v === undefined || v === null ? '' : String(v).trim();
      });
      return row;
    })
    .filter((row) => Object.values(row).some((v) => v !== ''));
  return { headers, rows };
}

export function parseNumber(value) {
  if (value === '' || value === null || value === undefined) return { empty: true };
  const cleaned = String(value).replace(/[₹,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, raw: value };
}

const TRUE_VALUES = new Set(['true', '1', 'yes', 'y']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'n']);

export function parseBool(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return { empty: true, value: false };
  if (TRUE_VALUES.has(s)) return { value: true };
  if (FALSE_VALUES.has(s)) return { value: false };
  return { invalid: true, value: false, raw: value };
}

function checkHeaders(headers, required, label) {
  const errors = [];
  for (const col of required) {
    if (!headers.includes(col)) {
      errors.push({
        code: 'MISSING_COLUMN',
        message: `${label}: required column "${col}" missing — is this the wrong file in this slot?`,
        column: col,
      });
    }
  }
  return errors;
}

export function extractCatalog(headers, rows) {
  const h = CATALOG_HEADERS;
  const errors = [];
  const warnings = [];

  errors.push(...checkHeaders(headers, CATALOG_REQUIRED, 'Catalog'));
  const markers = [h.brand, h.mainImage, h.sku, h.groupId, h.size];
  const missingMarkers = markers.filter((m) => !headers.includes(m));
  if (missingMarkers.length >= 3) {
    errors.push({
      code: 'WRONG_FILE',
      message: `Catalog: headers look like the pricing file (missing ${missingMarkers.join(', ')}) — wrong file in this slot`,
    });
    return { records: [], errors, warnings };
  }
  if (!headers.includes(h.fsn)) return { records: [], errors, warnings };
  if (!rows.length) errors.push({ code: 'ZERO_ROWS', message: 'Catalog file has zero data rows' });

  const seen = new Map();
  const records = [];
  rows.forEach((row, i) => {
    const line = i + 2;
    const fsn = row[h.fsn];
    if (!fsn) {
      warnings.push({ code: 'EMPTY_FSN', message: `Catalog row ${line}: empty FSN, row skipped` });
      return;
    }
    if (seen.has(fsn)) {
      errors.push({
        code: 'DUPLICATE_FSN',
        message: `Catalog: duplicate FSN ${fsn} (rows ${seen.get(fsn)} and ${line})`,
        fsn,
      });
    } else {
      seen.set(fsn, line);
    }
    records.push({
      fsn,
      sku: row[h.sku] || '',
      group_id: row[h.groupId] || '',
      brand_raw: row[h.brand] || '',
      type: row[h.type] || '',
      color: row[h.color] || '',
      style_code: row[h.styleCode] || '',
      size: row[h.size] || '',
      image_urls: [h.mainImage, ...h.otherImages].map((c) => row[c]).filter(Boolean),
      line,
    });
  });
  return { records, errors, warnings };
}

export function extractListings(headers, rows) {
  const h = LISTINGS_HEADERS;
  const errors = [];
  const warnings = [];

  errors.push(...checkHeaders(headers, LISTINGS_REQUIRED, 'Listings'));
  if (!LISTINGS_REQUIRED.every((c) => headers.includes(c))) return { records: [], errors, warnings, shopsyColumnMissing: !headers.includes(h.isShopsy) };
  if (!rows.length) errors.push({ code: 'ZERO_ROWS', message: 'Listings file has zero data rows' });

  const shopsyColumnMissing = !headers.includes(h.isShopsy);
  if (shopsyColumnMissing) {
    warnings.push({
      code: 'SHOPSY_COLUMN_MISSING',
      message: `"${h.isShopsy}" column is missing — every row defaults to Flipkart (FALSE)`,
    });
  }

  const seen = new Map();
  const records = [];
  let shopsyInvalid = 0;
  let stockInvalid = 0;

  rows.forEach((row, i) => {
    const line = i + 2;
    const fsn = row[h.fsn];
    if (!fsn) {
      warnings.push({ code: 'EMPTY_FSN', message: `Listings row ${line}: empty FSN, row skipped` });
      return;
    }
    if (seen.has(fsn)) {
      errors.push({
        code: 'DUPLICATE_FSN',
        message: `Listings: duplicate FSN ${fsn} (rows ${seen.get(fsn)} and ${line})`,
        fsn,
      });
    } else {
      seen.set(fsn, line);
    }

    const mrp = parseNumber(row[h.mrp]);
    const selling = parseNumber(row[h.sellingPrice]);
    const settlement = parseNumber(row[h.settlementPrice]);
    for (const [label, parsed] of [
      ['MRP', mrp],
      ['Your Selling Price', selling],
      ['Bank Settlement', settlement],
    ]) {
      if (!parsed.ok) {
        errors.push({
          code: 'NON_NUMERIC_PRICE',
          message: `Listings row ${line} (FSN ${fsn}): ${label} is not numeric ("${parsed.raw ?? ''}")`,
          fsn,
        });
      }
    }

    const stockParsed = parseNumber(row[h.stock]);
    let stock = 0;
    if (stockParsed.ok) {
      stock = Math.trunc(stockParsed.value);
    } else if (!stockParsed.empty) {
      stockInvalid += 1;
    }

    const shopsy = parseBool(row[h.isShopsy]);
    if (shopsy.invalid) shopsyInvalid += 1;

    records.push({
      fsn,
      sku: row[h.sku] || '',
      title: row[h.title] || '',
      mrp: mrp.ok ? mrp.value : null,
      selling_price: selling.ok ? selling.value : null,
      settlement_price: settlement.ok ? settlement.value : null,
      stock,
      category: row[h.category] || '',
      is_shopsy: shopsy.value,
      listing_id: row[h.listingId] || '',
      benchmark_price: parseNumber(row[h.benchmarkPrice]).value ?? null,
      fulfillment_by: row[h.fulfillmentBy] || '',
      line,
      prices_ok: mrp.ok && selling.ok && settlement.ok,
    });
  });

  if (shopsyInvalid > 0) {
    warnings.push({
      code: 'SHOPSY_INVALID_VALUES',
      message: `${shopsyInvalid} row(s) have unrecognized "${h.isShopsy}" values (expected TRUE/FALSE, 1/0, yes/no) — treated as Flipkart`,
    });
  }
  if (stockInvalid > 0) {
    warnings.push({
      code: 'STOCK_INVALID',
      message: `${stockInvalid} row(s) have non-numeric stock — treated as 0`,
    });
  }

  return { records, errors, warnings, shopsyColumnMissing };
}
