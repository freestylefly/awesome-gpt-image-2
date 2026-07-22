import {
  canAccessCommunityQr,
  decodePostgresBytea,
  getActiveCommunityOrder,
  getCurrentCommunityQr,
  noStore
} from '../_lib/community.js';
import { getAuthContext } from '../_lib/supabase.js';

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

  try {
    const order = await getActiveCommunityOrder(auth.client, auth.user.id);
    if (!canAccessCommunityQr(order?.status)) {
      return res.status(403).json({ ok: false, error: 'COMMUNITY_PAYMENT_REQUIRED' });
    }

    const asset = await getCurrentCommunityQr(auth.client, { includeBytes: true });
    if (!asset) {
      return res.status(409).json({ ok: false, error: 'COMMUNITY_QR_NOT_READY' });
    }
    const bytes = decodePostgresBytea(asset.qr_bytes);
    if (!bytes.length || bytes.length !== Number(asset.size_bytes)) {
      throw new Error('COMMUNITY_QR_CORRUPT');
    }

    res.setHeader('Content-Type', asset.media_type);
    res.setHeader('Content-Length', String(bytes.length));
    return res.status(200).send(bytes);
  } catch (error) {
    console.warn('Failed to serve paid community QR', {
      userId: auth.user?.id,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return res.status(500).json({ ok: false, error: 'COMMUNITY_QR_FAILED' });
  }
}
