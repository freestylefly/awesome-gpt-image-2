import { getAuthContext, getProfileById, isSupabaseServerConfigured } from '../../_lib/supabase.js';
import {
  createPaymentOrder,
  getAppUrl,
  getBillingProduct,
  readJsonBody
} from '../../_lib/billing.js';
import {
  formatAlipayAmount,
  getAlipayClient,
  getAlipayNotifyUrl,
  isAlipayConfigured,
  normalizeAlipaySubject
} from '../../_lib/alipay.js';

function json(res, status, payload) {
  res.status(status).json(payload);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!isSupabaseServerConfigured()) {
    return json(res, 500, { ok: false, error: 'SERVER_NOT_CONFIGURED' });
  }

  if (!isAlipayConfigured()) {
    return json(res, 500, { ok: false, error: 'ALIPAY_NOT_CONFIGURED' });
  }

  const auth = await getAuthContext(req);
  if (auth.error) {
    return json(res, auth.status || 401, {
      ok: false,
      error: auth.error,
      loginRequired: auth.error === 'AUTH_REQUIRED'
    });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, 400, { ok: false, error: 'INVALID_BILLING_PRODUCT' });
  }

  const productType = body.productType === 'creditPack' ? 'credit_pack' : body.productType;
  const productId = String(body.productId || '').trim();
  if (productType !== 'credit_pack' || !productId) {
    return json(res, 400, { ok: false, error: 'ALIPAY_CREDIT_PACKS_ONLY' });
  }

  try {
    const product = await getBillingProduct(auth.client, productType, productId);
    if (!product) {
      return json(res, 404, { ok: false, error: 'BILLING_PRODUCT_NOT_FOUND' });
    }
    if (!product.alipayAvailable || product.alipayAmountCents <= 0) {
      return json(res, 400, { ok: false, error: 'ALIPAY_PRICE_NOT_CONFIGURED' });
    }

    const alipayProduct = {
      ...product,
      amountCents: product.alipayAmountCents,
      currency: 'cny'
    };
    const order = await createPaymentOrder(auth.client, {
      userId: auth.user.id,
      product: alipayProduct,
      paymentProvider: 'alipay'
    });

    const appUrl = getAppUrl(req);
    const returnUrl = `${appUrl}/?billing=alipay_return&order_id=${encodeURIComponent(order.id)}`;
    const notifyUrl = getAlipayNotifyUrl(appUrl);
    const { sdk } = getAlipayClient();
    const request = {
      returnUrl,
      bizContent: {
        out_trade_no: order.id,
        total_amount: formatAlipayAmount(order.amount_cents),
        subject: normalizeAlipaySubject(product.name.zh || product.name.en),
        product_code: 'FAST_INSTANT_TRADE_PAY',
        timeout_express: '30m'
      }
    };
    if (notifyUrl) request.notifyUrl = notifyUrl;

    const paymentHtml = sdk.pageExec('alipay.trade.page.pay', 'POST', request);
    if (typeof paymentHtml !== 'string' || !paymentHtml.includes('<form')) {
      throw new Error('ALIPAY_PAYMENT_FORM_INVALID');
    }

    const { data: updatedOrder, error: updateError } = await auth.client
      .from('payment_orders')
      .update({
        status: 'checkout_created',
        metadata: {
          ...(order.metadata || {}),
          paymentProvider: 'alipay',
          notifyEnabled: Boolean(notifyUrl),
          returnUrl
        }
      })
      .eq('id', order.id)
      .eq('user_id', auth.user.id)
      .select('*')
      .single();

    if (updateError) throw updateError;

    return json(res, 200, {
      ok: true,
      paymentHtml,
      orderId: updatedOrder.id,
      returnUrl,
      user: await getProfileById(auth.user.id)
    });
  } catch (error) {
    console.warn('Failed to create Alipay checkout', {
      userId: auth.user?.id,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return json(res, 500, { ok: false, error: 'ALIPAY_CHECKOUT_FAILED' });
  }
}
