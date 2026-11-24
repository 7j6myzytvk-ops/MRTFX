/**
 * Replay-script: gooit de huidige conditie-checker over historische XAU/USD data.
 * Geen boardroom-calls, geen API-kosten buiten Twelve Data (5 candle-fetches totaal).
 *
 * Gebruik: node --experimental-vm-modules scripts/replay.js
 *      of: node scripts/replay.js (als package.json "type":"module" heeft)
 *
 * Output: tijdlijn van triggers + WR-samenvatting op basis van R:R 2:1.
 *
 * CAVEAT: dit simuleert alleen de conditie-trigger (H1+M30+M15 alignment).
 * De boardroom zelf zou sommige triggers als neutraal hebben beoordeeld (score <3).
 * Werkelijke performance kan dus beter of slechter zijn dan deze output.
 */

import { getXauUsdCandles } from '../services/marketData.js';
import { checkConditions } from '../services/conditionChecker.js';
import { atr } from '../agents/indicators.js';
import { evaluateOutcome, filterFlatCandles, HORIZON_CANDLES } from '../agents/outcomeEvaluator.js';

const FROM_H1   = '2026-06-01 00:00:00';
const FROM_D1   = '2026-01-01 00:00:00';
const FROM_W1   = '2025-01-01 00:00:00';
const TO        = new Date().toISOString().replace('T', ' ').slice(0, 19);

const COOLDOWN_MS      = 4 * 60 * 60 * 1000; // 4 uur tussen triggers
const MIN_H1_HISTORY   = 50;
const SL_ATR_MULT      = 1.0;
const TP_ATR_MULT      = 2.0;

async function main() {
  console.log('Historische candles ophalen...');

  const [h1Raw, m30Raw, m15Raw, d1Raw, w1Raw] = await Promise.all([
    getXauUsdCandles({ granularity: 'H1',  from: FROM_H1, to: TO }),
    getXauUsdCandles({ granularity: 'M30', from: FROM_H1, to: TO }),
    getXauUsdCandles({ granularity: 'M15', from: FROM_H1, to: TO }),
    getXauUsdCandles({ granularity: 'D',   from: FROM_D1, to: TO }),
    getXauUsdCandles({ granularity: 'W',   from: FROM_W1, to: TO }),
  ]);

  const h1All  = filterFlatCandles(h1Raw);
  const m30All = filterFlatCandles(m30Raw);
  const m15All = filterFlatCandles(m15Raw);
  const d1All  = d1Raw;
  const w1All  = w1Raw;

  console.log(`H1: ${h1All.length} | M30: ${m30All.length} | M15: ${m15All.length} | D1: ${d1All.length} | W1: ${w1All.length}\n`);

  const triggers = [];
  let lastTriggerTime = null;

  for (let i = MIN_H1_HISTORY; i < h1All.length - HORIZON_CANDLES; i++) {
    const candle = h1All[i];
    const now = new Date(candle.time);

    // Cooldown: niet binnen 4 uur na vorige trigger
    if (lastTriggerTime && now - lastTriggerTime < COOLDOWN_MS) continue;

    // Bouw tijdramen voor dit historische moment
    const h1Window  = h1All.slice(Math.max(0, i - 50), i + 1);
    const m30Window = m30All.filter(c => c.time <= candle.time).slice(-100);
    const m15Window = m15All.filter(c => c.time <= candle.time).slice(-100);
    const d1Window  = d1All.filter(c => c.time <= candle.time).slice(-30);
    const w1Window  = w1All.filter(c => c.time <= candle.time).slice(-20);

    if (m30Window.length < 20 || m15Window.length < 20) continue;

    const conditions = checkConditions({
      h1Candles:  h1Window,
      m30Candles: m30Window,
      m15Candles: m15Window,
      d1Candles:  d1Window,
      w1Candles:  w1Window,
      now,
    });

    if (!conditions.triggered) continue;

    const atr14   = atr(h1Window.slice(-50), 14) ?? 15;
    const entry   = candle.close;
    const dir     = conditions.direction;
    const sl      = dir === 'bullish' ? entry - atr14 * SL_ATR_MULT : entry + atr14 * SL_ATR_MULT;
    const tp      = dir === 'bullish' ? entry + atr14 * TP_ATR_MULT : entry - atr14 * TP_ATR_MULT;

    const futureCandles = h1All.slice(i + 1, i + 1 + HORIZON_CANDLES);
    const outcome = evaluateOutcome({ signal: dir, stopLoss: sl, takeProfit: tp }, futureCandles);

    triggers.push({
      time:         candle.time.slice(0, 16),
      dir,
      entry:        entry.toFixed(2),
      atr14:        atr14.toFixed(1),
      outcome:      outcome.result,
      candles:      outcome.candlesToHit ?? null,
      trendMode:    conditions.trendMode,
    });

    lastTriggerTime = now;
  }

  // --- Samenvatting ---
  const tp   = triggers.filter(t => t.outcome === 'tp').length;
  const sl   = triggers.filter(t => t.outcome === 'sl').length;
  const geen = triggers.filter(t => t.outcome === 'geen').length;
  const wr   = (tp + sl) > 0 ? Math.round(tp / (tp + sl) * 100) : null;

  const bull     = triggers.filter(t => t.dir === 'bullish');
  const bear     = triggers.filter(t => t.dir === 'bearish');
  const bullTP   = bull.filter(t => t.outcome === 'tp').length;
  const bullSL   = bull.filter(t => t.outcome === 'sl').length;
  const bearTP   = bear.filter(t => t.outcome === 'tp').length;
  const bearSL   = bear.filter(t => t.outcome === 'sl').length;
  const bullWR   = (bullTP + bullSL) > 0 ? Math.round(bullTP / (bullTP + bullSL) * 100) : null;
  const bearWR   = (bearTP + bearSL) > 0 ? Math.round(bearTP / (bearTP + bearSL) * 100) : null;

  console.log('=== REPLAY RESULTATEN (jun–aug 2026) ===');
  console.log(`Triggers:   ${triggers.length}`);
  console.log(`TP: ${tp} | SL: ${sl} | Geen: ${geen}`);
  console.log(`WR (TP/SL): ${wr ?? '-'}%`);
  console.log(`R:R gesimuleerd: ${SL_ATR_MULT}×ATR SL / ${TP_ATR_MULT}×ATR TP`);
  console.log('');
  console.log(`Bullish: ${bull.length} triggers | TP: ${bullTP} / SL: ${bullSL} → WR: ${bullWR ?? '-'}%`);
  console.log(`Bearish: ${bear.length} triggers | TP: ${bearTP} / SL: ${bearSL} → WR: ${bearWR ?? '-'}%`);

  console.log('\n=== TIJDLIJN ===');
  for (const t of triggers) {
    const icon  = t.outcome === 'tp' ? '✅' : t.outcome === 'sl' ? '❌' : '➖';
    const trend = t.trendMode ? ' [TREND]' : '';
    const hit   = t.candles ? ` na ${t.candles}h` : '';
    console.log(`${icon} ${t.time} | ${t.dir.toUpperCase().padEnd(7)} | $${t.entry} | ATR $${t.atr14} | ${t.outcome}${hit}${trend}`);
  }
}

main().catch(err => {
  console.error('Replay mislukt:', err.message);
  process.exit(1);
});
