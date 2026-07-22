import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  CreditCard,
  ImageUp,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  LogOut,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench
} from 'lucide-react';
import './community.css';

const TERMS_VERSION = '2026-07-22';

const communityCopy = {
  zh: {
    brand: 'GPT-Image2 付费交流群',
    back: '返回案例库',
    admin: '管理后台',
    signIn: '登录',
    signOut: '退出登录',
    eyebrow: '一次付费 · 长期资格',
    title: '和真正做图的人，一起拆 Prompt、案例与工作流。',
    subtitle: '支付宝一次性支付 ¥9.90。付款资格绑定当前账号，换设备登录后仍可重新查看入群二维码。',
    priceSuffix: '一次性',
    benefitsTitle: '群里主要交流什么',
    benefits: ['GPT-Image2 Prompt 与案例拆解', '生图工具、模型表现与实用工作流', '创作者之间的实战问题与经验交流'],
    audienceTitle: '更适合这些人',
    audience: ['正在用 AI 做图或内容生产', '希望把零散 Prompt 变成稳定流程', '愿意分享真实尝试，也尊重他人交流'],
    boundaryTitle: '服务边界',
    boundaries: ['不承诺一对一服务或固定答疑次数', '不承诺独家资料、收益结果或永久群活跃度', '违法违规、广告骚扰或破坏交流秩序的账号可被撤销资格'],
    checking: '正在核对账号与付款资格…',
    loginTitle: '登录后才能购买和恢复资格',
    loginText: '资格绑定现有 Supabase 账号，避免二维码公开传播，也方便跨设备恢复。',
    availableTitle: '准备好后即可支付',
    availableText: '金额由服务端固定为 ¥9.90，浏览器无法修改。支付完成后由服务器向支付宝查单确认。',
    terms: '我已阅读并同意：本群以实战交流为主，不包含一对一服务、固定答疑、独家资料或收益承诺；退款需联系管理员人工审核。',
    pay: '支付宝支付 ¥9.90',
    redirecting: '正在打开支付宝收银台…',
    pendingTitle: '订单待支付或待确认',
    pendingText: '请勿重复付款。若已完成支付，可重新查询同一订单；支付宝通知和主动查单任一确认后都会恢复资格。',
    query: '重新查询支付结果',
    closeOrder: '关闭待支付订单',
    paidTitle: '付款资格已确认',
    paidText: '请使用微信扫描下方二维码入群。二维码仅对当前已付款账号显示。',
    qrUpdatingTitle: '付款已确认，群码正在更新',
    qrUpdatingText: '管理员尚未上传当前群二维码，或刚完成换码。请稍后刷新；你的付款资格不会丢失。',
    pausedTitle: '当前暂停新订单',
    pausedText: '已付款用户仍可查看群码，退款和管理员操作也不受影响。',
    refundedTitle: '该订单已退款',
    refundedText: '支付宝已确认退款成功，因此该订单的群码访问资格已失效。',
    revokedTitle: '该资格已被撤销',
    revokedText: '如有疑问，请通过页面底部的人工支持渠道联系管理员。',
    failedTitle: '暂时无法完成操作',
    retry: '重试',
    support: '退款与人工支持',
    supportText: '微信搜索苍何。退款经人工审核后原路退回；退款处理中仍保留资格，平台确认成功后才撤销。',
    resultEyebrow: '支付宝支付结果',
    resultTitle: '正在由服务器确认这笔订单。',
    resultText: '本页不会信任网址参数判定付款成功，只展示服务端查单或验签通知确认后的状态。',
    qrAlt: 'GPT-Image2 付费交流群二维码',
    noOrder: '当前账号没有可查询的付费群订单。',
    statusLabels: {
      PENDING: '待支付', PAID: '已付款', CLOSED: '已关闭', REFUNDED: '已退款', REVOKED: '已撤销'
    }
  },
  en: {
    brand: 'GPT-Image2 Paid Community',
    back: 'Back to gallery',
    admin: 'Admin',
    signIn: 'Sign in',
    signOut: 'Sign out',
    eyebrow: 'One payment · Long-term access',
    title: 'Discuss prompts, real cases, tools, and practical image workflows.',
    subtitle: 'A one-time Alipay payment of ¥9.90. Access is tied to your account and can be restored on another device.',
    priceSuffix: 'one time',
    benefitsTitle: 'What the group covers',
    benefits: ['GPT-Image2 prompt and case breakdowns', 'Image tools, model behavior, and practical workflows', 'Peer discussion grounded in real attempts'],
    audienceTitle: 'A good fit for',
    audience: ['People using AI for images or content production', 'People turning scattered prompts into stable workflows', 'People willing to share and respect the community'],
    boundaryTitle: 'Service boundaries',
    boundaries: ['No promise of one-to-one service or fixed answer frequency', 'No promise of exclusive materials, income, or permanent activity', 'Spam, unlawful behavior, or disruption may lead to access revocation'],
    checking: 'Checking your account and payment access…',
    loginTitle: 'Sign in to buy or restore access',
    loginText: 'Access is tied to your existing account so the group QR stays protected and works across devices.',
    availableTitle: 'Ready when you are',
    availableText: 'The server fixes the price at ¥9.90. Payment is confirmed only by a server-side Alipay query or verified notification.',
    terms: 'I agree that this is a peer discussion group, not one-to-one support, fixed Q&A, exclusive materials, or an income guarantee. Refunds require manual review.',
    pay: 'Pay ¥9.90 with Alipay',
    redirecting: 'Opening Alipay checkout…',
    pendingTitle: 'Payment pending or being confirmed',
    pendingText: 'Do not pay twice. Query the same order after payment; access is restored after a verified notification or server-side query.',
    query: 'Query payment again',
    closeOrder: 'Close pending order',
    paidTitle: 'Payment access confirmed',
    paidText: 'Scan the protected QR below with WeChat. It is available only to the signed-in paid account.',
    qrUpdatingTitle: 'Paid — group QR is being updated',
    qrUpdatingText: 'The administrator has not uploaded the current QR yet, or is replacing it. Your paid access remains valid.',
    pausedTitle: 'New payments are paused',
    pausedText: 'Paid users still retain QR access, while refunds and administrator operations continue.',
    refundedTitle: 'This order was refunded',
    refundedText: 'Alipay confirmed the refund, so QR access from this order is no longer active.',
    revokedTitle: 'This access was revoked',
    revokedText: 'Contact the administrator through the support channel below if you need help.',
    failedTitle: 'The operation could not be completed',
    retry: 'Retry',
    support: 'Refunds and support',
    supportText: 'Search 苍何 on WeChat. Approved refunds return through Alipay; access remains active until Alipay confirms success.',
    resultEyebrow: 'Alipay result',
    resultTitle: 'The server is confirming this order.',
    resultText: 'URL parameters are never treated as proof of payment. This page only shows server-verified status.',
    qrAlt: 'GPT-Image2 paid community QR code',
    noOrder: 'This account has no paid-community order to query.',
    statusLabels: {
      PENDING: 'Pending', PAID: 'Paid', CLOSED: 'Closed', REFUNDED: 'Refunded', REVOKED: 'Revoked'
    }
  }
};

function authHeaders(session) {
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

function submitPaymentForm(paymentHtml) {
  const container = document.createElement('div');
  container.className = 'communityPaymentHandoff';
  container.innerHTML = paymentHtml;
  document.body.appendChild(container);
  const form = container.querySelector('form');
  if (!form) {
    container.remove();
    throw new Error('PAYMENT_FORM_INVALID');
  }
  form.submit();
}

function CommunityStateCard({ icon, title, children, tone = '', actions = null }) {
  return (
    <section className={`communityStateCard ${tone}`.trim()}>
      <span className="communityStateIcon">{icon}</span>
      <div>
        <h2>{title}</h2>
        {children}
        {actions ? <div className="communityStateActions">{actions}</div> : null}
      </div>
    </section>
  );
}

export function CommunityPage({
  language,
  setLanguage,
  authReady,
  session,
  profile,
  onSignIn,
  onSignOut,
  onOpenAdmin
}) {
  const t = communityCopy[language] || communityCopy.en;
  const [config, setConfig] = useState(null);
  const [communityStatus, setCommunityStatus] = useState(null);
  const [phase, setPhase] = useState('checking');
  const [message, setMessage] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [qrState, setQrState] = useState('idle');
  const resultQueryRef = useRef('');
  const isResultPage = window.location.pathname.replace(/\/+$/, '') === '/community/result';
  const resultOrderId = useMemo(
    () => new URLSearchParams(window.location.search).get('order_id') || '',
    []
  );

  useEffect(() => {
    const previousTitle = document.title;
    document.title = language === 'zh'
      ? 'GPT-Image2 付费交流群'
      : 'GPT-Image2 Paid Community';
    return () => { document.title = previousTitle; };
  }, [language]);

  const loadQr = useCallback(async () => {
    if (!session?.access_token) return;
    setQrState('loading');
    try {
      const response = await fetch('/api/community/qr', {
        headers: authHeaders(session),
        cache: 'no-store'
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (payload.error === 'COMMUNITY_QR_NOT_READY') {
          setQrState('missing');
          return;
        }
        throw new Error(payload.error || 'COMMUNITY_QR_FAILED');
      }
      const blob = await response.blob();
      const nextUrl = URL.createObjectURL(blob);
      setQrUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextUrl;
      });
      setQrState('ready');
    } catch (error) {
      setQrState('error');
      setMessage(String(error?.message || 'COMMUNITY_QR_FAILED'));
      throw error;
    }
  }, [session?.access_token]);

  const loadStatus = useCallback(async () => {
    const response = await fetch('/api/community/status', {
      headers: authHeaders(session),
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'COMMUNITY_STATUS_FAILED');
    setCommunityStatus(payload);
    if (payload.eligible && payload.qrReady) await loadQr();
    else {
      setQrState(payload.eligible ? 'missing' : 'idle');
      setQrUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return '';
      });
    }
    return payload;
  }, [loadQr, session?.access_token]);

  useEffect(() => {
    if (!authReady) return undefined;
    let cancelled = false;
    setPhase('checking');
    setMessage('');
    Promise.all([
      fetch('/api/community/config', { cache: 'no-store' }).then((response) => response.json()),
      loadStatus()
    ])
      .then(([configPayload]) => {
        if (cancelled) return;
        if (!configPayload?.ok) throw new Error(configPayload?.error || 'COMMUNITY_CONFIG_FAILED');
        setConfig(configPayload);
        setPhase('ready');
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(String(error?.message || 'COMMUNITY_STATUS_FAILED'));
          setPhase('failed');
        }
      });
    return () => { cancelled = true; };
  }, [authReady, loadStatus, session?.access_token]);

  useEffect(() => () => {
    if (qrUrl) URL.revokeObjectURL(qrUrl);
  }, [qrUrl]);

  useEffect(() => {
    if (!authReady || !session?.access_token || !isResultPage || !resultOrderId) return undefined;
    const key = `${session.user?.id || ''}:${resultOrderId}`;
    if (resultQueryRef.current === key) return undefined;
    resultQueryRef.current = key;
    let cancelled = false;
    let timeoutId;

    async function confirmAndPoll() {
      setPhase('checking');
      try {
        const response = await fetch(`/api/community/alipay/query?orderId=${encodeURIComponent(resultOrderId)}`, {
          headers: authHeaders(session),
          cache: 'no-store'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok && payload.error !== 'COMMUNITY_QUERY_FAILED') {
          throw new Error(payload.error || 'COMMUNITY_QUERY_FAILED');
        }

        let latest = await loadStatus();
        setPhase('ready');
        for (let attempt = 0; attempt < 6 && !cancelled && latest.order?.status === 'PENDING'; attempt += 1) {
          await new Promise((resolve) => {
            timeoutId = window.setTimeout(resolve, 2500);
          });
          if (cancelled) return;
          latest = await loadStatus();
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(String(error?.message || 'COMMUNITY_QUERY_FAILED'));
          setPhase('failed');
        }
      }
    }
    confirmAndPoll();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [authReady, isResultPage, loadStatus, resultOrderId, session?.access_token, session?.user?.id]);

  async function handleCheckout() {
    if (!acceptedTerms || !session?.access_token) return;
    setPhase('redirecting');
    setMessage('');
    try {
      const response = await fetch('/api/community/alipay/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(session)
        },
        body: JSON.stringify({ acceptedTerms: true, termsVersion: TERMS_VERSION })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'COMMUNITY_CHECKOUT_FAILED');
      if (payload.paid) {
        await loadStatus();
        setPhase('ready');
        return;
      }
      submitPaymentForm(payload.paymentHtml);
    } catch (error) {
      setMessage(String(error?.message || 'COMMUNITY_CHECKOUT_FAILED'));
      setPhase('failed');
    }
  }

  async function handleRefreshStatus() {
    setPhase('checking');
    setMessage('');
    try {
      await loadStatus();
      setPhase('ready');
    } catch (error) {
      setMessage(String(error?.message || 'COMMUNITY_STATUS_FAILED'));
      setPhase('failed');
    }
  }

  async function handleQuery() {
    const orderId = communityStatus?.order?.id;
    if (!orderId) return;
    setPhase('checking');
    setMessage('');
    try {
      const response = await fetch(`/api/community/alipay/query?orderId=${encodeURIComponent(orderId)}`, {
        headers: authHeaders(session),
        cache: 'no-store'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'COMMUNITY_QUERY_FAILED');
      await loadStatus();
      setPhase('ready');
    } catch (error) {
      setMessage(String(error?.message || 'COMMUNITY_QUERY_FAILED'));
      setPhase('failed');
    }
  }

  async function handleClose() {
    const orderId = communityStatus?.order?.id;
    if (!orderId) return;
    setPhase('checking');
    setMessage('');
    try {
      const response = await fetch('/api/community/alipay/close', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(session)
        },
        body: JSON.stringify({ orderId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'COMMUNITY_CLOSE_FAILED');
      await loadStatus();
      setPhase('ready');
    } catch (error) {
      setMessage(String(error?.message || 'COMMUNITY_CLOSE_FAILED'));
      setPhase('failed');
    }
  }

  const orderStatus = communityStatus?.order?.status || '';
  const paymentEnabled = Boolean(communityStatus?.paymentEnabled ?? config?.paymentEnabled);
  let view = 'available';
  if (!authReady || phase === 'checking') view = 'checking';
  else if (phase === 'redirecting') view = 'redirecting';
  else if (phase === 'failed') view = 'failed';
  else if (!session?.access_token) view = 'login';
  else if (orderStatus === 'REFUNDED') view = 'refunded';
  else if (orderStatus === 'REVOKED') view = 'revoked';
  else if (communityStatus?.eligible && (qrState === 'missing' || !communityStatus.qrReady)) view = 'qrUpdating';
  else if (communityStatus?.eligible) view = 'paid';
  else if (orderStatus === 'PENDING') view = 'pending';
  else if (!paymentEnabled) view = 'paused';

  return (
    <div className="communityPage">
      <header className="communityTopbar">
        <a className="communityBrand" href="/community"><Users size={20} />{t.brand}</a>
        <nav>
          <a href="/"><ArrowLeft size={16} />{t.back}</a>
          <div className="communityLanguage" aria-label="Language">
            <button className={language === 'en' ? 'active' : ''} type="button" onClick={() => setLanguage('en')}>EN</button>
            <button className={language === 'zh' ? 'active' : ''} type="button" onClick={() => setLanguage('zh')}>中文</button>
          </div>
          {profile?.isSuperAdmin ? <button type="button" onClick={onOpenAdmin}><Wrench size={16} />{t.admin}</button> : null}
          {session?.access_token
            ? <button type="button" onClick={onSignOut}><LogOut size={16} />{t.signOut}</button>
            : <button type="button" onClick={onSignIn}><LogIn size={16} />{t.signIn}</button>}
        </nav>
      </header>

      <main className="communityMain">
        <section className="communityHero">
          <div>
            <span className="communityEyebrow"><Sparkles size={15} />{isResultPage ? t.resultEyebrow : t.eyebrow}</span>
            <h1>{isResultPage ? t.resultTitle : t.title}</h1>
            <p>{isResultPage ? t.resultText : t.subtitle}</p>
          </div>
          <div className="communityPrice">
            <span>¥</span><strong>9.90</strong><em>{t.priceSuffix}</em>
          </div>
        </section>

        <section className="communityContentGrid">
          <div className="communityPrimary">
            {view === 'checking' ? (
              <CommunityStateCard icon={<LoaderCircle className="spinIcon" size={24} />} title={t.checking} />
            ) : null}
            {view === 'redirecting' ? (
              <CommunityStateCard icon={<LoaderCircle className="spinIcon" size={24} />} title={t.redirecting} />
            ) : null}
            {view === 'login' ? (
              <CommunityStateCard
                icon={<LockKeyhole size={24} />}
                title={t.loginTitle}
                actions={<button type="button" onClick={onSignIn}><LogIn size={17} />{t.signIn}</button>}
              ><p>{t.loginText}</p></CommunityStateCard>
            ) : null}
            {view === 'available' ? (
              <CommunityStateCard icon={<CreditCard size={24} />} title={t.availableTitle}>
                <p>{t.availableText}</p>
                <label className="communityTerms">
                  <input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} />
                  <span>{t.terms}</span>
                </label>
                <button className="communityPayButton" type="button" disabled={!acceptedTerms} onClick={handleCheckout}>
                  <CreditCard size={18} />{t.pay}
                </button>
              </CommunityStateCard>
            ) : null}
            {view === 'pending' ? (
              <CommunityStateCard
                icon={<Clock3 size={24} />}
                title={t.pendingTitle}
                tone="pending"
                actions={<><button type="button" onClick={handleQuery}><RefreshCw size={17} />{t.query}</button><button className="secondary" type="button" onClick={handleClose}>{t.closeOrder}</button></>}
              ><p>{t.pendingText}</p></CommunityStateCard>
            ) : null}
            {view === 'paid' ? (
              <CommunityStateCard icon={<CheckCircle2 size={24} />} title={t.paidTitle} tone="success">
                <p>{t.paidText}</p>
                {qrUrl ? <img className="communityProtectedQr" src={qrUrl} alt={t.qrAlt} /> : null}
              </CommunityStateCard>
            ) : null}
            {view === 'qrUpdating' ? (
              <CommunityStateCard
                icon={<ImageUp size={24} />}
                title={t.qrUpdatingTitle}
                tone="pending"
                actions={<button type="button" onClick={handleRefreshStatus}><RefreshCw size={17} />{t.retry}</button>}
              ><p>{t.qrUpdatingText}</p></CommunityStateCard>
            ) : null}
            {view === 'paused' ? (
              <CommunityStateCard icon={<CircleAlert size={24} />} title={t.pausedTitle} tone="paused"><p>{t.pausedText}</p></CommunityStateCard>
            ) : null}
            {view === 'refunded' ? (
              <CommunityStateCard icon={<RotateCcw size={24} />} title={t.refundedTitle} tone="muted"><p>{t.refundedText}</p></CommunityStateCard>
            ) : null}
            {view === 'revoked' ? (
              <CommunityStateCard icon={<LockKeyhole size={24} />} title={t.revokedTitle} tone="muted"><p>{t.revokedText}</p></CommunityStateCard>
            ) : null}
            {view === 'failed' ? (
              <CommunityStateCard
                icon={<CircleAlert size={24} />}
                title={t.failedTitle}
                tone="error"
                actions={<button type="button" onClick={() => { setPhase('checking'); loadStatus().then(() => setPhase('ready')).catch((error) => { setMessage(String(error?.message || 'COMMUNITY_STATUS_FAILED')); setPhase('failed'); }); }}><RefreshCw size={17} />{t.retry}</button>}
              ><p>{message}</p></CommunityStateCard>
            ) : null}
            {isResultPage && authReady && session?.access_token && !resultOrderId ? (
              <p className="communityInlineNotice">{t.noOrder}</p>
            ) : null}
            {communityStatus?.order ? (
              <div className="communityOrderBadge">
                <ShieldCheck size={15} />
                <span>{t.statusLabels[communityStatus.order.status] || communityStatus.order.status}</span>
                <code>{communityStatus.order.id}</code>
              </div>
            ) : null}
          </div>

          <aside className="communitySidebar">
            <section><h2>{t.benefitsTitle}</h2><ul>{t.benefits.map((item) => <li key={item}><Check size={16} />{item}</li>)}</ul></section>
            <section><h2>{t.audienceTitle}</h2><ul>{t.audience.map((item) => <li key={item}><Check size={16} />{item}</li>)}</ul></section>
            <section className="boundary"><h2>{t.boundaryTitle}</h2><ul>{t.boundaries.map((item) => <li key={item}><ShieldCheck size={16} />{item}</li>)}</ul></section>
          </aside>
        </section>

        <section className="communitySupport">
          <MessageCircle size={21} />
          <div><h2>{t.support}</h2><p>{config?.support || t.supportText}</p><small>{t.supportText}</small></div>
        </section>
      </main>
    </div>
  );
}

export function CommunityAdminSection({ language, session }) {
  const zh = language === 'zh';
  const [orders, setOrders] = useState([]);
  const [qrMeta, setQrMeta] = useState(null);
  const [qrUrl, setQrUrl] = useState('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');

  const loadData = useCallback(async () => {
    if (!session?.access_token) return;
    setStatus('loading');
    setMessage('');
    try {
      const headers = authHeaders(session);
      const [ordersResponse, qrResponse] = await Promise.all([
        fetch('/api/admin/community/orders', { headers, cache: 'no-store' }),
        fetch('/api/admin/community/qr?metadata=1', { headers, cache: 'no-store' })
      ]);
      const ordersPayload = await ordersResponse.json().catch(() => ({}));
      if (!ordersResponse.ok || !ordersPayload.ok) throw new Error(ordersPayload.error || 'COMMUNITY_ADMIN_ORDERS_FAILED');
      setOrders(ordersPayload.orders || []);
      if (qrResponse.ok) {
        const qrPayload = await qrResponse.json().catch(() => ({}));
        setQrMeta(qrPayload.asset || null);
        const imageResponse = await fetch(`/api/admin/community/qr?v=${encodeURIComponent(qrPayload.asset?.id || '')}`, {
          headers,
          cache: 'no-store'
        });
        if (imageResponse.ok) {
          const nextUrl = URL.createObjectURL(await imageResponse.blob());
          setQrUrl((current) => {
            if (current) URL.revokeObjectURL(current);
            return nextUrl;
          });
        }
      } else if (qrResponse.status === 404) {
        setQrMeta(null);
        setQrUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return '';
        });
      } else {
        const qrPayload = await qrResponse.json().catch(() => ({}));
        throw new Error(qrPayload.error || 'COMMUNITY_QR_FAILED');
      }
      setStatus('ready');
    } catch (error) {
      setMessage(String(error?.message || 'COMMUNITY_ADMIN_FAILED'));
      setStatus('error');
    }
  }, [session?.access_token]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => () => { if (qrUrl) URL.revokeObjectURL(qrUrl); }, [qrUrl]);

  async function uploadQr(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setMessage(zh ? '仅支持 2 MB 内的 PNG、JPEG 或 WebP。' : 'Use a PNG, JPEG, or WebP file under 2 MB.');
      return;
    }
    setStatus('loading');
    try {
      const response = await fetch('/api/admin/community/qr', {
        method: 'POST',
        headers: { 'Content-Type': file.type, ...authHeaders(session) },
        body: file
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'COMMUNITY_QR_UPLOAD_FAILED');
      await loadData();
      setMessage(zh ? '群二维码已原子替换。' : 'The group QR was replaced atomically.');
    } catch (error) {
      setMessage(String(error?.message || 'COMMUNITY_QR_UPLOAD_FAILED'));
      setStatus('error');
    }
  }

  async function orderAction(order, action) {
    const destructive = action === 'refund' || action === 'revoke';
    if (destructive && !window.confirm(zh ? '确认对这笔订单执行该操作？' : 'Confirm this order action?')) return;
    setBusyId(`${action}:${order.id}`);
    setMessage('');
    try {
      const isQuery = action === 'refund-query';
      const url = isQuery
        ? `/api/admin/community/refund-query?orderId=${encodeURIComponent(order.id)}`
        : `/api/admin/community/${action}`;
      const response = await fetch(url, {
        method: isQuery ? 'GET' : 'POST',
        headers: isQuery ? authHeaders(session) : { 'Content-Type': 'application/json', ...authHeaders(session) },
        body: isQuery ? undefined : JSON.stringify({ orderId: order.id })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'COMMUNITY_ADMIN_ACTION_FAILED');
      await loadData();
      setMessage(zh ? '订单状态已更新。' : 'Order status updated.');
    } catch (error) {
      setMessage(String(error?.message || 'COMMUNITY_ADMIN_ACTION_FAILED'));
    } finally {
      setBusyId('');
    }
  }

  return (
    <section className="communityAdminBlock">
      <div className="communityAdminHeader">
        <div><span><Users size={17} />{zh ? '付费交流群' : 'Paid community'}</span><h3>{zh ? '订单、群码与退款' : 'Orders, QR, and refunds'}</h3></div>
        <button type="button" onClick={loadData} disabled={status === 'loading'}><RefreshCw size={16} />{zh ? '刷新' : 'Refresh'}</button>
      </div>
      <div className="communityAdminQr">
        {qrUrl ? <img src={qrUrl} alt={zh ? '当前付费群二维码' : 'Current paid group QR'} /> : <div><ImageUp size={28} /><span>{zh ? '尚未上传受保护群码' : 'No protected QR uploaded'}</span></div>}
        <label><ImageUp size={16} />{qrMeta ? (zh ? '替换群二维码' : 'Replace QR') : (zh ? '上传群二维码' : 'Upload QR')}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadQr} /></label>
        {qrMeta ? <small>{qrMeta.mediaType} · {Math.ceil(qrMeta.sizeBytes / 1024)} KB</small> : null}
      </div>
      {message ? <p className="communityAdminMessage">{message}</p> : null}
      <div className="communityAdminTableWrap">
        <table>
          <thead><tr><th>{zh ? '账号' : 'Account'}</th><th>{zh ? '状态' : 'Status'}</th><th>{zh ? '金额' : 'Amount'}</th><th>{zh ? '付款时间' : 'Paid at'}</th><th>{zh ? '退款状态' : 'Refund'}</th><th>{zh ? '操作' : 'Actions'}</th></tr></thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td><strong>{order.email || order.userId}</strong><small>{order.id}</small></td>
                <td><span className={`communityOrderStatus ${order.status.toLowerCase()}`}>{order.status}</span></td>
                <td>¥{(order.amountCents / 100).toFixed(2)}</td>
                <td>{order.paidAt ? new Date(order.paidAt).toLocaleString() : '—'}</td>
                <td>{order.refundStatus}</td>
                <td><div className="communityAdminActions">
                  {order.status === 'PAID' && order.refundStatus !== 'PROCESSING' ? <button type="button" disabled={Boolean(busyId)} onClick={() => orderAction(order, 'refund')}>{zh ? '退款' : 'Refund'}</button> : null}
                  {order.status === 'PAID' && order.refundStatus === 'PROCESSING' ? <button type="button" disabled={Boolean(busyId)} onClick={() => orderAction(order, 'refund-query')}>{zh ? '查询退款' : 'Query refund'}</button> : null}
                  {order.status === 'PAID' && order.refundStatus !== 'PROCESSING' ? <button className="danger" type="button" disabled={Boolean(busyId)} onClick={() => orderAction(order, 'revoke')}>{zh ? '撤销资格' : 'Revoke'}</button> : null}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!orders.length && status !== 'loading' ? <p>{zh ? '暂无付费群订单。' : 'No paid-community orders yet.'}</p> : null}
      </div>
    </section>
  );
}
