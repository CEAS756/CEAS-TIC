# 🤖 Ceas Bot — Self-Hosting Guide

Ceas is a Discord bot with **invite tracking**, **message tracking**, **voice tracking**, and a **rewards system** (OWO, Nitro, INR payments via UPI QR code).

---

## 📋 Requirements

- Node.js 18 or higher
- A Discord bot token
- A UPI ID (for INR payment QR generation)

---

## 🚀 Quick Start

### Step 1 — Clone / download the bot files

Place the `ceas-bot` folder somewhere on your machine or VPS.

### Step 2 — Install dependencies

```bash
cd ceas-bot
npm install
```

### Step 3 — Configure the bot

Copy `.env.example` to `.env` and fill it in:

```bash
cp .env.example .env
```

Edit `.env`:

```env
BOT_TOKEN=your_bot_token_here
OWNER_ID=your_discord_user_id
PREFIX=!
UPI_ID=yourname@upi
UPI_NAME=Ceas Bot Rewards
GUILD_ID=your_server_id
```

### Step 4 — Create your Discord bot

1. Go to https://discord.com/developers/applications
2. Click **New Application** → name it **Ceas**
3. Go to **Bot** tab → **Reset Token** → copy your token
4. Under **Privileged Gateway Intents** enable:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
   - ✅ Presence Intent
5. Go to **OAuth2 → URL Generator**
   - Scopes: `bot` + `applications.commands`
   - Bot Permissions: `Administrator` (or specific perms below)
   - Copy the invite URL and add the bot to your server

**Minimum Required Permissions:**
- Read Messages / Send Messages
- Embed Links
- Attach Files
- Manage Guild (for invite tracking)
- View Audit Log

### Step 5 — Start the bot

```bash
npm start
```

For development with auto-restart:
```bash
npm run dev
```

---

## 📦 Keep It Running (VPS/Server)

Install PM2 for production:

```bash
npm install -g pm2
pm2 start src/index.js --name ceas
pm2 save
pm2 startup
```

---

## 🎮 Commands

All commands work with the prefix (`!` by default) **AND** as slash commands (`/`).

### 📊 Tracking

| Command | Description |
|---|---|
| `!stats [@user]` | View messages, voice time, and invites |
| `!invites [@user]` | View invite count and who invited them |
| `!voice [@user]` | View voice time |
| `!leaderboard [messages\|voice\|invites]` | Server leaderboard |

### 🎁 Rewards

| Command | Description |
|---|---|
| `!rewards` | List all available rewards |
| `!rewards mine` | See your received rewards |
| `!give <reward_name> @user` | Give a named reward to a user *(admin)* |
| `!give 1000inr @user` | Generate ₹1000 UPI payment QR *(admin)* |
| `!confirm <id>` | Confirm a payment was received *(admin)* |

### ⚙️ Admin

| Command | Description |
|---|---|
| `!addreward <name> <type> [description]` | Add a reward (`owo`, `nitro`, `inr`, `custom`) |
| `!removereward <name>` | Remove a reward |
| `!setlog #channel` | Set the log channel |
| `!adminrole add @role` | Give a role bot-admin permissions |
| `!adminrole remove @role` | Remove bot-admin from a role |
| `!adminrole list` | List all bot-admin roles |

### 🔧 General

| Command | Description |
|---|---|
| `!help` | Show all commands |
| `!ping` | Check bot latency |

---

## 💸 INR Payment Flow

1. **Admin types:** `!give 1000inr @user`
2. **Bot sends:** A UPI QR code image + payment details (UPI ID, amount, payment ID)
3. **User scans** the QR with any UPI app (GPay, PhonePe, Paytm, etc.)
4. **After payment is received**, admin types: `!confirm <payment_id>`
5. **Payment is marked done** — the user cannot receive the same reward again

---

## 🎁 Setting Up Rewards

Before giving rewards, add them to your server:

```
!addreward owo owo OWO currency reward
!addreward nitro nitro Discord Nitro subscription
!addreward starter inr ₹500 starter pack payment
!addreward vip custom VIP role in the server
```

Then give them:

```
!give owo @username
!give nitro @username
!give 500inr @username      ← generates ₹500 UPI QR
!give 1000inr @username     ← generates ₹1000 UPI QR
```

---

## 📁 File Structure

```
ceas-bot/
├── src/
│   ├── index.js              # Bot entry point
│   ├── commands/             # All bot commands
│   │   ├── give.js           # Give rewards + INR payment QR
│   │   ├── confirm.js        # Confirm a payment
│   │   ├── stats.js          # User stats
│   │   ├── leaderboard.js    # Server leaderboard
│   │   ├── rewards.js        # List rewards
│   │   ├── addreward.js      # Add a reward (admin)
│   │   ├── removereward.js   # Remove a reward (admin)
│   │   ├── invites.js        # Invite tracker
│   │   ├── voice.js          # Voice time tracker
│   │   ├── setlog.js         # Set log channel
│   │   ├── adminrole.js      # Manage bot admin roles
│   │   ├── ping.js           # Ping command
│   │   └── help.js           # Help menu
│   ├── events/               # Discord event handlers
│   │   ├── ready.js          # Bot startup + slash registration
│   │   ├── messageCreate.js  # Message tracking + prefix commands
│   │   ├── voiceStateUpdate.js # Voice time tracking
│   │   ├── guildMemberAdd.js # Invite tracking on join
│   │   ├── inviteCreate.js   # Track new invites
│   │   └── interactionCreate.js # Slash command handler
│   └── utils/
│       ├── database.js       # SQLite database (all data)
│       ├── payment.js        # UPI QR code generation
│       ├── embeds.js         # Discord embed helpers
│       ├── permissions.js    # Admin/owner checks
│       ├── loader.js         # Command loader + slash registrar
│       └── eventLoader.js    # Event loader
├── data/                     # Auto-created — DB + QR codes
├── .env                      # Your config (never share this!)
├── .env.example              # Config template
└── package.json
```

---

## 🛠️ Troubleshooting

**Slash commands not showing?**
- Set `GUILD_ID` in `.env` for instant guild-level registration (vs global which takes up to 1 hour)
- Make sure your bot has `applications.commands` scope in its invite URL

**Invite tracking not working?**
- Bot needs `Manage Guild` permission
- Make sure the bot was added to the server with that permission

**QR code not generating?**
- Ensure `UPI_ID` in `.env` is a valid UPI VPA (e.g., `yourname@gpay`, `yourname@paytm`)
- The `canvas` npm package requires some system libraries; on Ubuntu: `sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev`
