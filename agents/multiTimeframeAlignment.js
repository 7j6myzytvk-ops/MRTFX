import { sma, rsi } from './indicators.js';

// Bepaalt de richtingsvoorkeur van één timeframe op basis van drie criteria:
// 1. Prijs vs SMA20 (boven = bullish, onder = bearish)
// 2. RSI14 vs 50 (>50 = bullish, <50 = bearish)
// 3. Recente candle-structuur: laatste 3 closes stijgend of dalend
// Meerderheid (2/3) beslist de richting; bij gelijkspel → 'mixed'
export function computeTimeframeBias(candles) {
  if (!candles || candles.length < 20) return 'mixed';
  const closes = candles.map((c) => c.close);
  const currentClose = closes[closes.length - 1];

  let bullish = 0;
  let bearish = 0;

  const sma20 = sma(closes, 20);
  if (sma20 != null) {
    if (currentClose > sma20) bullish++;
    else bearish++;
  }

  const rsi14 = rsi(closes, 14);
  if (rsi14 != null) {
    if (rsi14 > 50) bullish++;
    else bearish++;
  }

  if (closes.length >= 4) {
    const last = closes.slice(-3);
    if (last[0] < last[1] && last[1] < last[2]) bullish++;
    else if (last[0] > last[1] && last[1] > last[2]) bearish++;
  }

  if (bullish > bearish) return 'bullish';
  if (bearish > bullish) return 'bearish';
  return 'mixed';
}

// Controleert of H1, M30 en M15 allemaal dezelfde richting laten zien.
// Alle drie moeten het eens zijn — één afwijkend timeframe = niet aligned.
export function computeMultiTFAlignment(h1Bias, m30Bias, m15Bias) {
  if (h1Bias === 'bullish' && m30Bias === 'bullish' && m15Bias === 'bullish') {
    return { aligned: true, direction: 'bullish' };
  }
  if (h1Bias === 'bearish' && m30Bias === 'bearish' && m15Bias === 'bearish') {
    return { aligned: true, direction: 'bearish' };
  }
  return { aligned: false, direction: null };
}

// Trendfilter: W1 is leidend; D1 moet dezelfde richting hebben of mixed zijn.
// D1 mag in correctie/consolidatie zitten (mixed) zolang W1 een heldere trend heeft —
// dit zijn precies de ICT-pullback-entries binnen de weektrend.
// Blokkeert alleen als D1 tegengesteld is aan W1 (echte reversal-zone).
export function computeTrendBias(d1Candles, w1Candles) {
  const d1Bias = computeTimeframeBias(d1Candles);
  const w1Bias = computeTimeframeBias(w1Candles);

  // Beide wijzen dezelfde duidelijke richting → sterkste setup
  if (d1Bias !== 'mixed' && d1Bias === w1Bias) {
    return { aligned: true, direction: d1Bias };
  }

  // W1 is helder trending, D1 is in correctie/consolidatie (mixed) → volg W1
  if (w1Bias !== 'mixed' && d1Bias === 'mixed') {
    return { aligned: true, direction: w1Bias };
  }

  // W1 mixed of D1 tegengesteld aan W1 → blokkeer
  return { aligned: false, direction: null };
}
