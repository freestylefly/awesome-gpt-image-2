import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const docsDir = join(root, 'docs');

const galleryFiles = ['gallery-part-1.md', 'gallery-part-2.md'];

function definedCases() {
  const ids = new Map();
  for (const file of galleryFiles) {
    const text = readFileSync(join(docsDir, file), 'utf8');
    for (const match of text.matchAll(/<a name="case-(\d+)"><\/a>/g)) {
      ids.set(Number(match[1]), file);
    }
  }
  return ids;
}

function indexedCases() {
  const text = readFileSync(join(docsDir, 'gallery.md'), 'utf8');
  const sections = text.split(/<a name="(cat-[^"]+)"><\/a>/g);
  const entries = new Map();
  const countErrors = [];

  for (let i = 1; i < sections.length; i += 2) {
    const categoryId = sections[i];
    const body = sections[i + 1] || '';
    const ids = [...body.matchAll(/#case-(\d+)\)/g)].map((match) => Number(match[1]));
    const stated = Number(body.match(/###[^\n]*·\s*(\d+)\s*cases/)?.[1]);

    if (Number.isFinite(stated) && stated !== ids.length) {
      countErrors.push(`${categoryId}: header says ${stated} cases, list has ${ids.length}`);
    }
    for (const id of ids) {
      if (!entries.has(id)) entries.set(id, []);
      entries.get(id).push(categoryId);
    }
  }

  return { entries, countErrors };
}

const defined = definedCases();
const { entries, countErrors } = indexedCases();

const missing = [...defined.keys()].filter((id) => !entries.has(id)).sort((a, b) => a - b);
const unknown = [...entries.keys()].filter((id) => !defined.has(id)).sort((a, b) => a - b);
const repeated = [...entries]
  .filter(([, categories]) => new Set(categories).size !== categories.length)
  .map(([id, categories]) => `case ${id} listed twice under ${categories.join(', ')}`);

const errors = [];
if (missing.length) {
  errors.push(`Cases missing from docs/gallery.md: ${missing.join(', ')}`);
}
if (unknown.length) {
  errors.push(`docs/gallery.md links cases that do not exist: ${unknown.join(', ')}`);
}
errors.push(...repeated, ...countErrors);

if (errors.length) {
  console.error('Gallery index check failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`Gallery index OK: ${defined.size} cases, all categorised.`);
