// ═══════════════════════════════════════════════════════════════
//  CEAS BOT  —  main.js  (v4)
//  Slash commands · Ticket system · UPI payments · Rewards
// ═══════════════════════════════════════════════════════════════

const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
  PermissionsBitField, ChannelType, REST, Routes,
  SlashCommandBuilder,
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
    channel_id TEXT PRIMARY KEY,
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    type       TEXT DEFAULT 'support',
    status     TEXT DEFAULT 'open',
    created_at INTEGER DEFAULT (strftime('%s','now'))
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
    guild_id        TEXT PRIMARY KEY,
    ticket_category TEXT
  );
`);

// ── DB helpers ────────────────────────────────────────────────────
const getUser   = (uid, gid) => { db.prepare("INSERT OR IGNORE INTO users (user_id, guild_id) VALUES (?,?)").run(uid, gid); return db.prepare("SELECT * FROM users WHERE user_id=? AND guild_id=?").get(uid, gid); };
const addOwo    = (uid, gid, n) => { getUser(uid, gid); db.prepare("UPDATE users SET owo=MAX(0,owo+?)  WHERE user_id=? AND guild_id=?").run(n, uid, gid); };
const addInr    = (uid, gid, n) => { getUser(uid, gid); db.prepare("UPDATE users SET inr=MAX(0,inr+?)  WHERE user_id=? AND guild_id=?").run(n, uid, gid); };
const setOwo    = (uid, gid, n) => { getUser(uid, gid); db.prepare("UPDATE users SET owo=MAX(0,?)       WHERE user_id=? AND guild_id=?").run(n, uid, gid); };
const setInr    = (uid, gid, n) => { getUser(uid, gid); db.prepare("UPDATE users SET inr=MAX(0,?)       WHERE user_id=? AND guild_id=?").run(n, uid, gid); };
const addMsg    = (uid, gid)    => { getUser(uid, gid); db.prepare("UPDATE users SET messages=messages+1 WHERE user_id=? AND guild_id=?").run(uid, gid); return db.prepare("SELECT messages FROM users WHERE user_id=? AND guild_id=?").get(uid, gid).messages; };
const addVcMin  = (uid, gid, m) => { getUser(uid, gid); db.prepare("UPDATE users SET vc_minutes=vc_minutes+? WHERE user_id=? AND guild_id=?").run(m, uid, gid); return db.prepare("SELECT vc_minutes FROM users WHERE user_id=? AND guild_id=?").get(uid, gid).vc_minutes; };
const addInvite = (uid, gid)    => { getUser(uid, gid); db.prepare("UPDATE users SET invites=invites+1 WHERE user_id=? AND guild_id=?").run(uid, gid); return db.prepare("SELECT invites FROM users WHERE user_id=? AND guild_id=?").get(uid, gid).invites; };
const setMsgTs  = (uid, gid, t) => db.prepare("UPDATE users SET last_msg_ts=? WHERE user_id=? AND guild_id=?").run(t, uid, gid);
const getMilestone  = (uid, gid, type, key) => db.prepare("SELECT count FROM milestones WHERE user_id=? AND guild_id=? AND type=? AND key=?").get(uid, gid, type, String(key))?.count ?? 0;
const setMilestone  = (uid, gid, type, key, n) => db.prepare("INSERT INTO milestones(user_id,guild_id,type,key,count) VALUES(?,?,?,?,?) ON CONFLICT(user_id,guild_id,type,key) DO UPDATE SET count=excluded.count").run(uid, gid, type, String(key), n);
const getTop        = (gid, col, n = 10) => db.prepare(`SELECT * FROM users WHERE guild_id=? ORDER BY ${col} DESC LIMIT ?`).all(gid, n);
const resetWeeklyDb = (gid) => { db.prepare("UPDATE users SET invites=0, owo=0 WHERE guild_id=?").run(gid); db.prepare("DELETE FROM milestones WHERE guild_id=? AND type=?").run(gid, "invite"); };

const cacheInvite  = (code, gid, inv, uses) => db.prepare("INSERT OR REPLACE INTO invite_cache VALUES (?,?,?,?)").run(code, gid, inv, uses);
const getCached    = (code)                  => db.prepare("SELECT * FROM invite_cache WHERE code=?").get(code);
const updateCached = (code, uses)            => db.prepare("UPDATE invite_cache SET uses=? WHERE code=?").run(uses, code);

const startVc = (uid, gid) => db.prepare("INSERT OR REPLACE INTO vc_sessions VALUES (?,?,?)").run(uid, gid, Date.now());
const endVc   = (uid, gid) => { const row = db.prepare("SELECT joined_at FROM vc_sessions WHERE user_id=? AND guild_id=?").get(uid, gid); db.prepare("DELETE FROM vc_sessions WHERE user_id=? AND guild_id=?").run(uid, gid); return row ? (Date.now() - row.joined_at) / 60000 : 0; };

const saveTicket    = (cid, gid, uid, type) => db.prepare("INSERT OR IGNORE INTO tickets(channel_id,guild_id,user_id,type) VALUES(?,?,?,?)").run(cid, gid, uid, type);
const closeTicketDb = (cid) => db.prepare("UPDATE tickets SET status='closed' WHERE channel_id=?").run(cid);
const getTicket     = (cid) => db.prepare("SELECT * FROM tickets WHERE channel_id=?").get(cid);

const createPayment = (sid, rid, gid, amt, cid) => db.prepare("INSERT INTO payments(sender_id,receiver_id,guild_id,amount,channel_id) VALUES(?,?,?,?,?)").run(sid, rid, gid, amt, cid).lastInsertRowid;
const closePayment  = (id, status) => db.prepare("UPDATE payments SET status=? WHERE id=?").run(status, id);

const getConfig = (gid) => db.prepare("SELECT * FROM guild_config WHERE guild_id=?").get(gid) ?? {};
const setConfig = (gid, key, val) => db.prepare(`INSERT INTO guild_config(guild_id,${key}) VALUES(?,?) ON CONFLICT(guild_id) DO UPDATE SET ${key}=excluded.${key}`).run(gid, val);

// ─── CONFIG ──────────────────────────────────────────────────────
const PREFIX   = "C.";
const COLOR    = { white: 0xFFFFFF, black: 0x000000 };
const OWNER_ID = process.env.OWNER_ID || "";

const REWARDS = {
  invite:  [
    { every: 1,  owo: 100_000   },
    { every: 3,  owo: 500_000   },
    { every: 5,  owo: 800_000   },
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
const okE  = (msg)   => mkE(COLOR.white).setDescription(`✅ ${msg}`);

const isOwner = (id)     => OWNER_ID && id === OWNER_ID;
const isAdmin = (member) => member?.permissions?.has(PermissionsBitField.Flags.ManageGuild) ?? false;
const isStaff = (member, uid) => isOwner(uid) || isAdmin(member);

// Safe interaction reply — never double-replies or crashes
async function safeReply(interaction, payload) {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ ...payload, ephemeral: true });
    } else {
      await interaction.reply({ ...payload, ephemeral: true });
    }
  } catch {}
}

async function safeUpdate(interaction, payload) {
  try {
    if (!interaction.replied && !interaction.deferred) await interaction.update(payload);
    else await interaction.editReply(payload);
  } catch {}
}

async function dmUser(uid, payload) {
  try { const u = await client.users.fetch(uid); await u.send(payload); } catch {}
}

// ─── REWARD CHECKERS ─────────────────────────────────────────────
async function checkInviteRewards(uid, gid, total) {
  try {
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
  } catch {}
}

async function checkMessageRewards(uid, gid, total) {
  try {
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
  } catch {}
}

async function checkVcRewards(uid, gid, totalMin) {
  try {
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
  } catch {}
}

// ─── TICKET ENGINE ────────────────────────────────────────────────
// Fixed: no role iteration — just deny @everyone, allow opener + bot + sender
async function openTicket(guild, opener, senderUser = null, type = "support") {
  const cfg  = getConfig(guild.id);
  const safe = opener.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "user";
  const slug = `ticket-${safe}-${Date.now().toString(36).slice(-4)}`;

  const VIEW_SEND = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.AttachFiles,
    PermissionsBitField.Flags.ReadMessageHistory,
  ];

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: opener.id,               allow: VIEW_SEND },
    { id: client.user.id,          allow: [...VIEW_SEND, PermissionsBitField.Flags.ManageChannels] },
  ];

  if (senderUser && senderUser.id !== opener.id) {
    overwrites.push({ id: senderUser.id, allow: VIEW_SEND });
  }

  const channel = await guild.channels.create({
    name: slug,
    type: ChannelType.GuildText,
    parent: cfg.ticket_category || null,
    permissionOverwrites: overwrites,
    topic: `${type} ticket | ${opener.tag}`,
  });

  saveTicket(channel.id, guild.id, opener.id, type);
  return channel;
}

function closeRow(channelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tclose_${channelId}`).setLabel("🔒 Close").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`tdelete_${channelId}`).setLabel("🗑 Delete").setStyle(ButtonStyle.Secondary),
  );
}

// ─── SHARED HANDLERS (called by both prefix & slash) ─────────────

async function handleBalance(reply, guild, targetUser) {
  if (targetUser.bot) return reply({ embeds: [errE("Bots have no balance.")] });
  const u = getUser(targetUser.id, guild.id);
  return reply({ embeds: [
    mkE(COLOR.white)
      .setTitle(`💼 ${targetUser.username}'s Wallet`)
      .setThumbnail(targetUser.displayAvatarURL())
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

async function handleInvites(reply, guild, targetUser) {
  const u = getUser(targetUser.id, guild.id);
  return reply({ embeds: [mkE(COLOR.white).setTitle(`📨 ${targetUser.username}'s Invites`).setThumbnail(targetUser.displayAvatarURL()).setDescription(`**${u.invites}** total invites`)] });
}

async function handleRewards(reply) {
  const invLines = REWARDS.invite.map(t => `• Every **${t.every} invite${t.every>1?"s":""}** → \`${fmt(t.owo)} OWO\` *(stackable)*`).join("\n");
  const msgLines = REWARDS.message.map(t => { let r = t.owo>0?`\`${fmt(t.owo)} OWO\``:""; if(t.boost>0) r+=` + 🔮 ${t.boost} Boost${t.boost>1?"s":""}`; if(t.nitro) r+=" + 🎮 Nitro"; return `• **${t.at.toLocaleString()} msgs** → ${r}`; }).join("\n");
  const vcLines  = REWARDS.vc.map(t => { let r = t.owo>0?`\`${fmt(t.owo)} OWO\``:""; if(t.boost>0) r+=` + 🔮 ${t.boost} Boost`; if(t.nitro) r+=" + 🎮 Nitro"; return `• **${t.hours}hr VC** → ${r}`; }).join("\n");
  return reply({ embeds: [mkE(COLOR.white).setTitle("🏆 Ceas Weekly Rewards")
    .addFields(
      { name: "📨 Invite Rewards *(stackable)*",      value: invLines },
      { name: "💬 Message Rewards *(one-time each)*", value: msgLines },
      { name: "🎙 VC Rewards *(one-time each)*",      value: vcLines  },
      { name: "📌 Note", value: "Boost & Nitro are given manually by admins. OWO is auto-credited!" }
    )] });
}

async function handleLeaderboard(reply, guild, client, type = "owo") {
  const colMap = { owo:"owo", inr:"inr", invites:"invites", messages:"messages", vc:"vc_minutes" };
  const col    = colMap[type] ?? "owo";
  const label  = { owo:"🐾 OWO", inr:"💵 INR", invites:"📨 Invites", messages:"💬 Messages", vc_minutes:"🎙 VC Time" }[col];
  const rows   = getTop(guild.id, col);
  if (!rows.length) return reply({ embeds: [mkE(COLOR.white).setDescription("No data yet!")] });
  const lines = await Promise.all(rows.map(async (row, i) => {
    let u; try { u = await client.users.fetch(row.user_id); } catch { u = { username: `User#${row.user_id.slice(-4)}` }; }
    const medal = ["🥇","🥈","🥉"][i] ?? `**${i+1}.**`;
    const val = col==="inr"?`₹${row.inr.toLocaleString()}`:col==="owo"?`${fmt(row.owo)} OWO`:col==="invites"?`${row.invites} inv`:col==="messages"?`${row.messages.toLocaleString()} msgs`:`${Math.floor(row.vc_minutes)} min`;
    return `${medal} **${u.username}** — ${val}`;
  }));
  return reply({ embeds: [mkE(COLOR.white).setTitle(`${label} Leaderboard — ${guild.name}`).setDescription(lines.join("\n"))] });
}

async function handleOwoTransfer(reply, guild, senderUser, targetUser, amount) {
  if (!targetUser || targetUser.bot)           return reply({ embeds: [errE("Mention a valid user.")] });
  if (targetUser.id === senderUser.id)         return reply({ embeds: [errE("Can't send to yourself.")] });
  if (isNaN(amount) || amount <= 0)            return reply({ embeds: [errE("Invalid amount.")] });
  const s = getUser(senderUser.id, guild.id);
  if (s.owo < amount)                          return reply({ embeds: [errE(`Not enough OWO. You have **${fmt(s.owo)} OWO**.`)] });
  addOwo(senderUser.id, guild.id, -amount);
  addOwo(targetUser.id, guild.id,  amount);
  return reply({ embeds: [mkE(COLOR.white).setTitle("🐾 OWO Sent!").setDescription(`**${senderUser.username}** → **${targetUser.username}**\n**${fmt(amount)} OWO** transferred!`)] });
}

async function handleInrPayment(replyFn, guild, senderUser, targetUser, amount) {
  if (!targetUser || targetUser.bot)           return replyFn({ embeds: [errE("Mention a valid user.")] });
  if (targetUser.id === senderUser.id)         return replyFn({ embeds: [errE("Can't pay yourself.")] });
  if (isNaN(amount) || amount <= 0)            return replyFn({ embeds: [errE("Invalid amount.")] });
  const s = getUser(senderUser.id, guild.id);
  if (s.inr < amount)                          return replyFn({ embeds: [errE(`Not enough INR. You have **₹${s.inr.toLocaleString()}**.`)] });

  let ticketChannel;
  try {
    ticketChannel = await openTicket(guild, targetUser, senderUser, "payment");
  } catch (e) {
    console.error("[TICKET]", e.message);
    return replyFn({ embeds: [errE("Could not create ticket. Bot needs **Manage Channels** permission.")] });
  }

  const payId = createPayment(senderUser.id, targetUser.id, guild.id, amount, ticketChannel.id);

  const requestEmbed = mkE(COLOR.white)
    .setTitle("💳 INR Payment Request")
    .setDescription(
      `${senderUser} wants to send **₹${amount.toLocaleString()} INR** to ${targetUser}.\n\n` +
      `**${targetUser.username}**, share your payment details:\n\n` +
      `> 📱 **UPI ID** — e.g. \`name@upi\`\n` +
      `> 🖼️ **QR Code** — send as image\n` +
      `> 🏦 **Bank Acc + IFSC**\n\n` +
      `_Payment ID: #${payId} · Waiting for details…_`
    );

  const ticketMsg = await ticketChannel.send({
    content: `${senderUser} ${targetUser}`,
    embeds: [requestEmbed],
    components: [closeRow(ticketChannel.id)],
  });

  await replyFn({ embeds: [okE(`Ticket opened → ${ticketChannel}`)] });

  // Collect receiver's payment info
  const infoCollector = ticketChannel.createMessageCollector({
    filter: (m) => m.author.id === targetUser.id && !m.author.bot,
    time: 600_000,
    max: 1,
  });

  infoCollector.on("collect", async (response) => {
    try {
      let info = response.content?.trim() || "";
      if (response.attachments.size > 0) info = `[QR Image] ${response.attachments.first().url}`;
      if (!info) info = "(no text provided)";

      const infoEmbed = mkE(COLOR.white)
        .setTitle("📩 Payment Details Received")
        .addFields(
          { name: "💵 Amount",    value: `₹${amount.toLocaleString()} INR`, inline: true },
          { name: "👤 Recipient", value: targetUser.username,               inline: true },
          { name: "📋 Details",   value: `\`\`\`${info.slice(0, 900)}\`\`\`` },
          { name: "⏳ Next Step", value: `**${senderUser.username}** — pay via UPI, then click **✅ I've Paid**.` }
        )
        .setFooter({ text: `Payment ID #${payId} • Ceas Bot` });

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`paid_${payId}`).setLabel("✅ I've Paid").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`reject_${payId}`).setLabel("❌ Reject").setStyle(ButtonStyle.Secondary),
      );

      await ticketMsg.edit({ embeds: [infoEmbed], components: [confirmRow] }).catch(() => {});

      const confirmCollector = ticketMsg.createMessageComponentCollector({
        filter: (i) => {
          const rightBtn = i.customId === `paid_${payId}` || i.customId === `reject_${payId}`;
          const auth     = i.user.id === senderUser.id || isAdmin(i.member);
          return rightBtn && auth;
        },
        componentType: ComponentType.Button,
        time: 1_800_000,
        max: 1,
      });

      confirmCollector.on("collect", async (i) => {
        try {
          if (i.customId === `paid_${payId}`) {
            addInr(senderUser.id, guild.id, -amount);
            addInr(targetUser.id, guild.id,  amount);
            closePayment(payId, "completed");
            const doneRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`tdelete_${ticketChannel.id}`).setLabel("🗑 Close & Delete Ticket").setStyle(ButtonStyle.Secondary),
            );
            await safeUpdate(i, { embeds: [mkE(COLOR.white).setTitle("✅ Payment Complete!").setDescription(`**₹${amount.toLocaleString()} INR** sent to **${targetUser.username}**!\n\nYou may now delete this ticket.`).setFooter({ text: `Payment ID #${payId} • Confirmed by ${i.user.username}` })], components: [doneRow] });
          } else {
            closePayment(payId, "rejected");
            await safeUpdate(i, { embeds: [mkE(COLOR.black).setTitle("❌ Payment Rejected").setDescription(`Payment of **₹${amount.toLocaleString()}** was rejected.\n\nThis ticket will close in 30 seconds.`)], components: [] });
            setTimeout(() => ticketChannel.delete().catch(() => {}), 30_000);
          }
        } catch (e) { console.error("[PAY_CONFIRM]", e.message); }
      });

      confirmCollector.on("end", (_, reason) => {
        if (reason === "time") {
          closePayment(payId, "expired");
          ticketChannel.send({ embeds: [errE("Payment timed out. Ticket closing in 30s.")] }).catch(() => {});
          setTimeout(() => ticketChannel.delete().catch(() => {}), 30_000);
        }
      });
    } catch (e) { console.error("[INFO_COLLECT]", e.message); }
  });

  infoCollector.on("end", (_, reason) => {
    if (reason === "time") {
      closePayment(payId, "expired");
      ticketChannel.send({ embeds: [errE("No info received. Ticket closing in 30s.")] }).catch(() => {});
      setTimeout(() => ticketChannel.delete().catch(() => {}), 30_000);
    }
  });
}

async function handleOpenTicket(replyFn, guild, openerUser, type = "support") {
  let ch;
  try { ch = await openTicket(guild, openerUser, null, type); }
  catch (e) { return replyFn({ embeds: [errE("Bot needs **Manage Channels** permission to create tickets.")] }); }

  await ch.send({
    content: `${openerUser}`,
    embeds: [mkE(COLOR.white).setTitle("🎫 Ticket Opened").setDescription(`Welcome **${openerUser.username}**!\n\nDescribe your issue and staff will help you shortly.`)],
    components: [closeRow(ch.id)],
  });
  return replyFn({ embeds: [okE(`Ticket opened → ${ch}`)] });
}

// ─── SLASH COMMAND DEFINITIONS ───────────────────────────────────
const SLASH_COMMANDS = [
  new SlashCommandBuilder().setName("balance").setDescription("Check your or someone's wallet").addUserOption(o => o.setName("user").setDescription("User to check")),
  new SlashCommandBuilder().setName("invites").setDescription("Check invite count").addUserOption(o => o.setName("user").setDescription("User to check")),
  new SlashCommandBuilder().setName("rewards").setDescription("View all reward rates"),
  new SlashCommandBuilder().setName("leaderboard").setDescription("Server leaderboard").addStringOption(o => o.setName("type").setDescription("Leaderboard type").addChoices({ name:"OWO",value:"owo" },{ name:"INR",value:"inr" },{ name:"Invites",value:"invites" },{ name:"Messages",value:"messages" },{ name:"VC Time",value:"vc" })),
  new SlashCommandBuilder().setName("owo").setDescription("Send OWO coins to someone").addIntegerOption(o => o.setName("amount").setDescription("Amount to send").setRequired(true).setMinValue(1)).addUserOption(o => o.setName("user").setDescription("Who to send to").setRequired(true)),
  new SlashCommandBuilder().setName("inr").setDescription("Send INR to someone via ticket (UPI flow)").addNumberOption(o => o.setName("amount").setDescription("Amount to send").setRequired(true).setMinValue(1)).addUserOption(o => o.setName("user").setDescription("Who to pay").setRequired(true)),
  new SlashCommandBuilder().setName("ticket").setDescription("Open a support ticket"),
  new SlashCommandBuilder().setName("ticketpanel").setDescription("Send ticket open panel in this channel (admin only)"),
  new SlashCommandBuilder().setName("setcategory").setDescription("Set ticket category (admin)").addStringOption(o => o.setName("category_id").setDescription("Category channel ID").setRequired(true)),
  new SlashCommandBuilder().setName("award").setDescription("Give OWO or INR to a user (admin)").addUserOption(o => o.setName("user").setDescription("User to award").setRequired(true)).addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true).setMinValue(1)).addStringOption(o => o.setName("currency").setDescription("Currency").setRequired(true).addChoices({ name:"OWO",value:"owo" },{ name:"INR",value:"inr" })),
  new SlashCommandBuilder().setName("removebal").setDescription("Remove OWO or INR from a user (admin)").addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true)).addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true).setMinValue(1)).addStringOption(o => o.setName("currency").setDescription("Currency").setRequired(true).addChoices({ name:"OWO",value:"owo" },{ name:"INR",value:"inr" })),
  new SlashCommandBuilder().setName("setbal").setDescription("Set exact balance for a user (admin)").addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true)).addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true).setMinValue(0)).addStringOption(o => o.setName("currency").setDescription("Currency").setRequired(true).addChoices({ name:"OWO",value:"owo" },{ name:"INR",value:"inr" })),
  new SlashCommandBuilder().setName("checkbal").setDescription("View full stats of any user (admin)").addUserOption(o => o.setName("user").setDescription("User to inspect").setRequired(true)),
  new SlashCommandBuilder().setName("resetweekly").setDescription("Reset all OWO & invites for this week (owner only)"),
  new SlashCommandBuilder().setName("ping").setDescription("Check bot latency"),
  new SlashCommandBuilder().setName("help").setDescription("Show all commands"),
].map(c => c.toJSON());

// ─── PREFIX COMMANDS ─────────────────────────────────────────────
const PREFIX_COMMANDS = {
  help: { aliases: ["h","commands"], async run(msg) {
    const staff = isStaff(msg.member, msg.author.id);
    const e = mkE(COLOR.white).setTitle("📖 Ceas Bot — Commands").setDescription(`Prefix: **${PREFIX}** | Also supports **/slash** commands`)
      .addFields(
        { name: "💰 Economy", value: "`C.balance` · `C.inr <amount> @user` · `C.owo <amount> @user` · `C.leaderboard` · `C.rewards` · `C.invites`" },
        { name: "🎫 Tickets", value: "`C.ticket` · `C.ticketpanel` · `C.setcategory <id>`" },
        { name: "ℹ️ General", value: "`C.ping` · `C.help`" },
      );
    if (staff) e.addFields({ name: "🛡 Admin", value: "`C.award @user <amt> <owo|inr>` · `C.removebal` · `C.setbal` · `C.checkbal` · `C.resetweekly`" });
    msg.reply({ embeds: [e] });
  }},
  ping: { aliases: [], async run(msg) {
    const s = await msg.reply({ embeds: [mkE(COLOR.white).setDescription("🏓 Pinging...")] });
    s.edit({ embeds: [mkE(COLOR.white).setTitle("🏓 Pong!").addFields({ name:"Bot",value:`${s.createdTimestamp-msg.createdTimestamp}ms`,inline:true },{ name:"API",value:`${Math.round(msg.client.ws.ping)}ms`,inline:true })] });
  }},
  balance:     { aliases: ["bal","wallet","w"],      async run(msg) { await handleBalance(p => msg.reply(p), msg.guild, msg.mentions.users.first()||msg.author); }},
  invites:     { aliases: ["inv"],                   async run(msg) { await handleInvites(p => msg.reply(p), msg.guild, msg.mentions.users.first()||msg.author); }},
  rewards:     { aliases: ["rl","rewardlist"],       async run(msg) { await handleRewards(p => msg.reply(p)); }},
  leaderboard: { aliases: ["lb","top","rank"],       async run(msg,a) { await handleLeaderboard(p => msg.reply(p), msg.guild, msg.client, a[0]||"owo"); }},
  owo:         { aliases: ["sendowo","giveowo"],     async run(msg,a) { await handleOwoTransfer(p => msg.reply(p), msg.guild, msg.author, msg.mentions.users.first(), parseFloat(a[0])); }},
  inr:         { aliases: ["pay","send","transfer"], async run(msg,a) { await handleInrPayment(p => msg.reply(p), msg.guild, msg.author, msg.mentions.users.first(), parseFloat(a[0])); }},
  ticket:      { aliases: ["newticket","open"],      async run(msg) { await handleOpenTicket(p => msg.reply(p), msg.guild, msg.author); }},
  ticketpanel: { aliases: ["panel","tpanel"],        async run(msg) {
    if (!isStaff(msg.member, msg.author.id)) return msg.reply({ embeds: [errE("Admins only.")] });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("panel_support").setLabel("🎫 Open Ticket").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel_payment").setLabel("💳 Payment Help").setStyle(ButtonStyle.Secondary),
    );
    await msg.channel.send({ embeds: [mkE(COLOR.white).setTitle("🎫 Tickets").setDescription("**🎫 Open Ticket** — General support\n**💳 Payment Help** — INR payment assistance\n\n*Click a button below.*")], components: [row] });
    msg.delete().catch(() => {});
  }},
  setcategory: { aliases: ["ticketcat","setcat"], async run(msg,a) {
    if (!isStaff(msg.member, msg.author.id)) return msg.reply({ embeds: [errE("Admins only.")] });
    const cat = msg.guild.channels.cache.get(a[0]);
    if (!cat || cat.type !== ChannelType.GuildCategory) return msg.reply({ embeds: [errE("Invalid category ID.")] });
    setConfig(msg.guild.id, "ticket_category", a[0]);
    msg.reply({ embeds: [okE(`Ticket category set to **${cat.name}**.`)] });
  }},
  award: { aliases: ["addbal","addowo"], async run(msg,a) {
    if (!isStaff(msg.member, msg.author.id)) return msg.reply({ embeds: [errE("Admins only.")] });
    const target = msg.mentions.users.first(), amount = parseFloat(a[1]), cur = (a[2]||"owo").toLowerCase();
    if (!target||isNaN(amount)||amount<=0||!["owo","inr"].includes(cur)) return msg.reply({ embeds: [errE("Usage: `C.award @user <amount> <owo|inr>`")] });
    cur==="owo" ? addOwo(target.id, msg.guild.id, amount) : addInr(target.id, msg.guild.id, amount);
    msg.reply({ embeds: [okE(`Added **${cur==="owo"?fmt(amount)+" OWO":"₹"+amount}** to **${target.username}**.`)] });
  }},
  removebal: { aliases: ["deduct","rmbal"], async run(msg,a) {
    if (!isStaff(msg.member, msg.author.id)) return msg.reply({ embeds: [errE("Admins only.")] });
    const target = msg.mentions.users.first(), amount = parseFloat(a[1]), cur = (a[2]||"owo").toLowerCase();
    if (!target||isNaN(amount)||!["owo","inr"].includes(cur)) return msg.reply({ embeds: [errE("Usage: `C.removebal @user <amount> <owo|inr>`")] });
    cur==="owo" ? addOwo(target.id, msg.guild.id, -amount) : addInr(target.id, msg.guild.id, -amount);
    msg.reply({ embeds: [okE(`Removed **${cur==="owo"?fmt(amount)+" OWO":"₹"+amount}** from **${target.username}**.`)] });
  }},
  setbal: { aliases: ["setbalance","setowo"], async run(msg,a) {
    if (!isStaff(msg.member, msg.author.id)) return msg.reply({ embeds: [errE("Admins only.")] });
    const target = msg.mentions.users.first(), amount = parseFloat(a[1]), cur = (a[2]||"owo").toLowerCase();
    if (!target||isNaN(amount)||!["owo","inr"].includes(cur)) return msg.reply({ embeds: [errE("Usage: `C.setbal @user <amount> <owo|inr>`")] });
    cur==="owo" ? setOwo(target.id, msg.guild.id, amount) : setInr(target.id, msg.guild.id, amount);
    msg.reply({ embeds: [okE(`Set **${target.username}**'s ${cur.toUpperCase()} to **${cur==="owo"?fmt(amount)+" OWO":"₹"+amount}**.`)] });
  }},
  checkbal: { aliases: ["adminbal","uinfo"], async run(msg) {
    if (!isStaff(msg.member, msg.author.id)) return msg.reply({ embeds: [errE("Admins only.")] });
    const target = msg.mentions.users.first();
    if (!target) return msg.reply({ embeds: [errE("Mention a user.")] });
    const u = getUser(target.id, msg.guild.id);
    msg.reply({ embeds: [mkE(COLOR.white).setTitle(`🔍 ${target.username} — Admin View`).setThumbnail(target.displayAvatarURL()).addFields({ name:"🐾 OWO",value:fmt(u.owo),inline:true },{ name:"💵 INR",value:`₹${u.inr.toLocaleString()}`,inline:true },{ name:"📨 Invites",value:String(u.invites),inline:true },{ name:"💬 Messages",value:u.messages.toLocaleString(),inline:true },{ name:"🎙 VC",value:`${Math.floor(u.vc_minutes)} min`,inline:true },{ name:"ID",value:`\`${target.id}\`` })] });
  }},
  resetweekly: { aliases: ["weekly","weekreset"], async run(msg) {
    if (!isOwner(msg.author.id)) return msg.reply({ embeds: [errE("Owner only.")] });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("confirm_weekly").setLabel("✅ Yes, Reset").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("cancel_weekly").setLabel("❌ Cancel").setStyle(ButtonStyle.Secondary),
    );
    const prompt = await msg.reply({ embeds: [mkE(COLOR.black).setTitle("⚠️ Weekly Reset").setDescription("This resets **all OWO & invite counts** for this server. Cannot be undone!")], components: [row] });
    const i = await prompt.awaitMessageComponent({ filter: i => i.user.id === msg.author.id, componentType: ComponentType.Button, time: 30_000 }).catch(() => null);
    if (!i || i.customId === "cancel_weekly") return prompt.edit({ embeds: [okE("Cancelled.")], components: [] });
    resetWeeklyDb(msg.guild.id);
    i.update({ embeds: [mkE(COLOR.white).setTitle("✅ Weekly Reset Done").setDescription("All OWO & invites reset! New week started 🎉")], components: [] });
  }},
};

const CMD_MAP = new Map();
for (const [name, cmd] of Object.entries(PREFIX_COMMANDS)) {
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
  client.user.setPresence({ status: "online", activities: [{ name: "/help | C.help", type: 3 }] });

  // Register slash commands
  try {
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: SLASH_COMMANDS });
    console.log(`✅ Slash commands registered (${SLASH_COMMANDS.length} commands)`);
  } catch (e) {
    console.error("❌ Slash command registration failed:", e.message);
  }

  // Cache invites
  for (const guild of client.guilds.cache.values()) {
    try {
      const invs = await guild.invites.fetch();
      for (const inv of invs.values()) cacheInvite(inv.code, guild.id, inv.inviter?.id ?? "unknown", inv.uses ?? 0);
    } catch {}
  }
  console.log(`📨 Invite cache loaded for ${client.guilds.cache.size} server(s).`);
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
  } catch (e) { console.error("[messageCreate]", e.message); }
});

// ─── EVENT: interactionCreate ────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  try {
    const { guild, member, user } = interaction;

    // ── SLASH COMMANDS ────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const reply = (p) => interaction.reply({ ...p, ephemeral: false });
      const replyEph = (p) => interaction.reply({ ...p, ephemeral: true });
      const name = interaction.commandName;

      if (name === "help") {
        const staff = isStaff(member, user.id);
        const e = mkE(COLOR.white).setTitle("📖 Ceas Bot — Commands").setDescription("Use **/command** or prefix **C.**")
          .addFields(
            { name:"💰 Economy", value:"`/balance` `/invites` `/rewards` `/leaderboard` `/owo` `/inr`" },
            { name:"🎫 Tickets", value:"`/ticket` `/ticketpanel` `/setcategory`" },
            { name:"ℹ️ General", value:"`/ping` `/help`" },
          );
        if (staff) e.addFields({ name:"🛡 Admin", value:"`/award` `/removebal` `/setbal` `/checkbal` `/resetweekly`" });
        return reply({ embeds: [e] });
      }

      if (name === "ping") {
        const start = Date.now();
        await interaction.reply({ embeds: [mkE(COLOR.white).setDescription("🏓 Pinging...")] });
        return interaction.editReply({ embeds: [mkE(COLOR.white).setTitle("🏓 Pong!").addFields({ name:"Bot",value:`${Date.now()-start}ms`,inline:true },{ name:"API",value:`${Math.round(client.ws.ping)}ms`,inline:true })] });
      }

      if (name === "balance") { const target = interaction.options.getUser("user") || user; return handleBalance(reply, guild, target); }
      if (name === "invites") { const target = interaction.options.getUser("user") || user; return handleInvites(reply, guild, target); }
      if (name === "rewards") { return handleRewards(reply); }
      if (name === "leaderboard") { return handleLeaderboard(reply, guild, client, interaction.options.getString("type") || "owo"); }
      if (name === "owo") { return handleOwoTransfer(reply, guild, user, interaction.options.getUser("user"), interaction.options.getInteger("amount")); }
      if (name === "inr") { await interaction.deferReply(); return handleInrPayment(p => interaction.editReply(p), guild, user, interaction.options.getUser("user"), interaction.options.getNumber("amount")); }
      if (name === "ticket") { await interaction.deferReply({ ephemeral: true }); return handleOpenTicket(p => interaction.editReply(p), guild, user); }

      if (name === "ticketpanel") {
        if (!isStaff(member, user.id)) return replyEph({ embeds: [errE("Admins only.")] });
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("panel_support").setLabel("🎫 Open Ticket").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("panel_payment").setLabel("💳 Payment Help").setStyle(ButtonStyle.Secondary),
        );
        await interaction.channel.send({ embeds: [mkE(COLOR.white).setTitle("🎫 Tickets").setDescription("**🎫 Open Ticket** — General support\n**💳 Payment Help** — INR payment assistance\n\n*Click a button below.*")], components: [row] });
        return replyEph({ embeds: [okE("Panel sent!")] });
      }

      if (name === "setcategory") {
        if (!isStaff(member, user.id)) return replyEph({ embeds: [errE("Admins only.")] });
        const catId = interaction.options.getString("category_id");
        const cat   = guild.channels.cache.get(catId);
        if (!cat || cat.type !== ChannelType.GuildCategory) return replyEph({ embeds: [errE("Invalid category ID.")] });
        setConfig(guild.id, "ticket_category", catId);
        return replyEph({ embeds: [okE(`Ticket category set to **${cat.name}**.`)] });
      }

      if (name === "award") {
        if (!isStaff(member, user.id)) return replyEph({ embeds: [errE("Admins only.")] });
        const target = interaction.options.getUser("user"), amount = interaction.options.getInteger("amount"), cur = interaction.options.getString("currency");
        cur==="owo" ? addOwo(target.id, guild.id, amount) : addInr(target.id, guild.id, amount);
        return reply({ embeds: [okE(`Added **${cur==="owo"?fmt(amount)+" OWO":"₹"+amount}** to **${target.username}**.`)] });
      }

      if (name === "removebal") {
        if (!isStaff(member, user.id)) return replyEph({ embeds: [errE("Admins only.")] });
        const target = interaction.options.getUser("user"), amount = interaction.options.getInteger("amount"), cur = interaction.options.getString("currency");
        cur==="owo" ? addOwo(target.id, guild.id, -amount) : addInr(target.id, guild.id, -amount);
        return replyEph({ embeds: [okE(`Removed **${cur==="owo"?fmt(amount)+" OWO":"₹"+amount}** from **${target.username}**.`)] });
      }

      if (name === "setbal") {
        if (!isStaff(member, user.id)) return replyEph({ embeds: [errE("Admins only.")] });
        const target = interaction.options.getUser("user"), amount = interaction.options.getInteger("amount"), cur = interaction.options.getString("currency");
        cur==="owo" ? setOwo(target.id, guild.id, amount) : setInr(target.id, guild.id, amount);
        return replyEph({ embeds: [okE(`Set **${target.username}**'s ${cur.toUpperCase()} to **${cur==="owo"?fmt(amount)+" OWO":"₹"+amount}**.`)] });
      }

      if (name === "checkbal") {
        if (!isStaff(member, user.id)) return replyEph({ embeds: [errE("Admins only.")] });
        const target = interaction.options.getUser("user");
        const u2 = getUser(target.id, guild.id);
        return replyEph({ embeds: [mkE(COLOR.white).setTitle(`🔍 ${target.username}`).setThumbnail(target.displayAvatarURL()).addFields({ name:"🐾 OWO",value:fmt(u2.owo),inline:true },{ name:"💵 INR",value:`₹${u2.inr.toLocaleString()}`,inline:true },{ name:"📨 Invites",value:String(u2.invites),inline:true },{ name:"💬 Messages",value:u2.messages.toLocaleString(),inline:true },{ name:"🎙 VC",value:`${Math.floor(u2.vc_minutes)} min`,inline:true },{ name:"ID",value:`\`${target.id}\`` })] });
      }

      if (name === "resetweekly") {
        if (!isOwner(user.id)) return replyEph({ embeds: [errE("Owner only.")] });
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("confirm_weekly").setLabel("✅ Yes, Reset").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("cancel_weekly").setLabel("❌ Cancel").setStyle(ButtonStyle.Secondary),
        );
        return replyEph({ embeds: [mkE(COLOR.black).setTitle("⚠️ Weekly Reset").setDescription("Reset all OWO & invites? Cannot be undone!")], components: [row] });
      }

      return;
    }

    // ── BUTTON INTERACTIONS ───────────────────────────────────
    if (!interaction.isButton()) return;
    const { customId } = interaction;

    // Panel buttons — open ticket
    if (customId === "panel_support" || customId === "panel_payment") {
      const type = customId === "panel_payment" ? "payment" : "support";
      await interaction.deferReply({ ephemeral: true });
      await handleOpenTicket(p => interaction.editReply(p), guild, user, type);
      return;
    }

    // Weekly reset confirm/cancel
    if (customId === "confirm_weekly") {
      if (!isOwner(user.id)) return safeReply(interaction, { embeds: [errE("Owner only.")] });
      resetWeeklyDb(guild.id);
      return safeUpdate(interaction, { embeds: [mkE(COLOR.white).setTitle("✅ Weekly Reset Done").setDescription("All OWO & invites reset! 🎉")], components: [] });
    }
    if (customId === "cancel_weekly") {
      return safeUpdate(interaction, { embeds: [okE("Cancelled.")], components: [] });
    }

    // Close ticket
    if (customId.startsWith("tclose_")) {
      const cid    = customId.replace("tclose_", "");
      const ticket = getTicket(cid);
      if (!ticket) return safeReply(interaction, { embeds: [errE("Ticket not found.")], ephemeral: true });
      if (!isStaff(member, user.id) && user.id !== ticket.user_id)
        return safeReply(interaction, { embeds: [errE("Only the ticket owner or admins can close this.")], ephemeral: true });
      closeTicketDb(cid);
      const ch = guild.channels.cache.get(cid);
      if (ch) {
        try { await ch.permissionOverwrites.edit(ticket.user_id, { SendMessages: false }); } catch {}
      }
      const delRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tdelete_${cid}`).setLabel("🗑 Delete Ticket").setStyle(ButtonStyle.Secondary),
      );
      return safeUpdate(interaction, { embeds: [mkE(COLOR.black).setTitle("🔒 Ticket Closed").setDescription(`Closed by **${user.username}**. Click Delete to remove.`)], components: [delRow] });
    }

    // Delete ticket
    if (customId.startsWith("tdelete_")) {
      if (!isStaff(member, user.id)) return safeReply(interaction, { embeds: [errE("Admins only.")], ephemeral: true });
      const cid = customId.replace("tdelete_", "");
      const ch  = guild.channels.cache.get(cid);
      await safeReply(interaction, { content: "Deleting in 3 seconds...", ephemeral: true });
      setTimeout(() => ch?.delete().catch(() => {}), 3000);
      return;
    }

  } catch (e) { console.error("[interactionCreate]", e.message); }
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
  console.error("❌  DISCORD_TOKEN missing! Copy .env.example → .env and fill in your token.");
  process.exit(1);
}
client.login(process.env.DISCORD_TOKEN);
