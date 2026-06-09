require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { loadCommands } = require('./utils/loader');
const { loadEvents } = require('./utils/eventLoader');
const { initDatabase } = require('./utils/database');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

client.commands = new Collection();
client.slashCommands = new Collection();
client.prefix = process.env.PREFIX || '!';

initDatabase();
loadCommands(client);
loadEvents(client);

client.login(process.env.BOT_TOKEN).catch(err => {
  console.error('Failed to login:', err.message);
  process.exit(1);
});
