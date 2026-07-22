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
    if (rsi14 > 52) bullish++;
    else if (rsi14 < 45) bearish++;
    // RSI 45–52: neutrale pullback-zone, telt niet mee voor richting
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

// Controleert of H1 + M30 dezelfde richting laten zien (structuur-timeframes).
// M15 mag afwijken — dat is de entry-timeframe en kan in pullback zijn terwijl
// H1+M30 de trend bevestigen. Dit is ICT-conform: structuur lezen op H1/M30,
// entry timen op M15-pullback.
// H1 of M30 'mixed' = niet aligned (structuur moet helder zijn).
export function computeMultiTFAlignment(h1Bias, m30Bias, m15Bias) {
  if (h1Bias === 'bullish' && m30Bias === 'bullish') {
    return { aligned: true, direction: 'bullish' };
  }
  if (h1Bias === 'bearish' && m30Bias === 'bearish') {
    return { aligned: true, direction: 'bearish' };
  }
  return { aligned: false, direction: null };
}

// Trendfilter: W1 is de enige richtingsbepaler.
// D1 mag in retracement/correctie zitten (bullish D1 binnen bearish W1 is een
// klassieke ICT-setup — dat is het moment waarop je shorts zoekt op 4H+H1).
// Blokkeert alleen als W1 zelf 'mixed' is (geen heldere weektrend).
// De richtingsconsistentie-check in conditionChecker.js (stap 4) voorkomt
// vervolgens dat 4H+H1 tegen de W1-richting in triggeren.
// d1Candles wordt bewust niet gebruikt: D1 mag in retracement zitten terwijl W1 de
// richting bepaalt (klassieke ICT-setup). De parameter bestaat zodat de aanroeper
// de D1-data kan doorgeven zonder de interface te wijzigen als D1 later wel
// meeweegt — maar de huidige implementatie negeert d1Candles intentioneel.
export function computeTrendBias(d1Candles, w1Candles) {
  const w1Bias = computeTimeframeBias(w1Candles);
  if (w1Bias === 'mixed') return { aligned: false, direction: null };
  return { aligned: true, direction: w1Bias };
}
