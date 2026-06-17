import { computeDailyContext, formatDailyContextNote } from '../agents/dailyContext.js';

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

// Helper: N candles, lineair stijgend (step > 0), dalend (step < 0), of vlak (step = 0)
function makeCandles(n, startClose = 3000, step = 10) {
  return Array.from({ length: n }, (_, i) => ({
    time: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    open: startClose + i * step,
    high: startClose + i * step + 10,
    low: startClose + i * step - 10,
    close: startClose + i * step,
  }));
}

// --- computeDailyContext ---

// Te weinig candles
check('computeDailyContext - null-input -> null', computeDailyContext(null), null);
check('computeDailyContext - 4 candles -> null', computeDailyContext(makeCandles(4)), null);

// 25 stijgende candles: prijs boven SMA20, STIJGEND
{
  const candles = makeCandles(25, 3000, 10);
  const ctx = computeDailyContext(candles);

  check('computeDailyContext - currentClose correct', ctx.currentClose, 3000 + 24 * 10); // 3240
  check('computeDailyContext - sma20 correct', Math.round(ctx.sma20), 3145); // mean van [3050..3240]
  check('computeDailyContext - priceVsSma boven', ctx.priceVsSma, 'boven');
  check('computeDailyContext - fiveDayChange positief -> STIJGEND', ctx.fiveDayChangePct > 0.5, true);
  check('computeDailyContext - recentHigh correct', ctx.recentHigh, 3000 + 24 * 10 + 10); // 3250
  check('computeDailyContext - recentLow correct', ctx.recentLow, 3000 + 20 * 10 - 10); // 3190
  check('computeDailyContext - atr14 aanwezig', ctx.atr14 != null, true);
}

// 25 dalende candles: prijs onder SMA20, DALEND
{
  const candles = makeCandles(25, 3240, -10);
  const ctx = computeDailyContext(candles);

  check('computeDailyContext - dalend: priceVsSma onder', ctx.priceVsSma, 'onder');
  check('computeDailyContext - dalend: fiveDayChange negatief -> DALEND', ctx.fiveDayChangePct < -0.5, true);
}

// Vlakke candles: ZIJWAARTS
{
  const candles = makeCandles(10, 3000, 0);
  const ctx = computeDailyContext(candles);

  check('computeDailyContext - vlak: fiveDayChangePct 0', ctx.fiveDayChangePct, 0);
  check('computeDailyContext - vlak: sma20 null (te weinig candles)', ctx.sma20, null);
  check('computeDailyContext - vlak: priceVsSma null', ctx.priceVsSma, null);
}

// --- formatDailyContextNote ---

check('formatDailyContextNote - null -> lege string', formatDailyContextNote(null), '');

{
  const candles = makeCandles(25, 3000, 10);
  const ctx = computeDailyContext(candles);
  const note = formatDailyContextNote(ctx);

  check('formatDailyContextNote - bevat dagkoers', note.includes('3240.00'), true);
  check('formatDailyContextNote - bevat SMA20', note.includes('3145.00'), true);
  check('formatDailyContextNote - bevat BOVEN', note.includes('BOVEN'), true);
  check('formatDailyContextNote - bevat STIJGEND', note.includes('STIJGEND'), true);
  check('formatDailyContextNote - bevat recentLow', note.includes('3190.00'), true);
  check('formatDailyContextNote - bevat recentHigh', note.includes('3250.00'), true);
  check('formatDailyContextNote - bevat ATR', note.includes('ATR(14)'), true);
  check('formatDailyContextNote - bevat tailwind-advies', note.includes('tailwind'), true);
}

{
  const candles = makeCandles(25, 3240, -10);
  const note = formatDailyContextNote(computeDailyContext(candles));

  check('formatDailyContextNote - dalend: bevat ONDER', note.includes('ONDER'), true);
  check('formatDailyContextNote - dalend: bevat DALEND', note.includes('DALEND'), true);
}

// Weinig candles (geen SMA20): mag niet crashen, geen SMA-noot
{
  const candles = makeCandles(10, 3000, 0);
  const note = formatDailyContextNote(computeDailyContext(candles));
  check('formatDailyContextNote - geen SMA20: bevat geen "daggem."', note.includes('daggem.'), false);
  check('formatDailyContextNote - geen SMA20: bevat ZIJWAARTS', note.includes('ZIJWAARTS'), true);
}

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
