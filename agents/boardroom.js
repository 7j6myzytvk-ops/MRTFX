import { analyzeCandles, reviewDiscussion } from './analyst.js';
import { assessRisk } from './riskManager.js';
import { challengeAnalysis } from './devilsAdvocate.js';
import { assessSentiment } from './macroAnalyst.js';
import { decide } from './ceo.js';
import { upcomingEvents } from './economicCalendar.js';
import { computeIndicators, formatIndicatorsNote } from './indicators.js';
import { computeDollarContext, formatDollarContextNote } from './dollarContext.js';
import { computeYieldContext, formatYieldContextNote } from './yieldContext.js';
import { isComboSignal, assessSignalQuality } from './agentAnalysis.js';
import { appendSignal } from '../data/store.js';

export async function runDiscussion(
  candles,
  { instrument = 'XAU_USD', granularity = 'H1', newsContext = '', dollarCandles = null, yieldCandles = null } = {},
) {
  const events = upcomingEvents(candles[candles.length - 1].time);
  const indicatorsNote = formatIndicatorsNote(computeIndicators(candles));
  const dollarContextNote =
    dollarCandles && dollarCandles.length >= 2 ? formatDollarContextNote(computeDollarContext(dollarCandles)) : '';
  const yieldContextNote =
    yieldCandles && yieldCandles.length >= 2 ? formatYieldContextNote(computeYieldContext(yieldCandles)) : '';
  // Alle drie de context-notes worden door elke agent op exact dezelfde plek
  // (na newsContextNote, in deze volgorde) aan de prompt toegevoegd - daarom
  // hier samengevoegd tot één string, zodat een nieuwe factor (Fase 16+) alleen
  // hier en niet in alle 6 agent-bestanden hoeft te worden toegevoegd.
  const contextNotes = indicatorsNote + dollarContextNote + yieldContextNote;
  const opts = { instrument, granularity, events, newsContext, contextNotes };

  const analysis = await analyzeCandles(candles, opts);

  const [risk, devilsAdvocate, macro] = await Promise.all([
    assessRisk(candles, analysis, opts),
    challengeAnalysis(candles, analysis, opts),
    assessSentiment(candles, analysis, opts),
  ]);

  const rebuttal = await reviewDiscussion(candles, analysis, { risk, devilsAdvocate, macro }, opts);

  const decision = await decide(candles, { analysis, risk, devilsAdvocate, macro, rebuttal }, opts);

  const entryPrice = candles[candles.length - 1].close;
  const discussion = { analyst: analysis, riskManager: risk, devilsAdvocate, macro, analystRebuttal: rebuttal };
  const sample = { discussion, decision, entryPrice };
  const comboSignal = isComboSignal(sample);
  const qualityResult = assessSignalQuality(sample);

  return {
    instrument,
    granularity,
    entryPrice,
    discussion,
    decision,
    comboSignal,
    qualityResult,
  };
}

export async function runBoardroom(candles, opts = {}) {
  return appendSignal(await runDiscussion(candles, opts));
}
