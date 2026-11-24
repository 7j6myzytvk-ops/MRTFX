import { FLAT_RANGE_THRESHOLD, HORIZON_CANDLES } from '../config/rules.js';

export { FLAT_RANGE_THRESHOLD, HORIZON_CANDLES };

export function filterFlatCandles(candles) {
  return candles.filter((c) => c.high - c.low >= FLAT_RANGE_THRESHOLD);
}

// rMultiple, MFE en MAE worden uitgedrukt in R-eenheden (1R = afstand entry→SL).
// entry is optioneel — bij null worden de R-metrics weggelaten (backward compatible).
export function evaluateOutcome(decision, horizonCandles, entry = null) {
  const { signal, stopLoss, takeProfit } = decision;
  if (signal === 'neutral') return { result: 'neutraal', candlesToHit: null };

  const rSize = entry !== null ? Math.abs(entry - stopLoss) : null;
  const hasR = rSize !== null && rSize > 0;

  let mfe = 0; // maximum favorable excursion in R (positief)
  let mae = 0; // maximum adverse excursion in R (negatief)

  for (let j = 0; j < horizonCandles.length; j++) {
    const c = horizonCandles[j];

    if (hasR) {
      if (signal === 'bullish') {
        const favorable = (c.high - entry) / rSize;
        const adverse   = (c.low  - entry) / rSize;
        if (favorable > mfe) mfe = favorable;
        if (adverse   < mae) mae = adverse;
      } else {
        const favorable = (entry - c.low)  / rSize;
        const adverse   = (entry - c.high) / rSize;
        if (favorable > mfe) mfe = favorable;
        if (adverse   < mae) mae = adverse;
      }
    }

    // Als SL en TP in dezelfde candle vallen is de intra-candle volgorde onbekend
    // uit OHLC-data alleen; SL telt dan als conservatieve aanname.
    if (signal === 'bullish') {
      if (c.low <= stopLoss) {
        const rMultiple = hasR ? -1.0 : null;
        return { result: 'sl', candlesToHit: j + 1, rMultiple, mfe: round2(mfe), mae: round2(mae) };
      }
      if (c.high >= takeProfit) {
        const rMultiple = hasR ? round2((takeProfit - entry) / rSize) : null;
        return { result: 'tp', candlesToHit: j + 1, rMultiple, mfe: round2(mfe), mae: round2(mae) };
      }
    } else {
      if (c.high >= stopLoss) {
        const rMultiple = hasR ? -1.0 : null;
        return { result: 'sl', candlesToHit: j + 1, rMultiple, mfe: round2(mfe), mae: round2(mae) };
      }
      if (c.low <= takeProfit) {
        const rMultiple = hasR ? round2((entry - takeProfit) / rSize) : null;
        return { result: 'tp', candlesToHit: j + 1, rMultiple, mfe: round2(mfe), mae: round2(mae) };
      }
    }
  }

  // Geen: gebruik slotkoers van laatste candle als exitprijs
  const lastClose = horizonCandles.length > 0 ? horizonCandles[horizonCandles.length - 1].close : null;
  const rMultiple = hasR && lastClose !== null
    ? round2(signal === 'bullish' ? (lastClose - entry) / rSize : (entry - lastClose) / rSize)
    : null;
  return { result: 'geen', candlesToHit: null, rMultiple, mfe: hasR ? round2(mfe) : null, mae: hasR ? round2(mae) : null };
}

function round2(n) {
  return Math.round(n * 100) / 100;
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
