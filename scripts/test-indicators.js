import { sma, rsi, atr, computeIndicators, formatIndicatorsNote } from '../agents/indicators.js';

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

// 1. sma - normale periode en periode > beschikbare waarden
{
  const values = [1, 2, 3, 4, 5];
  check('sma(values, 3)', sma(values, 3), 4);
  check('sma(values, 10) - valt terug op alle waarden', sma(values, 10), 3);
}

// 2. rsi - alleen winst, alleen verlies, gemengd
{
  check('rsi - alleen stijgingen -> 100', rsi([10, 11, 12, 13, 14, 15], 5), 100);
  check('rsi - alleen dalingen -> 0', rsi([15, 14, 13, 12, 11, 10], 5), 0);
  check('rsi - gemengd', rsi([10, 11, 10, 11, 10, 11], 5), 60);
  check('rsi - te weinig data -> null', rsi([10], 14), null);
}

// 3. atr - vaste true ranges
{
  const candles = [
    { high: 10, low: 8, close: 9 },
    { high: 11, low: 9, close: 10 }, // TR = max(2, |11-9|=2, |9-9|=0) = 2
    { high: 12, low: 10, close: 11 }, // TR = max(2, |12-10|=2, |10-10|=0) = 2
  ];
  check('atr - constante true range', atr(candles, 14), 2);
  check('atr - 1 candle -> null', atr([candles[0]], 14), null);
}

// 4. computeIndicators - lineaire candle-reeks (close = 1..25, high = close+0.5, low = close-0.5)
{
  const candles = [];
  for (let i = 1; i <= 25; i++) {
    candles.push({ time: `t${i}`, open: i, high: i + 0.5, low: i - 0.5, close: i });
  }

  const indicators = computeIndicators(candles);
  check('computeIndicators - lastClose', indicators.lastClose, 25);
  check('computeIndicators - sma20 (gem. van 6..25)', indicators.sma20, 15.5);
  check('computeIndicators - sma50 (valt terug op alle 25)', indicators.sma50, 13);
  check('computeIndicators - rsi14 (consistente stijging -> 100)', indicators.rsi14, 100);
  check('computeIndicators - atr14 (constante true range 1.5)', indicators.atr14, 1.5);

  const note = formatIndicatorsNote(indicators);
  check('formatIndicatorsNote - bevat RSI-label overbought', note.includes('RSI(14): 100.0 (overbought)'), true);
  check('formatIndicatorsNote - bevat SMA(20) en "boven"', note.includes('SMA(20): 15.50') && note.includes('boven'), true);
  check('formatIndicatorsNote - bevat SMA(50)', note.includes('SMA(50): 13.00'), true);
  check('formatIndicatorsNote - bevat ATR(14)', note.includes('ATR(14): 1.50'), true);
}

// 5. formatIndicatorsNote - met null rsi14/atr14 (te weinig candles) geen "null" in tekst
{
  const indicators = { lastClose: 5, sma20: 5, sma50: 5, rsi14: null, atr14: null };
  const note = formatIndicatorsNote(indicators);
  check('formatIndicatorsNote - geen "null" in output bij ontbrekende rsi/atr', note.includes('null'), false);
  check('formatIndicatorsNote - bevat nog wel SMA-regels', note.includes('SMA(20)') && note.includes('SMA(50)'), true);
}

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
