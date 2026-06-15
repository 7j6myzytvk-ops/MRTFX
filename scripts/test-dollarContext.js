import { computeDollarContext, formatDollarContextNote } from '../agents/dollarContext.js';

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

// 1. computeDollarContext - lineaire candle-reeks (close = 1..25)
{
  const candles = [];
  for (let i = 1; i <= 25; i++) {
    candles.push({ time: `t${i}`, open: i, high: i + 0.5, low: i - 0.5, close: i });
  }

  const context = computeDollarContext(candles);
  check('computeDollarContext - lastClose', context.lastClose, 25);
  check('computeDollarContext - firstClose', context.firstClose, 1);
  check('computeDollarContext - sma20 (gem. van 6..25)', context.sma20, 15.5);
}

// 2. formatDollarContextNote - stijgende EUR/USD (boven SMA -> dollar verzwakt -> steun voor goud)
{
  const context = { lastClose: 1.09, firstClose: 1.08, sma20: 1.085 };
  const note = formatDollarContextNote(context);

  check('formatDollarContextNote (stijging) - bevat "gestegen"', note.includes('gestegen'), true);
  check('formatDollarContextNote (stijging) - bevat "verzwakt"', note.includes('verzwakt'), true);
  check('formatDollarContextNote (stijging) - bevat "steun voor"', note.includes('steun voor'), true);
  check('formatDollarContextNote (stijging) - ligt "boven" SMA', note.includes('boven'), true);
  check('formatDollarContextNote (stijging) - bevat lastClose met 4 decimalen', note.includes('1.0900'), true);
  check('formatDollarContextNote (stijging) - bevat sma20 met 4 decimalen', note.includes('1.0850'), true);
  check('formatDollarContextNote (stijging) - bevat percentage', note.includes('0.93%'), true);
}

// 3. formatDollarContextNote - dalende EUR/USD (onder SMA -> dollar versterkt -> druk op goud)
{
  const context = { lastClose: 1.07, firstClose: 1.08, sma20: 1.075 };
  const note = formatDollarContextNote(context);

  check('formatDollarContextNote (daling) - bevat "gedaald"', note.includes('gedaald'), true);
  check('formatDollarContextNote (daling) - bevat "versterkt"', note.includes('versterkt'), true);
  check('formatDollarContextNote (daling) - bevat "druk op"', note.includes('druk op'), true);
  check('formatDollarContextNote (daling) - ligt "onder" SMA', note.includes('onder'), true);
  check('formatDollarContextNote (daling) - geen negatief percentage (Math.abs)', note.includes('-0.93%'), false);
  check('formatDollarContextNote (daling) - bevat absolute percentage', note.includes('0.93%'), true);
}

// 4. formatDollarContextNote - lastClose exact gelijk aan sma20 (> i.p.v. >= -> "onder")
{
  const context = { lastClose: 1.08, firstClose: 1.08, sma20: 1.08 };
  const note = formatDollarContextNote(context);

  check('formatDollarContextNote (gelijk aan SMA) - "onder" bij gelijke waarde', note.includes('onder'), true);
  check(
    'formatDollarContextNote (gelijk aan SMA) - 0.00% en "gestegen" (changePct >= 0)',
    note.includes('0.00% gestegen'),
    true,
  );
}

// 5. formatDollarContextNote - algemene structuur
{
  const context = { lastClose: 1.09, firstClose: 1.08, sma20: 1.085 };
  const note = formatDollarContextNote(context);

  check('formatDollarContextNote - begint met dubbele newline', note.startsWith('\n\n'), true);
  check('formatDollarContextNote - bevat "Dollarcontext"', note.includes('Dollarcontext'), true);
  check('formatDollarContextNote - bevat "EUR/USD"', note.includes('EUR/USD'), true);
  check('formatDollarContextNote - bevat "XAU/USD"', note.includes('XAU/USD'), true);
}

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
