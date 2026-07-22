import {
  closeCommunityOrderLocally,
  isPaidTradeStatus,
  markCommunityOrderPaid,
  validateCommunityTradeResult
} from './community.js';

export function isAlipayTradeNotFound(result) {
  const code = String(result?.sub_code || result?.code || '').toUpperCase();
  return code === 'ACQ.TRADE_NOT_EXIST' || code.includes('TRADE_NOT_EXIST');
}

export async function queryCommunityOrderAtAlipay(client, sdk, order) {
  const result = await sdk.exec('alipay.trade.query', {
    bizContent: { out_trade_no: order.id }
  }, { validateSign: true });

  if (String(result?.code || '') !== '10000') {
    if (isAlipayTradeNotFound(result)) return { state: 'NOT_FOUND', result };
    const error = new Error('ALIPAY_COMMUNITY_QUERY_FAILED');
    error.alipayCode = String(result?.sub_code || result?.code || 'UNKNOWN');
    throw error;
  }

  const validation = validateCommunityTradeResult(order, result);
  if (!validation.ok) throw new Error(`ALIPAY_COMMUNITY_${validation.error}`);

  if (isPaidTradeStatus(result.trade_status)) {
    await markCommunityOrderPaid(client, order, result);
    return { state: 'PAID', result };
  }

  if (result.trade_status === 'TRADE_CLOSED') {
    await closeCommunityOrderLocally(client, order.id);
    return { state: 'CLOSED', result };
  }

  if (result.trade_status !== 'WAIT_BUYER_PAY') {
    throw new Error('ALIPAY_COMMUNITY_UNKNOWN_TRADE_STATE');
  }
  return { state: 'PENDING', result };
}

export async function closeCommunityOrderAtAlipay(client, sdk, order) {
  const query = await queryCommunityOrderAtAlipay(client, sdk, order);
  if (query.state === 'PAID' || query.state === 'CLOSED') return query;

  const result = await sdk.exec('alipay.trade.close', {
    bizContent: { out_trade_no: order.id }
  }, { validateSign: true });
  const closed = String(result?.code || '') === '10000' || isAlipayTradeNotFound(result);
  if (!closed) {
    const error = new Error('ALIPAY_COMMUNITY_CLOSE_FAILED');
    error.alipayCode = String(result?.sub_code || result?.code || 'UNKNOWN');
    throw error;
  }

  await closeCommunityOrderLocally(client, order.id);
  return { state: 'CLOSED', result };
}
