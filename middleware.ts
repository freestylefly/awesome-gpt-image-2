// Hotlink protection for static assets served from this Vite site.
// Runs before the filesystem/static cache on Vercel (Routing Middleware, Edge).
// Blocks third-party sites from hotlinking images/JSON while allowing:
//   - empty/missing referer (direct visits, curl, download tools)
//   - same-site referers (the request's own host, its subdomains, and the
//     stable production aliases below; preview vercel.app domains are the
//     request's own host at request time, so they are covered automatically)
// Every blocked attempt is logged with client IP so abuse can be traced.

const ALLOWED_REFERRER_HOSTS = [
  'gpt-image2.canghe.ai',
  'awesome-gpt-image-2.vercel.app',
  'localhost',
  '127.0.0.1',
];

const PROTECTED_PREFIXES = ['/images/', '/cases.json', '/assets/'];

function isAllowedReferer(refererHostname, requestHostname) {
  if (!refererHostname) {
    return false;
  }
  if (
    requestHostname &&
    (refererHostname === requestHostname || refererHostname.endsWith('.' + requestHostname))
  ) {
    return true;
  }
  return ALLOWED_REFERRER_HOSTS.some(
    (host) => refererHostname === host || refererHostname.endsWith('.' + host)
  );
}

export default function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (!PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return undefined;
  }

  const referer = request.headers.get('referer') || '';
  if (!referer) {
    return undefined;
  }

  let refererHostname = null;
  try {
    refererHostname = new URL(referer).hostname;
  } catch (error) {
    refererHostname = null;
  }

  const requestHostname = (request.headers.get('host') || url.hostname || '')
    .split(':')[0]
    .toLowerCase();

  if (isAllowedReferer(refererHostname, requestHostname)) {
    return undefined;
  }

  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const ua = (request.headers.get('user-agent') || '').slice(0, 100);
  console.log(
    `[hotlink-block] ip=${ip} path=${pathname} referer=${refererHostname || '(invalid)'} ua=${ua}`
  );

  return new Response('403 Forbidden', {
    status: 403,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export const config = {
  matcher: ['/images/:path*', '/cases.json', '/assets/:path*'],
};
