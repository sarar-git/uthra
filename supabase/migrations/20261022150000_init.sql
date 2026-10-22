-- Phase 1: buckets, tables, unique-active index, view, publish function (plan section 5)
-- Idempotent: safe to re-run.

-- ===== Storage buckets =====
insert into storage.buckets (id, name, public, file_size_limit)
values ('raw-uploads', 'raw-uploads', false, 52428800)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit)
values ('product-images', 'product-images', true, 52428800)
on conflict (id) do nothing;

-- raw-uploads stays private: no SELECT policy (only dashboard/service role reads it).
-- The browser may only upload audit files. Carry-forward of a slot re-uses the
-- existing path instead of re-uploading bytes.
drop policy if exists "anon insert raw-uploads" on storage.objects;
create policy "anon insert raw-uploads" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'raw-uploads');

drop policy if exists "public read product-images" on storage.objects;
create policy "public read product-images" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'product-images');

-- ===== Tables =====
create table if not exists versions (
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
create unique index if not exists one_active_version on versions (is_active) where is_active;

create table if not exists products (
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

create or replace view active_products as
  select p.* from products p join versions v on v.id = p.version_id where v.is_active;

-- ===== RLS =====
-- No login by design (plan sections 2 and 12): the anon key may read and write.
alter table versions enable row level security;
alter table products enable row level security;

drop policy if exists "public full access versions" on versions;
create policy "public full access versions" on versions
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "public full access products" on products;
create policy "public full access products" on products
  for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on versions to anon, authenticated;
grant select, insert, update, delete on products to anon, authenticated;
grant select on active_products to anon, authenticated, service_role;

-- ===== Publish / rollback (single transaction) =====
create or replace function publish_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from versions where id = p_version_id) then
    raise exception 'version % not found', p_version_id;
  end if;
  update versions set is_active = false where is_active;
  update versions set is_active = true where id = p_version_id;
end;
$$;

revoke execute on function publish_version(uuid) from public;
grant execute on function publish_version(uuid) to anon, authenticated, service_role;
