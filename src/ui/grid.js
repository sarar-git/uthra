import { SUPABASE_URL, BUCKETS } from '../config.js';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const publicUrlCache = new Map();

function publicUrl(path) {
  if (!publicUrlCache.has(path)) {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    publicUrlCache.set(path, `${SUPABASE_URL}/storage/v1/object/public/${BUCKETS.productImages}/${encoded}`);
  }
  return publicUrlCache.get(path);
}

function displaySrcs(p) {
  const srcs = p.image_src ?? [];
  const paths = p.image_paths ?? [];
  return srcs.map((u, i) => (paths[i] ? publicUrl(paths[i]) : u)).filter(Boolean);
}

function formatINR(n) {
  return n == null ? '—' : inr.format(n);
}

function prettyCategory(c) {
  return String(c || '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function initGrid({ tabsRoot, filtersRoot, gridRoot }) {
  let products = [];
  const state = {
    tab: 'all',
    brands: new Set(),
    categories: new Set(),
    search: '',
    inStockOnly: false,
  };

  tabsRoot.innerHTML = `
    <button data-tab="all" class="on">All <span class="tab-count">0</span></button>
    <button data-tab="flipkart">Flipkart <span class="tab-count">0</span></button>
    <button data-tab="shopsy">Shopsy <span class="tab-count">0</span></button>
  `;

  filtersRoot.innerHTML = `
    <div class="filters-row">
      <input type="search" id="q" placeholder="Search name, SKU, FSN…" />
      <label class="toggle"><input type="checkbox" id="in-stock" /> In stock only</label>
      <button id="clear-filters" class="ghost">Clear all</button>
    </div>
    <div class="chips" id="brand-chips"></div>
    <div class="chips" id="category-chips"></div>
  `;

  gridRoot.innerHTML = '<div class="grid" id="cards"></div>';

  const q = filtersRoot.querySelector('#q');
  const inStock = filtersRoot.querySelector('#in-stock');
  const clearBtn = filtersRoot.querySelector('#clear-filters');
  const brandChips = filtersRoot.querySelector('#brand-chips');
  const categoryChips = filtersRoot.querySelector('#category-chips');
  const cardsEl = gridRoot.querySelector('#cards');

  tabsRoot.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    state.tab = btn.dataset.tab;
    apply();
  });

  q.addEventListener('input', () => {
    state.search = q.value.trim().toLowerCase();
    apply();
  });

  inStock.addEventListener('change', () => {
    state.inStockOnly = inStock.checked;
    apply();
  });

  clearBtn.addEventListener('click', () => {
    state.tab = 'all';
    state.brands.clear();
    state.categories.clear();
    state.search = '';
    state.inStockOnly = false;
    q.value = '';
    inStock.checked = false;
    apply();
  });

  brandChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    toggle(state.brands, chip.dataset.value);
    apply();
  });

  categoryChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    toggle(state.categories, chip.dataset.value);
    apply();
  });

  cardsEl.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement)) return;
      const srcs = JSON.parse(img.dataset.srcs || '[]');
      const idx = Number(img.dataset.idx || 0) + 1;
      if (idx < srcs.length) {
        img.dataset.idx = String(idx);
        img.src = srcs[idx];
      } else {
        const ph = document.createElement('div');
        ph.className = 'img-placeholder';
        ph.textContent = 'No image';
        img.replaceWith(ph);
      }
    },
    true,
  );

  cardsEl.addEventListener('mouseover', (e) => {
    const img = e.target.closest?.('.card-img img');
    if (!img || img.dataset.hovering === '1') return;
    const srcs = JSON.parse(img.dataset.srcs || '[]');
    if (srcs.length > 1) {
      img.dataset.baseIdx = img.dataset.idx || '0';
      img.dataset.hovering = '1';
      img.src = srcs[1];
    }
  });

  cardsEl.addEventListener('mouseout', (e) => {
    const img = e.target.closest?.('.card-img img');
    if (!img || img.dataset.hovering !== '1') return;
    const srcs = JSON.parse(img.dataset.srcs || '[]');
    const base = srcs[Number(img.dataset.baseIdx || 0)];
    if (base) img.src = base;
    img.dataset.hovering = '0';
  });

  function toggle(set, v) {
    if (set.has(v)) set.delete(v);
    else set.add(v);
  }

  function matches(p, skip = '') {
    if (skip !== 'tab') {
      if (state.tab === 'flipkart' && p.is_shopsy) return false;
      if (state.tab === 'shopsy' && !p.is_shopsy) return false;
    }
    if (skip !== 'brand' && state.brands.size && !state.brands.has(p.brand)) return false;
    if (skip !== 'category' && state.categories.size && !state.categories.has(p.category)) return false;
    if (skip !== 'search' && state.search) {
      const hay = `${p.title} ${p.sku} ${p.fsn}`.toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    if (skip !== 'stock' && state.inStockOnly && !(p.stock > 0)) return false;
    return true;
  }

  function inTab(p, tab) {
    return tab === 'all' || (tab === 'shopsy') === Boolean(p.is_shopsy);
  }

  function renderChips(container, values, selectedSet, key, accessor) {
    container.innerHTML = values
      .map((v) => {
        const count = products.filter((p) => accessor(p) === v && matches(p, key)).length;
        const label = key === 'category' ? prettyCategory(v) : v;
        return `<button class="chip ${selectedSet.has(v) ? 'on' : ''}" data-value="${esc(v)}">${esc(label)} <span class="chip-count">${count}</span></button>`;
      })
      .join('');
  }

  function cardHtml(p) {
    const srcs = displaySrcs(p);
    const img = srcs.length
      ? `<img src="${esc(srcs[0])}" data-srcs="${esc(JSON.stringify(srcs))}" data-idx="0" loading="lazy" alt="" />`
      : '<div class="img-placeholder">No image</div>';
    const statusBadge =
      p.status === 'new'
        ? '<span class="badge st-new">New</span>'
        : p.status === 'inactive'
          ? '<span class="badge st-inactive">Inactive</span>'
          : '';
    const marketBadge = p.is_shopsy
      ? '<span class="badge mk-shopsy">Shopsy</span>'
      : '<span class="badge mk-flipkart">Flipkart</span>';
    const stockBadge =
      p.stock > 0
        ? `<span class="badge stock ok">${p.stock} in stock</span>`
        : '<span class="badge stock out">Out of stock</span>';
    return `
      <article class="card ${p.status === 'inactive' ? 'inactive' : ''}">
        <div class="card-img">${img}${marketBadge}${statusBadge}</div>
        <div class="card-body">
          <div class="brand">${esc(p.brand)}</div>
          <h3 class="title">${esc(p.title)}</h3>
          <div class="meta">${esc(prettyCategory(p.category))}${
            p.sizes?.length ? ` · ${esc(p.sizes.join(', '))}` : ''
          } ${stockBadge}</div>
          <div class="prices">
            <span class="mrp">${formatINR(p.mrp)}</span>
            <span class="selling">${formatINR(p.selling_price)}</span>
          </div>
          <div class="settle">Bank settlement <b>${formatINR(p.settlement_price)}</b></div>
        </div>
      </article>`;
  }

  function apply() {
    tabsRoot.querySelectorAll('button[data-tab]').forEach((btn) => {
      const tab = btn.dataset.tab;
      btn.classList.toggle('on', tab === state.tab);
      btn.querySelector('.tab-count').textContent = products.filter(
        (p) => matches(p, 'tab') && inTab(p, tab),
      ).length;
    });

    renderChips(
      brandChips,
      [...new Set(products.map((p) => p.brand).filter(Boolean))].sort(),
      state.brands,
      'brand',
      (p) => p.brand,
    );
    renderChips(
      categoryChips,
      [...new Set(products.map((p) => p.category).filter(Boolean))].sort(),
      state.categories,
      'category',
      (p) => p.category,
    );

    const filtered = products.filter((p) => matches(p));
    cardsEl.innerHTML = filtered.length
      ? filtered.map(cardHtml).join('')
      : '<p class="muted empty">No products match the current filters.</p>';
  }

  return {
    update(newProducts) {
      products = newProducts ?? [];
      state.tab = 'all';
      state.brands.clear();
      state.categories.clear();
      state.search = '';
      state.inStockOnly = false;
      q.value = '';
      inStock.checked = false;
      apply();
    },
  };
}
