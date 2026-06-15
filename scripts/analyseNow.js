import { REST, Routes } from 'discord.js';
import { config } from '../config/index.js';
import { getRecentRealCandles, getRecentEurUsdCandles } from '../services/marketData.js';
import { runBoardroom } from '../agents/boardroom.js';
import { formatTraceMessages, formatCeoMessage } from '../services/boardroomReporter.js';

// Optionele actuele marktcontext/nieuws, bv:
//   node scripts/analyseNow.js "Trump kondigde vrede met Iran aan, sterke stijging in goud"
const newsContext = process.argv.slice(2).join(' ');

console.log('Live H1-candles ophalen...');
const candles = await getRecentRealCandles({ granularity: 'H1', count: 50 });
const dollarCandles = await getRecentEurUsdCandles({ granularity: 'H1', count: 50 });

if (newsContext) {
  console.log(`Marktcontext meegegeven aan het team: "${newsContext}"`);
}

const result = await runBoardroom(candles, { newsContext, dollarCandles });
console.log('\nResultaat:', JSON.stringify(result, null, 2));

const { ceoChannelId, traceChannelId } = config.boardroom;
const rest = new REST({ version: '10' }).setToken(config.discord.token);

if (traceChannelId) {
  for (const content of formatTraceMessages(result)) {
    await rest.post(Routes.channelMessages(traceChannelId), { body: { content } });
  }
  console.log('Trace-berichten gepost naar', traceChannelId);
} else {
  console.log('DISCORD_TRACE_CHANNEL_ID niet ingesteld, geen trace-berichten verstuurd.');
}

if (ceoChannelId) {
  await rest.post(Routes.channelMessages(ceoChannelId), { body: { content: formatCeoMessage(result.decision) } });
  console.log('CEO-besluit gepost naar', ceoChannelId);
} else {
  console.log('DISCORD_CEO_CHANNEL_ID niet ingesteld, geen CEO-besluit verstuurd.');
}
