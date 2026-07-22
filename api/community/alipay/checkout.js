import {
  formatAlipayAmount,
  getAlipayClient,
  getCommunityAlipayNotifyUrl,
  isAlipayConfigured,
  normalizeAlipaySubject
} from '../../_lib/alipay.js';
import { getAppUrl, readJsonBody } from '../../_lib/billing.js';
import { closeCommunityOrderAtAlipay } from '../../_lib/community-alipay.js';
import {
  COMMUNITY_CURRENCY,
  COMMUNITY_PRICE_CENTS,
  COMMUNITY_SUBJECT,
  COMMUNITY_TERMS_VERSION,
  applyCommunityRateLimit,
  communityRequestRateKey,
  communityPublicConfig,
  getActiveCommunityOrder,
  isCommunityPaymentEnabled,
  noStore,
  serializeCommunityOrder,
  shouldExpireCommunityOrder,
  takeCommunityRateLimit,
  validateSameOrigin
} from '../../_lib/community.js';
import { getAuthContext, isSupabaseServerConfigured } from '../../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }
  noStore(res);

  if (!validateSameOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' });
  }
  if (!isSupabaseServerConfigured()) {
    return res.status(500).json({ ok: false, error: 'SERVER_NOT_CONFIGURED' });
  }

  const auth = await getAuthContext(req);
  if (auth.error) {
    return res.status(auth.status || 401).json({
      ok: false,
      error: auth.error,
      loginRequired: auth.error === 'AUTH_REQUIRED'
    });
  }
  if (!applyCommunityRateLimit(res, takeCommunityRateLimit(
    communityRequestRateKey(req, 'community-checkout', auth.user.id),
    { limit: 10 }
  ))) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ ok: false, error: 'INVALID_REQUEST' });
  }
  if (body.acceptedTerms !== true || body.termsVersion !== COMMUNITY_TERMS_VERSION) {
    return res.status(400).json({ ok: false, error: 'COMMUNITY_TERMS_REQUIRED' });
  }

  try {
    let order = await getActiveCommunityOrder(auth.client, auth.user.id);
    if (order?.status === 'PAID') {
      return res.status(200).json({
        ok: true,
        paid: true,
        paymentEnabled: isCommunityPaymentEnabled(),
        order: serializeCommunityOrder(order)
      });
    }

    if (!isCommunityPaymentEnabled()) {
      return res.status(503).json({
        ok: false,
        error: 'COMMUNITY_PAYMENT_PAUSED',
        ...communityPublicConfig()
      });
    }
    if (!isAlipayConfigured()) {
      return res.status(500).json({ ok: false, error: 'ALIPAY_NOT_CONFIGURED' });
    }

    const { sdk, appId, sellerId } = getAlipayClient();
    if (order && shouldExpireCommunityOrder(order)) {
      const reconciliation = await closeCommunityOrderAtAlipay(auth.client, sdk, order);
      if (reconciliation.state === 'PAID') {
        const paidOrder = await getActiveCommunityOrder(auth.client, auth.user.id);
        return res.status(200).json({
          ok: true,
          paid: true,
          paymentEnabled: true,
          order: serializeCommunityOrder(paidOrder)
        });
      }
      order = null;
    }

    if (!order) {
      const { data, error } = await auth.client.rpc('create_or_reuse_community_order', {
        p_user_id: auth.user.id,
        p_terms_version: COMMUNITY_TERMS_VERSION
      });
      if (error) throw error;
      order = Array.isArray(data) ? data[0] : data;
    }
    if (!order || order.status !== 'PENDING') {
      throw new Error('COMMUNITY_ORDER_NOT_PENDING');
    }
    if (Number(order.amount_cents) !== COMMUNITY_PRICE_CENTS
      || String(order.currency).toUpperCase() !== COMMUNITY_CURRENCY) {
      throw new Error('COMMUNITY_ORDER_PRICE_INVALID');
    }

    const appUrl = getAppUrl(req);
    const returnUrl = `${appUrl}/community/result?order_id=${encodeURIComponent(order.id)}`;
    const notifyUrl = getCommunityAlipayNotifyUrl(appUrl);
    const request = {
      returnUrl,
      bizContent: {
        out_trade_no: order.id,
        total_amount: formatAlipayAmount(COMMUNITY_PRICE_CENTS),
        subject: normalizeAlipaySubject(COMMUNITY_SUBJECT),
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
      .from('community_orders')
      .update({
        alipay_app_id: appId,
        alipay_seller_id: sellerId,
        metadata: {
          ...(order.metadata || {}),
          notifyEnabled: Boolean(notifyUrl),
          returnUrl,
          termsAcceptedAt: new Date().toISOString()
        }
      })
      .eq('id', order.id)
      .eq('user_id', auth.user.id)
      .eq('status', 'PENDING')
      .select('*')
      .single();
    if (updateError) throw updateError;

    return res.status(200).json({
      ok: true,
      paid: false,
      order: serializeCommunityOrder(updatedOrder),
      paymentHtml
    });
  } catch (error) {
    console.warn('Failed to create paid community checkout', {
      userId: auth.user?.id,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return res.status(500).json({ ok: false, error: 'COMMUNITY_CHECKOUT_FAILED' });
  }
}
