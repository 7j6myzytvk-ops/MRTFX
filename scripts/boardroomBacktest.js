/**
 * Boardroom Backtest — voert de volledige AI-boardroom uit op historische data.
 *
 * Verschil met replay.js:
 *   - replay.js: alleen mechanische conditie-trigger, geen boardroom-calls
 *   - dit script: conditionChecker → volledige runDiscussion (analist + team + CEO)
 *
 * Gebruik:
 *   node scripts/boardroomBacktest.js
 *   node scripts/boardroomBacktest.js --from 2026-09-01 --to 2026-11-01
 *   node scripts/boardroomBacktest.js --max 20
 *   node scripts/boardroomBacktest.js --concurrency 5
 *
 * Sneller draaien met goedkoper model:
 *   ANTHROPIC_MODEL=claude-haiku-4-5 node scripts/boardroomBacktest.js --max 20
 *   ANTHROPIC_MODEL=claude-sonnet-5-5 node scripts/boardroomBacktest.js --max 20
 *
 * Architectuur: twee-pass
 *   Pass 1: scan alle H1-candles → verzamel triggers (geen API-kosten)
 *   Pass 2: boardroom-runs in parallel batches → veel sneller dan sequentieel
 */

import { getXauUsdCandles, getEurUsdCandles, getUsYieldCandles } from '../services/marketData.js';
import { checkConditions } from '../services/conditionChecker.js';
import { runDiscussion } from '../agents/boardroom.js';
import { atr } from '../agents/indicators.js';
import { evaluateOutcome, filterFlatCandles, HORIZON_CANDLES } from '../agents/outcomeEvaluator.js';

// --- CLI args ---
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
}

const FROM_STR   = getArg('--from') ?? '2026-09-01';
const TO_STR     = getArg('--to') ?? new Date().toISOString().slice(0, 10);
const MAX_RUNS   = getArg('--max') ? parseInt(getArg('--max'), 10) : Infinity;
const CONCURRENCY = getArg('--concurrency') ? parseInt(getArg('--concurrency'), 10) : 3;

const FROM_H1 = `${FROM_STR} 00:00:00`;
const FROM_H4 = `${FROM_STR} 00:00:00`;
const FROM_D1 = new Date(new Date(FROM_STR).setMonth(new Date(FROM_STR).getMonth() - 6))
  .toISOString().slice(0, 10) + ' 00:00:00';
const FROM_W1 = new Date(new Date(FROM_STR).setFullYear(new Date(FROM_STR).getFullYear() - 1))
  .toISOString().slice(0, 10) + ' 00:00:00';
const TO = `${TO_STR} 23:59:59`;

const COOLDOWN_MS    = 4 * 60 * 60 * 1000;
const MIN_H1_HISTORY = 50;
const SL_ATR_MULT    = 1.0;
const TP_ATR_MULT    = 2.0;

// Verwerk een array van items in batches van `size` tegelijk.
async function batchRun(items, size, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

async function main() {
  const model = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
  console.log(`\n=== BOARDROOM BACKTEST: ${FROM_STR} → ${TO_STR} ===`);
  console.log(`Model: ${model} | Max runs: ${MAX_RUNS === Infinity ? 'alles' : MAX_RUNS} | Concurrency: ${CONCURRENCY}`);
  console.log('Candles ophalen (even wachten — rate limit is 8 calls/min)...\n');

  // Stagger fetches om rate limit te vermijden
  const h1Raw  = await getXauUsdCandles({ granularity: 'H1',  from: FROM_H1, to: TO });
  await new Promise(r => setTimeout(r, 2000));
  const m30Raw = await getXauUsdCandles({ granularity: 'M30', from: FROM_H1, to: TO });
  await new Promise(r => setTimeout(r, 2000));
  const m15Raw = await getXauUsdCandles({ granularity: 'M15', from: FROM_H1, to: TO });
  await new Promise(r => setTimeout(r, 2000));
  const h4Raw  = await getXauUsdCandles({ granularity: 'H4',  from: FROM_H4, to: TO });
  await new Promise(r => setTimeout(r, 2000));
  const d1Raw  = await getXauUsdCandles({ granularity: 'D',   from: FROM_D1, to: TO });
  await new Promise(r => setTimeout(r, 2000));
  const w1Raw  = await getXauUsdCandles({ granularity: 'W',   from: FROM_W1, to: TO });
  await new Promise(r => setTimeout(r, 2000));
  const eurUsdRaw = await getEurUsdCandles({ granularity: 'H1', from: FROM_H1, to: TO });
  await new Promise(r => setTimeout(r, 2000));
  const yieldRaw  = await getUsYieldCandles({ granularity: 'D', from: FROM_D1, to: TO });

  const h1All     = filterFlatCandles(h1Raw);
  const m30All    = filterFlatCandles(m30Raw);
  const m15All    = filterFlatCandles(m15Raw);
  const h4All     = filterFlatCandles(h4Raw);
  const d1All     = d1Raw;
  const w1All     = w1Raw;
  const eurUsdAll = eurUsdRaw.filter(c => c.high !== c.low);
  const yieldAll  = yieldRaw.filter(c => c.high !== c.low);

  console.log(`H1: ${h1All.length} | M30: ${m30All.length} | M15: ${m15All.length} | H4: ${h4All.length} | D1: ${d1All.length} | W1: ${w1All.length}`);
  console.log(`EUR/USD: ${eurUsdAll.length} | Yield: ${yieldAll.length}\n`);

  // --- PASS 1: triggers verzamelen (geen API-calls) ---
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
    const d1Window  = d1All.filter(c => c.time <= candle.time).slice(-30);
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

    // Sla candle-vensters op per trigger voor pass 2
    triggerQueue.push({
      idx: i,
      candle,
      conditions,
      h1Window, m30Window, m15Window, h4Window, d1Window, w1Window,
      eurWindow, yldWindow,
      futureCandles: h1All.slice(i + 1, i + 1 + HORIZON_CANDLES),
    });
  }

  console.log(`Pass 1 klaar: ${triggerQueue.length} triggers gevonden.\n`);
  console.log(`Pass 2: boardroom-runs (${CONCURRENCY} parallel)...\n`);

  // --- PASS 2: boardroom-runs in parallel batches ---
  let runCounter = 0;

  const results = await batchRun(triggerQueue, CONCURRENCY, async (trig) => {
    runCounter++;
    const { candle, conditions, h1Window, m30Window, m15Window, h4Window, d1Window, w1Window, eurWindow, yldWindow, futureCandles } = trig;
    const trendLabel = conditions.trendMode ? ' [TREND]' : '';
    console.log(`[${runCounter}/${triggerQueue.length}] ${candle.time.slice(0, 16)} | ${conditions.direction.toUpperCase()}${trendLabel} — boardroom...`);

    let boardroomResult;
    try {
      boardroomResult = await runDiscussion(h1Window, {
        instrument:        'XAU_USD',
        granularity:       'H1',
        dollarCandles:     eurWindow,
        yieldCandles:      yldWindow,
        h4Candles:         h4Window,
        d1Candles:         d1Window,
        w1Candles:         w1Window,
        currentTime:       candle.time,
        trendMode:         conditions.trendMode,
        preloadedFfEvents: [],
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
        trendMode: conditions.trendMode, boardroomSignal: signal,
        confidence, setupScore, passed, outcome: 'gefilterd', candles: null,
      };
    }

    const atr14  = atr(h1Window.slice(-50), 14) ?? 15;
    const entry  = candle.close;
    const atrSl  = signal === 'bullish' ? entry - atr14 * SL_ATR_MULT : entry + atr14 * SL_ATR_MULT;
    const atrTp  = signal === 'bullish' ? entry + atr14 * TP_ATR_MULT : entry - atr14 * TP_ATR_MULT;
    // Valideer boardroom SL/TP — risicomanager geeft soms ongeldige niveaus (SL aan verkeerde kant).
    // Bij ongeldige niveaus: ATR-fallback gebruiken zodat de outcome-meting betrouwbaar blijft.
    const slRaw  = decision.stopLoss  ?? atrSl;
    const tpRaw  = decision.takeProfit ?? atrTp;
    const slValid = signal === 'bullish' ? slRaw < entry : slRaw > entry;
    const tpValid = signal === 'bullish' ? tpRaw > entry : tpRaw < entry;
    const sl = slValid ? slRaw : atrSl;
    const tp = tpValid ? tpRaw : atrTp;
    if (!slValid || !tpValid) console.log(`  ⚠️  Ongeldige SL/TP van boardroom → ATR-fallback (SL $${sl.toFixed(1)} TP $${tp.toFixed(1)})`);

    const outcome = evaluateOutcome({ signal, stopLoss: sl, takeProfit: tp }, futureCandles);
    const icon    = outcome.result === 'tp' ? '✅' : outcome.result === 'sl' ? '❌' : '➖';
    const hit     = outcome.candlesToHit ? ` na ${outcome.candlesToHit}h` : '';
    console.log(`  ${icon} ${signal.toUpperCase()} | ${confidence}% | score ${setupScore}/6 | SL $${sl.toFixed(1)} TP $${tp.toFixed(1)} | ${outcome.result}${hit}`);

    return {
      time: candle.time.slice(0, 16), dir: conditions.direction,
      trendMode: conditions.trendMode, boardroomSignal: signal,
      confidence, setupScore, passed,
      sl: sl.toFixed(2), tp: tp.toFixed(2), entry: entry.toFixed(2),
      outcome: outcome.result, candles: outcome.candlesToHit ?? null,
    };
  });

  const cleanResults = results.filter(Boolean);

  // --- Samenvatting ---
  const doorgelaten = cleanResults.filter(r => r.passed && r.outcome !== 'gefilterd');
  const tpList = doorgelaten.filter(r => r.outcome === 'tp');
  const slList = doorgelaten.filter(r => r.outcome === 'sl');
  const wr     = (tpList.length + slList.length) > 0
    ? Math.round(tpList.length / (tpList.length + slList.length) * 100) : null;

  console.log('\n' + '═'.repeat(55));
  console.log('BOARDROOM BACKTEST RESULTATEN');
  console.log('═'.repeat(55));
  console.log(`Periode:              ${FROM_STR} → ${TO_STR}`);
  console.log(`Model:                ${model}`);
  console.log(`Conditie-triggers:    ${triggerQueue.length}`);
  console.log(`Doorgelaten:          ${doorgelaten.length}`);
  console.log(`Gefilterd:            ${cleanResults.length - doorgelaten.length}`);
  console.log(`Filter-ratio:         ${triggerQueue.length > 0 ? Math.round(doorgelaten.length / triggerQueue.length * 100) : '-'}%`);
  console.log('');
  console.log(`TP: ${tpList.length} | SL: ${slList.length} | Geen: ${doorgelaten.filter(r => r.outcome === 'geen').length}`);
  console.log(`WR (TP/SL):           ${wr ?? '-'}%`);
  console.log(`R:R gesimuleerd:      ${SL_ATR_MULT}×ATR SL / ${TP_ATR_MULT}×ATR TP`);

  const bull   = doorgelaten.filter(r => r.boardroomSignal === 'bullish');
  const bear   = doorgelaten.filter(r => r.boardroomSignal === 'bearish');
  const bullTP = bull.filter(r => r.outcome === 'tp').length;
  const bullSL = bull.filter(r => r.outcome === 'sl').length;
  const bearTP = bear.filter(r => r.outcome === 'tp').length;
  const bearSL = bear.filter(r => r.outcome === 'sl').length;
  console.log('');
  console.log(`Bullish: ${bull.length} | TP: ${bullTP} / SL: ${bullSL} → WR: ${(bullTP+bullSL)>0?Math.round(bullTP/(bullTP+bullSL)*100):'-'}%`);
  console.log(`Bearish: ${bear.length} | TP: ${bearTP} / SL: ${bearSL} → WR: ${(bearTP+bearSL)>0?Math.round(bearTP/(bearTP+bearSL)*100):'-'}%`);

  const scoreGroups = {};
  for (const r of doorgelaten) {
    const k = `${r.setupScore}/6`;
    if (!scoreGroups[k]) scoreGroups[k] = { tp: 0, sl: 0, geen: 0 };
    if (r.outcome === 'tp') scoreGroups[k].tp++;
    else if (r.outcome === 'sl') scoreGroups[k].sl++;
    else scoreGroups[k].geen++;
  }
  if (Object.keys(scoreGroups).length > 0) {
    console.log('\nScore-breakdown:');
    for (const [score, s] of Object.entries(scoreGroups)) {
      const wr = (s.tp + s.sl) > 0 ? Math.round(s.tp / (s.tp + s.sl) * 100) : null;
      console.log(`  Score ${score}: TP ${s.tp} / SL ${s.sl} → WR ${wr ?? '-'}%`);
    }
  }

  console.log('\n=== TIJDLIJN ===');
  for (const r of cleanResults) {
    const trend = r.trendMode ? ' [TREND]' : '';
    if (r.outcome === 'gefilterd') {
      const reason = r.boardroomSignal === 'neutral' ? `CEO ${r.confidence}% → neutraal` : 'kwaliteitsfilter';
      console.log(`⬜ ${r.time} | ${r.dir.toUpperCase().padEnd(7)} | score ${r.setupScore}/6 | ${reason}${trend}`);
    } else {
      const icon = r.outcome === 'tp' ? '✅' : r.outcome === 'sl' ? '❌' : '➖';
      const hit  = r.candles ? ` na ${r.candles}h` : '';
      console.log(`${icon} ${r.time} | ${r.boardroomSignal.toUpperCase().padEnd(7)} | $${r.entry} | ${r.confidence}% | score ${r.setupScore}/6 | ${r.outcome}${hit}${trend}`);
    }
  }
}

main().catch(err => {
  console.error('Backtest mislukt:', err.message);
  process.exit(1);
});
