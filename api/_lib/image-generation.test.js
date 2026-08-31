import assert from 'node:assert/strict';
import test from 'node:test';

import {
  generateImage,
  getImageGenerationProvider,
  isImageGenerationConfigured
} from './image-generation.js';

function withEnv(t, values) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of previous.entries()) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('Ciyuan remains the default image generation provider', (t) => {
  withEnv(t, {
    IMAGE_GENERATION_PROVIDER: null,
    CIYUAN_API_KEY: 'ciyuan-key',
    ATLASCLOUD_API_KEY: null
  });
  assert.equal(getImageGenerationProvider(), 'ciyuan');
  assert.equal(isImageGenerationConfigured(), true);
});

test('Ciyuan generation keeps the existing request and data URL contract', async (t) => {
  withEnv(t, {
    IMAGE_GENERATION_PROVIDER: null,
    CIYUAN_API_KEY: 'ciyuan-key',
    CIYUAN_BASE_URL: null
  });
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ data: [{ b64_json: 'AQID' }] }), { status: 200 });
  };

  const image = await generateImage('A cat', { fetchImpl });

  assert.equal(image, 'data:image/jpeg;base64,AQID');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://ciyuan.today/v1/images/generations');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    model: 'gpt-image-2',
    prompt: 'A cat',
    n: 1,
    size: '1024x1024',
    quality: 'low',
    format: 'jpeg'
  });
});

test('Atlas Cloud submits once, polls the result endpoint, and returns a data URL', async (t) => {
  withEnv(t, {
    IMAGE_GENERATION_PROVIDER: 'atlascloud',
    ATLASCLOUD_API_KEY: 'atlas-key',
    ATLASCLOUD_IMAGE_MODEL: null,
    ATLASCLOUD_BASE_URL: null
  });
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method || 'GET', body: init.body || null });
    if (url.endsWith('/model/generateImage')) {
      return new Response(JSON.stringify({ id: 'prediction-1', status: 'created' }), { status: 200 });
    }
    if (url.endsWith('/model/result/prediction-1')) {
      return new Response(JSON.stringify({
        status: 'completed',
        outputs: ['https://cdn.example.test/image.jpg']
      }), { status: 200 });
    }
    return new Response(Uint8Array.from([255, 216, 255, 217]), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' }
    });
  };

  const image = await generateImage('A red paper airplane', {
    fetchImpl,
    sleep: async () => {},
    now: () => 0,
    maxPollMs: 1000
  });

  assert.equal(image, 'data:image/jpeg;base64,/9j/2Q==');
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
  assert.deepEqual(JSON.parse(calls[0].body), {
    model: 'openai/gpt-image-2/text-to-image',
    prompt: 'A red paper airplane',
    size: '1024x1024',
    quality: 'low',
    output_format: 'jpeg',
    enable_base64_output: true
  });
  assert.deepEqual(calls.map((call) => call.url), [
    'https://api.atlascloud.ai/api/v1/model/generateImage',
    'https://api.atlascloud.ai/api/v1/model/result/prediction-1',
    'https://cdn.example.test/image.jpg'
  ]);
});

test('Atlas Cloud generation errors do not retry the billable POST', async (t) => {
  withEnv(t, {
    IMAGE_GENERATION_PROVIDER: 'atlascloud',
    ATLASCLOUD_API_KEY: 'atlas-key'
  });
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return new Response(JSON.stringify({ message: 'upstream unavailable' }), { status: 503 });
  };

  await assert.rejects(
    generateImage('A cat', { fetchImpl }),
    /upstream unavailable/
  );
  assert.equal(requests, 1);
});
