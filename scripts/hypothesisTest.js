/**
 * Hypothesetest: H4 (Donchian), H5 (London-open breakout), H6 (H2 + D1-trendfilter)
 *
 * Pre-specified parameters — niet wijzigen zonder nieuw hypothesenummer.
 *
 * Gebruik:
 *   node scripts/hypothesisTest.js --cached --from 2024-11-01          # alle drie
 *   node scripts/hypothesisTest.js --cached --from 2024-11-01 --h4     # alleen H4
 *   node scripts/hypothesisTest.js --cached --from 2024-11-01 --h5     # alleen H5
 *   node scripts/hypothesisTest.js --cached --from 2024-11-01 --h6     # alleen H6
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getXauUsdCandles } from '../services/marketData.js';
import { checkConditions } from '../services/conditionChecker.js';
import { atr, sma } from '../agents/indicators.js';
import { evaluateOutcome, filterFlatCandles, HORIZON_CANDLES } from '../agents/outcomeEvaluator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '../data/backtest-candles.json');

const args     = process.argv.slice(2);
const USE_CACHE = args.includes('--cached');
const RUN_H4   = args.includes('--h4') || (!args.includes('--h5') && !args.includes('--h6'));
const RUN_H5   = args.includes('--h5') || (!args.includes('--h4') && !args.includes('--h6'));
const RUN_H6   = args.includes('--h6') || (!args.includes('--h4') && !args.includes('--h5'));
function getArg(n) { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; }
const FROM_STR = getArg('--from') ?? '2024-11-01';
const TO_STR   = getArg('--to')   ?? new Date().toISOString().slice(0, 10);
const FROM_H1  = `${FROM_STR} 00:00:00`;
const TO       = `${TO_STR} 23:59:59`;
const FROM_D1  = new Date(new Date(FROM_STR).setMonth(new Date(FROM_STR).getMonth() - 6))
  .toISOString().slice(0, 10) + ' 00:00:00';
const FROM_W1  = new Date(new Date(FROM_STR).setFullYear(new Date(FROM_STR).getFullYear() - 1))
  .toISOString().slice(0, 10) + ' 00:00:00';

const COST_USD = 0.70;
const IS_START = '2026-06-01';
const MIN_H1_HISTORY = 50;

// ── Pre-specified parameters ─────────────────────────────────────────────
const H4 = { ENTRY_PERIOD: 55, TRAIL_PERIOD: 20, SL_ATR_MULT: 2.0 };
const H5 = { ASIAN_START_UTC: 0, ASIAN_END_UTC: 5, BREAKOUT_START_UTC: 7, BREAKOUT_END_UTC: 9, TP_MULT: 2.0, MIN_RANGE: 3.0 };
const H6 = { SL_ATR_MULT: 1.5, TP_ATR_MULT: 3.0 };

// ── Hulpfuncties ─────────────────────────────────────────────────────────

function bootstrap95CI(values, iters = 5000) {
  const n = values.length;
  if (n < 4) return [null, null];
  const s = new Float64Array(iters);
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += values[(Math.random() * n) | 0];
    s[i] = sum / n;
  }
  s.sort();
  return [+s[(0.025 * iters) | 0].toFixed(3), +s[(0.975 * iters) | 0].toFixed(3)];
}

function tradeStats(trades) {
  const counted   = trades.filter(t => t.outcome !== 'geen');
  const tp        = trades.filter(t => t.outcome === 'tp').length;
  const sl        = trades.filter(t => t.outcome === 'sl').length;
  const geen      = trades.filter(t => t.outcome === 'geen').length;
  const wr        = counted.length > 0 ? tp / counted.length : null;
  const withR     = counted.filter(t => t.rMultiple != null);
  if (!withR.length) return { total: trades.length, tp, sl, geen, wr, expectancyR: null, ci: [null,null] };
  const slDists   = withR.map(t => t.slDist);
  const avgSlDist = slDists.reduce((a,b)=>a+b,0) / slDists.length;
  const costR     = avgSlDist > 0 ? COST_USD / avgSlDist : 0;
  const rVals     = withR.map(t => t.rMultiple - costR);
  const expectancyR = +(rVals.reduce((a,b)=>a+b,0) / rVals.length).toFixed(3);
  return { total: trades.length, tp, sl, geen, wr, expectancyR, ci: bootstrap95CI(rVals) };
}

function printStats(label, trades, ci = true) {
  if (!trades.length) { console.log(`  ${label}: geen trades`); return; }
  const s = tradeStats(trades);
  const wr  = s.wr   != null ? `WR ${(s.wr*100).toFixed(0)}%` : 'WR -';
  const er  = s.expectancyR != null ? `E(R)=${s.expectancyR>=0?'+':''}${s.expectancyR}R` : 'E(R)=-';
  const cis = ci && s.ci[0] != null ? ` CI[${s.ci[0]>=0?'+':''}${s.ci[0]}, ${s.ci[1]>=0?'+':''}${s.ci[1]}]` : '';
  console.log(`  ${label}: n=${s.total} (TP=${s.tp} SL=${s.sl} geen=${s.geen}) | ${wr} | ${er}${cis}`);
}

function printBlock(label, trades) {
  console.log(`\n── ${label} (n=${trades.length}) ──`);
  printStats('Totaal', trades);
  printStats('Bullish', trades.filter(t => t.dir === 'bullish'));
  printStats('Bearish', trades.filter(t => t.dir === 'bearish'));
  for (const r of ['trend-up','trend-down','range']) printStats(r, trades.filter(t => t.regime === r));
  const years = [...new Set(trades.map(t => t.year))].sort();
  if (years.length > 1) {
    console.log('  Per jaar:');
    years.forEach(yr => {
      const sub = trades.filter(t => t.year === yr);
      const s = tradeStats(sub);
      const ci = s.ci[0]!=null ? ` CI[${s.ci[0]>=0?'+':''}${s.ci[0]}, ${s.ci[1]>=0?'+':''}${s.ci[1]}]` : '';
      console.log(`    ${yr}: n=${sub.length} | WR ${s.wr!=null?(s.wr*100).toFixed(0)+'%':'-'} | E(R)=${s.expectancyR!=null?(s.expectancyR>=0?'+':'')+s.expectancyR+'R':'-'}${ci}`);
    });
  }
  const oos = trades.filter(t => t.time < IS_START);
  const iis = trades.filter(t => t.time >= IS_START);
  console.log('  IS/OOS:');
  printStats(`  OOS (vóór ${IS_START})`, oos);
  printStats(`  IS  (vanaf ${IS_START})`, iis);
  if (oos.length) {
    for (const r of ['trend-up','trend-down','range']) {
      const sub = oos.filter(t => t.regime === r);
      if (sub.length) printStats(`    OOS ${r}`, sub, false);
    }
  }
}

function detectRegime(d1Window) {
  if (d1Window.length < 60) return 'range';
  const closes   = d1Window.map(c => c.close);
  const now      = sma(closes, 50);
  const prev     = sma(closes.slice(0,-10), 50);
  if (!now || !prev) return 'range';
  const d = now - prev;
  return d > 5 ? 'trend-up' : d < -5 ? 'trend-down' : 'range';
}

// ── Candles laden ────────────────────────────────────────────────────────

async function loadCandles() {
  if (USE_CACHE) {
    const cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
    const inRange = arr => (arr||[]).filter(c => c.time >= FROM_H1 && c.time <= TO);
    const h1  = filterFlatCandles(inRange(cache.h1));
    const m30 = filterFlatCandles(inRange(cache.m30));
    const m15 = filterFlatCandles(inRange(cache.m15));
    const d1  = inRange(cache.d1);
    const w1  = inRange(cache.w1);
    // Voor D1/W1 warmup (regime): gebruik bredere range
    const d1Warm = (cache.d1||[]).filter(c => c.time <= TO);
    const w1Warm = (cache.w1||[]).filter(c => c.time <= TO);
    console.log(`H1: ${h1.length} | D1: ${d1.length} | W1: ${w1.length}`);
    return { h1, m30, m15, d1, w1, d1Warm, w1Warm };
  }
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const h1  = filterFlatCandles(await getXauUsdCandles({ granularity:'H1', from:FROM_H1, to:TO })); await delay(2000);
  const m30 = filterFlatCandles(await getXauUsdCandles({ granularity:'M30', from:FROM_H1, to:TO })); await delay(2000);
  const m15 = filterFlatCandles(await getXauUsdCandles({ granularity:'M15', from:FROM_H1, to:TO })); await delay(2000);
  const d1  = await getXauUsdCandles({ granularity:'D', from:FROM_D1, to:TO }); await delay(2000);
  const w1  = await getXauUsdCandles({ granularity:'W', from:FROM_W1, to:TO });
  return { h1, m30, m15, d1, w1, d1Warm:d1, w1Warm:w1 };
}

// ── H4: Donchian breakout ────────────────────────────────────────────────

function runH4(candles) {
  const { d1Warm } = candles;
  const trades = [];
  let busyUntilIdx = -1;

  // Warmup: 55 D1-candles nodig voor Donchian + 14 voor ATR
  for (let i = H4.ENTRY_PERIOD; i < d1Warm.length - 1; i++) {
    if (i <= busyUntilIdx) continue;

    const candle = d1Warm[i];
    if (candle.time < FROM_H1) continue;  // start pas na FROM

    const prev55 = d1Warm.slice(i - H4.ENTRY_PERIOD, i);  // voorgaande 55 candles (zonder huidige)
    const donHigh55 = Math.max(...prev55.map(c => c.high));
    const donLow55  = Math.min(...prev55.map(c => c.low));
    const atr14     = atr(d1Warm.slice(Math.max(0, i-20), i), 14) ?? 20;
    const regime    = detectRegime(d1Warm.slice(Math.max(0, i-60), i));
    const year      = candle.time.slice(0,4);
    const time      = candle.time.slice(0,10);

    let dir = null;
    if (candle.close > donHigh55) dir = 'bullish';
    else if (candle.close < donLow55) dir = 'bearish';
    if (!dir) continue;

    const entry  = candle.close;
    const slDist = H4.SL_ATR_MULT * atr14;
    const initSL = dir === 'bullish' ? entry - slDist : entry + slDist;

    // Simuleer forward op D1
    let outcome = 'geen', rMultiple = null, exitIdx = null;
    for (let j = i + 1; j < d1Warm.length; j++) {
      const c = d1Warm[j];
      const trail20Prev = d1Warm.slice(j - H4.TRAIL_PERIOD, j);
      if (trail20Prev.length < H4.TRAIL_PERIOD) break;
      const trailStop = dir === 'bullish'
        ? Math.min(...trail20Prev.map(x => x.low))
        : Math.max(...trail20Prev.map(x => x.high));

      // Welke stop is actief? De strengste voor de richting.
      const activeStop = dir === 'bullish'
        ? Math.max(initSL, trailStop)   // hoogste van beide = strengste voor long
        : Math.min(initSL, trailStop);  // laagste voor short

      const hitSL    = dir === 'bullish' ? c.low  <= initSL    : c.high >= initSL;
      const hitTrail = dir === 'bullish' ? c.low  <= trailStop : c.high >= trailStop;

      if (hitSL && (!hitTrail || initSL < trailStop && dir === 'bullish')) {
        // Initiële SL geraakt (slechter stop)
        rMultiple = -1.0;
        outcome   = 'sl';
        exitIdx   = j;
        break;
      }
      if (hitTrail) {
        const exitPrice = trailStop;
        rMultiple = +(( dir === 'bullish' ? exitPrice - entry : entry - exitPrice ) / slDist).toFixed(3);
        outcome   = rMultiple > 0 ? 'tp' : 'sl';
        exitIdx   = j;
        break;
      }
    }

    busyUntilIdx = exitIdx ?? d1Warm.length;
    trades.push({ time, year, dir, regime, outcome, rMultiple, slDist });
  }
  return trades;
}

// ── H5: London open breakout ─────────────────────────────────────────────

function runH5(candles) {
  const { h1 } = candles;
  const trades  = [];
  let busyUntilMs = 0;

  // Groepeer H1-candles per UTC-dag
  const byDate = {};
  for (const c of h1) {
    const d = c.time.slice(0, 10);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(c);
  }

  for (const [date, dayCandles] of Object.entries(byDate).sort()) {
    const asianCandles = dayCandles.filter(c => {
      const h = new Date(c.time).getUTCHours();
      return h >= H5.ASIAN_START_UTC && h <= H5.ASIAN_END_UTC;
    });
    if (asianCandles.length < 3) continue;

    const rangeHigh = Math.max(...asianCandles.map(c => c.high));
    const rangeLow  = Math.min(...asianCandles.map(c => c.low));
    const rangeWidth = rangeHigh - rangeLow;
    if (rangeWidth < H5.MIN_RANGE) continue;

    // Breakout-venster: 07:00–09:59 UTC
    const breakoutCandles = dayCandles.filter(c => {
      const h = new Date(c.time).getUTCHours();
      return h >= H5.BREAKOUT_START_UTC && h <= H5.BREAKOUT_END_UTC;
    });
    if (!breakoutCandles.length) continue;

    let entryCandle = null, dir = null;
    for (const c of breakoutCandles) {
      if (c.close > rangeHigh) { dir = 'bullish'; entryCandle = c; break; }
      if (c.close < rangeLow)  { dir = 'bearish'; entryCandle = c; break; }
    }
    if (!dir) continue;

    const entryTimeMs = new Date(entryCandle.time).getTime();
    if (entryTimeMs < busyUntilMs) continue;  // vorige trade loopt nog

    const entry  = entryCandle.close;
    const sl     = dir === 'bullish' ? rangeLow  : rangeHigh;
    const tp     = dir === 'bullish' ? entry + H5.TP_MULT * rangeWidth : entry - H5.TP_MULT * rangeWidth;
    const slDist = Math.abs(entry - sl);
    if (slDist < 0.5) continue;  // te dicht op entry

    // Zoek H1-index van entryCandle
    const entryIdx = h1.findIndex(c => c.time === entryCandle.time);
    if (entryIdx < 0) continue;
    const futureCandles = h1.slice(entryIdx + 1, entryIdx + 1 + HORIZON_CANDLES);
    const result = evaluateOutcome({ signal: dir, stopLoss: sl, takeProfit: tp }, futureCandles, entry);

    // D1-regime: zoek D1-candles vóór deze dag
    const d1Before = (candles.d1Warm || candles.d1).filter(c => {
      return new Date(c.time).getTime() + 86_400_000 <= entryTimeMs + 3_600_000;
    }).slice(-60);
    const regime = detectRegime(d1Before);
    const year   = date.slice(0, 4);

    const tradeDuration = (result.candlesToHit ?? HORIZON_CANDLES) * 3_600_000;
    busyUntilMs = entryTimeMs + tradeDuration + 3_600_000;

    trades.push({ time: date, year, dir, regime, outcome: result.result, rMultiple: result.rMultiple, slDist });
  }
  return trades;
}

// ── H6: H2 + D1-trendfilter ──────────────────────────────────────────────

function runH6(candles) {
  const { h1, m30, m15, d1Warm, w1Warm } = candles;
  const trades = [];
  let busyUntilIdx = -1;

  for (let i = MIN_H1_HISTORY; i < h1.length - HORIZON_CANDLES; i++) {
    if (i <= busyUntilIdx) continue;

    const candle = h1[i];
    const h1CloseMs = new Date(candle.time).getTime() + 3_600_000;

    const h1Window  = h1.slice(Math.max(0, i-50), i+1);
    const m30Window = m30.filter(c => new Date(c.time).getTime() +   1_800_000 <= h1CloseMs).slice(-100);
    const m15Window = m15.filter(c => new Date(c.time).getTime() +     900_000 <= h1CloseMs).slice(-100);
    const d1Window  = (d1Warm||[]).filter(c => new Date(c.time).getTime() +  86_400_000 <= h1CloseMs).slice(-60);
    const w1Window  = (w1Warm||[]).filter(c => new Date(c.time).getTime() + 604_800_000 <= h1CloseMs).slice(-20);

    if (m30Window.length < 20 || m15Window.length < 20) continue;

    const conditions = checkConditions({
      h1Candles:h1Window, m30Candles:m30Window, m15Candles:m15Window,
      h4Candles:[], d1Candles:d1Window, w1Candles:w1Window,
      now: new Date(candle.time),
    });
    if (!conditions.triggered) continue;

    const regime = detectRegime(d1Window);
    const dir    = conditions.direction;

    // H6-filter: richting moet overeenkomen met D1-regime; range → skip
    if (regime === 'range') continue;
    if (regime === 'trend-up'   && dir !== 'bullish') continue;
    if (regime === 'trend-down' && dir !== 'bearish') continue;

    const atr14 = atr(h1Window.slice(-50), 14) ?? 15;
    const entry = candle.close;
    const sl    = dir === 'bullish' ? entry - H6.SL_ATR_MULT * atr14 : entry + H6.SL_ATR_MULT * atr14;
    const tp    = dir === 'bullish' ? entry + H6.TP_ATR_MULT * atr14 : entry - H6.TP_ATR_MULT * atr14;
    const slDist = H6.SL_ATR_MULT * atr14;

    const futureCandles = h1.slice(i+1, i+1+HORIZON_CANDLES);
    const result = evaluateOutcome({ signal: dir, stopLoss: sl, takeProfit: tp }, futureCandles, entry);

    const tradeDuration = result.candlesToHit ?? HORIZON_CANDLES;
    busyUntilIdx = i + tradeDuration;

    trades.push({
      time: candle.time.slice(0,16), year: candle.time.slice(0,4),
      dir, regime, outcome: result.result, rMultiple: result.rMultiple, slDist,
    });
  }
  return trades;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== HYPOTHESETEST: ${FROM_STR} → ${TO_STR} ===\n`);
  const candles = await loadCandles();
  const divider = '═'.repeat(70);

  if (RUN_H4) {
    console.log('\n' + divider);
    console.log('H4 — Donchian breakout (55-entry / 20-trail / SL=2×ATR D1)');
    console.log(divider);
    const t = runH4(candles);
    printBlock('H4 alle trades', t);
  }

  if (RUN_H5) {
    console.log('\n' + divider);
    console.log('H5 — London open breakout (Aziatische range 00–05 UTC, breakout 07–09, TP=2×range)');
    console.log(divider);
    const t = runH5(candles);
    printBlock('H5 alle trades', t);
  }

  if (RUN_H6) {
    console.log('\n' + divider);
    console.log('H6 — H2 + D1-trendfilter (alleen met de trend, range overgeslagen)');
    console.log(divider);
    const t = runH6(candles);
    printBlock('H6 alle trades', t);

    // Vergelijk H6 met H2 ongefilterd (referentie)
    console.log('\n── H6 vs H2 ongefilterd ──');
    console.log('  H2 (ongefilterd, ná fix): n=838, WR 38%, E(R)=+0.106R, CI[+0.007, +0.205]');
    const s = tradeStats(t);
    console.log(`  H6 (trendfilter):         n=${t.length}, WR ${s.wr!=null?(s.wr*100).toFixed(0)+'%':'-'}, E(R)=${s.expectancyR!=null?(s.expectancyR>=0?'+':'')+s.expectancyR+'R':'-'}, CI${s.ci[0]!=null?`[${s.ci[0]>=0?'+':''}${s.ci[0]}, ${s.ci[1]>=0?'+':''}${s.ci[1]}]`:'-'}`);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
