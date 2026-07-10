import { analyzeCandles, reviewDiscussion } from './analyst.js';
import { assessRisk } from './riskManager.js';
import { challengeAnalysis } from './devilsAdvocate.js';
import { assessSentiment } from './macroAnalyst.js';
import { decide } from './ceo.js';
import { fetchForexFactoryEvents, getUpcomingEvents, getRecentlyReleasedEvents, formatEventsNote } from './economicCalendar.js';
import { computeIndicators, formatIndicatorsNote } from './indicators.js';
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
  const indicatorsNote = formatIndicatorsNote(computeIndicators(candles));
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
  const ceoBriefingNote = formatCeoPerformanceBriefingNote(perfStats);
  const streakNote = formatRiskStreakNote(perfStats);

  const opts = { instrument, granularity, events, newsContext, contextNotes };

  const analysis = await analyzeCandles(candles, opts);

  const [risk, devilsAdvocate, macro, geopolitical] = await Promise.all([
    assessRisk(candles, analysis, { ...opts, streakNote }),
    challengeAnalysis(candles, analysis, opts),
    assessSentiment(candles, analysis, opts),
    assessGeopolitical(newsItems, { instrument, granularity, events: opts.events || [] }),
  ]);

  const rebuttal = await reviewDiscussion(candles, analysis, { risk, devilsAdvocate, macro, geopolitical }, opts);

  const decision = await decide(candles, { analysis, risk, devilsAdvocate, macro, geopolitical, rebuttal }, { ...opts, ceoBriefingNote });

  const entryPrice = candles[candles.length - 1].close;
  const discussion = { analyst: analysis, riskManager: risk, devilsAdvocate, macro, geopolitical, analystRebuttal: rebuttal };
  const sample = {
    discussion,
    decision,
    entryPrice,
    dailyTrend: d1Ctx?.trend ?? null,
    weeklyTrend: w1Ctx?.trend ?? null,
  };
  const comboSignal = isComboSignal(sample);
  const qualityResult = assessSignalQuality(sample);

  const fullResult = { instrument, granularity, entryPrice, discussion, decision, comboSignal, qualityResult };
  const validation = validateSignalStructure(fullResult);
  if (!validation.valid || validation.warnings.length > 0) {
    console.warn('[boardroom] ' + formatHealthReport(validation, `${instrument} ${new Date().toISOString()}`));
  }

  return fullResult;
}

export async function runBoardroom(candles, opts = {}) {
  return appendSignal(await runDiscussion(candles, opts));
}
