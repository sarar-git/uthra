import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
let failed = false;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
};

const { data: active, error: e1 } = await db.from('active_products').select('*');
check('active_products readable', !e1, e1?.message);
check('active_products empty after smoke cleanup', !e1 && active?.length === 0, `rows: ${active?.length}`);

const { data: versions, error: e2 } = await db.from('versions').select('id');
check('versions readable', !e2, e2?.message);

const { error: e3 } = await db.rpc('publish_version', { p_version_id: '00000000-0000-0000-0000-000000000000' });
check('publish_version callable, rejects unknown id', !!e3 && /not found/i.test(e3.message), e3?.message);

const testPath = 'verify-test/hello.txt';
const { error: eUp } = await db.storage
  .from('raw-uploads')
  .upload(testPath, new Blob(['phase1-verify']), { contentType: 'text/plain' });
check('raw-uploads anon upload allowed', !eUp, eUp?.message);

const { data: listed } = await db.storage.from('raw-uploads').list('verify-test');
check('raw-uploads private (anon list sees nothing)', !eUp && (listed?.length ?? 0) === 0, `listed: ${listed?.length}`);

const { error: eDl } = await db.storage.from('raw-uploads').download(testPath);
check('raw-uploads private (anon download denied)', !!eDl, eDl?.message);

if (!eUp) {
  const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  const { error: eRm } = await admin.storage.from('raw-uploads').remove([testPath]);
  check('test file cleaned up via service key', !eRm, eRm?.message);
}

const { error: e5 } = await db.storage.from('product-images').list();
check('product-images listable by anon', !e5, e5?.message);

process.exit(failed ? 1 : 0);
