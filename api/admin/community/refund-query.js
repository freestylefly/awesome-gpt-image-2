import { getAlipayClient, parseAlipayAmount } from '../../_lib/alipay.js';
import {
  applyCommunityRateLimit,
  communityRequestRateKey,
  isCommunityAdmin,
  isUuid,
  noStore,
  takeCommunityRateLimit
} from '../../_lib/community.js';
import { getAuthContext } from '../../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }
  noStore(res);
  const auth = await getAuthContext(req);
  if (auth.error) return res.status(auth.status || 401).json({ ok: false, error: auth.error });
  if (!isCommunityAdmin(auth)) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
  if (!applyCommunityRateLimit(res, takeCommunityRateLimit(
    communityRequestRateKey(req, 'community-admin-refund-query', auth.user.id),
    { limit: 30 }
  ))) return;

  const orderId = String(req.query?.orderId || '').trim();
  if (!isUuid(orderId)) return res.status(400).json({ ok: false, error: 'INVALID_COMMUNITY_ORDER' });

  try {
    const { data: order, error } = await auth.client
      .from('community_orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();
    if (error) throw error;
    if (!order) return res.status(404).json({ ok: false, error: 'COMMUNITY_ORDER_NOT_FOUND' });
    if (order.status === 'REFUNDED') {
      return res.status(200).json({ ok: true, refunded: true, refundStatus: 'SUCCEEDED' });
    }
    if (!order.refund_request_no || order.refund_status === 'NONE') {
      return res.status(409).json({ ok: false, error: 'COMMUNITY_REFUND_NOT_PREPARED' });
    }

    const requestedAt = Date.parse(order.refund_requested_at || '');
    const ageMs = Date.now() - requestedAt;
    if (!Number.isFinite(requestedAt) || ageMs < 10_000) {
      return res.status(409).json({
        ok: false,
        error: 'COMMUNITY_REFUND_QUERY_TOO_EARLY',
        retryAfterSeconds: Math.max(1, Math.ceil((10_000 - Math.max(0, ageMs)) / 1000))
      });
    }

    const { sdk } = getAlipayClient();
    const queryResult = await sdk.exec('alipay.trade.fastpay.refund.query', {
      bizContent: {
        out_trade_no: order.id,
        out_request_no: order.refund_request_no
      }
    }, { validateSign: true });

    if (String(queryResult?.code || '') !== '10000') {
      const { error: stateError } = await auth.client.rpc('set_community_refund_state', {
        p_order_id: order.id,
        p_refund_status: 'PROCESSING',
        p_failure_code: String(queryResult?.sub_code || queryResult?.code || 'UNKNOWN')
      });
      if (stateError) throw stateError;
      return res.status(200).json({
        ok: true,
        refunded: false,
        refundStatus: 'PROCESSING',
        queryCode: String(queryResult?.sub_code || queryResult?.code || 'UNKNOWN')
      });
    }

    const refundAmountCents = parseAlipayAmount(queryResult.refund_amount);
    const tradeNo = String(queryResult.trade_no || order.alipay_trade_no || '');
    const matches = queryResult.out_trade_no === order.id
      && queryResult.out_request_no === order.refund_request_no
      && tradeNo === order.alipay_trade_no
      && refundAmountCents === Number(order.amount_cents);
    if (!matches) {
      return res.status(409).json({ ok: false, error: 'COMMUNITY_REFUND_RESULT_MISMATCH' });
    }

    const refunded = queryResult.refund_status === 'REFUND_SUCCESS';
    if (refunded) {
      const finalization = await auth.client.rpc('finalize_community_refund', {
        p_order_id: order.id,
        p_trade_no: tradeNo,
        p_refund_request_no: order.refund_request_no,
        p_refund_amount_cents: refundAmountCents
      });
      if (finalization.error) throw finalization.error;
    } else {
      const state = await auth.client.rpc('set_community_refund_state', {
        p_order_id: order.id,
        p_refund_status: 'PROCESSING',
        p_failure_code: null
      });
      if (state.error) throw state.error;
    }

    return res.status(200).json({
      ok: true,
      refunded,
      refundStatus: refunded ? 'SUCCEEDED' : 'PROCESSING'
    });
  } catch (error) {
    console.warn('Failed to query paid community refund', {
      orderId,
      adminUserId: auth.user?.id,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return res.status(500).json({ ok: false, error: 'COMMUNITY_REFUND_QUERY_FAILED' });
  }
}
