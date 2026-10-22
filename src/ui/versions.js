import { getVersions, publishVersionRow } from '../lib/db.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function initVersions({ root, onChanged }) {
  root.innerHTML = `
    <h2>Versions</h2>
    <div id="versions-list" class="muted">Loading…</div>
  `;
  const listEl = root.querySelector('#versions-list');

  async function refresh() {
    try {
      const versions = await getVersions();
      if (!versions.length) {
        listEl.innerHTML = '<p class="muted">No versions yet.</p>';
        return;
      }
      listEl.innerHTML = `<table class="versions">
        <thead>
          <tr><th>When</th><th>Note</th><th>Catalog rows</th><th>Listings rows</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          ${versions
            .map(
              (v) => `<tr class="${v.is_active ? 'active' : ''}">
              <td>${escapeHtml(new Date(v.created_at).toLocaleString('en-IN'))}</td>
              <td>${escapeHtml(v.note || '—')}</td>
              <td>${v.catalog_rows ?? '—'}</td>
              <td>${v.listings_rows ?? '—'}</td>
              <td>${v.is_active ? '<span class="badge on">active</span>' : ''}</td>
              <td>${
                v.is_active
                  ? ''
                  : `<button class="rollback" data-id="${v.id}">Rollback to this</button>`
              }</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>`;

      listEl.querySelectorAll('.rollback').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Rollback to this version? Everyone will see its data.')) return;
          btn.disabled = true;
          try {
            await publishVersionRow(btn.dataset.id);
            await refresh();
            await onChanged();
          } catch (e) {
            alert(`Rollback failed: ${e.message}`);
            btn.disabled = false;
          }
        });
      });
    } catch (e) {
      listEl.innerHTML = `<p class="bad">Can't load versions: ${escapeHtml(e.message)}</p>`;
    }
  }

  refresh();
  return { refresh };
}
