import {
  computeTimeframeBias,
  computeMultiTFAlignment,
  computeTrendBias,
} from '../agents/multiTimeframeAlignment.js';

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (!ok) {
    console.log(`     verwacht: ${JSON.stringify(expected)}`);
    console.log(`     gekregen: ${JSON.stringify(actual)}`);
    fail++;
  } else {
    pass++;
  }
}

function makeCandles(closes) {
  return closes.map((c, i) => ({ time: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`, open: c - 1, high: c + 2, low: c - 2, close: c }));
}

// --- computeTimeframeBias ---

// 1. Te weinig candles → mixed
check('computeTimeframeBias - te weinig candles', computeTimeframeBias([]), 'mixed');
check('computeTimeframeBias - 19 candles', computeTimeframeBias(makeCandles(Array(19).fill(100))), 'mixed');

// 2. Duidelijk stijgende reeks → bullish (prijs boven SMA20, RSI>50, stijgende closes)
{
  const closes = Array.from({ length: 25 }, (_, i) => 3100 + i * 5); // stijgend
  const candles = makeCandles(closes);
  check('computeTimeframeBias - stijgend: bullish', computeTimeframeBias(candles), 'bullish');
}

// 3. Duidelijk dalende reeks → bearish
{
  const closes = Array.from({ length: 25 }, (_, i) => 3300 - i * 5); // dalend
  const candles = makeCandles(closes);
  check('computeTimeframeBias - dalend: bearish', computeTimeframeBias(candles), 'bearish');
}

// 4. Vlakke reeks → mixed (geen duidelijke richting)
{
  const closes = Array(25).fill(3200);
  const candles = makeCandles(closes);
  const result = computeTimeframeBias(candles);
  // Vlak: prijs = SMA (tie), RSI ~50 (tie), closes vlak (tie) → mixed
  check('computeTimeframeBias - vlak: mixed', result, 'mixed');
}

// --- computeMultiTFAlignment ---

// 5. Alle drie bullish → aligned bullish
{
  const result = computeMultiTFAlignment('bullish', 'bullish', 'bullish');
  check('computeMultiTFAlignment - alle bullish: aligned', result.aligned, true);
  check('computeMultiTFAlignment - alle bullish: direction', result.direction, 'bullish');
}

// 6. Alle drie bearish → aligned bearish
{
  const result = computeMultiTFAlignment('bearish', 'bearish', 'bearish');
  check('computeMultiTFAlignment - alle bearish: aligned', result.aligned, true);
  check('computeMultiTFAlignment - alle bearish: direction', result.direction, 'bearish');
}

// 7. H1 of M30 onduidelijk/tegenstrijdig → niet aligned
{
  check('computeMultiTFAlignment - h1 mixed: niet aligned', computeMultiTFAlignment('mixed', 'bullish', 'bullish').aligned, false);
  check('computeMultiTFAlignment - m30 bearish: niet aligned', computeMultiTFAlignment('bullish', 'bearish', 'bullish').aligned, false);
  check('computeMultiTFAlignment - h1 mixed m30 mixed: niet aligned', computeMultiTFAlignment('mixed', 'mixed', 'bullish').aligned, false);
}

// 8. H1+M30 aligned, M15 mixed of bearish (pullback) → wél aligned
{
  const r1 = computeMultiTFAlignment('bullish', 'bullish', 'mixed');
  check('computeMultiTFAlignment - H1+M30 bullish M15 mixed: aligned', r1.aligned, true);
  check('computeMultiTFAlignment - H1+M30 bullish M15 mixed: direction bullish', r1.direction, 'bullish');

  const r2 = computeMultiTFAlignment('bullish', 'bullish', 'bearish');
  check('computeMultiTFAlignment - H1+M30 bullish M15 bearish (pullback): aligned', r2.aligned, true);
  check('computeMultiTFAlignment - H1+M30 bullish M15 bearish: direction bullish', r2.direction, 'bullish');

  const r3 = computeMultiTFAlignment('bearish', 'bearish', 'bullish');
  check('computeMultiTFAlignment - H1+M30 bearish M15 bullish (pullback): aligned', r3.aligned, true);
  check('computeMultiTFAlignment - H1+M30 bearish M15 bullish: direction bearish', r3.direction, 'bearish');

  const r4 = computeMultiTFAlignment('bearish', 'bearish', 'mixed');
  check('computeMultiTFAlignment - H1+M30 bearish M15 mixed: aligned', r4.aligned, true);
}

// --- computeTrendBias ---

// 9. W1 bullish → aligned bullish (ongeacht D1)
{
  const bullish = makeCandles(Array.from({ length: 25 }, (_, i) => 3100 + i * 5));
  const r1 = computeTrendBias(bullish, bullish);
  check('computeTrendBias - w1 bullish d1 bullish: aligned', r1.aligned, true);
  check('computeTrendBias - w1 bullish: direction bullish', r1.direction, 'bullish');

  const flat = makeCandles(Array(25).fill(3200));
  const r2 = computeTrendBias(flat, bullish);
  check('computeTrendBias - w1 bullish d1 mixed: aligned', r2.aligned, true);
  check('computeTrendBias - w1 bullish d1 mixed: direction bullish', r2.direction, 'bullish');
}

// 10. W1 bearish → aligned bearish (ook als D1 bullish retracement is)
{
  const bullish = makeCandles(Array.from({ length: 25 }, (_, i) => 3100 + i * 5));
  const bearish = makeCandles(Array.from({ length: 25 }, (_, i) => 3300 - i * 5));
  const r1 = computeTrendBias(bullish, bearish);
  check('computeTrendBias - w1 bearish d1 bullish: aligned', r1.aligned, true);
  check('computeTrendBias - w1 bearish d1 bullish: direction bearish', r1.direction, 'bearish');

  const flat = makeCandles(Array(25).fill(3200));
  const r2 = computeTrendBias(flat, bearish);
  check('computeTrendBias - w1 bearish d1 mixed: aligned', r2.aligned, true);
  check('computeTrendBias - w1 bearish d1 mixed: direction bearish', r2.direction, 'bearish');
}

// 11. W1 mixed → niet aligned (geen heldere weektrend)
{
  const flat = makeCandles(Array(25).fill(3200));
  const r = computeTrendBias(flat, flat);
  check('computeTrendBias - w1 mixed: niet aligned', r.aligned, false);
}

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
