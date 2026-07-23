// Replay wat de boardroom (met HUIDIGE filters) zou hebben gedaan op historische candles.
// Gebruikt de echte H1/M30/M15/EUR/yield-candles voor het opgegeven venster.
// D1/W1/H4 zijn snapshots van nu — vereenvoudiging die de analyse niet wezenlijk raakt
// op een venster van 1–2 weken (D1/W1-trend verandert niet fundamenteel in die periode).
//
// Gebruik: node scripts/replayTriggers.js [vanaf-datum] [tot-datum]
// Voorbeeld: node scripts/replayTriggers.js 2026-07-13 2026-07-22
//
// Kanttekening: newsItems is altijd leeg (geen historisch nieuws beschikbaar op deze
// API-tier). Economische kalender en macro-briefing worden wel live opgehaald.

import {
  getXauUsdCandles,
  getEurUsdCandles,
  getUsYieldCandles,
  getRecentXauD1Candles,
  getRecentXauW1Candles,
  getRecentXauH4Candles,
} from '../services/marketData.js';
import { filterFlatCandles } from '../agents/outcomeEvaluator.js';
import { checkConditions, isActiveSession, formatConditionContext } from '../services/conditionChecker.js';
import { runDiscussion } from '../agents/boardroom.js';

// Huidige productie-cooldown (Fase 84: 25 min na elke boardroom-run)
const COOLDOWN_MS = 25 * 60 * 1000;

const DEFAULT_FROM = '2026-07-13T00:00:00Z';
const from = process.argv[2] ? new Date(process.argv[2]) : new Date(DEFAULT_FROM);
const to   = process.argv[3] ? new Date(process.argv[3]) : new Date('2026-07-23T00:00:00Z');

// 5 werkdagen extra pre-load zodat de eerste candle-slices genoeg lookback hebben
const fetchFrom = new Date(from.getTime() - 5 * 24 * 60 * 60 * 1000);

console.log(`\n====================================================`);
console.log(` REPLAY: ${from.toISOString().slice(0,10)} → ${to.toISOString().slice(0,10)}`);
console.log(`====================================================\n`);
console.log(`Candles ophalen (${fetchFrom.toISOString().slice(0,10)} t/m ${to.toISOString().slice(0,10)})...`);

const [h1Raw, m30Raw, m15Raw, eurRaw, yieldRaw, d1Candles, w1Candles, h4Candles] = await Promise.all([
  getXauUsdCandles({ granularity: 'H1',  from: fetchFrom.toISOString(), to: to.toISOString() }),
  getXauUsdCandles({ granularity: 'M30', from: fetchFrom.toISOString(), to: to.toISOString() }),
  getXauUsdCandles({ granularity: 'M15', from: fetchFrom.toISOString(), to: to.toISOString() }),
  getEurUsdCandles({ granularity: 'H1',  from: fetchFrom.toISOString(), to: to.toISOString() }),
  getUsYieldCandles({ granularity: 'D',  from: fetchFrom.toISOString(), to: to.toISOString() }),
  getRecentXauD1Candles({ count: 30 }),
  getRecentXauW1Candles({ count: 20 }),
  getRecentXauH4Candles({ count: 50 }),
]);

const h1Candles  = filterFlatCandles(h1Raw);
const m30Candles = filterFlatCandles(m30Raw);
const m15Candles = filterFlatCandles(m15Raw);
const eurCandles = eurRaw.filter((c) => c.high !== c.low);

console.log(`H1: ${h1Candles.length} | M30: ${m30Candles.length} | M15: ${m15Candles.length} | EUR/USD: ${eurCandles.length} | US2Y: ${yieldRaw.length} | H4: ${h4Candles.length}\n`);

const results = [];
let lastSignalTime = null;
let checked = 0;
let triggeredRaw = 0;
let skippedCooldown = 0;
let ranBoardroom = 0;

for (let t = new Date(from); t <= to; t = new Date(t.getTime() + 60 * 60 * 1000)) {
  if (!isActiveSession(t)) continue;

  const iso = t.toISOString();
  const h1Slice  = h1Candles.filter((c)  => c.time <= iso).slice(-50);
  const m30Slice = m30Candles.filter((c) => c.time <= iso).slice(-100);
  const m15Slice = m15Candles.filter((c) => c.time <= iso).slice(-100);
  if (h1Slice.length < 20 || m30Slice.length < 20 || m15Slice.length < 20) continue;

  checked++;
  const conditions = checkConditions({
    h1Candles: h1Slice, m30Candles: m30Slice, m15Candles: m15Slice,
    d1Candles, w1Candles, h4Candles, now: t,
  });

  if (!conditions.triggered) continue;
  triggeredRaw++;

  if (lastSignalTime && t.getTime() - lastSignalTime < COOLDOWN_MS) {
    skippedCooldown++;
    continue;
  }

  const price = h1Slice[h1Slice.length - 1].close;
  console.log(`\n── ${iso.slice(0,16)} UTC ─────────────────────────────────`);
  const modeTag = conditions.trendMode ? ' | 🔵 TREND-MODUS' : '';
  const ctTag = !conditions.trendMode && conditions.details.isCounterTrend ? ' | ⚠️ COUNTER-TREND (W1 bearish)' : '';
  console.log(`   Richting: ${conditions.direction.toUpperCase()} | Prijs: $${price.toFixed(2)}${modeTag}${ctTag}`);
  console.log(`   Boardroom samengesteld...`);

  lastSignalTime = t.getTime();
  ranBoardroom++;

  const dollarCandles  = eurCandles.filter((c) => c.time <= iso).slice(-50);
  const yieldCandles   = yieldRaw.filter((c)   => c.time <= iso).slice(-25);
  const conditionContext = formatConditionContext(conditions);

  let result;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      result = await runDiscussion(h1Slice, {
        granularity: 'H1',
        dollarCandles,
        yieldCandles,
        h4Candles,
        d1Candles,
        w1Candles,
        newsItems: [],
        newsContext: conditionContext,
        trendMode: conditions.trendMode,
        currentTime: t,
      });
      break;
    } catch (err) {
      if (attempt < 4 && (err.status === 529 || err.status === 529 || err.message?.includes('overloaded'))) {
        const wait = attempt * 30000;
        console.log(`   ⏳ API overloaded, wacht ${wait/1000}s (poging ${attempt}/4)...`);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }

  const { decision, qualityResult, discussion } = result;
  const score = discussion.analyst.setupQualityScore ?? '?';
  const da    = discussion.devilsAdvocate?.counterConfidence ?? '?';

  console.log(`   CEO:    ${decision.signal.toUpperCase()} (${decision.confidence}%)`);
  console.log(`   Score:  ${score}/5 | DA counter: ${da}%`);
  console.log(`   Filter: ${qualityResult.passed ? '✓ PASSED' : '✗ GEBLOKKEERD — ' + qualityResult.blockers.join(', ')}`);
  if (decision.stopLoss && decision.takeProfit) {
    const rr = Math.abs(decision.takeProfit - price) / Math.abs(price - decision.stopLoss);
    console.log(`   SL: $${decision.stopLoss?.toFixed(2)} | TP: $${decision.takeProfit?.toFixed(2)} | R:R ≈ 1:${rr.toFixed(1)}`);
  }
  console.log(`   CEO-redenering: ${decision.reasoning?.slice(0, 200)}...`);

  results.push({
    time: iso.slice(0,16),
    direction: conditions.direction,
    price: price.toFixed(2),
    isCounterTrend: conditions.details.isCounterTrend,
    signal: decision.signal,
    confidence: decision.confidence,
    score,
    da,
    passed: qualityResult.passed,
    blockers: qualityResult.blockers,
    sl: decision.stopLoss,
    tp: decision.takeProfit,
    reasoning: decision.reasoning,
  });
}

console.log(`\n\n${'='.repeat(54)}`);
console.log(` SAMENVATTING`);
console.log(`${'='.repeat(54)}`);
console.log(`Periode:        ${from.toISOString().slice(0,10)} → ${to.toISOString().slice(0,10)}`);
console.log(`Uren in sessie: ${checked}`);
console.log(`Raw triggers:   ${triggeredRaw} (H1+M30 aligned)`);
console.log(`Na cooldown:    ${ranBoardroom} boardroom-runs`);
console.log(`Overgeslagen:   ${skippedCooldown} (binnen 25-min cooldown)`);
console.log();

const directional = results.filter(r => r.signal !== 'neutral');
const passed      = results.filter(r => r.passed);
const bullish     = results.filter(r => r.signal === 'bullish');
const bearish     = results.filter(r => r.signal === 'bearish');
const neutral     = results.filter(r => r.signal === 'neutral');

console.log(`Boardroom-uitkomsten:`);
console.log(`  Bullish:  ${bullish.length}`);
console.log(`  Bearish:  ${bearish.length}`);
console.log(`  Neutral:  ${neutral.length}`);
console.log(`  Passed kwaliteitsfilter: ${passed.length}/${results.length}`);
console.log();

if (results.length > 0) {
  console.log(`Alle signals:`);
  console.log(`Tijdstip          Richting  Signaal   Conf  Score  Filter   Prijs`);
  console.log(`${'─'.repeat(70)}`);
  for (const r of results) {
    const ct  = r.isCounterTrend ? '⚠️' : '  ';
    const flt = r.passed ? '✓' : '✗';
    const line = [
      ct,
      r.time.padEnd(16),
      r.direction.padEnd(9),
      r.signal.padEnd(9),
      (r.confidence + '%').padEnd(6),
      (r.score + '/5').padEnd(7),
      flt.padEnd(9),
      '$' + r.price,
    ].join(' ');
    console.log(line);
  }
}
