// Twelve Data vult weekend-gaten op met platte placeholder-candles (H-L < ~0.3)
// i.p.v. ze weg te laten - dit verstoort zowel backtest-vensters als de
// live horizon-uitkomstbepaling. Echte H1-candles op XAU/USD hebben altijd een
// duidelijk grotere range, dus we filteren deze synthetische candles eruit.
export const FLAT_RANGE_THRESHOLD = 1.0;

export function filterFlatCandles(candles) {
  return candles.filter((c) => c.high - c.low >= FLAT_RANGE_THRESHOLD);
}

// Aantal candles (~2 dagen bij H1) waarbinnen een SL- of TP-hit gezocht wordt,
// zowel voor backtest-samples als voor live signalen.
export const HORIZON_CANDLES = 48;

export function evaluateOutcome(decision, horizonCandles) {
  const { signal, stopLoss, takeProfit } = decision;
  if (signal === 'neutral') return { result: 'neutraal', candlesToHit: null };

  for (let j = 0; j < horizonCandles.length; j++) {
    const c = horizonCandles[j];
    // Als SL en TP in dezelfde candle vallen is de intra-candle volgorde onbekend
    // uit OHLC-data alleen; SL telt dan als conservatieve aanname.
    if (signal === 'bullish') {
      if (c.low <= stopLoss) return { result: 'sl', candlesToHit: j + 1 };
      if (c.high >= takeProfit) return { result: 'tp', candlesToHit: j + 1 };
    } else {
      if (c.high >= stopLoss) return { result: 'sl', candlesToHit: j + 1 };
      if (c.low <= takeProfit) return { result: 'tp', candlesToHit: j + 1 };
    }
  }

  return { result: 'geen', candlesToHit: null };
}

export function summarize(records) {
  const trades = records.filter((s) => s.outcome.result !== 'neutraal');
  const tp = trades.filter((s) => s.outcome.result === 'tp').length;
  const sl = trades.filter((s) => s.outcome.result === 'sl').length;
  const geen = trades.filter((s) => s.outcome.result === 'geen').length;

  const avgConfidence = (result) => {
    const subset = trades.filter((s) => s.outcome.result === result);
    if (!subset.length) return null;
    return Math.round(subset.reduce((sum, s) => sum + s.decision.confidence, 0) / subset.length);
  };

  return {
    totalSamples: records.length,
    neutraal: records.length - trades.length,
    trades: trades.length,
    tp,
    sl,
    geen,
    winRate: trades.length ? Math.round((tp / trades.length) * 1000) / 10 : null,
    avgConfidenceTp: avgConfidence('tp'),
    avgConfidenceSl: avgConfidence('sl'),
  };
}
