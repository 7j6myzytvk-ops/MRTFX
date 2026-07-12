import { isActiveSession, isActiveDay, checkConditions, formatConditionContext } from '../services/conditionChecker.js';

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
function checkTrue(name, val) { check(name, val, true); }

function makeCandles(closes) {
  return closes.map((c, i) => ({ time: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`, open: c - 1, high: c + 3, low: c - 3, close: c }));
}

const bullishCloses = Array.from({ length: 105 }, (_, i) => 3100 + i * 3);
const bearishCloses = Array.from({ length: 105 }, (_, i) => 3400 - i * 3);
const bullishCandles = makeCandles(bullishCloses);
const bearishCandles = makeCandles(bearishCloses);

// --- isActiveSession ---

check('isActiveSession - 08:00 UTC: inactief (London manipulation)', isActiveSession(new Date('2026-06-17T08:00:00Z')), false);
check('isActiveSession - 09:00 UTC: inactief (London ochtend)', isActiveSession(new Date('2026-06-17T09:00:00Z')), false);
check('isActiveSession - 12:59 UTC: inactief (vlak voor NY open)', isActiveSession(new Date('2026-06-17T12:59:00Z')), false);
check('isActiveSession - 13:00 UTC: actief (NY open)', isActiveSession(new Date('2026-06-17T13:00:00Z')), true);
check('isActiveSession - 16:59 UTC: actief', isActiveSession(new Date('2026-06-17T16:59:00Z')), true);
check('isActiveSession - 17:00 UTC: inactief', isActiveSession(new Date('2026-06-17T17:00:00Z')), false);
check('isActiveSession - 00:00 UTC: inactief (nacht)', isActiveSession(new Date('2026-06-17T00:00:00Z')), false);

// --- isActiveDay ---
// 2026-06-15 = maandag, 2026-06-17 = woensdag
check('isActiveDay - maandag: inactief', isActiveDay(new Date('2026-06-15T14:00:00Z')), false);
check('isActiveDay - dinsdag: actief', isActiveDay(new Date('2026-06-16T14:00:00Z')), true);
check('isActiveDay - woensdag: actief', isActiveDay(new Date('2026-06-17T14:00:00Z')), true);
check('isActiveDay - vrijdag: actief', isActiveDay(new Date('2026-06-19T14:00:00Z')), true);

// --- checkConditions ---

// 1. Buiten sessie → geblokkeerd (sessie-blocker aanwezig)
{
  const result = checkConditions({
    h1Candles: bullishCandles.slice(-50),
    m30Candles: bullishCandles.slice(-100),
    m15Candles: bullishCandles.slice(-100),
    d1Candles: bullishCandles.slice(-30),
    w1Candles: bullishCandles.slice(-20),
    now: new Date('2026-06-17T03:00:00Z'), // nacht
  });
  check('checkConditions - buiten sessie: niet triggered', result.triggered, false);
  checkTrue('checkConditions - buiten sessie: heeft sessie-blocker', result.blockers.some(b => b.includes('sessie')));
}

// 2. Alle candles undefined → niet triggered (meerdere blockers)
{
  const result = checkConditions({ now: new Date('2026-06-17T14:00:00Z') });
  check('checkConditions - geen candles: niet triggered', result.triggered, false);
  checkTrue('checkConditions - geen candles: heeft blockers', result.blockers.length > 0);
}

// 3. TF niet aligned → geblokkeerd
// Fase 46: M15 mag afwijken; H1 én M30 moeten het eens zijn.
// Test: H1 bullish + M30 bearish → alignment faalt.
{
  const result = checkConditions({
    h1Candles: bullishCandles.slice(-50),
    m30Candles: bearishCandles.slice(-100), // M30 bearish, H1 bullish → conflict
    m15Candles: bullishCandles.slice(-100),
    d1Candles: bullishCandles.slice(-30),
    w1Candles: bullishCandles.slice(-20),
    now: new Date('2026-06-17T14:00:00Z'),
  });
  check('checkConditions - TF niet aligned: niet triggered', result.triggered, false);
  checkTrue('checkConditions - TF niet aligned: heeft TF-blocker', result.blockers.some(b => b.includes('timeframes')));
}
// Fase 46-verificatie: M15 bearish terwijl H1+M30 bullish → WÈLL triggered (M15 is niet-blokkerend)
{
  const result = checkConditions({
    h1Candles: bullishCandles.slice(-50),
    m30Candles: bullishCandles.slice(-100),
    m15Candles: bearishCandles.slice(-100), // M15 afwijkend → geen blocker
    d1Candles: bullishCandles.slice(-30),
    w1Candles: bullishCandles.slice(-20),
    now: new Date('2026-06-17T14:00:00Z'),
  });
  check('checkConditions - M15 afwijkend (Fase 46): triggered want H1+M30 eens', result.triggered, true);
}

// 4. D1/W1 niet aligned → geblokkeerd
{
  const result = checkConditions({
    h1Candles: bullishCandles.slice(-50),
    m30Candles: bullishCandles.slice(-100),
    m15Candles: bullishCandles.slice(-100),
    d1Candles: bullishCandles.slice(-30),
    w1Candles: bearishCandles.slice(-20), // W1 bearish
    now: new Date('2026-06-17T14:00:00Z'),
  });
  check('checkConditions - D1/W1 conflict: niet triggered', result.triggered, false);
  checkTrue('checkConditions - D1/W1 conflict: heeft trend-blocker', result.blockers.some(b => b.includes('D1/W1') || b.includes('trendrichting') || b.includes('conflicteert')));
}

// 5. Details-object bevat verwachte velden
{
  const result = checkConditions({
    h1Candles: bullishCandles.slice(-50),
    m30Candles: bullishCandles.slice(-100),
    m15Candles: bullishCandles.slice(-100),
    d1Candles: bullishCandles.slice(-30),
    w1Candles: bullishCandles.slice(-20),
    now: new Date('2026-06-17T14:00:00Z'),
  });
  checkTrue('checkConditions - details bevat session', 'session' in result.details);
  checkTrue('checkConditions - details bevat h1Bias', 'h1Bias' in result.details);
  checkTrue('checkConditions - details bevat tfAlignment', 'tfAlignment' in result.details);
  checkTrue('checkConditions - details bevat trendBias', 'trendBias' in result.details);
  checkTrue('checkConditions - details bevat nearLevel', 'nearLevel' in result.details);
}

// 6. Richting is bullish als alle filters bullish zijn
{
  const result = checkConditions({
    h1Candles: bullishCandles.slice(-50),
    m30Candles: bullishCandles.slice(-100),
    m15Candles: bullishCandles.slice(-100),
    d1Candles: bullishCandles.slice(-30),
    w1Candles: bullishCandles.slice(-20),
    now: new Date('2026-06-17T14:00:00Z'),
  });
  // Triggered hangt af van sleutelniveau-proximity; richting is wél bullish als TF aligned
  if (result.details.tfAlignment.aligned) {
    check('checkConditions - bullish richting bij bullish TF alignment', result.direction, 'bullish');
  }
}

// --- formatConditionContext ---

// 7. Niet triggered → lege string
{
  const result = checkConditions({ now: new Date('2026-06-17T03:00:00Z') });
  check('formatConditionContext - niet triggered: lege string', formatConditionContext(result), '');
}

// 8. null/undefined → lege string
{
  check('formatConditionContext - null: lege string', formatConditionContext(null), '');
  check('formatConditionContext - undefined: lege string', formatConditionContext(undefined), '');
}

// 9. Triggered → bevat richting en niveau-info
{
  // Bouw een mock triggered result
  const mockTriggered = {
    triggered: true,
    direction: 'bullish',
    blockers: [],
    details: {
      session: true,
      tfAlignment: { aligned: true, direction: 'bullish' },
      trendBias: { aligned: true, direction: 'bullish' },
      nearLevel: { near: true, label: 'Wekelijks pivot', level: 3200, approachDirection: 'van onder' },
    },
  };
  const ctx = formatConditionContext(mockTriggered);
  checkTrue('formatConditionContext - triggered: bevat richting', ctx.includes('bullish'));
  checkTrue('formatConditionContext - triggered: bevat niveau', ctx.includes('Wekelijks pivot'));
  checkTrue('formatConditionContext - triggered: is niet leeg', ctx.length > 50);
}

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
