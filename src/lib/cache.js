const KEY = 'uthra-catalog-cache-v1';

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function saveCache({ products, version }) {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify({ products, version, cachedAt: new Date().toISOString() }));
  } catch {
    /* quota or unavailable — cache is best-effort */
  }
}

export function loadCache() {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearCache() {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
