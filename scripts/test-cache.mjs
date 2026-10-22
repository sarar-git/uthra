import { loadActiveData } from '../src/lib/load.js';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { saveCache, loadCache, clearCache } = await import('../src/lib/cache.js');

const version = { id: 'v1', created_at: '2026-10-22T10:00:00Z', is_active: true };
const products = [{ fsn: 'F1', title: 'X', status: 'new' }];

console.log('--- cache roundtrip ---');
saveCache({ products, version });
const cached = loadCache();
check('cached products roundtrip', JSON.stringify(cached.products) === JSON.stringify(products));
check('cachedAt set', Boolean(cached.cachedAt));
clearCache();
check('clearCache empties', loadCache() === null);

console.log('\n--- server ok → saves cache ---');
const okResult = await loadActiveData({
  fetchVersion: async () => version,
  fetchProducts: async () => products,
  save: saveCache,
  load: loadCache,
  clear: clearCache,
});
check('source server', okResult.source === 'server');
check('cache saved', JSON.stringify(loadCache()?.products) === JSON.stringify(products));

console.log('\n--- server down + cache present → serves cache ---');
const downResult = await loadActiveData({
  fetchVersion: async () => {
    throw new Error('network down');
  },
  fetchProducts: async () => products,
  save: saveCache,
  load: loadCache,
  clear: clearCache,
});
check('source cache', downResult.source === 'cache');
check('banner timestamp present', Boolean(downResult.cachedAt));
check('cached products returned', downResult.products.length === 1);
check('original error attached', /network down/.test(downResult.error.message));

console.log('\n--- server down + no cache → none ---');
clearCache();
const noneResult = await loadActiveData({
  fetchVersion: async () => {
    throw new Error('network down');
  },
  fetchProducts: async () => products,
  save: saveCache,
  load: loadCache,
  clear: clearCache,
});
check('source none', noneResult.source === 'none');
check('error attached', /network down/.test(noneResult.error.message));

console.log('\n--- server ok but no active version → clears cache ---');
saveCache({ products, version });
const noVersionResult = await loadActiveData({
  fetchVersion: async () => null,
  fetchProducts: async () => [],
  save: saveCache,
  load: loadCache,
  clear: clearCache,
});
check('source server, version null', noVersionResult.source === 'server' && noVersionResult.version === null);
check('cache cleared', loadCache() === null);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL CACHE CHECKS PASSED');
process.exit(failures ? 1 : 0);
