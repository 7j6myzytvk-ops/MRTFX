export function sma(values, period) {
  const n = Math.min(period, values.length);
  const slice = values.slice(-n);
  return slice.reduce((sum, v) => sum + v, 0) / n;
}

export function ema(values, period) {
  if (!values || values.length < period) return null;
  const k = 2 / (period + 1);
  let val = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  for (let i = period; i < values.length; i++) {
    val = values[i] * k + val * (1 - k);
  }
  return val;
}

// Geeft een array van EMA-waarden voor elke positie vanaf period-1.
function rollingEma(values, period) {
  if (!values || values.length < period) return [];
  const k = 2 / (period + 1);
  let val = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  const result = [val];
  for (let i = period; i < values.length; i++) {
    val = values[i] * k + val * (1 - k);
    result.push(val);
  }
  return result;
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

// MACD (standaard 12,26,9). Geeft null als te weinig candles.
// macdLine  = EMA12 - EMA26
// signalLine = EMA9 van de MACD-lijn
// histogram  = macdLine - signalLine
// aboveZero  = macdLine > 0 (bullish/bearish momentum)
// aboveSignal = macdLine > signalLine (kruis omhoog/omlaag)
// rising      = macdLine stijgt t.o.v. vorige candle
export function macd(closes, fast = 12, slow = 26, signal = 9) {
  if (!closes || closes.length < slow + signal - 1) return null;

  const fastSeries = rollingEma(closes, fast);
  const slowSeries = rollingEma(closes, slow);

  // fastSeries[i] = EMA(fast) tot en met closes[fast-1+i]
  // slowSeries[i] = EMA(slow) tot en met closes[slow-1+i]
  // MACD op closes[slow-1+i] = fastSeries[slow-fast+i] - slowSeries[i]
  const macdSeries = [];
  for (let i = 0; i < slowSeries.length; i++) {
    const fastIdx = slow - fast + i;
    if (fastIdx < fastSeries.length) {
      macdSeries.push(fastSeries[fastIdx] - slowSeries[i]);
    }
  }

  if (macdSeries.length === 0) return null;

  const signalSeries = rollingEma(macdSeries, signal);
  const macdLine = macdSeries[macdSeries.length - 1];
  const signalLine = signalSeries.length > 0 ? signalSeries[signalSeries.length - 1] : null;
  const histogram = signalLine !== null ? macdLine - signalLine : null;
  const prevMacd = macdSeries.length >= 2 ? macdSeries[macdSeries.length - 2] : null;

  return {
    macdLine,
    signalLine,
    histogram,
    aboveZero: macdLine > 0,
    aboveSignal: signalLine !== null ? macdLine > signalLine : null,
    rising: prevMacd !== null ? macdLine > prevMacd : null,
  };
}

export function computeIndicators(candles) {
  const closes = candles.map((c) => c.close);
  return {
    lastClose: closes[closes.length - 1],
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    ema50: ema(closes, 50),
    rsi14: rsi(closes, 14),
    atr14: atr(candles, 14),
    macd: macd(closes),
  };
}

export function formatIndicatorsNote(indicators) {
  const { lastClose, sma20, sma50, ema50, rsi14, atr14, macd: macdData } = indicators;

  let rsiLine = '';
  if (rsi14 !== null) {
    let rsiLabel;
    if (rsi14 >= 70) rsiLabel = 'overbought';
    else if (rsi14 > 52) rsiLabel = 'bullish momentum';
    else if (rsi14 >= 45) rsiLabel = 'neutrale zone (45–52)';
    else if (rsi14 > 30) rsiLabel = 'bearish momentum';
    else rsiLabel = 'oversold';
    rsiLine = `- RSI(14): ${rsi14.toFixed(1)} (${rsiLabel})\n`;
  }

  const atrLine = atr14 !== null ? `\n- ATR(14): ${atr14.toFixed(2)} (gemiddelde candle-volatiliteit)` : '';

  const ema50Line = (ema50 != null)
    ? `\n- EMA(50): ${ema50.toFixed(2)} — prijs ${lastClose > ema50 ? 'BOVEN ↑ (bullish)' : 'ONDER ↓ (bearish)'}`
    : '';

  let macdLine = '';
  if (macdData) {
    const { macdLine: ml, signalLine: sl, aboveZero, aboveSignal, rising } = macdData;
    const momentum = aboveZero ? 'bullish momentum' : 'bearish momentum';
    const crossNote = sl !== null ? `, lijn ${aboveSignal ? 'boven' : 'onder'} signaal` : '';
    const risingNote = rising !== null ? `, ${rising ? 'stijgend' : 'dalend'}` : '';
    macdLine = `\n- MACD(12,26,9): ${ml.toFixed(2)} (${momentum}${crossNote}${risingNote})`;
  }

  return (
    `\n\nTechnische indicatoren (berekend over de candles hieronder):\n` +
    rsiLine +
    `- SMA(20): ${sma20.toFixed(2)} — prijs ${lastClose > sma20 ? 'BOVEN' : 'ONDER'}\n` +
    `- SMA(50): ${sma50.toFixed(2)} — prijs ${lastClose > sma50 ? 'BOVEN' : 'ONDER'}` +
    ema50Line +
    macdLine +
    atrLine
  );
}
