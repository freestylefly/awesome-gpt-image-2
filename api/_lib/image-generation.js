const DEFAULT_CIYUAN_BASE_URL = 'https://ciyuan.today';
const DEFAULT_ATLASCLOUD_BASE_URL = 'https://api.atlascloud.ai/api/v1';
const DEFAULT_ATLASCLOUD_MODEL = 'openai/gpt-image-2/text-to-image';
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

export function getImageGenerationProvider() {
  return (process.env.IMAGE_GENERATION_PROVIDER || 'ciyuan').trim().toLowerCase();
}

export function isImageGenerationConfigured() {
  const provider = getImageGenerationProvider();
  if (provider === 'ciyuan') return Boolean(process.env.CIYUAN_API_KEY);
  if (provider === 'atlascloud') return Boolean(process.env.ATLASCLOUD_API_KEY);
  return false;
}

async function readJson(response, operation) {
  const payload = await response.json().catch(() => ({}));
  if (response.ok) return payload;

  const message = payload?.error?.message
    || payload?.message
    || `${operation} failed with status ${response.status}`;
  const error = new Error(message);
  error.status = response.status;
  error.code = payload?.error?.code || payload?.code;
  error.type = payload?.error?.type || payload?.type;
  throw error;
}

async function generateWithCiyuan(prompt, fetchImpl) {
  const baseUrl = (process.env.CIYUAN_BASE_URL || DEFAULT_CIYUAN_BASE_URL).replace(/\/$/, '');
  const response = await fetchImpl(`${baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CIYUAN_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'low',
      format: 'jpeg'
    })
  });
  const payload = await readJson(response, 'Image generation');
  const b64 = payload?.data?.[0]?.b64_json;
  if (!b64) {
    const error = new Error('Image generation response did not include image data');
    error.status = response.status;
    throw error;
  }
  return `data:image/jpeg;base64,${b64}`;
}

function unwrapPrediction(payload) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
}

function predictionError(prediction) {
  const detail = prediction?.error || prediction?.message || prediction?.status || 'unknown error';
  return typeof detail === 'string' ? detail : JSON.stringify(detail);
}

async function pollAtlasPrediction(id, fetchImpl, sleep, now, maxPollMs) {
  const baseUrl = (process.env.ATLASCLOUD_BASE_URL || DEFAULT_ATLASCLOUD_BASE_URL).replace(/\/$/, '');
  const startedAt = now();
  let delayMs = 2000;

  while (now() - startedAt < maxPollMs) {
    await sleep(delayMs);
    const response = await fetchImpl(`${baseUrl}/model/result/${encodeURIComponent(id)}`, {
      headers: {
        Authorization: `Bearer ${process.env.ATLASCLOUD_API_KEY}`,
        'User-Agent': 'awesome-gpt-image-2/atlascloud'
      }
    });
    const prediction = unwrapPrediction(await readJson(response, 'Atlas Cloud prediction'));
    const status = String(prediction?.status || '').toLowerCase();
    if (status === 'completed' || status === 'succeeded') return prediction;
    if (['failed', 'canceled', 'cancelled'].includes(status)) {
      throw new Error(`Atlas Cloud prediction ${status}: ${predictionError(prediction)}`);
    }
    delayMs = Math.min(Math.ceil(delayMs * 1.5), 15000);
  }

  throw new Error(`Atlas Cloud prediction timed out after ${Math.floor(maxPollMs / 1000)}s`);
}

async function outputToDataUrl(output, fetchImpl) {
  if (output.startsWith('data:')) return output;
  if (!/^https?:\/\//i.test(output)) return `data:image/jpeg;base64,${output}`;

  const response = await fetchImpl(output);
  if (!response.ok) {
    const error = new Error(`Atlas Cloud image download failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${bytes.toString('base64')}`;
}

async function generateWithAtlasCloud(prompt, options) {
  const { fetchImpl, sleep, now, maxPollMs } = options;
  const baseUrl = (process.env.ATLASCLOUD_BASE_URL || DEFAULT_ATLASCLOUD_BASE_URL).replace(/\/$/, '');
  const model = process.env.ATLASCLOUD_IMAGE_MODEL || DEFAULT_ATLASCLOUD_MODEL;

  // This billable task submission is deliberately issued exactly once.
  const response = await fetchImpl(`${baseUrl}/model/generateImage`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.ATLASCLOUD_API_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'awesome-gpt-image-2/atlascloud'
    },
    body: JSON.stringify({
      model,
      prompt,
      size: '1024x1024',
      quality: 'low',
      output_format: 'jpeg',
      enable_base64_output: true
    })
  });
  let prediction = unwrapPrediction(await readJson(response, 'Atlas Cloud generation'));
  const status = String(prediction?.status || '').toLowerCase();
  if (status !== 'completed' && status !== 'succeeded') {
    if (!prediction?.id) throw new Error('Atlas Cloud response did not include a prediction ID');
    prediction = await pollAtlasPrediction(prediction.id, fetchImpl, sleep, now, maxPollMs);
  }

  const output = prediction?.outputs?.[0];
  if (!output || typeof output !== 'string') {
    throw new Error('Atlas Cloud prediction did not include image data');
  }
  return outputToDataUrl(output, fetchImpl);
}

export async function generateImage(prompt, options = {}) {
  const provider = getImageGenerationProvider();
  const runtime = {
    fetchImpl: options.fetchImpl || globalThis.fetch,
    sleep: options.sleep || ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))),
    now: options.now || Date.now,
    maxPollMs: options.maxPollMs || DEFAULT_POLL_TIMEOUT_MS
  };

  if (provider === 'ciyuan') return generateWithCiyuan(prompt, runtime.fetchImpl);
  if (provider === 'atlascloud') return generateWithAtlasCloud(prompt, runtime);
  throw new Error(`Unsupported image generation provider: ${provider}`);
}
