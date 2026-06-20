import { computeWeeklyContext, formatWeeklyContextNote } from '../agents/weeklyContext.js';

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = typeof expected === 'boolean' ? actual === expected : JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? 'OK  ' : 'FAIL', label);
  if (!ok) {
    console.log('  verwacht:', JSON.stringify(expected));
    console.log('  ontvangen:', JSON.stringify(actual));
    fail++;
  } else {
    pass++;
  }
}

function makeCandles(closes) {
  return closes.map((c, i) => ({
    time: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    open: c - 5,
    high: c + 10,
    low: c - 10,
    close: c,
  }));
}

// Te weinig candles → null
check('computeWeeklyContext - null bij < 5 candles', computeWeeklyContext([]), null);
check('computeWeeklyContext - null bij 4 candles', computeWeeklyContext(makeCandles([100, 110, 120, 130])), null);

// Stijgende reeks → bullish
const bullCandles = makeCandles([3100, 3150, 3200, 3250, 3300, 3350, 3400, 3450, 3500, 3550,
                                  3600, 3650, 3700, 3750, 3800, 3850, 3900, 3950, 4000, 4050]);
const bullCtx = computeWeeklyContext(bullCandles);
check('computeWeeklyContext bullish - trend = bullish', bullCtx.trend, 'bullish');
check('computeWeeklyContext bullish - currentClose = 4050', bullCtx.currentClose, 4050);
check('computeWeeklyContext bullish - priceVsSma = boven', bullCtx.priceVsSma, 'boven');
check('computeWeeklyContext bullish - fiveWeekChangePct > 0', bullCtx.fiveWeekChangePct > 0, true);

// Dalende reeks → bearish
const bearCandles = makeCandles([4050, 4000, 3950, 3900, 3850, 3800, 3750, 3700, 3650, 3600,
                                  3550, 3500, 3450, 3400, 3350, 3300, 3250, 3200, 3150, 3100]);
const bearCtx = computeWeeklyContext(bearCandles);
check('computeWeeklyContext bearish - trend = bearish', bearCtx.trend, 'bearish');
check('computeWeeklyContext bearish - priceVsSma = onder', bearCtx.priceVsSma, 'onder');
check('computeWeeklyContext bearish - fiveWeekChangePct < 0', bearCtx.fiveWeekChangePct < 0, true);

// Zijwaartse reeks → neutraal of mixed → 'neutraal'
const flatCandles = makeCandles([3300, 3310, 3290, 3305, 3295, 3310, 3290, 3305, 3295, 3300,
                                  3310, 3290, 3305, 3295, 3300, 3310, 3290, 3305, 3295, 3300]);
const flatCtx = computeWeeklyContext(flatCandles);
check('computeWeeklyContext flat - trend is string', typeof flatCtx.trend === 'string', true);
check('computeWeeklyContext flat - sma20 is number', typeof flatCtx.sma20 === 'number', true);

// sma20 = null bij < 20 candles
const shortCandles = makeCandles([3300, 3320, 3340, 3360, 3380, 3400]);
const shortCtx = computeWeeklyContext(shortCandles);
check('computeWeeklyContext kort - sma20 = null', shortCtx.sma20, null);
check('computeWeeklyContext kort - priceVsSma = null', shortCtx.priceVsSma, null);
check('computeWeeklyContext kort - trend is string', typeof shortCtx.trend === 'string', true);

// formatWeeklyContextNote
const note = formatWeeklyContextNote(bullCtx);
check('formatWeeklyContextNote - bevat W1', note.includes('W1'), true);
check('formatWeeklyContextNote - bevat weekkoers', note.includes('weekkoers'), true);
check('formatWeeklyContextNote - bevat BULLISH', note.includes('BULLISH'), true);
check('formatWeeklyContextNote - bevat STIJGEND', note.includes('STIJGEND'), true);
check('formatWeeklyContextNote - bevat counter-trend waarschuwing', note.includes('weektrend wint'), true);
check('formatWeeklyContextNote - begint met \\n\\n', note.startsWith('\n\n'), true);

// formatWeeklyContextNote bearish
const bearNote = formatWeeklyContextNote(bearCtx);
check('formatWeeklyContextNote bearish - bevat BEARISH', bearNote.includes('BEARISH'), true);
check('formatWeeklyContextNote bearish - bevat DALEND', bearNote.includes('DALEND'), true);

// formatWeeklyContextNote - null → lege string
check('formatWeeklyContextNote - null → lege string', formatWeeklyContextNote(null), '');

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
