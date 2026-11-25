/**
 * Multi-markt hypothesetest: H6 (XAU only), H7-D1 (alle markten, D1-open entry),
 * H7-H1 (alle markten, 08:00/13:00 UTC H1-entry), plus random-benchmark.
 *
 * Data-bronnen:
 *   - Yahoo Finance D1 (2001–nu)  → H7-D1 op 5 instrumenten
 *   - Yahoo Finance H1 (2 jaar)   → H7-H1 op 5 instrumenten
 *   - Twelve Data cache            → H6 op XAU/USD
 *
 * Kosten:
 *   - XAU/USD: cost_R = $0,70 / slDist EN $1,50 / slDist
 *   - Overige: cost_R genormaliseerd (0,019R en 0,040R, equivalent aan XAU ATR=$37)
 *
 * Gebruik:
 *   node scripts/multiMarketTest.js                # alles
 *   node scripts/multiMarketTest.js --h6           # alleen H6
 *   node scripts/multiMarketTest.js --h7d1         # alleen H7-D1
 *   node scripts/multiMarketTest.js --h7h1         # alleen H7-H1
 *   node scripts/multiMarketTest.js --from 2010-01-01
 */

import axios from 'axios';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { checkConditions } from '../services/conditionChecker.js';
import { atr, sma } from '../agents/indicators.js';
import { filterFlatCandles, HORIZON_CANDLES } from '../agents/outcomeEvaluator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '../data/backtest-candles.json');

const args = process.argv.slice(2);
function getArg(n) { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; }
const RUN_H6   = args.includes('--h6')   || (!args.includes('--h7d1') && !args.includes('--h7h1'));
const RUN_H7D1 = args.includes('--h7d1') || (!args.includes('--h6')   && !args.includes('--h7h1'));
const RUN_H7H1 = args.includes('--h7h1') || (!args.includes('--h6')   && !args.includes('--h7d1'));
const FROM_STR = getArg('--from') ?? '2003-01-01';
const IS_START = '2026-06-01';

// Pre-specified parameters H6/H7
const SL_ATR = 1.5;
const TP_ATR = 3.0;
const COST_USD_LOW  = 0.70;
const COST_USD_HIGH = 1.50;
const COST_R_LOW    = 0.019;  // genormaliseerd voor niet-XAU (equiv $0,70 bij ATR=$37)
const COST_R_HIGH   = 0.040;  // genormaliseerd voor niet-XAU (equiv $1,50 bij ATR=$37)
const RANDOM_RUNS   = 50;

// Yahoo Finance instruments
const YF_INSTRUMENTS = {
  'GC=F':     { label: 'XAU/USD', isXau: true },
  'SI=F':     { label: 'XAG/USD', isXau: false },
  'EURUSD=X': { label: 'EUR/USD', isXau: false },
  '^NDX':     { label: 'NAS100',  isXau: false },
  '^GDAXI':   { label: 'GER40',   isXau: false },
};

// ── Hulpfuncties ─────────────────────────────────────────────────────────

function bootstrap99CI(values, iters = 5000) {
  const n = values.length;
  if (n < 4) return [null, null];
  const s = new Float64Array(iters);
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += values[(Math.random() * n) | 0];
    s[i] = sum / n;
  }
  s.sort();
  return [+s[(0.005 * iters) | 0].toFixed(3), +s[(0.995 * iters) | 0].toFixed(3)];
}

function tradeStats(trades, costR) {
  const counted = trades.filter(t => t.outcome !== 'geen');
  if (!counted.length) return { n: trades.length, tp: 0, sl: 0, geen: trades.length, wr: null, er: null, ci: [null,null] };
  const tp   = trades.filter(t => t.outcome === 'tp').length;
  const sl   = trades.filter(t => t.outcome === 'sl').length;
  const geen = trades.filter(t => t.outcome === 'geen').length;
  const wr   = counted.length > 0 ? tp / counted.length : null;
  const rVals = counted.filter(t => t.rMultiple != null).map(t => t.rMultiple - costR);
  const er   = rVals.length ? +(rVals.reduce((a,b)=>a+b,0)/rVals.length).toFixed(3) : null;
  return { n: trades.length, tp, sl, geen, wr, er, ci: bootstrap99CI(rVals) };
}

function printStats(label, trades, costR, ci = true) {
  if (!trades.length) { console.log(`  ${label}: geen trades`); return; }
  const s = tradeStats(trades, costR);
  const wr  = s.wr   != null ? `WR ${(s.wr*100).toFixed(0)}%` : 'WR -';
  const er  = s.er   != null ? `E(R)=${s.er>=0?'+':''}${s.er}R` : 'E(R)=-';
  const cis = ci && s.ci[0] != null ? ` CI99[${s.ci[0]>=0?'+':''}${s.ci[0]}, ${s.ci[1]>=0?'+':''}${s.ci[1]}]` : '';
  console.log(`  ${label}: n=${s.n} (TP=${s.tp} SL=${s.sl} geen=${s.geen}) | ${wr} | ${er}${cis}`);
}

function printBlock(label, trades, costRLow, costRHigh, isXau) {
  console.log(`\n── ${label} ──`);
  printStats(`Totaal ($${isXau ? COST_USD_LOW.toFixed(2) : '0.70-norm'})`, trades, costRLow);
  printStats(`Totaal ($${isXau ? COST_USD_HIGH.toFixed(2) : '1.50-norm'})`, trades, costRHigh);
  printStats('Bullish', trades.filter(t => t.dir === 'up'), costRLow, false);
  printStats('Bearish', trades.filter(t => t.dir === 'down'), costRLow, false);

  const years = [...new Set(trades.map(t => t.year))].sort();
  if (years.length > 1) {
    console.log('  Per jaar:');
    years.forEach(yr => {
      const sub = trades.filter(t => t.year === yr);
      const s = tradeStats(sub, costRLow);
      const ci = s.ci[0]!=null ? ` CI99[${s.ci[0]>=0?'+':''}${s.ci[0]}, ${s.ci[1]>=0?'+':''}${s.ci[1]}]` : '';
      console.log(`    ${yr}: n=${sub.length} | WR ${s.wr!=null?(s.wr*100).toFixed(0)+'%':'-'} | E(R)=${s.er!=null?(s.er>=0?'+':'')+s.er+'R':'-'}${ci}`);
    });
  }

  const oos = trades.filter(t => t.date < IS_START);
  const iis = trades.filter(t => t.date >= IS_START);
  if (oos.length || iis.length) {
    const oos_s = tradeStats(oos, costRLow);
    const is_s  = tradeStats(iis, costRLow);
    console.log(`  IS/OOS ($${isXau?COST_USD_LOW.toFixed(2):'norm'}):`);
    if (oos.length) console.log(`    OOS (vóór ${IS_START}): n=${oos.length} E(R)=${oos_s.er!=null?(oos_s.er>=0?'+':'')+oos_s.er+'R':'-'} CI99${oos_s.ci[0]!=null?`[${oos_s.ci[0]>=0?'+':''}${oos_s.ci[0]},${oos_s.ci[1]>=0?'+':''}${oos_s.ci[1]}]`:'-'}`);
    if (iis.length) console.log(`    IS  (vanaf ${IS_START}): n=${iis.length} E(R)=${is_s.er!=null?(is_s.er>=0?'+':'')+is_s.er+'R':'-'} CI99${is_s.ci[0]!=null?`[${is_s.ci[0]>=0?'+':''}${is_s.ci[0]},${is_s.ci[1]>=0?'+':''}${is_s.ci[1]}]`:'-'}`);
  }
}

function detectRegimeD1(d1Slice) {
  if (d1Slice.length < 60) return 'range';
  const closes = d1Slice.map(c => c.close);
  const now    = sma(closes, 50);
  const prev   = sma(closes.slice(0,-10), 50);
  if (!now || !prev || prev === 0) return 'range';
  // Relatieve drempel: 0,2% verschil in SMA50 over 10 dagen.
  // Equivalent aan ~$5 voor XAU/USD; werkt ook voor EUR/USD, NAS100, GER40.
  const pct = (now - prev) / prev;
  return pct > 0.002 ? 'trend-up' : pct < -0.002 ? 'trend-down' : 'range';
}

// ── Yahoo Finance data ophalen ────────────────────────────────────────────

async function fetchYFCandles(symbol, interval = '1d', range = '25y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
  const { data } = await axios.get(url, {
    params: { interval, range },
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`Geen data voor ${symbol}`);
  const ts = result.timestamp;
  const q  = result.indicators.quote[0];
  return ts.map((t, i) => ({
    time:  new Date(t * 1000).toISOString(),
    open:  q.open[i],
    high:  q.high[i],
    low:   q.low[i],
    close: q.close[i],
  })).filter(c => c.open != null && c.high != null && c.low != null && c.close != null
                 && c.high > c.low
                 && c.time >= FROM_STR);
}

// ── H7-D1: D1-open entry in D1-trendrichting ─────────────────────────────

function runH7D1(d1All, label) {
  const trades = [];
  let busyUntilIdx = -1;

  for (let i = 60; i < d1All.length - 1; i++) {
    if (i <= busyUntilIdx) continue;
    const c = d1All[i];
    const dateStr = c.time.slice(0,10);

    // Lookahead-safe: gebruik candles t/m candle i (gesloten)
    const d1Slice = d1All.slice(Math.max(0, i-60), i);
    const regime  = detectRegimeD1(d1Slice);
    if (regime === 'range') continue;

    const dir     = regime === 'trend-up' ? 'up' : 'down';
    const atr14   = atr(d1Slice.slice(-20), 14);
    if (!atr14 || atr14 <= 0) continue;

    // Entry op open van volgende candle (punt-in-tijd: we weten close van candle i)
    const next = d1All[i + 1];
    if (!next) continue;
    const entry  = next.open ?? next.close;
    const slDist = SL_ATR * atr14;
    const sl     = dir === 'up' ? entry - slDist : entry + slDist;
    const tp     = dir === 'up' ? entry + TP_ATR * atr14 : entry - TP_ATR * atr14;

    // Simuleer forward op D1
    let outcome = 'geen', rMultiple = null, exitCandles = null;
    for (let j = i + 1; j < Math.min(i + 1 + 60, d1All.length); j++) {
      const fc = d1All[j];
      // Conservatief: als zowel TP als SL in zelfde candle → SL
      const hitSL = dir === 'up' ? fc.low <= sl  : fc.high >= sl;
      const hitTP = dir === 'up' ? fc.high >= tp : fc.low <= tp;
      if (hitSL) { outcome = 'sl'; rMultiple = -1.0; exitCandles = j - i; break; }
      if (hitTP) { outcome = 'tp'; rMultiple = +(TP_ATR / SL_ATR).toFixed(3); exitCandles = j - i; break; }
    }

    if (outcome !== 'geen') {
      busyUntilIdx = i + 1 + (exitCandles ?? 60);
    } else {
      busyUntilIdx = i + 1 + 60;
    }

    trades.push({
      date: dateStr, year: dateStr.slice(0,4),
      dir, regime, outcome, rMultiple, slDist,
    });
  }
  return trades;
}

// ── H7-H1: 08:00 en 13:00 UTC entry in D1-trendrichting ──────────────────

function runH7H1(h1All, d1All, times = [8, 13]) {
  const trades  = [];
  let busyUntilMs = 0;

  for (let i = 50; i < h1All.length - HORIZON_CANDLES; i++) {
    const c    = h1All[i];
    const tMs  = new Date(c.time).getTime();
    const h    = new Date(c.time).getUTCHours();
    if (!times.includes(h)) continue;
    if (tMs < busyUntilMs) continue;

    const h1CloseMs = tMs + 3_600_000;
    const d1Slice = d1All.filter(d => new Date(d.time).getTime() + 86_400_000 <= h1CloseMs).slice(-60);
    if (d1Slice.length < 60) continue;

    const regime = detectRegimeD1(d1Slice);
    if (regime === 'range') continue;

    const dir   = regime === 'trend-up' ? 'up' : 'down';
    const h1Sl  = h1All.slice(Math.max(0, i-20), i+1);
    const atr14 = atr(h1Sl, 14);
    if (!atr14 || atr14 <= 0) continue;

    const entry  = c.close;
    const slDist = SL_ATR * atr14;
    const sl     = dir === 'up' ? entry - slDist : entry + slDist;
    const tp     = dir === 'up' ? entry + TP_ATR * atr14 : entry - TP_ATR * atr14;

    const futureCandles = h1All.slice(i+1, i+1+HORIZON_CANDLES);
    let outcome = 'geen', rMultiple = null, candlesToHit = null;
    for (const fc of futureCandles) {
      const hitSL = dir === 'up' ? fc.low <= sl  : fc.high >= sl;
      const hitTP = dir === 'up' ? fc.high >= tp : fc.low <= tp;
      if (hitSL) { outcome = 'sl'; rMultiple = -1.0; candlesToHit = futureCandles.indexOf(fc)+1; break; }
      if (hitTP) { outcome = 'tp'; rMultiple = +(TP_ATR/SL_ATR).toFixed(3); candlesToHit = futureCandles.indexOf(fc)+1; break; }
    }
    busyUntilMs = tMs + (candlesToHit ?? HORIZON_CANDLES) * 3_600_000;

    trades.push({
      date: c.time.slice(0,10), year: c.time.slice(0,4),
      dir, regime, outcome, rMultiple, slDist, hour: h,
    });
  }
  return trades;
}

// ── Random benchmark ──────────────────────────────────────────────────────
// Willekeurige timing: op elk trend-dag wordt een willekeurige prijs binnen
// de dagrange als entry gekozen (open + rand * (high-low)), zodat we testen
// of de ENTRY-TIMING van H7-D1 (D1-open) beter is dan willekeurig.

function runRandomD1(d1All, runs = RANDOM_RUNS) {
  const allRunsTrades = [];
  for (let run = 0; run < runs; run++) {
    const trades = [];
    let busyUntilIdx = -1;
    for (let i = 60; i < d1All.length - 1; i++) {
      if (i <= busyUntilIdx) continue;
      const d1Slice = d1All.slice(Math.max(0, i-60), i);
      const regime  = detectRegimeD1(d1Slice);
      if (regime === 'range') continue;

      const dir    = regime === 'trend-up' ? 'up' : 'down';
      const atr14  = atr(d1Slice.slice(-20), 14);
      if (!atr14 || atr14 <= 0) continue;

      const next   = d1All[i + 1];
      if (!next) continue;
      // Willekeurige entry binnen de dagrange van de volgende candle
      const rnd    = Math.random();
      const entry  = next.low + rnd * (next.high - next.low);
      const slDist = SL_ATR * atr14;
      const sl     = dir === 'up' ? entry - slDist : entry + slDist;
      const tp     = dir === 'up' ? entry + TP_ATR * atr14 : entry - TP_ATR * atr14;

      let outcome = 'geen', rMultiple = null, exitCandles = null;
      for (let j = i+1; j < Math.min(i+61, d1All.length); j++) {
        const fc = d1All[j];
        const hitSL = dir === 'up' ? fc.low <= sl  : fc.high >= sl;
        const hitTP = dir === 'up' ? fc.high >= tp : fc.low <= tp;
        if (hitSL) { outcome = 'sl'; rMultiple = -1.0; exitCandles = j-i; break; }
        if (hitTP) { outcome = 'tp'; rMultiple = +(TP_ATR/SL_ATR).toFixed(3); exitCandles = j-i; break; }
      }
      busyUntilIdx = i + 1 + (exitCandles ?? 60);
      trades.push({ outcome, rMultiple });
    }
    allRunsTrades.push(trades);
  }

  const ers = allRunsTrades.map(t => {
    const counted = t.filter(x => x.rMultiple != null);
    if (!counted.length) return null;
    return counted.reduce((a,b) => a + (b.rMultiple - COST_R_LOW), 0) / counted.length;
  }).filter(e => e != null);
  const avgEr = ers.length ? ers.reduce((a,b)=>a+b,0)/ers.length : null;
  const nAvg  = allRunsTrades.reduce((a,b)=>a+b.length,0) / allRunsTrades.length;
  return { avgEr, nAvg, ers };
}

// ── H6 op XAU/USD (bestaande cache) ──────────────────────────────────────

function runH6(candles) {
  const { h1, m30, m15, d1, w1 } = candles;
  const trades = [];
  let busyUntilIdx = -1;

  for (let i = 50; i < h1.length - HORIZON_CANDLES; i++) {
    if (i <= busyUntilIdx) continue;
    const c = h1[i];
    const h1CloseMs = new Date(c.time).getTime() + 3_600_000;

    const h1Win  = h1.slice(Math.max(0,i-50), i+1);
    const m30Win = (m30||[]).filter(x => new Date(x.time).getTime() +  1_800_000 <= h1CloseMs).slice(-100);
    const m15Win = (m15||[]).filter(x => new Date(x.time).getTime() +    900_000 <= h1CloseMs).slice(-100);
    const d1Win  = (d1||[]).filter(x => new Date(x.time).getTime() + 86_400_000 <= h1CloseMs).slice(-60);
    const w1Win  = (w1||[]).filter(x => new Date(x.time).getTime() + 604_800_000 <= h1CloseMs).slice(-20);

    if (m30Win.length < 20 || m15Win.length < 20) continue;

    const cond = checkConditions({ h1Candles:h1Win, m30Candles:m30Win, m15Candles:m15Win,
      h4Candles:[], d1Candles:d1Win, w1Candles:w1Win, now: new Date(c.time) });
    if (!cond.triggered) continue;

    const regime = detectRegimeD1(d1Win);
    const dir    = cond.direction === 'bullish' ? 'up' : 'down';
    if (regime === 'range') continue;
    if (regime === 'trend-up'   && dir !== 'up')   continue;
    if (regime === 'trend-down' && dir !== 'down')  continue;

    const atr14  = atr(h1Win.slice(-50), 14) ?? 15;
    const entry  = c.close;
    const slDist = SL_ATR * atr14;
    const sl     = dir === 'up' ? entry - slDist : entry + slDist;
    const tp     = dir === 'up' ? entry + TP_ATR * atr14 : entry - TP_ATR * atr14;

    const future = h1.slice(i+1, i+1+HORIZON_CANDLES);
    let outcome = 'geen', rMultiple = null, candlesToHit = null;
    for (const fc of future) {
      const hitSL = dir === 'up' ? fc.low <= sl  : fc.high >= sl;
      const hitTP = dir === 'up' ? fc.high >= tp : fc.low <= tp;
      if (hitSL) { outcome = 'sl'; rMultiple = -1.0; candlesToHit = future.indexOf(fc)+1; break; }
      if (hitTP) { outcome = 'tp'; rMultiple = +(TP_ATR/SL_ATR).toFixed(3); candlesToHit = future.indexOf(fc)+1; break; }
    }
    busyUntilIdx = i + (candlesToHit ?? HORIZON_CANDLES);

    trades.push({
      date: c.time.slice(0,10), year: c.time.slice(0,4),
      dir, regime, outcome, rMultiple, slDist,
    });
  }
  return trades;
}

// ── Portfolio-aggregaat ───────────────────────────────────────────────────

function portfolioStats(allTrades, costRLow) {
  const combined = allTrades.flatMap(({ trades, costR }) =>
    trades.filter(t => t.rMultiple != null && t.outcome !== 'geen')
      .map(t => t.rMultiple - (costR ?? costRLow))
  );
  if (!combined.length) return null;
  const er = +(combined.reduce((a,b)=>a+b,0)/combined.length).toFixed(3);
  return { n: combined.length, er, ci: bootstrap99CI(combined) };
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const divider = '═'.repeat(72);
  console.log(`\n${'='.repeat(72)}`);
  console.log(`MULTI-MARKT HYPOTHESETEST | H6, H7-D1, H7-H1 | vanaf ${FROM_STR}`);
  console.log(`${'='.repeat(72)}\n`);

  // ── H7-D1 en H7-H1: Yahoo Finance data ──
  if (RUN_H7D1 || RUN_H7H1) {
    console.log('Yahoo Finance data ophalen...');
    const yfResults = [];

    for (const [sym, meta] of Object.entries(YF_INSTRUMENTS)) {
      process.stdout.write(`  ${meta.label} (${sym}) D1... `);
      let d1All, h1All;
      try {
        d1All = await fetchYFCandles(sym, '1d', '25y');
        console.log(`${d1All.length} D1-candles (${d1All[0]?.time?.slice(0,10)} → ${d1All[d1All.length-1]?.time?.slice(0,10)})`);
      } catch(e) {
        console.log(`FOUT: ${e.message.slice(0,60)}`);
        d1All = [];
      }
      await new Promise(r => setTimeout(r, 500));

      if (RUN_H7H1) {
        process.stdout.write(`  ${meta.label} (${sym}) H1... `);
        try {
          h1All = await fetchYFCandles(sym, '1h', '2y');
          console.log(`${h1All.length} H1-candles`);
        } catch(e) {
          console.log(`FOUT: ${e.message.slice(0,60)}`);
          h1All = [];
        }
        await new Promise(r => setTimeout(r, 500));
      }

      const costRLow  = meta.isXau ? null : COST_R_LOW;
      const costRHigh = meta.isXau ? null : COST_R_HIGH;
      yfResults.push({ sym, meta, d1All, h1All, costRLow, costRHigh });
    }

    // ── H7-D1 ──
    if (RUN_H7D1) {
      console.log(`\n${divider}`);
      console.log('H7-D1 — D1-open entry in D1-trendrichting (SL 1,5×ATR, TP 3×ATR)');
      console.log('         Kosten niet-XAU: 0,019R en 0,040R (genormaliseerd)');
      console.log(divider);

      const h7d1Portfolio = [];
      for (const { sym, meta, d1All } of yfResults) {
        if (!d1All.length) { console.log(`\n── ${meta.label}: geen data ──`); continue; }

        const cLow  = meta.isXau ? null : COST_R_LOW;
        const cHigh = meta.isXau ? null : COST_R_HIGH;
        const trades = runH7D1(d1All, meta.label);

        // Voor XAU: berekenen op basis van gem. slDist (dollar costs)
        let costLow, costHigh;
        if (meta.isXau) {
          const withSl = trades.filter(t => t.slDist > 0);
          const avgSl  = withSl.length ? withSl.reduce((a,b)=>a+b.slDist,0)/withSl.length : 37;
          costLow  = COST_USD_LOW  / avgSl;
          costHigh = COST_USD_HIGH / avgSl;
        } else {
          costLow  = COST_R_LOW;
          costHigh = COST_R_HIGH;
        }

        printBlock(`${meta.label} H7-D1 (n=${trades.length})`, trades, costLow, costHigh, meta.isXau);
        h7d1Portfolio.push({ trades, costR: costLow });
      }

      // Portfolio
      const port = portfolioStats(h7d1Portfolio, COST_R_LOW);
      if (port) {
        const ci = port.ci[0]!=null ? ` CI99[${port.ci[0]>=0?'+':''}${port.ci[0]}, ${port.ci[1]>=0?'+':''}${port.ci[1]}]` : '';
        console.log(`\n── PORTFOLIO (gelijk gewogen, alle instrumenten) ──`);
        console.log(`  n=${port.n} trades | E(R)=${port.er>=0?'+':''}${port.er}R${ci}`);
      }

      // Random benchmark op XAU (representatief)
      const xauD1 = yfResults.find(r => r.meta.isXau)?.d1All;
      if (xauD1?.length) {
        const bench = runRandomD1(xauD1);
        const avg = bench.avgEr != null ? (bench.avgEr >= 0 ? '+' : '') + bench.avgEr.toFixed(3) + 'R' : '-';
        console.log(`\n── Random benchmark XAU/USD (${RANDOM_RUNS} runs, genorm. cost) ──`);
        console.log(`  Gem. E(R) random: ${avg} (gem. n=${bench.nAvg.toFixed(0)} per run)`);
        const h7d1Xau = yfResults.find(r => r.meta.isXau);
        if (h7d1Xau?.d1All.length) {
          const h7Trades = runH7D1(h7d1Xau.d1All, 'XAU');
          const withSl = h7Trades.filter(t => t.slDist > 0);
          const avgSl  = withSl.length ? withSl.reduce((a,b)=>a+b.slDist,0)/withSl.length : 37;
          const cLow = COST_USD_LOW / avgSl;
          const s = tradeStats(h7Trades, cLow);
          if (bench.avgEr != null && s.er != null) {
            const better = bench.ers.filter(e => s.er > e).length;
            console.log(`  H7-D1 XAU E(R) vs random: H7=${s.er>=0?'+':''}${s.er}R, beter dan ${(better/bench.ers.length*100).toFixed(0)}% van random runs`);
          }
        }
      }
    }

    // ── H7-H1 ──
    if (RUN_H7H1) {
      console.log(`\n${divider}`);
      console.log('H7-H1 — H1-entry 08:00 én 13:00 UTC in D1-trendrichting (SL 1,5×ATR, TP 3×ATR)');
      console.log(divider);

      const h7h1Portfolio = [];
      for (const { sym, meta, d1All, h1All } of yfResults) {
        if (!h1All?.length) { console.log(`\n── ${meta.label}: geen H1-data ──`); continue; }

        let costLow, costHigh;
        if (meta.isXau) {
          const tradesAll = runH7H1(h1All, d1All, [8, 13]);
          const withSl = tradesAll.filter(t => t.slDist > 0);
          const avgSl  = withSl.length ? withSl.reduce((a,b)=>a+b.slDist,0)/withSl.length : 37;
          costLow  = COST_USD_LOW  / avgSl;
          costHigh = COST_USD_HIGH / avgSl;
          const t8  = runH7H1(h1All, d1All, [8]);
          const t13 = runH7H1(h1All, d1All, [13]);
          printBlock(`${meta.label} H7-H1 combined (n=${tradesAll.length})`, tradesAll, costLow, costHigh, true);
          printStats(`  08:00 UTC only`, t8, costLow, true);
          printStats(`  13:00 UTC only`, t13, costLow, true);
          h7h1Portfolio.push({ trades: tradesAll, costR: costLow });
        } else {
          costLow  = COST_R_LOW;
          costHigh = COST_R_HIGH;
          const trades = runH7H1(h1All, d1All, [8, 13]);
          printBlock(`${meta.label} H7-H1 (n=${trades.length})`, trades, costLow, costHigh, false);
          h7h1Portfolio.push({ trades, costR: costLow });
        }
      }

      const port = portfolioStats(h7h1Portfolio, COST_R_LOW);
      if (port) {
        const ci = port.ci[0]!=null ? ` CI99[${port.ci[0]>=0?'+':''}${port.ci[0]}, ${port.ci[1]>=0?'+':''}${port.ci[1]}]` : '';
        console.log(`\n── PORTFOLIO H7-H1 ──`);
        console.log(`  n=${port.n} trades | E(R)=${port.er>=0?'+':''}${port.er}R${ci}`);
      }
    }
  }

  // ── H6 op XAU/USD ──
  if (RUN_H6) {
    console.log(`\n${divider}`);
    console.log('H6 — conditionChecker + D1-trendfilter, XAU/USD (bestaande 2-jaars cache)');
    console.log(divider);
    if (!process.argv.includes('--h6') && !RUN_H6) { console.log('  (overgeslagen)'); }
    else {
      const cached = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
      const candles = { h1: filterFlatCandles(cached.h1||[]), m30: cached.m30||[], m15: cached.m15||[], d1: cached.d1||[], w1: cached.w1||[] };
      const trades  = runH6(candles);
      const withSl  = trades.filter(t => t.slDist > 0);
      const avgSl   = withSl.length ? withSl.reduce((a,b)=>a+b.slDist,0)/withSl.length : 37;
      const cLow    = COST_USD_LOW  / avgSl;
      const cHigh   = COST_USD_HIGH / avgSl;
      printBlock(`XAU/USD H6 (conditionChecker, n=${trades.length})`, trades, cLow, cHigh, true);
    }
  }

  console.log(`\n${'='.repeat(72)}\n`);
  console.log('Noot kosten: XAU/USD → $0,70/$1,50 / slDist. Overige markten → 0,019R/0,040R');
  console.log('(equivalent aan $0,70/$1,50 bij gemiddeld XAU-ATR=$37, SL=1,5×ATR).\n');
}

main().catch(err => { console.error(err.message); process.exit(1); });
