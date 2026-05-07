// Auto-execute mirroring via @polymarket/clob-client.
//
// SAFETY: this module only runs when AUTO_EXECUTE=true. Even then, it enforces
// per-trade and total-open caps from config. You are responsible for funding a
// dedicated wallet with USDC on Polygon and approving Polymarket's contracts
// (the clob-client docs cover one-time approvals).
//
// This is a careful scaffold rather than a fire-and-forget bot. Polymarket's
// SDK surface evolves; before flipping AUTO_EXECUTE on, run a dry test on a
// single tiny trade, check the placed order on polymarket.com, and only then
// raise MAX_TRADE_USDC.

import { config } from '../config.js';
import { log } from '../log.js';
import { loadState, saveState } from '../store.js';

let clientPromise = null;

async function getClient() {
  if (!config.execute.privateKey) {
    throw new Error('TRADER_PRIVATE_KEY not set');
  }
  if (!clientPromise) {
    clientPromise = (async () => {
      const { ClobClient, Chain } = await import('@polymarket/clob-client');
      const { Wallet } = await import('ethers');
      const wallet = new Wallet(config.execute.privateKey);
      const host = config.api.clob;
      const chainId = Chain?.POLYGON ?? 137;
      const client = new ClobClient(host, chainId, wallet);
      // First-run: derive API creds. Polymarket caches these per wallet.
      try {
        const creds = await client.createOrDeriveApiKey();
        client.setApiCreds?.(creds);
      } catch (err) {
        log.warn(`createOrDeriveApiKey failed: ${err.message}`);
      }
      return client;
    })();
  }
  return clientPromise;
}

function mirrorSizeUsdc(leaderUsdc) {
  const cap = config.execute.maxTradeUsdc;
  if (config.execute.sizingMode === 'percent') {
    const pct = Math.max(0, config.execute.sizingPercent) / 100;
    return Math.min(cap, leaderUsdc * pct);
  }
  return Math.min(cap, leaderUsdc || cap);
}

function tooOld(tradeTs) {
  const ageSec = Math.floor(Date.now() / 1000) - tradeTs;
  return ageSec > config.execute.maxTradeAgeSec;
}

export async function mirrorTrade(trade) {
  if (!config.execute.enabled) return { skipped: 'auto_execute_disabled' };
  if (!trade.tokenId) return { skipped: 'missing_token_id' };
  if (trade.side !== 'BUY' && trade.side !== 'BID') {
    // Conservative default: only mirror opening longs. Sells require us to
    // already hold the position; that's a separate code path.
    return { skipped: 'sell_or_close_not_mirrored' };
  }
  if (tooOld(trade.ts)) return { skipped: 'stale_trade' };

  const state = await loadState();
  if (state.openMirroredUsdc >= config.execute.maxOpenUsdc) {
    return { skipped: 'max_open_usdc_reached' };
  }
  const dupe = state.mirroredTrades.find((m) => m.srcTradeId === trade.id);
  if (dupe) return { skipped: 'duplicate' };

  const sizeUsdc = mirrorSizeUsdc(trade.usdc || trade.size * trade.price);
  if (sizeUsdc < 1) return { skipped: 'size_below_minimum' };

  const client = await getClient();
  const price = Math.min(0.99, Math.max(0.01, trade.price));
  // Convert USDC notional to outcome-token shares. For YES/NO tokens priced
  // in [0,1], shares = usdc / price.
  const shares = sizeUsdc / price;

  const order = {
    tokenID: trade.tokenId,
    price,
    side: 'BUY',
    size: shares,
    feeRateBps: 0,
  };
  log.info(`mirror order -> ${JSON.stringify(order)}`);

  try {
    const signed = await client.createOrder(order);
    const resp = await client.postOrder(signed, 'GTC');
    const ourOrderId = resp?.orderID || resp?.orderId || null;
    state.mirroredTrades.push({
      srcWallet: trade.wallet,
      srcTradeId: trade.id,
      ourOrderId,
      tokenId: trade.tokenId,
      market: trade.market,
      side: 'BUY',
      shares,
      price,
      usdc: sizeUsdc,
      ts: Math.floor(Date.now() / 1000),
    });
    state.openMirroredUsdc += sizeUsdc;
    await saveState(state);
    return { placed: true, ourOrderId, sizeUsdc };
  } catch (err) {
    log.error(`mirror order failed: ${err.message}`);
    return { error: err.message };
  }
}
