import { getActiveVersion, getActiveProducts } from './db.js';
import { saveCache, loadCache, clearCache } from './cache.js';

export async function loadActiveData(
  deps = {
    fetchVersion: getActiveVersion,
    fetchProducts: getActiveProducts,
    save: saveCache,
    load: loadCache,
    clear: clearCache,
  },
) {
  const { fetchVersion, fetchProducts, save, load, clear } = deps;
  try {
    const [version, products] = await Promise.all([fetchVersion(), fetchProducts()]);
    if (!version) {
      clear();
      return { source: 'server', version: null, products: [] };
    }
    save({ products, version });
    return { source: 'server', version, products };
  } catch (e) {
    const cached = load();
    if (cached) {
      return { source: 'cache', version: cached.version, products: cached.products, cachedAt: cached.cachedAt, error: e };
    }
    return { source: 'none', error: e };
  }
}
