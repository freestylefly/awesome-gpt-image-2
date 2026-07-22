import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  COMMUNITY_CURRENCY,
  COMMUNITY_PRICE_CENTS,
  canAccessCommunityQr,
  communityOrderPayload,
  communityRefundRequestNo,
  detectCommunityQrMediaType,
  isCommunityAdmin,
  isCommunityPaymentEnabled,
  isOrderOwnedBy,
  shouldExpireCommunityOrder,
  takeCommunityRateLimit,
  validateCommunityPaidNotification,
  validateCommunityQrUpload,
  validateSameOrigin
} from './community.js';

const migrationPath = fileURLToPath(new URL(
  '../../supabase/migrations/20260722090000_paid_community.sql',
  import.meta.url
));
const migration = readFileSync(migrationPath, 'utf8');

function paidNotification(overrides = {}) {
  return {
    notify_type: 'trade_status_sync',
    notify_id: 'notify-1',
    app_id: 'app-1',
    seller_id: 'seller-1',
    out_trade_no: '11111111-1111-4111-8111-111111111111',
    trade_no: 'trade-1',
    trade_status: 'TRADE_SUCCESS',
    total_amount: '9.90',
    currency: 'CNY',
    ...overrides
  };
}

const order = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 'user-1',
  status: 'PENDING',
  amount_cents: COMMUNITY_PRICE_CENTS,
  currency: COMMUNITY_CURRENCY
};

test('community checkout payload keeps the server-owned ¥9.90 CNY price', () => {
  const payload = communityOrderPayload('user-1', 'terms-v1');
  assert.equal(payload.amountCents, 990);
  assert.equal(payload.currency, 'CNY');
  assert.equal(Object.hasOwn(payload, 'clientAmount'), false);
});

test('migration enforces one active PENDING or PAID order per user', () => {
  assert.match(migration, /create unique index if not exists community_orders_one_active_per_user_idx/i);
  assert.match(migration, /where status in \('PENDING', 'PAID'\)/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\(p_user_id::text\)\)/i);
});

test('expired pending orders are identified before replacement', () => {
  const oldOrder = { status: 'PENDING', created_at: '2026-07-22T00:00:00.000Z' };
  assert.equal(shouldExpireCommunityOrder(oldOrder, Date.parse('2026-07-22T00:30:00.000Z')), true);
  assert.equal(shouldExpireCommunityOrder(oldOrder, Date.parse('2026-07-22T00:29:59.000Z')), false);
  assert.equal(shouldExpireCommunityOrder({ ...oldOrder, status: 'PAID' }, Date.now()), false);
});

test('community order ownership is bound to the authenticated user', () => {
  assert.equal(isOrderOwnedBy(order, 'user-1'), true);
  assert.equal(isOrderOwnedBy(order, 'user-2'), false);
});

test('paid notification rejects mismatched business fields', () => {
  const runtime = { appId: 'app-1', sellerId: 'seller-1' };
  assert.equal(validateCommunityPaidNotification(order, paidNotification(), runtime).ok, true);
  for (const params of [
    paidNotification({ app_id: 'wrong' }),
    paidNotification({ seller_id: 'wrong' }),
    paidNotification({ out_trade_no: 'wrong' }),
    paidNotification({ total_amount: '9.91' }),
    paidNotification({ currency: 'USD' }),
    paidNotification({ trade_status: 'WAIT_BUYER_PAY' }),
    paidNotification({ refund_fee: '9.90' })
  ]) {
    assert.equal(validateCommunityPaidNotification(order, params, runtime).ok, false);
  }
});

test('notification and paid transition are persistently idempotent', () => {
  assert.match(migration, /notify_id text not null unique/i);
  assert.match(migration, /on conflict \(notify_id\) do nothing/i);
  assert.match(migration, /if v_order\.status in \('PAID', 'REFUNDED', 'REVOKED'\)/i);
});

test('only PAID status can read the protected QR', () => {
  assert.equal(canAccessCommunityQr('PAID'), true);
  for (const status of ['PENDING', 'CLOSED', 'REFUNDED', 'REVOKED', null]) {
    assert.equal(canAccessCommunityQr(status), false);
  }
});

test('refund keeps PAID access until final success then revokes it', () => {
  assert.match(migration, /refund_status\s*=\s*'PROCESSING'/i);
  assert.match(migration, /set status = 'REFUNDED',[\s\S]*refund_status = 'SUCCEEDED'/i);
  assert.match(migration, /if v_order\.status <> 'PAID' or v_order\.refund_status <> 'PROCESSING'/i);
  assert.equal(communityRefundRequestNo(order.id), 'cg_11111111111141118111111111111111');
});

test('QR replacement uses a transaction lock and one-current-row index', () => {
  assert.match(migration, /community_group_qr_one_current_idx/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('community_group_qr_current'\)\)/i);
  assert.match(migration, /set is_current = false,[\s\S]*insert into public\.community_group_qr_assets/i);
});

test('QR uploads validate signatures and size', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const webp = Buffer.from('RIFF0000WEBP', 'ascii');
  assert.equal(detectCommunityQrMediaType(png), 'image/png');
  assert.equal(detectCommunityQrMediaType(jpg), 'image/jpeg');
  assert.equal(detectCommunityQrMediaType(webp), 'image/webp');
  assert.equal(validateCommunityQrUpload(png, 'image/png').ok, true);
  assert.equal(validateCommunityQrUpload(png, 'image/jpeg').ok, false);
  assert.equal(validateCommunityQrUpload(Buffer.alloc(2 * 1024 * 1024 + 1), '').error, 'COMMUNITY_QR_TOO_LARGE');
});

test('admin operations require super_admin and same-origin writes', () => {
  assert.equal(isCommunityAdmin({ profile: { role: 'super_admin' } }), true);
  assert.equal(isCommunityAdmin({ profile: { role: 'user' } }), false);
  const previousAppUrl = process.env.APP_URL;
  process.env.APP_URL = 'https://gpt-image2.canghe.ai';
  try {
    assert.equal(validateSameOrigin({ headers: { origin: 'https://gpt-image2.canghe.ai', host: 'gpt-image2.canghe.ai' } }), true);
    assert.equal(validateSameOrigin({ headers: { origin: 'https://evil.example', host: 'gpt-image2.canghe.ai' } }), false);
  } finally {
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
  }
});

test('payment kill switch defaults closed and changes only on explicit true', () => {
  assert.equal(isCommunityPaymentEnabled({}), false);
  assert.equal(isCommunityPaymentEnabled({ COMMUNITY_PAYMENT_ENABLED: 'false' }), false);
  assert.equal(isCommunityPaymentEnabled({ COMMUNITY_PAYMENT_ENABLED: 'true' }), true);
});

test('community actions use bounded per-user rate limits', () => {
  const key = `test-rate-${Date.now()}`;
  assert.equal(takeCommunityRateLimit(key, { limit: 2, windowMs: 1000, now: 100 }).allowed, true);
  assert.equal(takeCommunityRateLimit(key, { limit: 2, windowMs: 1000, now: 101 }).allowed, true);
  const blocked = takeCommunityRateLimit(key, { limit: 2, windowMs: 1000, now: 102 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 1);
  assert.equal(takeCommunityRateLimit(key, { limit: 2, windowMs: 1000, now: 1100 }).allowed, true);
});

test('browser roles have no direct table grants for orders or QR bytes', () => {
  assert.match(migration, /revoke all on table public\.community_orders from public, anon, authenticated/i);
  assert.match(migration, /revoke all on table public\.community_group_qr_assets from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.replace_community_group_qr_asset[\s\S]*to service_role/i);
});
