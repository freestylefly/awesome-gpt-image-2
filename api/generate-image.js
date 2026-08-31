import {
  getAuthContext,
  getProfileById,
  isSupabaseServerConfigured
} from './_lib/supabase.js';
import {
  generateImage,
  isImageGenerationConfigured
} from './_lib/image-generation.js';

const MAX_PROMPT_LENGTH = 6000;

function json(res, status, payload) {
  res.status(status).json(payload);
}

function isServerConfigured() {
  return Boolean(isImageGenerationConfigured() && isSupabaseServerConfigured());
}

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function normalizeReservation(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.reservation_id) return null;
  return {
    reservationId: row.reservation_id,
    usedFreeGeneration: Boolean(row.used_free_generation),
    creditAmount: Number(row.credit_amount || 0),
    freeGenerationsUsed: Number(row.free_generations_used || 0),
    creditBalance: Number(row.credit_balance || 0)
  };
}

function profileFromReservation(profile, reservation) {
  if (!profile || !reservation) return profile;
  const usage = profile.usage || {};
  return {
    ...profile,
    creditBalance: reservation.creditBalance,
    freeGenerationsUsed: reservation.freeGenerationsUsed,
    freeUsed: reservation.freeGenerationsUsed >= 1,
    usage: {
      ...usage,
      totalGenerations: Number(usage.totalGenerations || 0) + 1,
      totalGenerationCredits: Number(usage.totalGenerationCredits || 0) + Number(reservation.creditAmount || 0)
    }
  };
}

async function reserveGeneration(client, userId, caseId, prompt) {
  const { data, error } = await client.rpc('reserve_generation_usage', {
    p_user_id: userId,
    p_case_id: caseId,
    p_prompt: prompt,
    p_force_credit: false
  });

  if (error) {
    const normalizedMessage = String(error.message || error.details || '').toUpperCase();
    if (normalizedMessage.includes('CREDITS_REQUIRED')) {
      const limitError = new Error('CREDITS_REQUIRED');
      limitError.code = 'CREDITS_REQUIRED';
      throw limitError;
    }
    throw error;
  }

  const reservation = normalizeReservation(data);
  if (!reservation) throw new Error('RESERVATION_FAILED');
  return reservation;
}

async function reserveCreditGeneration(client, userId, caseId, prompt) {
  const { data, error } = await client.rpc('reserve_generation_usage', {
    p_user_id: userId,
    p_case_id: caseId,
    p_prompt: prompt,
    p_force_credit: true
  });

  if (error) {
    const normalizedMessage = String(error.message || error.details || '').toUpperCase();
    if (normalizedMessage.includes('CREDITS_REQUIRED')) {
      const limitError = new Error('CREDITS_REQUIRED');
      limitError.code = 'CREDITS_REQUIRED';
      throw limitError;
    }
    throw error;
  }

  const reservation = normalizeReservation(data);
  if (!reservation) throw new Error('RESERVATION_FAILED');
  return reservation;
}

async function completeReservation(client, reservationId) {
  const { error } = await client.rpc('complete_generation_reservation', {
    p_reservation_id: reservationId
  });
  if (error) throw error;
}

async function releaseReservation(client, reservationId, errorCode) {
  if (!reservationId) return;
  const { error } = await client.rpc('release_generation_reservation', {
    p_reservation_id: reservationId,
    p_error_code: errorCode || 'GENERATION_FAILED'
  });
  if (error) {
    console.warn('Failed to release generation reservation', {
      reservationId,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
  }
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!isServerConfigured()) {
    return json(res, 500, { ok: false, error: 'SERVER_NOT_CONFIGURED' });
  }

  const auth = await getAuthContext(req, { allowAnonymous: req.method === 'GET' });
  if (auth.error) {
    return json(res, auth.status || 401, {
      ok: false,
      error: auth.error,
      loginRequired: auth.error === 'AUTH_REQUIRED'
    });
  }

  if (req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      authRequired: !auth.profile,
      freeUsed: Boolean(auth.profile?.freeUsed),
      user: auth.profile || null
    });
  }

  if (!auth.user || !auth.profile) {
    return json(res, 401, { ok: false, error: 'AUTH_REQUIRED', loginRequired: true });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { ok: false, error: 'INVALID_PROMPT' });
  }

  const prompt = String(body.prompt || '').trim();
  const caseId = Number(body.caseId);
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH || !Number.isFinite(caseId)) {
    return json(res, 400, { ok: false, error: 'INVALID_PROMPT' });
  }

  let reservation;
  try {
    reservation = auth.profile.isSuperAdmin
      ? await reserveCreditGeneration(auth.client, auth.user.id, caseId, prompt)
      : await reserveGeneration(auth.client, auth.user.id, caseId, prompt);
  } catch (error) {
    if (error?.code === 'CREDITS_REQUIRED') {
      return json(res, 402, { ok: false, error: 'CREDITS_REQUIRED' });
    }
    console.warn('Failed to reserve generation usage', {
      userId: auth.user.id,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return json(res, 500, { ok: false, error: 'GENERATION_FAILED' });
  }

  try {
    const image = await generateImage(prompt);
    await completeReservation(auth.client, reservation.reservationId);
    return json(res, 200, {
      ok: true,
      image,
      user: profileFromReservation(auth.profile, reservation)
    });
  } catch (error) {
    console.warn('Image generation failed', {
      status: error?.status || null,
      code: error?.code || null,
      type: error?.type || null,
      message: String(error?.message || 'unknown').slice(0, 240)
    });

    const errorCode = error?.status === 429 ? 'UPSTREAM_BUSY' : 'GENERATION_FAILED';
    await releaseReservation(auth.client, reservation.reservationId, errorCode);

    const refreshedProfile = await getProfileById(auth.user.id).catch(() => null);
    if (error?.status === 429) {
      return json(res, 503, { ok: false, error: 'UPSTREAM_BUSY', user: refreshedProfile });
    }
    return json(res, 502, { ok: false, error: 'GENERATION_FAILED', user: refreshedProfile });
  }
}
