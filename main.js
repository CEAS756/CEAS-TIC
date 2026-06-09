require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder,
  ComponentType,
} = require("discord.js");

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

// ──────────────────────────────────────────────
// CRASH PROTECTION
// ──────────────────────────────────────────────
process.on("unhandledRejection", (err) => {
  console.error("[UNHANDLED REJECTION]", err?.message || err);
});
process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION]", err?.message || err);
});

// ──────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────
const TOKEN    = process.env.DISCORD_TOKEN;
const OWNER_ID = process.env.OWNER_ID || "";
const PREFIX   = "C.";
const WHITE    = 0xFFFFFF;
const BLACK    = 0x000000;

if (!TOKEN) {
  console.error("ERROR: DISCORD_TOKEN is missing in .env");
  process.exit(1);
}

// ──────────────────────────────────────────────
// DATABASE
// ──────────────────────────────────────────────
const DATA = path.join(__dirname, "data");
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA);

const db = new Database(path.join(DATA, "ceas.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT,
    guild      TEXT,
    owo        INTEGER DEFAULT 0,
    inr        REAL DEFAULT 0,
    msgs       INTEGER DEFAULT 0,
    vc_min     REAL DEFAULT 0,
    invites    INTEGER DEFAULT 0,
    last_msg   INTEGER DEFAULT 0,
    PRIMARY KEY (id, guild)
  );
  CREATE TABLE IF NOT EXISTS milestones (
    id    TEXT,
    guild TEXT,
    type  TEXT,
    key   TEXT,
    done  INTEGER DEFAULT 0,
    PRIMARY KEY (id, guild, type, key)
  );
  CREATE TABLE IF NOT EXISTS vc_join (
    id    TEXT,
    guild TEXT,
    ts    INTEGER,
    PRIMARY KEY (id, guild)
  );
  CREATE TABLE IF NOT EXISTS invite_cache (
    code    TEXT PRIMARY KEY,
    guild   TEXT,
    inviter TEXT,
    uses    INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS tickets (
    channel TEXT PRIMARY KEY,
    guild   TEXT,
    owner   TEXT,
    type    TEXT DEFAULT 'support',
    open    INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS config (
    guild    TEXT PRIMARY KEY,
    tick_cat TEXT
  );
`);

// ──────────────────────────────────────────────
// DB HELPERS
// ──────────────────────────────────────────────
function getUser(id, guild) {
  db.prepare("INSERT OR IGNORE INTO users (id, guild) VALUES (?, ?)").run(id, guild);
  return db.prepare("SELECT * FROM users WHERE id = ? AND guild = ?").get(id, guild);
}

function addOwo(id, guild, n) {
  getUser(id, guild);
  db.prepare("UPDATE users SET owo = MAX(0, owo + ?) WHERE id = ? AND guild = ?").run(n, id, guild);
}

function setOwo(id, guild, n) {
  getUser(id, guild);
  db.prepare("UPDATE users SET owo = MAX(0, ?) WHERE id = ? AND guild = ?").run(n, id, guild);
}

function addInr(id, guild, n) {
  getUser(id, guild);
  db.prepare("UPDATE users SET inr = MAX(0, inr + ?) WHERE id = ? AND guild = ?").run(n, id, guild);
}

function setInr(id, guild, n) {
  getUser(id, guild);
  db.prepare("UPDATE users SET inr = MAX(0, ?) WHERE id = ? AND guild = ?").run(n, id, guild);
}

function addMsg(id, guild) {
  getUser(id, guild);
  db.prepare("UPDATE users SET msgs = msgs + 1 WHERE id = ? AND guild = ?").run(id, guild);
  return db.prepare("SELECT msgs FROM users WHERE id = ? AND guild = ?").get(id, guild).msgs;
}

function addVc(id, guild, min) {
  getUser(id, guild);
  db.prepare("UPDATE users SET vc_min = vc_min + ? WHERE id = ? AND guild = ?").run(min, id, guild);
  return db.prepare("SELECT vc_min FROM users WHERE id = ? AND guild = ?").get(id, guild).vc_min;
}

function addInvite(id, guild) {
  getUser(id, guild);
  db.prepare("UPDATE users SET invites = invites + 1 WHERE id = ? AND guild = ?").run(id, guild);
  return db.prepare("SELECT invites FROM users WHERE id = ? AND guild = ?").get(id, guild).invites;
}

function setLastMsg(id, guild, ts) {
  db.prepare("UPDATE users SET last_msg = ? WHERE id = ? AND guild = ?").run(ts, id, guild);
}

function getMilestone(id, guild, type, key) {
  return db.prepare("SELECT done FROM milestones WHERE id=? AND guild=? AND type=? AND key=?").get(id, guild, type, String(key))?.done ?? 0;
}

function setMilestone(id, guild, type, key, val) {
  db.prepare("INSERT INTO milestones (id,guild,type,key,done) VALUES (?,?,?,?,?) ON CONFLICT(id,guild,type,key) DO UPDATE SET done=excluded.done")
    .run(id, guild, type, String(key), val);
}

function getTop(guild, col, n = 10) {
  return db.prepare(`SELECT * FROM users WHERE guild = ? ORDER BY ${col} DESC LIMIT ?`).all(guild, n);
}

function getCfg(guild) {
  return db.prepare("SELECT * FROM config WHERE guild = ?").get(guild) ?? {};
}

function setCfg(guild, key, val) {
  db.prepare(`INSERT INTO config (guild, ${key}) VALUES (?, ?) ON CONFLICT(guild) DO UPDATE SET ${key} = excluded.${key}`)
    .run(guild, val);
}

function saveTicket(channel, guild, owner, type) {
  db.prepare("INSERT OR IGNORE INTO tickets (channel, guild, owner, type) VALUES (?,?,?,?)").run(channel, guild, owner, type);
}

function closeTicketDb(channel) {
  db.prepare("UPDATE tickets SET open = 0 WHERE channel = ?").run(channel);
}

function getTicket(channel) {
  return db.prepare("SELECT * FROM tickets WHERE channel = ?").get(channel);
}

function resetWeekly(guild) {
  db.prepare("UPDATE users SET owo = 0, invites = 0 WHERE guild = ?").run(guild);
  db.prepare("DELETE FROM milestones WHERE guild = ? AND type = 'invite'").run(guild);
}

// Invite cache
function cacheInv(code, guild, inviter, uses) {
  db.prepare("INSERT OR REPLACE INTO invite_cache VALUES (?,?,?,?)").run(code, guild, inviter, uses);
}
function getCached(code) {
  return db.prepare("SELECT * FROM invite_cache WHERE code = ?").get(code);
}
function updateCached(code, uses) {
  db.prepare("UPDATE invite_cache SET uses = ? WHERE code = ?").run(uses, code);
}

// VC sessions
function startVc(id, guild) {
  db.prepare("INSERT OR REPLACE INTO vc_join VALUES (?,?,?)").run(id, guild, Date.now());
}
function endVc(id, guild) {
  const row = db.prepare("SELECT ts FROM vc_join WHERE id = ? AND guild = ?").get(id, guild);
  db.prepare("DELETE FROM vc_join WHERE id = ? AND guild = ?").run(id, guild);
  return row ? (Date.now() - row.ts) / 60000 : 0;
}

// ──────────────────────────────────────────────
// REWARDS CONFIG
// ──────────────────────────────────────────────
const INVITE_TIERS = [
  { every: 1,  owo: 100000  },
  { every: 3,  owo: 500000  },
  { every: 5,  owo: 800000  },
  { every: 10, owo: 1000000 },
];

const MSG_TIERS = [
  { at: 100,   owo: 10000,  extra: null },
  { at: 500,   owo: 50000,  extra: null },
  { at: 1000,  owo: 100000, extra: null },
  { at: 10000, owo: 0,      extra: "2 Server Boosts 🔮" },
];

const VC_TIERS = [
  { hours: 5,   owo: 100000, extra: null },
  { hours: 10,  owo: 250000, extra: null },
  { hours: 50,  owo: 0,      extra: "1 Server Boost 🔮" },
  { hours: 100, owo: 0,      extra: "Nitro 🎮" },
];

const MSG_COOLDOWN = 3000;

// ──────────────────────────────────────────────
// EMBED BUILDERS
// ──────────────────────────────────────────────
function embed(color) {
  return new EmbedBuilder().setColor(color).setFooter({ text: "Ceas Bot" }).setTimestamp();
}

function errEmbed(text) {
  return embed(BLACK).setDescription("❌ " + text);
}

function okEmbed(text) {
  return embed(WHITE).setDescription("✅ " + text);
}

function fmtNum(n) {
  n = Math.floor(n);
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000)    return (n / 1000).toFixed(1) + "K";
  return String(n);
}

// ──────────────────────────────────────────────
// PERMISSION CHECKS
// ──────────────────────────────────────────────
function isOwner(id) {
  return OWNER_ID !== "" && id === OWNER_ID;
}

function isAdmin(member) {
  if (!member) return false;
  return member.permissions.has(PermissionsBitField.Flags.ManageGuild);
}

function isStaff(member, id) {
  return isOwner(id) || isAdmin(member);
}

// ──────────────────────────────────────────────
// SAFE INTERACTION REPLY
// ──────────────────────────────────────────────
async function safeReply(interaction, payload) {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ ...payload, ephemeral: true });
    } else {
      await interaction.reply({ ...payload, ephemeral: true });
    }
  } catch (_) {}
}

async function safeUpdate(interaction, payload) {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(payload);
    } else {
      await interaction.update(payload);
    }
  } catch (_) {}
}

// ──────────────────────────────────────────────
// DM USER
// ──────────────────────────────────────────────
async function dmUser(client, userId, payload) {
  try {
    const u = await client.users.fetch(userId);
    await u.send(payload);
  } catch (_) {}
}

// ──────────────────────────────────────────────
// REWARD CHECKERS
// ──────────────────────────────────────────────
async function checkInviteRewards(client, userId, guild, total) {
  for (const tier of INVITE_TIERS) {
    const reached = Math.floor(total / tier.every);
    const claimed = getMilestone(userId, guild, "invite", tier.every);
    if (reached > claimed) {
      const times = reached - claimed;
      setMilestone(userId, guild, "invite", tier.every, reached);
      addOwo(userId, guild, tier.owo * times);
      await dmUser(client, userId, {
        embeds: [
          embed(WHITE)
            .setTitle("🎉 Invite Reward!")
            .setDescription(
              `You hit **${tier.every} invite(s)** × ${times}!\n` +
              `**+${fmtNum(tier.owo * times)} OWO** added to your wallet!`
            ),
        ],
      });
    }
  }
}

async function checkMsgRewards(client, userId, guild, total) {
  for (const tier of MSG_TIERS) {
    if (total < tier.at) continue;
    if (getMilestone(userId, guild, "msg", tier.at) > 0) continue;
    setMilestone(userId, guild, "msg", tier.at, 1);
    if (tier.owo > 0) addOwo(userId, guild, tier.owo);
    const lines = [`You sent **${tier.at.toLocaleString()} messages**!`];
    if (tier.owo > 0)   lines.push(`**+${fmtNum(tier.owo)} OWO** added!`);
    if (tier.extra)     lines.push(`**${tier.extra}** — claim from an admin!`);
    await dmUser(client, userId, {
      embeds: [embed(WHITE).setTitle("💬 Message Milestone!").setDescription(lines.join("\n"))],
    });
  }
}

async function checkVcRewards(client, userId, guild, totalMin) {
  const hrs = totalMin / 60;
  for (const tier of VC_TIERS) {
    if (hrs < tier.hours) continue;
    if (getMilestone(userId, guild, "vc", tier.hours) > 0) continue;
    setMilestone(userId, guild, "vc", tier.hours, 1);
    if (tier.owo > 0) addOwo(userId, guild, tier.owo);
    const lines = [`You spent **${tier.hours} hours** in voice chat!`];
    if (tier.owo > 0)  lines.push(`**+${fmtNum(tier.owo)} OWO** added!`);
    if (tier.extra)    lines.push(`**${tier.extra}** — claim from an admin!`);
    await dmUser(client, userId, {
      embeds: [embed(WHITE).setTitle("🎙️ VC Milestone!").setDescription(lines.join("\n"))],
    });
  }
}

// ──────────────────────────────────────────────
// TICKET SYSTEM
// ──────────────────────────────────────────────

// Creates a private ticket channel
// opener = the main user (receiver for payments, opener for support)
// extra  = optional second user (payment sender)
async function createTicket(guild, botId, opener, extra, type) {
  const cfg  = getCfg(guild.id);
  const name = "ticket-" + opener.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) + "-" + Date.now().toString(36).slice(-4);

  const VIEW = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.AttachFiles,
    PermissionsBitField.Flags.ReadMessageHistory,
  ];

  const perms = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: opener.id,               allow: VIEW },
    { id: botId,                   allow: [...VIEW, PermissionsBitField.Flags.ManageChannels] },
  ];

  if (extra && extra.id !== opener.id) {
    perms.push({ id: extra.id, allow: VIEW });
  }

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: cfg.tick_cat || null,
    permissionOverwrites: perms,
  });

  saveTicket(channel.id, guild.id, opener.id, type);
  return channel;
}

function ticketButtons(channelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("tclose_" + channelId)
      .setLabel("🔒 Close Ticket")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("tdelete_" + channelId)
      .setLabel("🗑️ Delete")
      .setStyle(ButtonStyle.Secondary)
  );
}

// ──────────────────────────────────────────────
// SLASH COMMAND DEFINITIONS
// ──────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Check your wallet or someone else's")
    .addUserOption(o => o.setName("user").setDescription("User to check")),

  new SlashCommandBuilder()
    .setName("invites")
    .setDescription("Check invite count")
    .addUserOption(o => o.setName("user").setDescription("User to check")),

  new SlashCommandBuilder()
    .setName("rewards")
    .setDescription("View all reward rates"),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View server leaderboard")
    .addStringOption(o =>
      o.setName("type")
       .setDescription("What to rank")
       .addChoices(
         { name: "OWO",      value: "owo"     },
         { name: "INR",      value: "inr"     },
         { name: "Invites",  value: "invites" },
         { name: "Messages", value: "msgs"    },
         { name: "VC Time",  value: "vc_min"  }
       )
    ),

  new SlashCommandBuilder()
    .setName("owo")
    .setDescription("Send OWO to someone")
    .addIntegerOption(o => o.setName("amount").setDescription("How much").setRequired(true).setMinValue(1))
    .addUserOption(o => o.setName("user").setDescription("Who to send to").setRequired(true)),

  new SlashCommandBuilder()
    .setName("inr")
    .setDescription("Pay INR to someone (opens a ticket for UPI details)")
    .addNumberOption(o => o.setName("amount").setDescription("Amount in INR").setRequired(true).setMinValue(1))
    .addUserOption(o => o.setName("user").setDescription("Who to pay").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Open a support ticket"),

  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription("Send ticket panel with buttons (admin only)"),

  new SlashCommandBuilder()
    .setName("setcategory")
    .setDescription("Set the category for ticket channels (admin only)")
    .addStringOption(o => o.setName("id").setDescription("Category channel ID").setRequired(true)),

  new SlashCommandBuilder()
    .setName("award")
    .setDescription("Give OWO or INR to a user (admin only)")
    .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true).setMinValue(1))
    .addStringOption(o =>
      o.setName("currency").setDescription("Currency").setRequired(true)
       .addChoices({ name: "OWO", value: "owo" }, { name: "INR", value: "inr" })
    ),

  new SlashCommandBuilder()
    .setName("removebal")
    .setDescription("Remove balance from a user (admin only)")
    .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true).setMinValue(1))
    .addStringOption(o =>
      o.setName("currency").setDescription("Currency").setRequired(true)
       .addChoices({ name: "OWO", value: "owo" }, { name: "INR", value: "inr" })
    ),

  new SlashCommandBuilder()
    .setName("setbal")
    .setDescription("Set exact balance for a user (admin only)")
    .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true).setMinValue(0))
    .addStringOption(o =>
      o.setName("currency").setDescription("Currency").setRequired(true)
       .addChoices({ name: "OWO", value: "owo" }, { name: "INR", value: "inr" })
    ),

  new SlashCommandBuilder()
    .setName("checkbal")
    .setDescription("View all stats of a user (admin only)")
    .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true)),

  new SlashCommandBuilder()
    .setName("resetweekly")
    .setDescription("Reset all OWO and invites for this week (owner only)"),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all available commands"),
].map(c => c.toJSON());

// ──────────────────────────────────────────────
// CLIENT
// ──────────────────────────────────────────────
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

// ──────────────────────────────────────────────
// READY
// ──────────────────────────────────────────────
client.once("ready", async () => {
  console.log("Ceas is online as " + client.user.tag);
  client.user.setActivity("C.help | /help");

  // Register slash commands globally
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("Slash commands registered: " + commands.length);
  } catch (e) {
    console.error("Slash command registration error:", e.message);
  }

  // Cache existing invites
  for (const guild of client.guilds.cache.values()) {
    try {
      const invs = await guild.invites.fetch();
      for (const inv of invs.values()) {
        cacheInv(inv.code, guild.id, inv.inviter?.id ?? "unknown", inv.uses ?? 0);
      }
    } catch (_) {}
  }
});

// ──────────────────────────────────────────────
// MESSAGE CREATE (prefix commands)
// ──────────────────────────────────────────────
client.on("messageCreate", async (msg) => {
  try {
    if (msg.author.bot || !msg.guild) return;

    // Track messages with cooldown
    const u = getUser(msg.author.id, msg.guild.id);
    if (Date.now() - (u.last_msg || 0) >= MSG_COOLDOWN) {
      setLastMsg(msg.author.id, msg.guild.id, Date.now());
      const total = addMsg(msg.author.id, msg.guild.id);
      await checkMsgRewards(client, msg.author.id, msg.guild.id, total);
    }

    if (!msg.content.startsWith(PREFIX)) return;

    const parts = msg.content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd   = parts[0].toLowerCase();
    const args  = parts.slice(1);

    // ── C.help ──────────────────────────────────────────
    if (cmd === "help" || cmd === "h") {
      const staff = isStaff(msg.member, msg.author.id);
      const e = embed(WHITE)
        .setTitle("📖 Ceas Bot Commands")
        .setDescription("Prefix: `C.`  |  Also works as `/slash` commands")
        .addFields(
          { name: "💰 Economy", value: "`C.balance [@user]`\n`C.inr <amount> @user` — pay via ticket\n`C.owo <amount> @user` — instant transfer\n`C.invites [@user]`\n`C.leaderboard [owo|inr|invites|messages|vc]`\n`C.rewards`" },
          { name: "🎫 Tickets", value: "`C.ticket` — open support ticket\n`C.ticketpanel` — send panel (admin)\n`C.setcategory <id>` — set category (admin)" },
          { name: "ℹ️ Other", value: "`C.ping`\n`C.help`" },
        );
      if (staff) {
        e.addFields({ name: "🛡️ Admin", value: "`C.award @user <amt> <owo|inr>`\n`C.removebal @user <amt> <owo|inr>`\n`C.setbal @user <amt> <owo|inr>`\n`C.checkbal @user`\n`C.resetweekly` (owner)" });
      }
      return msg.reply({ embeds: [e] });
    }

    // ── C.ping ──────────────────────────────────────────
    if (cmd === "ping") {
      const r = await msg.reply({ embeds: [embed(WHITE).setDescription("Pinging...")] });
      const ms = r.createdTimestamp - msg.createdTimestamp;
      return r.edit({ embeds: [embed(WHITE).setTitle("🏓 Pong!").addFields({ name: "Bot", value: ms + "ms", inline: true }, { name: "API", value: Math.round(client.ws.ping) + "ms", inline: true })] });
    }

    // ── C.balance ────────────────────────────────────────
    if (cmd === "balance" || cmd === "bal" || cmd === "wallet") {
      const target = msg.mentions.users.first() || msg.author;
      if (target.bot) return msg.reply({ embeds: [errEmbed("Bots have no balance.")] });
      const u2 = getUser(target.id, msg.guild.id);
      return msg.reply({ embeds: [
        embed(WHITE)
          .setTitle(target.username + "'s Wallet")
          .setThumbnail(target.displayAvatarURL())
          .addFields(
            { name: "🐾 OWO",      value: fmtNum(u2.owo),                      inline: true },
            { name: "💵 INR",      value: "₹" + u2.inr.toLocaleString(),        inline: true },
            { name: "\u200b",      value: "\u200b",                              inline: true },
            { name: "📨 Invites",  value: String(u2.invites),                   inline: true },
            { name: "💬 Messages", value: u2.msgs.toLocaleString(),              inline: true },
            { name: "🎙️ VC Time",  value: Math.floor(u2.vc_min) + " min",       inline: true },
          ),
      ] });
    }

    // ── C.invites ────────────────────────────────────────
    if (cmd === "invites" || cmd === "inv") {
      const target = msg.mentions.users.first() || msg.author;
      const u2 = getUser(target.id, msg.guild.id);
      return msg.reply({ embeds: [embed(WHITE).setTitle("📨 " + target.username + "'s Invites").setDescription("**" + u2.invites + "** total invites")] });
    }

    // ── C.rewards ────────────────────────────────────────
    if (cmd === "rewards" || cmd === "rl") {
      const invLine = INVITE_TIERS.map(t => "• Every **" + t.every + " invite(s)** → `" + fmtNum(t.owo) + " OWO` (stackable)").join("\n");
      const msgLine = MSG_TIERS.map(t => {
        let r = t.owo > 0 ? "`" + fmtNum(t.owo) + " OWO`" : "";
        if (t.extra) r += (r ? " + " : "") + t.extra;
        return "• **" + t.at.toLocaleString() + " msgs** → " + r;
      }).join("\n");
      const vcLine = VC_TIERS.map(t => {
        let r = t.owo > 0 ? "`" + fmtNum(t.owo) + " OWO`" : "";
        if (t.extra) r += (r ? " + " : "") + t.extra;
        return "• **" + t.hours + "hr VC** → " + r;
      }).join("\n");
      return msg.reply({ embeds: [
        embed(WHITE)
          .setTitle("🏆 Ceas Rewards")
          .addFields(
            { name: "📨 Invite Rewards (stackable)",      value: invLine },
            { name: "💬 Message Rewards (one-time each)", value: msgLine },
            { name: "🎙️ VC Rewards (one-time each)",      value: vcLine  },
            { name: "📌 Note", value: "OWO is auto-credited. Boosts & Nitro are given manually by admins." },
          ),
      ] });
    }

    // ── C.leaderboard ────────────────────────────────────
    if (cmd === "leaderboard" || cmd === "lb" || cmd === "top") {
      const typeMap = { owo: "owo", inr: "inr", invites: "invites", messages: "msgs", vc: "vc_min" };
      const col     = typeMap[(args[0] || "owo").toLowerCase()] || "owo";
      const labelMap = { owo: "🐾 OWO", inr: "💵 INR", invites: "📨 Invites", msgs: "💬 Messages", vc_min: "🎙️ VC Time" };
      const rows    = getTop(msg.guild.id, col);
      if (!rows.length) return msg.reply({ embeds: [embed(WHITE).setDescription("No data yet!")] });
      const medals  = ["🥇", "🥈", "🥉"];
      const lines   = await Promise.all(rows.map(async (row, i) => {
        let name;
        try { name = (await client.users.fetch(row.id)).username; } catch { name = "User#" + row.id.slice(-4); }
        const val = col === "inr" ? "₹" + row.inr.toLocaleString() : col === "owo" ? fmtNum(row.owo) + " OWO" : col === "invites" ? row.invites + " inv" : col === "msgs" ? row.msgs.toLocaleString() + " msgs" : Math.floor(row.vc_min) + " min";
        return (medals[i] || "**" + (i + 1) + ".**") + " **" + name + "** — " + val;
      }));
      return msg.reply({ embeds: [embed(WHITE).setTitle(labelMap[col] + " Leaderboard").setDescription(lines.join("\n"))] });
    }

    // ── C.owo ────────────────────────────────────────────
    if (cmd === "owo" || cmd === "sendowo") {
      const amount = parseFloat(args[0]);
      const target = msg.mentions.users.first();
      if (!target || target.bot)         return msg.reply({ embeds: [errEmbed("Mention a valid user.")] });
      if (target.id === msg.author.id)   return msg.reply({ embeds: [errEmbed("You can't send OWO to yourself.")] });
      if (isNaN(amount) || amount <= 0)  return msg.reply({ embeds: [errEmbed("Invalid amount.")] });
      const s = getUser(msg.author.id, msg.guild.id);
      if (s.owo < amount)                return msg.reply({ embeds: [errEmbed("Not enough OWO. You have **" + fmtNum(s.owo) + " OWO**.")] });
      addOwo(msg.author.id, msg.guild.id, -amount);
      addOwo(target.id, msg.guild.id, amount);
      return msg.reply({ embeds: [embed(WHITE).setTitle("🐾 OWO Sent!").setDescription("**" + msg.author.username + "** → **" + target.username + "**\n**" + fmtNum(amount) + " OWO** transferred!")] });
    }

    // ── C.inr ─────────────────────────────────────────────
    if (cmd === "inr" || cmd === "pay" || cmd === "send") {
      const amount = parseFloat(args[0]);
      const target = msg.mentions.users.first();
      if (!target || target.bot)         return msg.reply({ embeds: [errEmbed("Mention a valid user.")] });
      if (target.id === msg.author.id)   return msg.reply({ embeds: [errEmbed("You can't pay yourself.")] });
      if (isNaN(amount) || amount <= 0)  return msg.reply({ embeds: [errEmbed("Invalid amount.")] });
      const s = getUser(msg.author.id, msg.guild.id);
      if (s.inr < amount)                return msg.reply({ embeds: [errEmbed("Not enough INR. You have **₹" + s.inr.toLocaleString() + "**.")] });

      let tc;
      try {
        tc = await createTicket(msg.guild, client.user.id, target, msg.author, "payment");
      } catch (e) {
        console.error("[TICKET CREATE]", e.message);
        return msg.reply({ embeds: [errEmbed("Could not create ticket. Make sure the bot has **Manage Channels** permission.")] });
      }

      // Send payment request in ticket
      const reqEmbed = embed(WHITE)
        .setTitle("💳 INR Payment Request")
        .setDescription(
          msg.author + " wants to send **₹" + amount.toLocaleString() + " INR** to " + target + ".\n\n" +
          "**" + target.username + "**, please share your UPI details here:\n\n" +
          "> 📱 **UPI ID** — e.g. `name@upi`\n" +
          "> 🖼️ **QR Code** — send as image\n" +
          "> 🏦 **Bank Account + IFSC**\n\n" +
          "_Type or send your details below. Waiting..._"
        );

      const ticketMsg = await tc.send({
        content: msg.author + " " + target,
        embeds:  [reqEmbed],
        components: [ticketButtons(tc.id)],
      });

      msg.reply({ embeds: [okEmbed("Payment ticket opened! → " + tc)] });

      // Wait for receiver's payment details
      const infoFilter = (m) => m.author.id === target.id && !m.author.bot;
      const infoCollector = tc.createMessageCollector({ filter: infoFilter, time: 600000, max: 1 });

      infoCollector.on("collect", async (infoMsg) => {
        try {
          let details = infoMsg.content || "";
          if (infoMsg.attachments.size > 0) {
            details = details + " [Image: " + infoMsg.attachments.first().url + "]";
          }
          if (!details.trim()) details = "(no details provided)";

          const detailsEmbed = embed(WHITE)
            .setTitle("📩 Payment Details Received")
            .addFields(
              { name: "💵 Amount",    value: "₹" + amount.toLocaleString() + " INR", inline: true },
              { name: "👤 Recipient", value: target.username,                         inline: true },
              { name: "📋 Details",   value: "```\n" + details.slice(0, 900) + "\n```" },
              { name: "⏳ Next Step", value: "**" + msg.author.username + "** — complete the payment via UPI, then click **I've Paid** below." },
            )
            .setFooter({ text: "Ceas Bot" });

          const confirmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("paid_" + tc.id + "_" + msg.author.id + "_" + target.id + "_" + amount)
              .setLabel("✅ I've Paid")
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId("reject_" + tc.id)
              .setLabel("❌ Reject / Cancel")
              .setStyle(ButtonStyle.Secondary),
          );

          await ticketMsg.edit({ embeds: [detailsEmbed], components: [confirmRow] }).catch(() => {});
        } catch (e) {
          console.error("[INFO COLLECT]", e.message);
        }
      });

      infoCollector.on("end", (collected, reason) => {
        if (reason === "time" && collected.size === 0) {
          tc.send({ embeds: [errEmbed("No payment details received in time. Closing in 30 seconds.")] }).catch(() => {});
          setTimeout(() => tc.delete().catch(() => {}), 30000);
        }
      });

      return;
    }

    // ── C.ticket ─────────────────────────────────────────
    if (cmd === "ticket" || cmd === "newticket") {
      let tc;
      try {
        tc = await createTicket(msg.guild, client.user.id, msg.author, null, "support");
      } catch (e) {
        return msg.reply({ embeds: [errEmbed("Could not create ticket. Bot needs **Manage Channels** permission.")] });
      }
      await tc.send({
        content: "" + msg.author,
        embeds: [embed(WHITE).setTitle("🎫 Support Ticket Opened").setDescription("Welcome **" + msg.author.username + "**!\n\nDescribe your issue and a staff member will assist you.\n\nUse the buttons below to close this ticket when done.")],
        components: [ticketButtons(tc.id)],
      });
      return msg.reply({ embeds: [okEmbed("Ticket opened! → " + tc)] });
    }

    // ── C.ticketpanel ────────────────────────────────────
    if (cmd === "ticketpanel" || cmd === "panel") {
      if (!isStaff(msg.member, msg.author.id)) return msg.reply({ embeds: [errEmbed("Admins only.")] });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("panel_open_support").setLabel("🎫 Open Ticket").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("panel_open_payment").setLabel("💳 Payment Help").setStyle(ButtonStyle.Secondary),
      );
      await msg.channel.send({
        embeds: [embed(WHITE).setTitle("🎫 Open a Ticket").setDescription("**🎫 Open Ticket** — General support\n**💳 Payment Help** — INR payment issues\n\nClick a button below to open your ticket.")],
        components: [row],
      });
      msg.delete().catch(() => {});
      return;
    }

    // ── C.setcategory ─────────────────────────────────────
    if (cmd === "setcategory" || cmd === "setcat") {
      if (!isStaff(msg.member, msg.author.id)) return msg.reply({ embeds: [errEmbed("Admins only.")] });
      const cat = msg.guild.channels.cache.get(args[0]);
      if (!cat || cat.type !== ChannelType.GuildCategory) return msg.reply({ embeds: [errEmbed("Invalid category ID.")] });
      setCfg(msg.guild.id, "tick_cat", args[0]);
      return msg.reply({ embeds: [okEmbed("Ticket category set to **" + cat.name + "**.")] });
    }

    // ── C.award (admin) ───────────────────────────────────
    if (cmd === "award" || cmd === "addbal") {
      if (!isStaff(msg.member, msg.author.id)) return msg.reply({ embeds: [errEmbed("Admins only.")] });
      const target = msg.mentions.users.first();
      const amount = parseFloat(args[1]);
      const cur    = (args[2] || "owo").toLowerCase();
      if (!target || isNaN(amount) || amount <= 0 || !["owo", "inr"].includes(cur))
        return msg.reply({ embeds: [errEmbed("Usage: `C.award @user <amount> <owo|inr>`")] });
      cur === "owo" ? addOwo(target.id, msg.guild.id, amount) : addInr(target.id, msg.guild.id, amount);
      const label = cur === "owo" ? fmtNum(amount) + " OWO" : "₹" + amount;
      return msg.reply({ embeds: [okEmbed("Added **" + label + "** to **" + target.username + "**.")] });
    }

    // ── C.removebal (admin) ───────────────────────────────
    if (cmd === "removebal" || cmd === "deduct" || cmd === "rmbal") {
      if (!isStaff(msg.member, msg.author.id)) return msg.reply({ embeds: [errEmbed("Admins only.")] });
      const target = msg.mentions.users.first();
      const amount = parseFloat(args[1]);
      const cur    = (args[2] || "owo").toLowerCase();
      if (!target || isNaN(amount) || !["owo", "inr"].includes(cur))
        return msg.reply({ embeds: [errEmbed("Usage: `C.removebal @user <amount> <owo|inr>`")] });
      cur === "owo" ? addOwo(target.id, msg.guild.id, -amount) : addInr(target.id, msg.guild.id, -amount);
      const label = cur === "owo" ? fmtNum(amount) + " OWO" : "₹" + amount;
      return msg.reply({ embeds: [okEmbed("Removed **" + label + "** from **" + target.username + "**.")] });
    }

    // ── C.setbal (admin) ──────────────────────────────────
    if (cmd === "setbal" || cmd === "setbalance") {
      if (!isStaff(msg.member, msg.author.id)) return msg.reply({ embeds: [errEmbed("Admins only.")] });
      const target = msg.mentions.users.first();
      const amount = parseFloat(args[1]);
      const cur    = (args[2] || "owo").toLowerCase();
      if (!target || isNaN(amount) || !["owo", "inr"].includes(cur))
        return msg.reply({ embeds: [errEmbed("Usage: `C.setbal @user <amount> <owo|inr>`")] });
      cur === "owo" ? setOwo(target.id, msg.guild.id, amount) : setInr(target.id, msg.guild.id, amount);
      const label = cur === "owo" ? fmtNum(amount) + " OWO" : "₹" + amount;
      return msg.reply({ embeds: [okEmbed("Set **" + target.username + "**'s " + cur.toUpperCase() + " to **" + label + "**.")] });
    }

    // ── C.checkbal (admin) ────────────────────────────────
    if (cmd === "checkbal" || cmd === "uinfo") {
      if (!isStaff(msg.member, msg.author.id)) return msg.reply({ embeds: [errEmbed("Admins only.")] });
      const target = msg.mentions.users.first();
      if (!target) return msg.reply({ embeds: [errEmbed("Mention a user.")] });
      const u2 = getUser(target.id, msg.guild.id);
      return msg.reply({ embeds: [
        embed(WHITE)
          .setTitle("🔍 " + target.username + " — Admin View")
          .setThumbnail(target.displayAvatarURL())
          .addFields(
            { name: "🐾 OWO",      value: fmtNum(u2.owo),                     inline: true },
            { name: "💵 INR",      value: "₹" + u2.inr.toLocaleString(),       inline: true },
            { name: "📨 Invites",  value: String(u2.invites),                  inline: true },
            { name: "💬 Messages", value: u2.msgs.toLocaleString(),             inline: true },
            { name: "🎙️ VC Time",  value: Math.floor(u2.vc_min) + " min",      inline: true },
            { name: "User ID",     value: "`" + target.id + "`",               inline: false },
          ),
      ] });
    }

    // ── C.resetweekly (owner) ─────────────────────────────
    if (cmd === "resetweekly" || cmd === "weekly") {
      if (!isOwner(msg.author.id)) return msg.reply({ embeds: [errEmbed("Owner only.")] });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("weekly_yes").setLabel("✅ Yes, Reset").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("weekly_no").setLabel("❌ Cancel").setStyle(ButtonStyle.Secondary),
      );
      const prompt = await msg.reply({
        embeds: [embed(BLACK).setTitle("⚠️ Confirm Weekly Reset").setDescription("This will reset **all OWO balances and invite counts** for this server. This cannot be undone!")],
        components: [row],
      });
      const click = await prompt.awaitMessageComponent({ filter: i => i.user.id === msg.author.id, componentType: ComponentType.Button, time: 30000 }).catch(() => null);
      if (!click || click.customId === "weekly_no") {
        return prompt.edit({ embeds: [okEmbed("Reset cancelled.")], components: [] });
      }
      resetWeekly(msg.guild.id);
      return click.update({ embeds: [embed(WHITE).setTitle("✅ Weekly Reset Done").setDescription("All OWO and invite counts have been reset. New week started! 🎉")], components: [] });
    }

  } catch (e) {
    console.error("[messageCreate]", e.message);
  }
});

// ──────────────────────────────────────────────
// INTERACTION CREATE (slash + buttons)
// ──────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  try {
    const { guild, member, user } = interaction;

    // ════════════════════════════════
    // SLASH COMMANDS
    // ════════════════════════════════
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      // /help
      if (name === "help") {
        const staff = isStaff(member, user.id);
        const e = embed(WHITE)
          .setTitle("📖 Ceas Bot Commands")
          .setDescription("Prefix: `C.`  |  Slash: `/command`")
          .addFields(
            { name: "💰 Economy", value: "`/balance` `/invites` `/rewards` `/leaderboard` `/owo` `/inr`" },
            { name: "🎫 Tickets", value: "`/ticket` `/ticketpanel` `/setcategory`" },
            { name: "ℹ️ Other",   value: "`/ping` `/help`" },
          );
        if (staff) e.addFields({ name: "🛡️ Admin", value: "`/award` `/removebal` `/setbal` `/checkbal` `/resetweekly`" });
        return interaction.reply({ embeds: [e] });
      }

      // /ping
      if (name === "ping") {
        await interaction.reply({ embeds: [embed(WHITE).setDescription("Pinging...")] });
        return interaction.editReply({ embeds: [embed(WHITE).setTitle("🏓 Pong!").addFields({ name: "API", value: Math.round(client.ws.ping) + "ms", inline: true })] });
      }

      // /balance
      if (name === "balance") {
        const target = interaction.options.getUser("user") || user;
        if (target.bot) return interaction.reply({ embeds: [errEmbed("Bots have no balance.")] });
        const u2 = getUser(target.id, guild.id);
        return interaction.reply({ embeds: [
          embed(WHITE)
            .setTitle(target.username + "'s Wallet")
            .setThumbnail(target.displayAvatarURL())
            .addFields(
              { name: "🐾 OWO",      value: fmtNum(u2.owo),                     inline: true },
              { name: "💵 INR",      value: "₹" + u2.inr.toLocaleString(),       inline: true },
              { name: "\u200b",      value: "\u200b",                             inline: true },
              { name: "📨 Invites",  value: String(u2.invites),                  inline: true },
              { name: "💬 Messages", value: u2.msgs.toLocaleString(),             inline: true },
              { name: "🎙️ VC Time",  value: Math.floor(u2.vc_min) + " min",      inline: true },
            ),
        ] });
      }

      // /invites
      if (name === "invites") {
        const target = interaction.options.getUser("user") || user;
        const u2 = getUser(target.id, guild.id);
        return interaction.reply({ embeds: [embed(WHITE).setTitle("📨 " + target.username + "'s Invites").setDescription("**" + u2.invites + "** total invites")] });
      }

      // /rewards
      if (name === "rewards") {
        const invLine = INVITE_TIERS.map(t => "• Every **" + t.every + " invite(s)** → `" + fmtNum(t.owo) + " OWO` (stackable)").join("\n");
        const msgLine = MSG_TIERS.map(t => { let r = t.owo > 0 ? "`" + fmtNum(t.owo) + " OWO`" : ""; if (t.extra) r += (r ? " + " : "") + t.extra; return "• **" + t.at.toLocaleString() + " msgs** → " + r; }).join("\n");
        const vcLine  = VC_TIERS.map(t => { let r = t.owo > 0 ? "`" + fmtNum(t.owo) + " OWO`" : ""; if (t.extra) r += (r ? " + " : "") + t.extra; return "• **" + t.hours + "hr VC** → " + r; }).join("\n");
        return interaction.reply({ embeds: [embed(WHITE).setTitle("🏆 Ceas Rewards").addFields({ name: "📨 Invites (stackable)", value: invLine }, { name: "💬 Messages (one-time)", value: msgLine }, { name: "🎙️ VC (one-time)", value: vcLine })] });
      }

      // /leaderboard
      if (name === "leaderboard") {
        const typeMap  = { owo: "owo", inr: "inr", invites: "invites", messages: "msgs", vc: "vc_min" };
        const col      = typeMap[interaction.options.getString("type") || "owo"] || "owo";
        const labelMap = { owo: "🐾 OWO", inr: "💵 INR", invites: "📨 Invites", msgs: "💬 Messages", vc_min: "🎙️ VC Time" };
        const rows     = getTop(guild.id, col);
        if (!rows.length) return interaction.reply({ embeds: [embed(WHITE).setDescription("No data yet!")] });
        const medals = ["🥇", "🥈", "🥉"];
        const lines  = await Promise.all(rows.map(async (row, i) => {
          let uname; try { uname = (await client.users.fetch(row.id)).username; } catch { uname = "User#" + row.id.slice(-4); }
          const val = col === "inr" ? "₹" + row.inr.toLocaleString() : col === "owo" ? fmtNum(row.owo) + " OWO" : col === "invites" ? row.invites + " inv" : col === "msgs" ? row.msgs.toLocaleString() + " msgs" : Math.floor(row.vc_min) + " min";
          return (medals[i] || "**" + (i + 1) + ".**") + " **" + uname + "** — " + val;
        }));
        return interaction.reply({ embeds: [embed(WHITE).setTitle(labelMap[col] + " Leaderboard").setDescription(lines.join("\n"))] });
      }

      // /owo
      if (name === "owo") {
        const amount = interaction.options.getInteger("amount");
        const target = interaction.options.getUser("user");
        if (!target || target.bot)        return interaction.reply({ embeds: [errEmbed("Mention a valid user.")], ephemeral: true });
        if (target.id === user.id)        return interaction.reply({ embeds: [errEmbed("Can't send to yourself.")], ephemeral: true });
        const s = getUser(user.id, guild.id);
        if (s.owo < amount)               return interaction.reply({ embeds: [errEmbed("Not enough OWO. You have **" + fmtNum(s.owo) + " OWO**.")], ephemeral: true });
        addOwo(user.id, guild.id, -amount);
        addOwo(target.id, guild.id, amount);
        return interaction.reply({ embeds: [embed(WHITE).setTitle("🐾 OWO Sent!").setDescription("**" + user.username + "** → **" + target.username + "**\n**" + fmtNum(amount) + " OWO** transferred!")] });
      }

      // /inr
      if (name === "inr") {
        const amount = interaction.options.getNumber("amount");
        const target = interaction.options.getUser("user");
        if (!target || target.bot)       return interaction.reply({ embeds: [errEmbed("Mention a valid user.")], ephemeral: true });
        if (target.id === user.id)       return interaction.reply({ embeds: [errEmbed("Can't pay yourself.")], ephemeral: true });
        const s = getUser(user.id, guild.id);
        if (s.inr < amount)              return interaction.reply({ embeds: [errEmbed("Not enough INR. You have **₹" + s.inr.toLocaleString() + "**.")], ephemeral: true });

        await interaction.deferReply();

        let tc;
        try {
          tc = await createTicket(guild, client.user.id, target, user, "payment");
        } catch (e) {
          console.error("[TICKET CREATE]", e.message);
          return interaction.editReply({ embeds: [errEmbed("Could not create ticket. Bot needs **Manage Channels** permission.")] });
        }

        const reqEmbed = embed(WHITE)
          .setTitle("💳 INR Payment Request")
          .setDescription(
            user + " wants to send **₹" + amount.toLocaleString() + " INR** to " + target + ".\n\n" +
            "**" + target.username + "**, please share your UPI details:\n\n" +
            "> 📱 **UPI ID** — e.g. `name@upi`\n" +
            "> 🖼️ **QR Code** — send as image\n" +
            "> 🏦 **Bank Account + IFSC**\n\n" +
            "_Type your details below. Waiting..._"
          );

        const ticketMsg = await tc.send({
          content: "" + user + " " + target,
          embeds:  [reqEmbed],
          components: [ticketButtons(tc.id)],
        });

        await interaction.editReply({ embeds: [okEmbed("Payment ticket opened! → " + tc)] });

        const infoCollector = tc.createMessageCollector({
          filter: (m) => m.author.id === target.id && !m.author.bot,
          time: 600000,
          max: 1,
        });

        infoCollector.on("collect", async (infoMsg) => {
          try {
            let details = infoMsg.content || "";
            if (infoMsg.attachments.size > 0) details += " [Image: " + infoMsg.attachments.first().url + "]";
            if (!details.trim()) details = "(no details provided)";
            const detailsEmbed = embed(WHITE)
              .setTitle("📩 Payment Details Received")
              .addFields(
                { name: "💵 Amount",    value: "₹" + amount.toLocaleString() + " INR", inline: true },
                { name: "👤 Recipient", value: target.username,                         inline: true },
                { name: "📋 Details",   value: "```\n" + details.slice(0, 900) + "\n```" },
                { name: "⏳ Next Step", value: "**" + user.username + "** — pay via UPI, then click **I've Paid**." },
              );
            const confirmRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("paid_" + tc.id + "_" + user.id + "_" + target.id + "_" + amount)
                .setLabel("✅ I've Paid")
                .setStyle(ButtonStyle.Secondary),
              new ButtonBuilder()
                .setCustomId("reject_" + tc.id)
                .setLabel("❌ Reject")
                .setStyle(ButtonStyle.Secondary),
            );
            await ticketMsg.edit({ embeds: [detailsEmbed], components: [confirmRow] }).catch(() => {});
          } catch (e) { console.error("[INFO COLLECT SLASH]", e.message); }
        });

        infoCollector.on("end", (col, reason) => {
          if (reason === "time" && col.size === 0) {
            tc.send({ embeds: [errEmbed("No details received in time. Closing in 30 seconds.")] }).catch(() => {});
            setTimeout(() => tc.delete().catch(() => {}), 30000);
          }
        });

        return;
      }

      // /ticket
      if (name === "ticket") {
        await interaction.deferReply({ ephemeral: true });
        let tc;
        try {
          tc = await createTicket(guild, client.user.id, user, null, "support");
        } catch (e) {
          return interaction.editReply({ embeds: [errEmbed("Bot needs Manage Channels permission.")] });
        }
        await tc.send({
          content: "" + user,
          embeds: [embed(WHITE).setTitle("🎫 Support Ticket").setDescription("Welcome **" + user.username + "**!\n\nDescribe your issue and staff will help you.")],
          components: [ticketButtons(tc.id)],
        });
        return interaction.editReply({ embeds: [okEmbed("Ticket opened! → " + tc)] });
      }

      // /ticketpanel
      if (name === "ticketpanel") {
        if (!isStaff(member, user.id)) return interaction.reply({ embeds: [errEmbed("Admins only.")], ephemeral: true });
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("panel_open_support").setLabel("🎫 Open Ticket").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("panel_open_payment").setLabel("💳 Payment Help").setStyle(ButtonStyle.Secondary),
        );
        await interaction.channel.send({
          embeds: [embed(WHITE).setTitle("🎫 Open a Ticket").setDescription("**🎫 Open Ticket** — General support\n**💳 Payment Help** — INR payment issues\n\nClick a button below.")],
          components: [row],
        });
        return interaction.reply({ content: "Panel sent!", ephemeral: true });
      }

      // /setcategory
      if (name === "setcategory") {
        if (!isStaff(member, user.id)) return interaction.reply({ embeds: [errEmbed("Admins only.")], ephemeral: true });
        const catId = interaction.options.getString("id");
        const cat   = guild.channels.cache.get(catId);
        if (!cat || cat.type !== ChannelType.GuildCategory) return interaction.reply({ embeds: [errEmbed("Invalid category ID.")], ephemeral: true });
        setCfg(guild.id, "tick_cat", catId);
        return interaction.reply({ embeds: [okEmbed("Ticket category set to **" + cat.name + "**.")], ephemeral: true });
      }

      // /award
      if (name === "award") {
        if (!isStaff(member, user.id)) return interaction.reply({ embeds: [errEmbed("Admins only.")], ephemeral: true });
        const target = interaction.options.getUser("user");
        const amount = interaction.options.getInteger("amount");
        const cur    = interaction.options.getString("currency");
        cur === "owo" ? addOwo(target.id, guild.id, amount) : addInr(target.id, guild.id, amount);
        const label  = cur === "owo" ? fmtNum(amount) + " OWO" : "₹" + amount;
        return interaction.reply({ embeds: [okEmbed("Added **" + label + "** to **" + target.username + "**.")] });
      }

      // /removebal
      if (name === "removebal") {
        if (!isStaff(member, user.id)) return interaction.reply({ embeds: [errEmbed("Admins only.")], ephemeral: true });
        const target = interaction.options.getUser("user");
        const amount = interaction.options.getInteger("amount");
        const cur    = interaction.options.getString("currency");
        cur === "owo" ? addOwo(target.id, guild.id, -amount) : addInr(target.id, guild.id, -amount);
        const label  = cur === "owo" ? fmtNum(amount) + " OWO" : "₹" + amount;
        return interaction.reply({ embeds: [okEmbed("Removed **" + label + "** from **" + target.username + "**.")], ephemeral: true });
      }

      // /setbal
      if (name === "setbal") {
        if (!isStaff(member, user.id)) return interaction.reply({ embeds: [errEmbed("Admins only.")], ephemeral: true });
        const target = interaction.options.getUser("user");
        const amount = interaction.options.getInteger("amount");
        const cur    = interaction.options.getString("currency");
        cur === "owo" ? setOwo(target.id, guild.id, amount) : setInr(target.id, guild.id, amount);
        const label  = cur === "owo" ? fmtNum(amount) + " OWO" : "₹" + amount;
        return interaction.reply({ embeds: [okEmbed("Set **" + target.username + "**'s " + cur.toUpperCase() + " to **" + label + "**.")], ephemeral: true });
      }

      // /checkbal
      if (name === "checkbal") {
        if (!isStaff(member, user.id)) return interaction.reply({ embeds: [errEmbed("Admins only.")], ephemeral: true });
        const target = interaction.options.getUser("user");
        const u2 = getUser(target.id, guild.id);
        return interaction.reply({ embeds: [
          embed(WHITE)
            .setTitle("🔍 " + target.username + " — Admin View")
            .setThumbnail(target.displayAvatarURL())
            .addFields(
              { name: "🐾 OWO",      value: fmtNum(u2.owo),                    inline: true },
              { name: "💵 INR",      value: "₹" + u2.inr.toLocaleString(),      inline: true },
              { name: "📨 Invites",  value: String(u2.invites),                 inline: true },
              { name: "💬 Messages", value: u2.msgs.toLocaleString(),            inline: true },
              { name: "🎙️ VC Time",  value: Math.floor(u2.vc_min) + " min",     inline: true },
              { name: "User ID",     value: "`" + target.id + "`",              inline: false },
            ),
        ], ephemeral: true });
      }

      // /resetweekly
      if (name === "resetweekly") {
        if (!isOwner(user.id)) return interaction.reply({ embeds: [errEmbed("Owner only.")], ephemeral: true });
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("weekly_yes").setLabel("✅ Yes, Reset").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("weekly_no").setLabel("❌ Cancel").setStyle(ButtonStyle.Secondary),
        );
        return interaction.reply({ embeds: [embed(BLACK).setTitle("⚠️ Confirm Weekly Reset").setDescription("This resets **all OWO & invites** for this server. Cannot be undone!")], components: [row], ephemeral: true });
      }

      return;
    }

    // ════════════════════════════════
    // BUTTON INTERACTIONS
    // ════════════════════════════════
    if (!interaction.isButton()) return;
    const id = interaction.customId;

    // Weekly reset confirm
    if (id === "weekly_yes") {
      if (!isOwner(user.id)) return safeReply(interaction, { embeds: [errEmbed("Owner only.")] });
      resetWeekly(guild.id);
      return safeUpdate(interaction, { embeds: [embed(WHITE).setTitle("✅ Weekly Reset Done").setDescription("All OWO and invites reset! 🎉")], components: [] });
    }
    if (id === "weekly_no") {
      return safeUpdate(interaction, { embeds: [okEmbed("Reset cancelled.")], components: [] });
    }

    // Panel open ticket
    if (id === "panel_open_support" || id === "panel_open_payment") {
      const type = id === "panel_open_payment" ? "payment" : "support";
      await interaction.deferReply({ ephemeral: true });
      let tc;
      try {
        tc = await createTicket(guild, client.user.id, user, null, type);
      } catch (e) {
        return interaction.editReply({ embeds: [errEmbed("Bot needs Manage Channels permission.")] });
      }
      await tc.send({
        content: "" + user,
        embeds: [embed(WHITE).setTitle("🎫 " + (type === "payment" ? "Payment Help" : "Support") + " Ticket").setDescription("Welcome **" + user.username + "**!\n\n" + (type === "payment" ? "Describe your payment issue and staff will assist you." : "Describe your issue and staff will assist you."))],
        components: [ticketButtons(tc.id)],
      });
      return interaction.editReply({ embeds: [okEmbed("Ticket opened! → " + tc)] });
    }

    // Payment confirm: paid_<channelId>_<senderId>_<receiverId>_<amount>
    if (id.startsWith("paid_")) {
      const parts  = id.split("_");
      const cid    = parts[1];
      const sendId = parts[2];
      const recvId = parts[3];
      const amt    = parseFloat(parts[4]);

      if (user.id !== sendId && !isAdmin(member)) return safeReply(interaction, { embeds: [errEmbed("Only the sender can confirm payment.")] });

      const senderBal = getUser(sendId, guild.id);
      if (senderBal.inr < amt) {
        return safeReply(interaction, { embeds: [errEmbed("Sender no longer has enough INR balance.")] });
      }

      addInr(sendId, guild.id, -amt);
      addInr(recvId, guild.id,  amt);

      const doneRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("tdelete_" + cid).setLabel("🗑️ Close & Delete Ticket").setStyle(ButtonStyle.Secondary),
      );
      return safeUpdate(interaction, {
        embeds: [embed(WHITE)
          .setTitle("✅ Payment Complete!")
          .setDescription("**₹" + amt.toLocaleString() + " INR** has been transferred successfully!\n\nYou may delete this ticket now.")
          .setFooter({ text: "Confirmed by " + user.username + " • Ceas Bot" })
        ],
        components: [doneRow],
      });
    }

    // Payment reject
    if (id.startsWith("reject_")) {
      await safeUpdate(interaction, {
        embeds: [embed(BLACK).setTitle("❌ Payment Rejected").setDescription("The payment was rejected.\n\nThis ticket will be deleted in 30 seconds.")],
        components: [],
      });
      const cid = id.replace("reject_", "");
      setTimeout(() => guild.channels.cache.get(cid)?.delete().catch(() => {}), 30000);
      return;
    }

    // Close ticket
    if (id.startsWith("tclose_")) {
      const cid    = id.replace("tclose_", "");
      const ticket = getTicket(cid);
      if (!ticket) return safeReply(interaction, { embeds: [errEmbed("Ticket not found.")] });
      if (!isStaff(member, user.id) && user.id !== ticket.owner)
        return safeReply(interaction, { embeds: [errEmbed("Only the ticket owner or admins can close this.")] });

      closeTicketDb(cid);
      const ch = guild.channels.cache.get(cid);
      if (ch) {
        try { await ch.permissionOverwrites.edit(ticket.owner, { SendMessages: false }); } catch (_) {}
      }
      const delRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("tdelete_" + cid).setLabel("🗑️ Delete Ticket").setStyle(ButtonStyle.Secondary),
      );
      return safeUpdate(interaction, {
        embeds: [embed(BLACK).setTitle("🔒 Ticket Closed").setDescription("Closed by **" + user.username + "**.\nClick Delete to remove this channel.")],
        components: [delRow],
      });
    }

    // Delete ticket
    if (id.startsWith("tdelete_")) {
      if (!isStaff(member, user.id)) return safeReply(interaction, { embeds: [errEmbed("Only admins can delete tickets.")] });
      const cid = id.replace("tdelete_", "");
      const ch  = guild.channels.cache.get(cid);
      await safeReply(interaction, { content: "Deleting in 3 seconds..." });
      setTimeout(() => ch?.delete().catch(() => {}), 3000);
      return;
    }

  } catch (e) {
    console.error("[interactionCreate]", e.message);
  }
});

// ──────────────────────────────────────────────
// GUILD MEMBER ADD (invite tracking)
// ──────────────────────────────────────────────
client.on("guildMemberAdd", async (member) => {
  try {
    const newInvs = await member.guild.invites.fetch();
    let used = null;
    for (const inv of newInvs.values()) {
      const cached = getCached(inv.code);
      if (cached && inv.uses > cached.uses) {
        used = inv;
        updateCached(inv.code, inv.uses);
        break;
      }
    }
    for (const inv of newInvs.values()) {
      cacheInv(inv.code, member.guild.id, inv.inviter?.id ?? "unknown", inv.uses ?? 0);
    }
    if (used?.inviter) {
      const total = addInvite(used.inviter.id, member.guild.id);
      await checkInviteRewards(client, used.inviter.id, member.guild.id, total);
    }
  } catch (e) {
    console.error("[guildMemberAdd]", e.message);
  }
});

// ──────────────────────────────────────────────
// VOICE STATE UPDATE (VC tracking)
// ──────────────────────────────────────────────
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const member = newState.member || oldState.member;
    if (!member || member.user?.bot) return;
    const id    = member.id;
    const guild = member.guild.id;

    if (!oldState.channelId && newState.channelId) {
      // Joined VC
      startVc(id, guild);
    } else if (oldState.channelId && !newState.channelId) {
      // Left VC
      const mins  = endVc(id, guild);
      if (mins > 0) {
        const total = addVc(id, guild, mins);
        await checkVcRewards(client, id, guild, total);
      }
    }
  } catch (e) {
    console.error("[voiceStateUpdate]", e.message);
  }
});

// ──────────────────────────────────────────────
// LOGIN
// ──────────────────────────────────────────────
client.login(TOKEN);
