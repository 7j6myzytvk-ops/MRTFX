import { config } from '../config/index.js';
import { getRecentRealCandles } from './marketData.js';
import { runBoardroom } from '../agents/boardroom.js';
import { reportToDiscord } from './boardroomReporter.js';
import { evaluateOpenSignals } from './performanceTracker.js';

export function startSignalScheduler(client) {
  const { ceoChannelId } = config.boardroom;
  const { intervalMinutes } = config.scheduler;

  if (!ceoChannelId) {
    console.log(
      'Boardroom-scheduler uitgeschakeld: stel DISCORD_CEO_CHANNEL_ID (en optioneel DISCORD_TRACE_CHANNEL_ID) in.',
    );
    return;
  }

  async function tick() {
    try {
      const candles = await getRecentRealCandles({ granularity: 'H1', count: 50 });
      const result = await runBoardroom(candles);
      await reportToDiscord(client, result);
      await evaluateOpenSignals();
    } catch (err) {
      console.error('Boardroom-scheduler mislukt:', err.message);
    }
  }

  console.log(`Boardroom-scheduler actief, elke ${intervalMinutes} minuten.`);
  tick();
  setInterval(tick, intervalMinutes * 60 * 1000);
}
