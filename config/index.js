import 'dotenv/config';

export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.DISCORD_GUILD_ID,
  },
  marketData: {
    apiKey: process.env.TWELVE_DATA_API_KEY,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  },
  scheduler: {
    intervalMinutes: Number(process.env.SIGNAL_INTERVAL_MINUTES) || 60,
  },
  boardroom: {
    ceoChannelId: process.env.DISCORD_CEO_CHANNEL_ID,
    traceChannelId: process.env.DISCORD_TRACE_CHANNEL_ID,
  },
};
