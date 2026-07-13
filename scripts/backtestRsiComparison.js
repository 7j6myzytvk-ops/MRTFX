/**
 * Vergelijkt de oude RSI50-drempel met de nieuwe RSI52/45-drempel voor
 * de condition-checker over de live periode.
 *
 * Stap 1: Simuleert elke 5-minuten-poll tijdens sessionuren (13:00-17:00 UTC)
 *         op weekdagen en classificeert: triggert oud én nieuw / alleen nieuw /
 *         alleen oud / geen van beide.
 *
 * Stap 2: Draait de volledige boardroom op alle triggers (oud én nieuw) om
 *         CEO-beslissingen en uitkomsten te vergelijken.
 *
 * Gebruik: node scripts/backtestRsiComparison.js [dagen]
 * Standaard: 22 dagen (de volledige live periode tot nu)
 */

import path from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { getXauUsdCandles, getEurUsdCandles, getUsYieldCandles } from '../services/marketData.js';
import { sma, rsi } from '../agents/indicators.js';
import { filterFlatCandles, evaluateOutcome, HORIZON_CANDLES } from '../agents/outcomeEvaluator.js';
import { runDiscussion } from '../agents/boardroom.js';

const DAYS = Number(process.argv[2]) || 22;
const endDate = new Date();
const startDate = new Date(endDate.getTime() - DAYS * 24 * 60 * 60 * 1000);
// Extra lookback zodat indicatoren genoeg data hebben aan het begin van de periode
const fetchFrom = new Date(startDate.getTime() - 5 * 24 * 60 * 60 * 1000);

const OUT_FILE = path.join(process.cwd(), 'data', 'rsiComparison.json');

console.log(`\n=== RSI-drempel vergelijking: ${startDate.toISOString().slice(0, 10)} – ${endDate.toISOString().slice(0, 10)} ===\n`);

// ─── BIAS FUNCTIES ────────────────────────────────────────────────────────────

function biasOld(candles) {
  if (!candles || candles.length < 20) return 'mixed';
  const closes = candles.map((c) => c.close);
  const cur = closes[closes.length - 1];
  let bull = 0, bear = 0;
  const s20 = sma(closes, 20);
  if (s20 != null) { cur > s20 ? bull++ : bear++; }
  const r14 = rsi(closes, 14);
  if (r14 != null) { r14 > 50 ? bull++ : bear++; }
  if (closes.length >= 4) {
    const last = closes.slice(-3);
    if (last[0] < last[1] && last[1] < last[2]) bull++;
    else if (last[0] > last[1] && last[1] > last[2]) bear++;
  }
  if (bull > bear) return 'bullish';
  if (bear > bull) return 'bearish';
  return 'mixed';
}

function biasNew(candles) {
  if (!candles || candles.length < 20) return 'mixed';
  const closes = candles.map((c) => c.close);
  const cur = closes[closes.length - 1];
  let bull = 0, bear = 0;
  const s20 = sma(closes, 20);
  if (s20 != null) { cur > s20 ? bull++ : bear++; }
  const r14 = rsi(closes, 14);
  if (r14 != null) {
    if (r14 > 52) bull++;
    else if (r14 < 45) bear++;
    // 45-52: neutraal, telt niet mee
  }
  if (closes.length >= 4) {
    const last = closes.slice(-3);
    if (last[0] < last[1] && last[1] < last[2]) bull++;
    else if (last[0] > last[1] && last[1] > last[2]) bear++;
  }
  if (bull > bear) return 'bullish';
  if (bear > bull) return 'bearish';
  return 'mixed';
}

function conditionCheck(biasFn, h1, m30, w1) {
  const h1Bias = biasFn(h1);
  const m30Bias = biasFn(m30);
  const w1Bias = biasFn(w1);

  if (w1Bias === 'mixed') return { triggered: false, reason: 'W1 mixed' };

  const tfAligned = (h1Bias === 'bullish' && m30Bias === 'bullish') ||
                    (h1Bias === 'bearish' && m30Bias === 'bearish');
  if (!tfAligned) return { triggered: false, reason: `TF niet aligned (H1:${h1Bias} M30:${m30Bias})` };

  const tfDir = h1Bias;
  if (tfDir !== w1Bias) return { triggered: false, reason: `TF(${tfDir}) vs W1(${w1Bias})` };

  return { triggered: true, direction: tfDir };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function isWeekday(d) { const day = d.getUTCDay(); return day >= 1 && day <= 5; }
function isSession(d) { const h = d.getUTCHours(); return h >= 13 && h < 17; }

// Candles beschikbaar tot en met tijdstip T (exclusief toekomstige candles)
function upTo(candles, isoTime) {
  return candles.filter((c) => c.time <= isoTime);
}

// ─── DATA OPHALEN ─────────────────────────────────────────────────────────────

console.log('Candledata ophalen...');
const fromStr = fetchFrom.toISOString();
const toStr = endDate.toISOString();

// W1-data heeft extra vroege historie nodig voor de trendindicatoren
const w1FetchFrom = new Date(fetchFrom.getTime() - 25 * 7 * 24 * 60 * 60 * 1000).toISOString();

const [
  rawH1, rawM30, rawM15,
  rawD1, rawW1,
  rawEur, rawYield,
] = await Promise.all([
  getXauUsdCandles({ granularity: 'H1', from: fromStr, to: toStr }),
  getXauUsdCandles({ granularity: 'M30', from: fromStr, to: toStr }),
  getXauUsdCandles({ granularity: 'M15', from: fromStr, to: toStr }),
  getXauUsdCandles({ granularity: 'D', from: new Date(fetchFrom.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString(), to: toStr }),
  getXauUsdCandles({ granularity: 'W', from: w1FetchFrom, to: toStr }),
  getEurUsdCandles({ granularity: 'H1', from: fromStr, to: toStr }),
  getUsYieldCandles({ granularity: 'D', from: new Date(fetchFrom.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), to: toStr }),
]);

const h1All  = filterFlatCandles(rawH1);
const m30All = filterFlatCandles(rawM30);
const m15All = filterFlatCandles(rawM15);
const d1All  = rawD1.filter((c) => c.high !== c.low);
const w1All  = rawW1.filter((c) => c.high !== c.low);
const eurAll = rawEur.filter((c) => c.high !== c.low);
const yldAll = rawYield.filter((c) => c.high !== c.low);

console.log(`H1: ${h1All.length} | M30: ${m30All.length} | M15: ${m15All.length} | D1: ${d1All.length} | W1: ${w1All.length}`);

// ─── STAP 1: CONDITION CHECK SIMULATIE ───────────────────────────────────────

console.log('\nCondition-checker simuleren per poll (elke 5 min, 13:00–17:00 UTC, weekdagen)...');

// Genereer alle poll-tijdstippen in de periode
const pollTimes = [];
const cursor = new Date(startDate);
cursor.setUTCSeconds(0, 0);
while (cursor <= endDate) {
  if (isWeekday(cursor) && isSession(cursor) && cursor.getUTCMinutes() % 5 === 0) {
    pollTimes.push(cursor.toISOString());
  }
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
}

console.log(`${pollTimes.length} poll-momenten in sessionuren.`);

const triggerOldOnly = [];
const triggerNewOnly = [];
const triggerBoth    = [];
let totalPolls = 0;

for (const t of pollTimes) {
  const h1  = upTo(h1All, t).slice(-100);
  const m30 = upTo(m30All, t).slice(-100);
  const w1  = upTo(w1All, t).slice(-20);

  if (h1.length < 20 || m30.length < 20 || w1.length < 5) continue;
  totalPolls++;

  const old_ = conditionCheck(biasOld, h1, m30, w1);
  const new_ = conditionCheck(biasNew, h1, m30, w1);

  if (old_.triggered && new_.triggered) triggerBoth.push({ t, direction: new_.direction });
  else if (!old_.triggered && new_.triggered) triggerNewOnly.push({ t, direction: new_.direction, oldReason: old_.reason });
  else if (old_.triggered && !new_.triggered) triggerOldOnly.push({ t, direction: old_.direction, newReason: new_.reason });
}

console.log(`\nResultaten condition-checker:`);
console.log(`  Polls gesimuleerd     : ${totalPolls}`);
console.log(`  Beide triggeren       : ${triggerBoth.length}`);
console.log(`  Alleen NIEUW triggert : ${triggerNewOnly.length}  ← extra door RSI-aanpassing`);
console.log(`  Alleen OUD triggert   : ${triggerOldOnly.length}  ← triggers die nieuw verliest`);
console.log(`  Geen van beide        : ${totalPolls - triggerBoth.length - triggerNewOnly.length - triggerOldOnly.length}`);

// ─── STAP 2: BOARDROOM RUNS ───────────────────────────────────────────────────
// We draaien de boardroom op: BEIDE-triggers + NIEUW-only triggers.
// OUD-only triggers zijn ook interessant maar lopen op het live systeem al mee.

// Dedupliceer: als polls dicht op elkaar zitten, gebruiken we max 1 per uur
// (anders overlapt de cooldown en zijn het niet echt aparte setups).
function deduplicateHourly(list) {
  const seen = new Set();
  return list.filter(({ t }) => {
    const hourKey = t.slice(0, 13); // bijv. "2026-07-01T14"
    if (seen.has(hourKey)) return false;
    seen.add(hourKey);
    return true;
  });
}

const bothDedup    = deduplicateHourly(triggerBoth);
const newOnlyDedup = deduplicateHourly(triggerNewOnly);

const toRun = [
  ...bothDedup.map((x) => ({ ...x, type: 'both' })),
  ...newOnlyDedup.map((x) => ({ ...x, type: 'new-only' })),
].sort((a, b) => a.t.localeCompare(b.t));

console.log(`\nBoardroom draaien op ${toRun.length} unieke trigger-momenten (gededupliceerd per uur)...`);
console.log('(Dit duurt even — elk moment kost 5-6 Claude API-calls)\n');

const boardroomResults = [];
const MAX_ATTEMPTS = 3;

for (let i = 0; i < toRun.length; i++) {
  const { t, direction, type, oldReason, newReason } = toRun[i];

  const h1Window  = upTo(h1All, t).slice(-50);
  const d1Window  = upTo(d1All, t).slice(-30);
  const w1Window  = upTo(w1All, t).slice(-20);
  const eurWindow = upTo(eurAll, t).filter((_, __, arr) => true).slice(-50);
  const yldWindow = upTo(yldAll, t).slice(-25);
  const h1Future  = h1All.filter((c) => c.time > t).slice(0, HORIZON_CANDLES);

  if (h1Window.length < 20) {
    console.log(`[${i + 1}/${toRun.length}] ${t.slice(0, 16)} OVERGESLAGEN (te weinig data)`);
    continue;
  }

  let result;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      result = await runDiscussion(h1Window, {
        instrument: 'XAU_USD',
        granularity: 'H1',
        dollarCandles: eurWindow,
        yieldCandles: yldWindow,
        d1Candles: d1Window,
        w1Candles: w1Window,
        currentTime: t,
        newsItems: [],
        newsContext: `\n\nAlgoritmische trigger (${type === 'new-only' ? 'ALLEEN NIEUWE RSI-logica' : 'BEIDE RSI-versies'}): H1+M30 ${direction} aligned, W1 ${direction}. Historische heranalyse — geen live nieuwscontext beschikbaar.`,
      });
      break;
    } catch (err) {
      console.log(`  poging ${attempt}/${MAX_ATTEMPTS} mislukt: ${err.message}`);
      if (attempt === MAX_ATTEMPTS) break;
    }
  }

  if (!result) {
    console.log(`[${i + 1}/${toRun.length}] ${t.slice(0, 16)} → MISLUKT`);
    continue;
  }

  const { decision, qualityResult } = result;
  const entryPrice = h1Window[h1Window.length - 1].close;
  const outcome = h1Future.length >= 5 ? evaluateOutcome(decision, h1Future) : { result: 'onvoldoende-data', candlesToHit: null };

  const entry = {
    pollTime: t,
    type,
    conditionDirection: direction,
    oldReason: oldReason ?? null,
    newReason: newReason ?? null,
    entryPrice,
    signal: decision.signal,
    confidence: decision.confidence,
    qualityPassed: qualityResult?.passed ?? null,
    qualityBlockers: qualityResult?.blockers ?? [],
    outcome: outcome.result,
    candlesToHit: outcome.candlesToHit,
    forwardCandlesAvailable: h1Future.length,
  };

  boardroomResults.push(entry);

  const tag = type === 'new-only' ? '🆕' : '🔁';
  const qual = qualityResult?.passed === false ? ` [gefilterd: ${qualityResult.blockers.slice(0, 1).join(',')}]` : '';
  console.log(
    `[${i + 1}/${toRun.length}] ${tag} ${t.slice(0, 16)} UTC | ${direction.toUpperCase()} cond ` +
    `→ CEO: ${decision.signal.toUpperCase()} (${decision.confidence}%)${qual} → ${outcome.result.toUpperCase()}`
  );
}

// ─── RAPPORT ──────────────────────────────────────────────────────────────────

const newOnlyResults = boardroomResults.filter((r) => r.type === 'new-only');
const bothResults    = boardroomResults.filter((r) => r.type === 'both');

function stats(list) {
  const directional = list.filter((r) => r.signal !== 'neutral' && r.qualityPassed !== false);
  const tp = directional.filter((r) => r.outcome === 'tp').length;
  const sl = directional.filter((r) => r.outcome === 'sl').length;
  const open = directional.filter((r) => r.outcome === 'geen' || r.outcome === 'onvoldoende-data').length;
  return { n: list.length, directional: directional.length, tp, sl, open };
}

const s1 = stats(newOnlyResults);
const s2 = stats(bothResults);

console.log('\n' + '═'.repeat(60));
console.log('EINDRAPPORT');
console.log('═'.repeat(60));
console.log(`Periode        : ${startDate.toISOString().slice(0, 10)} – ${endDate.toISOString().slice(0, 10)}`);
console.log(`Polls          : ${totalPolls} (weekdagen 13:00–17:00 UTC, elke 5 min)`);
console.log('');
console.log('CONDITION CHECKER:');
console.log(`  Beide versies triggeren        : ${triggerBoth.length} polls (${bothDedup.length} uniek per uur)`);
console.log(`  Alleen NIEUW triggert (extra)  : ${triggerNewOnly.length} polls (${newOnlyDedup.length} uniek per uur)`);
console.log(`  Alleen OUD triggert (verlies)  : ${triggerOldOnly.length} polls (${deduplicateHourly(triggerOldOnly).length} uniek per uur)`);
console.log('');
console.log(`BOARDROOM — NIEUWE-ONLY triggers (${s1.n} runs):`);
console.log(`  CEO directioneel : ${s1.directional} | TP: ${s1.tp} | SL: ${s1.sl} | Open/onvoldoende: ${s1.open}`);
if (s1.directional > 0) {
  const wr = Math.round((s1.tp / (s1.tp + s1.sl)) * 100);
  if (s1.tp + s1.sl > 0) console.log(`  Winrate (TP/SL)  : ${wr}%`);
}
console.log('');
console.log(`BOARDROOM — BEIDE triggers (${s2.n} runs):`);
console.log(`  CEO directioneel : ${s2.directional} | TP: ${s2.tp} | SL: ${s2.sl} | Open/onvoldoende: ${s2.open}`);
if (s2.directional > 0 && s2.tp + s2.sl > 0) {
  const wr = Math.round((s2.tp / (s2.tp + s2.sl)) * 100);
  console.log(`  Winrate (TP/SL)  : ${wr}%`);
}
console.log('═'.repeat(60));

// Sla volledig rapport op
const report = {
  generatedAt: new Date().toISOString(),
  period: { from: startDate.toISOString(), to: endDate.toISOString(), days: DAYS },
  conditionChecker: {
    totalPolls,
    triggerBoth: triggerBoth.length,
    triggerBothUnique: bothDedup.length,
    triggerNewOnly: triggerNewOnly.length,
    triggerNewOnlyUnique: newOnlyDedup.length,
    triggerOldOnly: triggerOldOnly.length,
    triggerOldOnlyUnique: deduplicateHourly(triggerOldOnly).length,
  },
  boardroomResults,
};

await mkdir(path.dirname(OUT_FILE), { recursive: true });
await writeFile(OUT_FILE, JSON.stringify(report, null, 2));
console.log(`\nVolledig rapport opgeslagen in data/rsiComparison.json`);
