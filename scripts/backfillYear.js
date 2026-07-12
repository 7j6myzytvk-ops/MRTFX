// scripts/backfillYear.js
// 1-jaar backtest van de conditie-checker + TP/SL simulatie op historische data.
//
// Verschillen t.o.v. backfillConditions.js:
// 1. POINT-IN-TIME D1/W1: per tick worden alleen de candles gebruikt die op dat
//    moment al beschikbaar waren. Cruciaal voor een jaar: goud was grotendeels
//    bullish in H2 2025 en bearish in mid-2026. Een snapshot van nu zou dat missen.
// 2. TP/SL SIMULATIE: na elke trigger wordt gesimuleerd of TP of SL geraakt wordt
//    binnen 48 H1-candles (ATR-gebaseerd: SL=1×ATR, TP=2×ATR, R:R 2.0 — live-target).
// 3. KWALITEITSFILTERS: ATR >= $13 en SMA-gap <= $50 worden afzonderlijk bijgehouden.
// 4. TWEEPUNTSALGORITME: O(N+M) i.p.v. O(N×M) — draait snel ook voor een heel jaar.
//
// Gebruik: node scripts/backfillYear.js [van] [tot]
// Standaard: afgelopen jaar tot vandaag.

import { getXauUsdCandles } from '../services/marketData.js';
import { filterFlatCandles } from '../agents/outcomeEvaluator.js';
import { checkConditions, isActiveSession, isActiveDay } from '../services/conditionChecker.js';
import { sma, atr } from '../agents/indicators.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '../data/backtest-candles.json');

// --cached: sla API-calls over en laad van disk. Voeg --save-cache toe om te forceren.
const USE_CACHE = process.argv.includes('--cached');
const SAVE_CACHE = process.argv.includes('--save-cache') || !USE_CACHE;

const args = process.argv.filter((a) => !a.startsWith('--'));
const to = args[3] ? new Date(args[3]) : new Date();
const from = args[2]
  ? new Date(args[2])
  : new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);

// Haalt candles op in stukken zodat de ~5000-candle limiet van Twelve Data
// niet wordt overschreden. Wacht 1.2 seconden tussen chunks (rate limit: 8/min).
async function fetchAllCandles(granularity, fromDate, toDate) {
  const chunkMs = {
    W:   400 * 24 * 3600 * 1000,  // W1: heel jaar in één keer (~52 candles)
    D:   400 * 24 * 3600 * 1000,  // D1: heel jaar in één keer (~260 candles)
    H1:  180 * 24 * 3600 * 1000,  // H1: per 6 maanden (~2300 session-candles)
    M30:  90 * 24 * 3600 * 1000,  // M30: per 3 maanden
    M15:  45 * 24 * 3600 * 1000,  // M15: per 6 weken
  }[granularity] ?? 180 * 24 * 3600 * 1000;

  const all = [];
  let cursor = new Date(fromDate);
  let chunk = 0;

  while (cursor < toDate) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + chunkMs, toDate.getTime()));
    // Altijd 9 seconden wachten — ook vóór de eerste chunk van elke granularity.
    // Twelve Data staat 8 calls/minuut toe; 9s spacing = max 6/min = ruim binnen limiet.
    await new Promise((r) => setTimeout(r, 9000));
    process.stdout.write(`  ${granularity} [${cursor.toISOString().slice(0, 10)} → ${chunkEnd.toISOString().slice(0, 10)}]... `);
    try {
      const raw = await getXauUsdCandles({ granularity, from: cursor.toISOString(), to: chunkEnd.toISOString() });
      const filtered = (granularity === 'D' || granularity === 'W')
        ? raw.filter((c) => c.high !== c.low)
        : filterFlatCandles(raw);
      console.log(`${filtered.length} candles`);
      all.push(...filtered);
    } catch (err) {
      console.log(`FOUT: ${err.message} (chunk overgeslagen)`);
    }
    cursor = chunkEnd;
    chunk++;
  }

  // Dedupliceer en sorteer oplopend op tijd
  const seen = new Set();
  return all
    .filter((c) => !seen.has(c.time) && seen.add(c.time))
    .sort((a, b) => a.time.localeCompare(b.time));
}

// Simuleer TP/SL: kijk 48 H1-candles vooruit na de trigger.
// SL = 1×ATR14 tegen de richting, TP = 2×ATR14 mee met de richting (R:R 2.0 — live-target).
function simulateOutcome(allH1, h1Ptr, direction, atr14, entryPrice) {
  const sl = direction === 'bearish' ? entryPrice + atr14 : entryPrice - atr14;
  const tp = direction === 'bearish' ? entryPrice - atr14 * 2 : entryPrice + atr14 * 2;
  const start = h1Ptr + 1;
  const end = Math.min(start + 48, allH1.length);

  for (let i = start; i < end; i++) {
    const c = allH1[i];
    if (direction === 'bearish') {
      if (c.low <= tp) return { result: 'tp', candlesToHit: i - start + 1, sl, tp };
      if (c.high >= sl) return { result: 'sl', candlesToHit: i - start + 1, sl, tp };
    } else {
      if (c.high >= tp) return { result: 'tp', candlesToHit: i - start + 1, sl, tp };
      if (c.low <= sl) return { result: 'sl', candlesToHit: i - start + 1, sl, tp };
    }
  }
  return { result: 'geen', candlesToHit: null, sl, tp };
}

// Kwaliteitsfilters: ATR >= $13 en SMA-gap <= $50 van H1 SMA20.
function checkQuality(h1Slice, entryPrice, direction) {
  const closes = h1Slice.map((c) => c.close);
  const atr14 = atr(h1Slice, 14);
  const sma20 = sma(closes, 20);
  const blockers = [];

  if (atr14 != null && atr14 < 13) {
    blockers.push(`ATR $${atr14.toFixed(1)} < $13`);
  }
  if (sma20 != null) {
    const gap = entryPrice - sma20;
    if (direction === 'bearish' && gap < -50) blockers.push(`$${Math.abs(gap).toFixed(0)} onder SMA20`);
    if (direction === 'bullish' && gap > 50) blockers.push(`$${gap.toFixed(0)} boven SMA20`);
  }
  return { passed: blockers.length === 0, atr14, sma20, blockers };
}

// ==================== MAIN ====================

console.log(`\n=== 1-JAAR BACKTEST XAU/USD ===`);
console.log(`Periode: ${from.toISOString().slice(0, 10)} t/m ${to.toISOString().slice(0, 10)}\n`);

// 25 dagen buffer vóór `from` zodat bias-berekening al bij de eerste tick genoeg
// candle-history heeft (computeTimeframeBias vereist minimaal 20 candles).
const bufferFrom = new Date(from.getTime() - 25 * 24 * 3600 * 1000);

let w1All, d1All, h1All, m30All, m15All;

if (USE_CACHE && existsSync(CACHE_PATH)) {
  console.log(`Cache geladen van ${CACHE_PATH}`);
  const cached = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  w1All = cached.w1; d1All = cached.d1; h1All = cached.h1;
  m30All = cached.m30; m15All = cached.m15;
} else {
  console.log(`Candles ophalen (sequentieel, ~2-3 minuten voor M15)...`);
  w1All  = await fetchAllCandles('W',   bufferFrom, to);
  d1All  = await fetchAllCandles('D',   bufferFrom, to);
  h1All  = await fetchAllCandles('H1',  bufferFrom, to);
  m30All = await fetchAllCandles('M30', bufferFrom, to);
  m15All = await fetchAllCandles('M15', bufferFrom, to);
  if (SAVE_CACHE) {
    writeFileSync(CACHE_PATH, JSON.stringify({ w1: w1All, d1: d1All, h1: h1All, m30: m30All, m15: m15All }));
    console.log(`Cache opgeslagen → ${CACHE_PATH}`);
  }
}

console.log(`\nData geladen:`);
console.log(`  W1: ${w1All.length} | D1: ${d1All.length} | H1: ${h1All.length} | M30: ${m30All.length} | M15: ${m15All.length}`);

if (h1All.length === 0) {
  console.error('\nGeen H1-data ontvangen. Controleer API-sleutel en data-plan.');
  process.exit(1);
}
if (m15All.length < 100) {
  console.warn('\n⚠️  Weinig M15-data ontvangen. Historische M15-data is beperkt op het huidige Twelve Data-plan.');
  console.warn('   Ticks zonder voldoende M15-candles worden overgeslagen.\n');
}

// ==================== SIMULATIELUS ====================

const COOLDOWN_MS = 4 * 3600 * 1000;
const triggers = [];
let lastTriggerTime = null;
let simulated = 0;
let skippedData = 0;

// Tweepuntspointers: O(N+M) in plaats van O(N×M) filtering per tick.
// Pointer wijst naar de laatste candle met time <= huidige tick.
let h1Ptr = 0, m30Ptr = 0, m15Ptr = 0, d1Ptr = 0, w1Ptr = 0;

for (let t = new Date(from); t <= to; t = new Date(t.getTime() + 3600 * 1000)) {
  const dayOfWeek = t.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) continue;
  if (!isActiveSession(t)) continue;

  const iso = t.toISOString();

  // Pointers vooruitschuiven tot de meest recente candle <= iso
  while (h1Ptr + 1 < h1All.length && h1All[h1Ptr + 1].time <= iso) h1Ptr++;
  while (m30Ptr + 1 < m30All.length && m30All[m30Ptr + 1].time <= iso) m30Ptr++;
  while (m15Ptr + 1 < m15All.length && m15All[m15Ptr + 1].time <= iso) m15Ptr++;
  while (d1Ptr + 1 < d1All.length && d1All[d1Ptr + 1].time <= iso) d1Ptr++;
  while (w1Ptr + 1 < w1All.length && w1All[w1Ptr + 1].time <= iso) w1Ptr++;

  const h1Slice  = h1All.slice(Math.max(0, h1Ptr - 49), h1Ptr + 1);
  const m30Slice = m30All.slice(Math.max(0, m30Ptr - 99), m30Ptr + 1);
  const m15Slice = m15All.slice(Math.max(0, m15Ptr - 99), m15Ptr + 1);
  const d1Slice  = d1All.slice(Math.max(0, d1Ptr - 29), d1Ptr + 1);
  const w1Slice  = w1All.slice(Math.max(0, w1Ptr - 24), w1Ptr + 1);

  if (h1Slice.length < 20 || m30Slice.length < 20 || m15Slice.length < 20) {
    skippedData++;
    continue;
  }

  // Sla tick over als M15-data meer dan 3 dagen oud is t.o.v. huidige tick.
  // Verouderde M15-data (door ontbrekende API-chunks) geeft systematisch
  // verkeerde bias en leidt tot misleidende backtest-resultaten.
  const m15LastTime = m15Slice[m15Slice.length - 1]?.time;
  if (m15LastTime && (t.getTime() - new Date(m15LastTime).getTime()) > 3 * 24 * 3600 * 1000) {
    skippedData++;
    continue;
  }

  simulated++;
  const conditions = checkConditions({
    h1Candles: h1Slice,
    m30Candles: m30Slice,
    m15Candles: m15Slice,
    d1Candles: d1Slice,
    w1Candles: w1Slice,
    now: t,
  });

  if (!conditions.triggered) continue;

  // 4-uur cooldown
  if (lastTriggerTime && t.getTime() - lastTriggerTime.getTime() < COOLDOWN_MS) continue;
  lastTriggerTime = t;

  const entryPrice = h1Slice[h1Slice.length - 1].close;
  const { direction } = conditions;
  const quality = checkQuality(h1Slice, entryPrice, direction);
  const outcome = simulateOutcome(h1All, h1Ptr, direction, quality.atr14 ?? 10, entryPrice);

  triggers.push({
    time: iso,
    month: iso.slice(0, 7),
    direction,
    entryPrice,
    quality,
    outcome,
    _h1Ptr: h1Ptr, // bewaard voor R:R re-simulatie zonder extra API-calls
  });
}

console.log(`\n${simulated} uren gesimuleerd | ${skippedData} overgeslagen (te weinig data)\n`);

if (triggers.length === 0) {
  console.log('Geen triggers gevonden in deze periode.');
  process.exit(0);
}

// ==================== RESULTATEN ====================

function winRate(tp, sl) {
  const total = tp + sl;
  return total === 0 ? null : Math.round((tp / total) * 1000) / 10;
}

function summarize(list, label) {
  const tp   = list.filter((t) => t.outcome.result === 'tp').length;
  const sl   = list.filter((t) => t.outcome.result === 'sl').length;
  const geen = list.filter((t) => t.outcome.result === 'geen').length;
  const wr   = winRate(tp, sl);
  const wrStr = wr != null ? `${wr}%` : 'n.v.t.';
  console.log(`${label.padEnd(34)} N=${String(list.length).padStart(3)} | TP=${tp} SL=${sl} geen=${geen} | WinRate=${wrStr}`);
}

const hasAtrBlock = (t) => t.quality.blockers.some((b) => b.includes('ATR'));
const hasSmaBlock = (t) => t.quality.blockers.some((b) => b.includes('SMA20'));

const allT    = triggers;
const atrOnly = triggers.filter((t) => !hasAtrBlock(t));
const smaOnly = triggers.filter((t) => !hasSmaBlock(t));
const combo   = triggers.filter((t) => t.quality.passed);
const bullish = triggers.filter((t) => t.direction === 'bullish');
const bearish = triggers.filter((t) => t.direction === 'bearish');

console.log('=== SAMENVATTING ===\n');
summarize(allT,    'Geen filter (baseline)');
summarize(atrOnly, 'Filter: ATR >= $13');
summarize(smaOnly, 'Filter: SMA-gap <= $50');
summarize(combo,   'Combo (ATR + SMA-gap)');
console.log('');
if (bullish.length > 0) summarize(bullish, 'Richting: bullish (baseline)');
if (bearish.length > 0) summarize(bearish, 'Richting: bearish (baseline)');

const comboBull = combo.filter((t) => t.direction === 'bullish');
const comboBear = combo.filter((t) => t.direction === 'bearish');
if (comboBull.length > 0) summarize(comboBull, 'Combo + bullish');
if (comboBear.length > 0) summarize(comboBear, 'Combo + bearish');

// Maandoverzicht
console.log('\n=== MAANDOVERZICHT (combo-filter) ===\n');
const months = [...new Set(triggers.map((t) => t.month))].sort();
for (const month of months) {
  const raw  = triggers.filter((t) => t.month === month);
  const filt = combo.filter((t) => t.month === month);
  const tp   = filt.filter((t) => t.outcome.result === 'tp').length;
  const sl   = filt.filter((t) => t.outcome.result === 'sl').length;
  const wr   = winRate(tp, sl);
  const dirs = raw.map((t) => (t.direction === 'bullish' ? 'B' : 'S')).join('');
  console.log(
    `${month}  raw=${String(raw.length).padStart(2)} gefilterd=${String(filt.length).padStart(2)} | TP=${tp} SL=${sl} | WR=${wr != null ? wr + '%' : 'n.v.t.'.padEnd(5)} | ${dirs}`,
  );
}

// Triggerdetail
console.log('\n=== TRIGGER DETAIL ===\n');
console.log('Datum/tijd (UTC)    Richting  Entry    ATR    Kwaliteit                → Uitkomst');
console.log('─'.repeat(85));
for (const t of triggers) {
  const q  = t.quality.passed ? '✓ OK' : `✗ ${t.quality.blockers.join(', ')}`;
  const o  = t.outcome.result === 'tp' ? '✅ TP' : t.outcome.result === 'sl' ? '❌ SL' : '➖ geen';
  const sl = t.outcome.sl != null ? `SL=${t.outcome.sl.toFixed(0)}` : '';
  const tp = t.outcome.tp != null ? `TP=${t.outcome.tp.toFixed(0)}` : '';
  console.log(
    `${t.time.slice(0, 16)}  ${t.direction.padEnd(8)} ${t.entryPrice.toFixed(0).padStart(6)}  ` +
    `${(t.quality.atr14 ?? 0).toFixed(1).padStart(5)}  ${q.padEnd(28)} → ${o} ${sl} ${tp}`,
  );
}

// ==================== R:R OPTIMALISATIE ====================
// Simuleert dezelfde triggers opnieuw met andere TP-multipliers.
// Geen API-calls — werkt op de h1All-data die al in geheugen zit.

function simRR(allH1, ptr, direction, atr14, entry, rrRatio) {
  const sl = direction === 'bearish' ? entry + atr14 : entry - atr14;
  const tp = direction === 'bearish' ? entry - atr14 * rrRatio : entry + atr14 * rrRatio;
  for (let i = ptr + 1; i < Math.min(ptr + 49, allH1.length); i++) {
    const c = allH1[i];
    if (direction === 'bearish') {
      if (c.low <= tp) return 'tp';
      if (c.high >= sl) return 'sl';
    } else {
      if (c.high >= tp) return 'tp';
      if (c.low <= sl) return 'sl';
    }
  }
  return 'geen';
}

function rrRow(label, list, rr) {
  let tp = 0, sl = 0, geen = 0;
  for (const t of list) {
    const r = simRR(h1All, t._h1Ptr, t.direction, t.quality.atr14 ?? 10, t.entryPrice, rr);
    if (r === 'tp') tp++; else if (r === 'sl') sl++; else geen++;
  }
  const total = tp + sl;
  const wr = total === 0 ? null : tp / total;
  const ev = wr != null ? (wr * rr - (1 - wr)).toFixed(3) : 'n.v.t.';
  const wrStr = wr != null ? (wr * 100).toFixed(1) + '%' : 'n.v.t.';
  const beStr = (100 / (1 + rr)).toFixed(1) + '%';
  return `${label.padEnd(25)} 1:${String(rr.toFixed(1)).padEnd(4)} BE=${beStr.padEnd(7)} TP=${String(tp).padStart(3)} SL=${String(sl).padStart(3)} geen=${String(geen).padStart(2)} WR=${wrStr.padEnd(7)} EV=${ev}`;
}

console.log('\n=== R:R OPTIMALISATIE ===\n');
for (const rr of [1.0, 1.5, 2.0, 2.5, 3.0]) {
  console.log(rrRow(`Baseline (N=${allT.length})`,         allT,    rr));
  console.log(rrRow(`Combo-filter (N=${combo.length})`,    combo,   rr));
  console.log(rrRow(`Bearish only (N=${bearish.length})`,  bearish, rr));
  console.log(rrRow(`Bullish only (N=${bullish.length})`,  bullish, rr));
  console.log('');
}

// ==================== TIJDSTIP-ANALYSE ====================

console.log('=== TIJDSTIP-ANALYSE (baseline, alle triggers) ===\n');
console.log(`Uur (UTC)   N    TP   SL   WinRate   Bullish  Bearish`);
for (let h = 8; h <= 16; h++) {
  const hs = String(h).padStart(2, '0');
  const ht = allT.filter((t) => t.time.slice(11, 13) === hs);
  if (ht.length === 0) continue;
  const tp = ht.filter((t) => t.outcome.result === 'tp').length;
  const sl = ht.filter((t) => t.outcome.result === 'sl').length;
  const bull = ht.filter((t) => t.direction === 'bullish').length;
  const bear = ht.filter((t) => t.direction === 'bearish').length;
  const wr = winRate(tp, sl);
  console.log(`${hs}:00       ${String(ht.length).padStart(3)}  ${String(tp).padStart(3)}  ${String(sl).padStart(3)}  ${(wr != null ? wr + '%' : 'n.v.t.').padEnd(9)} ${String(bull).padStart(4)}     ${String(bear).padStart(4)}`);
}

// ==================== DAG-ANALYSE ====================

console.log('\n=== DAG-ANALYSE (baseline, alle triggers) ===\n');
const DAGNAMEN = ['', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag'];
console.log(`Dag           N    TP   SL   WinRate`);
for (let d = 1; d <= 5; d++) {
  const dt = allT.filter((t) => new Date(t.time).getUTCDay() === d);
  if (dt.length === 0) continue;
  const tp = dt.filter((t) => t.outcome.result === 'tp').length;
  const sl = dt.filter((t) => t.outcome.result === 'sl').length;
  const wr = winRate(tp, sl);
  console.log(`${DAGNAMEN[d].padEnd(14)}${String(dt.length).padStart(3)}  ${String(tp).padStart(3)}  ${String(sl).padStart(3)}  ${wr != null ? wr + '%' : 'n.v.t.'}`);
}

console.log(`\nKlaar. ${triggers.length} triggers gesimuleerd over ${months.length} maanden.`);
