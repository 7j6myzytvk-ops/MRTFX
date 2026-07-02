import { detectPriceSpike, formatSpikeContext, SPIKE_ATR_MULTIPLIER } from '../services/eventMonitor.js';

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? 'OK  ' : 'FAIL', label);
  if (!ok) {
    console.log('  verwacht:', JSON.stringify(expected));
    console.log('  ontvangen:', JSON.stringify(actual));
    fail++;
  } else {
    pass++;
  }
}

function makeCandle(open, high, low, close, time = '2026-07-01T15:00:00Z') {
  return { time, open, high, low, close };
}

// --- detectPriceSpike: geen candles ---
check('geen candles -> spike:false', detectPriceSpike([], 5).spike, false);
check('null candles -> spike:false', detectPriceSpike(null, 5).spike, false);
check('ATR null -> spike:false', detectPriceSpike([makeCandle(2300, 2320, 2280, 2310)], null).spike, false);
check('ATR 0 -> spike:false', detectPriceSpike([makeCandle(2300, 2320, 2280, 2310)], 0).spike, false);

// --- detectPriceSpike: te kleine beweging (range < 2× ATR) ---
// ATR = 10, range = 15 (< 2×10 = 20) → geen spike
const smallCandles = [
  makeCandle(2300, 2305, 2295, 2302, '2026-07-01T14:45:00Z'),
  makeCandle(2302, 2317, 2302, 2310, '2026-07-01T15:00:00Z'),
];
const smallResult = detectPriceSpike(smallCandles, 10);
check('range 15 bij ATR 10 (1.5×) -> geen spike', smallResult.spike, false);

// --- detectPriceSpike: spike (range >= 2× ATR) ---
// ATR = 10, range = 25 (2.5×) → spike
const spikeCandles = [
  makeCandle(2300, 2305, 2295, 2302, '2026-07-01T14:45:00Z'),
  makeCandle(2302, 2330, 2302, 2327, '2026-07-01T15:00:00Z'),
];
const spikeResult = detectPriceSpike(spikeCandles, 10);
check('range 28 bij ATR 10 -> spike:true', spikeResult.spike, true);
check('spike richting bullish (close > open)', spikeResult.direction, 'bullish');
check('spike multiple = 2.8', spikeResult.spikeMultiple, 2.8);
check('spike candleTime correct', spikeResult.candleTime, '2026-07-01T15:00:00Z');
check('spike range correct', spikeResult.range, 28);

// --- detectPriceSpike: bearish spike ---
const bearSpikeCandles = [
  makeCandle(2300, 2305, 2295, 2302, '2026-07-01T14:45:00Z'),
  makeCandle(2302, 2303, 2272, 2275, '2026-07-01T15:00:00Z'),
];
const bearResult = detectPriceSpike(bearSpikeCandles, 10);
check('bearish spike -> spike:true', bearResult.spike, true);
check('bearish spike richting', bearResult.direction, 'bearish');

// --- detectPriceSpike: exact op de drempel (range = 2× ATR) ---
const exactCandles = [
  makeCandle(2300, 2301, 2299, 2300, '2026-07-01T14:45:00Z'),
  makeCandle(2300, 2320, 2300, 2315, '2026-07-01T15:00:00Z'),
];
// range = 20, ATR = 10, threshold = 20 → exact gelijk → spike
const exactResult = detectPriceSpike(exactCandles, 10);
check('range exact 2× ATR -> spike:true (grenswaarde)', exactResult.spike, true);

// --- detectPriceSpike: 1 candle (te weinig voor vergelijking) ---
const singleCandle = [makeCandle(2300, 2360, 2300, 2350)];
check('1 candle -> spike:false (te weinig data)', detectPriceSpike(singleCandle, 10).spike, false);

// --- formatSpikeContext ---
const ctx = formatSpikeContext(
  { candleTime: '2026-07-01T15:00:00Z', range: 28, spikeMultiple: 2.8, direction: 'bullish', atr14: 10, threshold: 20 },
  [{ publishedAt: '2026-07-01T14:58:00Z', title: 'US Manufacturing PMI misses expectations' }],
);
check('formatSpikeContext bevat EVENT-ALERT', ctx.includes('EVENT-ALERT'), true);
check('formatSpikeContext bevat richting', ctx.includes('bullish'), true);
check('formatSpikeContext bevat spikeMultiple', ctx.includes('2.8×'), true);
check('formatSpikeContext bevat nieuwstitel', ctx.includes('PMI misses expectations'), true);
check('formatSpikeContext MACRO opdracht aanwezig', ctx.includes('MACRO-ANALIST'), true);

const ctxNoNews = formatSpikeContext(
  { candleTime: '2026-07-01T15:00:00Z', range: 28, spikeMultiple: 2.8, direction: 'bullish', atr14: 10, threshold: 20 },
  [],
);
check('formatSpikeContext zonder nieuws -> fallback tekst', ctxNoNews.includes('Geen recent nieuws'), true);

// --- SPIKE_ATR_MULTIPLIER is 2.0 ---
check('SPIKE_ATR_MULTIPLIER = 2.0', SPIKE_ATR_MULTIPLIER, 2.0);

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
