import { evaluateSignalOutcome } from '../services/performanceTracker.js';
import { HORIZON_CANDLES } from '../agents/outcomeEvaluator.js';

// Candle-fixtures rond een referentieprijs van ~4350 (zelfde schaal als de live
// XAU/USD-candles van vandaag).
const candle = (time, { open = 4350, high = 4352, low = 4348, close = 4350 } = {}) => ({
  time,
  open,
  high,
  low,
  close,
});

const decisionBullish = { signal: 'bullish', confidence: 70, stopLoss: 4330, takeProfit: 4380, positionSize: 'normaal' };
const decisionBearish = { signal: 'bearish', confidence: 70, stopLoss: 4380, takeProfit: 4320, positionSize: 'normaal' };
const decisionNeutral = { signal: 'neutral', confidence: 50, stopLoss: 4330, takeProfit: 4380, positionSize: 'klein' };

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (!ok) {
    console.log(`     verwacht: ${JSON.stringify(expected)}`);
    console.log(`     gekregen: ${JSON.stringify(actual)}`);
    fail++;
  } else {
    pass++;
  }
}

// 1. TP-hit (bullish): candle 3 raakt takeProfit (high >= 4380)
{
  const candles = [
    candle('2026-06-15T13:00:00Z', { high: 4355, low: 4348, close: 4352 }),
    candle('2026-06-15T14:00:00Z', { high: 4360, low: 4350, close: 4358 }),
    candle('2026-06-15T15:00:00Z', { high: 4382, low: 4357, close: 4381 }),
  ];
  const outcome = evaluateSignalOutcome(decisionBullish, candles);
  check('tp-hit (bullish)', outcome, {
    result: 'tp',
    candlesToHit: 3,
    resolvedAt: '2026-06-15T15:00:00Z',
  });
}

// 2. SL-hit (bearish): candle 2 raakt stopLoss (high >= 4380)
{
  const candles = [
    candle('2026-06-15T13:00:00Z', { high: 4355, low: 4348, close: 4352 }),
    candle('2026-06-15T14:00:00Z', { high: 4385, low: 4360, close: 4382 }),
  ];
  const outcome = evaluateSignalOutcome(decisionBearish, candles);
  check('sl-hit (bearish)', outcome, {
    result: 'sl',
    candlesToHit: 2,
    resolvedAt: '2026-06-15T14:00:00Z',
  });
}

// 3. Geen hit binnen volle horizon -> definitief 'geen'
{
  const candles = Array.from({ length: HORIZON_CANDLES }, (_, i) =>
    candle(`2026-06-15T${String(13 + i).padStart(2, '0')}:00:00Z`, { high: 4355, low: 4345, close: 4350 }),
  );
  const outcome = evaluateSignalOutcome(decisionBullish, candles);
  check('geen hit, volle horizon', outcome, { result: 'geen', candlesToHit: null });
}

// 4. Geen hit, maar nog niet genoeg candles -> 'open'
{
  const candles = [
    candle('2026-06-15T13:00:00Z', { high: 4355, low: 4345, close: 4350 }),
    candle('2026-06-15T14:00:00Z', { high: 4356, low: 4346, close: 4351 }),
  ];
  const outcome = evaluateSignalOutcome(decisionBullish, candles);
  check('geen hit, te weinig candles -> open', outcome, { result: 'open', candlesChecked: 2 });
}

// 5. Nog geen candles ná het signaal -> 'open' met candlesChecked: 0
{
  const outcome = evaluateSignalOutcome(decisionBullish, []);
  check('geen candles -> open', outcome, { result: 'open', candlesChecked: 0 });
}

// 6. Neutraal signaal -> altijd 'neutraal', ongeacht candles
{
  const candles = [candle('2026-06-15T13:00:00Z')];
  const outcome = evaluateSignalOutcome(decisionNeutral, candles);
  check('neutraal signaal', outcome, { result: 'neutraal', candlesToHit: null });
}

// 7. Prijsschaal-mismatch (bv. pre-migratie mock-signaal met SL/TP ~2400 vs. live ~4350)
{
  const mockDecision = { signal: 'bullish', confidence: 65, stopLoss: 2394.97, takeProfit: 2410.66, positionSize: 'normaal' };
  const candles = [candle('2026-06-15T13:00:00Z', { close: 4350 })];
  const outcome = evaluateSignalOutcome(mockDecision, candles);
  check('prijsschaal-mismatch -> onbruikbaar', outcome, { result: 'onbruikbaar', reason: 'priceScaleMismatch' });
}

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
