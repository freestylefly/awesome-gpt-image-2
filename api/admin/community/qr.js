import { readRawBody } from '../../_lib/billing.js';
import {
  applyCommunityRateLimit,
  communityRequestRateKey,
  decodePostgresBytea,
  encodePostgresBytea,
  getCurrentCommunityQr,
  isCommunityAdmin,
  noStore,
  takeCommunityRateLimit,
  validateCommunityQrUpload,
  validateSameOrigin
} from '../../_lib/community.js';
import { getAuthContext } from '../../_lib/supabase.js';

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }
  noStore(res);
  const auth = await getAuthContext(req);
  if (auth.error) return res.status(auth.status || 401).json({ ok: false, error: auth.error });
  if (!isCommunityAdmin(auth)) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
  if (!applyCommunityRateLimit(res, takeCommunityRateLimit(
    communityRequestRateKey(req, 'community-admin-qr', auth.user.id),
    { limit: req.method === 'POST' ? 10 : 60 }
  ))) return;

  if (req.method === 'GET') {
    try {
      const asset = await getCurrentCommunityQr(auth.client, {
        includeBytes: req.query?.metadata !== '1'
      });
      if (!asset) return res.status(404).json({ ok: false, error: 'COMMUNITY_QR_NOT_READY' });
      if (req.query?.metadata === '1') {
        return res.status(200).json({
          ok: true,
          asset: {
            id: asset.id,
            mediaType: asset.media_type,
            sizeBytes: Number(asset.size_bytes),
            createdAt: asset.created_at
          }
        });
      }

      const bytes = decodePostgresBytea(asset.qr_bytes);
      res.setHeader('Content-Type', asset.media_type);
      res.setHeader('Content-Length', String(bytes.length));
      return res.status(200).send(bytes);
    } catch (error) {
      console.warn('Failed to load paid community QR for admin', {
        adminUserId: auth.user?.id,
        message: String(error?.message || 'unknown').slice(0, 240)
      });
      return res.status(500).json({ ok: false, error: 'COMMUNITY_QR_FAILED' });
    }
  }

  if (!validateSameOrigin(req)) {
    return res.status(403).json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' });
  }
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > 2 * 1024 * 1024) {
    return res.status(413).json({ ok: false, error: 'COMMUNITY_QR_TOO_LARGE' });
  }

  try {
    const bytes = await readRawBody(req);
    const validation = validateCommunityQrUpload(bytes, req.headers['content-type']);
    if (!validation.ok) {
      return res.status(validation.error === 'COMMUNITY_QR_TOO_LARGE' ? 413 : 400).json({
        ok: false,
        error: validation.error
      });
    }

    const { data, error } = await auth.client.rpc('replace_community_group_qr_asset', {
      p_media_type: validation.mediaType,
      p_qr_bytes: encodePostgresBytea(bytes),
      p_uploaded_by: auth.user.id
    });
    if (error) throw error;
    const asset = Array.isArray(data) ? data[0] : data;
    return res.status(200).json({
      ok: true,
      asset: {
        id: asset.id,
        mediaType: asset.media_type,
        sizeBytes: Number(asset.size_bytes),
        createdAt: asset.created_at
      }
    });
  } catch (error) {
    console.warn('Failed to replace paid community QR', {
      adminUserId: auth.user?.id,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return res.status(500).json({ ok: false, error: 'COMMUNITY_QR_UPLOAD_FAILED' });
  }
}
