import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readmes = ['README.md', 'README.zh-CN.md', 'README.ja.md'];

async function migrationNames() {
  const entries = await readdir(resolve(root, 'supabase', 'migrations'));
  return entries.filter((name) => name.endsWith('.sql')).sort();
}

test('every README setup checklist applies every migration', async () => {
  const migrations = await migrationNames();
  assert.ok(migrations.length > 0, 'no migrations found');

  for (const readme of readmes) {
    const text = await readFile(resolve(root, readme), 'utf8');
    const missing = migrations.filter((name) => !text.includes(name));
    assert.deepEqual(
      missing,
      [],
      `${readme} does not apply: ${missing.join(', ')}`
    );
  }
});

test('every migration linked from a README exists', async () => {
  const known = new Set(await migrationNames());

  for (const readme of readmes) {
    const text = await readFile(resolve(root, readme), 'utf8');
    const linked = [...text.matchAll(/supabase\/migrations\/([A-Za-z0-9_]+\.sql)/g)]
      .map((match) => match[1]);
    const broken = [...new Set(linked)].filter((name) => !known.has(name));
    assert.deepEqual(
      broken,
      [],
      `${readme} links missing migrations: ${broken.join(', ')}`
    );
  }
});
