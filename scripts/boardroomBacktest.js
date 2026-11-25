/**
 * Boardroom Backtest — voert de volledige AI-boardroom uit op historische data.
 *
 * Gebruik:
 *   node scripts/boardroomBacktest.js
 *   node scripts/boardroomBacktest.js --from 2026-09-01 --to 2026-11-25
 *   node scripts/boardroomBacktest.js --cached          ← gebruik data/backtest-candles.json
 *   node scripts/boardroomBacktest.js --max 20
 *   node scripts/boardroomBacktest.js --concurrency 5
 *   ANTHROPIC_MODEL=claude-haiku-4-5 node scripts/boardroomBacktest.js --cached
 *
 * Architectuur: twee-pass
 *   Pass 1: scan H1-candles → triggers (geen API-calls)
 *   Pass 2: boardroom-runs in parallel batches
 *
 * Rapporten:
 *   - Variant A: entry op slotkoers trigger-candle (huidig)
 *   - Variant B: entry pas als prijs de entry-zone raakt ≤12 candles na trigger
 *                Niet gevuld binnen 12 candles → 'niet_gevuld', telt NIET als trade
 *   - ATR-fallback trades (ongeldige SL/TP boardroom) apart geteld, uitgesloten van hoofdcijfers
 *   - Regimes: trend-up, trend-down, range (op basis van D1 SMA50 richting)
 *   - Verwachtingswaarde in echte R (rMultiple uit outcomeEvaluator, na $0.70 kosten)
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
const USE_CACHE  = args.includes('--cached');
const FROM_STR   = getArg('--from') ?? '2026-05-25';
const TO_STR     = getArg('--to')   ?? new Date().toISOString().slice(0, 10);
const MAX_RUNS   = getArg('--max')         ? parseInt(getArg('--max'), 10) : Infinity;
const CONCURRENCY = getArg('--concurrency') ? parseInt(getArg('--concurrency'), 10) : 3;

const FROM_H1 = `${FROM_STR} 00:00:00`;
const FROM_D1 = new Date(new Date(FROM_STR).setMonth(new Date(FROM_STR).getMonth() - 6))
  .toISOString().slice(0, 10) + ' 00:00:00';
const FROM_W1 = new Date(new Date(FROM_STR).setFullYear(new Date(FROM_STR).getFullYear() - 1))
  .toISOString().slice(0, 10) + ' 00:00:00';
const TO = `${TO_STR} 23:59:59`;

const COOLDOWN_MS    = 4 * 60 * 60 * 1000;
const MIN_H1_HISTORY = 50;
const SL_ATR_MULT    = 1.0;
const TP_ATR_MULT    = 2.0;
const ENTRY_FILL_WINDOW = 12;  // candles waarbinnen entry-zone geraakt moet worden (Variant B)
const COST_PER_TRADE_USD = 0.70;

// Verwerk items in batches van `size` tegelijk.
async function batchRun(items, size, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    results.push(...await Promise.all(batch.map(fn)));
  }
  return results;
}

// Bepaal marktregime op basis van D1 SMA50-richting.
// Vergelijkt huidige SMA50 met SMA50 van 10 D1-candles geleden.
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

// Parses entry-zone string "$ X – $ Y" naar [low, high]. Null als niet parseerbaar.
function parseEntryZone(entryZoneStr) {
  if (!entryZoneStr) return null;
  const clean = entryZoneStr.replace(/\$/g, '').replace(/\s/g, '');
  const m = clean.match(/([\d.]+)[–\-]([\d.]+)/);
  if (!m) {
    // "Directe markt-entry ~$X" → gebruik X als exacte entry
    const single = clean.match(/~?([\d.]+)/);
    if (single) { const v = parseFloat(single[1]); return [v, v]; }
    return null;
  }
  return [parseFloat(m[1]), parseFloat(m[2])];
}

// Simuleer of de entry-zone geraakt wordt binnen `window` candles na de trigger.
// Retourneert de gevulde entry-prijs (midpoint zone) of null als niet gevuld.
function simulateEntryFill(signal, entryZone, futureCandles, window) {
  const zone = parseEntryZone(entryZone);
  if (!zone) return null;         // onparseerbare zone → niet gevuld
  const [zoneLow, zoneHigh] = zone;
  const entryMid = (zoneLow + zoneHigh) / 2;

  const lookWindow = futureCandles.slice(0, window);
  for (const c of lookWindow) {
    if (signal === 'bullish' && c.low  <= zoneHigh) return entryMid;
    if (signal === 'bearish' && c.high >= zoneLow)  return entryMid;
  }
  return null;
}

// Rapporteer statistieken voor een groep trades.
function tradeStats(trades, costUsd) {
  const tpTrades  = trades.filter(t => t.outcome === 'tp');
  const slTrades  = trades.filter(t => t.outcome === 'sl');
  const geenTrades = trades.filter(t => t.outcome === 'geen');
  const counted   = tpTrades.length + slTrades.length;  // 'geen' telt niet mee voor WR/E
  const wr        = counted > 0 ? tpTrades.length / counted : null;

  // Verwachtingswaarde in R via werkelijke rMultiple
  const withR = trades.filter(t => t.rMultiple != null && t.outcome !== 'geen');
  let expectancyR = null;
  if (withR.length > 0) {
    const slDists = withR.map(t => Math.abs(parseFloat(t.entry) - parseFloat(t.sl)));
    const avgSlDist = slDists.reduce((a, b) => a + b, 0) / slDists.length;
    const costR = avgSlDist > 0 ? costUsd / avgSlDist : 0;
    const sumR  = withR.reduce((acc, t) => acc + t.rMultiple, 0);
    expectancyR = +(( sumR / withR.length ) - costR).toFixed(3);
  }

  return { total: trades.length, tp: tpTrades.length, sl: slTrades.length, geen: geenTrades.length, wr, expectancyR };
}

function printStats(label, trades, costUsd) {
  if (trades.length === 0) { console.log(`  ${label}: geen trades`); return; }
  const s = tradeStats(trades, costUsd);
  const wrStr = s.wr != null ? `WR ${(s.wr*100).toFixed(0)}%` : 'WR -';
  const eStr  = s.expectancyR != null ? `E(R)=${s.expectancyR > 0 ? '+' : ''}${s.expectancyR}R` : 'E(R)=-';
  console.log(`  ${label}: n=${s.total} (TP=${s.tp} SL=${s.sl} geen=${s.geen}) | ${wrStr} | ${eStr}`);
}

async function main() {
  const model = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
  console.log(`\n=== BOARDROOM BACKTEST: ${FROM_STR} → ${TO_STR} ===`);
  console.log(`Model: ${model} | Cache: ${USE_CACHE ? 'ja (data/backtest-candles.json)' : 'nee (live API)'} | Concurrency: ${CONCURRENCY}`);

  let h1All, m30All, m15All, h4All, d1All, w1All, eurUsdAll, yieldAll;

  if (USE_CACHE) {
    // --- Candles uit lokale cache ---
    console.log('Cache laden...');
    let cache;
    try {
      cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
    } catch {
      console.error(`Cache niet gevonden: ${CACHE_PATH}\nDraai eerst: node scripts/backfillYear.js --save-cache`);
      process.exit(1);
    }

    // Cache heeft h1/m30/m15/d1/w1 velden (van backfillYear.js).
    // Veld h4 ontbreekt mogelijk — simuleer met h1 downsampled of laat leeg.
    const inRange = (arr) => (arr || []).filter(c => c.time >= FROM_H1 && c.time <= TO);
    h1All     = filterFlatCandles(inRange(cache.h1));
    m30All    = filterFlatCandles(inRange(cache.m30));
    m15All    = filterFlatCandles(inRange(cache.m15));
    d1All     = inRange(cache.d1);
    w1All     = inRange(cache.w1);
    // H4 ontbreekt in cache — maak leeg array (boardroom werkt ook zonder)
    h4All     = [];
    // EUR/USD en yield zijn niet gecached — gebruik lege arrays (boardroom valideert graceful)
    eurUsdAll = [];
    yieldAll  = [];
    console.log(`H1: ${h1All.length} | M30: ${m30All.length} | M15: ${m15All.length} | D1: ${d1All.length} | W1: ${w1All.length}\n`);

  } else {
    // --- Candles live van API ---
    console.log('Candles ophalen (even wachten — rate limit is 8 calls/min)...\n');
    const h1Raw  = await getXauUsdCandles({ granularity: 'H1',  from: FROM_H1, to: TO });
    await new Promise(r => setTimeout(r, 2000));
    const m30Raw = await getXauUsdCandles({ granularity: 'M30', from: FROM_H1, to: TO });
    await new Promise(r => setTimeout(r, 2000));
    const m15Raw = await getXauUsdCandles({ granularity: 'M15', from: FROM_H1, to: TO });
    await new Promise(r => setTimeout(r, 2000));
    const h4Raw  = await getXauUsdCandles({ granularity: 'H4',  from: FROM_H1, to: TO });
    await new Promise(r => setTimeout(r, 2000));
    const d1Raw  = await getXauUsdCandles({ granularity: 'D',   from: FROM_D1, to: TO });
    await new Promise(r => setTimeout(r, 2000));
    const w1Raw  = await getXauUsdCandles({ granularity: 'W',   from: FROM_W1, to: TO });
    await new Promise(r => setTimeout(r, 2000));
    const eurUsdRaw = await getEurUsdCandles({ granularity: 'H1', from: FROM_H1, to: TO });
    await new Promise(r => setTimeout(r, 2000));
    const yieldRaw  = await getUsYieldCandles({ granularity: 'D', from: FROM_D1, to: TO });

    h1All     = filterFlatCandles(h1Raw);
    m30All    = filterFlatCandles(m30Raw);
    m15All    = filterFlatCandles(m15Raw);
    h4All     = filterFlatCandles(h4Raw);
    d1All     = d1Raw;
    w1All     = w1Raw;
    eurUsdAll = eurUsdRaw.filter(c => c.high !== c.low);
    yieldAll  = yieldRaw.filter(c => c.high !== c.low);
    console.log(`H1: ${h1All.length} | M30: ${m30All.length} | M15: ${m15All.length} | H4: ${h4All.length} | D1: ${d1All.length} | W1: ${w1All.length}`);
    console.log(`EUR/USD: ${eurUsdAll.length} | Yield: ${yieldAll.length}\n`);
  }

  // --- PASS 1: triggers verzamelen ---
  console.log('Pass 1: triggers scannen...');
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
      h1Candles:  h1Window,
      m30Candles: m30Window,
      m15Candles: m15Window,
      h4Candles:  h4Window,
      d1Candles:  d1Window,
      w1Candles:  w1Window,
      now,
    });

    if (!conditions.triggered) continue;
    lastTriggerTime = now;

    // Candles ná trigger voor outcome-simulatie (extra 12 voor entry-fill check Variant B)
    const futureCandles = h1All.slice(i + 1, i + 1 + HORIZON_CANDLES + ENTRY_FILL_WINDOW);
    const regime = detectRegime(d1Window);

    triggerQueue.push({
      candle, conditions, regime,
      h1Window, m30Window, m15Window, h4Window, d1Window, w1Window,
      eurWindow, yldWindow, futureCandles,
    });
  }

  console.log(`Pass 1 klaar: ${triggerQueue.length} triggers gevonden.\n`);
  console.log(`Pass 2: boardroom-runs (${CONCURRENCY} parallel)...\n`);

  // --- PASS 2: boardroom-runs ---
  let runCounter = 0;

  const results = await batchRun(triggerQueue, CONCURRENCY, async (trig) => {
    runCounter++;
    const {
      candle, conditions, regime,
      h1Window, m30Window, m15Window, h4Window, d1Window, w1Window,
      eurWindow, yldWindow, futureCandles,
    } = trig;

    const trendLabel = conditions.trendMode ? ' [TREND]' : '';
    console.log(`[${runCounter}/${triggerQueue.length}] ${candle.time.slice(0, 16)} | ${conditions.direction.toUpperCase()}${trendLabel} | regime=${regime}`);

    let boardroomResult;
    try {
      boardroomResult = await runDiscussion(h1Window, {
        instrument: 'XAU_USD', granularity: 'H1',
        dollarCandles: eurWindow, yieldCandles: yldWindow,
        h4Candles: h4Window, d1Candles: d1Window, w1Candles: w1Window,
        currentTime: candle.time, trendMode: conditions.trendMode,
        preloadedFfEvents: [], dryRun: true,
      });
    } catch (err) {
      console.error(`  ❗ Boardroom mislukt: ${err.message}`);
      return null;
    }

    const { decision, qualityResult } = boardroomResult;
    const signal     = decision?.signal;
    const confidence = decision?.confidence;
    const setupScore = boardroomResult.discussion?.analyst?.setupQualityScore ?? '?';
    const passed     = qualityResult?.passed;

    if (signal === 'neutral' || !passed) {
      const reason = signal === 'neutral'
        ? `CEO → neutraal (${confidence}%)`
        : `kwaliteitsfilter: ${qualityResult.blockers?.join(', ')}`;
      console.log(`  ↩  Gefilterd — ${reason}`);
      return {
        time: candle.time.slice(0, 16), dir: conditions.direction,
        trendMode: conditions.trendMode, regime,
        boardroomSignal: signal, confidence, setupScore, passed,
        outcome: 'gefilterd',
      };
    }

    // --- SL/TP validatie met ATR-fallback ---
    const atr14  = atr(h1Window.slice(-50), 14) ?? 15;
    const entryA = candle.close;   // Variant A: slotkoers trigger-candle
    const atrSl  = signal === 'bullish' ? entryA - atr14 * SL_ATR_MULT : entryA + atr14 * SL_ATR_MULT;
    const atrTp  = signal === 'bullish' ? entryA + atr14 * TP_ATR_MULT : entryA - atr14 * TP_ATR_MULT;
    const slRaw  = decision.stopLoss  ?? atrSl;
    const tpRaw  = decision.takeProfit ?? atrTp;
    const slValid = signal === 'bullish' ? slRaw < entryA : slRaw > entryA;
    const tpValid = signal === 'bullish' ? tpRaw > entryA : tpRaw < entryA;
    const usedAtrFallback = !slValid || !tpValid;
    // Wat was er precies fout — voor telwerk in samenvatting.
    const wrongSideDetail = !slValid && !tpValid ? 'SL+TP'
      : !slValid ? 'SL'
      : !tpValid ? 'TP'
      : null;
    const sl = slValid ? slRaw : atrSl;
    const tp = tpValid ? tpRaw : atrTp;
    if (usedAtrFallback) console.log(`  ⚠️  ${wrongSideDetail} aan verkeerde kant → ATR-fallback (SL $${sl.toFixed(1)} TP $${tp.toFixed(1)})`);

    // --- Variant A: entry = slotkoers trigger ---
    const outcomeA = evaluateOutcome({ signal, stopLoss: sl, takeProfit: tp }, futureCandles, entryA);
    const iconA    = outcomeA.result === 'tp' ? '✅' : outcomeA.result === 'sl' ? '❌' : '➖';
    const hitA     = outcomeA.candlesToHit ? ` na ${outcomeA.candlesToHit}h` : '';
    console.log(`  ${iconA}A ${signal.toUpperCase()} | CEO ${confidence}% | score ${setupScore}/6 | $${entryA.toFixed(1)} SL$${sl.toFixed(1)} TP$${tp.toFixed(1)} | ${outcomeA.result}${hitA}${usedAtrFallback ? ' [ATR]' : ''}`);

    // --- Variant B: entry als entry-zone geraakt wordt (≤12 candles) ---
    let outcomeB = null;
    let entryB   = null;
    let entryBFilled = false;
    if (!usedAtrFallback && decision.entryZone) {
      entryB = simulateEntryFill(signal, decision.entryZone, futureCandles, ENTRY_FILL_WINDOW);
      if (entryB !== null) {
        entryBFilled = true;
        // Herschaal SL/TP relatief aan nieuwe entry zodat R:R consistent blijft
        const rSize = Math.abs(entryA - sl);
        const slB = signal === 'bullish' ? entryB - rSize : entryB + rSize;
        const tpB = signal === 'bullish' ? entryB + rSize * TP_ATR_MULT / SL_ATR_MULT
                                         : entryB - rSize * TP_ATR_MULT / SL_ATR_MULT;
        // Candles ná de fill-candle gebruiken voor outcome
        const fillCandles = futureCandles.slice(ENTRY_FILL_WINDOW);
        outcomeB = evaluateOutcome({ signal, stopLoss: slB, takeProfit: tpB }, fillCandles, entryB);
        const iconB = outcomeB.result === 'tp' ? '✅' : outcomeB.result === 'sl' ? '❌' : '➖';
        console.log(`  ${iconB}B filled=$${entryB.toFixed(1)} | ${outcomeB.result}${outcomeB.candlesToHit ? ` na ${outcomeB.candlesToHit}h` : ''}`);
      } else {
        console.log(`  ⬜B niet gevuld (zone ${decision.entryZone} niet bereikt in ${ENTRY_FILL_WINDOW}h)`);
      }
    }

    return {
      time: candle.time.slice(0, 16), dir: conditions.direction,
      trendMode: conditions.trendMode, regime,
      boardroomSignal: signal, confidence, setupScore, passed,
      entryZone: decision.entryZone ?? null,
      usedAtrFallback, wrongSideDetail: wrongSideDetail ?? null,
      // Variant A
      entry: entryA.toFixed(2), sl: sl.toFixed(2), tp: tp.toFixed(2),
      outcome: outcomeA.result, candles: outcomeA.candlesToHit ?? null,
      rMultiple: outcomeA.rMultiple ?? null,
      mfe: outcomeA.mfe ?? null, mae: outcomeA.mae ?? null,
      // Variant B
      entryBFilled,
      entryB:    entryB   != null ? entryB.toFixed(2)   : null,
      outcomeB:  outcomeB != null ? outcomeB.result      : (entryBFilled ? null : 'niet_gevuld'),
      rMultipleB: outcomeB?.rMultiple ?? null,
    };
  });

  const cleanResults = results.filter(Boolean);

  // --- Samenvatting ---
  const doorgelaten = cleanResults.filter(r => r.passed && r.outcome !== 'gefilterd');
  // Hoofdcijfers: exclude ATR-fallback trades
  const mainTrades  = doorgelaten.filter(r => !r.usedAtrFallback);
  const atrFallback = doorgelaten.filter(r =>  r.usedAtrFallback);
  // Variant B: alleen trades met boardroom entry-zone (geen ATR-fallback) en filled
  const varBTrades  = mainTrades.filter(r => r.entryBFilled);
  const varBNoFill  = mainTrades.filter(r => r.entryZone && !r.entryBFilled).length;

  console.log('\n' + '═'.repeat(65));
  console.log('BOARDROOM BACKTEST RESULTATEN');
  console.log('═'.repeat(65));
  console.log(`Periode:          ${FROM_STR} → ${TO_STR}`);
  console.log(`Model:            ${model}`);
  console.log(`Triggers totaal:  ${triggerQueue.length}`);
  console.log(`Doorgelaten:      ${doorgelaten.length}  (ATR-fallback ${atrFallback.length} apart)`);
  console.log(`Gefilterd:        ${cleanResults.length - doorgelaten.length}`);
  console.log(`Filter-ratio:     ${triggerQueue.length > 0 ? Math.round(doorgelaten.length / triggerQueue.length * 100) : '-'}%`);

  console.log('\n── VARIANT A: entry op slotkoers trigger (hoofdcijfers, excl. ATR-fallback) ──');
  printStats('Totaal', mainTrades, COST_PER_TRADE_USD);
  printStats('Bullish', mainTrades.filter(r => r.boardroomSignal === 'bullish'), COST_PER_TRADE_USD);
  printStats('Bearish', mainTrades.filter(r => r.boardroomSignal === 'bearish'), COST_PER_TRADE_USD);

  console.log('\n── REGIME-SPLITS (Variant A) ──');
  for (const regime of ['trend-up', 'trend-down', 'range']) {
    printStats(regime, mainTrades.filter(r => r.regime === regime), COST_PER_TRADE_USD);
  }

  console.log('\n── VARIANT B: entry op entry-zone fill (≤12 candles) ──');
  console.log(`  Trades met entry-zone: ${mainTrades.filter(r => r.entryZone).length}`);
  console.log(`  Gevuld: ${varBTrades.length} | Niet gevuld (overgeslagen): ${varBNoFill}`);
  printStats('Gevuld (hoofdcijfers B)', varBTrades, COST_PER_TRADE_USD);

  console.log('\n── ATR-FALLBACK TRADES (apart, buiten hoofdcijfers) ──');
  printStats('ATR-fallback totaal', atrFallback, COST_PER_TRADE_USD);
  // Uitsplitsing: wat was er fout aan de boardroom SL/TP?
  const wrongSL    = doorgelaten.filter(r => r.wrongSideDetail === 'SL' || r.wrongSideDetail === 'SL+TP');
  const wrongTP    = doorgelaten.filter(r => r.wrongSideDetail === 'TP' || r.wrongSideDetail === 'SL+TP');
  const wrongBoth  = doorgelaten.filter(r => r.wrongSideDetail === 'SL+TP');
  if (atrFallback.length > 0) {
    console.log(`  Verkeerde kant: SL=${wrongSL.length} | TP=${wrongTP.length} | SL+TP=${wrongBoth.length}`);
    console.log(`  (${((atrFallback.length / doorgelaten.length) * 100).toFixed(0)}% van alle doorgelaten trades had ongeldige boardroom SL/TP)`);
  }

  // Score-breakdown
  const scoreGroups = {};
  for (const r of mainTrades) {
    const k = `${r.setupScore}/6`;
    if (!scoreGroups[k]) scoreGroups[k] = [];
    scoreGroups[k].push(r);
  }
  if (Object.keys(scoreGroups).length > 0) {
    console.log('\n── SCORE-BREAKDOWN (Variant A) ──');
    for (const [score, trades] of Object.entries(scoreGroups).sort()) {
      printStats(`Score ${score}`, trades, COST_PER_TRADE_USD);
    }
  }

  console.log('\n=== TIJDLIJN ===');
  for (const r of cleanResults) {
    const trend = r.trendMode ? ' [TREND]' : '';
    const reg   = ` [${r.regime}]`;
    if (r.outcome === 'gefilterd') {
      const reason = r.boardroomSignal === 'neutral' ? `CEO ${r.confidence}% → neutraal` : 'kwaliteitsfilter';
      console.log(`⬜ ${r.time} | ${r.dir.toUpperCase().padEnd(7)} | score ${r.setupScore}/6 | ${reason}${trend}${reg}`);
    } else {
      const iconA = r.outcome === 'tp' ? '✅' : r.outcome === 'sl' ? '❌' : '➖';
      const hitA  = r.candles ? ` na ${r.candles}h` : '';
      const atr   = r.usedAtrFallback ? ' [ATR]' : '';
      const rStr  = r.rMultiple != null ? ` ${r.rMultiple > 0 ? '+' : ''}${r.rMultiple}R` : '';
      let bLine   = '';
      if (r.outcomeB === 'niet_gevuld') bLine = ' | B:⬜niet gevuld';
      else if (r.outcomeB) {
        const iconB = r.outcomeB === 'tp' ? '✅' : r.outcomeB === 'sl' ? '❌' : '➖';
        const rB    = r.rMultipleB != null ? ` ${r.rMultipleB > 0 ? '+' : ''}${r.rMultipleB}R` : '';
        bLine = ` | B:${iconB}${rB}`;
      }
      console.log(`${iconA}A ${r.time} | ${r.boardroomSignal.toUpperCase().padEnd(7)} | $${r.entry} | CEO ${r.confidence}% | score ${r.setupScore}/6 | ${r.outcome}${hitA}${rStr}${atr}${bLine}${trend}${reg}`);
    }
  }
}

main().catch(err => {
  console.error('Backtest mislukt:', err.message);
  process.exit(1);
});
