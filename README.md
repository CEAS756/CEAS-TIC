# 🤖 Ceas Bot

Discord reward bot — invite, message & VC rewards with UPI payment support.

## Files
- `index.js` — Entry point (just starts main.js)
- `main.js` — Everything: database, all commands, all events, rewards
- `package.json` — Dependencies

## Commands
| Command | Description |
|---|---|
| `C.help` | All commands |
| `C.balance [@user]` | Check wallet |
| `C.give <amount> <owo\|inr> @user` | Send OWO (instant) or INR (triggers UPI flow) |
| `C.leaderboard [owo\|inr\|invites\|messages\|vc]` | Top 10 |
| `C.rewards` | Full reward rates |
| `C.invites [@user]` | Invite count |
| `C.ping` | Bot latency |

## Rewards
**Invites (stackable):** 1→100K OWO · 3→500K · 5→800K · 10→1M  
**Messages (one-time):** 100→10K · 500→50K · 1K→100K · 10K→2 Boosts  
**VC (one-time):** 5hr→100K · 10hr→250K · 50hr→1 Boost · 100hr→Nitro  

## Setup (Local)
```bash
npm install
cp .env.example .env
# Paste your bot token in .env
node index.js
```

## Deploy to Railway
1. Push to GitHub
2. railway.app → New Project → Deploy from GitHub
3. Add variable: `DISCORD_TOKEN` = your bot token
4. Done ✅

## Discord Bot Setup
1. discord.com/developers/applications → New Application → "Ceas"
2. Bot tab → Reset Token → copy it
3. Enable: **Server Members Intent** + **Message Content Intent**
4. OAuth2 → URL Generator → Scopes: `bot` → Permissions: `Administrator`
5. Invite to your server

## Customize Rewards
Edit the `REWARDS` object in `main.js`.
