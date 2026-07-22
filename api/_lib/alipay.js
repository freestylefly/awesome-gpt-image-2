import fs from 'node:fs';
import path from 'node:path';
import { AlipaySdk } from 'alipay-sdk';

const SANDBOX_CONFIG_FILE = '.alipay-sandbox.json';
const SANDBOX_GATEWAY = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
const PRODUCTION_GATEWAY = 'https://openapi.alipay.com/gateway.do';

function requiredText(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`ALIPAY_CONFIG_MISSING_${field}`);
  return text;
}

function requiredPrivateKey(value) {
  const text = String(value || '');
  if (!text || text !== text.trim() || /-----BEGIN|-----END|\s/.test(text)) {
    throw new Error('ALIPAY_CONFIG_INVALID_PRIVATE_KEY');
  }
  return text;
}

function loadProductionConfig() {
  const configuredFields = [
    process.env.ALIPAY_APP_ID,
    process.env.ALIPAY_PRIVATE_KEY,
    process.env.ALIPAY_PUBLIC_KEY,
    process.env.ALIPAY_SELLER_ID
  ];
  if (!configuredFields.some(Boolean)) return null;

  const gateway = requiredText(process.env.ALIPAY_GATEWAY || PRODUCTION_GATEWAY, 'GATEWAY');
  if (gateway !== PRODUCTION_GATEWAY) throw new Error('ALIPAY_CONFIG_INVALID_PRODUCTION_GATEWAY');

  return {
    mode: 'production',
    configPath: 'server environment',
    appId: requiredText(process.env.ALIPAY_APP_ID, 'APP_ID'),
    privateKey: requiredPrivateKey(process.env.ALIPAY_PRIVATE_KEY),
    alipayPublicKey: requiredText(process.env.ALIPAY_PUBLIC_KEY, 'PUBLIC_KEY'),
    sellerId: requiredText(process.env.ALIPAY_SELLER_ID, 'SELLER_ID'),
    gateway
  };
}

function loadSandboxConfig() {
  const configPath = path.resolve(process.cwd(), SANDBOX_CONFIG_FILE);
  const raw = fs.readFileSync(configPath, 'utf8');
  const payload = JSON.parse(raw);
  const app = Array.isArray(payload?.appIds) ? payload.appIds[0] : null;

  return {
    mode: 'sandbox',
    configPath,
    appId: requiredText(app?.appId, 'APP_ID'),
    privateKey: requiredPrivateKey(app?.appPrivatePkcsKey),
    alipayPublicKey: requiredText(app?.alipayPublicKey, 'PUBLIC_KEY'),
    sellerId: requiredText(app?.pid || payload?.sandboxAccounts?.partner?.userId, 'SELLER_ID'),
    gateway: SANDBOX_GATEWAY
  };
}

export function getAlipayRuntimeConfig() {
  return loadProductionConfig() || loadSandboxConfig();
}

export function isAlipayConfigured() {
  try {
    getAlipayRuntimeConfig();
    return true;
  } catch {
    return false;
  }
}

export function getAlipayClient() {
  const runtime = getAlipayRuntimeConfig();
  const sdk = new AlipaySdk({
    appId: runtime.appId,
    privateKey: runtime.privateKey,
    alipayPublicKey: runtime.alipayPublicKey,
    gateway: runtime.gateway,
    signType: 'RSA2',
    keyType: 'PKCS1',
    charset: 'utf-8',
    version: '1.0',
    camelcase: false
  });

  return {
    sdk,
    mode: runtime.mode,
    configPath: runtime.configPath,
    appId: runtime.appId,
    sellerId: runtime.sellerId,
    gateway: runtime.gateway
  };
}

export function getAlipayNotifyUrl(appUrl) {
  if (process.env.ALIPAY_NOTIFY_ENABLED === 'false') return '';
  if (process.env.ALIPAY_NOTIFY_URL) {
    const notifyUrl = new URL(requiredText(process.env.ALIPAY_NOTIFY_URL, 'NOTIFY_URL'));
    if (notifyUrl.protocol !== 'https:' || notifyUrl.username || notifyUrl.password || notifyUrl.hash) {
      throw new Error('ALIPAY_CONFIG_INVALID_NOTIFY_URL');
    }
    return notifyUrl.toString();
  }

  try {
    const url = new URL(appUrl);
    const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' || isLocal) return '';
    return `${url.origin}/api/billing/alipay/notify`;
  } catch {
    return '';
  }
}

export function getCommunityAlipayNotifyUrl(appUrl) {
  if (process.env.ALIPAY_NOTIFY_ENABLED === 'false') return '';
  if (process.env.COMMUNITY_ALIPAY_NOTIFY_URL) {
    const notifyUrl = new URL(requiredText(
      process.env.COMMUNITY_ALIPAY_NOTIFY_URL,
      'COMMUNITY_NOTIFY_URL'
    ));
    if (notifyUrl.protocol !== 'https:' || notifyUrl.username || notifyUrl.password || notifyUrl.hash) {
      throw new Error('ALIPAY_CONFIG_INVALID_COMMUNITY_NOTIFY_URL');
    }
    return notifyUrl.toString();
  }

  try {
    const url = new URL(appUrl);
    const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' || isLocal) return '';
    return `${url.origin}/api/community/alipay/notify`;
  } catch {
    return '';
  }
}

export function formatAlipayAmount(amountCents) {
  const cents = Number(amountCents);
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error('ALIPAY_INVALID_AMOUNT');
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function parseAlipayAmount(amount) {
  const text = String(amount || '').trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(text)) return null;
  const [yuan, fraction = ''] = text.split('.');
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function normalizeAlipaySubject(value) {
  const subject = String(value || '')
    .replace(/[\/=,&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 256);
  if (!subject) throw new Error('ALIPAY_INVALID_SUBJECT');
  return subject;
}

export function parseAlipayFormBody(rawBody) {
  const params = new URLSearchParams(Buffer.from(rawBody || '').toString('utf8'));
  return Object.fromEntries(params.entries());
}

export function isAlipayTradePaid(status) {
  return status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED';
}

export function isAlipayPaidNotification(params = {}) {
  return isAlipayTradePaid(params.trade_status)
    && !params.out_biz_no
    && !params.gmt_refund
    && !params.refund_fee;
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

export function validateAlipayOrderResult(order, result) {
  const outTradeNo = String(result?.out_trade_no || '');
  const totalAmountCents = parseAlipayAmount(result?.total_amount);
  const orderCurrency = String(order?.currency || '').toUpperCase();
  const resultCurrency = String(result?.currency || '').toUpperCase();
  return Boolean(
    outTradeNo === order.id
      && totalAmountCents !== null
      && totalAmountCents === Number(order.amount_cents)
      && orderCurrency === 'CNY'
      && (!resultCurrency || resultCurrency === 'CNY')
  );
}

export async function completeAlipayCreditPackOrder(client, order, result, options = {}) {
  const tradeNo = requiredText(result?.trade_no, 'TRADE_NO');
  const paidAmountCents = parseAlipayAmount(result?.total_amount);
  if (paidAmountCents === null) throw new Error('ALIPAY_INVALID_PAID_AMOUNT');

  const { data, error } = await client.rpc('complete_alipay_credit_pack_order', {
    p_order_id: order.id,
    p_trade_no: tradeNo,
    p_paid_amount_cents: paidAmountCents,
    p_notify_id: options.notifyId || null,
    p_notify_payload: options.notifyPayload || {}
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function finalizeAlipayRefund(client, orderId, result) {
  const { data, error } = await client.rpc('finalize_alipay_credit_pack_refund', {
    p_order_id: orderId,
    p_trade_no: requiredText(result?.trade_no, 'TRADE_NO'),
    p_refund_amount_cents: parseAlipayAmount(result?.refund_fee || result?.refund_amount)
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
