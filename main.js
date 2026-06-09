// ═══════════════════════════════════════════════════════════════
//  CEAS BOT  —  main.js
//  All-in-one: Database · Config · Commands · Events
// ═══════════════════════════════════════════════════════════════

const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
} = require("discord.js");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

// ─── DATA DIR ────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── DATABASE ────────────────────────────────────────────────────
const db = new Database(path.join(DATA_DIR, "ceas.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id         TEXT NOT NULL,
    guild_id        TEXT NOT NULL,
    owo             INTEGER DEFAULT 0,
    inr             REAL    DEFAULT 0,
    messages        INTEGER DEFAULT 0,
    vc_minutes      REAL    DEFAULT 0,
    invites         INTEGER DEFAULT 0,
    last_msg_ts     INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, guild_id)
  );
  CREATE TABLE IF NOT EXISTS invite_cache (
    code        TEXT PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    inviter_id  TEXT NOT NULL,
    uses        INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS vc_sessions (
    user_id   TEXT NOT NULL,
    guild_id  TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, guild_id)
  );
  CREATE TABLE IF NOT EXISTS milestones (
    user_id   TEXT NOT NULL,
    guild_id  TEXT NOT NULL,
    type      TEXT NOT NULL,
    key       TEXT NOT NULL,
    count     INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, guild_id, type, key)
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
`);

// DB Helpers
const getUser = (uid, gid) => {
  db.prepare("INSERT OR IGNORE INTO users (user_id, guild_id) VALUES (?,?)").run(uid, gid);
  return db.prepare("SELECT * FROM users WHERE user_id=? AND guild_id=?").get(uid, gid);
};
const addOwo      = (uid, gid, n) => db.prepare("UPDATE users SET owo=MAX(0,owo+?) WHERE user_id=? AND guild_id=?").run(n, uid, gid);
const addInr      = (uid, gid, n) => db.prepare("UPDATE users SET inr=MAX(0,inr+?) WHERE user_id=? AND guild_id=?").run(n, uid, gid);
const addMessages = (uid, gid)    => { db.prepare("UPDATE users SET messages=messages+1 WHERE user_id=? AND guild_id=?").run(uid, gid); return db.prepare("SELECT messages FROM users WHERE user_id=? AND guild_id=?").get(uid, gid).messages; };
const addVcMin    = (uid, gid, m) => { db.prepare("UPDATE users SET vc_minutes=vc_minutes+? WHERE user_id=? AND guild_id=?").run(m, uid, gid); return db.prepare("SELECT vc_minutes FROM users WHERE user_id=? AND guild_id=?").get(uid, gid).vc_minutes; };
const addInvite   = (uid, gid)    => { db.prepare("UPDATE users SET invites=invites+1 WHERE user_id=? AND guild_id=?").run(uid, gid); return db.prepare("SELECT invites FROM users WHERE user_id=? AND guild_id=?").get(uid, gid).invites; };
const setMsgTs    = (uid, gid, t) => db.prepare("UPDATE users SET last_msg_ts=? WHERE user_id=? AND guild_id=?").run(t, uid, gid);
const getMilestone = (uid, gid, type, key) => db.prepare("SELECT count FROM milestones WHERE user_id=? AND guild_id=? AND type=? AND key=?").get(uid, gid, type, String(key))?.count ?? 0;
const setMilestone = (uid, gid, type, key, count) => db.prepare("INSERT INTO milestones (user_id,guild_id,type,key,count) VALUES (?,?,?,?,?) ON CONFLICT(user_id,guild_id,type,key) DO UPDATE SET count=excluded.count").run(uid, gid, type, String(key), count);
const getTop = (gid, col, n = 10) => db.prepare(`SELECT * FROM users WHERE guild_id=? ORDER BY ${col} DESC LIMIT ?`).all(gid, n);

// Invite cache helpers
const cacheInvite    = (code, gid, inv, uses) => db.prepare("INSERT OR REPLACE INTO invite_cache VALUES (?,?,?,?)").run(code, gid, inv, uses);
const getCached      = (code)                  => db.prepare("SELECT * FROM invite_cache WHERE code=?").get(code);
const updateCached   = (code, uses)            => db.prepare("UPDATE invite_cache SET uses=? WHERE code=?").run(uses, code);

// VC session helpers
const startVc = (uid, gid)    => db.prepare("INSERT OR REPLACE INTO vc_sessions VALUES (?,?,?)").run(uid, gid, Date.now());
const endVc   = (uid, gid)    => {
  const row = db.prepare("SELECT joined_at FROM vc_sessions WHERE user_id=? AND guild_id=?").get(uid, gid);
  db.prepare("DELETE FROM vc_sessions WHERE user_id=? AND guild_id=?").run(uid, gid);
  return row ? (Date.now() - row.joined_at) / 60000 : 0;
};

// Payment helpers
const createPayment = (sid, rid, gid, amt, cid) => db.prepare("INSERT INTO payments (sender_id,receiver_id,guild_id,amount,channel_id) VALUES (?,?,?,?,?)").run(sid, rid, gid, amt, cid).lastInsertRowid;
const closePayment  = (id, status)               => db.prepare("UPDATE payments SET status=? WHERE id=?").run(status, id);

// ─── CONFIG ──────────────────────────────────────────────────────
const PREFIX = "C.";
const COLOR  = { white: 0xFFFFFF, black: 0x000000 };

const REWARDS = {
  // ── INVITE (stackable) ──
  invite: [
    { every: 1,  owo: 100_000 },
    { every: 3,  owo: 500_000 },
    { every: 5,  owo: 800_000 },
    { every: 10, owo: 1_000_000 },
  ],
  // ── MESSAGES (one-time milestones) ──
  message: [
    { at: 100,   owo: 10_000,  boost: 0, nitro: false },
    { at: 500,   owo: 50_000,  boost: 0, nitro: false },
    { at: 1000,  owo: 100_000, boost: 0, nitro: false },
    { at: 10000, owo: 0,       boost: 2, nitro: false },
  ],
  // ── VC (one-time milestones) ──
  vc: [
    { hours: 5,   owo: 100_000, boost: 0, nitro: false },
    { hours: 10,  owo: 250_000, boost: 0, nitro: false },
    { hours: 50,  owo: 0,       boost: 1, nitro: false },
    { hours: 100, owo: 0,       boost: 0, nitro: true  },
  ],
  msgCooldownMs: 3000,
};

// ─── UTILS ───────────────────────────────────────────────────────
const fmt = (n) => n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1_000 ? `${n / 1_000}K` : String(n);
const embed = (color) => new EmbedBuilder().setColor(color).setFooter({ text: "Ceas Bot" }).setTimestamp();
const err   = (msg)   => embed(COLOR.black).setDescription(`❌ ${msg}`);
const ok    = (msg)   => embed(COLOR.white).setDescription(msg);

// Notify user via DM for milestone
async function dmReward(client, userId, title, lines) {
  try {
    const user = await client.users.fetch(userId);
    await user.send({ embeds: [embed(COLOR.white).setTitle(title).setDescription(lines.join("\n"))] });
  } catch { /* DMs closed */ }
}

// ─── REWARD CHECKERS ────────────────────────────────────────────

// Invite — stackable: reward fires each time the multiple is reached
async function checkInviteRewards(client, uid, gid, totalInvites) {
  for (const tier of REWARDS.invite) {
    const reached  = Math.floor(totalInvites / tier.every);
    const claimed  = getMilestone(uid, gid, "invite", tier.every);
    if (reached > claimed) {
      const times = reached - claimed;
      setMilestone(uid, gid, "invite", tier.every, reached);
      getUser(uid, gid);
      addOwo(uid, gid, tier.owo * times);
      await dmReward(client, uid, "🎉 Invite Reward!",
        [`You hit **${tier.every} invite${tier.every > 1 ? "s" : ""}** × ${times}!`,
         `**+${fmt(tier.owo * times)} OWO** added to your wallet!`]);
    }
  }
}

// Message — one-time milestones
async function checkMessageRewards(client, uid, gid, total) {
  for (const tier of REWARDS.message) {
    if (total < tier.at) continue;
    if (getMilestone(uid, gid, "message", tier.at) > 0) continue;
    setMilestone(uid, gid, "message", tier.at, 1);
    if (tier.owo > 0) addOwo(uid, gid, tier.owo);
    const lines = [`You sent **${tier.at.toLocaleString()} messages**!`];
    if (tier.owo  > 0) lines.push(`**+${fmt(tier.owo)} OWO** added!`);
    if (tier.boost > 0) lines.push(`**+${tier.boost} Server Boost** — claim from admin!`);
    if (tier.nitro)     lines.push(`**🎮 Nitro Account** — claim from admin!`);
    await dmReward(client, uid, "💬 Message Milestone!", lines);
  }
}

// VC — one-time milestones
async function checkVcRewards(client, uid, gid, totalMinutes) {
  const hrs = totalMinutes / 60;
  for (const tier of REWARDS.vc) {
    if (hrs < tier.hours) continue;
    if (getMilestone(uid, gid, "vc", tier.hours) > 0) continue;
    setMilestone(uid, gid, "vc", tier.hours, 1);
    if (tier.owo > 0) addOwo(uid, gid, tier.owo);
    const lines = [`You spent **${tier.hours} hours** in voice chat!`];
    if (tier.owo   > 0) lines.push(`**+${fmt(tier.owo)} OWO** added!`);
    if (tier.boost > 0) lines.push(`**+${tier.boost} Server Boost** — claim from admin!`);
    if (tier.nitro)     lines.push(`**🎮 Nitro Account** — claim from admin!`);
    await dmReward(client, uid, "🎙 VC Milestone!", lines);
  }
}

// ─── COMMANDS ────────────────────────────────────────────────────
const COMMANDS = {

  // ── C.help ──────────────────────────────────────────────────
  help: {
    aliases: ["h", "commands"],
    async run(msg) {
      msg.reply({ embeds: [
        embed(COLOR.white)
          .setTitle("📖 Ceas — Commands  (Prefix: C.)")
          .addFields(
            { name: "💰 Economy", value: [
                "`C.balance [@user]` — View wallet",
                "`C.give <amount> inr @user` — Send INR (UPI flow)",
                "`C.give <amount> owo @user` — Send OWO",
                "`C.leaderboard [owo|inr|invites|messages|vc]` — Top 10",
              ].join("\n") },
            { name: "🏆 Rewards", value: [
                "`C.rewards` — Full reward rates",
                "`C.invites [@user]` — Invite count",
              ].join("\n") },
            { name: "ℹ️ General", value: "`C.help` — This menu\n`C.ping` — Latency" },
            { name: "📌 How to Earn", value: "Invite members · Chat in channels · Sit in VC" },
          )
      ]});
    }
  },

  // ── C.ping ──────────────────────────────────────────────────
  ping: {
    aliases: [],
    async run(msg) {
      const s = await msg.reply({ embeds: [ok("🏓 Pinging...")] });
      s.edit({ embeds: [embed(COLOR.white).setTitle("🏓 Pong!")
        .addFields(
          { name: "Bot", value: `${s.createdTimestamp - msg.createdTimestamp}ms`, inline: true },
          { name: "API", value: `${Math.round(msg.client.ws.ping)}ms`, inline: true }
        )]});
    }
  },

  // ── C.balance ────────────────────────────────────────────────
  balance: {
    aliases: ["bal", "wallet", "coins"],
    async run(msg) {
      const target = msg.mentions.users.first() || msg.author;
      if (target.bot) return msg.reply({ embeds: [err("Bots have no balance.")] });
      const u = getUser(target.id, msg.guild.id);
      msg.reply({ embeds: [
        embed(COLOR.white)
          .setTitle(`💼 ${target.username}'s Wallet`)
          .setThumbnail(target.displayAvatarURL({ dynamic: true }))
          .addFields(
            { name: "🐾 OWO",     value: fmt(u.owo),                inline: true },
            { name: "💵 INR",     value: `₹${u.inr.toLocaleString()}`, inline: true },
            { name: "\u200b",     value: "\u200b",                   inline: true },
            { name: "📨 Invites", value: String(u.invites),          inline: true },
            { name: "💬 Messages",value: u.messages.toLocaleString(), inline: true },
            { name: "🎙 VC Time", value: `${Math.floor(u.vc_minutes)} min`, inline: true },
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
      msg.reply({ embeds: [
        embed(COLOR.white)
          .setTitle(`📨 ${target.username}'s Invites`)
          .setDescription(`**${u.invites}** total invites`)
          .setThumbnail(target.displayAvatarURL({ dynamic: true }))
      ]});
    }
  },

  // ── C.rewards ────────────────────────────────────────────────
  rewards: {
    aliases: ["rewardlist", "rl"],
    async run(msg) {
      const invLines = REWARDS.invite.map(t => `• Every **${t.every} invite${t.every > 1 ? "s" : ""}** → \`${fmt(t.owo)} OWO\` *(stackable)*`).join("\n");
      const msgLines = REWARDS.message.map(t => {
        let r = t.owo > 0 ? `\`${fmt(t.owo)} OWO\`` : "";
        if (t.boost > 0) r += ` + 🔮 ${t.boost} Server Boost${t.boost > 1 ? "s" : ""}`;
        if (t.nitro)     r += " + 🎮 Nitro Acc";
        return `• **${t.at.toLocaleString()} msgs** → ${r}`;
      }).join("\n");
      const vcLines = REWARDS.vc.map(t => {
        let r = t.owo > 0 ? `\`${fmt(t.owo)} OWO\`` : "";
        if (t.boost > 0) r += ` + 🔮 ${t.boost} Server Boost`;
        if (t.nitro)     r += " + 🎮 Nitro Acc";
        return `• **${t.hours}hr VC** → ${r}`;
      }).join("\n");

      msg.reply({ embeds: [
        embed(COLOR.white)
          .setTitle("🏆 Ceas Weekly Rewards")
          .addFields(
            { name: "📨 Invite Rewards *(stackable)*",       value: invLines },
            { name: "💬 Message Rewards *(one-time each)*",  value: msgLines },
            { name: "🎙 VC Rewards *(one-time each)*",       value: vcLines  },
            { name: "📌 Note", value: "Boost & Nitro rewards are given manually by admins.\nOWO rewards are credited automatically!" },
          )
      ]});
    }
  },

  // ── C.leaderboard ────────────────────────────────────────────
  leaderboard: {
    aliases: ["lb", "top", "rank"],
    async run(msg, args) {
      const map = { owo: "owo", inr: "inr", invites: "invites", messages: "messages", vc: "vc_minutes" };
      const col = map[(args[0] || "owo").toLowerCase()] || "owo";
      const label = { owo: "🐾 OWO", inr: "💵 INR", invites: "📨 Invites", messages: "💬 Messages", vc_minutes: "🎙 VC Time" }[col];
      const rows = getTop(msg.guild.id, col);
      if (!rows.length) return msg.reply({ embeds: [ok("No data yet!")] });

      const lines = await Promise.all(rows.map(async (row, i) => {
        let u; try { u = await msg.client.users.fetch(row.user_id); } catch { u = { username: row.user_id }; }
        const m = ["🥇","🥈","🥉"][i] ?? `**${i+1}.**`;
        const v = col === "inr" ? `₹${row.inr.toLocaleString()}` : col === "owo" ? `${fmt(row.owo)} OWO` : col === "invites" ? `${row.invites} inv` : col === "messages" ? `${row.messages.toLocaleString()} msgs` : `${Math.floor(row.vc_minutes)} min`;
        return `${m} **${u.username}** — ${v}`;
      }));

      msg.reply({ embeds: [embed(COLOR.white).setTitle(`${label} Leaderboard`).setDescription(lines.join("\n"))] });
    }
  },

  // ── C.give ───────────────────────────────────────────────────
  give: {
    aliases: ["pay", "transfer", "send"],
    async run(msg, args) {
      if (args.length < 3) return msg.reply({ embeds: [err("Usage: `C.give <amount> <owo|inr> @user`")] });

      const amount   = parseFloat(args[0]);
      const currency = args[1].toLowerCase();
      const target   = msg.mentions.users.first();

      if (isNaN(amount) || amount <= 0)   return msg.reply({ embeds: [err("Invalid amount.")] });
      if (!["owo","inr"].includes(currency)) return msg.reply({ embeds: [err("Currency must be `owo` or `inr`.")] });
      if (!target)                         return msg.reply({ embeds: [err("Mention a valid user.")] });
      if (target.id === msg.author.id)     return msg.reply({ embeds: [err("You can't send to yourself.")] });
      if (target.bot)                      return msg.reply({ embeds: [err("Bots can't receive currency.")] });

      const sender = getUser(msg.author.id, msg.guild.id);
      const bal    = currency === "owo" ? sender.owo : sender.inr;
      if (bal < amount) return msg.reply({ embeds: [err(`Insufficient balance. You have **${currency === "owo" ? fmt(sender.owo) + " OWO" : "₹" + sender.inr.toLocaleString() + " INR"}**.`)] });

      // OWO — instant transfer
      if (currency === "owo") {
        getUser(target.id, msg.guild.id);
        addOwo(msg.author.id, msg.guild.id, -amount);
        addOwo(target.id,     msg.guild.id,  amount);
        return msg.reply({ embeds: [ok(`✅ Sent **${fmt(amount)} OWO** to **${target.username}**!`)] });
      }

      // INR — UPI payment flow
      const payId = createPayment(msg.author.id, target.id, msg.guild.id, amount, msg.channel.id);

      const promptEmbed = embed(COLOR.white)
        .setTitle("💳 Payment Request")
        .setDescription(
          `**${msg.author.username}** wants to send **₹${amount.toLocaleString()} INR** to **${target.username}**.\n\n` +
          `**${target.username}**, please reply with one of:\n` +
          `> 📱 Your **UPI ID** (e.g. \`name@upi\`)\n` +
          `> 🖼 A **QR code image**\n` +
          `> 🏦 **Bank account + IFSC code**\n\n` +
          `_Expires in 5 minutes._`
        );

      const cancelRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cancel_${payId}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      );

      const prompt = await msg.channel.send({ content: `<@${target.id}>`, embeds: [promptEmbed], components: [cancelRow] });

      // Collect receiver's payment info
      const infoCollector = msg.channel.createMessageCollector({
        filter: (m) => m.author.id === target.id,
        time: 300_000,
        max: 1,
      });

      const btnCollector = prompt.createMessageComponentCollector({
        filter: (i) => i.customId === `cancel_${payId}` && (i.user.id === msg.author.id || i.user.id === target.id),
        componentType: ComponentType.Button,
        time: 300_000,
      });

      btnCollector.on("collect", async (i) => {
        infoCollector.stop("cancelled");
        closePayment(payId, "cancelled");
        await i.update({ embeds: [err("Payment cancelled.")], components: [] });
      });

      infoCollector.on("collect", async (response) => {
        btnCollector.stop();

        let info = response.content || "";
        if (response.attachments.size > 0)
          info = `[QR Image] ${response.attachments.first().url}`;

        // Show payment info to sender + confirm buttons
        const infoEmbed = embed(COLOR.white)
          .setTitle("📩 Payment Info Received")
          .addFields(
            { name: "Amount",       value: `₹${amount.toLocaleString()} INR`, inline: true },
            { name: "To",           value: target.username,                    inline: true },
            { name: "Payment Info", value: `\`\`\`${info.slice(0, 900)}\`\`\`` },
            { name: "Status",       value: "⏳ Confirm once you have paid" }
          )
          .setFooter({ text: `Payment ID #${payId} • Ceas Bot` });

        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`paid_${payId}`).setLabel("✅ I've Paid").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`reject_${payId}`).setLabel("❌ Reject").setStyle(ButtonStyle.Secondary)
        );

        await prompt.edit({ embeds: [infoEmbed], components: [confirmRow] });

        // Sender confirms payment
        const confirmCollector = prompt.createMessageComponentCollector({
          filter: (i) => (i.customId === `paid_${payId}` || i.customId === `reject_${payId}`) &&
                         (i.user.id === msg.author.id || i.member.permissions.has("ManageGuild")),
          componentType: ComponentType.Button,
          time: 600_000,
          max: 1,
        });

        confirmCollector.on("collect", async (i) => {
          if (i.customId === `paid_${payId}`) {
            addInr(msg.author.id, msg.guild.id, -amount);
            addInr(target.id,     msg.guild.id,  amount);
            closePayment(payId, "completed");
            await i.update({ embeds: [
              embed(COLOR.white)
                .setTitle("✅ Payment Complete")
                .setDescription(`**₹${amount.toLocaleString()} INR** transferred to **${target.username}**.`)
                .setFooter({ text: `Payment ID #${payId} • Confirmed by ${i.user.username}` })
            ], components: [] });
          } else {
            closePayment(payId, "rejected");
            await i.update({ embeds: [
              embed(COLOR.black)
                .setTitle("❌ Payment Rejected")
                .setDescription(`Payment of **₹${amount.toLocaleString()}** to **${target.username}** was rejected.`)
            ], components: [] });
          }
        });

        confirmCollector.on("end", (_, reason) => {
          if (reason === "time") prompt.edit({ components: [] }).catch(() => {});
        });
      });

      infoCollector.on("end", (_, reason) => {
        if (reason === "time") {
          closePayment(payId, "expired");
          prompt.edit({ embeds: [err("Payment request expired.")], components: [] }).catch(() => {});
        }
      });
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
  console.log(`✅ Ceas online as ${client.user.tag}`);
  client.user.setPresence({ status: "online", activities: [{ name: "C.help | Tracking everything", type: 3 }] });

  for (const guild of client.guilds.cache.values()) {
    try {
      const invites = await guild.invites.fetch();
      for (const inv of invites.values())
        cacheInvite(inv.code, guild.id, inv.inviter?.id ?? "unknown", inv.uses ?? 0);
    } catch { /* no perms */ }
  }
  console.log(`📨 Invite cache loaded for ${client.guilds.cache.size} server(s).`);
});

// ─── EVENT: messageCreate ────────────────────────────────────────
client.on("messageCreate", async (msg) => {
  if (msg.author.bot || !msg.guild) return;

  // Message reward tracking
  const u = getUser(msg.author.id, msg.guild.id);
  if (Date.now() - (u.last_msg_ts || 0) >= REWARDS.msgCooldownMs) {
    setMsgTs(msg.author.id, msg.guild.id, Date.now());
    const total = addMessages(msg.author.id, msg.guild.id);
    await checkMessageRewards(client, msg.author.id, msg.guild.id, total);
  }

  // Command handling
  if (!msg.content.startsWith(PREFIX)) return;
  const args        = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();
  const cmd         = CMD_MAP.get(commandName);
  if (!cmd) return;

  try { await cmd.run(msg, args); }
  catch (e) {
    console.error(`[CMD:${commandName}]`, e);
    msg.reply({ embeds: [err("Something went wrong.")] }).catch(() => {});
  }
});

// ─── EVENT: guildMemberAdd ───────────────────────────────────────
client.on("guildMemberAdd", async (member) => {
  try {
    const newInvites = await member.guild.invites.fetch();
    let used = null;
    for (const inv of newInvites.values()) {
      const cached = getCached(inv.code);
      if (cached && inv.uses > cached.uses) { used = inv; updateCached(inv.code, inv.uses); break; }
    }
    for (const inv of newInvites.values())
      cacheInvite(inv.code, member.guild.id, inv.inviter?.id ?? "unknown", inv.uses ?? 0);

    if (used?.inviter) {
      const inviterId = used.inviter.id;
      const total = addInvite(inviterId, member.guild.id);
      getUser(inviterId, member.guild.id);
      await checkInviteRewards(client, inviterId, member.guild.id, total);
    }
  } catch (e) { console.error("[INVITE_TRACK]", e.message); }
});

// ─── EVENT: voiceStateUpdate ─────────────────────────────────────
client.on("voiceStateUpdate", async (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;
  const uid = member.id, gid = member.guild.id;

  if (!oldState.channel && newState.channel) {
    startVc(uid, gid);
  } else if (oldState.channel && !newState.channel) {
    const mins = endVc(uid, gid);
    if (mins > 0) {
      getUser(uid, gid);
      const total = addVcMin(uid, gid, mins);
      await checkVcRewards(client, uid, gid, total);
    }
  }
});

// ─── LOGIN ───────────────────────────────────────────────────────
if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN missing! Copy .env.example → .env and fill in your token.");
  process.exit(1);
}
client.login(process.env.DISCORD_TOKEN);
