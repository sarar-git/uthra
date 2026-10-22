# Flipkart / Shopsy Catalog Viewer: Implementation Plan (OpenCode)

**Stack:** Vite + vanilla JS (or React) + SheetJS in the browser, Supabase (Postgres + Storage), hosted on Vercel.
**Users:** you and your team. No login (decided).

---

## 1. Goal

A product-list web page (no product detail page). You upload two Excel files, a **catalog file** and a **listings file**. The browser parses and validates them, and after you confirm, the data is saved to Supabase as a new **version**. One version is always marked **active**, and that is what everyone sees.

**Each card shows:** image, product name, MRP, selling price, bank settlement price (plus brand, category, sizes, stock, status).

**Page layout:**
- A **full-width tab bar pinned to the very top**: All / Flipkart / Shopsy
- Under it, a sticky filter bar: brand buttons, category buttons, search, in-stock toggle

---

## 2. Decisions (locked)

| Area | Decision |
|---|---|
| Backend | Supabase (Storage + Postgres) |
| Hosting | Vercel (static site) |
| Users | You and your team, no login or access control |
| What is stored | Raw Excel files (audit) and parsed rows (for the page) |
| Parsing | In the browser, then send the clean data to Supabase |
| Versions | Every upload creates a version; exactly one is active |
| Match key | **FSN** (`Flipkart Serial Number`) |
| FSN missing from new file | Mark **inactive** (kept, not deleted) |
| FSN new in new file | Mark **new** |
| Filters after upload | Reset |
| Safety checks | All of them (section 6) |
| Prices | One price set per FSN. No separate Flipkart vs Shopsy prices |
| Marketplace | Column `Is Shopsy Listings?` with TRUE / FALSE |
| Images | Download and self-host in Supabase Storage |
| History | No price/stock history feature (versions are snapshots only) |
| Uploads | Manual only |
| Notifications | None |
| On error | Show the last cached data with a banner |
| Product rules | **Decide later** (section 11) |

---

## 3. Input files and column map

### Catalog file: `uthra_catalog.xlsx` (123 rows)

| Need | Column |
|---|---|
| **Match key** | `Flipkart Serial Number` |
| SKU (display) | `Seller SKU ID` |
| Variant grouping | `Group ID` |
| Brand | `Brand` (merge case variants: UTHRA/uthra/Uthra, KALKI/Kalki) |
| Type | `Type` (Nighty, Nightdress) |
| Images | `Main Image URL`, `Other Image URL 1` to `6` |
| Size / colour | `Brand Size`, `Color` |
| Style | `Style Code`, `Pattern` |

### Listings file: `uthra_flipkart_pricing.xlsx` (147 rows)

| Need | Column |
|---|---|
| **Match key** | `Flipkart Serial Number` |
| SKU (display) | `Seller SKU Id` (note: `Id`, not `ID`) |
| Product name | `Product Title` |
| MRP | `MRP` |
| Selling price | `Your Selling Price` |
| Bank settlement | `Bank Settlement` |
| Stock | `System Stock count` |
| Category | `Sub-category` (`night_dress_nighty`, `petticoat`) |
| **Marketplace** | `Is Shopsy Listings?` (TRUE / FALSE) |
| Other | `Listing ID`, `Benchmark Price`, `Fulfillment By` |

**Action needed:** `Is Shopsy Listings?` does not exist in either file you uploaded. Add it to the listings file before the first real upload. If the column is missing, the app treats every row as FALSE (Flipkart) and shows a warning.

Keep **all header names in `config.js`** so an export format change is a one-line fix.

### What the sample data showed
- All 123 catalog FSNs match a listings row. No duplicate FSNs, SKUs or listing IDs.
- 24 listings have no catalog entry: all petticoats (brands HONEY, ROSE), so no images.
- No blanks in MRP, selling price or settlement price.
- 70 of 147 listings have stock 0.

---

## 4. Marketplace logic

Each FSN is one listing with one set of prices. The tabs use `Is Shopsy Listings?`:

| Tab | Shows |
|---|---|
| All | every listing |
| Flipkart | rows where `Is Shopsy Listings?` = FALSE |
| Shopsy | rows where `Is Shopsy Listings?` = TRUE |

Assumption: Flipkart and Shopsy are exclusive views of the same list. If a Shopsy listing should also appear under Flipkart, change the Flipkart tab to show all rows. Accepted values: TRUE/FALSE (any case), 1/0, yes/no. Anything else gives a warning.

---

## 5. Data model (Supabase)

### Storage buckets
- `raw-uploads`: private. Original Excel files, path `{version_id}/catalog.xlsx` and `{version_id}/listings.xlsx`.
- `product-images`: public. Self-hosted images, path `{fsn}/{n}.jpg`.

### Tables

```sql
create table versions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  is_active boolean default false,
  catalog_path text,
  listings_path text,
  catalog_rows int,
  listings_rows int,
  quality_report jsonb,
  note text
);
-- exactly one active version at any time
create unique index one_active_version on versions (is_active) where is_active;

create table products (
  version_id uuid references versions(id) on delete cascade,
  fsn text,
  sku text,
  group_id text,
  title text,
  brand text,
  category text,
  color text,
  style_code text,
  sizes text[],
  mrp numeric,
  selling_price numeric,
  settlement_price numeric,
  stock int,
  is_shopsy boolean default false,
  status text check (status in ('new','existing','inactive')),
  image_src text[],       -- original Flipkart CDN URLs
  image_paths text[],     -- self-hosted paths in product-images
  primary key (version_id, fsn)
);

create view active_products as
  select p.* from products p join versions v on v.id = p.version_id where v.is_active;
```

### Publish and rollback
A Postgres function `publish_version(version_id)` sets `is_active = false` on all versions, then `true` on the chosen one, in a single transaction. **Rollback is the same call with an older version id.**

---

## 6. Upload flow (with the full safety checklist)

1. **Select files.** Two slots: catalog and listings. Either can be uploaded alone; the other is carried forward from the active version.
2. **Parse in the browser** with SheetJS, using `config.js` header names.
3. **Validate and build the preview.** Compare against the active version to compute each FSN's status.
4. **Show the preview and the data-quality report.**
5. **Block on errors; warn on soft issues** (below).
6. **Confirm:** a "Publish this version" button.
7. **Save:** upload raw files to `raw-uploads`, insert the version and product rows, call `publish_version`.
8. **Mirror images** (section 7) for new FSNs.
9. **Reload the grid** and reset the filters.

### Status rules (match key = FSN, compared with the previous active version)
- FSN not in the previous version: **new**
- FSN in both: **existing**
- FSN in the previous version but missing from the newly uploaded file: **inactive** (kept in the data, shown as inactive)
- An inactive FSN that reappears: **existing**

### Blocking errors (upload cannot be published)
- Required column missing (FSN, price columns, title)
- File has zero data rows
- Duplicate FSNs inside one file
- Non-numeric MRP, selling price or settlement price
- Zero FSN overlap between catalog and listings (likely the wrong file in a slot)
- Wrong file in the wrong slot (headers don't match)

### Warnings (can be published after review)
- Listings with no catalog entry; catalog items with no listing
- Stock 0 rows (count)
- Missing images
- `Is Shopsy Listings?` missing or has invalid values
- Selling price above MRP, or settlement above selling price
- Row count dropped sharply (for example more than 30%) against the active version
- Brand case variants merged

### Safety extras
- Raw files are kept for every version.
- One-click **rollback** to any previous version.
- Keep all versions for now. Files are small. Add a retention limit later if needed.

---

## 7. Image self-hosting

The browser usually cannot download Flipkart CDN images because of cross-origin rules, so this runs on the server side.

- After a publish, a Supabase **Edge Function** (or one small Vercel API route) downloads images for **new FSNs only**, skipping any already stored, and saves them to `product-images`.
- Store the original URL in `image_src` and the stored path in `image_paths`.
- The page uses the self-hosted image, and falls back to the Flipkart URL until the copy exists.
- Make the job idempotent and retry failures on the next publish.
- This is the one piece of server logic beyond plain database calls.

---

## 8. Page behaviour

- On load, fetch `active_products` (about 150 rows, one request).
- **Cache** the last successful result in the browser (localStorage or IndexedDB). If the request fails, show the cached data with a banner: "Can't reach the server. Showing data from {time}."
- Show "Version uploaded {date}" on the page.
- **Top tab bar** (full width, pinned):

```html
<nav class="tabs">
  <button class="on">All</button>
  <button>Flipkart</button>
  <button>Shopsy</button>
</nav>
```

```css
body { margin: 0; }
.tabs { position: sticky; top: 0; z-index: 6; display: flex; width: 100%; height: 52px; }
.tabs button { flex: 1; height: 100%; border: 0; border-bottom: 3px solid transparent; font-weight: 700; cursor: pointer; }
.tabs button.on { border-bottom-color: #2874f0; }
```

  The filter bar uses `position: sticky; top: 52px`. Each tab shows a live count.
- **Filters:** tabs, brand buttons, category buttons, search (name, SKU, FSN), in-stock toggle. All combine with AND, with live counts. A "Clear all" control. Filters reset after every upload.
- **Card:** image (hover swaps to second image, fallback on error), marketplace badge, brand, title, category, sizes, MRP (struck through), selling price, settlement price, stock badge, and a "New" or "Inactive" badge from the status.
- Prices formatted in INR with Indian digit grouping.

---

## 9. Phased build plan for OpenCode

Give OpenCode one phase at a time and check each result.

**Phase 0: Setup and inspection**
Create the Vite project with `config.js`, a `/samples` folder, and a Supabase project (URL and anon key in `.env`). Have OpenCode print headers and sample rows of both files and confirm section 3.

**Phase 1: Supabase schema**
Create the buckets, tables, the unique-active index, the `active_products` view and the `publish_version` function (section 5). Test publish and rollback with hand-made rows.

**Phase 2: Parse, merge and validate (browser)**
Parse both files, join on FSN, normalize brands, group variants, parse `Is Shopsy Listings?`, compute statuses against the active version, and produce the quality report with blocking errors and warnings (section 6).

**Phase 3: Upload UI and publish**
Two upload slots, preview and report panel, errors that name the problem, the Publish button, saving raw files and rows, and calling `publish_version`. Add a versions list with a rollback button.

**Phase 4: Product grid and filters**
Top tab bar, filter bar, product cards and live-count filters (section 8). Show status badges.

**Phase 5: Cache and error handling**
Cache the last good data and show the offline banner. Handle upload failures cleanly: nothing is activated unless every save step succeeds.

**Phase 6: Image self-hosting**
The Edge Function that mirrors new-FSN images, plus the fallback logic in the grid.

**Phase 7: Deploy**
Deploy to Vercel with the Supabase URL and anon key as environment variables. Test an end-to-end upload, a second upload (new, existing and inactive FSNs), and a rollback.

---

## 10. Test checklist

- [ ] Both files upload and the preview counts match the source files
- [ ] Wrong file in a slot is blocked with a clear message
- [ ] Missing `Is Shopsy Listings?` column gives a warning and defaults to Flipkart
- [ ] Shopsy and Flipkart tabs filter correctly and show correct counts
- [ ] Brand, category, search and in-stock filters combine correctly
- [ ] Re-upload with a removed FSN marks it inactive; a new FSN is marked new
- [ ] Only one version is active after any publish or rollback
- [ ] Rollback restores the previous data
- [ ] Raw files exist in storage for every version
- [ ] New-FSN images are mirrored and display from Supabase
- [ ] Server unreachable: cached data and the banner appear
- [ ] Tab bar is full width, pinned on desktop and mobile

---

## 11. Open items (decide later)

- Show or hide out-of-stock items by default
- Show the 24 HONEY / ROSE petticoats (no catalog data, no images)?
- Does Sriponsankar belong in the view?
- Size variants with different prices: show a range or per-size prices?
- Does a Shopsy listing also appear under the Flipkart tab? (section 4)
- Version retention limit

## 12. Risks to be aware of

- **No login means anyone with the Vercel URL can view settlement prices**, and anyone with the Supabase anon key in the page can write data unless row-level security blocks it. You chose no access control, so the plan follows that. The cheapest guard when you want one: an unlisted URL plus a shared upload passcode checked in one small API route, with the database writable only through that route. Add it later without changing the rest.
- **The Supabase anon key is visible in the browser** by design. Keep the `raw-uploads` bucket private and allow public reads only on `active_products` and `product-images`.
- **Flipkart changes export headers sometimes.** Header names live in `config.js` so a change is one edit.
