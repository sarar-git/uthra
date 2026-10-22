import './style.css';
import { getActiveVersion, getActiveProducts } from './lib/db.js';
import { initUpload } from './ui/upload.js';
import { initVersions } from './ui/versions.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <main>
    <header class="page-head">
      <h1>Uthra Catalog Viewer</h1>
      <p id="version-line" class="muted">Loading…</p>
    </header>
    <section id="summary-section"></section>
    <section id="upload-section"></section>
    <section id="versions-section"></section>
  </main>
`;

const versionLine = document.querySelector('#version-line');
const summarySection = document.querySelector('#summary-section');

async function reload() {
  try {
    const [version, products] = await Promise.all([getActiveVersion(), getActiveProducts()]);
    if (!version) {
      versionLine.textContent = 'No active version yet — publish the first upload below.';
      summarySection.innerHTML = '';
      return;
    }
    const when = new Date(version.created_at).toLocaleString('en-IN');
    const active = products.filter((p) => p.status !== 'inactive');
    const inactive = products.length - active.length;
    const shopsy = active.filter((p) => p.is_shopsy).length;
    versionLine.textContent = `Version uploaded ${when} — ${active.length} products (${inactive} inactive)`;
    summarySection.innerHTML = `
      <h2>Active data</h2>
      <p class="muted">All: ${active.length} · Flipkart: ${active.length - shopsy} · Shopsy: ${shopsy}</p>
    `;
  } catch (e) {
    versionLine.textContent = `Can't reach the server: ${e.message}`;
  }
}

initUpload({ root: document.querySelector('#upload-section'), onChanged: reload });
initVersions({ root: document.querySelector('#versions-section'), onChanged: reload });
reload();
