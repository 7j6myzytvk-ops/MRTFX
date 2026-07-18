import { analyzeCandles, reviewDiscussion } from './analyst.js';
import { assessRisk } from './riskManager.js';
import { challengeAnalysis } from './devilsAdvocate.js';
import { assessSentiment } from './macroAnalyst.js';
import { decide } from './ceo.js';
import { fetchForexFactoryEvents, getUpcomingEvents, getRecentlyReleasedEvents, formatEventsNote } from './economicCalendar.js';
import { computeIndicators, formatIndicatorsNote, atr } from './indicators.js';
import { computeDollarContext, formatDollarContextNote } from './dollarContext.js';
import { computeYieldContext, formatYieldContextNote } from './yieldContext.js';
import { isComboSignal, assessSignalQuality } from './agentAnalysis.js';
import { computeDailyContext, formatDailyContextNote } from './dailyContext.js';
import { computeWeeklyContext, formatWeeklyContextNote } from './weeklyContext.js';
import { assessGeopolitical } from './geopoliticalAnalyst.js';
import { appendSignal } from '../data/store.js';
import { getBriefing, formatBriefingNote } from '../services/macroBriefing.js';
import { assessSession, formatSessionNote } from './sessionContext.js';
import {
  getCeoPerformanceBriefing,
  formatCeoPerformanceBriefingNote,
  formatRiskStreakNote,
} from '../services/ceoPerformanceBriefing.js';
import { validateSignalStructure, formatHealthReport } from '../services/signalValidator.js';

export async function runDiscussion(
  candles,
  { instrument = 'XAU_USD', granularity = 'H1', newsContext = '', dollarCandles = null, yieldCandles = null, d1Candles = null, w1Candles = null, newsItems = [], currentTime = null } = {},
) {
  const now = currentTime ? new Date(currentTime) : new Date();
  const ffEvents = await fetchForexFactoryEvents();
  const upcomingEvts = getUpcomingEvents(ffEvents, 48, now);
  const recentEvts = getRecentlyReleasedEvents(ffEvents, 60, now);
  const events = upcomingEvts; // backward compat: agents ontvangen aankomende events via opts.events
  const eventsNote = formatEventsNote(upcomingEvts, recentEvts);
  const indicators = computeIndicators(candles);
  const atrPrev = candles.length > 19 ? atr(candles.slice(0, -5), 14) : null;
  const atrTrend = (indicators.atr14 != null && atrPrev != null)
    ? (indicators.atr14 > atrPrev * 1.05 ? 'stijgend' : indicators.atr14 < atrPrev * 0.95 ? 'dalend' : 'stabiel')
    : null;
  const indicatorsNote = formatIndicatorsNote(indicators);
  const dollarContextNote =
    dollarCandles && dollarCandles.length >= 2 ? formatDollarContextNote(computeDollarContext(dollarCandles)) : '';
  const yieldContextNote =
    yieldCandles && yieldCandles.length >= 2 ? formatYieldContextNote(computeYieldContext(yieldCandles)) : '';
  const d1Ctx = d1Candles && d1Candles.length >= 5 ? computeDailyContext(d1Candles) : null;
  const dailyContextNote = d1Ctx ? formatDailyContextNote(d1Ctx) : '';
  const w1Ctx = w1Candles && w1Candles.length >= 5 ? computeWeeklyContext(w1Candles) : null;
  const weeklyContextNote = w1Ctx ? formatWeeklyContextNote(w1Ctx) : '';
  // Alle context-notes worden door elke agent op exact dezelfde plek
  // (na newsContextNote, in deze volgorde) aan de prompt toegevoegd - daarom
  // hier samengevoegd tot één string, zodat een nieuwe factor alleen
  // hier en niet in alle agent-bestanden hoeft te worden toegevoegd.
  const briefing = await getBriefing();
  const briefingNote = formatBriefingNote(briefing);
  const sessionTime = currentTime ? new Date(currentTime) : new Date();
  const sessionNote = formatSessionNote(assessSession(sessionTime));
  const weekendNote = (() => {
    const day = sessionTime.getUTCDay(); // 5 = vrijdag
    const hour = sessionTime.getUTCHours();
    if (day === 5 && hour >= 12) {
      return '\n\n⚠️ WEEKEND-RISICO: het is vrijdag na 12:00 UTC. XAU/USD gapt over het weekend — een SL die technisch correct is kan door een gap geraakt worden zonder dat de structuur breekt. Risicomanager: verlaag de positiegrootte met één stap t.o.v. de normale berekening.';
    }
    return '';
  })();
  const contextNotes = indicatorsNote + dollarContextNote + yieldContextNote + dailyContextNote + weeklyContextNote + briefingNote + sessionNote + eventsNote + weekendNote;

  const perfStats = await getCeoPerformanceBriefing();
  const ceoBriefingNote = formatCeoPerformanceBriefingNote(perfStats, atrTrend);
  const streakNote = formatRiskStreakNote(perfStats);

  const opts = { instrument, granularity, events, newsContext, contextNotes };

  const analysis = await analyzeCandles(candles, opts);

  const [risk, devilsAdvocate, macro, geopolitical] = await Promise.all([
    assessRisk(candles, analysis, { ...opts, streakNote }),
    challengeAnalysis(candles, analysis, opts),
    assessSentiment(candles, analysis, opts),
    assessGeopolitical(newsItems, { instrument, granularity, events: opts.events || [] }),
  ]);

  // Hard vrijdag-override: positiegrootte altijd één stap kleiner op vrijdag na 12:00 UTC.
  // weekendNote instrueert de riskManager al; dit garandeert het ook als de AI het negeert.
  if (sessionTime.getUTCDay() === 5 && sessionTime.getUTCHours() >= 12 && risk.positionSize !== 'klein') {
    const sizes = ['klein', 'normaal', 'groot'];
    const idx = sizes.indexOf(risk.positionSize);
    if (idx > 0) {
      risk.positionSize = sizes[idx - 1];
      risk.reasoning = `[Weekend gap-override: vrijdag → één stap kleiner] ${risk.reasoning}`;
    }
  }

  const rebuttal = await reviewDiscussion(candles, analysis, { risk, devilsAdvocate, macro, geopolitical }, opts);

  const decision = await decide(candles, { analysis, risk, devilsAdvocate, macro, geopolitical, rebuttal }, { ...opts, ceoBriefingNote });

  // Mechanische confidence-cap: LLM-instructies alleen zijn onvoldoende betrouwbaar
  // voor numerieke grenzen. setupScore ≤4 → max 72% (prompt zegt dit ook, maar de
  // override garandeert het). Wordt zichtbaar in Discord via reasoning-tag.
  if (decision.signal !== 'neutral') {
    const setupScore = analysis.setupQualityScore ?? 6;
    if (setupScore <= 4 && decision.confidence > 72) {
      decision.confidence = 72;
      decision.reasoning = `[Confidence gecapped: setupScore ${setupScore}/6 → max 72%] ${decision.reasoning}`;
    }
  }

  const entryPrice = candles[candles.length - 1].close;
  const discussion = { analyst: analysis, riskManager: risk, devilsAdvocate, macro, geopolitical, analystRebuttal: rebuttal };
  const sample = {
    discussion,
    decision,
    entryPrice,
    dailyTrend: d1Ctx?.trend ?? null,
    weeklyTrend: w1Ctx?.trend ?? null,
    atr14: indicators.atr14,
    sma20H1: indicators.sma20,
  };
  const comboSignal = isComboSignal(sample);
  const qualityResult = assessSignalQuality(sample);

  const eurUsdRate = dollarCandles && dollarCandles.length > 0
    ? dollarCandles[dollarCandles.length - 1].close
    : 1.08;

  const triggerType = opts.triggerType ?? 'condition';
  const fullResult = {
    instrument, granularity, entryPrice, eurUsdRate,
    discussion, decision, comboSignal, qualityResult, triggerType,
    // Context-velden die kwaliteitsfilters (filter 7–9) gebruiken — opgeslagen voor
    // retrospectieve filteranalyse zonder de boardroom opnieuw te hoeven draaien.
    dailyTrend: d1Ctx?.trend ?? null,
    weeklyTrend: w1Ctx?.trend ?? null,
    atr14: indicators.atr14,
    sma20H1: indicators.sma20,
  };
  const validation = validateSignalStructure(fullResult);
  if (!validation.valid || validation.warnings.length > 0) {
    console.warn('[boardroom] ' + formatHealthReport(validation, `${instrument} ${new Date().toISOString()}`));
  }

  return fullResult;
}

export async function runBoardroom(candles, opts = {}) {
  return appendSignal(await runDiscussion(candles, opts));
}
