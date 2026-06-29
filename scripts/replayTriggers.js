// Reconstructie van wat de boardroom de afgelopen dagen daadwerkelijk zou
// hebben opgeleverd, NU de ATR-bug in checkKeyLevelProximity is gefixt.
// Gebruikt de echte historische candles (geen synthetische data) en past
// dezelfde 4-uur cooldown toe als scheduler.js, zodat dit geen overschatting
// geeft van het aantal signalen. GEEN aanpassing van het live systeem - dit
// roept runDiscussion() rechtstreeks aan, los van de boardroom-/store-flow.
//
// Gebruik: node scripts/replayTriggers.js [vanaf-datum] [tot-datum]
// Standaard: vanaf 2026-06-22T00:00:00Z tot nu (zelfde venster als
// scripts/backfillConditions.js).
//
// Kanttekening: newsItems is altijd leeg (geen historisch nieuws beschikbaar
// op deze API-tier, zelfde beperking als scripts/backtest.js). D1/W1-trend is
// een snapshot van nu (zelfde vereenvoudiging als backfillConditions.js).

import {
  getXauUsdCandles,
  getEurUsdCandles,
  getUsYieldCandles,
  getRecentXauD1Candles,
  getRecentXauW1Candles,
} from '../services/marketData.js';
import { filterFlatCandles } from '../agents/outcomeEvaluator.js';
import { checkConditions, isActiveSession, formatConditionContext } from '../services/conditionChecker.js';
import { runDiscussion } from '../agents/boardroom.js';

const COOLDOWN_MS = 4 * 60 * 60 * 1000;

const DEFAULT_FROM = '2026-06-22T00:00:00Z';
const from = process.argv[2] ? new Date(process.argv[2]) : new Date(DEFAULT_FROM);
const to = process.argv[3] ? new Date(process.argv[3]) : new Date();
const fetchFrom = new Date(from.getTime() - 5 * 24 * 60 * 60 * 1000);

console.log(`Candles ophalen van ${fetchFrom.toISOString()} t/m ${to.toISOString()}...`);

const [h1Raw, m30Raw, m15Raw, eurRaw, yieldRaw, d1Candles, w1Candles] = await Promise.all([
  getXauUsdCandles({ granularity: 'H1', from: fetchFrom.toISOString(), to: to.toISOString() }),
  getXauUsdCandles({ granularity: 'M30', from: fetchFrom.toISOString(), to: to.toISOString() }),
  getXauUsdCandles({ granularity: 'M15', from: fetchFrom.toISOString(), to: to.toISOString() }),
  getEurUsdCandles({ granularity: 'H1', from: fetchFrom.toISOString(), to: to.toISOString() }),
  getUsYieldCandles({ granularity: 'D', from: fetchFrom.toISOString(), to: to.toISOString() }),
  getRecentXauD1Candles({ count: 30 }),
  getRecentXauW1Candles({ count: 20 }),
]);

const h1Candles = filterFlatCandles(h1Raw);
const m30Candles = filterFlatCandles(m30Raw);
const m15Candles = filterFlatCandles(m15Raw);
const eurCandles = eurRaw.filter((c) => c.high !== c.low);

console.log(`H1: ${h1Candles.length} | M30: ${m30Candles.length} | M15: ${m15Candles.length} | EUR/USD: ${eurCandles.length} | US2Y: ${yieldRaw.length}\n`);

let lastSignalTime = null;
let checked = 0;
let triggeredRaw = 0;
let ranBoardroom = 0;

for (let t = new Date(from); t <= to; t = new Date(t.getTime() + 60 * 60 * 1000)) {
  if (!isActiveSession(t)) continue;

  const iso = t.toISOString();
  const h1Slice = h1Candles.filter((c) => c.time <= iso).slice(-50);
  const m30Slice = m30Candles.filter((c) => c.time <= iso).slice(-100);
  const m15Slice = m15Candles.filter((c) => c.time <= iso).slice(-100);
  if (h1Slice.length < 20 || m30Slice.length < 20 || m15Slice.length < 20) continue;

  checked++;
  const conditions = checkConditions({ h1Candles: h1Slice, m30Candles: m30Slice, m15Candles: m15Slice, d1Candles, w1Candles, now: t });
  if (!conditions.triggered) continue;
  triggeredRaw++;

  // Zelfde cooldown-logica als services/scheduler.js
  if (lastSignalTime && t.getTime() - lastSignalTime < COOLDOWN_MS) {
    console.log(`${iso} -> getriggerd maar binnen cooldown (overgeslagen)`);
    continue;
  }

  console.log(`\n${iso} -> TRIGGER, boardroom wordt samengesteld (richting: ${conditions.direction})...`);
  lastSignalTime = t.getTime();
  ranBoardroom++;

  const dollarCandles = eurCandles.filter((c) => c.time <= iso).slice(-50);
  const yieldCandles = yieldRaw.filter((c) => c.time <= iso).slice(-25);
  const conditionContext = formatConditionContext(conditions);

  const result = await runDiscussion(h1Slice, {
    granularity: 'H1',
    dollarCandles,
    yieldCandles,
    d1Candles,
    w1Candles,
    newsItems: [],
    newsContext: conditionContext,
    currentTime: t,
  });

  const { decision, qualityResult } = result;
  console.log(`  CEO-besluit: ${decision.signal.toUpperCase()} (${decision.confidence}%)`);
  console.log(`  Kwaliteitsfilter: ${qualityResult.passed ? 'PASSED' : 'GEBLOKKEERD'}${qualityResult.blockers.length ? ' - ' + qualityResult.blockers.join(', ') : ''}`);
  console.log(`  setupQualityScore: ${result.discussion.analyst.setupQualityScore ?? '?'}/6`);
  console.log(`  Reasoning: ${decision.reasoning}`);
}

console.log(`\n--- Samenvatting ---`);
console.log(`${checked} uren gecontroleerd, ${triggeredRaw} ruw getriggerd, ${ranBoardroom} boardroom-runs (na cooldown-filter).`);
