// Executes sure-thing buys when EXEC_MODE permits and AUTO_EXECUTE is on.
//
// Three modes (from config.sureThing.execMode):
//   surface   — never execute; the dashboard is the only output
//   confirm   — execute only candidates with smart-money score == 'green'
//   all       — execute every priced candidate that passes the active rule
//               (still respects SMART_MONEY_RULE for what reaches us)
//
// All trades go through the same MAX_TRADE_USDC / MAX_OPEN_USDC guardrails as
// the mirror-trade path.

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
      const chainId = Chain?.POLYGON ?? 137;
      const client = new ClobClient(config.api.clob, chainId, wallet);
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

function shouldExecute(candidate) {
  if (!config.execute.enabled) return { skip: 'auto_execute_disabled' };
  const mode = config.sureThing.execMode;
  if (mode === 'surface') return { skip: 'mode_surface' };
  if (mode === 'confirm' && candidate.smartMoney.score !== 'green') {
    return { skip: 'smart_money_not_green' };
  }
  // mode === 'all' or confirmed-green: proceed
  return { proceed: true };
}

function tokenIdFor(candidate) {
  return candidate.sureSide === 'YES' ? candidate.yesTokenId : candidate.noTokenId;
}

// Cap the per-trade size at MAX_TRADE_USDC and clamp the limit price to the
// lesser of (best ask + slippage) and 0.99. We submit GTC so partial fills
// rest as a resting limit at the same price.
function buildOrder(candidate) {
  const cap = config.execute.maxTradeUsdc;
  const slipBps = config.sureThing.slippageBps;
  const ask = candidate.sureAsk ?? candidate.surePrice;
  const price = Math.min(0.99, ask * (1 + slipBps / 10000));
  const shares = cap / price;
  return {
    tokenID: tokenIdFor(candidate),
    price,
    side: 'BUY',
    size: shares,
    feeRateBps: 0,
    sizeUsdc: cap,
  };
}

export async function executeCandidate(candidate) {
  const gate = shouldExecute(candidate);
  if (gate.skip) return { skipped: gate.skip };
  if (!tokenIdFor(candidate)) return { skipped: 'missing_token_id' };

  const state = await loadState();
  state.sureThingTrades ??= [];
  // Dedupe — we'll see the same candidate on consecutive scans until end_date.
  if (state.sureThingTrades.some((t) => t.conditionId === candidate.conditionId && t.side === candidate.sureSide)) {
    return { skipped: 'duplicate_candidate' };
  }
  if (state.openMirroredUsdc >= config.execute.maxOpenUsdc) {
    return { skipped: 'max_open_usdc_reached' };
  }

  const order = buildOrder(candidate);
  log.info(
    `sure-thing buy -> ${candidate.sureSide} on "${candidate.question?.slice(0, 60)}" ` +
      `@ ${order.price.toFixed(3)} size $${order.sizeUsdc.toFixed(2)} ` +
      `(smart-money: ${candidate.smartMoney.score})`,
  );

  try {
    const client = await getClient();
    const signed = await client.createOrder(order);
    const resp = await client.postOrder(signed, 'GTC');
    const ourOrderId = resp?.orderID || resp?.orderId || null;
    state.sureThingTrades.push({
      conditionId: candidate.conditionId,
      slug: candidate.slug,
      question: candidate.question,
      side: candidate.sureSide,
      ourOrderId,
      price: order.price,
      shares: order.size,
      usdc: order.sizeUsdc,
      smartMoneyScore: candidate.smartMoney.score,
      placedTs: Math.floor(Date.now() / 1000),
      endSec: candidate.endSec,
    });
    state.openMirroredUsdc += order.sizeUsdc;
    await saveState(state);
    return { placed: true, ourOrderId, sizeUsdc: order.sizeUsdc };
  } catch (err) {
    log.error(`sure-thing order failed: ${err.message}`);
    return { error: err.message };
  }
}
