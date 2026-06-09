// ═══════════════════════════════════════════════════════════════
//  CEAS BOT  —  main.js  (v3)
//  Ticket system · UPI payment in tickets · Reward tracking
// ═══════════════════════════════════════════════════════════════

const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
  PermissionsBitField, ChannelType,
} = require("discord.js");
const Database = require("better-sqlite3");
const fs   = require("fs");
const path = require("path");

// ─── CRASH GUARD ─────────────────────────────────────────────────
process.on("unhandledRejection", (err) => console.error("[UNHANDLED]", err));
process.on("uncaughtException",  (err) => console.error("[UNCAUGHT]",  err));

// ─── DATA DIR ────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── DATABASE ────────────────────────────────────────────────────
const db = new Database(path.join(DATA_DIR, "ceas.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id     TEXT NOT NULL,
    guild_id    TEXT NOT NULL,
    owo         INTEGER DEFAULT 0,
    inr         REAL    DEFAULT 0,
    messages    INTEGER DEFAULT 0,
    vc_minutes  REAL    DEFAULT 0,
    invites     INTEGER DEFAULT 0,
    last_msg_ts INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, guild_id)
  );
  CREATE TABLE IF NOT EXISTS invite_cache (
    code       TEXT PRIMARY KEY,
    guild_id   TEXT NOT NULL,
    inviter_id TEXT NOT NULL,
    uses       INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS vc_sessions (
    user_id   TEXT NOT NULL,
    guild_id  TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, guild_id)
  );
  CREATE TABLE IF NOT EXISTS milestones (
    user_id  TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    type     TEXT NOT NULL,
    key      TEXT NOT NULL,
    count    INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, guild_id, type, key)
  );
  CREATE TABLE IF NOT EXISTS tickets (
    channel_id  TEXT PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    type        TEXT DEFAULT 'support',
    status      TEXT DEFAULT 'open',
    created_at  INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS payments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id   TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    guild_id    TEXT NOT NULL,
    amount      REAL NOT NULL,
    channel_id  TEXT NOT NULL,
    status      TEXT DEFAULT 'pending',
    created_at  INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id         TEXT PRIMARY KEY,
    ticket_category  TEXT,
    log_channel      TEXT
  );
`);

// ── DB helpers ────────────────────────────────────────────────────
const getUser = (uid, gid) => {
  db.prepare("INSERT OR IGNORE INTO users (user_id, guild_id) VALUES (?,?)").run(uid, gid);
  return db.prepare("SELECT * FROM users WHERE user_id=? AND guild_id=?").get(uid, gid);
};
const addOwo  = (uid, gid, n) => { getUser(uid, gid); db.prepare("UPDATE users SET owo=MAX(0,owo+?)  WHERE user_id=? AND guild_id=?").run(n, uid, gid); };
const addInr  = (uid, gid, n) => { getUser(uid, gid); db.prepare("UPDATE users SET inr=MAX(0,inr+?)  WHERE user_id=? AND guild_id=?").run(n, uid, gid); };
const setOwo  = (uid, gid, n) => { getUser(uid, gid); db.prepare("UPDATE users SET owo=MAX(0,?)       WHERE user_id=? AND guild_id=?").run(n, uid, gid); };
const setInr  = (uid, gid, n) => { getUser(uid, gid); db.prepare("UPDATE users SET inr=MAX(0,?)       WHERE user_id=? AND guild_id=?").run(n, uid, gid); };
const addMsg  = (uid, gid)    => { getUser(uid, gid); db.prepare("UPDATE users SET messages=messages+1 WHERE user_id=? AND guild_id=?").run(uid, gid); return db.prepare("SELECT messages FROM users WHERE user_id=? AND guild_id=?").get(uid, gid).messages; };
const addVcMin  = (uid, gid, m) => { getUser(uid, gid); db.prepare("UPDATE users SET vc_minutes=vc_minutes+? WHERE user_id=? AND guild_id=?").run(m, uid, gid); return db.prepare("SELECT vc_minutes FROM users WHERE user_id=? AND guild_id=?").get(uid, gid).vc_minutes; };
const addInvite = (uid, gid)    => { getUser(uid, gid); db.prepare("UPDATE users SET invites=invites+1 WHERE user_id=? AND guild_id=?").run(uid, gid); return db.prepare("SELECT invites FROM users WHERE user_id=? AND guild_id=?").get(uid, gid).invites; };
const setMsgTs  = (uid, gid, t) => db.prepare("UPDATE users SET last_msg_ts=? WHERE user_id=? AND guild_id=?").run(t, uid, gid);
const getMilestone  = (uid, gid, type, key) => db.prepare("SELECT count FROM milestones WHERE user_id=? AND guild_id=? AND type=? AND key=?").get(uid, gid, type, String(key))?.count ?? 0;
const setMilestone  = (uid, gid, type, key, count) => db.prepare("INSERT INTO milestones(user_id,guild_id,type,key,count) VALUES(?,?,?,?,?) ON CONFLICT(user_id,guild_id,type,key) DO UPDATE SET count=excluded.count").run(uid, gid, type, String(key), count);
const getTop        = (gid, col, n = 10) => db.prepare(`SELECT * FROM users WHERE guild_id=? ORDER BY ${col} DESC LIMIT ?`).all(gid, n);
const resetWeeklyDb = (gid) => { db.prepare("UPDATE users SET invites=0, owo=0 WHERE guild_id=?").run(gid); db.prepare("DELETE FROM milestones WHERE guild_id=? AND type=?").run(gid, "invite"); };

// Invite cache
const cacheInvite  = (code, gid, inv, uses) => db.prepare("INSERT OR REPLACE INTO invite_cache VALUES (?,?,?,?)").run(code, gid, inv, uses);
const getCached    = (code)                  => db.prepare("SELECT * FROM invite_cache WHERE code=?").get(code);
const updateCached = (code, uses)            => db.prepare("UPDATE invite_cache SET uses=? WHERE code=?").run(uses, code);

// VC sessions
const startVc = (uid, gid) => db.prepare("INSERT OR REPLACE INTO vc_sessions VALUES (?,?,?)").run(uid, gid, Date.now());
const endVc   = (uid, gid) => {
  const row = db.prepare("SELECT joined_at FROM vc_sessions WHERE user_id=? AND guild_id=?").get(uid, gid);
  db.prepare("DELETE FROM vc_sessions WHERE user_id=? AND guild_id=?").run(uid, gid);
  return row ? (Date.now() - row.joined_at) / 60000 : 0;
};

// Tickets
const createTicket = (channelId, gid, uid, type) => db.prepare("INSERT OR IGNORE INTO tickets(channel_id,guild_id,user_id,type) VALUES(?,?,?,?)").run(channelId, gid, uid, type);
const closeTicket  = (channelId) => db.prepare("UPDATE tickets SET status='closed' WHERE channel_id=?").run(channelId);
const getTicket    = (channelId) => db.prepare("SELECT * FROM tickets WHERE channel_id=?").get(channelId);

// Payments
const createPayment = (sid, rid, gid, amt, cid) => db.prepare("INSERT INTO payments(sender_id,receiver_id,guild_id,amount,channel_id) VALUES(?,?,?,?,?)").run(sid, rid, gid, amt, cid).lastInsertRowid;
const closePayment  = (id, status) => db.prepare("UPDATE payments SET status=? WHERE id=?").run(status, id);

// Guild config
const getConfig = (gid) => db.prepare("SELECT * FROM guild_config WHERE guild_id=?").get(gid) ?? {};
const setConfig = (gid, key, val) => db.prepare(`INSERT INTO guild_config(guild_id,${key}) VALUES(?,?) ON CONFLICT(guild_id) DO UPDATE SET ${key}=excluded.${key}`).run(gid, val);

// ─── CONFIG ──────────────────────────────────────────────────────
const PREFIX   = "C.";
const COLOR    = { white: 0xFFFFFF, black: 0x000000 };
const OWNER_ID = process.env.OWNER_ID || "";

const REWARDS = {
  invite:  [
    { every: 1,  owo: 100_000  },
    { every: 3,  owo: 500_000  },
    { every: 5,  owo: 800_000  },
    { every: 10, owo: 1_000_000 },
  ],
  message: [
    { at: 100,   owo: 10_000,  boost: 0, nitro: false },
    { at: 500,   owo: 50_000,  boost: 0, nitro: false },
    { at: 1000,  owo: 100_000, boost: 0, nitro: false },
    { at: 10000, owo: 0,       boost: 2, nitro: false },
  ],
  vc: [
    { hours: 5,   owo: 100_000, boost: 0, nitro: false },
    { hours: 10,  owo: 250_000, boost: 0, nitro: false },
    { hours: 50,  owo: 0,       boost: 1, nitro: false },
    { hours: 100, owo: 0,       boost: 0, nitro: true  },
  ],
  msgCooldownMs: 3000,
};

// ─── UTILS ───────────────────────────────────────────────────────
const fmt  = (n) => { n = Math.floor(n); return n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n/1_000).toFixed(1)}K` : String(n); };
const mkE  = (color) => new EmbedBuilder().setColor(color).setFooter({ text: "Ceas Bot" }).setTimestamp();
const errE = (msg)   => mkE(COLOR.black).setDescription(`❌ ${msg}`);
const okE  = (msg)   => mkE(COLOR.white).setDescription(msg);
const isOwner = (id)     => OWNER_ID && id === OWNER_ID;
const isAdmin = (member) => member?.permissions?.has(PermissionsBitField.Flags.ManageGuild) ?? false;
const isStaff = (member, uid) => isOwner(uid) || isAdmin(member);

async function dmUser(uid, payload) {
  try { const u = await client.users.fetch(uid); await u.send(payload); } catch {}
}

// ─── REWARD CHECKERS ─────────────────────────────────────────────
async function checkInviteRewards(uid, gid, total) {
  for (const tier of REWARDS.invite) {
    const reached = Math.floor(total / tier.every);
    const claimed = getMilestone(uid, gid, "invite", tier.every);
    if (reached > claimed) {
      const times = reached - claimed;
      setMilestone(uid, gid, "invite", tier.every, reached);
      addOwo(uid, gid, tier.owo * times);
      await dmUser(uid, { embeds: [mkE(COLOR.white).setTitle("🎉 Invite Reward!").setDescription(`You hit **${tier.every} invite${tier.every>1?"s":""}** ×${times}!\n**+${fmt(tier.owo*times)} OWO** added! 🐾`)] });
    }
  }
}
async function checkMessageRewards(uid, gid, total) {
  for (const t of REWARDS.message) {
    if (total < t.at || getMilestone(uid, gid, "message", t.at) > 0) continue;
    setMilestone(uid, gid, "message", t.at, 1);
    if (t.owo > 0) addOwo(uid, gid, t.owo);
    const lines = [`You sent **${t.at.toLocaleString()} messages**! 💬`];
    if (t.owo > 0)   lines.push(`**+${fmt(t.owo)} OWO** added! 🐾`);
    if (t.boost > 0) lines.push(`**+${t.boost} Server Boost** — claim from admin! 🔮`);
    if (t.nitro)     lines.push(`**🎮 Nitro Account** — claim from admin!`);
    await dmUser(uid, { embeds: [mkE(COLOR.white).setTitle("💬 Message Milestone!").setDescription(lines.join("\n"))] });
  }
}
async function checkVcRewards(uid, gid, totalMin) {
  const hrs = totalMin / 60;
  for (const t of REWARDS.vc) {
    if (hrs < t.hours || getMilestone(uid, gid, "vc", t.hours) > 0) continue;
    setMilestone(uid, gid, "vc", t.hours, 1);
    if (t.owo > 0) addOwo(uid, gid, t.owo);
    const lines = [`You spent **${t.hours} hours** in voice chat! 🎙`];
    if (t.owo > 0)   lines.push(`**+${fmt(t.owo)} OWO** added! 🐾`);
    if (t.boost > 0) lines.push(`**+${t.boost} Server Boost** — claim from admin! 🔮`);
    if (t.nitro)     lines.push(`**🎮 Nitro Account** — claim from admin!`);
    await dmUser(uid, { embeds: [mkE(COLOR.white).setTitle("🎙 VC Milestone!").setDescription(lines.join("\n"))] });
  }
}

// ─── TICKET ENGINE ────────────────────────────────────────────────

// Create a private ticket channel
async function openTicket(guild, opener, { type = "support", extra = {} } = {}) {
  const cfg = getConfig(guild.id);
  const slug = `ticket-${opener.username.toLowerCase().replace(/[^a-z0-9]/g, "")}-${Date.now().toString(36)}`;

  const permissionOverwrites = [
    { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: opener.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ReadMessageHistory] },
    { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels] },
  ];

  // Also allow the "other party" if this is a payment ticket
  if (extra.senderUser) {
    permissionOverwrites.push({
      id: extra.senderUser.id,
      allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ReadMessageHistory],
    });
  }

  // Give admins access
  for (const [, role] of guild.roles.cache) {
    if (role.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      permissionOverwrites.push({ id: role.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
    }
  }

  const channel = await guild.channels.create({
    name: slug,
    type: ChannelType.GuildText,
    parent: cfg.ticket_category || null,
    permissionOverwrites,
    topic: `Ticket opened by ${opener.tag} | Type: ${type}`,
  });

  createTicket(channel.id, guild.id, opener.id, type);
  return channel;
}

// Close ticket with confirmation
async function sendCloseRow(channel) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket_close_${channel.id}`).setLabel("🔒 Close Ticket").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket_delete_${channel.id}`).setLabel("🗑 Delete").setStyle(ButtonStyle.Secondary),
  );
  return row;
}

// ─── COMMANDS ────────────────────────────────────────────────────
const COMMANDS = {

  // ── C.help ───────────────────────────────────────────────────
  help: {
    aliases: ["h", "commands"],
    async run(msg) {
      const staff = isStaff(msg.member, msg.author.id);
      const e = mkE(COLOR.white)
        .setTitle("📖 Ceas Bot — Commands")
        .setDescription(`Prefix: **${PREFIX}**`)
        .addFields(
          { name: "💰 Economy", value:
              "`C.balance [@user]` — View wallet\n" +
              "`C.inr <amount> @user` — Send INR via ticket (UPI flow)\n" +
              "`C.owo <amount> @user` — Send OWO instantly\n" +
              "`C.leaderboard [owo|inr|invites|messages|vc]` — Top 10\n" +
              "`C.rewards` — Full reward list\n" +
              "`C.invites [@user]` — Invite count"
          },
          { name: "🎫 Tickets", value:
              "`C.ticket` — Open a support ticket\n" +
              "`C.ticketpanel` — Send ticket open panel (admin)\n" +
              "`C.setcategory <category id>` — Set ticket category (admin)"
          },
          { name: "ℹ️ General", value: "`C.ping` — Latency\n`C.help` — This menu" },
        );

      if (staff) {
        e.addFields({ name: "🛡 Admin Commands", value:
          "`C.award @user <amount> <owo|inr>` — Give OWO/INR without balance\n" +
          "`C.removebal @user <amount> <owo|inr>` — Remove balance\n" +
          "`C.setbal @user <amount> <owo|inr>` — Set exact balance\n" +
          "`C.checkbal @user` — Full user stats\n" +
          "`C.resetweekly` — Reset weekly OWO & invites (owner only)"
        });
      }

      e.addFields({ name: "📌 How to Earn", value: "Invite members · Chat in channels · Stay in VC" });
      msg.reply({ embeds: [e] });
    }
  },

  // ── C.ping ───────────────────────────────────────────────────
  ping: {
    aliases: [],
    async run(msg) {
      const s = await msg.reply({ embeds: [okE("🏓 Pinging...")] });
      s.edit({ embeds: [mkE(COLOR.white).setTitle("🏓 Pong!")
        .addFields(
          { name: "Bot Latency", value: `${s.createdTimestamp - msg.createdTimestamp}ms`, inline: true },
          { name: "API Latency", value: `${Math.round(msg.client.ws.ping)}ms`, inline: true }
        )] });
    }
  },

  // ── C.balance ────────────────────────────────────────────────
  balance: {
    aliases: ["bal", "wallet", "w"],
    async run(msg) {
      const target = msg.mentions.users.first() || msg.author;
      if (target.bot) return msg.reply({ embeds: [errE("Bots have no balance.")] });
      const u = getUser(target.id, msg.guild.id);
      msg.reply({ embeds: [
        mkE(COLOR.white)
          .setTitle(`💼 ${target.username}'s Wallet`)
          .setThumbnail(target.displayAvatarURL())
          .addFields(
            { name: "🐾 OWO",      value: fmt(u.owo),                        inline: true },
            { name: "💵 INR",      value: `₹${u.inr.toLocaleString()}`,      inline: true },
            { name: "\u200b",      value: "\u200b",                           inline: true },
            { name: "📨 Invites",  value: String(u.invites),                 inline: true },
            { name: "💬 Messages", value: u.messages.toLocaleString(),        inline: true },
            { name: "🎙 VC Time",  value: `${Math.floor(u.vc_minutes)} min`,  inline: true },
          )
      ]});
    }
  },

  // ── C.invites ────────────────────────────────────────────────
  invites: {
    aliases: ["inv"],
    async run(msg) {
      const target = msg.mentions.users.first() || msg.author;
      const u = getUser(target.id, msg.guild.id);
      msg.reply({ embeds: [mkE(COLOR.white).setTitle(`📨 ${target.username}'s Invites`).setThumbnail(target.displayAvatarURL()).setDescription(`**${u.invites}** total invites`)] });
    }
  },

  // ── C.rewards ────────────────────────────────────────────────
  rewards: {
    aliases: ["rewardlist", "rl"],
    async run(msg) {
      const invLines = REWARDS.invite.map(t => `• Every **${t.every} invite${t.every>1?"s":""}** → \`${fmt(t.owo)} OWO\` *(stackable)*`).join("\n");
      const msgLines = REWARDS.message.map(t => { let r = t.owo > 0 ? `\`${fmt(t.owo)} OWO\`` : ""; if (t.boost>0) r+=` + 🔮 ${t.boost} Boost${t.boost>1?"s":""}`; if (t.nitro) r+=" + 🎮 Nitro"; return `• **${t.at.toLocaleString()} msgs** → ${r}`; }).join("\n");
      const vcLines  = REWARDS.vc.map(t => { let r = t.owo > 0 ? `\`${fmt(t.owo)} OWO\`` : ""; if (t.boost>0) r+=` + 🔮 ${t.boost} Boost`; if (t.nitro) r+=" + 🎮 Nitro"; return `• **${t.hours}hr VC** → ${r}`; }).join("\n");
      msg.reply({ embeds: [mkE(COLOR.white).setTitle("🏆 Ceas Weekly Rewards")
        .addFields(
          { name: "📨 Invite Rewards *(stackable)*",      value: invLines },
          { name: "💬 Message Rewards *(one-time each)*", value: msgLines },
          { name: "🎙 VC Rewards *(one-time each)*",      value: vcLines  },
          { name: "📌 Note", value: "Boost & Nitro rewards are given manually by admins. OWO is auto-credited!" }
        )]});
    }
  },

  // ── C.leaderboard ────────────────────────────────────────────
  leaderboard: {
    aliases: ["lb", "top", "rank"],
    async run(msg, args) {
      const colMap = { owo:"owo", inr:"inr", invites:"invites", messages:"messages", vc:"vc_minutes" };
      const col    = colMap[(args[0]||"owo").toLowerCase()] ?? "owo";
      const label  = { owo:"🐾 OWO", inr:"💵 INR", invites:"📨 Invites", messages:"💬 Messages", vc_minutes:"🎙 VC Time" }[col];
      const rows   = getTop(msg.guild.id, col);
      if (!rows.length) return msg.reply({ embeds: [okE("No data yet!")] });
      const lines = await Promise.all(rows.map(async (row, i) => {
        let u; try { u = await msg.client.users.fetch(row.user_id); } catch { u = { username: `User#${row.user_id.slice(-4)}` }; }
        const medal = ["🥇","🥈","🥉"][i] ?? `**${i+1}.**`;
        const val = col==="inr" ? `₹${row.inr.toLocaleString()}` : col==="owo" ? `${fmt(row.owo)} OWO` : col==="invites" ? `${row.invites} inv` : col==="messages" ? `${row.messages.toLocaleString()} msgs` : `${Math.floor(row.vc_minutes)} min`;
        return `${medal} **${u.username}** — ${val}`;
      }));
      msg.reply({ embeds: [mkE(COLOR.white).setTitle(`${label} Leaderboard — ${msg.guild.name}`).setDescription(lines.join("\n"))] });
    }
  },

  // ── C.inr  ← OPENS A TICKET FOR PAYMENT ─────────────────────
  inr: {
    aliases: ["pay", "send", "transfer"],
    async run(msg, args) {
      if (args.length < 2) return msg.reply({ embeds: [errE("Usage: `C.inr <amount> @user`")] });

      const amount = parseFloat(args[0]);
      const target = msg.mentions.users.first();

      if (isNaN(amount) || amount <= 0) return msg.reply({ embeds: [errE("Invalid amount.")] });
      if (!target)                      return msg.reply({ embeds: [errE("Mention the user to pay.")] });
      if (target.id === msg.author.id)  return msg.reply({ embeds: [errE("You can't pay yourself.")] });
      if (target.bot)                   return msg.reply({ embeds: [errE("Can't pay a bot.")] });

      const sender = getUser(msg.author.id, msg.guild.id);
      if (sender.inr < amount) return msg.reply({ embeds: [errE(`Not enough balance. You have **₹${sender.inr.toLocaleString()} INR**.`)] });

      // Create ticket channel
      let ticketChannel;
      try {
        ticketChannel = await openTicket(msg.guild, target, {
          type: "payment",
          extra: { senderUser: msg.author },
        });
      } catch (e) {
        console.error("[TICKET CREATE]", e);
        return msg.reply({ embeds: [errE("Could not create ticket. Make sure the bot has **Manage Channels** permission.")] });
      }

      const payId = createPayment(msg.author.id, target.id, msg.guild.id, amount, ticketChannel.id);

      // Send initial payment request embed in ticket
      const closeRow = await sendCloseRow(ticketChannel);
      const requestEmbed = mkE(COLOR.white)
        .setTitle("💳 INR Payment Request")
        .setDescription(
          `**${msg.author}** wants to send **₹${amount.toLocaleString()} INR** to **${target}**.\n\n` +
          `**${target.username}**, please share your payment details:\n\n` +
          `> 📱 **UPI ID** — e.g. \`name@upi\`\n` +
          `> 🖼️ **QR Code** — send as image\n` +
          `> 🏦 **Bank Account + IFSC**\n\n` +
          `_Payment ID: #${payId} · Expires in 10 min_`
        );

      const ticketMsg = await ticketChannel.send({
        content: `${msg.author} ${target}`,
        embeds: [requestEmbed],
        components: [closeRow],
      });

      msg.reply({ embeds: [okE(`✅ Payment ticket opened! → ${ticketChannel}`)] });

      // Collect payment info in ticket channel
      const infoCollector = ticketChannel.createMessageCollector({
        filter: (m) => m.author.id === target.id && !m.author.bot,
        time: 600_000,
        max: 1,
      });

      infoCollector.on("collect", async (response) => {
        let info = response.content?.trim() || "";
        if (response.attachments.size > 0) info = `[QR Image attached above] ${response.attachments.first().url}`;
        if (!info) info = "(no text provided)";

        const infoEmbed = mkE(COLOR.white)
          .setTitle("📩 Payment Details Received")
          .addFields(
            { name: "💵 Amount",       value: `₹${amount.toLocaleString()} INR`, inline: true },
            { name: "👤 Recipient",    value: target.username,                    inline: true },
            { name: "📋 Details",      value: `\`\`\`${info.slice(0, 900)}\`\`\`` },
            { name: "⏳ Next Step",    value: `**${msg.author.username}** — pay via UPI/bank, then click **✅ Paid**.` }
          )
          .setFooter({ text: `Payment ID #${payId} • Ceas Bot` });

        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`pay_confirm_${payId}`).setLabel("✅ I've Paid").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`pay_reject_${payId}`).setLabel("❌ Reject / Cancel").setStyle(ButtonStyle.Secondary),
        );

        await ticketMsg.edit({ embeds: [infoEmbed], components: [confirmRow] }).catch(() => {});

        const confirmCollector = ticketMsg.createMessageComponentCollector({
          filter: (i) => {
            const rightBtn = i.customId === `pay_confirm_${payId}` || i.customId === `pay_reject_${payId}`;
            const authorised = i.user.id === msg.author.id || (i.member && isAdmin(i.member));
            return rightBtn && authorised;
          },
          componentType: ComponentType.Button,
          time: 1_800_000,
          max: 1,
        });

        confirmCollector.on("collect", async (i) => {
          if (i.customId === `pay_confirm_${payId}`) {
            addInr(msg.author.id, msg.guild.id, -amount);
            addInr(target.id,     msg.guild.id,  amount);
            closePayment(payId, "completed");

            const doneEmbed = mkE(COLOR.white)
              .setTitle("✅ Payment Complete!")
              .setDescription(`**₹${amount.toLocaleString()} INR** transferred to **${target.username}** successfully!`)
              .setFooter({ text: `Payment ID #${payId} • Confirmed by ${i.user.username}` });

            const finalRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`ticket_delete_${ticketChannel.id}`).setLabel("🗑 Close & Delete Ticket").setStyle(ButtonStyle.Secondary),
            );

            await i.update({ embeds: [doneEmbed], components: [finalRow] }).catch(() => {});
          } else {
            closePayment(payId, "rejected");
            const rejEmbed = mkE(COLOR.black)
              .setTitle("❌ Payment Rejected")
              .setDescription(`Payment of **₹${amount.toLocaleString()}** was rejected.\n\nThis ticket will close in 30 seconds.`);

            await i.update({ embeds: [rejEmbed], components: [] }).catch(() => {});
            setTimeout(() => ticketChannel.delete().catch(() => {}), 30_000);
          }
        });

        confirmCollector.on("end", (_, reason) => {
          if (reason === "time") {
            closePayment(payId, "expired");
            ticketChannel.send({ embeds: [errE("Payment timed out. Closing ticket in 30 seconds.")] }).catch(() => {});
            setTimeout(() => ticketChannel.delete().catch(() => {}), 30_000);
          }
        });
      });

      infoCollector.on("end", (_, reason) => {
        if (reason === "time") {
          closePayment(payId, "expired");
          ticketChannel.send({ embeds: [errE("No payment info received. Ticket expiring in 30 seconds.")] }).catch(() => {});
          setTimeout(() => ticketChannel.delete().catch(() => {}), 30_000);
        }
      });
    }
  },

  // ── C.owo  ← INSTANT OWO TRANSFER ───────────────────────────
  owo: {
    aliases: ["giveowo", "sendowo"],
    async run(msg, args) {
      if (args.length < 2) return msg.reply({ embeds: [errE("Usage: `C.owo <amount> @user`")] });
      const amount = parseFloat(args[0]);
      const target = msg.mentions.users.first();
      if (isNaN(amount) || amount <= 0) return msg.reply({ embeds: [errE("Invalid amount.")] });
      if (!target || target.bot)        return msg.reply({ embeds: [errE("Mention a valid user.")] });
      if (target.id === msg.author.id)  return msg.reply({ embeds: [errE("Can't send to yourself.")] });
      const sender = getUser(msg.author.id, msg.guild.id);
      if (sender.owo < amount) return msg.reply({ embeds: [errE(`Not enough OWO. You have **${fmt(sender.owo)} OWO**.`)] });
      addOwo(msg.author.id, msg.guild.id, -amount);
      addOwo(target.id,     msg.guild.id,  amount);
      msg.reply({ embeds: [mkE(COLOR.white).setTitle("🐾 OWO Sent!").setDescription(`**${msg.author.username}** → **${target.username}**\n**${fmt(amount)} OWO** transferred!`)] });
    }
  },

  // ── C.ticket  ← OPEN SUPPORT TICKET ─────────────────────────
  ticket: {
    aliases: ["newticket", "open"],
    async run(msg) {
      let ticketChannel;
      try {
        ticketChannel = await openTicket(msg.guild, msg.author, { type: "support" });
      } catch (e) {
        return msg.reply({ embeds: [errE("Could not create ticket. Bot needs **Manage Channels** permission.")] });
      }

      const closeRow = await sendCloseRow(ticketChannel);
      await ticketChannel.send({
        content: `${msg.author}`,
        embeds: [
          mkE(COLOR.white)
            .setTitle("🎫 Support Ticket Opened")
            .setDescription(
              `Welcome, **${msg.author.username}**!\n\n` +
              `Please describe your issue or request and a staff member will assist you shortly.\n\n` +
              `_Use the buttons below to close this ticket when done._`
            )
        ],
        components: [closeRow],
      });

      msg.reply({ embeds: [okE(`✅ Ticket opened! → ${ticketChannel}`)] });
    }
  },

  // ── C.ticketpanel  ← SEND BUTTON PANEL ──────────────────────
  ticketpanel: {
    aliases: ["panel", "tpanel"],
    async run(msg) {
      if (!isStaff(msg.member, msg.author.id))
        return msg.reply({ embeds: [errE("Only admins can send the ticket panel.")] });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("open_ticket_support").setLabel("🎫 Open Ticket").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("open_ticket_payment").setLabel("💳 Payment Help").setStyle(ButtonStyle.Secondary),
      );

      await msg.channel.send({
        embeds: [
          mkE(COLOR.white)
            .setTitle("🎫 Support & Payment Tickets")
            .setDescription(
              "Need help or want to request a payment?\n\n" +
              "**🎫 Open Ticket** — General support\n" +
              "**💳 Payment Help** — INR payment assistance\n\n" +
              "*Click a button below to open your ticket.*"
            )
        ],
        components: [row],
      });

      msg.delete().catch(() => {});
    }
  },

  // ── C.setcategory  ← SET TICKET CATEGORY ────────────────────
  setcategory: {
    aliases: ["ticketcat", "setcat"],
    async run(msg, args) {
      if (!isStaff(msg.member, msg.author.id))
        return msg.reply({ embeds: [errE("Only admins can set the ticket category.")] });

      const categoryId = args[0];
      if (!categoryId) return msg.reply({ embeds: [errE("Usage: `C.setcategory <category_id>`")] });

      const cat = msg.guild.channels.cache.get(categoryId);
      if (!cat || cat.type !== ChannelType.GuildCategory)
        return msg.reply({ embeds: [errE("That's not a valid category ID.")] });

      setConfig(msg.guild.id, "ticket_category", categoryId);
      msg.reply({ embeds: [okE(`✅ Ticket category set to **${cat.name}**.`)] });
    }
  },

  // ── C.award  (admin) ─────────────────────────────────────────
  award: {
    aliases: ["addbal", "addowo", "givebal"],
    async run(msg, args) {
      if (!isStaff(msg.member, msg.author.id)) return msg.reply({ embeds: [errE("Admins only.")] });
      const target   = msg.mentions.users.first();
      const amount   = parseFloat(args[1]);
      const currency = (args[2] || "owo").toLowerCase();
      if (!target || isNaN(amount) || amount <= 0 || !["owo","inr"].includes(currency))
        return msg.reply({ embeds: [errE("Usage: `C.award @user <amount> <owo|inr>`")] });
      if (currency === "owo") addOwo(target.id, msg.guild.id,  amount);
      else                    addInr(target.id,  msg.guild.id,  amount);
      const cur = currency === "owo" ? `${fmt(amount)} OWO 🐾` : `₹${amount.toLocaleString()} INR 💵`;
      msg.reply({ embeds: [mkE(COLOR.white).setTitle("✅ Awarded").setDescription(`**${cur}** added to **${target.username}**'s wallet by ${msg.author.username}.`)] });
    }
  },

  // ── C.removebal  (admin) ──────────────────────────────────────
  removebal: {
    aliases: ["deduct", "rmbal"],
    async run(msg, args) {
      if (!isStaff(msg.member, msg.author.id)) return msg.reply({ embeds: [errE("Admins only.")] });
      const target   = msg.mentions.users.first();
      const amount   = parseFloat(args[1]);
      const currency = (args[2] || "owo").toLowerCase();
      if (!target || isNaN(amount) || !["owo","inr"].includes(currency))
        return msg.reply({ embeds: [errE("Usage: `C.removebal @user <amount> <owo|inr>`")] });
      if (currency === "owo") addOwo(target.id, msg.guild.id, -amount);
      else                    addInr(target.id,  msg.guild.id, -amount);
      msg.reply({ embeds: [okE(`Removed **${currency === "owo" ? fmt(amount) + " OWO" : "₹" + amount}** from **${target.username}**.`)] });
    }
  },

  // ── C.setbal  (admin) ─────────────────────────────────────────
  setbal: {
    aliases: ["setbalance", "setowo"],
    async run(msg, args) {
      if (!isStaff(msg.member, msg.author.id)) return msg.reply({ embeds: [errE("Admins only.")] });
      const target   = msg.mentions.users.first();
      const amount   = parseFloat(args[1]);
      const currency = (args[2] || "owo").toLowerCase();
      if (!target || isNaN(amount) || !["owo","inr"].includes(currency))
        return msg.reply({ embeds: [errE("Usage: `C.setbal @user <amount> <owo|inr>`")] });
      if (currency === "owo") setOwo(target.id, msg.guild.id, amount);
      else                    setInr(target.id,  msg.guild.id, amount);
      msg.reply({ embeds: [okE(`Set **${target.username}**'s ${currency.toUpperCase()} to **${currency === "owo" ? fmt(amount) + " OWO" : "₹" + amount}**.`)] });
    }
  },

  // ── C.checkbal  (admin) ───────────────────────────────────────
  checkbal: {
    aliases: ["adminbal", "uinfo"],
    async run(msg, args) {
      if (!isStaff(msg.member, msg.author.id)) return msg.reply({ embeds: [errE("Admins only.")] });
      const target = msg.mentions.users.first();
      if (!target) return msg.reply({ embeds: [errE("Mention a user.")] });
      const u = getUser(target.id, msg.guild.id);
      msg.reply({ embeds: [mkE(COLOR.white).setTitle(`🔍 ${target.username} — Admin View`).setThumbnail(target.displayAvatarURL())
        .addFields(
          { name: "🐾 OWO",      value: fmt(u.owo),                        inline: true },
          { name: "💵 INR",      value: `₹${u.inr.toLocaleString()}`,      inline: true },
          { name: "\u200b",      value: "\u200b",                           inline: true },
          { name: "📨 Invites",  value: String(u.invites),                 inline: true },
          { name: "💬 Messages", value: u.messages.toLocaleString(),        inline: true },
          { name: "🎙 VC Time",  value: `${Math.floor(u.vc_minutes)} min`,  inline: true },
          { name: "User ID",     value: `\`${target.id}\``,                inline: false },
        )] });
    }
  },

  // ── C.resetweekly  (owner only) ──────────────────────────────
  resetweekly: {
    aliases: ["weekly", "weekreset"],
    async run(msg) {
      if (!isOwner(msg.author.id)) return msg.reply({ embeds: [errE("Owner only command.")] });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("confirm_weekly_reset").setLabel("✅ Yes, Reset").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("cancel_weekly_reset").setLabel("❌ Cancel").setStyle(ButtonStyle.Secondary),
      );
      const prompt = await msg.reply({ embeds: [mkE(COLOR.black).setTitle("⚠️ Weekly Reset").setDescription("This resets **all OWO & invite counts** for this server. Cannot be undone!")], components: [row] });
      const i = await prompt.awaitMessageComponent({ filter: i => i.user.id === msg.author.id, componentType: ComponentType.Button, time: 30_000 }).catch(() => null);
      if (!i || i.customId === "cancel_weekly_reset") return prompt.edit({ embeds: [okE("Cancelled.")], components: [] });
      resetWeeklyDb(msg.guild.id);
      i.update({ embeds: [mkE(COLOR.white).setTitle("✅ Weekly Reset Done").setDescription("All OWO balances and invite counts have been reset! New week started 🎉")], components: [] });
    }
  },

};

// Build alias map
const CMD_MAP = new Map();
for (const [name, cmd] of Object.entries(COMMANDS)) {
  CMD_MAP.set(name, cmd);
  for (const alias of (cmd.aliases || [])) CMD_MAP.set(alias, cmd);
}

// ─── CLIENT ──────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ─── EVENT: ready ────────────────────────────────────────────────
client.once("ready", async () => {
  console.log(`✅ Ceas online — ${client.user.tag}`);
  client.user.setPresence({ status: "online", activities: [{ name: "C.help | Tracking everything", type: 3 }] });
  for (const guild of client.guilds.cache.values()) {
    try {
      const invs = await guild.invites.fetch();
      for (const inv of invs.values()) cacheInvite(inv.code, guild.id, inv.inviter?.id ?? "unknown", inv.uses ?? 0);
    } catch {}
  }
  console.log(`📨 Invite cache loaded for ${client.guilds.cache.size} server(s).`);
  if (!OWNER_ID) console.warn("⚠️  OWNER_ID not set — add it to .env for owner-only commands.");
});

// ─── EVENT: messageCreate ────────────────────────────────────────
client.on("messageCreate", async (msg) => {
  try {
    if (msg.author.bot || !msg.guild) return;
    const u = getUser(msg.author.id, msg.guild.id);
    if (Date.now() - (u.last_msg_ts || 0) >= REWARDS.msgCooldownMs) {
      setMsgTs(msg.author.id, msg.guild.id, Date.now());
      const total = addMsg(msg.author.id, msg.guild.id);
      await checkMessageRewards(msg.author.id, msg.guild.id, total);
    }
    if (!msg.content.startsWith(PREFIX)) return;
    const args = msg.content.slice(PREFIX.length).trim().split(/\s+/);
    const name = args.shift().toLowerCase();
    const cmd  = CMD_MAP.get(name);
    if (!cmd) return;
    await cmd.run(msg, args);
  } catch (e) { console.error("[messageCreate]", e); }
});

// ─── EVENT: interactionCreate  (button handler) ──────────────────
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  try {
    const { customId, guild, member, user } = interaction;

    // ── Panel buttons: open ticket ────────────────────────────
    if (customId === "open_ticket_support" || customId === "open_ticket_payment") {
      const type = customId === "open_ticket_payment" ? "payment" : "support";
      let ch;
      try { ch = await openTicket(guild, user, { type }); }
      catch { return interaction.reply({ embeds: [errE("Could not create ticket. Bot needs Manage Channels.")], ephemeral: true }); }

      const closeRow = await sendCloseRow(ch);
      await ch.send({
        content: `${user}`,
        embeds: [mkE(COLOR.white)
          .setTitle(type === "payment" ? "💳 Payment Help Ticket" : "🎫 Support Ticket")
          .setDescription(
            type === "payment"
              ? `Welcome **${user.username}**!\n\nDescribe your payment issue. Staff will assist you.\n\n_For INR payments, use \`C.inr <amount> @user\` in any channel._`
              : `Welcome **${user.username}**!\n\nDescribe your issue and a staff member will help you.`
          )],
        components: [closeRow],
      });
      return interaction.reply({ content: `✅ Ticket opened → ${ch}`, ephemeral: true });
    }

    // ── Close ticket ──────────────────────────────────────────
    if (customId.startsWith("ticket_close_")) {
      const channelId = customId.replace("ticket_close_", "");
      const ticket    = getTicket(channelId);
      if (!ticket) return interaction.reply({ embeds: [errE("Ticket not found.")], ephemeral: true });
      if (!isStaff(member, user.id) && user.id !== ticket.user_id)
        return interaction.reply({ embeds: [errE("Only the ticket owner or admins can close this.")], ephemeral: true });

      closeTicket(channelId);
      const ch = guild.channels.cache.get(channelId);
      if (ch) {
        const deleteRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`ticket_delete_${channelId}`).setLabel("🗑 Delete Ticket").setStyle(ButtonStyle.Secondary),
        );
        await interaction.update({ embeds: [mkE(COLOR.black).setTitle("🔒 Ticket Closed").setDescription(`Closed by **${user.username}**.\nClick Delete to remove this channel.`)], components: [deleteRow] });
        // Remove user's send permission
        try { await ch.permissionOverwrites.edit(ticket.user_id, { SendMessages: false }); } catch {}
      }
      return;
    }

    // ── Delete ticket ─────────────────────────────────────────
    if (customId.startsWith("ticket_delete_")) {
      const channelId = customId.replace("ticket_delete_", "");
      if (!isStaff(member, user.id))
        return interaction.reply({ embeds: [errE("Only admins can delete tickets.")], ephemeral: true });
      const ch = guild.channels.cache.get(channelId);
      if (ch) {
        await interaction.reply({ content: "Deleting in 3 seconds...", ephemeral: true });
        setTimeout(() => ch.delete().catch(() => {}), 3000);
      }
      return;
    }

  } catch (e) { console.error("[interactionCreate]", e); }
});

// ─── EVENT: guildMemberAdd ───────────────────────────────────────
client.on("guildMemberAdd", async (member) => {
  try {
    const newInvs = await member.guild.invites.fetch();
    let used = null;
    for (const inv of newInvs.values()) {
      const cached = getCached(inv.code);
      if (cached && inv.uses > cached.uses) { used = inv; updateCached(inv.code, inv.uses); break; }
    }
    for (const inv of newInvs.values()) cacheInvite(inv.code, member.guild.id, inv.inviter?.id ?? "unknown", inv.uses ?? 0);
    if (used?.inviter) {
      const total = addInvite(used.inviter.id, member.guild.id);
      await checkInviteRewards(used.inviter.id, member.guild.id, total);
    }
  } catch (e) { console.error("[guildMemberAdd]", e.message); }
});

// ─── EVENT: voiceStateUpdate ─────────────────────────────────────
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const member = newState.member || oldState.member;
    if (!member || member.user?.bot) return;
    const uid = member.id, gid = member.guild.id;
    if (!oldState.channel && newState.channel) {
      startVc(uid, gid);
    } else if (oldState.channel && !newState.channel) {
      const mins = endVc(uid, gid);
      if (mins > 0) { const total = addVcMin(uid, gid, mins); await checkVcRewards(uid, gid, total); }
    }
  } catch (e) { console.error("[voiceStateUpdate]", e.message); }
});

// ─── LOGIN ───────────────────────────────────────────────────────
if (!process.env.DISCORD_TOKEN) {
  console.error("❌  DISCORD_TOKEN missing! Copy .env.example → .env and add your token.");
  process.exit(1);
}
client.login(process.env.DISCORD_TOKEN);
