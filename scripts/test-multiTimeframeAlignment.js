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

// 7. Gemengd → niet aligned
{
  check('computeMultiTFAlignment - h1 mixed: niet aligned', computeMultiTFAlignment('mixed', 'bullish', 'bullish').aligned, false);
  check('computeMultiTFAlignment - m30 bearish: niet aligned', computeMultiTFAlignment('bullish', 'bearish', 'bullish').aligned, false);
  check('computeMultiTFAlignment - m15 mixed: niet aligned', computeMultiTFAlignment('bearish', 'bearish', 'mixed').aligned, false);
}

// 8. Twee bullish, één mixed → niet aligned
{
  const result = computeMultiTFAlignment('bullish', 'bullish', 'mixed');
  check('computeMultiTFAlignment - 2 bullish 1 mixed: niet aligned', result.aligned, false);
  check('computeMultiTFAlignment - direction null bij niet aligned', result.direction, null);
}

// --- computeTrendBias ---

// 9. D1 en W1 beide bullish → aligned bullish
{
  const closes = Array.from({ length: 25 }, (_, i) => 3100 + i * 5);
  const bullishCandles = makeCandles(closes);
  const result = computeTrendBias(bullishCandles, bullishCandles);
  check('computeTrendBias - beide bullish: aligned', result.aligned, true);
  check('computeTrendBias - beide bullish: direction', result.direction, 'bullish');
}

// 10. D1 bullish, W1 bearish → niet aligned
{
  const bullish = makeCandles(Array.from({ length: 25 }, (_, i) => 3100 + i * 5));
  const bearish = makeCandles(Array.from({ length: 25 }, (_, i) => 3300 - i * 5));
  const result = computeTrendBias(bullish, bearish);
  check('computeTrendBias - d1 bullish w1 bearish: niet aligned', result.aligned, false);
}

// 11. D1 mixed, W1 bearish → aligned bearish (W1 leidend; D1 in correctie)
{
  const flat = makeCandles(Array(25).fill(3200));
  const bearish = makeCandles(Array.from({ length: 25 }, (_, i) => 3300 - i * 5));
  const result = computeTrendBias(flat, bearish);
  check('computeTrendBias - d1 mixed w1 bearish: aligned', result.aligned, true);
  check('computeTrendBias - d1 mixed w1 bearish: direction bearish', result.direction, 'bearish');
}

// 12. D1 mixed, W1 mixed → niet aligned (beide onduidelijk)
{
  const flat = makeCandles(Array(25).fill(3200));
  const result = computeTrendBias(flat, flat);
  check('computeTrendBias - beide mixed: niet aligned', result.aligned, false);
}

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
