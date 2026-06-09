const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

function loadCommands(client) {
  const commandsPath = path.join(__dirname, '../commands');
  const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const command = require(path.join(commandsPath, file));
    if (command.name) {
      client.commands.set(command.name, command);
      if (command.aliases) {
        command.aliases.forEach(alias => client.commands.set(alias, command));
      }
    }
    if (command.data) {
      client.slashCommands.set(command.data.name, command);
    }
  }
  console.log(`[LOADER] Loaded ${client.commands.size} prefix commands, ${client.slashCommands.size} slash commands.`);
}

async function registerSlashCommands(client) {
  const commands = [];
  client.slashCommands.forEach(cmd => {
    if (cmd.data) commands.push(cmd.data.toJSON());
  });

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    if (process.env.GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID), { body: commands });
      console.log(`[SLASH] Registered ${commands.length} guild slash commands.`);
    } else {
      await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
      console.log(`[SLASH] Registered ${commands.length} global slash commands.`);
    }
  } catch (err) {
    console.error('[SLASH] Failed to register:', err.message);
  }
}

module.exports = { loadCommands, registerSlashCommands };
