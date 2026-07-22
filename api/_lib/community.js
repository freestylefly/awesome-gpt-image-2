import { parseAlipayAmount } from './alipay.js';

export const COMMUNITY_PRICE_CENTS = 990;
export const COMMUNITY_CURRENCY = 'CNY';
export const COMMUNITY_SUBJECT = 'GPT-Image2 付费交流群长期资格';
export const COMMUNITY_TERMS_VERSION = '2026-07-22';
export const COMMUNITY_PENDING_MINUTES = 30;
export const COMMUNITY_QR_MAX_BYTES = 2 * 1024 * 1024;
export const COMMUNITY_ORDER_STATUSES = Object.freeze([
  'PENDING',
  'PAID',
  'CLOSED',
  'REFUNDED',
  'REVOKED'
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const communityRateBuckets = new Map();

export function isUuid(value) {
  return UUID_PATTERN.test(String(value || '').trim());
}

export function isCommunityPaymentEnabled(env = process.env) {
  return String(env.COMMUNITY_PAYMENT_ENABLED || '').trim().toLowerCase() === 'true';
}

export function communityPublicConfig(env = process.env) {
  return {
    priceCents: COMMUNITY_PRICE_CENTS,
    priceLabel: '¥9.90',
    currency: COMMUNITY_CURRENCY,
    paymentEnabled: isCommunityPaymentEnabled(env),
    support: String(env.COMMUNITY_SUPPORT_TEXT || '微信搜索苍何').trim(),
    refundPolicy: '人工审核后原路退款',
    termsVersion: COMMUNITY_TERMS_VERSION
  };
}

export function communityOrderPayload(userId, termsVersion = COMMUNITY_TERMS_VERSION) {
  return {
    userId,
    amountCents: COMMUNITY_PRICE_CENTS,
    currency: COMMUNITY_CURRENCY,
    subject: COMMUNITY_SUBJECT,
    termsVersion
  };
}

export function serializeCommunityOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    amountCents: Number(row.amount_cents || 0),
    currency: String(row.currency || '').toUpperCase(),
    refundStatus: row.refund_status || 'NONE',
    createdAt: row.created_at || '',
    paidAt: row.paid_at || '',
    refundedAt: row.refunded_at || '',
    revokedAt: row.revoked_at || ''
  };
}

export function canAccessCommunityQr(status) {
  return status === 'PAID';
}

export function isOrderOwnedBy(order, userId) {
  return Boolean(order?.user_id && userId && order.user_id === userId);
}

export function isCommunityAdmin(auth) {
  return Boolean(auth?.profile?.isSuperAdmin || auth?.profile?.role === 'super_admin');
}

export function takeCommunityRateLimit(key, { limit = 30, windowMs = 60_000, now = Date.now() } = {}) {
  const bucketKey = String(key || 'anonymous');
  const current = communityRateBuckets.get(bucketKey);
  if (!current || now >= current.resetAt) {
    communityRateBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  current.count += 1;
  if (current.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    };
  }
  return { allowed: true, remaining: Math.max(0, limit - current.count), retryAfterSeconds: 0 };
}

export function communityRequestRateKey(req, scope, userId = '') {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const remote = forwarded || String(req?.socket?.remoteAddress || 'unknown');
  return `${scope}:${userId || remote}`;
}

export function applyCommunityRateLimit(res, result) {
  if (result.allowed) return true;
  res.setHeader('Retry-After', String(result.retryAfterSeconds));
  res.status(429).json({ ok: false, error: 'RATE_LIMITED' });
  return false;
}

export function shouldExpireCommunityOrder(order, now = Date.now()) {
  if (order?.status !== 'PENDING') return false;
  const createdAt = Date.parse(order.created_at || '');
  if (!Number.isFinite(createdAt)) return true;
  return now - createdAt >= COMMUNITY_PENDING_MINUTES * 60 * 1000;
}

export function communityRefundRequestNo(orderId) {
  if (!isUuid(orderId)) throw new Error('INVALID_COMMUNITY_ORDER');
  return `cg_${String(orderId).replace(/-/g, '')}`;
}

export function isPaidTradeStatus(status) {
  return status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED';
}

export function validateCommunityTradeResult(order, result) {
  if (!order || !result) return { ok: false, error: 'ORDER_RESULT_REQUIRED' };
  if (String(result.out_trade_no || '') !== order.id) {
    return { ok: false, error: 'OUT_TRADE_NO_MISMATCH' };
  }
  const amountCents = parseAlipayAmount(result.total_amount);
  if (amountCents !== Number(order.amount_cents) || amountCents !== COMMUNITY_PRICE_CENTS) {
    return { ok: false, error: 'AMOUNT_MISMATCH' };
  }
  if (String(order.currency || '').toUpperCase() !== COMMUNITY_CURRENCY) {
    return { ok: false, error: 'CURRENCY_MISMATCH' };
  }
  if (result.currency && String(result.currency).toUpperCase() !== COMMUNITY_CURRENCY) {
    return { ok: false, error: 'CURRENCY_MISMATCH' };
  }
  if (!String(result.trade_no || '').trim()) {
    return { ok: false, error: 'TRADE_NO_REQUIRED' };
  }
  return { ok: true, amountCents };
}

export function validateCommunityPaidNotification(order, params, runtime) {
  if (params?.notify_type !== 'trade_status_sync') {
    return { ok: false, error: 'NOTIFY_TYPE_MISMATCH' };
  }
  if (params.app_id !== runtime?.appId) {
    return { ok: false, error: 'APP_ID_MISMATCH' };
  }
  if (params.seller_id !== runtime?.sellerId) {
    return { ok: false, error: 'SELLER_ID_MISMATCH' };
  }
  const result = validateCommunityTradeResult(order, params);
  if (!result.ok) return result;
  if (!isPaidTradeStatus(params.trade_status)) {
    return { ok: false, error: 'TRADE_NOT_PAID' };
  }
  if (params.out_biz_no || params.gmt_refund || params.refund_fee) {
    return { ok: false, error: 'NON_PAYMENT_EVENT' };
  }
  return result;
}

export function sanitizeAlipayNotifyParams(params = {}) {
  const safe = {};
  for (const key of [
    'notify_type',
    'notify_id',
    'sign_type',
    'trade_no',
    'app_id',
    'out_trade_no',
    'trade_status',
    'total_amount',
    'currency',
    'seller_id',
    'seller_email',
    'out_biz_no',
    'gmt_refund',
    'refund_fee'
  ]) {
    if (params[key] != null && params[key] !== '') safe[key] = params[key];
  }
  return safe;
}

export function validateSameOrigin(req) {
  const originText = String(req?.headers?.origin || '').trim();
  if (!originText) return false;

  try {
    const origin = new URL(originText).origin;
    const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
    const protocol = req?.headers?.['x-forwarded-proto'] || 'https';
    const requestUrl = host ? new URL(`${protocol}://${host}`).origin : '';
    const configuredUrl = process.env.APP_URL ? new URL(process.env.APP_URL).origin : '';
    return Boolean(
      (requestUrl && origin === requestUrl)
      || (configuredUrl && origin === configuredUrl)
    );
  } catch {
    return false;
  }
}

export function detectCommunityQrMediaType(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return '';
  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp';
  return '';
}

export function validateCommunityQrUpload(buffer, declaredType = '') {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return { ok: false, error: 'COMMUNITY_QR_REQUIRED' };
  }
  if (buffer.length > COMMUNITY_QR_MAX_BYTES) {
    return { ok: false, error: 'COMMUNITY_QR_TOO_LARGE' };
  }
  const mediaType = detectCommunityQrMediaType(buffer);
  if (!mediaType) return { ok: false, error: 'COMMUNITY_QR_INVALID_TYPE' };
  const normalizedDeclaredType = String(declaredType || '').split(';')[0].trim().toLowerCase();
  if (normalizedDeclaredType && normalizedDeclaredType !== mediaType) {
    return { ok: false, error: 'COMMUNITY_QR_SIGNATURE_MISMATCH' };
  }
  return { ok: true, mediaType, sizeBytes: buffer.length };
}

export function encodePostgresBytea(buffer) {
  return `\\x${buffer.toString('hex')}`;
}

export function decodePostgresBytea(value) {
  if (Buffer.isBuffer(value)) return value;
  const text = String(value || '');
  if (/^\\x[0-9a-f]+$/i.test(text)) return Buffer.from(text.slice(2), 'hex');
  return Buffer.from(text, 'base64');
}

export function noStore(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export async function getLatestCommunityOrder(client, userId) {
  const { data, error } = await client
    .from('community_orders')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function getActiveCommunityOrder(client, userId) {
  const { data, error } = await client
    .from('community_orders')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['PENDING', 'PAID'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function getCurrentCommunityQr(client, { includeBytes = false } = {}) {
  const columns = includeBytes
    ? 'id,media_type,size_bytes,qr_bytes,created_at'
    : 'id,media_type,size_bytes,created_at';
  const { data, error } = await client
    .from('community_group_qr_assets')
    .select(columns)
    .eq('is_current', true)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function markCommunityOrderPaid(client, order, result, options = {}) {
  const validation = validateCommunityTradeResult(order, result);
  if (!validation.ok || !isPaidTradeStatus(result.trade_status)) {
    throw new Error(validation.error || 'TRADE_NOT_PAID');
  }
  const { data, error } = await client.rpc('mark_community_order_paid', {
    p_order_id: order.id,
    p_trade_no: String(result.trade_no),
    p_paid_amount_cents: validation.amountCents,
    p_paid_currency: COMMUNITY_CURRENCY,
    p_notify_id: options.notifyId || null,
    p_notify_payload: options.notifyPayload || {}
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function closeCommunityOrderLocally(client, orderId) {
  const { data, error } = await client.rpc('close_community_order', { p_order_id: orderId });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
