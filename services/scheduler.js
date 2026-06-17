import { config } from '../config/index.js';
import { getRecentRealCandles, getRecentEurUsdCandles, getRecentUsYieldCandles, getRecentXauD1Candles } from './marketData.js';
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
      const dollarCandles = await getRecentEurUsdCandles({ granularity: 'H1', count: 50 });
      const yieldCandles = await getRecentUsYieldCandles({ count: 25 });
      const d1Candles = await getRecentXauD1Candles({ count: 30 });
      const result = await runBoardroom(candles, { dollarCandles, yieldCandles, d1Candles });
      await reportToDiscord(client, result);
      await evaluateOpenSignals(client);
    } catch (err) {
      console.error('Boardroom-scheduler mislukt:', err.message);
    }
  }

  console.log(`Boardroom-scheduler actief, elke ${intervalMinutes} minuten.`);
  tick();
  setInterval(tick, intervalMinutes * 60 * 1000);
}
