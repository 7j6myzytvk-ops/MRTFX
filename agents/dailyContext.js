import { sma, atr } from './indicators.js';

export function computeDailyContext(candles) {
  if (!candles || candles.length < 5) return null;

  const closes = candles.map((c) => c.close);
  const currentClose = closes[closes.length - 1];
  const sma20 = closes.length >= 20 ? sma(closes, 20) : null;
  const atr14 = candles.length >= 15 ? atr(candles, 14) : null;

  const fiveDayAgoClose = closes[closes.length - 6] ?? closes[0];
  const fiveDayChangePct = ((currentClose - fiveDayAgoClose) / fiveDayAgoClose) * 100;

  const recent5 = candles.slice(-5);

  return {
    currentClose,
    sma20,
    atr14,
    priceVsSma: sma20 != null ? (currentClose > sma20 ? 'boven' : 'onder') : null,
    fiveDayChangePct,
    recentHigh: Math.max(...recent5.map((c) => c.high)),
    recentLow: Math.min(...recent5.map((c) => c.low)),
  };
}

export function formatDailyContextNote(ctx) {
  if (!ctx) return '';

  const { currentClose, sma20, atr14, priceVsSma, fiveDayChangePct, recentHigh, recentLow } = ctx;

  const sign = fiveDayChangePct >= 0 ? '+' : '';
  const momentum = fiveDayChangePct > 0.5 ? 'STIJGEND' : fiveDayChangePct < -0.5 ? 'DALEND' : 'ZIJWAARTS';

  const smaNote =
    sma20 != null && priceVsSma
      ? `, 20-daags gem.: ${sma20.toFixed(2)} — prijs ${priceVsSma === 'boven' ? 'BOVEN' : 'ONDER'} het daggem.`
      : '';

  const atrNote = atr14 != null ? `, dagelijkse ATR(14): ${atr14.toFixed(2)}` : '';

  return (
    `\n\nDagtrendcontext (XAU/USD D1 — hogere tijdseenheid geeft de macro-dagtrend als achtergrond ` +
    `voor H1-setups): dagkoers ${currentClose.toFixed(2)}${smaNote}. ` +
    `5-daagse verandering: ${sign}${fiveDayChangePct.toFixed(1)}% (${momentum}). ` +
    `Recente 5-daagse range: ${recentLow.toFixed(2)}–${recentHigh.toFixed(2)}${atrNote}. ` +
    `H1-setups die meelopen met de dagtrend hebben doorgaans meer tailwind — weeg de dagrichting mee bij je zekerheidspercentage.`
  );
}
