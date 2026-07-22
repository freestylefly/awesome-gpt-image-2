import { getAlipayClient, isAlipayConfigured } from '../../_lib/alipay.js';
import {
  queryCommunityOrderAtAlipay,
  shouldQueryCommunityOrderAtAlipay
} from '../../_lib/community-alipay.js';
import {
  applyCommunityRateLimit,
  communityRequestRateKey,
  isUuid,
  noStore,
  serializeCommunityOrder,
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
  if (auth.error) {
    return res.status(auth.status || 401).json({
      ok: false,
      error: auth.error,
      loginRequired: auth.error === 'AUTH_REQUIRED'
    });
  }
  if (!applyCommunityRateLimit(res, takeCommunityRateLimit(
    communityRequestRateKey(req, 'community-query', auth.user.id),
    { limit: 30 }
  ))) return;

  const orderId = String(req.query?.orderId || req.query?.order_id || '').trim();
  if (!isUuid(orderId)) {
    return res.status(400).json({ ok: false, error: 'INVALID_COMMUNITY_ORDER' });
  }

  try {
    const { data: order, error } = await auth.client
      .from('community_orders')
      .select('*')
      .eq('id', orderId)
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!order) return res.status(404).json({ ok: false, error: 'COMMUNITY_ORDER_NOT_FOUND' });
    if (!shouldQueryCommunityOrderAtAlipay(order.status)) {
      return res.status(200).json({
        ok: true,
        paid: false,
        order: serializeCommunityOrder(order)
      });
    }
    if (!isAlipayConfigured()) {
      return res.status(500).json({ ok: false, error: 'ALIPAY_NOT_CONFIGURED' });
    }

    const { sdk } = getAlipayClient();
    const reconciliation = await queryCommunityOrderAtAlipay(auth.client, sdk, order);
    if (order.status === 'PAID' && reconciliation.state !== 'PAID') {
      throw new Error('ALIPAY_COMMUNITY_PAID_ORDER_NOT_PAID');
    }
    const { data: refreshed, error: refreshError } = await auth.client
      .from('community_orders')
      .select('*')
      .eq('id', order.id)
      .eq('user_id', auth.user.id)
      .single();
    if (refreshError) throw refreshError;

    return res.status(200).json({
      ok: true,
      paid: refreshed.status === 'PAID',
      pending: refreshed.status === 'PENDING'
        && ['PENDING', 'NOT_FOUND'].includes(reconciliation.state),
      order: serializeCommunityOrder(refreshed)
    });
  } catch (error) {
    console.warn('Failed to query paid community order', {
      orderId,
      userId: auth.user?.id,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return res.status(502).json({ ok: false, error: 'COMMUNITY_QUERY_FAILED' });
  }
}
