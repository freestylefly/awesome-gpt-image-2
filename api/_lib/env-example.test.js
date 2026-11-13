import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(apiRoot, '..');
const envExamplePath = join(repoRoot, '.env.example');

async function listModules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const modules = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      modules.push(...await listModules(entryPath));
    } else if (extname(entry.name) === '.js' && !entry.name.endsWith('.test.js')) {
      modules.push(entryPath);
    }
  }

  return modules;
}

function readEnvironmentNames(source) {
  return [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((match) => match[1]);
}

// A name counts as documented when it appears as its own entry, either as an
// assignment or as a commented-out one showing the default.
function documentedNames(source) {
  return new Set(
    [...source.matchAll(/^\s*#?\s*([A-Z0-9_]+)\s*=/gm)].map((match) => match[1])
  );
}

test('every environment variable read by the API is documented in .env.example', async () => {
  const envExample = await readFile(envExamplePath, 'utf8');
  const documented = documentedNames(envExample);
  const undocumented = new Map();

  for (const modulePath of await listModules(apiRoot)) {
    const source = await readFile(modulePath, 'utf8');
    for (const name of readEnvironmentNames(source)) {
      if (documented.has(name)) continue;
      const relative = modulePath.slice(repoRoot.length + 1).split('\\').join('/');
      if (!undocumented.has(name)) undocumented.set(name, new Set());
      undocumented.get(name).add(relative);
    }
  }

  const report = [...undocumented.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, files]) => `${name} (read by ${[...files].sort().join(', ')})`);

  assert.deepEqual(
    report,
    [],
    `Environment variables missing from .env.example:\n  ${report.join('\n  ')}`
  );
});
