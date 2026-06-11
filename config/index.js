import 'dotenv/config';

export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.DISCORD_GUILD_ID,
  },
  oanda: {
    apiKey: process.env.OANDA_API_KEY,
    accountId: process.env.OANDA_ACCOUNT_ID,
    env: process.env.OANDA_ENV || 'practice',
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
};
