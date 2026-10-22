import { parseSheet } from '../lib/parse.js';
import { analyze } from '../lib/build.js';
import {
  previousToCatalogRows,
  previousToListingsRows,
  catalogHeadersFromPrevious,
  listingsHeadersFromPrevious,
} from '../lib/carry.js';
import { getActiveProducts, getActiveVersion, uploadRawFile, saveAndPublish, cleanupVersion } from '../lib/db.js';

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function initUpload({ root, onChanged }) {
  root.innerHTML = `
    <h2>Upload new version</h2>
    <div class="slots">
      <label class="slot">
        <span>Catalog file</span>
        <input type="file" id="file-catalog" accept=".xlsx,.xls" />
        <span class="slot-name muted" id="name-catalog">none — will carry forward from active version</span>
      </label>
      <label class="slot">
        <span>Listings file</span>
        <input type="file" id="file-listings" accept=".xlsx,.xls" />
        <span class="slot-name muted" id="name-listings">none — will carry forward from active version</span>
      </label>
    </div>
    <div class="actions">
      <button id="btn-preview">Preview &amp; validate</button>
      <button id="btn-publish" disabled>Publish this version</button>
      <input id="upload-note" class="note" placeholder="version note (optional)" />
    </div>
    <div id="report"></div>
    <div id="preview-summary"></div>
  `;

  const catalogInput = root.querySelector('#file-catalog');
  const listingsInput = root.querySelector('#file-listings');
  const nameCatalog = root.querySelector('#name-catalog');
  const nameListings = root.querySelector('#name-listings');
  const btnPreview = root.querySelector('#btn-preview');
  const btnPublish = root.querySelector('#btn-publish');
  const noteInput = root.querySelector('#upload-note');
  const reportEl = root.querySelector('#report');
  const summaryEl = root.querySelector('#preview-summary');

  let catalogFile = null;
  let listingsFile = null;
  let analysis = null;
  let previous = [];
  let activeMeta = null;

  catalogInput.addEventListener('change', () => {
    catalogFile = catalogInput.files[0] ?? null;
    nameCatalog.textContent = catalogFile ? catalogFile.name : 'none — will carry forward from active version';
    resetAnalysis();
  });

  listingsInput.addEventListener('change', () => {
    listingsFile = listingsInput.files[0] ?? null;
    nameListings.textContent = listingsFile ? listingsFile.name : 'none — will carry forward from active version';
    resetAnalysis();
  });

  function resetAnalysis() {
    analysis = null;
    btnPublish.disabled = true;
    reportEl.innerHTML = '';
    summaryEl.innerHTML = '';
  }

  function renderReport(report) {
    const counts = [
      ['Catalog rows', report.catalogRows],
      ['Listings rows', report.listingsRows],
      ['Matched to catalog', report.matched],
      ['No catalog entry', report.listingsWithoutCatalog],
      ['No listing (not shown)', report.catalogWithoutListing],
      ['Stock 0', report.stockZero],
      ['No images', report.missingImages],
      ['New', report.newCount],
      ['Existing', report.existingCount],
      ['Inactive carried', report.inactiveCarried],
      ['Shopsy listings', report.shopsyCount],
    ];
    reportEl.innerHTML = `
      <h3>Data-quality report</h3>
      <div class="counts">${counts.map(([k, v]) => `<div class="count"><b>${v}</b><span>${k}</span></div>`).join('')}</div>
      ${
        report.errors.length
          ? `<div class="panel errors"><b>Blocking errors (${report.errors.length})</b><ul>${report.errors
              .map((e) => `<li>${escapeHtml(e.message)}</li>`)
              .join('')}</ul></div>`
          : ''
      }
      ${
        report.warnings.length
          ? `<div class="panel warnings"><b>Warnings (${report.warnings.length})</b><ul>${report.warnings
              .map((w) => `<li>${escapeHtml(w.message)}</li>`)
              .join('')}</ul></div>`
          : '<p class="muted">No warnings.</p>'
      }
    `;
  }

  btnPreview.addEventListener('click', async () => {
    resetAnalysis();
    btnPreview.disabled = true;
    try {
      [previous, activeMeta] = await Promise.all([getActiveProducts(), getActiveVersion()]);

      if (!catalogFile && !listingsFile) {
        reportEl.innerHTML =
          '<div class="panel errors"><b>Select at least one file</b><p>The other file is carried forward from the active version.</p></div>';
        return;
      }
      if (!previous.length && (!catalogFile || !listingsFile)) {
        reportEl.innerHTML =
          '<div class="panel errors"><b>Both files are required for the first upload</b><p>There is no active version to carry the missing file from.</p></div>';
        return;
      }

      let catalogHeaders = [];
      let catalogRows = [];
      let listingsHeaders = [];
      let listingsRows = [];

      if (catalogFile) {
        ({ headers: catalogHeaders, rows: catalogRows } = parseSheet(await catalogFile.arrayBuffer()));
      } else {
        catalogHeaders = catalogHeadersFromPrevious();
        catalogRows = previousToCatalogRows(previous);
      }

      if (listingsFile) {
        ({ headers: listingsHeaders, rows: listingsRows } = parseSheet(await listingsFile.arrayBuffer()));
      } else {
        listingsHeaders = listingsHeadersFromPrevious();
        listingsRows = previousToListingsRows(previous);
      }

      analysis = analyze({ catalogHeaders, catalogRows, listingsHeaders, listingsRows, previous });
      renderReport(analysis.report);

      summaryEl.innerHTML = analysis.report.canPublish
        ? `<p class="ok">${analysis.products.length} products ready to publish.</p>`
        : '<p class="bad">Fix the blocking errors above before publishing.</p>';
      btnPublish.disabled = !analysis.report.canPublish;
    } catch (e) {
      reportEl.innerHTML = `<div class="panel errors"><b>Preview failed</b><p>${escapeHtml(e.message)}</p></div>`;
    } finally {
      btnPreview.disabled = false;
    }
  });

  btnPublish.addEventListener('click', async () => {
    if (!analysis?.report.canPublish) return;
    if (!confirm(`Publish this version?\n${analysis.products.length} products will go live.`)) return;

    btnPublish.disabled = true;
    btnPreview.disabled = true;
    const versionId = crypto.randomUUID();
    const uploaded = [];
    try {
      let catalogPath = activeMeta?.catalog_path ?? null;
      let listingsPath = activeMeta?.listings_path ?? null;

      if (catalogFile) {
        catalogPath = await uploadRawFile(versionId, 'catalog.xlsx', catalogFile);
        uploaded.push(catalogPath);
      }
      if (listingsFile) {
        listingsPath = await uploadRawFile(versionId, 'listings.xlsx', listingsFile);
        uploaded.push(listingsPath);
      }

      await saveAndPublish({
        versionId,
        catalogPath,
        listingsPath,
        catalogRows: analysis.report.catalogRows,
        listingsRows: analysis.report.listingsRows,
        report: analysis.report,
        note: noteInput.value.trim(),
        products: analysis.products,
      });

      catalogInput.value = '';
      listingsInput.value = '';
      catalogFile = null;
      listingsFile = null;
      nameCatalog.textContent = 'none — will carry forward from active version';
      nameListings.textContent = 'none — will carry forward from active version';
      noteInput.value = '';
      resetAnalysis();
      summaryEl.innerHTML = '<p class="ok">Published. Data reloaded.</p>';
      await onChanged();
    } catch (e) {
      await cleanupVersion(versionId, uploaded).catch(() => {});
      summaryEl.innerHTML = `<div class="panel errors"><b>Publish failed — nothing went live</b><p>${escapeHtml(e.message)}</p></div>`;
      btnPublish.disabled = !analysis?.report.canPublish;
    } finally {
      btnPreview.disabled = false;
    }
  });
}
