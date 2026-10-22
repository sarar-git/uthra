import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 0) continue;
    out[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
  return out;
}

const env = loadEnv(path.join(root, '.env'));
const token = env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN is missing or empty in .env');
  process.exit(1);
}

const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
if (!supabaseUrl) {
  console.error('SUPABASE_URL missing from .env');
  process.exit(1);
}
const ref = new URL(supabaseUrl).hostname.split('.')[0];

async function runSql(sql, label) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    console.error(`FAILED: ${label}`);
    console.error(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    process.exit(1);
  }
  console.log(`OK: ${label}`);
  return data;
}

const migDir = path.join(root, 'supabase', 'migrations');
const files = fs
  .readdirSync(migDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  console.error('No migration files found in supabase/migrations');
  process.exit(1);
}

for (const f of files) {
  await runSql(fs.readFileSync(path.join(migDir, f), 'utf8'), f);
}

await runSql(fs.readFileSync(path.join(root, 'supabase', 'smoke_test.sql'), 'utf8'), 'smoke_test.sql');

console.log('Phase 1 schema + smoke test applied.');
