import './style.css';
import { loadActiveData } from './lib/load.js';
import { initGrid } from './ui/grid.js';
import { initUpload } from './ui/upload.js';
import { initVersions } from './ui/versions.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <nav id="tabs-root" class="tabs"></nav>
  <main>
    <div id="banner" class="banner" hidden></div>
    <header class="page-head">
      <h1>Uthra Catalog Viewer</h1>
      <p id="version-line" class="muted">Loading…</p>
    </header>
    <section id="filters-section" class="filters-section"></section>
    <section id="grid-section" class="grid-section"></section>
    <section id="upload-section"></section>
    <section id="versions-section"></section>
  </main>
`;

const versionLine = document.querySelector('#version-line');
const bannerEl = document.querySelector('#banner');

const grid = initGrid({
  tabsRoot: document.querySelector('#tabs-root'),
  filtersRoot: document.querySelector('#filters-section'),
  gridRoot: document.querySelector('#grid-section'),
});

function versionText(version, products) {
  const when = new Date(version.created_at).toLocaleString('en-IN');
  const active = products.filter((p) => p.status !== 'inactive');
  const inactive = products.length - active.length;
  const shopsy = active.filter((p) => p.is_shopsy).length;
  return `Version uploaded ${when} — ${active.length} products (${inactive} inactive) · Flipkart ${active.length - shopsy} / Shopsy ${shopsy}`;
}

async function reload() {
  const result = await loadActiveData();

  if (result.source === 'cache') {
    bannerEl.hidden = false;
    bannerEl.textContent = `Can't reach the server. Showing data from ${new Date(result.cachedAt).toLocaleString('en-IN')}.`;
    versionLine.textContent = versionText(result.version, result.products);
    grid.update(result.products);
    return;
  }

  bannerEl.hidden = true;

  if (result.source === 'none') {
    versionLine.textContent = `Can't reach the server: ${result.error?.message ?? 'unknown error'}`;
    grid.update([]);
    return;
  }

  if (!result.version) {
    versionLine.textContent = 'No active version yet — publish the first upload below.';
    grid.update([]);
    return;
  }

  versionLine.textContent = versionText(result.version, result.products);
  grid.update(result.products);
}

initUpload({ root: document.querySelector('#upload-section'), onChanged: reload });
initVersions({ root: document.querySelector('#versions-section'), onChanged: reload });
reload();
