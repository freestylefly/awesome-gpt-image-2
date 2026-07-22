import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function listApiModules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const modules = [];

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      modules.push(...await listApiModules(entryPath));
    } else if (extname(entry.name) === '.js' && !entry.name.endsWith('.test.js')) {
      modules.push(entryPath);
    }
  }

  return modules;
}

test('all Vercel API modules load without broken imports', async () => {
  const modules = await listApiModules(apiRoot);
  assert.ok(modules.length > 0);

  for (const modulePath of modules) {
    await import(pathToFileURL(modulePath).href);
  }
});
