import { config } from '../config/index.js';
import { getRecentRealCandles, getRecentEurUsdCandles, getRecentUsYieldCandles, getRecentXauD1Candles } from './marketData.js';
import { fetchGoldNews } from './newsService.js';
import { runBoardroom } from '../agents/boardroom.js';
import { reportToDiscord } from './boardroomReporter.js';
import { evaluateOpenSignals } from './performanceTracker.js';

async function tick(client, { granularity, candleCount, ceoChannelId, traceChannelId, evaluateOutcomes }) {
  try {
    const candles = await getRecentRealCandles({ granularity, count: candleCount });
    const dollarCandles = await getRecentEurUsdCandles({ granularity: 'H1', count: 50 });
    const yieldCandles = await getRecentUsYieldCandles({ count: 25 });
    const d1Candles = await getRecentXauD1Candles({ count: 30 });
    const newsItems = await fetchGoldNews({ maxItems: 12 });
    const result = await runBoardroom(candles, { granularity, dollarCandles, yieldCandles, d1Candles, newsItems });
    await reportToDiscord(client, result, { ceoChannelId, traceChannelId });
    if (evaluateOutcomes) await evaluateOpenSignals(client);
  } catch (err) {
    console.error(`Boardroom-scheduler [${granularity}] mislukt:`, err.message);
  }
}

function startTimeframeScheduler(client, { granularity, intervalMinutes, candleCount, ceoChannelId, traceChannelId, evaluateOutcomes = false, startDelayMs = 0 }) {
  if (!ceoChannelId) return;
  const intervalMs = intervalMinutes * 60 * 1000;
  console.log(`Boardroom-scheduler [${granularity}] actief, elke ${intervalMinutes} minuten.`);
  setTimeout(() => {
    tick(client, { granularity, candleCount, ceoChannelId, traceChannelId, evaluateOutcomes });
    setInterval(() => tick(client, { granularity, candleCount, ceoChannelId, traceChannelId, evaluateOutcomes }), intervalMs);
  }, startDelayMs);
}

export function startSignalScheduler(client) {
  startTimeframeScheduler(client, {
    granularity: 'H1',
    intervalMinutes: 60,
    candleCount: 50,
    ceoChannelId: config.boardroom.ceoChannelId,
    traceChannelId: config.boardroom.traceChannelId,
    evaluateOutcomes: true,
  });

  startTimeframeScheduler(client, {
    granularity: 'M30',
    intervalMinutes: 30,
    candleCount: 100,
    ceoChannelId: config.boardroom.m30CeoChannelId,
    traceChannelId: config.boardroom.m30TraceChannelId,
    startDelayMs: 75_000,
  });

  startTimeframeScheduler(client, {
    granularity: 'M15',
    intervalMinutes: 15,
    candleCount: 100,
    ceoChannelId: config.boardroom.m15CeoChannelId,
    traceChannelId: config.boardroom.m15TraceChannelId,
    startDelayMs: 150_000,
  });
}
