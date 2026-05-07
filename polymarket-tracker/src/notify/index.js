import { consoleNotifier } from './console.js';
import { whatsappNotifier } from './whatsapp.js';

export function buildNotifiers() {
  return [consoleNotifier(), whatsappNotifier()].filter(Boolean);
}

export async function notifyAll(notifiers, text) {
  await Promise.all(notifiers.map((n) => n.send(text).catch(() => {})));
}

export function formatTrade(t, rank) {
  const dir = t.side === 'BUY' || t.side === 'BID' ? 'BUY ' : 'SELL';
  const usdc = t.usdc || t.size * t.price;
  const market = t.marketTitle || t.market || 'unknown market';
  const rankStr = rank ? `#${rank} ` : '';
  const short = `${t.wallet.slice(0, 6)}...${t.wallet.slice(-4)}`;
  return (
    `Polymarket: ${rankStr}${short} ${dir} ` +
    `${t.size.toFixed(2)} @ $${t.price.toFixed(3)} ` +
    `(~$${usdc.toFixed(2)}) on "${market}"`
  );
}
