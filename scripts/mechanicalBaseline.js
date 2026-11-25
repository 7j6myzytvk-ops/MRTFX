/**
 * Mechanische baseline & hybride vergelijking — XAU/USD backtest
 *
 * Mechanische modus (default, geen API-calls):
 *   Alle conditionChecker-triggers, richting uit H1/M30 alignment,
 *   SL = 1.5×ATR, TP = 2×ATR (m2) en 3×ATR (m3).
 *   --one-trade: geen nieuwe trigger zolang vorige trade nog loopt.
 *
 * Hybride modus (--hybrid, vereist API-calls, Haiku aanbevolen):
 *   Dezelfde triggers. Boardroom beslist of het een signaal is (ja/nee).
 *   Bij ja: gebruik boardroom-richting, maar SL = 1.5×ATR, TP = 2× en 3×ATR.
 *
 * Gebruik:
 *   node scripts/mechanicalBaseline.js --cached --from 2024-11-01 --one-trade
 *   ANTHROPIC_MODEL=claude-haiku-4-5 node scripts/mechanicalBaseline.js --cached --from 2026-05-25 --hybrid
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getXauUsdCandles, getEurUsdCandles, getUsYieldCandles } from '../services/marketData.js';
import { checkConditions } from '../services/conditionChecker.js';
import { runDiscussion } from '../agents/boardroom.js';
import { atr, sma } from '../agents/indicators.js';
import { evaluateOutcome, filterFlatCandles, HORIZON_CANDLES } from '../agents/outcomeEvaluator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '../data/backtest-candles.json');

// --- CLI args ---
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
}
const USE_CACHE   = args.includes('--cached');
const RUN_HYBRID  = args.includes('--hybrid');
const ONE_TRADE   = args.includes('--one-trade');  // geen nieuwe trigger zolang trade open
const FROM_STR    = getArg('--from') ?? '2026-05-25';
const TO_STR      = getArg('--to')   ?? new Date().toISOString().slice(0, 10);
const MAX_RUNS    = getArg('--max')         ? parseInt(getArg('--max'), 10) : Infinity;
const CONCURRENCY = getArg('--concurrency') ? parseInt(getArg('--concurrency'), 10) : 3;

const FROM_H1 = `${FROM_STR} 00:00:00`;
const FROM_D1 = new Date(new Date(FROM_STR).setMonth(new Date(FROM_STR).getMonth() - 6))
  .toISOString().slice(0, 10) + ' 00:00:00';
const FROM_W1 = new Date(new Date(FROM_STR).setFullYear(new Date(FROM_STR).getFullYear() - 1))
  .toISOString().slice(0, 10) + ' 00:00:00';
const TO = `${TO_STR} 23:59:59`;

const COOLDOWN_MS    = 4 * 60 * 60 * 1000;
const MIN_H1_HISTORY = 50;
const COST_USD       = 0.70;

const SL_MULT  = 1.5;
const TP2_MULT = 2.0;
const TP3_MULT = 3.0;

// ── Hulpfuncties ────────────────────────────────────────────────────────

function detectRegime(d1Window) {
  if (d1Window.length < 60) return 'range';
  const closes   = d1Window.map(c => c.close);
  const sma50Now  = sma(closes, 50);
  const sma50Prev = sma(closes.slice(0, -10), 50);
  if (!sma50Now || !sma50Prev) return 'range';
  const diff = sma50Now - sma50Prev;
  if (diff > 5)  return 'trend-up';
  if (diff < -5) return 'trend-down';
  return 'range';
}

async function batchRun(items, size, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  }
  return results;
}

function simulateATR(dir, entry, atr14, tpMult, futureCandles) {
  const sl = dir === 'bullish' ? entry - SL_MULT * atr14 : entry + SL_MULT * atr14;
  const tp = dir === 'bullish' ? entry + tpMult * atr14  : entry - tpMult * atr14;
  const r  = evaluateOutcome({ signal: dir, stopLoss: sl, takeProfit: tp }, futureCandles, entry);
  return { sl, tp, slDist: SL_MULT * atr14, outcome: r.result, rMultiple: r.rMultiple, candlesToHit: r.candlesToHit };
}

// Bootstrap 95%-CI voor het gemiddelde van `values`.
function bootstrap95CI(values, iters = 5000) {
  const n = values.length;
  if (n < 4) return [null, null];
  const samples = new Float64Array(iters);
  for (let i = 0; i < iters; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += values[(Math.random() * n) | 0];
    samples[i] = s / n;
  }
  samples.sort();
  return [+samples[(0.025 * iters) | 0].toFixed(3), +samples[(0.975 * iters) | 0].toFixed(3)];
}

function tradeStats(trades) {
  const counted = trades.filter(t => t.outcome !== 'geen');
  const tp   = trades.filter(t => t.outcome === 'tp').length;
  const sl   = trades.filter(t => t.outcome === 'sl').length;
  const geen = trades.filter(t => t.outcome === 'geen').length;
  const wr   = counted.length > 0 ? tp / counted.length : null;

  const withR = trades.filter(t => t.rMultiple != null && t.outcome !== 'geen');
  let expectancyR = null, ci = [null, null];
  if (withR.length > 0) {
    const slDists  = withR.map(t => t.slDist);
    const avgSlDist = slDists.reduce((a, b) => a + b, 0) / slDists.length;
    const costR    = avgSlDist > 0 ? COST_USD / avgSlDist : 0;
    const rVals    = withR.map(t => t.rMultiple - costR);
    expectancyR    = +(rVals.reduce((a, b) => a + b, 0) / rVals.length).toFixed(3);
    // Bootstrap CI op rVals (kosten al verrekend per observatie)
    ci = bootstrap95CI(rVals);
  }

  return { total: trades.length, tp, sl, geen, wr, expectancyR, ci };
}

function fmt(s, includeCI = false) {
  const wrStr = s.wr   != null ? `WR ${(s.wr*100).toFixed(0)}%` : 'WR -';
  const eStr  = s.expectancyR != null
    ? `E(R)=${s.expectancyR >= 0 ? '+' : ''}${s.expectancyR}R`
    : 'E(R)=-';
  const ciStr = includeCI && s.ci[0] != null
    ? ` 95%CI[${s.ci[0] >= 0 ? '+' : ''}${s.ci[0]}, ${s.ci[1] >= 0 ? '+' : ''}${s.ci[1]}]`
    : '';
  return `n=${s.total} (TP=${s.tp} SL=${s.sl} geen=${s.geen}) | ${wrStr} | ${eStr}${ciStr}`;
}

function printStats(label, trades, includeCI = false) {
  if (trades.length === 0) { console.log(`  ${label}: geen trades`); return; }
  console.log(`  ${label}: ${fmt(tradeStats(trades), includeCI)}`);
}

// ── Candle laden ─────────────────────────────────────────────────────────

async function loadCandles() {
  if (USE_CACHE) {
    console.log('Cache laden...');
    let cache;
    try { cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8')); }
    catch { console.error(`Cache niet gevonden: ${CACHE_PATH}`); process.exit(1); }
    const inRange = (arr) => (arr || []).filter(c => c.time >= FROM_H1 && c.time <= TO);
    const h1  = filterFlatCandles(inRange(cache.h1));
    const m30 = filterFlatCandles(inRange(cache.m30));
    const m15 = filterFlatCandles(inRange(cache.m15));
    const d1  = inRange(cache.d1);
    const w1  = inRange(cache.w1);
    console.log(`H1: ${h1.length} | M30: ${m30.length} | M15: ${m15.length} | D1: ${d1.length}\n`);
    return { h1, m30, m15, h4: [], d1, w1, eurUsd: [], yields: [] };
  }

  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  console.log('Candles ophalen (rate-limit: 8/min)...');
  const h1  = filterFlatCandles(await getXauUsdCandles({ granularity: 'H1', from: FROM_H1, to: TO })); await delay(2000);
  const m30 = filterFlatCandles(await getXauUsdCandles({ granularity: 'M30', from: FROM_H1, to: TO })); await delay(2000);
  const m15 = filterFlatCandles(await getXauUsdCandles({ granularity: 'M15', from: FROM_H1, to: TO })); await delay(2000);
  const h4  = filterFlatCandles(await getXauUsdCandles({ granularity: 'H4', from: FROM_H1, to: TO }));  await delay(2000);
  const d1  = await getXauUsdCandles({ granularity: 'D', from: FROM_D1, to: TO }); await delay(2000);
  const w1  = await getXauUsdCandles({ granularity: 'W', from: FROM_W1, to: TO }); await delay(2000);
  const eurUsd = (await getEurUsdCandles({ granularity: 'H1', from: FROM_H1, to: TO })).filter(c => c.high !== c.low); await delay(2000);
  const yields = (await getUsYieldCandles({ granularity: 'D', from: FROM_D1, to: TO })).filter(c => c.high !== c.low);
  console.log(`H1: ${h1.length} | D1: ${d1.length}\n`);
  return { h1, m30, m15, h4, d1, w1, eurUsd, yields };
}

// ── Pass 1: triggers + mechanische simulatie ─────────────────────────────

function runPass1(candles) {
  const { h1, m30, m15, h4, d1, w1 } = candles;
  const triggerQueue = [];
  let lastTriggerTime = null;
  let busyUntilIdx    = -1;   // ONE_TRADE: wacht tot deze H1-index voorbij is

  for (let i = MIN_H1_HISTORY; i < h1.length - HORIZON_CANDLES; i++) {
    if (triggerQueue.length >= MAX_RUNS) break;

    const candle = h1[i];
    const now    = new Date(candle.time);

    // Skip-logica: óf cooldown (standaard) óf één-trade-tegelijk
    if (ONE_TRADE) {
      if (i <= busyUntilIdx) continue;
    } else {
      if (lastTriggerTime && now - lastTriggerTime < COOLDOWN_MS) continue;
    }

    const h1Window  = h1.slice(Math.max(0, i - 50), i + 1);
    const m30Window = m30.filter(c => c.time <= candle.time).slice(-100);
    const m15Window = m15.filter(c => c.time <= candle.time).slice(-100);
    const h4Window  = h4.filter(c => c.time <= candle.time).slice(-50);
    const d1Window  = d1.filter(c => c.time <= candle.time).slice(-60);
    const w1Window  = w1.filter(c => c.time <= candle.time).slice(-20);

    if (m30Window.length < 20 || m15Window.length < 20) continue;

    const conditions = checkConditions({
      h1Candles: h1Window, m30Candles: m30Window, m15Candles: m15Window,
      h4Candles: h4Window, d1Candles: d1Window, w1Candles: w1Window, now,
    });
    if (!conditions.triggered) continue;

    lastTriggerTime = now;

    const futureCandles = h1.slice(i + 1, i + 1 + HORIZON_CANDLES);
    const regime  = detectRegime(d1Window);
    const atr14   = atr(h1Window.slice(-50), 14) ?? 15;
    const entry   = candle.close;
    const dir     = conditions.direction;
    const year    = candle.time.slice(0, 4);

    // Simuleer meteen (nodig voor busyUntilIdx)
    const m3 = simulateATR(dir, entry, atr14, TP3_MULT, futureCandles);
    const m2 = simulateATR(dir, entry, atr14, TP2_MULT, futureCandles);

    if (ONE_TRADE) {
      // Zet cursor tot einde van déze trade
      const tradeDuration = m3.candlesToHit ?? HORIZON_CANDLES;
      busyUntilIdx = i + tradeDuration;
    }

    triggerQueue.push({
      time: candle.time.slice(0, 16), dir, regime, entry, atr14, year,
      futureCandles, h1Window, m30Window, m15Window, h4Window, d1Window, w1Window,
      eurWindow: [], yldWindow: [], trendMode: conditions.trendMode,
      mech: {
        m2: { outcome: m2.outcome, rMultiple: m2.rMultiple, slDist: m2.slDist, candlesToHit: m2.candlesToHit },
        m3: { outcome: m3.outcome, rMultiple: m3.rMultiple, slDist: m3.slDist, candlesToHit: m3.candlesToHit },
      },
    });
  }

  return triggerQueue;
}

// ── Samenvatting printen ─────────────────────────────────────────────────

function printSummary(label, allTrades) {
  console.log(`\n── ${label} (n=${allTrades.length}) ──`);
  printStats('Totaal (alle triggers)', allTrades, true);
  printStats('Bullish', allTrades.filter(t => t.dir === 'bullish'), true);
  printStats('Bearish', allTrades.filter(t => t.dir === 'bearish'), true);
  for (const r of ['trend-up', 'trend-down', 'range']) {
    printStats(r, allTrades.filter(t => t.regime === r), true);
  }

  // Per jaar
  const years = [...new Set(allTrades.map(t => t.year))].sort();
  if (years.length > 1) {
    console.log('  Per jaar:');
    for (const yr of years) {
      const sub = allTrades.filter(t => t.year === yr);
      const s   = tradeStats(sub);
      const ci  = s.ci[0] != null ? ` CI[${s.ci[0] >= 0 ? '+' : ''}${s.ci[0]}, ${s.ci[1] >= 0 ? '+' : ''}${s.ci[1]}]` : '';
      const wr  = s.wr != null ? `WR ${(s.wr*100).toFixed(0)}%` : 'WR -';
      const er  = s.expectancyR != null ? `E(R)=${s.expectancyR >= 0 ? '+' : ''}${s.expectancyR}R` : 'E(R)=-';
      console.log(`    ${yr}: n=${sub.length} | ${wr} | ${er}${ci}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const model = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
  console.log(`\n=== MECHANISCHE BASELINE: ${FROM_STR} → ${TO_STR} ===`);
  console.log(`Cache: ${USE_CACHE ? 'ja' : 'nee'} | OneTrade: ${ONE_TRADE} | Hybride: ${RUN_HYBRID ? `ja (${model})` : 'nee'}\n`);

  const candles = await loadCandles();
  const { h1: h1All, m30: m30All, m15: m15All, h4: h4All, d1: d1All, w1: w1All } = candles;

  console.log(`Pass 1: triggers scannen (${ONE_TRADE ? 'één trade tegelijk' : '4-uurs cooldown'})...`);
  const triggerQueue = runPass1(candles);
  console.log(`Pass 1 klaar: ${triggerQueue.length} triggers.\n`);

  // Mechanische resultaten
  const mechM2 = triggerQueue.map(t => ({ ...t.mech.m2, dir: t.dir, regime: t.regime, year: t.year }));
  const mechM3 = triggerQueue.map(t => ({ ...t.mech.m3, dir: t.dir, regime: t.regime, year: t.year }));

  const divider = '═'.repeat(70);
  console.log('\n' + divider);
  console.log('MECHANISCHE BASELINE RESULTATEN');
  console.log(divider);
  console.log(`Periode: ${FROM_STR} → ${TO_STR} | Triggers: ${triggerQueue.length} | OneTrade: ${ONE_TRADE}`);

  printSummary('MECHANISCH SL×1.5 / TP×2', mechM2);
  printSummary('MECHANISCH SL×1.5 / TP×3', mechM3);

  // Vergelijking met boardroom-origineel (bekende cijfers uit boardroomBacktest run 25 mei – 20 nov 2026)
  console.log('\n── VERGELIJKING MET BOARDROOM-ORIGINEEL (Haiku, 25 mei – 20 nov 2026) ──');
  console.log('  Boardroom Variant A (n=364): WR 38% | E(R)=+0.019R');
  console.log('  Mech SL×1.5 TP×3 totaal:    zie tabel hierboven (zelfde periode)');

  if (!RUN_HYBRID) {
    console.log('\n[Hybride niet gedraaid — voeg --hybrid toe voor boardroom yes/no + ATR SL/TP]');
    return;
  }

  // ── Pass 2: hybride (boardroom yes/no + ATR SL/TP) ───────────────────
  console.log(`\nPass 2: boardroom-runs voor hybride (${CONCURRENCY} parallel)...\n`);
  let counter = 0;
  const hybridResults = await batchRun(triggerQueue, CONCURRENCY, async (trig) => {
    counter++;
    process.stdout.write(`[${counter}/${triggerQueue.length}] ${trig.time} `);

    let boardroomResult;
    try {
      boardroomResult = await runDiscussion(trig.h1Window, {
        instrument: 'XAU_USD', granularity: 'H1',
        dollarCandles: trig.eurWindow, yieldCandles: trig.yldWindow,
        h4Candles: trig.h4Window, d1Candles: trig.d1Window, w1Candles: trig.w1Window,
        currentTime: trig.time, trendMode: trig.trendMode,
        preloadedFfEvents: [], dryRun: true,
      });
    } catch (err) {
      console.error(`❗ ${err.message}`);
      return { ...trig, hybrid: null };
    }

    const { decision, qualityResult } = boardroomResult;
    const passed   = qualityResult?.passed && decision?.signal !== 'neutral';
    const boardDir = decision?.signal;

    if (!passed) {
      process.stdout.write(`↩\n`);
      return { ...trig, hybrid: { passed: false } };
    }

    const h2 = simulateATR(boardDir, trig.entry, trig.atr14, TP2_MULT, trig.futureCandles);
    const h3 = simulateATR(boardDir, trig.entry, trig.atr14, TP3_MULT, trig.futureCandles);
    const ic = h3.outcome === 'tp' ? '✅' : h3.outcome === 'sl' ? '❌' : '➖';
    process.stdout.write(`${ic} ${boardDir.toUpperCase()[0]} CEO=${decision.confidence}%\n`);

    return {
      ...trig,
      hybrid: {
        passed: true, boardDir,
        confidence: decision.confidence,
        h2: { outcome: h2.outcome, rMultiple: h2.rMultiple, slDist: h2.slDist, candlesToHit: h2.candlesToHit },
        h3: { outcome: h3.outcome, rMultiple: h3.rMultiple, slDist: h3.slDist, candlesToHit: h3.candlesToHit },
      },
    };
  });

  const hybPassed = hybridResults.filter(r => r.hybrid?.passed);
  const hybH2 = hybPassed.map(r => ({ ...r.hybrid.h2, dir: r.hybrid.boardDir, regime: r.regime, year: r.year }));
  const hybH3 = hybPassed.map(r => ({ ...r.hybrid.h3, dir: r.hybrid.boardDir, regime: r.regime, year: r.year }));

  console.log('\n' + divider);
  console.log('HYBRIDE RESULTATEN (boardroom yes/no + ATR SL/TP)');
  console.log(divider);
  console.log(`Doorgelaten: ${hybPassed.length}/${triggerQueue.length} | Geblokkeerd: ${hybridResults.length - hybPassed.length}`);

  printSummary('HYBRIDE SL×1.5 / TP×2', hybH2);
  printSummary('HYBRIDE SL×1.5 / TP×3', hybH3);

  // Drieweg vergelijking
  console.log('\n── DRIEWEG VERGELIJKING (Totaal) ──');
  const pad  = (s) => s.padEnd(28);
  const row  = (label, trades) => {
    const s = tradeStats(trades);
    const wr = s.wr != null ? (s.wr*100).toFixed(0) + '%' : '-';
    const er = s.expectancyR != null ? (s.expectancyR >= 0 ? '+' : '') + s.expectancyR + 'R' : '-';
    const ci = s.ci[0] != null ? `[${s.ci[0] >= 0 ? '+' : ''}${s.ci[0]}, ${s.ci[1] >= 0 ? '+' : ''}${s.ci[1]}]` : '';
    return `  ${pad(label)} | n=${String(s.total).padStart(3)} | WR ${wr.padStart(3)} | E(R)=${er.padStart(8)} | 95%CI ${ci}`;
  };
  console.log(row('Mech SL×1.5 TP×2', mechM2));
  console.log(row('Mech SL×1.5 TP×3', mechM3));
  console.log(row('Hybride SL×1.5 TP×2', hybH2));
  console.log(row('Hybride SL×1.5 TP×3', hybH3));
  console.log(`  ${'Boardroom origineel'.padEnd(28)} | n=364 | WR 38% | E(R)= +0.019R | (25 mei–20 nov 2026)`);
}

main().catch(err => {
  console.error('Script mislukt:', err.message);
  process.exit(1);
});
