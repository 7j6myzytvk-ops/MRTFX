import { analyzeCandles, reviewDiscussion } from './analyst.js';
import { assessRisk } from './riskManager.js';
import { challengeAnalysis } from './devilsAdvocate.js';
import { assessSentiment } from './macroAnalyst.js';
import { decide } from './ceo.js';
import { upcomingEvents } from './economicCalendar.js';
import { computeIndicators, formatIndicatorsNote } from './indicators.js';
import { appendSignal } from '../data/store.js';

export async function runDiscussion(candles, { instrument = 'XAU_USD', granularity = 'H1', newsContext = '' } = {}) {
  const events = upcomingEvents(candles[candles.length - 1].time);
  const indicatorsNote = formatIndicatorsNote(computeIndicators(candles));
  const opts = { instrument, granularity, events, newsContext, indicatorsNote };

  const analysis = await analyzeCandles(candles, opts);

  const [risk, devilsAdvocate, macro] = await Promise.all([
    assessRisk(candles, analysis, opts),
    challengeAnalysis(candles, analysis, opts),
    assessSentiment(candles, analysis, opts),
  ]);

  const rebuttal = await reviewDiscussion(candles, analysis, { risk, devilsAdvocate, macro }, opts);

  const decision = await decide(candles, { analysis, risk, devilsAdvocate, macro, rebuttal }, opts);

  return {
    instrument,
    granularity,
    discussion: { analyst: analysis, riskManager: risk, devilsAdvocate, macro, analystRebuttal: rebuttal },
    decision,
  };
}

export async function runBoardroom(candles, opts = {}) {
  return appendSignal(await runDiscussion(candles, opts));
}
