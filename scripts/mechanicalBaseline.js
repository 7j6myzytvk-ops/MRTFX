/**
 * Mechanische baseline & hybride vergelijking — XAU/USD backtest
 *
 * Mechanische modus (default, geen API-calls):
 *   Alle conditionChecker-triggers, richting uit H1/M30 alignment,
 *   SL = 1.5×ATR, TP = 2×ATR (m2) en 3×ATR (m3).
 *
 * Hybride modus (--hybrid, vereist API-calls, Haiku aanbevolen):
 *   Dezelfde triggers. Boardroom beslist of het een signaal is (ja/nee).
 *   Bij ja: gebruik boardroom-richting, maar SL = 1.5×ATR, TP = 2× en 3×ATR.
 *
 * Gebruik:
 *   node scripts/mechanicalBaseline.js --cached --from 2026-05-25
 *   ANTHROPIC_MODEL=claude-haiku-4-5 node scripts/mechanicalBaseline.js --cached --from 2026-05-25 --hybrid
 *   node scripts/mechanicalBaseline.js --cached --from 2026-05-25 --concurrency 5
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

// Mechanische parameters
const SL_MULT = 1.5;
const TP2_MULT = 2.0;
const TP3_MULT = 3.0;

function detectRegime(d1Window) {
  if (d1Window.length < 60) return 'range';
  const closes = d1Window.map(c => c.close);
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
    const batch = items.slice(i, i + size);
    results.push(...await Promise.all(batch.map(fn)));
  }
  return results;
}

// Statistieken voor een groep trades (rMultiple-gebaseerd).
function tradeStats(trades) {
  const counted = trades.filter(t => t.outcome !== 'geen');
  const tp = trades.filter(t => t.outcome === 'tp').length;
  const sl = trades.filter(t => t.outcome === 'sl').length;
  const geen = trades.filter(t => t.outcome === 'geen').length;
  const wr = counted.length > 0 ? tp / counted.length : null;

  const withR = trades.filter(t => t.rMultiple != null && t.outcome !== 'geen');
  let expectancyR = null;
  if (withR.length > 0) {
    const slDists = withR.map(t => t.slDist);
    const avgSlDist = slDists.reduce((a, b) => a + b, 0) / slDists.length;
    const costR = avgSlDist > 0 ? COST_USD / avgSlDist : 0;
    const sumR = withR.reduce((acc, t) => acc + t.rMultiple, 0);
    expectancyR = +((sumR / withR.length) - costR).toFixed(3);
  }

  return { total: trades.length, tp, sl, geen, wr, expectancyR };
}

function printStats(label, trades) {
  if (trades.length === 0) { console.log(`  ${label}: geen trades`); return; }
  const s = tradeStats(trades);
  const wrStr = s.wr != null ? `WR ${(s.wr * 100).toFixed(0)}%` : 'WR -';
  const eStr  = s.expectancyR != null ? `E(R)=${s.expectancyR >= 0 ? '+' : ''}${s.expectancyR}R` : 'E(R)=-';
  console.log(`  ${label}: n=${s.total} (TP=${s.tp} SL=${s.sl} geen=${s.geen}) | ${wrStr} | ${eStr}`);
}

function simulateATR(dir, entry, atr14, tpMult, futureCandles) {
  const sl = dir === 'bullish' ? entry - SL_MULT * atr14 : entry + SL_MULT * atr14;
  const tp = dir === 'bullish' ? entry + tpMult * atr14  : entry - tpMult * atr14;
  const result = evaluateOutcome({ signal: dir, stopLoss: sl, takeProfit: tp }, futureCandles, entry);
  return { sl, tp, slDist: SL_MULT * atr14, ...result };
}

async function main() {
  const model = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
  console.log(`\n=== MECHANISCHE BASELINE: ${FROM_STR} → ${TO_STR} ===`);
  console.log(`Cache: ${USE_CACHE ? 'ja' : 'nee'} | Hybride: ${RUN_HYBRID ? `ja (model: ${model})` : 'nee'} | Concurrency: ${CONCURRENCY}\n`);

  let h1All, m30All, m15All, h4All, d1All, w1All, eurUsdAll, yieldAll;

  if (USE_CACHE) {
    console.log('Cache laden...');
    let cache;
    try {
      cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
    } catch {
      console.error(`Cache niet gevonden: ${CACHE_PATH}\nDraai eerst: node scripts/backfillYear.js --save-cache`);
      process.exit(1);
    }
    const inRange = (arr) => (arr || []).filter(c => c.time >= FROM_H1 && c.time <= TO);
    h1All     = filterFlatCandles(inRange(cache.h1));
    m30All    = filterFlatCandles(inRange(cache.m30));
    m15All    = filterFlatCandles(inRange(cache.m15));
    d1All     = inRange(cache.d1);
    w1All     = inRange(cache.w1);
    h4All     = [];
    eurUsdAll = [];
    yieldAll  = [];
    console.log(`H1: ${h1All.length} | M30: ${m30All.length} | M15: ${m15All.length} | D1: ${d1All.length}\n`);
  } else {
    console.log('Candles ophalen (rate-limit: 8/min)...');
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    h1All     = filterFlatCandles(await getXauUsdCandles({ granularity: 'H1', from: FROM_H1, to: TO }));
    await delay(2000);
    m30All    = filterFlatCandles(await getXauUsdCandles({ granularity: 'M30', from: FROM_H1, to: TO }));
    await delay(2000);
    m15All    = filterFlatCandles(await getXauUsdCandles({ granularity: 'M15', from: FROM_H1, to: TO }));
    await delay(2000);
    h4All     = filterFlatCandles(await getXauUsdCandles({ granularity: 'H4', from: FROM_H1, to: TO }));
    await delay(2000);
    d1All     = await getXauUsdCandles({ granularity: 'D', from: FROM_D1, to: TO });
    await delay(2000);
    w1All     = await getXauUsdCandles({ granularity: 'W', from: FROM_W1, to: TO });
    await delay(2000);
    eurUsdAll = (await getEurUsdCandles({ granularity: 'H1', from: FROM_H1, to: TO })).filter(c => c.high !== c.low);
    await delay(2000);
    yieldAll  = (await getUsYieldCandles({ granularity: 'D', from: FROM_D1, to: TO })).filter(c => c.high !== c.low);
    console.log(`H1: ${h1All.length} | M30: ${m30All.length} | M15: ${m15All.length} | D1: ${d1All.length}\n`);
  }

  // --- PASS 1: triggers & mechanische simulatie (geen API) ---
  console.log('Pass 1: triggers scannen + mechanische simulatie...');
  const triggerQueue = [];
  let lastTriggerTime = null;

  for (let i = MIN_H1_HISTORY; i < h1All.length - HORIZON_CANDLES; i++) {
    if (triggerQueue.length >= MAX_RUNS) break;

    const candle = h1All[i];
    const now    = new Date(candle.time);
    if (lastTriggerTime && now - lastTriggerTime < COOLDOWN_MS) continue;

    const h1Window  = h1All.slice(Math.max(0, i - 50), i + 1);
    const m30Window = m30All.filter(c => c.time <= candle.time).slice(-100);
    const m15Window = m15All.filter(c => c.time <= candle.time).slice(-100);
    const h4Window  = h4All.filter(c => c.time <= candle.time).slice(-50);
    const d1Window  = d1All.filter(c => c.time <= candle.time).slice(-60);
    const w1Window  = w1All.filter(c => c.time <= candle.time).slice(-20);
    const eurWindow = eurUsdAll.filter(c => c.time <= candle.time).slice(-50);
    const yldWindow = yieldAll.filter(c => c.time <= candle.time).slice(-25);

    if (m30Window.length < 20 || m15Window.length < 20) continue;

    const conditions = checkConditions({
      h1Candles: h1Window, m30Candles: m30Window, m15Candles: m15Window,
      h4Candles: h4Window, d1Candles: d1Window, w1Candles: w1Window, now,
    });
    if (!conditions.triggered) continue;
    lastTriggerTime = now;

    const futureCandles = h1All.slice(i + 1, i + 1 + HORIZON_CANDLES);
    const regime  = detectRegime(d1Window);
    const atr14   = atr(h1Window.slice(-50), 14) ?? 15;
    const entry   = candle.close;
    const dir     = conditions.direction;  // conditionChecker-richting (H1+M30 alignment)

    const m2 = simulateATR(dir, entry, atr14, TP2_MULT, futureCandles);
    const m3 = simulateATR(dir, entry, atr14, TP3_MULT, futureCandles);

    triggerQueue.push({
      time: candle.time.slice(0, 16), dir, regime, entry, atr14,
      futureCandles, h1Window, m30Window, m15Window, h4Window, d1Window, w1Window,
      eurWindow, yldWindow, trendMode: conditions.trendMode,
      mech: { m2: { outcome: m2.result, rMultiple: m2.rMultiple, slDist: m2.slDist },
               m3: { outcome: m3.result, rMultiple: m3.rMultiple, slDist: m3.slDist } },
    });
  }

  console.log(`Pass 1 klaar: ${triggerQueue.length} triggers.\n`);

  // --- PASS 2 (optioneel): boardroom yes/no voor hybride ---
  let hybridResults = null;
  if (RUN_HYBRID) {
    console.log(`Pass 2: boardroom-runs voor hybride (${CONCURRENCY} parallel)...\n`);
    let counter = 0;
    hybridResults = await batchRun(triggerQueue, CONCURRENCY, async (trig) => {
      counter++;
      console.log(`[${counter}/${triggerQueue.length}] ${trig.time} | ${trig.dir.toUpperCase()} | regime=${trig.regime}`);

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
        console.error(`  ❗ Boardroom mislukt: ${err.message}`);
        return { ...trig, hybrid: null };
      }

      const { decision, qualityResult } = boardroomResult;
      const passed   = qualityResult?.passed && decision?.signal !== 'neutral';
      const boardDir = decision?.signal;

      if (!passed) {
        const reason = decision?.signal === 'neutral'
          ? `CEO neutraal (${decision.confidence}%)`
          : `geblokkeerd: ${qualityResult.blockers?.join(', ')}`;
        console.log(`  ↩  ${reason}`);
        return { ...trig, hybrid: { passed: false, reason } };
      }

      // Hybride: boardroom zei ja, maar SL/TP mechanisch uit ATR
      const h2 = simulateATR(boardDir, trig.entry, trig.atr14, TP2_MULT, trig.futureCandles);
      const h3 = simulateATR(boardDir, trig.entry, trig.atr14, TP3_MULT, trig.futureCandles);
      const icon2 = h2.result === 'tp' ? '✅' : h2.result === 'sl' ? '❌' : '➖';
      const icon3 = h3.result === 'tp' ? '✅' : h3.result === 'sl' ? '❌' : '➖';
      console.log(`  ${icon2}H2 ${boardDir.toUpperCase()} CEO=${decision.confidence}% | h2=${h2.result} h3=${icon3}${h3.result}`);

      return {
        ...trig,
        hybrid: {
          passed: true,
          boardDir,
          confidence: decision.confidence,
          h2: { outcome: h2.result, rMultiple: h2.rMultiple, slDist: h2.slDist },
          h3: { outcome: h3.result, rMultiple: h3.rMultiple, slDist: h3.slDist },
        },
      };
    });
    console.log('\nPass 2 klaar.\n');
  }

  // --- SAMENVATTING ---
  const divider = '═'.repeat(70);
  console.log('\n' + divider);
  console.log('MECHANISCHE BASELINE RESULTATEN');
  console.log(divider);
  console.log(`Periode: ${FROM_STR} → ${TO_STR}`);
  console.log(`Triggers totaal: ${triggerQueue.length}`);

  // Mechanisch m2 (SL×1.5, TP×2)
  const mechM2 = triggerQueue.map(t => ({ ...t.mech.m2, dir: t.dir, regime: t.regime }));
  const mechM3 = triggerQueue.map(t => ({ ...t.mech.m3, dir: t.dir, regime: t.regime }));

  console.log(`\n── MECHANISCH SL×1.5 / TP×2 (n=${mechM2.length}) ──`);
  printStats('Totaal (alle triggers)', mechM2);
  printStats('Bullish', mechM2.filter(t => t.dir === 'bullish'));
  printStats('Bearish', mechM2.filter(t => t.dir === 'bearish'));
  for (const r of ['trend-up', 'trend-down', 'range']) {
    printStats(r, mechM2.filter(t => t.regime === r));
  }

  console.log(`\n── MECHANISCH SL×1.5 / TP×3 (n=${mechM3.length}) ──`);
  printStats('Totaal (alle triggers)', mechM3);
  printStats('Bullish', mechM3.filter(t => t.dir === 'bullish'));
  printStats('Bearish', mechM3.filter(t => t.dir === 'bearish'));
  for (const r of ['trend-up', 'trend-down', 'range']) {
    printStats(r, mechM3.filter(t => t.regime === r));
  }

  // Vergelijking met boardroom-origineel (bekende cijfers uit vorige run)
  console.log('\n── VERGELIJKING MET BOARDROOM-ORIGINEEL (Haiku, 25 mei – 20 nov 2026) ──');
  console.log('  Boardroom Variant A:   n=364 | WR 38% | E(R)=+0.019R (SL boardroom, TP boardroom)');
  console.log('  ATR-fallback trades:   n=26  | WR 42% | E(R)=+0.321R (SL×1.0, TP×2.0)');
  console.log('  Mechanisch SL×1.5 TP×2: zie tabel hierboven');
  console.log('  Mechanisch SL×1.5 TP×3: zie tabel hierboven');

  if (!RUN_HYBRID) {
    console.log('\n[Hybride niet gedraaid — voeg --hybrid toe voor boardroom yes/no + ATR SL/TP]');
    return;
  }

  // Hybride resultaten
  const hybPassed = hybridResults.filter(r => r.hybrid?.passed);
  const hybH2 = hybPassed.map(r => ({ ...r.hybrid.h2, dir: r.hybrid.boardDir, regime: r.regime }));
  const hybH3 = hybPassed.map(r => ({ ...r.hybrid.h3, dir: r.hybrid.boardDir, regime: r.regime }));

  console.log(`\n${divider}`);
  console.log('HYBRIDE RESULTATEN (boardroom yes/no + ATR SL/TP)');
  console.log(divider);
  console.log(`Triggers: ${triggerQueue.length} | Doorgelaten door boardroom: ${hybPassed.length} | Geblokkeerd: ${hybridResults.length - hybPassed.length}`);

  console.log(`\n── HYBRIDE SL×1.5 / TP×2 (n=${hybH2.length}) ──`);
  printStats('Totaal', hybH2);
  printStats('Bullish', hybH2.filter(t => t.dir === 'bullish'));
  printStats('Bearish', hybH2.filter(t => t.dir === 'bearish'));
  for (const r of ['trend-up', 'trend-down', 'range']) {
    printStats(r, hybH2.filter(t => t.regime === r));
  }

  console.log(`\n── HYBRIDE SL×1.5 / TP×3 (n=${hybH3.length}) ──`);
  printStats('Totaal', hybH3);
  printStats('Bullish', hybH3.filter(t => t.dir === 'bullish'));
  printStats('Bearish', hybH3.filter(t => t.dir === 'bearish'));
  for (const r of ['trend-up', 'trend-down', 'range']) {
    printStats(r, hybH3.filter(t => t.regime === r));
  }

  console.log(`\n── DRIEWEG VERGELIJKING (Totaal) ──`);
  const bA = { label: 'Boardroom origineel (n=364)', wr: 0.38, er: 0.019 };
  const mS2 = tradeStats(mechM2);
  const mS3 = tradeStats(mechM3);
  const hS2 = tradeStats(hybH2);
  const hS3 = tradeStats(hybH3);

  const row = (label, s) =>
    `  ${label.padEnd(32)} | n=${String(s.total).padStart(3)} | WR ${s.wr != null ? (s.wr*100).toFixed(0).padStart(2) + '%' : ' -'} | E(R)=${s.expectancyR != null ? (s.expectancyR >= 0 ? '+' : '') + s.expectancyR + 'R' : '-'}`;

  console.log(row('Mech SL×1.5 TP×2', mS2));
  console.log(row('Mech SL×1.5 TP×3', mS3));
  console.log(row('Hybride SL×1.5 TP×2', hS2));
  console.log(row('Hybride SL×1.5 TP×3', hS3));
  console.log(`  ${'Boardroom origineel'.padEnd(32)} | n=364 | WR 38% | E(R)=+0.019R`);
}

main().catch(err => {
  console.error('Script mislukt:', err.message);
  process.exit(1);
});
