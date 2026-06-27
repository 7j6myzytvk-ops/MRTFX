import {
  computeWeeklyLevels,
  computeRoundLevels,
  isNearKeyLevel,
  getAllKeyLevels,
  checkKeyLevelProximity,
} from '../agents/keyLevels.js';

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

// --- computeWeeklyLevels ---

// 1. Te weinig candles → lege array
check('computeWeeklyLevels - geen candles', computeWeeklyLevels([]).length, 0);
check('computeWeeklyLevels - 1 candle', computeWeeklyLevels([{ high: 3200, low: 3100, close: 3150 }]).length, 0);

// 2. Correcte pivot-berekening
{
  const prev = { high: 3200, low: 3100, close: 3160 };
  const current = { high: 3210, low: 3120, close: 3180 };
  const levels = computeWeeklyLevels([prev, current]);
  check('computeWeeklyLevels - 7 niveaus', levels.length, 7);
  const pp = (3200 + 3100 + 3160) / 3; // 3153.33
  const pivotEntry = levels.find(l => l.type === 'weekly_pivot');
  checkTrue('computeWeeklyLevels - pivot correct', Math.abs(pivotEntry.level - pp) < 0.01);
  checkTrue('computeWeeklyLevels - R1 correct', Math.abs(levels.find(l => l.type === 'weekly_r1').level - (2 * pp - 3100)) < 0.01);
  checkTrue('computeWeeklyLevels - S1 correct', Math.abs(levels.find(l => l.type === 'weekly_s1').level - (2 * pp - 3200)) < 0.01);
  check('computeWeeklyLevels - prev_week_high', levels.find(l => l.type === 'prev_week_high').level, 3200);
  check('computeWeeklyLevels - prev_week_low', levels.find(l => l.type === 'prev_week_low').level, 3100);
}

// --- computeRoundLevels ---

// 3. Ronde niveaus rondom prijs
{
  const levels = computeRoundLevels(3175, 50, 3);
  checkTrue('computeRoundLevels - bevat $3150', levels.some(l => l.level === 3150));
  checkTrue('computeRoundLevels - bevat $3200', levels.some(l => l.level === 3200));
  checkTrue('computeRoundLevels - bevat $3100', levels.some(l => l.level === 3100));
  checkTrue('computeRoundLevels - bevat $3250', levels.some(l => l.level === 3250));
  checkTrue('computeRoundLevels - type is round_number', levels.every(l => l.type === 'round_number'));
}

// 4. Positieve niveaus alleen
{
  const levels = computeRoundLevels(50, 50, 5);
  checkTrue('computeRoundLevels - geen negatieve niveaus', levels.every(l => l.level > 0));
}

// --- isNearKeyLevel ---

// 5. Prijs nabij een niveau (binnen threshold * ATR)
{
  const levels = [{ level: 3200, type: 'weekly_pivot', label: 'Wekelijks pivot' }];
  const result = isNearKeyLevel(3205, levels, 20, 0.5); // threshold 0.5 * 20 = 10
  check('isNearKeyLevel - nabij: near=true', result.near, true);
  check('isNearKeyLevel - nabij: correct niveau', result.level, 3200);
  check('isNearKeyLevel - nabij: van boven', result.approachDirection, 'van boven');
}

// 6. Prijs te ver van niveau
{
  const levels = [{ level: 3200, type: 'weekly_pivot', label: 'Wekelijks pivot' }];
  const result = isNearKeyLevel(3250, levels, 20, 0.5); // threshold = 10, afstand = 50
  check('isNearKeyLevel - te ver: near=false', result.near, false);
}

// 7. Prijs van onder het niveau
{
  const levels = [{ level: 3200, type: 'weekly_r1', label: 'Wekelijks R1' }];
  const result = isNearKeyLevel(3195, levels, 20, 0.5);
  check('isNearKeyLevel - van onder: near=true', result.near, true);
  check('isNearKeyLevel - van onder: approachDirection', result.approachDirection, 'van onder');
}

// 8. Geen ATR → near=false
{
  const levels = [{ level: 3200, type: 'weekly_pivot', label: 'Pivot' }];
  check('isNearKeyLevel - geen ATR: near=false', isNearKeyLevel(3200, levels, null).near, false);
  check('isNearKeyLevel - ATR=0: near=false', isNearKeyLevel(3200, levels, 0).near, false);
}

// 9. Lege niveaus → near=false
{
  check('isNearKeyLevel - lege levels: near=false', isNearKeyLevel(3200, [], 20).near, false);
}

// 10. Geeft het dichtstbijzijnde niveau terug bij meerdere niveaus
{
  const levels = [
    { level: 3190, type: 'weekly_s1', label: 'S1' },
    { level: 3205, type: 'weekly_pivot', label: 'Pivot' },
  ];
  const result = isNearKeyLevel(3202, levels, 20, 0.5); // beide binnen 10; 3205 is dichterbij (3)
  check('isNearKeyLevel - dichtstbijzijnde niveau', result.level, 3205);
}

// --- getAllKeyLevels ---

// 11. Bevat zowel wekelijkse als ronde niveaus
{
  const weeklyCandles = [
    { high: 3200, low: 3100, close: 3160 },
    { high: 3210, low: 3120, close: 3180 },
  ];
  const levels = getAllKeyLevels(3175, weeklyCandles);
  checkTrue('getAllKeyLevels - heeft weekly_pivot', levels.some(l => l.type === 'weekly_pivot'));
  checkTrue('getAllKeyLevels - heeft round_number', levels.some(l => l.type === 'round_number'));
}

// --- checkKeyLevelProximity ---
// Regressietest voor de bug waarbij `indicators.atr` (bestaat niet, retourneert
// undefined) i.p.v. `indicators.atr14` werd gelezen - hierdoor gaf
// isNearKeyLevel's guard (`if (!atr ...)`) altijd `near: false` terug, los van
// de daadwerkelijke afstand tot een sleutelniveau.

function buildH1Candles(closes) {
  // Lage, voorspelbare volatiliteit (range 2 per candle) zodat ATR(14) ≈ 2.
  return closes.map((close) => ({ high: close + 1, low: close - 1, close }));
}

{
  // 20 candles, laatste candle exact op $4100.5 - 0.5 punt van het ronde niveau
  // $4100. Met ATR≈2 is de drempel (0.5×ATR=1) ruim genoeg: hoort near:true te zijn.
  const closes = Array.from({ length: 19 }, () => 4100).concat([4100.5]);
  const h1 = buildH1Candles(closes);
  const weeklyCandles = [
    { high: 4150, low: 4050, close: 4090 },
    { high: 4140, low: 4060, close: 4100 },
  ];
  const result = checkKeyLevelProximity(h1, weeklyCandles);
  checkTrue('checkKeyLevelProximity - dichtbij rond niveau -> near:true', result.near === true);
  check('checkKeyLevelProximity - juiste niveau gevonden', result.level, 4100);
}

{
  // Laatste candle ver (30 punten) van elk sleutelniveau - hoort near:false te zijn.
  const closes = Array.from({ length: 19 }, () => 4100).concat([4130]);
  const h1 = buildH1Candles(closes);
  const weeklyCandles = [
    { high: 4150, low: 4050, close: 4090 },
    { high: 4140, low: 4060, close: 4100 },
  ];
  const result = checkKeyLevelProximity(h1, weeklyCandles);
  checkTrue('checkKeyLevelProximity - ver van elk niveau -> near:false', result.near === false);
}

{
  // Geen candles -> near:false, geen crash
  check('checkKeyLevelProximity - geen candles -> near:false', checkKeyLevelProximity([], []).near, false);
}

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
