import { readJsonBody } from '../../_lib/billing.js';
import {
  applyCommunityRateLimit,
  communityRequestRateKey,
  isCommunityAdmin,
  isUuid,
  noStore,
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
  if (!isCommunityAdmin(auth)) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
  if (!applyCommunityRateLimit(res, takeCommunityRateLimit(
    communityRequestRateKey(req, 'community-admin-revoke', auth.user.id),
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

  try {
    const { data, error } = await auth.client.rpc('revoke_community_access', {
      p_order_id: orderId
    });
    if (error) {
      if (String(error.message || '').includes('COMMUNITY_ORDER_NOT_REVOKABLE')) {
        return res.status(409).json({ ok: false, error: 'COMMUNITY_ORDER_NOT_REVOKABLE' });
      }
      throw error;
    }
    const result = Array.isArray(data) ? data[0] : data;
    return res.status(200).json({
      ok: true,
      status: result?.current_status || 'REVOKED',
      transitioned: Boolean(result?.transitioned)
    });
  } catch (error) {
    console.warn('Failed to revoke paid community access', {
      orderId,
      adminUserId: auth.user?.id,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return res.status(500).json({ ok: false, error: 'COMMUNITY_REVOKE_FAILED' });
  }
}
