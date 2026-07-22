import {
  formatAlipayAmount,
  getAlipayClient,
  parseAlipayAmount
} from '../../_lib/alipay.js';
import { readJsonBody } from '../../_lib/billing.js';
import {
  applyCommunityRateLimit,
  communityRequestRateKey,
  communityRefundRequestNo,
  isCommunityAdmin,
  isUuid,
  noStore,
  takeCommunityRateLimit,
  validateSameOrigin
} from '../../_lib/community.js';
import { getAuthContext } from '../../_lib/supabase.js';

async function setRefundState(client, orderId, status, failureCode = null) {
  const { error } = await client.rpc('set_community_refund_state', {
    p_order_id: orderId,
    p_refund_status: status,
    p_failure_code: failureCode
  });
  if (error) throw error;
}

async function finalizeRefund(client, order, requestNo, result) {
  const refundAmount = parseAlipayAmount(result.refund_fee || result.refund_amount);
  const tradeNo = String(result.trade_no || order.alipay_trade_no || '');
  if ((result.out_trade_no && result.out_trade_no !== order.id)
    || tradeNo !== order.alipay_trade_no
    || refundAmount !== Number(order.amount_cents)) {
    throw new Error('COMMUNITY_REFUND_RESULT_MISMATCH');
  }
  const { error } = await client.rpc('finalize_community_refund', {
    p_order_id: order.id,
    p_trade_no: tradeNo,
    p_refund_request_no: requestNo,
    p_refund_amount_cents: refundAmount
  });
  if (error) throw error;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }
  noStore(res);
  if (!validateSameOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' });
  }
  const auth = await getAuthContext(req);
  if (auth.error) return res.status(auth.status || 401).json({ ok: false, error: auth.error });
  if (!isCommunityAdmin(auth)) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
  if (!applyCommunityRateLimit(res, takeCommunityRateLimit(
    communityRequestRateKey(req, 'community-admin-refund', auth.user.id),
    { limit: 10 }
  ))) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ ok: false, error: 'INVALID_COMMUNITY_ORDER' });
  }
  const orderId = String(body.orderId || '').trim();
  if (!isUuid(orderId)) return res.status(400).json({ ok: false, error: 'INVALID_COMMUNITY_ORDER' });

  let order;
  let requestNo;
  try {
    const result = await auth.client
      .from('community_orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();
    if (result.error) throw result.error;
    order = result.data;
    if (!order) return res.status(404).json({ ok: false, error: 'COMMUNITY_ORDER_NOT_FOUND' });
    if (order.status === 'REFUNDED') {
      return res.status(200).json({ ok: true, refunded: true, refundStatus: 'SUCCEEDED' });
    }

    requestNo = order.refund_request_no || communityRefundRequestNo(order.id);
    const preparation = await auth.client.rpc('prepare_community_refund', {
      p_order_id: order.id,
      p_refund_request_no: requestNo
    });
    if (preparation.error) throw preparation.error;

    const { sdk } = getAlipayClient();
    const refundResult = await sdk.exec('alipay.trade.refund', {
      bizContent: {
        out_trade_no: order.id,
        refund_amount: formatAlipayAmount(order.amount_cents),
        refund_reason: '付费交流群人工审核退款',
        out_request_no: requestNo
      }
    }, { validateSign: true });

    const accepted = String(refundResult?.code || '') === '10000';
    if (!accepted) {
      await setRefundState(
        auth.client,
        order.id,
        'FAILED',
        String(refundResult?.sub_code || refundResult?.code || 'UNKNOWN')
      );
      return res.status(502).json({
        ok: false,
        error: 'COMMUNITY_REFUND_REQUEST_FAILED',
        refundStatus: 'FAILED'
      });
    }

    if (refundResult.fund_change === 'Y') {
      await finalizeRefund(auth.client, order, requestNo, refundResult);
      return res.status(200).json({ ok: true, refunded: true, refundStatus: 'SUCCEEDED' });
    }

    await setRefundState(auth.client, order.id, 'PROCESSING');
    return res.status(200).json({
      ok: true,
      refunded: false,
      refundStatus: 'PROCESSING',
      queryRequired: true
    });
  } catch (error) {
    console.warn('Failed to request paid community refund', {
      orderId,
      adminUserId: auth.user?.id,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return res.status(500).json({
      ok: false,
      error: 'COMMUNITY_REFUND_FAILED',
      refundStatus: requestNo ? 'PROCESSING' : 'NONE',
      queryRequired: Boolean(requestNo)
    });
  }
}
