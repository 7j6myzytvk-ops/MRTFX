// Eenvoudige technische indicatoren, berekend uit dezelfde candles die de
// agents al krijgen. Doel: de agents een vóórbewerkt signaal geven (trend/
// momentum/volatiliteit) i.p.v. dat ze dat zelf uit 50 losse OHLC-regels
// moeten afleiden.

export function sma(values, period) {
  const n = Math.min(period, values.length);
  const slice = values.slice(-n);
  return slice.reduce((sum, v) => sum + v, 0) / n;
}

export function rsi(closes, period = 14) {
  const n = Math.min(period, closes.length - 1);
  if (n < 1) return null;

  let gains = 0;
  let losses = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  const avgGain = gains / n;
  const avgLoss = losses / n;
  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function atr(candles, period = 14) {
  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    trueRanges.push(Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close)));
  }
  if (trueRanges.length === 0) return null;
  return sma(trueRanges, period);
}

export function computeIndicators(candles) {
  const closes = candles.map((c) => c.close);
  return {
    lastClose: closes[closes.length - 1],
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    rsi14: rsi(closes, 14),
    atr14: atr(candles, 14),
  };
}

export function formatIndicatorsNote(indicators) {
  const { lastClose, sma20, sma50, rsi14, atr14 } = indicators;

  let rsiLine = '';
  if (rsi14 !== null) {
    let rsiLabel = 'neutraal';
    if (rsi14 >= 70) rsiLabel = 'overbought';
    else if (rsi14 <= 30) rsiLabel = 'oversold';
    rsiLine = `- RSI(14): ${rsi14.toFixed(1)} (${rsiLabel})\n`;
  }

  const atrLine = atr14 !== null ? `- ATR(14): ${atr14.toFixed(2)} (gemiddelde candle-volatiliteit)` : '';

  return (
    `\n\nTechnische indicatoren (berekend over de candles hieronder):\n` +
    rsiLine +
    `- SMA(20): ${sma20.toFixed(2)} - huidige prijs (${lastClose.toFixed(2)}) ligt hier ${lastClose > sma20 ? 'boven' : 'onder'}\n` +
    `- SMA(50): ${sma50.toFixed(2)} - huidige prijs ligt hier ${lastClose > sma50 ? 'boven' : 'onder'}\n` +
    atrLine
  );
}
