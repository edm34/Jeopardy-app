// Normalize gamma-api market entries into the shape the sure-thing scanner
// expects. Gamma's response is loosely typed — token IDs come as a
// JSON-string-of-array, outcomes/prices as parallel arrays — so this is the
// one place to defend against shape drift.

import { log } from '../log.js';
import { getOrderbook, listMarkets } from './api.js';

const HOUR_SEC = 3600;

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function parseList(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const j = JSON.parse(v);
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseEndDateSec(m) {
  const candidates = [m.endDate, m.end_date, m.endDateIso, m.end_date_iso];
  for (const c of candidates) {
    if (!c) continue;
    const t = Date.parse(c);
    if (Number.isFinite(t)) return Math.floor(t / 1000);
  }
  return null;
}

export function normalizeMarket(m) {
  const outcomes = parseList(m.outcomes);
  const prices = parseList(m.outcomePrices).map((p) => num(p));
  const tokenIds = parseList(m.clobTokenIds);
  const endSec = parseEndDateSec(m);

  // By Polymarket convention outcomes[0]='Yes', outcomes[1]='No'. We don't
  // assume the order though — find indices by name.
  const yesIdx = outcomes.findIndex((o) => /^yes$/i.test(String(o)));
  const noIdx = outcomes.findIndex((o) => /^no$/i.test(String(o)));

  return {
    id: m.id ?? m.marketId ?? null,
    conditionId: m.conditionId ?? null,
    slug: m.slug ?? null,
    question: m.question ?? m.title ?? null,
    endSec,
    active: Boolean(m.active),
    closed: Boolean(m.closed),
    archived: Boolean(m.archived),
    yesTokenId: yesIdx >= 0 ? String(tokenIds[yesIdx] ?? '') : null,
    noTokenId: noIdx >= 0 ? String(tokenIds[noIdx] ?? '') : null,
    // gamma's outcomePrices are the last trade / mid as a fallback when we
    // can't reach the orderbook.
    gammaYesPrice: yesIdx >= 0 ? prices[yesIdx] : null,
    gammaNoPrice: noIdx >= 0 ? prices[noIdx] : null,
    raw: m,
  };
}

// Fetch all binary markets resolving within the next `withinHours`. Pages
// through gamma if the first page is full.
export async function fetchMarketsEndingSoon({ withinHours = 24, hardCap = 1500 } = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoffSec = nowSec + withinHours * HOUR_SEC;
  const pageSize = 500;
  const out = [];
  for (let offset = 0; offset < hardCap; offset += pageSize) {
    let page;
    try {
      page = await listMarkets({ limit: pageSize, offset });
    } catch (err) {
      log.warn(`gamma listMarkets offset=${offset} failed: ${err.message}`);
      break;
    }
    if (!page.length) break;
    let stop = false;
    for (const raw of page) {
      const m = normalizeMarket(raw);
      if (!m.conditionId || (!m.yesTokenId && !m.noTokenId)) continue;
      if (!m.endSec) continue;
      if (m.endSec > cutoffSec) {
        // gamma returns ascending by endDate; once we pass the cutoff we can
        // stop paging.
        stop = true;
        break;
      }
      if (m.endSec <= nowSec) continue; // already past end date
      if (m.closed || m.archived || !m.active) continue;
      out.push(m);
    }
    if (stop || page.length < pageSize) break;
  }
  return out;
}

// Pull best bid/ask for both sides of a binary market. Returns nulls on any
// fetch error rather than throwing; the scanner treats nulls as "no price".
export async function fetchBookQuotes(market) {
  const [yesBook, noBook] = await Promise.all([
    market.yesTokenId ? getOrderbook(market.yesTokenId).catch(() => null) : null,
    market.noTokenId ? getOrderbook(market.noTokenId).catch(() => null) : null,
  ]);
  return {
    yes: bestQuote(yesBook),
    no: bestQuote(noBook),
  };
}

function bestQuote(book) {
  if (!book) return { bid: null, ask: null };
  // Polymarket returns bids sorted descending by price, asks ascending.
  const bid = num(book.bids?.[0]?.price);
  const ask = num(book.asks?.[0]?.price);
  return { bid, ask };
}
