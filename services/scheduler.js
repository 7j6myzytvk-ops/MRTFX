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
import { checkConditions, formatConditionContext, isActiveSession } from './conditionChecker.js';
import { sendDedupedAlert, sendHeartbeat, sendStartupAlert, formatErrorAlert } from './botAlerts.js';
import { recordConditionCheck } from './conditionDiagnostics.js';

// Elke 5 minuten controleren — goedkoop (gecachede candle-data + 3 verse calls).
const POLL_INTERVAL_MS = 5 * 60 * 1000;

// Na een signaal wachten we minimaal 4 uur voordat een nieuw signaal mogelijk is.
// Voorkomt dat een aanhoudende trend tientallen signalen achter elkaar genereert.
const COOLDOWN_MS = 4 * 60 * 60 * 1000;

let lastSignalTime = null;
let lastHeartbeatDate = null;

async function poll(client) {
  try {
    // Goedkope checks eerst — geen API-calls als ze falen
    if (lastSignalTime && Date.now() - lastSignalTime < COOLDOWN_MS) return;
    if (!isActiveSession()) return;

    // Dagelijkse heartbeat bij het begin van de sessie (08:xx UTC, 1x per dag)
    const utcHour = new Date().getUTCHours();
    const todayStr = new Date().toISOString().slice(0, 10);
    if (utcHour === 8 && lastHeartbeatDate !== todayStr) {
      lastHeartbeatDate = todayStr;
      await sendHeartbeat(client, lastSignalTime);
    }

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

    // Puur diagnostisch - beinvloedt de trigger-beslissing niet, legt alleen vast
    // welke voorwaarden wel/niet klopten zodat we later kunnen zien welke conditie
    // het vaakst blokkeert.
    await recordConditionCheck(conditions).catch((err) => {
      console.error('[conditionDiagnostics] Kon conditie-log niet schrijven:', err.message);
    });

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
      w1Candles,
      newsItems,
      newsContext: conditionContext,
    });

    await reportToDiscord(client, result);
    await evaluateOpenSignals(client);
  } catch (err) {
    console.error('Setup-detector mislukt:', err.message);
    await sendDedupedAlert(client, err.message, formatErrorAlert(err));
  }
}

export function startSignalScheduler(client) {
  const { ceoChannelId } = config.boardroom;
  if (!ceoChannelId) {
    console.log('Setup-detector uitgeschakeld: stel DISCORD_CEO_CHANNEL_ID in.');
    return;
  }
  console.log(`Setup-detector actief — controleert elke ${POLL_INTERVAL_MS / 60000} minuten op setups.`);
  sendStartupAlert(client);
  poll(client);
  setInterval(() => poll(client), POLL_INTERVAL_MS);
}
