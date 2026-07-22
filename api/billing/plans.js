import { getAuthContext, getProfileById, isSupabaseServerConfigured } from '../_lib/supabase.js';
import { getBillingCatalog, isStripeConfigured } from '../_lib/billing.js';
import { isAlipayConfigured } from '../_lib/alipay.js';

function json(res, status, payload) {
  res.status(status).json(payload);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!isSupabaseServerConfigured()) {
    return json(res, 500, { ok: false, error: 'SERVER_NOT_CONFIGURED' });
  }

  const auth = await getAuthContext(req, { allowAnonymous: true });
  if (auth.error) {
    return json(res, auth.status || 401, { ok: false, error: auth.error });
  }

  try {
    const catalog = await getBillingCatalog(auth.client);
    const user = auth.user ? await getProfileById(auth.user.id) : null;
    const alipayCheckoutAvailable = isAlipayConfigured()
      && catalog.packs.some((pack) => pack.alipayAvailable);
    const checkoutProviders = {
      stripe: isStripeConfigured(),
      alipay: alipayCheckoutAvailable
    };
    return json(res, 200, {
      ok: true,
      checkoutAvailable: checkoutProviders.stripe || checkoutProviders.alipay,
      checkoutProviders,
      ...catalog,
      user
    });
  } catch (error) {
    console.warn('Failed to load billing plans', {
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return json(res, 500, { ok: false, error: 'SERVER_NOT_CONFIGURED' });
  }
}
