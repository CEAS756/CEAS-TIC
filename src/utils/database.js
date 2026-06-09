const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '../../data/ceas.db');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      messages INTEGER DEFAULT 0,
      voice_minutes INTEGER DEFAULT 0,
      invites INTEGER DEFAULT 0,
      joined_at INTEGER,
      invited_by TEXT,
      PRIMARY KEY (user_id, guild_id)
    );

    CREATE TABLE IF NOT EXISTS invites (
      invite_code TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      inviter_id TEXT NOT NULL,
      uses INTEGER DEFAULT 0,
      PRIMARY KEY (invite_code, guild_id)
    );

    CREATE TABLE IF NOT EXISTS rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      guild_id TEXT NOT NULL,
      UNIQUE(name, guild_id)
    );

    CREATE TABLE IF NOT EXISTS user_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      reward_id INTEGER NOT NULL,
      given_at INTEGER DEFAULT (strftime('%s','now')),
      given_by TEXT NOT NULL,
      payment_status TEXT DEFAULT 'pending',
      payment_amount REAL DEFAULT 0,
      FOREIGN KEY (reward_id) REFERENCES rewards(id)
    );

    CREATE TABLE IF NOT EXISTS payment_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'INR',
      requested_by TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (strftime('%s','now')),
      channel_id TEXT,
      message_id TEXT
    );

    CREATE TABLE IF NOT EXISTS voice_sessions (
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      joined_at INTEGER,
      PRIMARY KEY (user_id, guild_id)
    );

    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      log_channel TEXT,
      reward_channel TEXT,
      admin_roles TEXT DEFAULT '[]'
    );
  `);

  console.log('[DB] Database initialized.');
}

function getOrCreateMember(userId, guildId) {
  const existing = db.prepare('SELECT * FROM members WHERE user_id = ? AND guild_id = ?').get(userId, guildId);
  if (!existing) {
    db.prepare('INSERT OR IGNORE INTO members (user_id, guild_id, joined_at) VALUES (?, ?, ?)').run(userId, guildId, Date.now());
  }
  return db.prepare('SELECT * FROM members WHERE user_id = ? AND guild_id = ?').get(userId, guildId);
}

function incrementMessages(userId, guildId) {
  getOrCreateMember(userId, guildId);
  db.prepare('UPDATE members SET messages = messages + 1 WHERE user_id = ? AND guild_id = ?').run(userId, guildId);
}

function addVoiceMinutes(userId, guildId, minutes) {
  getOrCreateMember(userId, guildId);
  db.prepare('UPDATE members SET voice_minutes = voice_minutes + ? WHERE user_id = ? AND guild_id = ?').run(minutes, userId, guildId);
}

function startVoiceSession(userId, guildId) {
  db.prepare('INSERT OR REPLACE INTO voice_sessions (user_id, guild_id, joined_at) VALUES (?, ?, ?)').run(userId, guildId, Date.now());
}

function endVoiceSession(userId, guildId) {
  const session = db.prepare('SELECT * FROM voice_sessions WHERE user_id = ? AND guild_id = ?').get(userId, guildId);
  if (session && session.joined_at) {
    const minutes = Math.floor((Date.now() - session.joined_at) / 60000);
    if (minutes > 0) addVoiceMinutes(userId, guildId, minutes);
    db.prepare('DELETE FROM voice_sessions WHERE user_id = ? AND guild_id = ?').run(userId, guildId);
    return minutes;
  }
  return 0;
}

function getMemberStats(userId, guildId) {
  return getOrCreateMember(userId, guildId);
}

function getLeaderboard(guildId, type = 'messages', limit = 10) {
  const validTypes = ['messages', 'voice_minutes', 'invites'];
  const col = validTypes.includes(type) ? type : 'messages';
  return db.prepare(`SELECT * FROM members WHERE guild_id = ? ORDER BY ${col} DESC LIMIT ?`).all(guildId, limit);
}

function setInvitedBy(userId, guildId, invitedBy) {
  getOrCreateMember(userId, guildId);
  db.prepare('UPDATE members SET invited_by = ? WHERE user_id = ? AND guild_id = ?').run(invitedBy, userId, guildId);
  if (invitedBy) {
    getOrCreateMember(invitedBy, guildId);
    db.prepare('UPDATE members SET invites = invites + 1 WHERE user_id = ? AND guild_id = ?').run(invitedBy, guildId);
  }
}

function upsertInvite(code, guildId, inviterId, uses) {
  db.prepare('INSERT OR REPLACE INTO invites (invite_code, guild_id, inviter_id, uses) VALUES (?, ?, ?, ?)').run(code, guildId, inviterId, uses);
}

function getInvite(code, guildId) {
  return db.prepare('SELECT * FROM invites WHERE invite_code = ? AND guild_id = ?').get(code, guildId);
}

function getAllInvites(guildId) {
  return db.prepare('SELECT * FROM invites WHERE guild_id = ?').all(guildId);
}

function addReward(name, type, description, guildId) {
  try {
    db.prepare('INSERT INTO rewards (name, type, description, guild_id) VALUES (?, ?, ?, ?)').run(name, type, description, guildId);
    return true;
  } catch {
    return false;
  }
}

function removeReward(name, guildId) {
  const result = db.prepare('DELETE FROM rewards WHERE name = ? AND guild_id = ?').run(name, guildId);
  return result.changes > 0;
}

function listRewards(guildId) {
  return db.prepare('SELECT * FROM rewards WHERE guild_id = ?').all(guildId);
}

function getReward(name, guildId) {
  return db.prepare('SELECT * FROM rewards WHERE name = ? AND guild_id = ?').get(name, guildId);
}

function createPaymentRequest(userId, guildId, amount, requestedBy, channelId) {
  const result = db.prepare(
    'INSERT INTO payment_requests (user_id, guild_id, amount, requested_by, channel_id) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, guildId, amount, requestedBy, channelId);
  return result.lastInsertRowid;
}

function getPaymentRequest(id) {
  return db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(id);
}

function getPendingPayment(userId, guildId) {
  return db.prepare("SELECT * FROM payment_requests WHERE user_id = ? AND guild_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").get(userId, guildId);
}

function completePayment(id) {
  db.prepare("UPDATE payment_requests SET status = 'completed' WHERE id = ?").run(id);
}

function cancelPayment(id) {
  db.prepare("UPDATE payment_requests SET status = 'cancelled' WHERE id = ?").run(id);
}

function giveUserReward(userId, guildId, rewardId, givenBy, amount = 0) {
  db.prepare(
    'INSERT INTO user_rewards (user_id, guild_id, reward_id, given_by, payment_amount, payment_status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, guildId, rewardId, givenBy, amount, amount > 0 ? 'pending' : 'free');
  return db.prepare('SELECT last_insert_rowid() as id').get().id;
}

function getUserRewards(userId, guildId) {
  return db.prepare(`
    SELECT ur.*, r.name, r.type, r.description
    FROM user_rewards ur
    JOIN rewards r ON ur.reward_id = r.id
    WHERE ur.user_id = ? AND ur.guild_id = ?
    ORDER BY ur.given_at DESC
  `).all(userId, guildId);
}

function markRewardPaid(userRewardId) {
  db.prepare("UPDATE user_rewards SET payment_status = 'paid' WHERE id = ?").run(userRewardId);
}

function hasReceivedReward(userId, guildId, rewardId) {
  const row = db.prepare("SELECT id FROM user_rewards WHERE user_id = ? AND guild_id = ? AND reward_id = ? AND payment_status != 'cancelled'").get(userId, guildId, rewardId);
  return !!row;
}

function getGuildSettings(guildId) {
  let settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
  if (!settings) {
    db.prepare('INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)').run(guildId);
    settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
  }
  return settings;
}

function setGuildSetting(guildId, key, value) {
  getGuildSettings(guildId);
  db.prepare(`UPDATE guild_settings SET ${key} = ? WHERE guild_id = ?`).run(value, guildId);
}

module.exports = {
  db, initDatabase,
  getOrCreateMember, incrementMessages, addVoiceMinutes,
  startVoiceSession, endVoiceSession, getMemberStats, getLeaderboard,
  setInvitedBy, upsertInvite, getInvite, getAllInvites,
  addReward, removeReward, listRewards, getReward,
  createPaymentRequest, getPaymentRequest, getPendingPayment, completePayment, cancelPayment,
  giveUserReward, getUserRewards, markRewardPaid, hasReceivedReward,
  getGuildSettings, setGuildSetting,
};
