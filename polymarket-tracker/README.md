# polymarket-tracker

A Node.js daemon that tracks the top traders on [Polymarket](https://polymarket.com)
by realized + unrealized PnL across multiple time windows, alerts you on every
trade they make via WhatsApp, exposes a small dashboard, and (optionally)
mirrors their trades from a wallet you control.

> **Status:** v0.1, single-author. The Polymarket public APIs are not formally
> versioned and field names have shifted historically; if rankings or alerts
> stop populating, see *Troubleshooting* below before assuming a code bug.

## What it does

Three modes, all in one process:

1. **Notify.** Recomputes a leaderboard every `LEADERBOARD_REFRESH_SEC`,
   tracks the union of the top N across all windows, polls each wallet's
   trade activity every `POLL_INTERVAL_SEC`, and sends a WhatsApp message
   for every new trade.
2. **Auto-execute (off by default).** When `AUTO_EXECUTE=true`, the bot
   submits a matching BUY order via the Polymarket CLOB on Polygon, sized
   per `SIZING_MODE` and capped by `MAX_TRADE_USDC` / `MAX_OPEN_USDC`. It
   only mirrors opens (buys); closes are not mirrored automatically.
3. **Dashboard.** `pm-tracker dashboard` serves a read-only view of the
   current leaderboards, recently active wallets, and any mirrored trades.

## Time windows

Ranks PnL over: **30d, 60d, 90d, 6m, 12m, all-time**.

PnL is approximated locally from each candidate wallet's positions (current
mark) and trade history (realized fills walked chronologically). This is
intentionally not the exact number Polymarket displays on its own
leaderboard — fee accounting differs — but the ordering is reliable in
practice.

## Quickstart

```bash
cd polymarket-tracker
npm install
cp .env.example .env
cp data/candidates.example.json data/candidates.json
# edit data/candidates.json: add wallet addresses you want ranked
# (scrape polymarket.com/leaderboard, ask in community channels, etc.)

# one-shot: print the leaderboards
node src/index.js leaderboard

# long-running: refresh leaderboards, watch trades, send alerts
node src/index.js watch

# in another terminal: dashboard at http://localhost:8787
node src/index.js dashboard
```

You can also `npm install -g .` and use the `pm-tracker` binary directly.

## Candidate wallets

The bot ranks **wallets you give it**. It does not currently scrape
Polymarket's UI — that page is JS-rendered and would invite breakage. To
seed your candidate list:

- Manually copy addresses from polymarket.com/leaderboard.
- Add wallets from Twitter / Discord / on-chain explorers.
- Use `pm-tracker seed --wallets 0xabc...,0xdef...` to append to
  `data/candidates.json`.

The more candidates you add (50–500 is reasonable), the more meaningful
"top 10" becomes.

If/when you discover a public Polymarket leaderboard JSON endpoint, set
`LEADERBOARD_API_BASE` and the bot will use it as an additional candidate
source.

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

If any WhatsApp env var is missing the WhatsApp notifier is silently
disabled and you'll only get console alerts. That is fine for testing.

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
    candidates.json     # wallets to rank (you maintain this)
    state.json          # leaderboards, last-seen trade timestamps, mirrored trades
  src/
    polymarket/         # API client + ranker + executor
    notify/             # console + WhatsApp
    cli/                # command implementations
    dashboard/          # express + static UI
```

`state.json` is gitignored. Delete it to fully reset the bot's memory of
which trades it has already alerted on.

## Troubleshooting

- **Empty leaderboards.** Most likely your `data/candidates.json` is the
  example placeholder (`0x000...`). Add real addresses.
- **"non-retryable HTTP 404" in debug log.** A given candidate wallet
  has never traded on Polymarket; safe to ignore.
- **Polymarket changed their API shape.** Check
  `src/polymarket/leaderboard.js` (`tradeTimestamp`, `tradeSide`,
  `tradePrice`, `tradeSize`, `positionPnl`) and
  `src/polymarket/activity.js` (`normalizeTrade`). All field aliases live
  there.
- **WhatsApp messages not arriving.** The Twilio sandbox requires every
  recipient to opt in by texting the sandbox join-code. Production senders
  require pre-approved templates for un-prompted messages outside a
  24-hour session window — this bot's alerts probably won't qualify, so
  you may need a session-window approach (alert only after the user has
  messaged the bot recently).

## License

MIT. No warranty. Use at your own risk; this software can lose money.
