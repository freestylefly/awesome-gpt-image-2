import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  formatAlipayAmount,
  getCommunityAlipayNotifyUrl,
  getAlipayNotifyUrl,
  isAlipayPaidNotification,
  isAlipayTradePaid,
  normalizeAlipaySubject,
  parseAlipayAmount,
  parseAlipayFormBody,
  sanitizeAlipayNotifyParams,
  validateAlipayOrderResult
} from './alipay.js';

const webpayMigration = readFileSync(
  new URL('../../supabase/migrations/20260721090000_alipay_webpay.sql', import.meta.url),
  'utf8'
);
const notifyHandlerSource = readFileSync(
  new URL('../billing/alipay/notify.js', import.meta.url),
  'utf8'
);

test('formats integer cents as a two-decimal yuan amount', () => {
  assert.equal(formatAlipayAmount(1), '0.01');
  assert.equal(formatAlipayAmount(12345), '123.45');
  assert.throws(() => formatAlipayAmount(0), /ALIPAY_INVALID_AMOUNT/);
});

test('parses Alipay decimal amounts without floating-point rounding', () => {
  assert.equal(parseAlipayAmount('0.01'), 1);
  assert.equal(parseAlipayAmount('123.4'), 12340);
  assert.equal(parseAlipayAmount('123.456'), null);
  assert.equal(parseAlipayAmount('-1.00'), null);
});

test('normalizes forbidden subject characters', () => {
  assert.equal(normalizeAlipaySubject('GPT/Image = pack, 300 & more'), 'GPT Image pack 300 more');
});

test('parses form encoded notification bodies', () => {
  const params = parseAlipayFormBody(Buffer.from('trade_status=TRADE_SUCCESS&sign=a%2Bb%3D'));
  assert.deepEqual(params, { trade_status: 'TRADE_SUCCESS', sign: 'a+b=' });
});

test('validates order identity and amount before fulfillment', () => {
  const order = { id: 'order-1', amount_cents: 500, currency: 'cny' };
  assert.equal(validateAlipayOrderResult(order, {
    out_trade_no: 'order-1',
    total_amount: '5.00'
  }), true);
  assert.equal(validateAlipayOrderResult(order, {
    out_trade_no: 'order-2',
    total_amount: '5.00'
  }), false);
  assert.equal(validateAlipayOrderResult(order, {
    out_trade_no: 'order-1',
    total_amount: '5.01'
  }), false);
  assert.equal(validateAlipayOrderResult({ ...order, currency: 'usd' }, {
    out_trade_no: 'order-1',
    total_amount: '5.00'
  }), false);
  assert.equal(validateAlipayOrderResult(order, {
    out_trade_no: 'order-1',
    total_amount: '5.00',
    currency: 'USD'
  }), false);
});

test('accepts only paid Alipay trade states', () => {
  assert.equal(isAlipayTradePaid('TRADE_SUCCESS'), true);
  assert.equal(isAlipayTradePaid('TRADE_FINISHED'), true);
  assert.equal(isAlipayTradePaid('WAIT_BUYER_PAY'), false);
});

test('accepts only genuine payment notifications for fulfillment', () => {
  const paid = { trade_status: 'TRADE_SUCCESS' };
  assert.equal(isAlipayPaidNotification(paid), true);
  assert.equal(isAlipayPaidNotification({ ...paid, out_biz_no: 'refund-1' }), false);
  assert.equal(isAlipayPaidNotification({ ...paid, refund_fee: '5.00' }), false);
  assert.equal(isAlipayPaidNotification({ trade_status: 'TRADE_CLOSED' }), false);
});

test('sanitizes notifications before persistence or logging', () => {
  assert.deepEqual(sanitizeAlipayNotifyParams({
    notify_id: 'notify-1',
    out_trade_no: 'order-1',
    sign: 'secret-signature',
    buyer_id: 'private-buyer'
  }), {
    notify_id: 'notify-1',
    out_trade_no: 'order-1'
  });
});

test('persists notification idempotency with protected database access', () => {
  assert.match(webpayMigration, /create table if not exists public\.alipay_notify_events/i);
  assert.match(webpayMigration, /alter table public\.alipay_notify_events enable row level security/i);
  assert.match(
    webpayMigration,
    /revoke all on table public\.alipay_notify_events from public, anon, authenticated/i
  );
  assert.match(webpayMigration, /grant all on table public\.alipay_notify_events to service_role/i);
  assert.match(
    webpayMigration,
    /complete_alipay_credit_pack_order\(uuid, text, integer, text, jsonb\)[\s\S]*from public, anon, authenticated/i
  );
});

test('webpay notification uses raw-safe SDK verification and excludes non-payment events', () => {
  assert.match(notifyHandlerSource, /checkNotifySignV2\(params\)/);
  assert.match(notifyHandlerSource, /isAlipayPaidNotification\(params\)/);
  assert.doesNotMatch(notifyHandlerSource, /checkNotifySign\(params\)/);
});

test('omits local notify URLs and requires HTTPS for explicit callbacks', () => {
  const previousUrl = process.env.ALIPAY_NOTIFY_URL;
  const previousEnabled = process.env.ALIPAY_NOTIFY_ENABLED;
  delete process.env.ALIPAY_NOTIFY_URL;
  delete process.env.ALIPAY_NOTIFY_ENABLED;

  try {
    assert.equal(getAlipayNotifyUrl('http://127.0.0.1:3000'), '');
    assert.equal(
      getAlipayNotifyUrl('https://gpt-image2.canghe.ai'),
      'https://gpt-image2.canghe.ai/api/billing/alipay/notify'
    );
    process.env.ALIPAY_NOTIFY_URL = 'http://127.0.0.1:3000/notify';
    assert.throws(() => getAlipayNotifyUrl('https://gpt-image2.canghe.ai'), /INVALID_NOTIFY_URL/);
  } finally {
    if (previousUrl === undefined) delete process.env.ALIPAY_NOTIFY_URL;
    else process.env.ALIPAY_NOTIFY_URL = previousUrl;
    if (previousEnabled === undefined) delete process.env.ALIPAY_NOTIFY_ENABLED;
    else process.env.ALIPAY_NOTIFY_ENABLED = previousEnabled;
  }
});

test('uses a separate HTTPS callback for paid-community orders', () => {
  const previous = process.env.COMMUNITY_ALIPAY_NOTIFY_URL;
  delete process.env.COMMUNITY_ALIPAY_NOTIFY_URL;
  try {
    assert.equal(getCommunityAlipayNotifyUrl('http://localhost:5173'), '');
    assert.equal(
      getCommunityAlipayNotifyUrl('https://gpt-image2.canghe.ai'),
      'https://gpt-image2.canghe.ai/api/community/alipay/notify'
    );
    process.env.COMMUNITY_ALIPAY_NOTIFY_URL = 'http://localhost:5173/notify';
    assert.throws(
      () => getCommunityAlipayNotifyUrl('https://gpt-image2.canghe.ai'),
      /INVALID_COMMUNITY_NOTIFY_URL/
    );
  } finally {
    if (previous === undefined) delete process.env.COMMUNITY_ALIPAY_NOTIFY_URL;
    else process.env.COMMUNITY_ALIPAY_NOTIFY_URL = previous;
  }
});
