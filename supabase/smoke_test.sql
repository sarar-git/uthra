-- Phase 1 smoke test: publish + rollback with hand-made rows (plan section 9, Phase 1).
-- Fails loudly (exception) if any assertion breaks; cleans up after itself.

do $$
declare
  v1 uuid;
  v2 uuid;
  n int;
begin
  delete from versions where note = 'phase1-smoke-test';

  insert into versions (catalog_path, listings_path, catalog_rows, listings_rows, note)
  values ('t/catalog.xlsx', 't/listings.xlsx', 2, 2, 'phase1-smoke-test')
  returning id into v1;

  insert into versions (catalog_path, listings_path, catalog_rows, listings_rows, note)
  values ('t/catalog2.xlsx', 't/listings2.xlsx', 2, 2, 'phase1-smoke-test')
  returning id into v2;

  insert into products (version_id, fsn, sku, title, brand, category, mrp, selling_price, settlement_price, stock, status)
  values
    (v1, 'FSNSMOKE1', 'SKU1', 'Smoke Nighty', 'UTHRA', 'night_dress_nighty', 400, 383, 294, 1, 'new'),
    (v1, 'FSNSMOKE2', 'SKU2', 'Smoke Nightdress', 'UTHRA', 'night_dress_nighty', 500, 450, 350, 0, 'new'),
    (v2, 'FSNSMOKE1', 'SKU1', 'Smoke Nighty', 'UTHRA', 'night_dress_nighty', 400, 390, 300, 2, 'existing'),
    (v2, 'FSNSMOKE3', 'SKU3', 'Smoke New Item', 'KALKI', 'petticoat', 300, 250, 200, 3, 'new');

  -- publish v1
  perform publish_version(v1);
  select count(*) into n from versions where is_active;
  assert n = 1, format('expected 1 active after first publish, got %s', n);
  select count(*) into n from active_products;
  assert n = 2, format('active_products should show 2 rows for v1, got %s', n);

  -- publish v2
  perform publish_version(v2);
  select count(*) into n from versions where is_active;
  assert n = 1, format('expected 1 active after second publish, got %s', n);
  select count(*) into n from active_products where status = 'new';
  assert n = 1, format('v2 should have exactly 1 new FSN, got %s', n);

  -- rollback to v1
  perform publish_version(v1);
  select count(*) into n from active_products where fsn = 'FSNSMOKE3';
  assert n = 0, 'rollback failed: FSNSMOKE3 still visible after rolling back to v1';
  select count(*) into n from versions where is_active;
  assert n = 1, format('expected 1 active after rollback, got %s', n);

  -- unknown id must fail loudly (atomic, rolls back its own work)
  begin
    perform publish_version('00000000-0000-0000-0000-000000000000');
    raise exception 'publish_version accepted an unknown id';
  exception
    when raise_exception then
      if sqlerrm not like 'version % not found%' then raise; end if;
  end;

  delete from versions where note = 'phase1-smoke-test';
  raise notice 'SMOKE TEST PASSED: publish, rollback and one-active invariant all hold.';
end $$;
