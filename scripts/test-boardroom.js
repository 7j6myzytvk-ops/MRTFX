import { REST, Routes } from 'discord.js';
import { config } from '../config/index.js';
import { runBoardroom } from '../agents/boardroom.js';
import { mockCandles } from '../agents/fixtures/mockCandles.js';
import { formatTraceMessages, formatCeoMessage } from '../services/boardroomReporter.js';

const result = await runBoardroom(mockCandles);
console.log('Resultaat:', JSON.stringify(result, null, 2));

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
