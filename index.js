import { createBot, registerCommands } from './discord/bot.js';
import { config } from './config/index.js';

async function main() {
  await registerCommands();
  const bot = createBot();
  await bot.login(config.discord.token);
}

main().catch((err) => {
  console.error('Opstarten mislukt:', err);
  process.exit(1);
});
