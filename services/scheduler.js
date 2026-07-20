import { config } from '../config/index.js';
import {
  getRecentRealCandles,
  getRecentEurUsdCandles,
  getRecentUsYieldCandles,
  getRecentXauH4Candles,
  getRecentXauD1Candles,
  getRecentXauW1Candles,
} from './marketData.js';
import { fetchGoldNews } from './newsService.js';
import { runBoardroom } from '../agents/boardroom.js';
import { reportToDiscord } from './boardroomReporter.js';
import { evaluateOpenSignals } from './performanceTracker.js';
import { checkConditions, formatConditionContext, isActiveSession } from './conditionChecker.js';
import { sendDedupedAlert, sendHeartbeat, sendStartupAlert, formatErrorAlert } from './botAlerts.js';
import { checkFtmoLimits } from './ftmoGuard.js';
import { recordConditionCheck } from './conditionDiagnostics.js';
import { detectPriceSpike, formatSpikeContext, SPIKE_COOLDOWN_MS } from './eventMonitor.js';
import { computeIndicators } from '../agents/indicators.js';
import { fetchForexFactoryEvents, getRecentlyReleasedEvents } from '../agents/economicCalendar.js';
import { runDailyReview } from './dailyReview.js';

// Elke 2 minuten controleren — reduceert detectie-latentie zonder de load significant
// te verhogen (gecachede candle-data + 3 verse OANDA-calls per poll).
const POLL_INTERVAL_MS = 2 * 60 * 1000;
// Minimale pauze na een directionale boardroom-uitkomst. Voorkomt redundante runs
// op dezelfde TF-alignment in trending markten (alignment kan uren aanstaan).
// 25 min is lang genoeg voor ruis-preventie, kort genoeg om een nieuwe setup niet te missen.
const MIN_SIGNAL_COOLDOWN_MS = 25 * 60 * 1000;

let lastSignalTime = null;  // tijdstip laatste directionale beslissing (cooldown + heartbeat)
let lastSpikeTime = null;   // aparte cooldown voor event/spike-triggers (2u)
let lastHeartbeatDate = null;
let lastDailyReviewDate = null;

async function poll(client) {
  try {
    // Uitkomsten van openstaande signalen evalueren — ook buiten de sessie en tijdens cooldown.
    // Zo missen we nooit een TP/SL-hit van een gefilterd of eerder signaal.
    await evaluateOpenSignals(client);

    // Dagelijkse trader-review: elke werkdag om 17:25–17:34 UTC (na sessie-einde).
    // Eén keer per dag — onafhankelijk van cooldown en sessie-status.
    {
      const now = new Date();
      const utcH = now.getUTCHours();
      const utcM = now.getUTCMinutes();
      const todayStr = now.toISOString().slice(0, 10);
      const isWeekday = now.getUTCDay() >= 1 && now.getUTCDay() <= 5;
      if (isWeekday && utcH === 17 && utcM >= 25 && utcM < 35 && lastDailyReviewDate !== todayStr) {
        lastDailyReviewDate = todayStr;
        runDailyReview(client).catch((err) => console.error('[dailyReview] Mislukt:', err.message));
      }
    }

    if (!isActiveSession()) return;

    // Dagelijkse heartbeat bij sessiestart (08:xx UTC, 1x per dag)
    const utcHour = new Date().getUTCHours();
    const todayStr = new Date().toISOString().slice(0, 10);
    if (utcHour === 8 && lastHeartbeatDate !== todayStr) {
      lastHeartbeatDate = todayStr;
      await sendHeartbeat(client, lastSignalTime);
    }

    // Candle-data ophalen (H4/D1/W1 gecached, M15/H1 vers per poll)
    const [m15Candles, h1Candles, h4Candles, d1Candles, w1Candles] = await Promise.all([
      getRecentRealCandles({ granularity: 'M15', count: 100 }),
      getRecentRealCandles({ granularity: 'H1', count: 50 }),
      getRecentXauH4Candles({ count: 50 }),
      getRecentXauD1Candles({ count: 30 }),
      getRecentXauW1Candles({ count: 20 }),
    ]);

    // Alle vier voorwaarden controleren
    const conditions = checkConditions({ h1Candles, h4Candles, m15Candles, d1Candles, w1Candles });

    // Puur diagnostisch - beinvloedt de trigger-beslissing niet, legt alleen vast
    // welke voorwaarden wel/niet klopten zodat we later kunnen zien welke conditie
    // het vaakst blokkeert.
    await recordConditionCheck(conditions).catch((err) => {
      console.error('[conditionDiagnostics] Kon conditie-log niet schrijven:', err.message);
    });

    // FTMO-limiet check — blokkeer boardroom als dagelijks/totaal verlies te groot is
    const ftmo = await checkFtmoLimits();
    if (ftmo.blocked) {
      console.warn(`[FTMO] Geblokkeerd: ${ftmo.blockers.join(' | ')}`);
      return;
    }
    if (ftmo.warnings.length > 0) {
      console.warn(`[FTMO] Waarschuwing: ${ftmo.warnings.join(' | ')}`);
    }

    // --- Pad 1: condition-based setup ---
    if (conditions.triggered) {
      if (lastSignalTime && Date.now() - lastSignalTime < MIN_SIGNAL_COOLDOWN_MS) return;

      console.log(`[Setup-trigger] Richting: ${conditions.direction} | ${new Date().toISOString()}`);

      const dollarCandles = await getRecentEurUsdCandles({ granularity: 'H1', count: 50 });
      const yieldCandles = await getRecentUsYieldCandles({ count: 25 });
      const newsItems = await fetchGoldNews({ maxItems: 12 });
      const conditionContext = formatConditionContext(conditions);

      const result = await runBoardroom(h1Candles, {
        granularity: 'H1',
        dollarCandles,
        yieldCandles,
        h4Candles,
        d1Candles,
        w1Candles,
        newsItems,
        newsContext: conditionContext,
        triggerType: 'condition',
      });

      // Altijd cooldown instellen na een boardroom-run, ook bij neutraal.
      // 4H-alignment blijft uren stabiel — zonder neutrale cooldown triggert de
      // boardroom elke 2 minuten zolang conditions.triggered true is.
      lastSignalTime = Date.now();

      await reportToDiscord(client, result);
      return;
    }

    // --- Pad 2: event/spike-trigger (onafhankelijk van conditions) ---
    if (lastSpikeTime && Date.now() - lastSpikeTime < SPIKE_COOLDOWN_MS) return;

    const indicators = computeIndicators(m15Candles);
    const spikeInfo = detectPriceSpike(m15Candles, indicators.atr14);

    if (!spikeInfo.spike) return;

    console.log(`[Event-trigger] Spike ${spikeInfo.spikeMultiple}× ATR | ${spikeInfo.candleTime} | ${spikeInfo.direction}`);
    lastSpikeTime = Date.now();

    const [dollarCandles, yieldCandles, newsItems, ffEvents] = await Promise.all([
      getRecentEurUsdCandles({ granularity: 'H1', count: 50 }),
      getRecentUsYieldCandles({ count: 25 }),
      fetchGoldNews({ maxItems: 12 }),
      fetchForexFactoryEvents(),
    ]);
    const recentFfEvents = getRecentlyReleasedEvents(ffEvents, 30);
    const spikeContext = formatSpikeContext(spikeInfo, newsItems, recentFfEvents);

    const spikeResult = await runBoardroom(h1Candles, {
      granularity: 'H1',
      dollarCandles,
      yieldCandles,
      h4Candles,
      d1Candles,
      w1Candles,
      newsItems,
      newsContext: spikeContext,
      triggerType: 'spike',
    });

    await reportToDiscord(client, spikeResult);
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
