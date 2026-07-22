import { getAlipayClient, isAlipayConfigured } from '../../_lib/alipay.js';
import { readJsonBody } from '../../_lib/billing.js';
import { closeCommunityOrderAtAlipay } from '../../_lib/community-alipay.js';
import {
  applyCommunityRateLimit,
  communityRequestRateKey,
  isUuid,
  noStore,
  serializeCommunityOrder,
  takeCommunityRateLimit,
  validateSameOrigin
} from '../../_lib/community.js';
import { getAuthContext } from '../../_lib/supabase.js';

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
  if (!applyCommunityRateLimit(res, takeCommunityRateLimit(
    communityRequestRateKey(req, 'community-close', auth.user.id),
    { limit: 10 }
  ))) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ ok: false, error: 'INVALID_COMMUNITY_ORDER' });
  }
  const orderId = String(body.orderId || '').trim();
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
    if (order.status !== 'PENDING') {
      return res.status(409).json({
        ok: false,
        error: order.status === 'PAID' ? 'COMMUNITY_ALREADY_PAID' : 'COMMUNITY_ORDER_NOT_PENDING',
        order: serializeCommunityOrder(order)
      });
    }
    if (!isAlipayConfigured()) {
      return res.status(500).json({ ok: false, error: 'ALIPAY_NOT_CONFIGURED' });
    }

    const { sdk } = getAlipayClient();
    const result = await closeCommunityOrderAtAlipay(auth.client, sdk, order);
    const { data: refreshed, error: refreshError } = await auth.client
      .from('community_orders')
      .select('*')
      .eq('id', order.id)
      .single();
    if (refreshError) throw refreshError;
    return res.status(result.state === 'PAID' ? 409 : 200).json({
      ok: result.state !== 'PAID',
      paid: result.state === 'PAID',
      closed: result.state === 'CLOSED',
      order: serializeCommunityOrder(refreshed)
    });
  } catch (error) {
    console.warn('Failed to close paid community order', {
      orderId,
      userId: auth.user?.id,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return res.status(502).json({ ok: false, error: 'COMMUNITY_CLOSE_FAILED' });
  }
}
