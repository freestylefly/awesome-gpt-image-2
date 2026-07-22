import {
  applyCommunityRateLimit,
  communityRequestRateKey,
  isCommunityAdmin,
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
  if (auth.error) return res.status(auth.status || 401).json({ ok: false, error: auth.error });
  if (!isCommunityAdmin(auth)) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
  if (!applyCommunityRateLimit(res, takeCommunityRateLimit(
    communityRequestRateKey(req, 'community-admin-orders', auth.user.id)
  ))) return;

  const status = String(req.query?.status || '').trim().toUpperCase();
  const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 50)));
  try {
    let query = auth.client
      .from('community_orders')
      .select('id,user_id,status,amount_cents,currency,alipay_trade_no,refund_request_no,refund_status,refund_failure_code,created_at,paid_at,refund_requested_at,refund_checked_at,refunded_at,revoked_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (status) query = query.eq('status', status);
    const { data: rows, error } = await query;
    if (error) throw error;

    const userIds = [...new Set((rows || []).map((row) => row.user_id))];
    let profiles = [];
    if (userIds.length) {
      const result = await auth.client
        .from('profiles')
        .select('id,email,full_name')
        .in('id', userIds);
      if (result.error) throw result.error;
      profiles = result.data || [];
    }
    const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));

    return res.status(200).json({
      ok: true,
      orders: (rows || []).map((row) => ({
        ...serializeCommunityOrder(row),
        userId: row.user_id,
        email: profilesById.get(row.user_id)?.email || '',
        fullName: profilesById.get(row.user_id)?.full_name || '',
        alipayTradeNo: row.alipay_trade_no || '',
        refundRequestNo: row.refund_request_no || '',
        refundFailureCode: row.refund_failure_code || '',
        refundRequestedAt: row.refund_requested_at || '',
        refundCheckedAt: row.refund_checked_at || ''
      }))
    });
  } catch (error) {
    console.warn('Failed to load paid community admin orders', {
      adminUserId: auth.user?.id,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return res.status(500).json({ ok: false, error: 'COMMUNITY_ADMIN_ORDERS_FAILED' });
  }
}
