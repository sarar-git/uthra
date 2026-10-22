import { CATALOG_HEADERS, LISTINGS_HEADERS } from '../config.js';

export function previousToCatalogRows(previous) {
  const h = CATALOG_HEADERS;
  return previous
    .filter((p) => p.status !== 'inactive')
    .map((p) => {
      const images = p.image_src ?? [];
      const row = {
        [h.fsn]: p.fsn,
        [h.sku]: p.sku ?? '',
        [h.groupId]: p.group_id ?? '',
        [h.brand]: p.brand ?? '',
        [h.color]: p.color ?? '',
        [h.styleCode]: p.style_code ?? '',
        [h.size]: (p.sizes ?? [])[0] ?? '',
        [h.mainImage]: images[0] ?? '',
      };
      h.otherImages.forEach((col, i) => {
        row[col] = images[i + 1] ?? '';
      });
      return row;
    });
}

export function previousToListingsRows(previous) {
  const h = LISTINGS_HEADERS;
  return previous
    .filter((p) => p.status !== 'inactive')
    .map((p) => ({
      [h.fsn]: p.fsn,
      [h.sku]: p.sku ?? '',
      [h.title]: p.title ?? '',
      [h.mrp]: String(p.mrp ?? ''),
      [h.sellingPrice]: String(p.selling_price ?? ''),
      [h.settlementPrice]: String(p.settlement_price ?? ''),
      [h.stock]: String(p.stock ?? 0),
      [h.category]: p.category ?? '',
      [h.isShopsy]: String(Boolean(p.is_shopsy)),
    }));
}

export function catalogHeadersFromPrevious() {
  const h = CATALOG_HEADERS;
  return [h.fsn, h.sku, h.groupId, h.brand, h.color, h.styleCode, h.size, h.mainImage, ...h.otherImages];
}

export function listingsHeadersFromPrevious() {
  const h = LISTINGS_HEADERS;
  return [h.fsn, h.sku, h.title, h.mrp, h.sellingPrice, h.settlementPrice, h.stock, h.category, h.isShopsy];
}
