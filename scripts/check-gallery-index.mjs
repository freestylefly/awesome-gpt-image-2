import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const galleryFile = join(root, 'docs/gallery.md');
const gallery = readFileSync(galleryFile, 'utf8');
const caseFiles = new Map();
const indexed = new Set();
const counts = new Map();
const errors = [];
const writeCounts = process.argv.includes('--write-counts');

for (const file of ['gallery-part-1.md', 'gallery-part-2.md']) {
  const text = readFileSync(join(root, 'docs', file), 'utf8');
  for (const [, id] of text.matchAll(/<a name="case-(\d+)"><\/a>/g)) {
    if (caseFiles.has(id)) errors.push(`Duplicate case definition: ${id}`);
    caseFiles.set(id, file);
  }
}

const sections = gallery.split(/<a name="(cat-[^"]+)"><\/a>/g);
const summaries = new Map();
for (let i = 1; i < sections.length; i += 2) {
  const category = sections[i];
  const body = sections[i + 1];
  const header = /^(### \S+ (.+?) · )\d+( cases)$/m;
  const title = body.match(header)?.[2];
  if (!title) throw new Error(`Missing category heading for ${category}`);
  const members = new Set();
  for (const [, file, id] of body.matchAll(/\]\(\.\/(gallery-part-\d+\.md)#case-(\d+)\)/g)) {
    if (caseFiles.get(id) !== file) errors.push(`Broken link: ${file}#case-${id}`);
    if (members.has(id)) errors.push(`Case ${id} appears twice in ${category}`);
    members.add(id);
    indexed.add(id);
  }
  counts.set(category, members.size);
  summaries.set(title, members.size);
  sections[i + 1] = body.replace(header, (_, prefix, title, suffix) => prefix + members.size + suffix);
}

for (const id of caseFiles.keys()) {
  if (!indexed.has(id)) errors.push(`Case ${id} is missing from the category index`);
}
if (errors.length) throw new Error(errors.join('\n'));

function updateCounts(file, original, expected) {
  if (original === expected) return;
  if (writeCounts) writeFileSync(file, expected);
  else errors.push(`Stale counts in ${file}. Run npm run sync:gallery-counts.`);
}

const total = caseFiles.size;
sections[0] = sections[0]
  .replace(/当前总案例数为 \d+/, `当前总案例数为 ${total}`)
  .replace(/^- (.+?)：\d+$/gm, (line, title) =>
    summaries.has(title) ? `- ${title}：${summaries.get(title)}` : line);
let updatedGallery = sections[0];
for (let i = 1; i < sections.length; i += 2) {
  updatedGallery += `<a name="${sections[i]}"></a>${sections[i + 1]}`;
}
updateCounts(galleryFile, gallery, updatedGallery);

for (const name of ['README.md', 'README.zh-CN.md', 'README.ja.md']) {
  const file = join(root, name);
  const original = readFileSync(file, 'utf8');
  const expected = original
    .replace(/badge\/Cases-\d+/, `badge/Cases-${total}`)
    .replace(/(Browse all |按分册浏览全部 |全 )\d+( cases by| 个案例| 件のケース)/, (_, before, after) => before + total + after)
    .replace(/\d+( cases<\/sub><\/p>\s*<a href="docs\/gallery\.md#(cat-[\w-]+)")/g, (_, suffix, category) => {
      if (!counts.has(category)) throw new Error(`Unknown category in ${name}: ${category}`);
      return counts.get(category) + suffix;
    });
  updateCounts(file, original, expected);
}

if (errors.length) throw new Error(errors.join('\n'));
console.log(`Gallery index OK: ${total} unique cases in ${counts.size} categories.`);
