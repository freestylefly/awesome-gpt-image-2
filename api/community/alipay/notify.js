import {
  getAlipayClient,
  parseAlipayFormBody
} from '../../_lib/alipay.js';
import { readRawBody } from '../../_lib/billing.js';
import {
  closeCommunityOrderLocally,
  isPaidTradeStatus,
  markCommunityOrderPaid,
  sanitizeAlipayNotifyParams,
  validateCommunityPaidNotification,
  validateCommunityTradeResult
} from '../../_lib/community.js';
import { getSupabaseAdminClient, isSupabaseServerConfigured } from '../../_lib/supabase.js';

export const config = {
  api: { bodyParser: false }
};

function text(res, status, value) {
  res.status(status);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.send(value);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return text(res, 405, 'fail');
  }
  if (!isSupabaseServerConfigured()) return text(res, 500, 'fail');

  let safeParams = {};
  try {
    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > 128 * 1024) return text(res, 413, 'fail');
    const rawBody = await readRawBody(req);
    if (!rawBody.length || rawBody.length > 128 * 1024) return text(res, 400, 'fail');

    const params = parseAlipayFormBody(rawBody);
    safeParams = sanitizeAlipayNotifyParams(params);
    const { sdk, appId, sellerId } = getAlipayClient();
    if (!sdk.checkNotifySignV2(params)) return text(res, 400, 'fail');
    if (params.sign_type !== 'RSA2') return text(res, 400, 'fail');
    if (params.app_id !== appId || params.seller_id !== sellerId) return text(res, 400, 'fail');
    if (!String(params.notify_id || '').trim()) return text(res, 400, 'fail');

    const client = getSupabaseAdminClient();
    const { data: order, error } = await client
      .from('community_orders')
      .select('*')
      .eq('id', params.out_trade_no)
      .maybeSingle();
    if (error || !order) return text(res, 400, 'fail');
    if ((order.alipay_app_id && order.alipay_app_id !== appId)
      || (order.alipay_seller_id && order.alipay_seller_id !== sellerId)) {
      return text(res, 400, 'fail');
    }

    if (isPaidTradeStatus(params.trade_status)) {
      const validation = validateCommunityPaidNotification(order, params, { appId, sellerId });
      if (!validation.ok) return text(res, 400, 'fail');
      await markCommunityOrderPaid(client, order, params, {
        notifyId: params.notify_id,
        notifyPayload: safeParams
      });
      return text(res, 200, 'success');
    }

    const validation = validateCommunityTradeResult(order, params);
    if (!validation.ok || params.notify_type !== 'trade_status_sync') {
      return text(res, 400, 'fail');
    }

    const { error: eventError } = await client
      .from('community_alipay_notify_events')
      .upsert({
        order_id: order.id,
        notify_id: params.notify_id,
        trade_no: params.trade_no,
        trade_status: params.trade_status || 'UNKNOWN',
        payload: safeParams
      }, { onConflict: 'notify_id', ignoreDuplicates: true });
    if (eventError) throw eventError;

    if (params.trade_status === 'TRADE_CLOSED' && order.status === 'PENDING') {
      await closeCommunityOrderLocally(client, order.id);
    }
    return text(res, 200, 'success');
  } catch (error) {
    console.warn('Failed to process paid community Alipay notification', {
      orderId: String(safeParams.out_trade_no || '').slice(0, 64),
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return text(res, 500, 'fail');
  }
}
