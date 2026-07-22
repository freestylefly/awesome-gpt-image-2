import { getAuthContext } from '../../_lib/supabase.js';
import { readJsonBody } from '../../_lib/billing.js';
import {
  finalizeAlipayRefund,
  formatAlipayAmount,
  getAlipayClient
} from '../../_lib/alipay.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(res, status, payload) {
  res.status(status).json(payload);
}
function refundRequestNo(orderId) {
  return `refund_${orderId.replace(/-/g, '')}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await getAuthContext(req);
  if (auth.error) return json(res, auth.status || 401, { ok: false, error: auth.error });
  if (!auth.profile?.isSuperAdmin) {
    return json(res, 403, { ok: false, error: 'FORBIDDEN' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, 400, { ok: false, error: 'INVALID_PAYMENT_ORDER' });
  }

  const orderId = String(body.orderId || body.order_id || '').trim();
  if (!UUID_PATTERN.test(orderId)) {
    return json(res, 400, { ok: false, error: 'INVALID_PAYMENT_ORDER' });
  }

  try {
    const requestNo = refundRequestNo(orderId);
    const { data: prepared, error: prepareError } = await auth.client.rpc(
      'prepare_alipay_credit_pack_refund',
      {
        p_order_id: orderId,
        p_refund_request_no: requestNo
      }
    );
    if (prepareError) {
      const message = String(prepareError.message || '');
      if (message.includes('PURCHASED_CREDITS_ALREADY_USED')) {
        return json(res, 409, { ok: false, error: 'PURCHASED_CREDITS_ALREADY_USED' });
      }
      throw prepareError;
    }

    const preparation = Array.isArray(prepared) ? prepared[0] : prepared;
    const refundAmountCents = Number(preparation?.refund_amount_cents || 0);
    const { sdk } = getAlipayClient();
    const result = await sdk.exec('alipay.trade.refund', {
      bizContent: {
        out_trade_no: orderId,
        refund_amount: formatAlipayAmount(refundAmountCents),
        refund_reason: '管理员全额退款',
        out_request_no: requestNo
      }
    }, { validateSign: true });

    const requestAccepted = String(result?.code || '') === '10000';
    const refunded = requestAccepted && result?.fund_change === 'Y';
    if (refunded) {
      await finalizeAlipayRefund(auth.client, orderId, result);
    }

    return json(res, requestAccepted ? 200 : 502, {
      ok: requestAccepted,
      orderId,
      refundRequestNo: requestNo,
      refundStatus: refunded ? 'refunded' : 'refund_pending',
      queryRequired: !refunded,
      error: requestAccepted ? undefined : 'ALIPAY_REFUND_REQUEST_FAILED'
    });
  } catch (error) {
    console.warn('Failed to request Alipay refund', {
      orderId,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return json(res, 500, {
      ok: false,
      error: 'ALIPAY_REFUND_FAILED',
      refundStatus: 'refund_pending',
      queryRequired: true
    });
  }
}
