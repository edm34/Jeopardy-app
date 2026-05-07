# Deploying polymarket-tracker to Railway

This walks you from "I have a GitHub account" to "I have a public dashboard
URL and the bot is running 24/7." About 10 minutes of clicking, no terminal
required.

## Before you start

You need:

1. A **GitHub account** with the `edm34/Jeopardy-app` repo accessible (you
   already have this — that's where this code lives).
2. A **Railway account** — sign up at https://railway.com using "Login with
   GitHub". The free credit covers a single small Node service indefinitely
   for this workload.
3. *(Optional, only if you want WhatsApp alerts)* a **Twilio account**.
4. *(Optional, only if you want auto-execute)* a fresh Polygon wallet's
   private key. **Skip this for the first deploy.** Walk before you run.

## Step 1 — create the Railway project

1. Go to https://railway.com/new.
2. Click **Deploy from GitHub repo**.
3. Authorize Railway to read your repos if prompted. Pick `edm34/Jeopardy-app`.
4. Railway will start trying to build. **It will fail or build the wrong
   thing on the first try** because the repo root is the Jeopardy game, not
   the bot. Don't worry — fix in the next step.

## Step 2 — point Railway at the bot subdirectory

1. Open the service Railway just created.
2. Click **Settings** (top right of the service panel).
3. Find **Source → Root Directory**. Set it to `polymarket-tracker`. Save.
4. Find **Source → Branch**. Set it to `claude/polymarket-trader-tracker-iVXdP`
   (or whatever branch you've merged the code into; main once you merge).
   Save.
5. Click **Deploy** → **Redeploy**. Watch the build logs. You should see
   `npm install` succeed and the start command boot.

After a successful deploy you should see logs like:

```
[INFO] dashboard listening on port 8080
[INFO] notifiers: console
[INFO] auto-execute: disabled
[INFO] discovering pool from https://lb-api.polymarket.com...
[INFO] discovered NNN unique wallets across native windows
[INFO] computing non-native PnL windows for NNN wallets...
[INFO] leaderboards refreshed; tracking NN wallets
```

The first refresh takes a minute or two — it's pulling 8 leaderboards from
lb-api and computing PnL for the four non-native windows for every pool
member.

## Step 3 — get a public URL for the dashboard

1. In the service panel, click **Settings → Networking → Generate Domain**.
2. Railway gives you a URL like
   `https://polymarket-tracker-production-XXXX.up.railway.app`.
3. Open it. You should see the dashboard with the live leaderboards.
4. Bookmark it on your phone home screen.

That's the MVP. The bot is now running, discovering top traders every 15
minutes, and tracking their trades every 20 seconds. Open the dashboard any
time to see who's hot and what they're doing.

## Step 4 (optional) — persist state across redeploys

By default Railway uses an ephemeral filesystem; redeploying or restarting
loses `data/state.json` (which holds the rolling pool, last-seen trade
timestamps, and any mirrored trades). Losing it just means the bot
re-bootstraps in 1–2 minutes and may re-alert on a few recent trades it
already alerted on.

To make state persistent:

1. Service panel → **Volumes → Add Volume**.
2. Mount path: `/app/data`
3. Size: 1 GB is plenty.
4. Save and redeploy.

## Step 5 (optional) — add WhatsApp alerts

1. Sign up at https://www.twilio.com.
2. **Console → Messaging → Try it out → Send a WhatsApp message** activates
   the sandbox. Note the sandbox sender (looks like `+1 415 523 8886`) and
   the join code.
3. On your phone, message that number with the join code. You'll get a
   confirmation.
4. From the Twilio Console, copy your **Account SID** and **Auth Token**.
5. In Railway: service panel → **Variables** → add the following one at a
   time. Click **Add** after each.

   | Name                    | Value                                             |
   | ----------------------- | ------------------------------------------------- |
   | `TWILIO_ACCOUNT_SID`    | from Twilio console                               |
   | `TWILIO_AUTH_TOKEN`     | from Twilio console                               |
   | `TWILIO_WHATSAPP_FROM`  | `whatsapp:+14155238886` (sandbox) or your sender  |
   | `WHATSAPP_TO`           | `whatsapp:+15551234567` (your phone, comma-list)  |

6. Save → Railway redeploys automatically.
7. Watch the deploy logs for `notifiers: console, whatsapp`. You should
   start receiving WhatsApp messages within a few minutes of any top trader
   firing.

## Step 6 (optional, dangerous) — enable auto-execute

**Read `README.md` § Auto-execute setup before doing this.** Real money on
Polygon mainnet. There is no undo button.

When you're ready:

1. Create a brand-new MetaMask wallet on Polygon.
2. Fund it with the smallest amount of USDC you'd be OK losing (e.g. $20).
3. Onboard that wallet on polymarket.com (one-time contract approvals).
4. Export its private key from MetaMask. **Treat it like a password.**
5. In Railway → Variables, add:

   | Name                  | Value           |
   | --------------------- | --------------- |
   | `TRADER_PRIVATE_KEY`  | `0x...`         |
   | `MAX_TRADE_USDC`      | `1`             |
   | `MAX_OPEN_USDC`       | `5`             |
   | `AUTO_EXECUTE`        | `true`          |

6. Redeploy. Watch logs and the dashboard's "Mirrored trades" section.
7. After a day of seeing 1–5 small mirrored trades come through cleanly,
   raise `MAX_TRADE_USDC` and `MAX_OPEN_USDC` to amounts you're comfortable
   with.

## Common Railway issues

- **Build fails with "Could not find package.json".** You forgot to set
  the Root Directory to `polymarket-tracker` in Step 2.
- **Dashboard URL shows "Application failed to respond".** The container
  is still booting (first leaderboard refresh takes 1–2 min). Check
  Deployments → View Logs.
- **"discovered 0 unique wallets across native windows".** lb-api is
  unreachable or has changed its response shape. Verify
  `https://lb-api.polymarket.com/profit?window=30d&limit=10` returns JSON
  in your browser. If it does but the bot still sees 0, the field names
  changed; ping me and I'll fix `src/polymarket/discovery.js`.
- **WhatsApp messages stop arriving after 24 hours.** Twilio's sandbox
  requires you to message the sandbox number again every 24h to keep the
  session alive — that's a Meta/WhatsApp policy, not the bot. For
  always-on alerts you'd need a Twilio production WhatsApp sender (paid
  + Meta business verification), or switch to Telegram/Discord.

## Updating the bot later

Any push to the branch Railway is watching triggers a redeploy. So if you
want to tweak something:

1. Edit the file on GitHub (or locally + push).
2. Railway sees the commit, builds, deploys.
3. ~30 seconds later the new version is live.

That's it. The bot is now your problem, not your laptop's.
