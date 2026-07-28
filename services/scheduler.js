import { config } from '../config/index.js';
import {
  getRecentRealCandles,
  getRecentEurUsdCandles,
  getRecentUsYieldCandles,
  getRecentXauH1Candles,
  getRecentXauH4Candles,
  getRecentXauD1Candles,
  getRecentXauW1Candles,
  getXauUsdPrice,
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
import { checkYoutubeChannels } from './youtubeMonitor.js';

// Elke 2 minuten controleren — reduceert detectie-latentie zonder de load significant
// te verhogen (gecachede candle-data + 3 verse OANDA-calls per poll).
const POLL_INTERVAL_MS = 2 * 60 * 1000;
// Minimale pauze na een boardroom-run (ook neutraal): voorkomt dat dezelfde
// 4H-alignment elke 2 minuten een nieuwe boardroom triggert.
const MIN_SIGNAL_COOLDOWN_MS = 25 * 60 * 1000;
// Lockout na een PASSED directional signaal: eenmaal in een trade, geen nieuw
// signaal voor 4 uur. Voorkomt dat meerdere conflicterende signalen tegelijk
// actief zijn terwijl een positie al loopt.
const TRADE_COOLDOWN_MS = 4 * 60 * 60 * 1000;
// Max aantal handelbare signalen per dag. Na bereiken: boardroom loopt niet meer
// voor die sessiedag — beschermt tegen overtrading en gefragmenteerde aandacht.
const MAX_SIGNALS_PER_DAY = 3;

let lastSignalTime = null;       // tijdstip laatste boardroom-run (ook neutraal, cooldown + heartbeat)
let lastTradeSignalTime = null;  // tijdstip laatste PASSED directional signaal (4u trade-lockout)
let dailySignalDate = null;      // sessiedag van de dagelijkse teller (YYYY-MM-DD UTC)
let dailySignalCount = 0;        // aantal PASSED signalen deze dag
let lastSpikeTime = null;        // aparte cooldown voor event/spike-triggers (2u)
let lastHeartbeatDate = null;
let lastDailyReviewDate = null;
let lastOutcomeCheckTime = null; // begrenst evaluateOpenSignals tot 1x per 15 min
let lastYoutubeCheckTime = null; // begrenst YouTube-scan tot 1x per 6 uur

async function poll(client) {
  try {
    // TP/SL-uitkomsten evalueren: max 1x per 15 minuten (H1-candles sluiten per uur,
    // vaker checken levert geen nieuwe informatie maar kost wel een API-call).
    const now = Date.now();
    if (!lastOutcomeCheckTime || now - lastOutcomeCheckTime >= 15 * 60 * 1000) {
      lastOutcomeCheckTime = now;
      await evaluateOpenSignals(client);
    }

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

    // YouTube-kanalen checken op nieuwe video's: 1x per 6 uur.
    if (!lastYoutubeCheckTime || Date.now() - lastYoutubeCheckTime >= 6 * 60 * 60 * 1000) {
      lastYoutubeCheckTime = Date.now();
      checkYoutubeChannels().then((verwerkt) => {
        if (verwerkt.length > 0) {
          console.log(`[YouTube] ${verwerkt.length} nieuwe video('s) verwerkt in kennisbank.`);
        }
      }).catch((e) => console.error('[YouTube] Check mislukt:', e.message));
    }

    if (!isActiveSession()) return;

    // Dagelijkse heartbeat bij sessiestart (08:xx UTC, 1x per dag)
    const utcHour = new Date().getUTCHours();
    const todayStr = new Date().toISOString().slice(0, 10);
    if (utcHour === 8 && lastHeartbeatDate !== todayStr) {
      lastHeartbeatDate = todayStr;
      await sendHeartbeat(client, lastSignalTime);
    }

    // Candle-data ophalen (H1/H4/D1/W1 gecached, M15/M30 vers per poll)
    const [m15Candles, m30Candles, h1Candles, h4Candles, d1Candles, w1Candles] = await Promise.all([
      getRecentRealCandles({ granularity: 'M15', count: 100 }),
      getRecentRealCandles({ granularity: 'M30', count: 100 }),
      getRecentXauH1Candles({ count: 50 }),
      getRecentXauH4Candles({ count: 50 }),
      getRecentXauD1Candles({ count: 30 }),
      getRecentXauW1Candles({ count: 20 }),
    ]);

    // Trigger op H1+M30 alignment; H4 bepaalt mede trendMode en gaat als context mee naar agents
    const conditions = checkConditions({ h1Candles, m30Candles, m15Candles, d1Candles, w1Candles, h4Candles });

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

    // Helperfunctie: registreer een PASSED directional signaal in de dagelijkse teller.
    // Roept de caller aan na reportToDiscord, zodat alleen écht verzonden signalen tellen.
    function registerTradeSignal(result) {
      if (result.decision?.signal === 'neutral' || !result.qualityResult?.passed) return;
      const todayKey = new Date().toISOString().slice(0, 10);
      if (dailySignalDate !== todayKey) { dailySignalDate = todayKey; dailySignalCount = 0; }
      dailySignalCount++;
      lastTradeSignalTime = Date.now();
      console.log(`[Trade-cooldown] Signaal #${dailySignalCount}/${MAX_SIGNALS_PER_DAY} vandaag — 4u lockout actief.`);
    }

    // Controleert of de actuele marktprijs nog binnen $20 van de entry zone zit.
    // Tussen boardroom-analyse (30-60 sec) en Discord-levering kan de prijs verschuiven.
    // Bij > $20 drift: qualityResult wordt als filtered gemarkeerd zodat Discord-bericht
    // duidelijk maakt dat de entry zone voorbij is — het signaal zelf is geldig maar stale.
    async function injectStalenessIfNeeded(result) {
      if (result.decision?.signal === 'neutral') return result;
      if (!result.qualityResult?.passed) return result;
      try {
        const livePrice = await getXauUsdPrice();
        const ez = result.decision?.entryZone ?? '';
        const clean = ez.replace(/\$/g, '').replace(/\s/g, '');
        const match = clean.match(/([\d.]+)[–\-]([\d.]+)/);
        const entryMid = match
          ? (parseFloat(match[1]) + parseFloat(match[2])) / 2
          : result.entryPrice;
        const drift = Math.abs(livePrice - entryMid);
        if (drift > 20) {
          console.log(`[Staleness] Prijs verschoven $${drift.toFixed(0)} van entry zone — signaal gemarkeerd als stale.`);
          return {
            ...result,
            qualityResult: {
              passed: false,
              blockers: [`prijs $${drift.toFixed(0)} verschoven van entry zone (was $${entryMid.toFixed(0)}, nu $${livePrice.toFixed(0)})`],
            },
          };
        }
      } catch (e) {
        console.warn('[Staleness] Live prijs niet beschikbaar:', e.message);
      }
      return result;
    }

    // Gemeenschappelijke pre-check voor beide paden: trade-cooldown en dagmaximum.
    function isTradeLockedOut() {
      if (lastTradeSignalTime && Date.now() - lastTradeSignalTime < TRADE_COOLDOWN_MS) {
        const minLeft = Math.ceil((TRADE_COOLDOWN_MS - (Date.now() - lastTradeSignalTime)) / 60000);
        console.log(`[Trade-cooldown] Actief — ${minLeft} min resterend.`);
        return true;
      }
      const todayKey = new Date().toISOString().slice(0, 10);
      if (dailySignalDate === todayKey && dailySignalCount >= MAX_SIGNALS_PER_DAY) {
        console.log(`[Trade-cooldown] Dagmaximum bereikt (${MAX_SIGNALS_PER_DAY}/dag) — geen nieuwe setups vandaag.`);
        return true;
      }
      return false;
    }

    // --- Pad 1: condition-based setup ---
    if (conditions.triggered) {
      if (lastSignalTime && Date.now() - lastSignalTime < MIN_SIGNAL_COOLDOWN_MS) return;
      if (isTradeLockedOut()) return;

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
        trendMode: conditions.trendMode,
        triggerType: 'condition',
      });

      // Altijd neutrale cooldown instellen na een boardroom-run.
      // 4H-alignment blijft uren stabiel — zonder neutrale cooldown triggert de
      // boardroom elke 2 minuten zolang conditions.triggered true is.
      lastSignalTime = Date.now();

      const checkedResult = await injectStalenessIfNeeded(result);
      await reportToDiscord(client, checkedResult);
      registerTradeSignal(checkedResult);
      return;
    }

    // --- Pad 2: event/spike-trigger (onafhankelijk van conditions) ---
    if (lastSpikeTime && Date.now() - lastSpikeTime < SPIKE_COOLDOWN_MS) return;
    if (isTradeLockedOut()) return;

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

    const checkedSpikeResult = await injectStalenessIfNeeded(spikeResult);
    await reportToDiscord(client, checkedSpikeResult);
    registerTradeSignal(checkedSpikeResult);
  } catch (err) {
    console.error('Setup-detector mislukt:', err.message);
    await sendDedupedAlert(client, err.message, formatErrorAlert(err));
  }
}

// Voert een handmatige boardroom-scan uit buiten het normale sessievenster.
// Bypast isActiveSession() en cooldown-timers — puur voor observatie/testen.
// Telt niet mee in dagelijkse signaallimieten en update geen lockout-timers.
export async function runForceScan(client) {
  const [m15Candles, m30Candles, h1Candles, h4Candles, d1Candles, w1Candles] = await Promise.all([
    getRecentRealCandles({ granularity: 'M15', count: 100 }),
    getRecentRealCandles({ granularity: 'M30', count: 100 }),
    getRecentXauH1Candles({ count: 50 }),
    getRecentXauH4Candles({ count: 50 }),
    getRecentXauD1Candles({ count: 30 }),
    getRecentXauW1Candles({ count: 20 }),
  ]);

  const conditions = checkConditions({ h1Candles, m30Candles, m15Candles, d1Candles, w1Candles, h4Candles });
  const [dollarCandles, yieldCandles, newsItems] = await Promise.all([
    getRecentEurUsdCandles({ granularity: 'H1', count: 50 }),
    getRecentUsYieldCandles({ count: 25 }),
    fetchGoldNews({ maxItems: 12 }),
  ]);

  const sessionLabel = `[FORCE SCAN — buiten regulier sessievenster] ${formatConditionContext(conditions)}`;

  const result = await runBoardroom(h1Candles, {
    granularity: 'H1',
    dollarCandles,
    yieldCandles,
    h4Candles,
    d1Candles,
    w1Candles,
    newsItems,
    newsContext: sessionLabel,
    trendMode: conditions.trendMode,
    triggerType: 'force',
  });

  const checkedResult = await injectStalenessIfNeeded(result);
  await reportToDiscord(client, checkedResult);
  return checkedResult;
}

// Geeft de huidige trade-lockout staat terug voor /status en monitoring.
export function getTradeCooldownState() {
  const now = Date.now();
  const todayKey = new Date().toISOString().slice(0, 10);
  const tradeLockedUntil = lastTradeSignalTime ? lastTradeSignalTime + TRADE_COOLDOWN_MS : null;
  const tradeLockedActive = tradeLockedUntil && now < tradeLockedUntil;
  const signalsToday = dailySignalDate === todayKey ? dailySignalCount : 0;
  return {
    tradeLockedActive: !!tradeLockedActive,
    tradeLockedMinutesLeft: tradeLockedActive ? Math.ceil((tradeLockedUntil - now) / 60000) : 0,
    signalsToday,
    maxSignalsPerDay: MAX_SIGNALS_PER_DAY,
    dayLimitReached: signalsToday >= MAX_SIGNALS_PER_DAY,
  };
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
