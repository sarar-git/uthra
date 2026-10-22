// mirror-images: copies Flipkart CDN images for the ACTIVE version into the
// public product-images bucket. Idempotent: skips anything already stored and
// retries previous failures whenever it runs (called after every publish).
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'product-images';
const CONCURRENCY = 5;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Product = {
  version_id: string;
  fsn: string;
  image_src: string[] | null;
  image_paths: string[] | null;
};

function needsWork(p: Product): boolean {
  const srcs = p.image_src ?? [];
  if (!srcs.length) return false;
  const paths = p.image_paths ?? [];
  return srcs.some((_, i) => !paths[i]);
}

async function existingIndices(fsn: string): Promise<Set<number>> {
  const set = new Set<number>();
  const { data, error } = await admin.storage.from(BUCKET).list(fsn, { limit: 100 });
  if (!error && data) {
    for (const f of data) {
      const m = /^(\d+)\.jpg$/.exec(f.name);
      if (m) set.add(Number(m[1]));
    }
  }
  return set;
}

async function mirrorImage(fsn: string, index: number, url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? 'image/jpeg';
    const bytes = new Uint8Array(await res.arrayBuffer());
    const path = `${fsn}/${index}.jpg`;
    const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: type,
      upsert: false,
    });
    if (error && !/already exists/i.test(error.message)) return null;
    return path;
  } catch {
    return null;
  }
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(n, queue.length)) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) break;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const { data: products, error } = await admin
    .from('active_products')
    .select('version_id, fsn, image_src, image_paths')
    .neq('status', 'inactive');

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const targets = (products ?? []).filter(needsWork);
  let updated = 0;
  let imagesMirrored = 0;
  let failed = 0;

  await pool(targets, CONCURRENCY, async (p) => {
    const srcs = p.image_src ?? [];
    const have = await existingIndices(p.fsn);
    const paths: string[] = [];

    for (let i = 0; i < srcs.length; i++) {
      if (have.has(i)) {
        paths[i] = `${p.fsn}/${i}.jpg`;
        continue;
      }
      const saved = await mirrorImage(p.fsn, i, srcs[i]);
      if (saved) {
        paths[i] = saved;
        imagesMirrored += 1;
      } else {
        failed += 1;
      }
    }

    const finalPaths = srcs.map((_, i) => paths[i] ?? null);
    const changed = finalPaths.some((v, i) => (p.image_paths?.[i] ?? null) !== v);
    if (changed) {
      const { error: upErr } = await admin
        .from('products')
        .update({ image_paths: finalPaths })
        .eq('version_id', p.version_id)
        .eq('fsn', p.fsn);
      if (!upErr) updated += 1;
    }
  });

  return new Response(
    JSON.stringify({
      scanned: products?.length ?? 0,
      needing: targets.length,
      updated,
      imagesMirrored,
      failed,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
