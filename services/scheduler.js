import { config } from '../config/index.js';
import {
  getRecentRealCandles,
  getRecentEurUsdCandles,
  getRecentUsYieldCandles,
  getRecentXauD1Candles,
  getRecentXauW1Candles,
} from './marketData.js';
import { fetchGoldNews } from './newsService.js';
import { runBoardroom } from '../agents/boardroom.js';
import { reportToDiscord } from './boardroomReporter.js';
import { evaluateOpenSignals } from './performanceTracker.js';
import { checkConditions, formatConditionContext } from './conditionChecker.js';

// Elke 5 minuten controleren — goedkoop (gecachede candle-data + 3 verse calls).
const POLL_INTERVAL_MS = 5 * 60 * 1000;

// Na een signaal wachten we minimaal 4 uur voordat een nieuw signaal mogelijk is.
// Voorkomt dat een aanhoudende trend tientallen signalen achter elkaar genereert.
const COOLDOWN_MS = 4 * 60 * 60 * 1000;

let lastSignalTime = null;

async function poll(client) {
  try {
    // Cooldown-check (goedkoopste check — eerst uitvoeren)
    if (lastSignalTime && Date.now() - lastSignalTime < COOLDOWN_MS) return;

    // Candle-data ophalen (D1 en W1 zijn gecached, M15/M30/H1 vers per poll)
    const [m15Candles, m30Candles, h1Candles, d1Candles, w1Candles] = await Promise.all([
      getRecentRealCandles({ granularity: 'M15', count: 100 }),
      getRecentRealCandles({ granularity: 'M30', count: 100 }),
      getRecentRealCandles({ granularity: 'H1', count: 50 }),
      getRecentXauD1Candles({ count: 30 }),
      getRecentXauW1Candles({ count: 20 }),
    ]);

    // Alle vier voorwaarden controleren
    const conditions = checkConditions({ h1Candles, m30Candles, m15Candles, d1Candles, w1Candles });

    if (!conditions.triggered) return;

    // Alle voorwaarden voldaan → boardroom samenstellen
    console.log(`[Setup-trigger] Richting: ${conditions.direction} | ${new Date().toISOString()}`);
    lastSignalTime = Date.now();

    const dollarCandles = await getRecentEurUsdCandles({ granularity: 'H1', count: 50 });
    const yieldCandles = await getRecentUsYieldCandles({ count: 25 });
    const newsItems = await fetchGoldNews({ maxItems: 12 });
    const conditionContext = formatConditionContext(conditions);

    // Boardroom gebruikt H1-candles als basis; de condition-context wordt
    // als aanvullende noot meegegeven aan alle agents via contextNotes.
    const result = await runBoardroom(h1Candles, {
      granularity: 'H1',
      dollarCandles,
      yieldCandles,
      d1Candles,
      newsItems,
      newsContext: conditionContext,
    });

    await reportToDiscord(client, result);
    await evaluateOpenSignals(client);
  } catch (err) {
    console.error('Setup-detector mislukt:', err.message);
  }
}

export function startSignalScheduler(client) {
  const { ceoChannelId } = config.boardroom;
  if (!ceoChannelId) {
    console.log('Setup-detector uitgeschakeld: stel DISCORD_CEO_CHANNEL_ID in.');
    return;
  }
  console.log(`Setup-detector actief — controleert elke ${POLL_INTERVAL_MS / 60000} minuten op setups.`);
  poll(client);
  setInterval(() => poll(client), POLL_INTERVAL_MS);
}
