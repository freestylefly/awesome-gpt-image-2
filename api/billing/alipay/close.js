import { getAuthContext } from '../../_lib/supabase.js';
import { readJsonBody } from '../../_lib/billing.js';
import { getAlipayClient } from '../../_lib/alipay.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(res, status, payload) {
  res.status(status).json(payload);
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
    const { data: order, error: orderError } = await auth.client
      .from('payment_orders')
      .select('*')
      .eq('id', orderId)
      .eq('payment_provider', 'alipay')
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) return json(res, 404, { ok: false, error: 'PAYMENT_ORDER_NOT_FOUND' });
    if (order.status === 'canceled') {
      return json(res, 200, { ok: true, closed: true, orderId });
    }
    if (!['created', 'checkout_created'].includes(order.status)) {
      return json(res, 409, { ok: false, error: 'ALIPAY_ORDER_NOT_CLOSABLE' });
    }

    const { sdk } = getAlipayClient();
    const result = await sdk.exec('alipay.trade.close', {
      bizContent: { out_trade_no: order.id }
    }, { validateSign: true });

    if (String(result?.code || '') !== '10000') {
      return json(res, 502, {
        ok: false,
        closed: false,
        error: 'ALIPAY_CLOSE_FAILED',
        queryCode: String(result?.sub_code || result?.code || '')
      });
    }

    const { error: updateError } = await auth.client
      .from('payment_orders')
      .update({ status: 'canceled' })
      .eq('id', order.id)
      .in('status', ['created', 'checkout_created']);
    if (updateError) throw updateError;

    return json(res, 200, { ok: true, closed: true, orderId });
  } catch (error) {
    console.warn('Failed to close Alipay order', {
      orderId,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return json(res, 500, { ok: false, error: 'ALIPAY_CLOSE_FAILED' });
  }
}
