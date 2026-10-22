import './style.css';
import { getActiveVersion, getActiveProducts } from './lib/db.js';
import { initGrid } from './ui/grid.js';
import { initUpload } from './ui/upload.js';
import { initVersions } from './ui/versions.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <nav id="tabs-root" class="tabs"></nav>
  <main>
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

const grid = initGrid({
  tabsRoot: document.querySelector('#tabs-root'),
  filtersRoot: document.querySelector('#filters-section'),
  gridRoot: document.querySelector('#grid-section'),
});

async function reload() {
  try {
    const [version, products] = await Promise.all([getActiveVersion(), getActiveProducts()]);
    if (!version) {
      versionLine.textContent = 'No active version yet — publish the first upload below.';
      grid.update([]);
      return;
    }
    const when = new Date(version.created_at).toLocaleString('en-IN');
    const active = products.filter((p) => p.status !== 'inactive');
    const inactive = products.length - active.length;
    const shopsy = active.filter((p) => p.is_shopsy).length;
    versionLine.textContent = `Version uploaded ${when} — ${active.length} products (${inactive} inactive) · Flipkart ${active.length - shopsy} / Shopsy ${shopsy}`;
    grid.update(products);
  } catch (e) {
    versionLine.textContent = `Can't reach the server: ${e.message}`;
  }
}

initUpload({ root: document.querySelector('#upload-section'), onChanged: reload });
initVersions({ root: document.querySelector('#versions-section'), onChanged: reload });
reload();
