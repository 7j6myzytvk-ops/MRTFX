import { computeYieldContext, formatYieldContextNote } from '../agents/yieldContext.js';

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

// 1. computeYieldContext - lineaire candle-reeks (close = 1..25)
{
  const candles = [];
  for (let i = 1; i <= 25; i++) {
    candles.push({ time: `t${i}`, open: i, high: i + 0.5, low: i - 0.5, close: i });
  }

  const context = computeYieldContext(candles);
  check('computeYieldContext - lastClose', context.lastClose, 25);
  check('computeYieldContext - firstClose', context.firstClose, 1);
  check('computeYieldContext - sma20 (gem. van 6..25)', context.sma20, 15.5);
}

// 2. formatYieldContextNote - stijgende rente (hogere opportunity cost -> druk op goud)
{
  const context = { lastClose: 4.1, firstClose: 4.0, sma20: 4.05 };
  const note = formatYieldContextNote(context);

  check('formatYieldContextNote (stijging) - bevat "gestegen"', note.includes('gestegen'), true);
  check('formatYieldContextNote (stijging) - bevat "verhoogt"', note.includes('verhoogt'), true);
  check('formatYieldContextNote (stijging) - bevat "druk op"', note.includes('druk op'), true);
  check('formatYieldContextNote (stijging) - ligt "boven" SMA', note.includes('boven'), true);
  check('formatYieldContextNote (stijging) - bevat lastClose met 2 decimalen', note.includes('4.10%'), true);
  check('formatYieldContextNote (stijging) - bevat sma20 met 2 decimalen', note.includes('4.05%'), true);
  check('formatYieldContextNote (stijging) - bevat basispunten', note.includes('10 basispunten'), true);
}

// 3. formatYieldContextNote - dalende rente (lagere opportunity cost -> steun voor goud)
{
  const context = { lastClose: 3.95, firstClose: 4.05, sma20: 4.0 };
  const note = formatYieldContextNote(context);

  check('formatYieldContextNote (daling) - bevat "gedaald"', note.includes('gedaald'), true);
  check('formatYieldContextNote (daling) - bevat "verlaagt"', note.includes('verlaagt'), true);
  check('formatYieldContextNote (daling) - bevat "steun voor"', note.includes('steun voor'), true);
  check('formatYieldContextNote (daling) - ligt "onder" SMA', note.includes('onder'), true);
  check('formatYieldContextNote (daling) - geen negatieve basispunten', note.includes('-10 basispunten'), false);
  check('formatYieldContextNote (daling) - bevat absolute basispunten', note.includes('10 basispunten'), true);
}

// 4. formatYieldContextNote - lastClose exact gelijk aan sma20 (> i.p.v. >= -> "onder")
{
  const context = { lastClose: 4.0, firstClose: 4.0, sma20: 4.0 };
  const note = formatYieldContextNote(context);

  check('formatYieldContextNote (gelijk aan SMA) - "onder" bij gelijke waarde', note.includes('onder'), true);
  check(
    'formatYieldContextNote (gelijk aan SMA) - 0 basispunten en "gestegen" (changeBps >= 0)',
    note.includes('0 basispunten gestegen'),
    true,
  );
}

// 5. formatYieldContextNote - algemene structuur
{
  const context = { lastClose: 4.1, firstClose: 4.0, sma20: 4.05 };
  const note = formatYieldContextNote(context);

  check('formatYieldContextNote - begint met dubbele newline', note.startsWith('\n\n'), true);
  check('formatYieldContextNote - bevat "Rente-context"', note.includes('Rente-context'), true);
  check('formatYieldContextNote - bevat "2-jaars"', note.includes('2-jaars'), true);
  check('formatYieldContextNote - bevat "XAU/USD"', note.includes('XAU/USD'), true);
  check('formatYieldContextNote - bevat "opportunity cost"', note.includes('opportunity cost'), true);
}

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
