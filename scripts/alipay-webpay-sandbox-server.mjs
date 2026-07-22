import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  formatAlipayAmount,
  getAlipayClient,
  isAlipayTradePaid,
  validateAlipayOrderResult
} from '../api/_lib/alipay.js';

const host = '127.0.0.1';
const port = Number(process.env.ALIPAY_SANDBOX_PORT || 4174);
const origin = `http://${host}:${port}`;
const amountCents = 990;
const orders = new Map();
const checkoutToken = randomUUID();

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function send(res, status, body, contentType = 'text/html; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(body);
}

function layout(title, content, script = '') {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: #18211d; background: radial-gradient(circle at top, #e8fff3, #f7f5ee 55%); }
    main { width: min(92vw, 680px); padding: 38px; border: 1px solid #d9ded9; border-radius: 28px; background: rgba(255,255,255,.94); box-shadow: 0 24px 70px rgba(28,50,38,.12); }
    .eyebrow { color: #087443; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 10px 0 12px; font-size: clamp(32px, 6vw, 54px); line-height: 1.03; }
    p { line-height: 1.75; color: #526059; }
    .price { margin: 30px 0; font-size: 46px; font-weight: 850; }
    .price small { font-size: 15px; font-weight: 650; color: #66736c; }
    button, a.button { display: inline-flex; align-items: center; justify-content: center; width: 100%; min-height: 52px; border: 0; border-radius: 14px; color: white; background: #0b7b49; font: inherit; font-weight: 760; cursor: pointer; text-decoration: none; }
    .notice { margin-top: 22px; padding: 16px; border-radius: 14px; background: #fff7dc; color: #6b5413; font-size: 14px; }
    .status { margin: 24px 0; padding: 18px; border-radius: 14px; background: #eef7f1; font-weight: 720; }
    code { overflow-wrap: anywhere; }
  </style>
</head>
<body><main>${content}</main>${script}</body>
</html>`;
}

function paymentPage() {
  return layout('支付宝网站支付沙箱体验', `
    <div class="eyebrow">Local sandbox only</div>
    <h1>支付宝网站支付</h1>
    <p>这是项目本地沙箱体验入口。点击后会生成支付宝沙箱收银台表单，不会产生真实资金扣款，也不会写入线上 Supabase。</p>
    <div class="price">¥9.90 <small>一次性沙箱订单</small></div>
    <form method="post" action="/checkout">
      <input type="hidden" name="checkout_token" value="${escapeHtml(checkoutToken)}">
      <button type="submit">进入支付宝沙箱收银台</button>
    </form>
    <div class="notice">仅用于网站支付联调。生产环境仍使用项目现有的登录、订单、异步通知和资格交付链路。</div>
  `);
}

async function readForm(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8 * 1024) {
      throw new Error('REQUEST_BODY_TOO_LARGE');
    }
  }
  return new URLSearchParams(body);
}

function resultPage(orderId) {
  const safeId = escapeHtml(orderId);
  return layout('正在确认支付结果', `
    <div class="eyebrow">Server-side query</div>
    <h1>正在确认支付结果</h1>
    <p>页面不会根据回跳参数直接判定成功，而是使用本地保存的订单并由服务端向支付宝查询。</p>
    <div id="status" class="status">正在查询支付宝订单状态…</div>
    <p><code>${safeId}</code></p>
    <a class="button" href="/">返回沙箱付款页</a>
  `, `<script>
    const statusNode = document.getElementById('status');
    const orderId = ${JSON.stringify(orderId)};
    async function refresh() {
      try {
        const response = await fetch('/api/status?order_id=' + encodeURIComponent(orderId), { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'QUERY_FAILED');
        statusNode.textContent = payload.message;
        if (payload.state === 'PENDING') setTimeout(refresh, 2500);
      } catch {
        statusNode.textContent = '暂时无法确认，请稍后刷新页面重试。';
      }
    }
    refresh();
  </script>`);
}

async function queryOrder(order) {
  if (order.status === 'PAID') {
    return { state: 'PAID', message: '支付宝已确认付款成功（沙箱）。' };
  }

  const { sdk } = getAlipayClient();
  const result = await sdk.exec('alipay.trade.query', {
    bizContent: { out_trade_no: order.id }
  }, { validateSign: true });

  if (String(result?.code || '') !== '10000') {
    const code = String(result?.sub_code || result?.code || '');
    if (code.includes('TRADE_NOT_EXIST')) {
      return { state: 'PENDING', message: '订单尚未创建或支付宝仍在处理，请稍候…' };
    }
    throw new Error('ALIPAY_SANDBOX_QUERY_FAILED');
  }
  if (!validateAlipayOrderResult(order, result)) {
    throw new Error('ALIPAY_SANDBOX_RESULT_MISMATCH');
  }
  if (isAlipayTradePaid(result.trade_status)) {
    order.status = 'PAID';
    return { state: 'PAID', message: '支付宝已确认付款成功（沙箱）。' };
  }
  if (result.trade_status === 'TRADE_CLOSED') {
    order.status = 'CLOSED';
    return { state: 'CLOSED', message: '订单已关闭。' };
  }
  return { state: 'PENDING', message: '订单待支付，请在沙箱收银台完成付款…' };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', origin);
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, paymentPage());
    }

    if (req.method === 'GET' && url.pathname === '/checkout') {
      res.writeHead(303, {
        Location: '/',
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end();
    }

    if (req.method === 'POST' && url.pathname === '/checkout') {
      const form = await readForm(req);
      if (form.get('checkout_token') !== checkoutToken) {
        return send(res, 403, 'forbidden', 'text/plain; charset=utf-8');
      }
      const id = randomUUID();
      const order = {
        id,
        amount_cents: amountCents,
        currency: 'CNY',
        status: 'PENDING',
        created_at: new Date().toISOString()
      };
      orders.set(id, order);

      const { sdk } = getAlipayClient();
      const paymentHtml = sdk.pageExec('alipay.trade.page.pay', 'POST', {
        returnUrl: `${origin}/result?order_id=${encodeURIComponent(id)}`,
        bizContent: {
          out_trade_no: id,
          total_amount: formatAlipayAmount(amountCents),
          subject: 'GPT-Image2 付费交流群沙箱体验',
          product_code: 'FAST_INSTANT_TRADE_PAY',
          timeout_express: '30m'
        }
      });
      if (typeof paymentHtml !== 'string' || !paymentHtml.includes('<form')) {
        throw new Error('ALIPAY_PAYMENT_FORM_INVALID');
      }
      return send(res, 200, paymentHtml);
    }

    if (req.method === 'GET' && url.pathname === '/result') {
      const orderId = String(url.searchParams.get('order_id') || '');
      if (!orders.has(orderId)) {
        return send(res, 200, layout('未找到本地订单', `
          <div class="eyebrow">Safe fallback</div>
          <h1>未找到本地订单</h1>
          <p>该页面不会仅凭回跳参数展示付款成功。请返回付款页重新创建沙箱订单。</p>
          <a class="button" href="/">返回沙箱付款页</a>
        `));
      }
      return send(res, 200, resultPage(orderId));
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      const orderId = String(url.searchParams.get('order_id') || '');
      const order = orders.get(orderId);
      if (!order) {
        return send(res, 404, JSON.stringify({ ok: false, error: 'ORDER_NOT_FOUND' }), 'application/json; charset=utf-8');
      }
      const status = await queryOrder(order);
      return send(res, 200, JSON.stringify({ ok: true, ...status }), 'application/json; charset=utf-8');
    }

    return send(res, 404, 'not found', 'text/plain; charset=utf-8');
  } catch (error) {
    console.warn('Alipay sandbox experience request failed', {
      path: url.pathname,
      message: String(error?.message || 'unknown').slice(0, 160)
    });
    return send(res, 500, layout('沙箱请求失败', `
      <div class="eyebrow">Request failed</div>
      <h1>沙箱请求失败</h1>
      <p>请回到付款页重试；终端日志只记录脱敏错误类别。</p>
      <a class="button" href="/">返回沙箱付款页</a>
    `));
  }
});

server.listen(port, host, () => {
  console.log(`Alipay web payment sandbox: ${origin}/`);
});
