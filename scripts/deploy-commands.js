require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { buildCommands } = require('../src/commands');

async function main() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !clientId) throw new Error('Set DISCORD_TOKEN and DISCORD_CLIENT_ID in .env first.');

  const rest = new REST({ version: '10' }).setToken(token);
  const commands = buildCommands();
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log(`Registered ${commands.length} guild commands in ${guildId}.`);
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log(`Registered ${commands.length} global commands.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
