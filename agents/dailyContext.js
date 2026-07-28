import { sma, atr } from './indicators.js';
import { computeTimeframeBias } from './multiTimeframeAlignment.js';

export function computeDailyContext(candles) {
  if (!candles || candles.length < 5) return null;

  const closes = candles.map((c) => c.close);
  const currentClose = closes[closes.length - 1];
  const sma20 = closes.length >= 20 ? sma(closes, 20) : null;
  const atr14 = candles.length >= 15 ? atr(candles, 14) : null;

  const fiveDayAgoClose = closes[closes.length - 6] ?? closes[0];
  const fiveDayChangePct = ((currentClose - fiveDayAgoClose) / fiveDayAgoClose) * 100;

  const recent5 = candles.slice(-5);
  const recent20 = candles.slice(-20);
  const bias = computeTimeframeBias(candles);

  const range20High = Math.max(...recent20.map((c) => c.high));
  const range20Low = Math.min(...recent20.map((c) => c.low));
  const range20Width = range20High - range20Low;
  const rangePct = range20Width > 0
    ? Math.round(((currentClose - range20Low) / range20Width) * 100)
    : null;

  return {
    currentClose,
    sma20,
    atr14,
    priceVsSma: sma20 != null ? (currentClose > sma20 ? 'boven' : 'onder') : null,
    fiveDayChangePct,
    recentHigh: Math.max(...recent5.map((c) => c.high)),
    recentLow: Math.min(...recent5.map((c) => c.low)),
    range20High,
    range20Low,
    rangePct,
    trend: bias === 'mixed' ? 'neutraal' : bias,
  };
}

export function formatDailyContextNote(ctx) {
  if (!ctx) return '';

  const { currentClose, sma20, atr14, priceVsSma, fiveDayChangePct, recentHigh, recentLow, range20High, range20Low, rangePct } = ctx;

  const sign = fiveDayChangePct >= 0 ? '+' : '';
  const momentum = fiveDayChangePct > 0.5 ? 'STIJGEND' : fiveDayChangePct < -0.5 ? 'DALEND' : 'ZIJWAARTS';

  const smaNote =
    sma20 != null && priceVsSma
      ? `, 20-daags gem.: ${sma20.toFixed(2)} — prijs ${priceVsSma === 'boven' ? 'BOVEN' : 'ONDER'} het daggem.`
      : '';

  const atrNote = atr14 != null ? `, dagelijkse ATR(14): ${atr14.toFixed(2)}` : '';

  // Rangepositie als concrete instructie voor agents: bij 40-60% = mid-range = gevaarlijk voor
  // directionale setups zonder extra katalysator.
  const rangeNote = range20High != null && range20Low != null && rangePct != null
    ? `\n20-daagse range: $${range20Low.toFixed(2)}–$${range20High.toFixed(2)} ` +
      `(breedte $${(range20High - range20Low).toFixed(2)}). ` +
      `Actuele prijs bevindt zich op ${rangePct}% van de range (0% = range-bodem, 100% = range-top). ` +
      (rangePct >= 40 && rangePct <= 60
        ? 'MID-RANGE: instituties hebben geen directional reason om door te bewegen — vermijd trend-entries zonder breakout-bevestiging.'
        : rangePct > 80
          ? 'BOVEN-RANGE: prijs nadert range-top — bearish setups hebben ruimte terug naar range-midden/bodem.'
          : rangePct < 20
            ? 'ONDER-RANGE: prijs nadert range-bodem — bullish setups hebben ruimte terug naar range-midden/top.'
            : 'TUSSEN-ZONE: prijs heeft richting, maar check range-extreme voor TP-ruimte.')
    : '';

  return (
    `\n\nDagtrendcontext (XAU/USD D1 — hogere tijdseenheid geeft de macro-dagtrend als achtergrond ` +
    `voor H1-setups): dagkoers ${currentClose.toFixed(2)}${smaNote}. ` +
    `5-daagse verandering: ${sign}${fiveDayChangePct.toFixed(1)}% (${momentum}). ` +
    `Recente 5-daagse range: ${recentLow.toFixed(2)}–${recentHigh.toFixed(2)}${atrNote}. ` +
    `H1-setups die meelopen met de dagtrend hebben doorgaans meer tailwind — weeg de dagrichting mee bij je zekerheidspercentage.` +
    rangeNote
  );
}
