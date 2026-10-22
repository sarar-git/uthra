import { extractCatalog, extractListings } from './parse.js';

function normalizeBrand(raw) {
  return String(raw || '').trim().toUpperCase();
}

function brandFromTitle(title) {
  const first = String(title || '').trim().split(/\s+/)[0] || '';
  return normalizeBrand(first);
}

export function analyze({ catalogHeaders, catalogRows, listingsHeaders, listingsRows, previous = [] }) {
  const cat = extractCatalog(catalogHeaders, catalogRows);
  const lis = extractListings(listingsHeaders, listingsRows);

  const errors = [...cat.errors, ...lis.errors];
  const warnings = [...cat.warnings, ...lis.warnings];

  const catalogByFsn = new Map(cat.records.map((r) => [r.fsn, r]));
  const listingFsns = new Set(lis.records.map((r) => r.fsn));

  if (cat.records.length && lis.records.length) {
    const matched = lis.records.filter((r) => catalogByFsn.has(r.fsn)).length;
    if (matched === 0) {
      errors.push({
        code: 'ZERO_OVERLAP',
        message: 'No FSN in common between catalog and listings — the wrong file is probably in one of the slots',
      });
    }
  }

  const listingsWithoutCatalog = lis.records.filter((r) => !catalogByFsn.has(r.fsn));
  const catalogWithoutListing = cat.records.filter((r) => !listingFsns.has(r.fsn));

  if (listingsWithoutCatalog.length) {
    warnings.push({
      code: 'LISTING_NO_CATALOG',
      message: `${listingsWithoutCatalog.length} listing(s) have no catalog entry (no images/brand/size; brand guessed from title)`,
    });
  }
  if (catalogWithoutListing.length) {
    warnings.push({
      code: 'CATALOG_NO_LISTING',
      message: `${catalogWithoutListing.length} catalog item(s) have no listing — not shown in the grid`,
    });
  }

  const brandRaws = new Map();
  const products = [];
  let priceSanity = 0;
  const priceSanityExamples = [];

  for (const l of lis.records) {
    if (!l.prices_ok) continue;
    const c = catalogByFsn.get(l.fsn);

    let brand = normalizeBrand(c?.brand_raw);
    if (c?.brand_raw) {
      if (!brandRaws.has(brand)) brandRaws.set(brand, new Set());
      brandRaws.get(brand).add(c.brand_raw);
    }
    if (!brand) brand = brandFromTitle(l.title);

    if (l.selling_price > l.mrp || l.settlement_price > l.selling_price) {
      priceSanity += 1;
      if (priceSanityExamples.length < 5) priceSanityExamples.push(l.fsn);
    }

    products.push({
      fsn: l.fsn,
      sku: l.sku || c?.sku || '',
      group_id: c?.group_id || '',
      title: l.title,
      brand,
      category: l.category,
      color: c?.color || '',
      style_code: c?.style_code || '',
      sizes: c?.size ? [c.size] : [],
      mrp: l.mrp,
      selling_price: l.selling_price,
      settlement_price: l.settlement_price,
      stock: l.stock,
      is_shopsy: l.is_shopsy,
      status: previous.some((p) => p.fsn === l.fsn) ? 'existing' : 'new',
      image_src: c?.image_urls ?? [],
      image_paths: [],
    });
  }

  const newFsns = new Set(products.map((p) => p.fsn));
  let inactive = 0;
  for (const p of previous) {
    if (!newFsns.has(p.fsn)) {
      products.push({ ...p, status: 'inactive', image_paths: p.image_paths ?? [] });
      inactive += 1;
    }
  }

  const mergedBrands = [];
  for (const [normalized, raws] of brandRaws) {
    if (raws.size > 1) mergedBrands.push(`${[...raws].join('/')} → ${normalized}`);
  }
  if (mergedBrands.length) {
    warnings.push({
      code: 'BRAND_MERGED',
      message: `Brand case variants merged: ${mergedBrands.join('; ')}`,
    });
  }

  const stockZero = products.filter((p) => p.status !== 'inactive' && p.stock === 0).length;
  if (stockZero) {
    warnings.push({ code: 'STOCK_ZERO', message: `${stockZero} listing(s) have stock 0` });
  }

  const missingImages = products.filter((p) => p.status !== 'inactive' && p.image_src.length === 0).length;
  if (missingImages) {
    warnings.push({ code: 'MISSING_IMAGES', message: `${missingImages} listing(s) have no images` });
  }

  if (priceSanity) {
    warnings.push({
      code: 'PRICE_SANITY',
      message: `${priceSanity} listing(s) have selling price above MRP or settlement above selling price (e.g. ${priceSanityExamples.join(', ')})`,
    });
  }

  const prevActive = previous.filter((p) => p.status !== 'inactive').length;
  if (prevActive > 0 && lis.records.length < prevActive * 0.7) {
    const drop = Math.round((1 - lis.records.length / prevActive) * 100);
    warnings.push({
      code: 'ROW_DROP',
      message: `Listings dropped ${drop}% vs the active version (${lis.records.length} now vs ${prevActive} before) — check the right file was uploaded`,
    });
  }

  const report = {
    catalogRows: cat.records.length,
    listingsRows: lis.records.length,
    matched: products.filter((p) => p.status !== 'inactive' && catalogByFsn.has(p.fsn)).length,
    listingsWithoutCatalog: listingsWithoutCatalog.length,
    catalogWithoutListing: catalogWithoutListing.length,
    stockZero,
    missingImages,
    inactiveCarried: inactive,
    newCount: products.filter((p) => p.status === 'new').length,
    existingCount: products.filter((p) => p.status === 'existing').length,
    shopsyCount: products.filter((p) => p.is_shopsy && p.status !== 'inactive').length,
    errors,
    warnings,
    canPublish: errors.length === 0,
  };

  return { products, report };
}
