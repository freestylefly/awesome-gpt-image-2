import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import middleware from '../middleware.ts';

const site = 'https://gpt-image2.canghe.ai';
const headers = { referer: 'https://github.com/' };
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));

test('README links can open the spotlight and individual comparisons', () => {
  for (const path of ['/gpt-image-2-5', '/gpt-image-2-5/', '/gpt-image-2-5/?case=gallery-532-test']) {
    assert.equal(middleware(new Request(site + path, { headers })), undefined, path);
  }
});

test('spotlight HTML can be revalidated while fingerprinted assets stay immutable', () => {
  function cacheControl(path) {
    const rule = config.headers.find(({ source }) => new RegExp('^' + source + '$').test(path));
    return rule?.headers.find(({ key }) => key === 'Cache-Control')?.value || '';
  }
  for (const path of ['/gpt-image-2-5', '/gpt-image-2-5/', '/gpt-image-2-5/index.html']) {
    assert.match(cacheControl(path), /\bno-cache\b/, path);
  }
  assert.match(cacheControl('/assets/image25-abcd.js'), /\bimmutable\b/);
});
