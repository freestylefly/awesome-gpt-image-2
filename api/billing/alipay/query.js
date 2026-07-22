import { getAuthContext, getProfileById } from '../../_lib/supabase.js';
import {
  completeAlipayCreditPackOrder,
  getAlipayClient,
  isAlipayTradePaid,
  validateAlipayOrderResult
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
  if (auth.error) {
    return json(res, auth.status || 401, {
      ok: false,
      error: auth.error,
      loginRequired: auth.error === 'AUTH_REQUIRED'
    });
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
      .eq('user_id', auth.user.id)
      .eq('payment_provider', 'alipay')
      .maybeSingle();

    if (orderError) throw orderError;
    if (!order) {
      return json(res, 404, { ok: false, error: 'PAYMENT_ORDER_NOT_FOUND' });
    }

    const { sdk } = getAlipayClient();
    const result = await sdk.exec('alipay.trade.query', {
      bizContent: { out_trade_no: order.id }
    }, { validateSign: true });

    if (String(result?.code || '') !== '10000') {
      return json(res, 200, {
        ok: true,
        paid: false,
        orderId: order.id,
        orderStatus: order.status,
        tradeStatus: '',
        queryCode: String(result?.sub_code || result?.code || '')
      });
    }

    if (!validateAlipayOrderResult(order, result)) {
      return json(res, 409, { ok: false, error: 'ALIPAY_PAYMENT_RESULT_MISMATCH' });
    }

    const paid = isAlipayTradePaid(result.trade_status);
    if (paid) {
      await completeAlipayCreditPackOrder(auth.client, order, result);
    } else if (result.trade_status === 'TRADE_CLOSED' && order.status !== 'completed') {
      const { error: updateError } = await auth.client
        .from('payment_orders')
        .update({ status: 'canceled' })
        .eq('id', order.id)
        .neq('status', 'completed');
      if (updateError) throw updateError;
    }

    return json(res, 200, {
      ok: true,
      paid,
      orderId: order.id,
      orderStatus: paid ? 'completed' : order.status,
      tradeStatus: String(result.trade_status || ''),
      totalAmount: String(result.total_amount || ''),
      user: paid ? await getProfileById(auth.user.id) : auth.profile
    });
  } catch (error) {
    console.warn('Failed to query Alipay order', {
      orderId,
      userId: auth.user?.id,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return json(res, 500, { ok: false, error: 'ALIPAY_QUERY_FAILED' });
  }
}
