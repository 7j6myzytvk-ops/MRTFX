import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from '../config/index.js';
import { getXauUsdPrice } from '../services/oanda.js';

const commands = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Toon de status van het systeem en de huidige XAU/USD koers'),
].map((c) => c.toJSON());

export async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  await rest.put(
    Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
    { body: commands },
  );
}

export function createBot() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once('ready', () => {
    console.log(`Ingelogd als ${client.user.tag}`);
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'status') return;

    await interaction.deferReply();
    try {
      const price = await getXauUsdPrice();
      await interaction.editReply(
        `Systeem actief.\nXAU/USD - bid: ${price.bid}, ask: ${price.ask}\n(${price.time})`,
      );
    } catch (err) {
      await interaction.editReply(`Kon koers niet ophalen: ${err.message}`);
    }
  });

  return client;
}
