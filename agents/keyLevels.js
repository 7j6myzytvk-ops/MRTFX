import { computeIndicators } from './indicators.js';

// Berekent wekelijkse pivot-niveaus op basis van de vorige week's candles.
// Pivots zijn veelgebruikte sleutelniveaus bij professionele goud-traders.
export function computeWeeklyLevels(weeklyCandles) {
  if (!weeklyCandles || weeklyCandles.length < 2) return [];
  const prev = weeklyCandles[weeklyCandles.length - 2];
  const pp = (prev.high + prev.low + prev.close) / 3;
  return [
    { level: prev.high,                    type: 'prev_week_high', label: 'Vorige week high' },
    { level: prev.low,                     type: 'prev_week_low',  label: 'Vorige week low' },
    { level: pp,                           type: 'weekly_pivot',   label: 'Wekelijks pivot' },
    { level: 2 * pp - prev.low,            type: 'weekly_r1',      label: 'Wekelijks R1' },
    { level: 2 * pp - prev.high,           type: 'weekly_s1',      label: 'Wekelijks S1' },
    { level: pp + (prev.high - prev.low),  type: 'weekly_r2',      label: 'Wekelijks R2' },
    { level: pp - (prev.high - prev.low),  type: 'weekly_s2',      label: 'Wekelijks S2' },
  ];
}

// Genereert ronde $50-niveaus rondom de huidige prijs.
// XAU/USD reageert sterk op psychologische niveaus ($3100, $3150, $3200 etc.).
export function computeRoundLevels(currentPrice, interval = 50, range = 5) {
  const base = Math.floor(currentPrice / interval) * interval;
  const levels = [];
  for (let i = -range; i <= range; i++) {
    const level = base + i * interval;
    if (level > 0) levels.push({ level, type: 'round_number', label: `$${level}` });
  }
  return levels;
}

// Controleert of de prijs binnen threshold * ATR van een sleutelniveau zit.
// Geeft het dichtstbijzijnde niveau terug als dat het geval is.
export function isNearKeyLevel(currentPrice, keyLevels, atr, threshold = 0.5) {
  if (!atr || atr <= 0 || !keyLevels || keyLevels.length === 0) return { near: false };
  const maxDistance = threshold * atr;
  let closest = null;
  let closestDist = Infinity;
  for (const kl of keyLevels) {
    const distance = Math.abs(currentPrice - kl.level);
    if (distance <= maxDistance && distance < closestDist) {
      closestDist = distance;
      closest = kl;
    }
  }
  if (!closest) return { near: false };
  return {
    near: true,
    level: closest.level,
    type: closest.type,
    label: closest.label,
    distance: closestDist,
    approachDirection: currentPrice >= closest.level ? 'van boven' : 'van onder',
  };
}

// Detecteert recente H1 swing highs en swing lows (lokale extrema).
// Swing high: hogere high dan beide buurcandles. Swing low: lagere low.
// lookback = hoeveel H1-candles terugkijken voor dynamische niveaus.
export function computeSwingLevels(h1Candles, lookback = 30) {
  if (!h1Candles || h1Candles.length < 5) return [];
  const window = h1Candles.slice(-Math.min(lookback, h1Candles.length));
  const levels = [];
  for (let i = 1; i < window.length - 1; i++) {
    if (window[i].high > window[i - 1].high && window[i].high > window[i + 1].high) {
      levels.push({ level: window[i].high, type: 'swing_high', label: 'H1 swing high' });
    }
    if (window[i].low < window[i - 1].low && window[i].low < window[i + 1].low) {
      levels.push({ level: window[i].low, type: 'swing_low', label: 'H1 swing low' });
    }
  }
  return levels;
}

// Vorige dag high/low — klassiek ICT-niveau voor liquidity grabs en AMD-fase.
export function computePreviousDayLevels(d1Candles) {
  if (!d1Candles || d1Candles.length < 2) return [];
  const prev = d1Candles[d1Candles.length - 2];
  return [
    { level: prev.high, type: 'prev_day_high', label: 'Vorige dag high' },
    { level: prev.low,  type: 'prev_day_low',  label: 'Vorige dag low'  },
  ];
}

// Berekent alle relevante sleutelniveaus voor de huidige prijs.
export function getAllKeyLevels(currentPrice, weeklyCandles, h1Candles = null, d1Candles = null) {
  return [
    ...computeWeeklyLevels(weeklyCandles),
    ...computeRoundLevels(currentPrice),
    ...(h1Candles ? computeSwingLevels(h1Candles) : []),
    ...(d1Candles ? computePreviousDayLevels(d1Candles) : []),
  ];
}

// Bepaalt of de prijs nabij een sleutelniveau zit, op basis van H1-candles.
export function checkKeyLevelProximity(h1Candles, weeklyCandles, d1Candles = null) {
  if (!h1Candles || h1Candles.length === 0) return { near: false };
  const currentPrice = h1Candles[h1Candles.length - 1].close;
  const indicators = computeIndicators(h1Candles);
  const atr = indicators.atr14;
  const levels = getAllKeyLevels(currentPrice, weeklyCandles, h1Candles, d1Candles);
  return isNearKeyLevel(currentPrice, levels, atr);
}
