export const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';

export const BUCKETS = {
  rawUploads: 'raw-uploads',
  productImages: 'product-images',
};

export const SAMPLES = {
  catalog: 'samples/uthra_catalog.xlsx',
  listings: 'samples/uthra_flipkart_pricing.xlsx',
};

export const CATALOG_HEADERS = {
  fsn: 'Flipkart Serial Number',
  sku: 'Seller SKU ID',
  groupId: 'Group ID',
  brand: 'Brand',
  type: 'Type',
  mainImage: 'Main Image URL',
  otherImages: [
    'Other Image URL 1',
    'Other Image URL 2',
    'Other Image URL 3',
    'Other Image URL 4',
    'Other Image URL 5',
    'Other Image URL 6',
  ],
  size: 'Brand Size',
  color: 'Color',
  styleCode: 'Style Code',
  pattern: 'Pattern',
};

export const LISTINGS_HEADERS = {
  fsn: 'Flipkart Serial Number',
  sku: 'Seller SKU Id',
  title: 'Product Title',
  mrp: 'MRP',
  sellingPrice: 'Your Selling Price',
  settlementPrice: 'Bank Settlement',
  stock: 'System Stock count',
  category: 'Sub-category',
  isShopsy: 'Is Shopsy Listings?',
  listingId: 'Listing ID',
  benchmarkPrice: 'Benchmark Price',
  fulfillmentBy: 'Fulfillment By',
};

export const CATALOG_REQUIRED = [CATALOG_HEADERS.fsn];
export const LISTINGS_REQUIRED = [
  LISTINGS_HEADERS.fsn,
  LISTINGS_HEADERS.title,
  LISTINGS_HEADERS.mrp,
  LISTINGS_HEADERS.sellingPrice,
  LISTINGS_HEADERS.settlementPrice,
];

export const KNOWN_CATEGORIES = ['night_dress_nighty', 'petticoat'];

export const KNOWN_BRANDS = ['UTHRA', 'KALKI', 'HONEY', 'ROSE', 'SRIPONSANKAR'];
