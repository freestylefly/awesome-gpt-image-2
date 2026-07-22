const routeLoaders = new Map([
  ['/api/community/config', () => import('../api/community/config.js')],
  ['/api/community/status', () => import('../api/community/status.js')],
  ['/api/community/qr', () => import('../api/community/qr.js')],
  ['/api/community/alipay/checkout', () => import('../api/community/alipay/checkout.js')],
  ['/api/community/alipay/close', () => import('../api/community/alipay/close.js')],
  ['/api/community/alipay/query', () => import('../api/community/alipay/query.js')],
  ['/api/community/alipay/notify', () => import('../api/community/alipay/notify.js')],
  ['/api/admin/community/orders', () => import('../api/admin/community/orders.js')],
  ['/api/admin/community/qr', () => import('../api/admin/community/qr.js')],
  ['/api/admin/community/refund', () => import('../api/admin/community/refund.js')],
  ['/api/admin/community/refund-query', () => import('../api/admin/community/refund-query.js')],
  ['/api/admin/community/revoke', () => import('../api/admin/community/revoke.js')]
]);

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function isSupabaseServerConfigured() {
  return Boolean(
    (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)
    && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function attachVercelResponseHelpers(res) {
  res.status = (status) => {
    res.statusCode = status;
    return res;
  };
  res.json = (payload) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return res;
  };
  res.send = (payload) => {
    res.end(payload);
    return res;
  };
  res.redirect = (statusOrLocation, maybeLocation) => {
    const status = typeof statusOrLocation === 'number' ? statusOrLocation : 307;
    const location = typeof statusOrLocation === 'number' ? maybeLocation : statusOrLocation;
    res.statusCode = status;
    res.setHeader('Location', location);
    res.end();
    return res;
  };
}

export function localVercelApi() {
  return {
    name: 'local-vercel-community-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
        const routeLoader = routeLoaders.get(requestUrl.pathname);
        const isCommunityApi = requestUrl.pathname.startsWith('/api/community/')
          || requestUrl.pathname.startsWith('/api/admin/community/');

        if (!routeLoader) {
          if (isCommunityApi) return sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
          return next();
        }

        if (requestUrl.pathname === '/api/community/status' && !isSupabaseServerConfigured()) {
          return sendJson(res, 200, {
            ok: true,
            authenticated: false,
            eligible: false,
            qrReady: false,
            paymentEnabled: false,
            order: null,
            localPreview: true
          });
        }

        req.query = Object.fromEntries(requestUrl.searchParams.entries());
        req.headers['x-forwarded-proto'] ||= 'http';
        attachVercelResponseHelpers(res);

        try {
          const module = await routeLoader();
          await module.default(req, res);
        } catch (error) {
          server.config.logger.error(`Local API request failed: ${requestUrl.pathname}`);
          if (!res.headersSent) {
            return sendJson(res, 500, { ok: false, error: 'LOCAL_API_FAILED' });
          }
          if (!res.writableEnded) res.end();
        }
      });
    }
  };
}
