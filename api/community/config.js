import { isAlipayConfigured } from '../_lib/alipay.js';
import { communityPublicConfig, noStore } from '../_lib/community.js';
import { isSupabaseServerConfigured } from '../_lib/supabase.js';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  noStore(res);
  const config = communityPublicConfig();
  return res.status(200).json({
    ok: true,
    ...config,
    paymentEnabled: config.paymentEnabled
      && isSupabaseServerConfigured()
      && isAlipayConfigured()
  });
}
