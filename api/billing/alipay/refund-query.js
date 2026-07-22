import { getAuthContext } from '../../_lib/supabase.js';
import {
  finalizeAlipayRefund,
  getAlipayClient,
  parseAlipayAmount
} from '../../_lib/alipay.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(res, status, payload) {
  res.status(status).json(payload);
}
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await getAuthContext(req);
  if (auth.error) return json(res, auth.status || 401, { ok: false, error: auth.error });
  if (!auth.profile?.isSuperAdmin) {
    return json(res, 403, { ok: false, error: 'FORBIDDEN' });
  }

  const orderId = String(req.query?.orderId || req.query?.order_id || '').trim();
  if (!UUID_PATTERN.test(orderId)) {
    return json(res, 400, { ok: false, error: 'INVALID_PAYMENT_ORDER' });
  }

  try {
    const { data: order, error: orderError } = await auth.client
      .from('payment_orders')
      .select('*')
      .eq('id', orderId)
      .eq('payment_provider', 'alipay')
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) return json(res, 404, { ok: false, error: 'PAYMENT_ORDER_NOT_FOUND' });
    if (!order.provider_refund_request_no) {
      return json(res, 409, { ok: false, error: 'ALIPAY_REFUND_NOT_PREPARED' });
    }

    const { sdk } = getAlipayClient();
    const result = await sdk.exec('alipay.trade.fastpay.refund.query', {
      bizContent: {
        out_trade_no: order.id,
        out_request_no: order.provider_refund_request_no
      }
    }, { validateSign: true });

    if (String(result?.code || '') !== '10000') {
      return json(res, 200, {
        ok: true,
        refunded: order.status === 'refunded',
        refundStatus: order.status,
        queryCode: String(result?.sub_code || result?.code || '')
      });
    }

    const identifiersMatch = result.out_trade_no === order.id
      && result.out_request_no === order.provider_refund_request_no;
    const refundAmountCents = parseAlipayAmount(result.refund_amount);
    if (!identifiersMatch || (refundAmountCents !== null && refundAmountCents !== Number(order.amount_cents))) {
      return json(res, 409, { ok: false, error: 'ALIPAY_REFUND_RESULT_MISMATCH' });
    }

    const refunded = result.refund_status === 'REFUND_SUCCESS';
    if (refunded) {
      await finalizeAlipayRefund(auth.client, order.id, {
        ...result,
        trade_no: result.trade_no || order.provider_trade_no,
        refund_amount: result.refund_amount
      });
    }

    return json(res, 200, {
      ok: true,
      refunded,
      refundStatus: refunded ? 'refunded' : 'refund_pending',
      orderId: order.id
    });
  } catch (error) {
    console.warn('Failed to query Alipay refund', {
      orderId,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return json(res, 500, { ok: false, error: 'ALIPAY_REFUND_QUERY_FAILED' });
  }
}
