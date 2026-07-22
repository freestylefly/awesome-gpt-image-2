import { isAlipayConfigured } from '../_lib/alipay.js';
import {
  canAccessCommunityQr,
  communityPublicConfig,
  getCurrentCommunityQr,
  getLatestCommunityOrder,
  noStore,
  serializeCommunityOrder
} from '../_lib/community.js';
import { getAuthContext, isSupabaseServerConfigured } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }
  noStore(res);

  if (!isSupabaseServerConfigured()) {
    return res.status(500).json({ ok: false, error: 'SERVER_NOT_CONFIGURED' });
  }

  const auth = await getAuthContext(req, { allowAnonymous: true });
  if (auth.error) {
    return res.status(auth.status || 401).json({ ok: false, error: auth.error });
  }

  const publicConfig = communityPublicConfig();
  const paymentEnabled = publicConfig.paymentEnabled && isAlipayConfigured();
  if (!auth.user) {
    return res.status(200).json({
      ok: true,
      authenticated: false,
      eligible: false,
      qrReady: false,
      paymentEnabled,
      order: null
    });
  }

  try {
    const [order, qr] = await Promise.all([
      getLatestCommunityOrder(auth.client, auth.user.id),
      getCurrentCommunityQr(auth.client)
    ]);
    return res.status(200).json({
      ok: true,
      authenticated: true,
      eligible: canAccessCommunityQr(order?.status),
      qrReady: Boolean(qr),
      paymentEnabled,
      order: serializeCommunityOrder(order)
    });
  } catch (error) {
    console.warn('Failed to load paid community status', {
      userId: auth.user.id,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return res.status(500).json({ ok: false, error: 'COMMUNITY_STATUS_FAILED' });
  }
}
