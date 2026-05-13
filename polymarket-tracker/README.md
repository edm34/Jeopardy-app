# polymarket-tracker

A Node.js daemon that tracks the top traders on [Polymarket](https://polymarket.com)
across **30d / 60d / 90d / 6m / 12m / all-time** PnL windows, alerts you on
every trade they make via WhatsApp, exposes a small dashboard, and (optionally)
mirrors their trades from a wallet you control.

**Zero-config:** the bot auto-discovers who the top traders are. You don't
maintain any wallet lists.

> **Just want to run it?** See [DEPLOY.md](./DEPLOY.md) for a 10-minute
> Railway setup that gives you a public dashboard URL and runs the bot 24/7.

## How it discovers traders

On every refresh (default every 15 min) it queries Polymarket's public ranking
API at `lb-api.polymarket.com` across **8 leaderboards** — profit and volume,
each at windows `1d / 7d / 30d / all` — and folds every unique wallet into a
**rolling pool** stored in `data/state.json`. Wallets stay in the pool until
they haven't appeared in any leaderboard for ~180 days, at which point they
age out.

Then for each of your six tracking windows it ranks the pool:

| Window | PnL source                                                |
| ------ | --------------------------------------------------------- |
| 30d    | lb-api `pnl` (matches polymarket.com/leaderboard exactly) |
| all    | lb-api `pnl` (matches polymarket.com/leaderboard exactly) |
| 60d    | computed locally from positions + trade history           |
| 90d    | computed locally from positions + trade history           |
| 6m     | computed locally from positions + trade history           |
| 12m    | computed locally from positions + trade history           |

For the four computed windows, PnL is approximated by walking each wallet's
fills chronologically (realized) and marking their open positions to current
price (unrealized), filtered by the entry timestamp falling inside the window.
That's not Polymarket's exact internal number — fee accounting differs — but
the ordering is reliable in practice.

## What it does

Four modes, all in one process:

1. **Notify.** The watch daemon polls the trade activity of every wallet in
   the union of your top-10s, every `POLL_INTERVAL_SEC` (default 20s), and
   sends a WhatsApp message per new trade.
2. **Auto-execute (off by default).** When `AUTO_EXECUTE=true`, the bot
   submits a matching BUY order via the Polymarket CLOB on Polygon, sized
   per `SIZING_MODE` and capped by `MAX_TRADE_USDC` / `MAX_OPEN_USDC`. It
   only mirrors opens (buys); closes are not mirrored automatically.
3. **Sure-thing scanner.** Every `SURE_THING_SCAN_INTERVAL_SEC` (default
   5 min) the bot queries gamma for markets resolving within
   `SURE_THING_MAX_HOURS` (default 24), pulls each market's CLOB orderbook,
   and flags any side priced at or above `SURE_THING_THRESHOLD` (default
   0.97). For each candidate it overlays a *smart-money signal* — net
   USDC bought by your tracked pool wallets in that market over the last
   24h — and either surfaces it on the dashboard or auto-buys, depending
   on `SURE_THING_EXEC_MODE` and `SURE_THING_SMART_MONEY_RULE`.
4. **Dashboard.** `pm-tracker dashboard` serves a read-only UI of today's
   near-sure-things, current leaderboards, a *hit-rate* leaderboard
   (resolved-trade win % per wallet, built up as markets close), recently
   active wallets, and any auto-placed trades.

## The sure-thing strategy

**What it is:** buy YES at &ge;$0.97 on markets that resolve within 24h,
collecting ~3% per cycle. Confirm each trade against tracked-trader flow so
you don't step in front of a smart-money "this is actually wrong" signal.

**What you trade:** you're effectively selling tail risk for tiny premium.
One catastrophic miss at $0.97 wipes ~32 wins, so position sizing and
diversification across many small daily trades matter more than picking
"the best" candidate.

**Knobs (all live in `.env`):**

| Variable                       | Effect                                                                   |
| ------------------------------ | ------------------------------------------------------------------------ |
| `SURE_THING_THRESHOLD`         | Price floor for "sure" (0.97 = strict, 0.95 = looser, more candidates).  |
| `SURE_THING_MAX_HOURS`         | Resolves-within window. 24 keeps capital cycling daily.                  |
| `SURE_THING_EXEC_MODE`         | `surface` / `confirm` / `all`. Start with `surface`.                     |
| `SURE_THING_SMART_MONEY_RULE`  | `required` / `veto` / `advisory`. Start with `required`.                 |
| `MAX_TRADE_USDC`               | Per-trade USDC cap (shared with mirror-trade path).                      |
| `MAX_OPEN_USDC`                | Total open USDC ceiling across all auto-placed positions.                |
| `SURE_THING_SLIPPAGE_BPS`      | Allowed slippage above best ask, in bps. 50 = 0.5%.                      |

**Exec modes:**

- `surface` — scanner runs, dashboard shows candidates, **bot never places
  an order**. You bet manually. Safest. Use this until you've watched a few
  full cycles.
- `confirm` — bot auto-places sized buys only on candidates whose
  smart-money score is *green* (pool wallets are net-buying the sure side).
  Most defensive auto mode.
- `all` — bot auto-places on every candidate that passes the
  `SURE_THING_SMART_MONEY_RULE`. Highest throughput, highest tail risk.

**Smart-money rules:**

- `required` — candidate must show pool wallets net-buying the same side as
  the price (strict; expect 0&ndash;3 candidates a day).
- `veto` — every priced candidate passes *unless* pool wallets are
  heavily on the opposite side.
- `advisory` — no filtering; signal shown on dashboard but not gating.

**Hit-rate leaderboard:** the bot records every observed pool-wallet open
as a position; once that market resolves on gamma the position is marked
W/L. Over days this builds a true win-rate ranking of the pool — separate
from raw PnL — and weights the smart-money confirmation on each candidate.

## Quickstart

```bash
cd polymarket-tracker
npm install
cp .env.example .env       # add Twilio creds (optional) and recipients
node src/index.js leaderboard         # one-shot: print all 6 leaderboards
node src/index.js leaderboard --fast  # only 30d + all-time (no local compute)
node src/index.js watch               # long-running daemon
node src/index.js dashboard           # web dashboard at :8787
```

The first run takes ~30–60 seconds — it pulls 8 leaderboards from lb-api,
then computes PnL across the four non-native windows for the discovered pool
(typically 200–500 unique wallets).

You can `npm install -g .` and use the `pm-tracker` binary directly.

## Pinning extra wallets (optional)

If there's a specific wallet you want tracked even if they don't show up in
lb-api's top 100s, add it manually:

```bash
node src/index.js seed --wallets 0xabc...,0xdef...
```

This appends to `data/candidates.json`, which is merged into the pool on every
refresh.

## CLI

| Command                                  | Purpose                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `pm-tracker leaderboard`                 | Refresh pool, print all 6 windows.                                               |
| `pm-tracker leaderboard --fast`          | Refresh pool, print only 30d + all-time. Skips the local PnL compute.            |
| `pm-tracker watch`                       | Daemon: refresh leaderboards on a timer, poll trades, alert, optionally mirror.  |
| `pm-tracker dashboard`                   | Static dashboard at `http://localhost:8787`.                                     |
| `pm-tracker seed --wallets 0x...,0x...`  | Pin extra wallets that always live in the pool.                                  |

## WhatsApp setup (Twilio)

The bot uses Twilio's WhatsApp API. Steps:

1. Create a Twilio account.
2. Enable the WhatsApp sender (sandbox is free; a production sender costs
   per-message and requires Meta business verification).
3. From the Twilio console, copy:
   - Account SID -> `TWILIO_ACCOUNT_SID`
   - Auth Token  -> `TWILIO_AUTH_TOKEN`
   - The sender, prefixed with `whatsapp:` -> `TWILIO_WHATSAPP_FROM`
4. List recipients (also `whatsapp:`-prefixed E.164 numbers) in
   `WHATSAPP_TO`. For sandbox, each recipient must first text the
   join-code to the sandbox number once.

If any WhatsApp env var is missing the WhatsApp notifier is silently disabled
and you'll only get console alerts. That is fine for testing.

## Auto-execute setup (read this carefully)

Mirroring is real money on Polygon mainnet.

1. Create a **dedicated** Polygon wallet. Do not reuse a wallet that holds
   anything else.
2. Fund it with the USDC you're willing to risk. Start small.
3. Go through Polymarket's standard onboarding for that wallet (one-time
   contract approvals). The CLOB client docs cover this.
4. Set `TRADER_PRIVATE_KEY` in `.env`. Never commit `.env`. Never paste
   the key into chat.
5. Start with `AUTO_EXECUTE=false`, watch the daemon for a day, confirm
   that the trades it *would* mirror look sane.
6. Lower `MAX_TRADE_USDC` to `1`–`5`, set `AUTO_EXECUTE=true`, and run
   for a few hours. Verify the orders on polymarket.com.
7. Only then consider raising `MAX_TRADE_USDC` / `MAX_OPEN_USDC`.

Hard limits enforced in code:

- One mirrored order per source trade (deduped by trade id).
- Skips trades older than `MAX_TRADE_AGE_SEC` (avoids catch-up storms on
  restart).
- Only mirrors BUYs. Sells / closes are notified but not mirrored.
- Won't open new positions when total open mirrored notional exceeds
  `MAX_OPEN_USDC`.

## Files & state

```
polymarket-tracker/
  data/
    state.json          # rolling pool + leaderboards + last-seen trade ts + mirrored trades
    candidates.json     # optional pinned wallets (seed)
  src/
    polymarket/
      api.js            # HTTP client (gamma, data, lb-api)
      discovery.js      # lb-api -> rolling pool entries
      leaderboard.js    # ranks pool: native PnL for 30d/all, computed for others
      activity.js       # polls each top-N wallet's recent trades
      trader.js         # CLOB auto-execute (off by default)
    notify/             # console + WhatsApp via Twilio
    cli/                # leaderboard / watch / seed commands
    dashboard/          # express + static UI
```

`state.json` is gitignored. Delete it to fully reset the bot's memory of
which trades it has already alerted on (and rebuild the pool from scratch).

## Troubleshooting

- **`lb-api returned no wallets`.** Network issue or Polymarket changed the
  endpoint. Confirm `https://lb-api.polymarket.com/profit?window=30d&limit=10`
  works in your browser. Override `LEADERBOARD_API_BASE` in `.env` if needed.
- **Computed windows look weird (60d, 90d, etc).** Local PnL only counts a
  position's unrealized profit when its first fill is inside the window — for
  long-running positions this can underrepresent real performance. If that
  bothers you, run `--fast` and trust only the native windows.
- **Polymarket changed their API shape.** Field aliases live in:
  - `src/polymarket/discovery.js` (`walletOf`, native row fields)
  - `src/polymarket/leaderboard.js` (`tradeTimestamp`, `tradeSide`, etc.)
  - `src/polymarket/activity.js` (`normalizeTrade`)
- **WhatsApp messages not arriving.** Twilio sandbox requires every recipient
  to opt in by texting the sandbox join-code. Production senders require
  pre-approved templates for unprompted messages outside a 24-hour session
  window — this bot's alerts may not qualify, so you may need to fall back
  to a Telegram/Discord webhook (open an issue / extend `src/notify/`).

## License

MIT. No warranty. Use at your own risk; this software can lose money.
